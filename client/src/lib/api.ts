const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const API_URL = configuredApiUrl ? configuredApiUrl.replace(/\/+$/, "") : "";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const body = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = body ? JSON.parse(body) as Record<string, unknown> : {};
    } catch {
      payload = { error: body || "Request failed" };
    }
    const message = typeof payload.error === "string" ? payload.error : "Request failed";
    throw new ApiRequestError(message, response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly payload: Record<string, unknown>) {
    super(message);
  }
}

async function apiFetch(path: string, options: RequestInit = {}, retried = false): Promise<Response> {
  const token = localStorage.getItem("appointit_token");
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });
  if (response.status === 401 && !retried && path !== "/api/auth/refresh") {
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiFetch(path, options, true);
  }
  return response;
}

export function setToken(token: string, refreshToken?: string) {
  localStorage.setItem("appointit_token", token);
  if (refreshToken) localStorage.setItem("appointit_refresh_token", refreshToken);
}

export function clearToken() {
  localStorage.removeItem("appointit_token");
  localStorage.removeItem("appointit_refresh_token");
}

export function getToken() {
  return localStorage.getItem("appointit_token");
}

export function getRefreshToken() {
  return localStorage.getItem("appointit_refresh_token");
}

export type LiveResource = "appointments" | "customers" | "staff" | "services" | "branches" | "availability" | "vendor" | "notifications" | "activity" | "calendar" | "billing" | "users" | "plans" | "logs";
export type LiveConnectionStatus = "connecting" | "connected" | "disconnected";

const liveChangeSubscribers = new Set<(resources: LiveResource[]) => void>();
const liveStatusSubscribers = new Set<(status: LiveConnectionStatus) => void>();
let liveController: AbortController | null = null;
let liveRunning = false;
let livePoll: number | null = null;
let liveState: Partial<Record<LiveResource, string>> | null = null;
let currentLiveStatus: LiveConnectionStatus = "disconnected";

function broadcastLiveStatus(status: LiveConnectionStatus) {
  currentLiveStatus = status;
  for (const subscriber of liveStatusSubscribers) subscriber(status);
}

function broadcastLiveChange(resources: LiveResource[]) {
  for (const subscriber of liveChangeSubscribers) subscriber(resources);
}

function startLiveConnection() {
  if (liveRunning) return;
  liveRunning = true;
  livePoll = window.setInterval(async () => {
    try {
      const next = await api<Partial<Record<LiveResource, string>>>("/api/vendors/live-state");
      if (liveState) {
        const changed = (Object.keys(next) as LiveResource[]).filter((resource) => liveState?.[resource] !== next[resource]);
        if (changed.length) broadcastLiveChange(changed);
      }
      liveState = next;
    } catch {
      // The event stream remains primary; this poll only recovers missed tenant events.
    }
  }, 15_000);
  void (async function connect() {
    let retryDelay = 1_000;
    while (liveRunning) {
      broadcastLiveStatus("connecting");
      liveController = new AbortController();
      try {
        const token = getToken();
        const response = await fetch(`${API_URL}/api/vendors/events`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: liveController.signal, cache: "no-store" });
        if (response.status === 401 && await refreshAccessToken()) continue;
        if (!response.ok || !response.body) throw new Error("Live updates unavailable");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (liveRunning) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) {
            const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
            if (event.includes("event: ready")) {
              retryDelay = 1_000;
              broadcastLiveStatus("connected");
              continue;
            }
            if (!data || !event.includes("event: change")) continue;
            const payload = JSON.parse(data) as { resources?: LiveResource[] };
            if (payload.resources?.length) broadcastLiveChange(payload.resources);
          }
        }
        if (liveRunning) {
          broadcastLiveStatus("disconnected");
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          retryDelay = Math.min(retryDelay * 2, 15_000);
        }
      } catch (error) {
        if (liveRunning && !(error instanceof DOMException && error.name === "AbortError")) {
          broadcastLiveStatus("disconnected");
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          retryDelay = Math.min(retryDelay * 2, 15_000);
        }
      }
    }
  })();
}

export function subscribeToLiveEvents(onChange: (resources: LiveResource[]) => void, onStatus?: (status: LiveConnectionStatus) => void) {
  liveChangeSubscribers.add(onChange);
  if (onStatus) {
    liveStatusSubscribers.add(onStatus);
    onStatus(currentLiveStatus);
  }
  startLiveConnection();
  return () => {
    liveChangeSubscribers.delete(onChange);
    if (onStatus) liveStatusSubscribers.delete(onStatus);
    if (liveChangeSubscribers.size === 0) {
      liveRunning = false;
      liveController?.abort();
      if (livePoll !== null) window.clearInterval(livePoll);
      livePoll = null;
      liveState = null;
    }
  };
}

export type LoginResponse = {
  ok: true;
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    vendorId: string | null;
    role: "SUPER_ADMIN" | "VENDOR_ADMIN" | "RECEPTIONIST" | "STAFF" | "CUSTOMER";
    name: string;
    email: string;
    vendorStatus?: string | null;
  };
};

export type VendorSignupInput = {
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  password: string;
  planCode?: string;
  businessName: string;
  businessType: string;
  slug: string;
  branchName: string;
  branchAddress: string;
  service: {
    name: string;
    category: string;
    priceCents: number;
    durationMinutes: number;
    bufferAfterMinutes: number;
  };
  provider: {
    name: string;
    roleTitle: string;
    phone?: string;
    email?: string;
  };
  timezone: string;
};

export type PlanEntitlements = {
  maxBranches: number;
  maxStaff: number;
  customDomain: boolean;
  calendarSync: boolean;
  smsAutomation: boolean;
  advancedReports: boolean;
  auditRetentionDays: number;
  prioritySupport: boolean;
  customIntegrations: boolean;
};

export type PlanVersionInput = {
  currency: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  trialDays: number;
  entitlements: PlanEntitlements;
};

export type SubscriptionPlan = {
  id: string;
  code: string;
  name: string;
  description: string;
  displayOrder: number;
  active: boolean;
  isPublic: boolean;
  currentVersion: (PlanVersionInput & {
    id: string;
    version: number;
    publishedAt: string;
    subscriberCount: number;
  }) | null;
};

export type VendorSubscription = {
  id: string;
  status: "PENDING" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED";
  provider: string;
  planVersion: {
    id: string;
    version: number;
    currency: string;
    monthlyPriceCents: number | null;
    annualPriceCents: number | null;
    plan: { id: string; code: string; name: string; description: string };
    entitlements: Array<{ key: string; value: boolean | number | string }>;
  };
};

export function login(email: string, password: string) {
  return api<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function verifyPhoneOtp(challengeToken: string, code: string) {
  return api<LoginResponse>("/api/auth/phone-verification/verify", {
    method: "POST",
    body: JSON.stringify({ challengeToken, code })
  });
}

export function resendPhoneOtp(challengeToken: string) {
  return api<{ phone: string; expiresAt: string; resendAvailableAt: string }>("/api/auth/phone-verification/resend", {
    method: "POST",
    body: JSON.stringify({ challengeToken })
  });
}

export type SecuritySettings = {
  phone: string | null;
  phoneVerifiedAt: string | null;
  smsTwoFactorEnabled: boolean;
};

export function getSecuritySettings() {
  return api<SecuritySettings>("/api/auth/security");
}

export function updateSmsTwoFactor(enabled: boolean, currentPassword: string) {
  return api<SecuritySettings>("/api/auth/security/two-factor", {
    method: "PUT",
    body: JSON.stringify({ enabled, currentPassword })
  });
}

export async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const response = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });
  if (!response.ok) {
    clearToken();
    return false;
  }
  const result = await response.json() as LoginResponse;
  setToken(result.accessToken, result.refreshToken);
  return true;
}

export async function logout() {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await api<{ ok: true }>("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken })
    }).catch(() => undefined);
  }
  clearToken();
}

export function requestPasswordReset(email: string) {
  return api<{ ok: true; message: string }>("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export function confirmPasswordReset(token: string, password: string) {
  return api<{ ok: true }>("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, password })
  });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return api<{ ok: true }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export function signupVendor(input: VendorSignupInput) {
  return api<{ vendorId: string; ownerEmail: string; status: string; message: string; payment: { invoiceId: string; token: string } }>("/api/public/vendor-signup", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export type PaymentInvoice = {
  id: string;
  businessName: string;
  ownerEmail?: string | null;
  plan: { code: string; name: string };
  amountCents: number;
  currency: string;
  destinationPhone: string;
  status: "PENDING" | "SUBMITTED" | "PAID" | "REVIEW" | "EXPIRED" | "CANCELLED";
  claimedTransactionId?: string | null;
  submittedAt?: string | null;
  proofUploadedAt?: string | null;
  expiresAt: string;
  paidAt?: string | null;
};

export function getPaymentInvoice(invoiceId: string, token: string) {
  return api<PaymentInvoice>(`/api/payments/invoices/${encodeURIComponent(invoiceId)}?token=${encodeURIComponent(token)}`, { cache: "no-store" });
}

export function claimTelebirrPayment(invoiceId: string, token: string, transactionId: string) {
  return api<{ status: PaymentInvoice["status"] }>(`/api/payments/invoices/${encodeURIComponent(invoiceId)}/claim`, {
    method: "POST",
    body: JSON.stringify({ token, transactionId })
  });
}

export function uploadTelebirrProof(invoiceId: string, token: string, proof: File) {
  const form = new FormData();
  form.set("token", token);
  form.set("proof", proof);
  return api<{ status: PaymentInvoice["status"] }>(`/api/payments/invoices/${encodeURIComponent(invoiceId)}/proof`, { method: "POST", body: form });
}

export type AdminPayment = {
  id: string;
  vendor: { id: string; name: string; email?: string | null };
  plan: { code: string; name: string };
  amountCents: number;
  currency: string;
  status: PaymentInvoice["status"];
  transactionId?: string | null;
  hasProof: boolean;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  paidAt?: string | null;
};

export function listPayments() {
  return api<AdminPayment[]>("/api/payments");
}

export function reviewPayment(id: string, decision: "approve" | "reject", note?: string) {
  return api<{ status: PaymentInvoice["status"]; vendorId: string }>(`/api/payments/invoices/${id}/review`, { method: "POST", body: JSON.stringify({ decision, note }) });
}

export function createSubscriptionInvoice(planId: string) {
  return api<{ invoiceId: string; token: string }>("/api/payments/subscription/invoice", { method: "POST", body: JSON.stringify({ planId }) });
}
export function createRenewalInvoice(renewalToken: string, planId: string) {
  return api<{ invoiceId: string; token: string }>("/api/payments/subscription/renewal-invoice", { method: "POST", body: JSON.stringify({ renewalToken, planId }) });
}

export async function getPaymentProof(invoiceId: string) {
  const response = await apiFetch(`/api/payments/invoices/${encodeURIComponent(invoiceId)}/proof`);
  if (!response.ok) throw new Error("Payment proof could not be opened");
  return { blob: await response.blob(), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}

export function listVendors() {
  return api<Array<{ id: string; name: string; businessType: string; status: string; subscription?: VendorSubscription | null; email?: string; phone?: string | null; phoneVerifiedAt?: string | null; customDomains?: VendorDomain[]; messageSettings?: { smsEnabled: boolean; encryptedSmsGatewayApiKey: boolean } | null; _count?: { appointments: number; users: number } }>>("/api/vendors");
}

export function updateVendorStatus(id: string, status: string) {
  return api<{ id: string; status: string }>(`/api/vendors/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function updateVendorPlan(id: string, planId: string) {
  return api<{ id: string; subscription: VendorSubscription }>(`/api/vendors/${id}/plan`, {
    method: "PATCH",
    body: JSON.stringify({ planId })
  });
}

export function listPublicPlans() {
  return api<SubscriptionPlan[]>("/api/plans/public", { cache: "no-store" });
}

export function listSubscriptionPlans() {
  return api<SubscriptionPlan[]>("/api/plans");
}

export function createSubscriptionPlan(input: { code: string; name: string; description: string; displayOrder: number; isPublic: boolean; version: PlanVersionInput }) {
  return api<SubscriptionPlan>("/api/plans", { method: "POST", body: JSON.stringify(input) });
}

export function updateSubscriptionPlan(id: string, input: { name: string; description: string; displayOrder: number; isPublic: boolean }) {
  return api<SubscriptionPlan>(`/api/plans/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function publishSubscriptionPlan(id: string, input: PlanVersionInput & { metadata?: { name: string; description: string; displayOrder: number; isPublic: boolean } }) {
  return api<SubscriptionPlan>(`/api/plans/${id}/publish`, { method: "POST", body: JSON.stringify(input) });
}

export function archiveSubscriptionPlan(id: string) {
  return api<SubscriptionPlan>(`/api/plans/${id}/archive`, { method: "POST" });
}

export function reactivateSubscriptionPlan(id: string) {
  return api<SubscriptionPlan>(`/api/plans/${id}/reactivate`, { method: "POST" });
}

export type Branch = {
  id: string;
  name: string;
  address: string;
  phone?: string;
  timezone?: string | null;
  active?: boolean;
};

export type Service = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  priceCents: number;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  active?: boolean;
};

export type StaffMember = {
  id: string;
  name: string;
  roleTitle: string;
  phone?: string;
  email?: string;
  branchId?: string | null;
  active?: boolean;
  services?: Array<{ serviceId: string }>;
  profileImageUrl?: string | null;
};

export type StaffInvite = {
  id: string;
  email: string;
  name: string;
  role: "RECEPTIONIST" | "STAFF";
  staffId?: string | null;
  expiresAt: string;
  acceptedAt?: string | null;
  inviteUrl?: string;
  token?: string;
  emailSent?: boolean;
};

export type TeamUser = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: "RECEPTIONIST" | "STAFF";
  active: boolean;
  staffId?: string | null;
  createdAt: string;
  staff?: { id: string; name: string } | null;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  smsOptIn: boolean;
  notes?: string;
  noShowCount: number;
  lastAppointmentAt?: string;
  appointments?: Array<{ id: string; startAt: string; status?: string; service: Service; staff?: { name: string }; branch?: { name: string } }>;
};

export type Appointment = {
  id: string;
  startAt: string;
  endAt?: string;
  status: string;
  customer: { id?: string; name: string; phone: string };
  service: { id?: string; name: string; priceCents: number };
  staff: { id?: string; name: string };
  branch: { id?: string; name: string };
  history?: Array<{ id: string; action: string; createdAt: string }>;
  reminderSchedules?: Array<{
    id: string;
    channel: "SMS" | "EMAIL" | "WHATSAPP" | "TELEGRAM";
    type: string;
    offsetMinutes: number;
    scheduledFor: string;
    status: "SCHEDULED" | "QUEUED" | "SENT" | "FAILED" | "SKIPPED" | "CANCELLED";
    skipReason?: string | null;
    lastError?: string | null;
    notificationLog?: { status: string; errorMessage?: string | null; providerMessageId?: string | null; attemptCount?: number } | null;
  }>;
  managementToken?: string;
};

export type AppointmentRules = {
  allowCustomerCancellation: boolean;
  allowCustomerReschedule: boolean;
  cancellationNoticeHours: number;
  rescheduleNoticeHours: number;
  maxCustomerReschedules: number;
};

export type ReminderSettings = {
  automaticEnabled: boolean;
  offsetsMinutes: number[];
  rescheduledAppointments?: number;
};

export type VendorNotificationLog = {
  id: string;
  channel: "SMS" | "EMAIL";
  type: string;
  status: "PENDING" | "SENT" | "FAILED" | "DELIVERED" | "READ";
  errorMessage?: string | null;
  createdAt: string;
  attemptCount?: number;
  appointment?: { customer: { name: string }; service: { name: string } } | null;
};
export type ReminderSchedule = {
  id: string;
  channel: "SMS" | "EMAIL" | "WHATSAPP" | "TELEGRAM";
  type: string;
  offsetMinutes: number;
  scheduledFor: string;
  status: "SCHEDULED" | "QUEUED" | "SENT" | "FAILED" | "SKIPPED" | "CANCELLED";
  skipReason?: string | null;
  lastError?: string | null;
  appointment: {
    startAt: string;
    status: string;
    customer: { name: string; phone: string; smsOptIn: boolean };
    service: { name: string };
    staff: { name: string };
  };
  notificationLog?: { status: string; errorMessage?: string | null; providerMessageId?: string | null; attemptCount?: number } | null;
};

export type ManagedAppointment = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  vendor: { name: string; timezone: string };
  branch: { id: string; name: string; address: string };
  service: { id: string; name: string; durationMinutes: number };
  staff: { id: string; name: string; roleTitle: string };
  customer: { name: string };
  capabilities: {
    rules: AppointmentRules;
    customerReschedules: number;
    cancellationDeadline: string;
    rescheduleDeadline: string;
    cancelUnavailableReason: string | null;
    rescheduleUnavailableReason: string | null;
    canCancel: boolean;
    canReschedule: boolean;
  };
  managementToken?: string;
};

export type WorkingHour = {
  id: string;
  branchId?: string | null;
  staffId?: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
};

export type BreakTime = {
  id: string;
  branchId?: string | null;
  staffId?: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
};

export type Holiday = {
  id: string;
  branchId?: string | null;
  staffId?: string | null;
  date: string;
  reason?: string | null;
};

export type AvailabilitySettings = {
  workingHours: WorkingHour[];
  breakTimes: BreakTime[];
  holidays: Holiday[];
};

export type AvailabilityDiagnosis = {
  date: string;
  timezone: string;
  qualifiedStaffCount: number;
  slots: Array<{ startAt: string; staffId: string }>;
  reasons: Array<{ code: string; title: string; detail: string }>;
  staff: Array<{ id: string; name: string; availableSlots: number; blockers: string[] }>;
};

export type PublicVendor = {
  id: string;
  name: string;
  slug: string;
  businessType?: string;
  description?: string | null;
  timezone?: string;
  logoUrl?: string | null;
  promoImageUrl?: string | null;
  bookingTheme?: string;
  branches: Branch[];
  services: Service[];
  staff: StaffMember[];
};

export type VendorProfile = {
  id: string;
  name: string;
  slug: string;
  businessType?: string;
  description?: string | null;
  timezone?: string;
  phone?: string | null;
  email?: string | null;
  status: string;
  subscription?: VendorSubscription | null;
  phoneVerifiedAt?: string | null;
  branches?: Branch[];
  services?: Service[];
  staff?: StaffMember[];
  messageSettings?: MessagingSettings | null;
  calendarConnections?: Array<{ id: string; syncEnabled: boolean }>;
  customDomains?: VendorDomain[];
  logoUrl?: string | null;
  promoImageUrl?: string | null;
  bookingTheme?: string;
};

export type VendorDomain = {
  id: string;
  hostname: string;
  status: "PENDING" | "ACTIVE" | "FAILED" | "DISABLED";
  sslStatus: string;
  provider: string;
  cnameTarget: string;
  verificationRecords: Array<{ type: string; name: string; value: string; purpose: "ownership" | "ssl" }>;
  isPrimary: boolean;
  verifiedAt?: string | null;
  lastCheckedAt?: string | null;
};

export type DomainSettings = {
  plan: { id: string; code: string; name: string } | null;
  subscriptionStatus: VendorSubscription["status"] | null;
  canUseCustomDomain: boolean;
  hostedUrl: string;
  cnameTarget: string;
  aTarget?: string | null;
  dnsRecords: Array<{ type: string; host: string; value: string; recommended: boolean }>;
  provider: string;
  providerReady: boolean;
  domains: VendorDomain[];
};

export function listBranches() {
  return api<Branch[]>("/api/branches");
}

export function listServices() {
  return api<Service[]>("/api/services");
}

export function listStaff() {
  return api<StaffMember[]>("/api/staff");
}

export function listCustomers(filters: { q?: string; page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q); if (filters.page) query.set("page", String(filters.page)); if (filters.pageSize) query.set("pageSize", String(filters.pageSize));
  return api<Customer[]>(`/api/customers?${query}`);
}

export function listAppointments(filters: { q?: string; status?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") query.set(key, String(value));
  return api<Appointment[]>(`/api/appointments?${query}`);
}

export function createBranch(input: { name: string; address: string; phone?: string; timezone?: string }) {
  return api<Branch>("/api/branches", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateBranch(id: string, input: Partial<{ name: string; address: string; phone: string; timezone: string; active: boolean }>) {
  return api<Branch>(`/api/branches/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}
export function deactivateBranch(id: string) { return api<Branch>(`/api/branches/${id}`, { method: "DELETE" }); }
export function reactivateBranch(id: string) { return updateBranch(id, { active: true }); }
export function deleteBranchPermanently(id: string) { return api<void>(`/api/branches/${id}/permanent`, { method: "DELETE" }); }

export function createService(input: {
  name: string;
  description?: string;
  category?: string;
  priceCents: number;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
}) {
  return api<Service>("/api/services", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateService(id: string, input: Partial<{ name: string; description: string; category: string; priceCents: number; durationMinutes: number; bufferBeforeMinutes: number; bufferAfterMinutes: number; active: boolean }>) {
  return api<Service>(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}
export function deactivateService(id: string) { return api<Service>(`/api/services/${id}`, { method: "DELETE" }); }
export function reactivateService(id: string) { return updateService(id, { active: true }); }
export function deleteServicePermanently(id: string) { return api<void>(`/api/services/${id}/permanent`, { method: "DELETE" }); }

export function createStaff(input: {
  branchId?: string;
  name: string;
  roleTitle: string;
  phone?: string;
  email?: string;
  serviceIds: string[];
}) {
  return api<StaffMember>("/api/staff", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateStaff(id: string, input: Partial<{ branchId: string | null; name: string; roleTitle: string; phone: string | null; email: string | null; serviceIds: string[]; active: boolean }>) {
  return api<StaffMember>(`/api/staff/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}
export function uploadStaffPhoto(id: string, photo: File) {
  const body = new FormData();
  body.append("image", photo);
  return api<StaffMember>(`/api/staff/${id}/photo`, { method: "PUT", body });
}
export function removeStaffPhoto(id: string) { return api<void>(`/api/staff/${id}/photo`, { method: "DELETE" }); }
export function deactivateStaff(id: string) { return api<StaffMember>(`/api/staff/${id}`, { method: "DELETE" }); }
export function reactivateStaff(id: string) { return updateStaff(id, { active: true }); }
export function deleteStaffPermanently(id: string) { return api<void>(`/api/staff/${id}/permanent`, { method: "DELETE" }); }

export function listStaffInvites() {
  return api<StaffInvite[]>("/api/staff/invites");
}

export function listTeamUsers() { return api<TeamUser[]>("/api/staff/users"); }
export function updateTeamUser(id: string, input: Partial<{ active: boolean; role: "RECEPTIONIST" | "STAFF"; staffId: string | null }>) { return api<TeamUser>(`/api/staff/users/${id}`, { method: "PATCH", body: JSON.stringify(input) }); }
export function resendStaffInvite(id: string) { return api<StaffInvite>(`/api/staff/invites/${id}/resend`, { method: "POST" }); }
export function revokeStaffInvite(id: string) { return api<void>(`/api/staff/invites/${id}`, { method: "DELETE" }); }

export function createStaffInvite(input: {
  staffId?: string;
  email: string;
  name: string;
  phone?: string;
  role: "RECEPTIONIST" | "STAFF";
}) {
  return api<StaffInvite>("/api/staff/invites", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function acceptInvite(token: string, password: string) {
  return api<{ ok: true; email: string; role: string }>("/api/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify({ token, password })
  });
}

export function createDashboardAppointment(input: {
  branchId: string;
  serviceId: string;
  staffId?: string;
  startAt: string;
  notes?: string;
  customer: { name: string; phone: string; email?: string; smsOptIn?: boolean };
}) {
  return api<Appointment>("/api/appointments", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function rescheduleAppointment(id: string, input: { startAt: string; staffId?: string }) {
  return api<Appointment>(`/api/appointments/${id}/reschedule`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function cancelAppointment(id: string, reason?: string) {
  return api<Appointment>(`/api/appointments/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export function completeAppointment(id: string) {
  return api<Appointment>(`/api/appointments/${id}/complete`, { method: "POST" });
}

export function markNoShowAppointment(id: string) {
  return api<Appointment>(`/api/appointments/${id}/no-show`, { method: "POST" });
}

export function revokeAppointmentManagement(id: string) {
  return api<void>(`/api/appointments/${id}/revoke-management`, { method: "POST" });
}

export function sendManualAppointmentReminder(id: string) {
  return api<{ queued: true; channels: string[] }>(`/api/appointments/${id}/remind`, { method: "POST" });
}

export function getReminderSettings() {
  return api<ReminderSettings>("/api/settings/reminders");
}

export function updateReminderSettings(input: ReminderSettings) {
  return api<ReminderSettings>("/api/settings/reminders", { method: "PUT", body: JSON.stringify({ automaticEnabled: input.automaticEnabled, offsetsMinutes: input.offsetsMinutes }) });
}

export function listVendorNotificationLogs() {
  return api<VendorNotificationLog[]>("/api/settings/notification-logs");
}
export function listReminderSchedules() {
  return api<ReminderSchedule[]>("/api/settings/reminder-schedules");
}

export function retryVendorNotification(id: string) { return api<{ queued: true }>(`/api/settings/notification-logs/${id}/retry`, { method: "POST" }); }

export type MessageTemplate = { id: string; channel: "SMS" | "EMAIL"; type: "confirmation" | "reminder" | "cancellation" | "reschedule" | "follow_up"; templateName?: string | null; subject?: string | null; body: string; active: boolean; updatedAt: string };
export function listMessageTemplates() { return api<MessageTemplate[]>("/api/settings/templates"); }
export function saveMessageTemplate(type: MessageTemplate["type"], input: Omit<MessageTemplate, "id" | "type" | "updatedAt">) { return api<MessageTemplate>(`/api/settings/templates/${type}`, { method: "PUT", body: JSON.stringify(input) }); }
export function deleteMessageTemplate(id: string) { return api<void>(`/api/settings/templates/${id}`, { method: "DELETE" }); }

export function getAppointmentRules() {
  return api<AppointmentRules>("/api/settings/appointment-rules");
}

export function updateAppointmentRules(input: AppointmentRules) {
  return api<AppointmentRules>("/api/settings/appointment-rules", { method: "PUT", body: JSON.stringify(input) });
}

export function getManagedAppointment(token: string) {
  return api<ManagedAppointment>(`/api/public/appointments/manage?${new URLSearchParams({ token })}`);
}

export function getManagedAppointmentSlots(token: string, date: string, staffId?: string) {
  const params = new URLSearchParams({ token, date });
  if (staffId) params.set("staffId", staffId);
  return api<Array<{ startAt: string; staffId: string }>>(`/api/public/appointments/manage/slots?${params}`);
}

export function rescheduleManagedAppointment(token: string, startAt: string, staffId?: string) {
  return api<ManagedAppointment>("/api/public/appointments/manage/reschedule", { method: "POST", body: JSON.stringify({ token, startAt, staffId }) });
}

export function cancelManagedAppointment(token: string, reason?: string) {
  return api<ManagedAppointment>("/api/public/appointments/manage/cancel", { method: "POST", body: JSON.stringify({ token, reason }) });
}

export function updateCustomerNotes(id: string, notes: string) {
  return api<Customer>(`/api/customers/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ notes })
  });
}

export function updateCustomer(id: string, input: Partial<{ name: string; phone: string; email: string | null; notes: string; smsOptIn: boolean }>) {
  return api<Customer>(`/api/customers/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export type ReportSummary = {
  total: number; completed: number; cancelled: number; noShows: number; revenueEstimateCents: number;
  popularServices: Array<{ id: string; name: string; count: number }>;
  staffPerformance: Array<{ id: string; name: string; total: number; completed: number; noShows: number }>;
  upcomingAppointments: Array<{ id: string; startAt: string; customerName: string; serviceName: string; staffName: string; status: string }>;
};
export function getReportSummary(from?: string, to?: string) {
  const query = new URLSearchParams(); if (from) query.set("from", from); if (to) query.set("to", to);
  return api<ReportSummary>(`/api/reports/summary?${query.toString()}`);
}

export type AdminUser = { id: string; name: string; email: string; phone?: string | null; phoneVerifiedAt?: string | null; role: string; active: boolean; createdAt: string; vendor?: { id: string; name: string } | null };
export type AdminLog = { id: string; action?: string; eventType?: string; entityType?: string; channel?: string; type?: string; status?: string; errorMessage?: string | null; vendorId?: string | null; createdAt: string };
export type CalendarHealth = { connections: Array<{ id: string; provider: string; syncEnabled: boolean; expiresAt?: string | null; vendor: { id: string; name: string }; staff?: { id: string; name: string } | null }>; recentFailures: Array<{ id: string; action: string; errorMessage?: string | null; createdAt: string; vendor: { name: string } }>; syncs24h: number };
export function listAdminUsers(filters: { q?: string; page?: number; pageSize?: number } = {}) { const query = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") query.set(key, String(value)); return api<AdminUser[]>(`/api/admin/users?${query}`); }
export function listAdminLogs(type: "audit" | "webhook" | "notification") { return api<AdminLog[]>(`/api/admin/logs?type=${type}`); }
export function getCalendarHealth() { return api<CalendarHealth>("/api/admin/calendar-health"); }

export function getAvailabilitySettings() {
  return api<AvailabilitySettings>("/api/availability");
}

export function diagnoseAvailability(input: { branchId: string; serviceId: string; date: string; staffId?: string }) {
  const query = new URLSearchParams({ branchId: input.branchId, serviceId: input.serviceId, date: input.date });
  if (input.staffId) query.set("staffId", input.staffId);
  return api<AvailabilityDiagnosis>(`/api/availability/diagnose?${query}`);
}

export function replaceWorkingHours(input: {
  scope: "vendor" | "branch" | "staff";
  branchId?: string;
  staffId?: string;
  hours: Array<{ weekday: number; startTime: string; endTime: string }>;
}) {
  return api<WorkingHour[]>("/api/availability/working-hours", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function createBreakTime(input: {
  branchId?: string;
  staffId?: string;
  weekday: number;
  startTime: string;
  endTime: string;
}) {
  return api<BreakTime>("/api/availability/break-times", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteBreakTime(id: string) {
  return api<void>(`/api/availability/break-times/${id}`, { method: "DELETE" });
}

export function createHoliday(input: {
  branchId?: string;
  staffId?: string;
  date: string;
  reason?: string;
}) {
  return api<Holiday>("/api/availability/holidays", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteHoliday(id: string) {
  return api<void>(`/api/availability/holidays/${id}`, { method: "DELETE" });
}

export type MessagingSettings = {
  smsEnabled?: boolean;
  smsProvider?: string | null;
  smsGatewayUrl?: string | null;
  encryptedSmsGatewayApiKey?: boolean;
  smsIdentifierId?: string | null;
  smsFrom?: string | null;
};

export type GoogleCalendarStatus = {
  configured: boolean;
  redirectUri: string;
  scopes: string[];
  connected: boolean;
  syncEnabled: boolean;
  expiresAt?: string | null;
  canUseCalendarSync: boolean;
  connections: Array<{ id: string; staffId?: string | null; calendarId: string; syncEnabled: boolean; expiresAt?: string | null; createdAt: string; staff?: { id: string; name: string } | null }>;
  logs: Array<{ id: string; appointmentId?: string | null; action: string; status: string; errorMessage?: string | null; createdAt: string }>;
};

export function getMessagingSettings() {
  return api<MessagingSettings>("/api/settings/messaging");
}

export function updateMessagingSettings(input: {
  smsEnabled?: boolean;
  smsProvider?: string;
  smsGatewayUrl?: string;
  smsGatewayApiKey?: string;
  smsIdentifierId?: string;
  smsFrom?: string;
}) {
  return api<MessagingSettings>("/api/settings/messaging", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function sendTestSms(input: { phone: string; message?: string }) {
  return api<{ sent: true; providerMessageId?: string | null }>("/api/settings/messaging/test", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getVendorProfile() {
  return api<VendorProfile>("/api/vendors/me");
}

export function updateVendorProfile(input: Partial<{ name: string; slug: string; businessType: string; description: string | null; phone: string | null; email: string | null; timezone: string; bookingTheme: string }>) { return api<VendorProfile>("/api/vendors/me", { method: "PATCH", body: JSON.stringify(input) }); }

export function uploadVendorLogo(logo: File) {
  const body = new FormData();
  body.append("image", logo);
  return api<{ logoUrl: string }>("/api/vendors/me/logo", { method: "PUT", body });
}

export function removeVendorLogo() {
  return api<void>("/api/vendors/me/logo", { method: "DELETE" });
}

export function uploadVendorPromoImage(image: File) {
  const body = new FormData();
  body.append("image", image);
  return api<{ promoImageUrl: string }>("/api/vendors/me/promo-image", { method: "PUT", body });
}

export function removeVendorPromoImage() {
  return api<void>("/api/vendors/me/promo-image", { method: "DELETE" });
}

export function getGoogleCalendarStatus() {
  return api<GoogleCalendarStatus>("/api/calendar/google/status");
}

export function startGoogleCalendarConnection() {
  return api<{ url: string }>("/api/calendar/google/connect");
}
export function listGoogleCalendars(id: string) { return api<Array<{ id: string; name: string; primary: boolean }>>(`/api/calendar/google/connections/${id}/calendars`); }
export function updateGoogleCalendarConnection(id: string, input: { syncEnabled?: boolean; calendarId?: string }) { return api(`/api/calendar/google/connections/${id}`, { method: "PATCH", body: JSON.stringify(input) }); }
export function disconnectGoogleCalendar(id: string) { return api<void>(`/api/calendar/google/connections/${id}`, { method: "DELETE" }); }
export function resyncGoogleCalendar() { return api<{ processed: number }>("/api/calendar/google/resync", { method: "POST" }); }
export function retryGoogleCalendarSync(id: string) { return api<{ retried: true }>(`/api/calendar/google/logs/${id}/retry`, { method: "POST" }); }

export type ActivityNotification = { id: string; appointmentId?: string | null; type: string; title: string; message: string; createdAt: string; read: boolean };
export function listActivityNotifications() { return api<ActivityNotification[]>("/api/activity"); }
export function markActivityRead(id: string) { return api<void>(`/api/activity/${id}/read`, { method: "POST" }); }
export function markAllActivityRead() { return api<void>("/api/activity/read-all", { method: "POST" }); }

export type OverviewAnalytics = {
  rangeDays: number;
  daily: Array<{ date: string; total: number; completed: number; cancelled: number; noShows: number; revenueCents: number }>;
  statusBreakdown: Array<{ name: string; value: number }>;
  popularServices: Array<{ id: string; name: string; count: number }>;
};
export function getOverviewAnalytics(days = 30) { return api<OverviewAnalytics>(`/api/reports/overview?days=${days}`); }

export function getDomainSettings() {
  return api<DomainSettings>("/api/domains");
}

export function addCustomDomain(hostname: string) {
  return api<VendorDomain>("/api/domains", { method: "POST", body: JSON.stringify({ hostname }) });
}

export function refreshCustomDomain(id: string) {
  return api<VendorDomain>(`/api/domains/${id}/refresh`, { method: "POST" });
}

export function removeCustomDomain(id: string) {
  return api<void>(`/api/domains/${id}`, { method: "DELETE" });
}

export function updateCustomDomainStatus(id: string, status: VendorDomain["status"]) {
  return api<VendorDomain>(`/api/domains/admin/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export type BookingLocator = { slug?: string; hostname?: string };

function publicBookingBase(locator: BookingLocator) {
  if (locator.slug) return `/api/public/vendors/${encodeURIComponent(locator.slug)}`;
  if (locator.hostname) return `/api/public/domains/${encodeURIComponent(locator.hostname)}`;
  throw new Error("Booking page address is missing");
}

export function getPublicVendor(locator: BookingLocator) {
  return api<PublicVendor>(publicBookingBase(locator));
}

export function getPublicSlots(locator: BookingLocator, branchId: string, serviceId: string, date: string, staffId?: string) {
  const params = new URLSearchParams({ branchId, serviceId, date });
  if (staffId) params.set("staffId", staffId);
  return api<Array<{ startAt: string; staffId: string }>>(`${publicBookingBase(locator)}/slots?${params.toString()}`);
}

export function bookPublicAppointment(
  locator: BookingLocator,
  input: {
    branchId: string;
    serviceId: string;
    staffId?: string;
    startAt: string;
    customer: { name: string; phone: string; email?: string; smsOptIn?: boolean };
  }
) {
  return api<Appointment>(`${publicBookingBase(locator)}/book`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export const demoVendor = {
  name: "Addis Dental Clinic",
  slug: "addis-dental-clinic",
  businessType: "Dental clinic",
  timezone: "Africa/Addis_Ababa",
  branches: [{ id: "seed-main-branch", name: "Bole Main Branch", address: "Bole, Addis Ababa" }],
  services: [
    { id: "seed-cleaning", name: "Dental Cleaning", category: "Dental care", durationMinutes: 45, priceCents: 250000 },
    { id: "whitening", name: "Whitening Session", category: "Cosmetic", durationMinutes: 60, priceCents: 600000 },
    { id: "consult", name: "Consultation", category: "General", durationMinutes: 30, priceCents: 100000 }
  ],
  staff: [
    { id: "seed-dr-hana", name: "Dr. Hana Tesfaye", roleTitle: "Dentist", branchId: "seed-main-branch", services: [{ serviceId: "seed-cleaning" }, { serviceId: "consult" }] },
    { id: "dr-samuel", name: "Dr. Samuel Bekele", roleTitle: "Orthodontist", branchId: "seed-main-branch", services: [{ serviceId: "whitening" }, { serviceId: "consult" }] }
  ]
};

export const demoAppointments = [
  { id: "1", startAt: "2026-06-25T09:00:00", status: "CONFIRMED", customer: { name: "Mekdes Alemu", phone: "+251911000001" }, service: { name: "Dental Cleaning", priceCents: 250000 }, staff: { name: "Dr. Hana Tesfaye" }, branch: { name: "Bole Main Branch" } },
  { id: "2", startAt: "2026-06-25T11:00:00", status: "PENDING", customer: { name: "Yonas Girma", phone: "+251911000002" }, service: { name: "Consultation", priceCents: 100000 }, staff: { name: "Dr. Samuel Bekele" }, branch: { name: "Bole Main Branch" } },
  { id: "3", startAt: "2026-06-26T14:30:00", status: "COMPLETED", customer: { name: "Sara Mohammed", phone: "+251911000003" }, service: { name: "Whitening Session", priceCents: 600000 }, staff: { name: "Dr. Hana Tesfaye" }, branch: { name: "Bole Main Branch" } }
];
