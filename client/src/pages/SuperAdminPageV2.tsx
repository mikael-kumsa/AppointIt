import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Archive, CreditCard, MessageCircle, Plus, RotateCcw, Save, Shield, Users } from "lucide-react";
import {
  archiveSubscriptionPlan, clearToken, createSubscriptionPlan, getPaymentProof, listAdminLogs, listAdminUsers, listPayments, listSubscriptionPlans, listVendors, logout, reviewPayment,
  publishSubscriptionPlan, reactivateSubscriptionPlan, updateCustomDomainStatus, updateVendorPlan, updateVendorStatus,
  type AdminLog, type AdminPayment, type AdminUser, type PlanEntitlements, type PlanVersionInput, type SubscriptionPlan, type VendorDomain, type VendorSubscription
} from "../lib/api";
import { subscribeToLiveEvents, type LiveResource } from "../lib/api";
import { Metric } from "../components/common";
import { money } from "../lib/format";

type AdminView = "vendors" | "plans" | "payments" | "users" | "logs";
type AdminVendorRow = {
  id: string; name: string; businessType: string; status: string; subscription?: VendorSubscription | null;
  email: string; phone?: string | null; phoneVerifiedAt?: string | null; customDomains: VendorDomain[];
  messageSettings?: { smsEnabled: boolean; encryptedSmsGatewayApiKey: boolean } | null;
  _count?: { appointments: number; users: number };
};

export function SuperAdminPage() {
  const [view, setView] = useState<AdminView>("vendors");
  const [vendors, setVendors] = useState<AdminVendorRow[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [logType, setLogType] = useState<"audit" | "webhook" | "notification">("audit");
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [editingPlanId, setEditingPlanId] = useState<string | "new" | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);

  const refreshResources = useCallback(async (resources: LiveResource[]) => {
    const changed = new Set(resources);
    const jobs: Promise<unknown>[] = [];
    if (["vendor", "billing", "staff", "branches", "services", "notifications"].some((item) => changed.has(item as LiveResource))) jobs.push(listVendors().then((rows) => setVendors(rows.map((vendor) => ({ id: vendor.id, name: vendor.name, businessType: vendor.businessType, status: vendor.status, subscription: vendor.subscription, email: vendor.email ?? "No owner email", phone: vendor.phone ?? null, phoneVerifiedAt: vendor.phoneVerifiedAt ?? null, customDomains: vendor.customDomains ?? [], messageSettings: vendor.messageSettings ?? null, _count: vendor._count })))));
    if (changed.has("billing")) jobs.push(listPayments().then(setPayments));
    if (changed.has("users")) jobs.push(listAdminUsers().then(setUsers));
    if (changed.has("plans")) jobs.push(listSubscriptionPlans().then(setPlans));
    if (changed.has("logs") || changed.has("notifications")) jobs.push(listAdminLogs(logType).then(setLogs));
    await Promise.allSettled(jobs);
  }, [logType]);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const [vendorRows, planRows, paymentRows, userRows, logRows] = await Promise.all([listVendors(), listSubscriptionPlans(), listPayments(), listAdminUsers(), listAdminLogs(logType)]);
      setVendors(vendorRows.map((vendor) => ({
        id: vendor.id, name: vendor.name, businessType: vendor.businessType, status: vendor.status,
        subscription: vendor.subscription, email: vendor.email ?? "No owner email",
        phone: vendor.phone ?? null, phoneVerifiedAt: vendor.phoneVerifiedAt ?? null, customDomains: vendor.customDomains ?? [], messageSettings: vendor.messageSettings ?? null, _count: vendor._count
      })));
      setPlans(planRows);
      setPayments(paymentRows);
      setUsers(userRows); setLogs(logRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load platform data");
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(id: string, status: string) {
    try {
      const updated = await updateVendorStatus(id, status);
      setVendors((current) => current.map((vendor) => vendor.id === id ? { ...vendor, status: updated.status } : vendor));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Status update failed"); }
  }

  async function changePlan(id: string, planId: string) {
    try {
      const updated = await updateVendorPlan(id, planId);
      setVendors((current) => current.map((vendor) => vendor.id === id ? { ...vendor, subscription: updated.subscription } : vendor));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Plan update failed"); }
  }

  async function activateDomain(vendorId: string, domainId: string) {
    try {
      const updated = await updateCustomDomainStatus(domainId, "ACTIVE");
      setVendors((current) => current.map((vendor) => vendor.id === vendorId
        ? { ...vendor, customDomains: vendor.customDomains.map((domain) => domain.id === domainId ? updated : domain) }
        : vendor));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Domain activation failed"); }
  }

  async function togglePlan(plan: SubscriptionPlan) {
    try {
      const updated = plan.active ? await archiveSubscriptionPlan(plan.id) : await reactivateSubscriptionPlan(plan.id);
      setPlans((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(`${updated.name} ${updated.active ? "reactivated" : "archived"}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Plan status update failed"); }
  }

  async function openPaymentProof(payment: AdminPayment) {
    try {
      const { blob } = await getPaymentProof(payment.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Payment proof could not be opened"); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => subscribeToLiveEvents((resources) => void refreshResources(resources), (status) => setLiveConnected(status === "connected")), [refreshResources]);

  const pendingCount = vendors.filter((vendor) => vendor.status === "PENDING_REVIEW").length;
  const activeCount = vendors.filter((vendor) => vendor.status === "ACTIVE").length;
  const suspendedCount = vendors.filter((vendor) => vendor.status === "SUSPENDED").length;
  const editingPlan = editingPlanId && editingPlanId !== "new" ? plans.find((plan) => plan.id === editingPlanId) : undefined;

  return <div className="app-shell admin-shell">
    <aside className="sidebar admin-sidebar">
      <div className="brand"><span>S</span><div><strong>Platform Admin</strong><small>Control center</small></div></div>
      <nav>
        <button className={view === "vendors" ? "active" : ""} onClick={() => setView("vendors")}><Shield size={18} /> Vendor reviews</button>
        <button className={view === "plans" ? "active" : ""} onClick={() => setView("plans")}><CreditCard size={18} /> Subscription plans</button>
        <button className={view === "payments" ? "active" : ""} onClick={() => setView("payments")}><CreditCard size={18} /> Telebirr payments</button>
        <button className={view === "users" ? "active" : ""} onClick={() => setView("users")}><Users size={18} /> Users</button><button className={view === "logs" ? "active" : ""} onClick={() => setView("logs")}><MessageCircle size={18} /> System logs</button>
      </nav>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <div><p>Super admin dashboard</p><h1>{{ vendors: "Vendor oversight", plans: "Plan catalogue", payments: "Payment reconciliation", users: "Platform users", logs: "System logs" }[view]}</h1></div>
        <div className="top-actions"><span className={`live-indicator ${liveConnected ? "connected" : ""}`}><i /> Live</span><button className="secondary" onClick={() => void load()}>{loading ? "Loading..." : "Refresh"}</button><a className="secondary" href="/">Landing page</a><button className="secondary" onClick={() => { void logout().finally(() => { clearToken(); location.href = "/"; }); }}>Logout</button></div>
      </header>
      <section className="metrics">
        <Metric label="Pending review" value={String(pendingCount)} detail="new businesses" />
        <Metric label="Active vendors" value={String(activeCount)} detail="approved workspaces" />
        <Metric label="Published plans" value={String(plans.filter((plan) => plan.active && plan.isPublic).length)} detail="visible on pricing" />
        <Metric label="Suspended" value={String(suspendedCount)} detail="requires follow-up" />
      </section>
      {message && <p className="form-message">{message}</p>}
      {view === "vendors" && <section className="panel"><div className="panel-head"><h2>Business accounts</h2><span className="badge active">LIVE DATA</span></div><div className="review-list">
        {!loading && vendors.length === 0 && <div className="empty-state"><strong>No vendors yet</strong><span>New business accounts will appear here after signup.</span></div>}
        {vendors.map((vendor) => <ReviewRow key={vendor.id} vendor={vendor} plans={plans.filter((plan) => plan.active && plan.currentVersion)} onVerify={() => void changeStatus(vendor.id, "ACTIVE")} onReject={() => void changeStatus(vendor.id, "SUSPENDED")} onPlanChange={(planId) => void changePlan(vendor.id, planId)} onDomainActivate={(domainId) => void activateDomain(vendor.id, domainId)} />)}
      </div></section>}
      {view === "plans" && <div className="plan-admin-layout">
        <section className="panel plan-catalogue"><div className="panel-head"><div><h2>Subscription plans</h2><p className="muted-text">Published changes create a new version.</p></div><button className="primary" onClick={() => setEditingPlanId("new")}><Plus size={17} /> New plan</button></div><div className="plan-admin-list">
          {plans.map((plan) => <div className={`plan-admin-row${plan.active ? "" : " archived"}`} key={plan.id}>
            <div><strong>{plan.name}</strong><small>{plan.code} · Version {plan.currentVersion?.version ?? "-"}</small></div>
            <div><span>{plan.currentVersion?.monthlyPriceCents == null ? "Custom quote" : `${money(plan.currentVersion.monthlyPriceCents)} / month`}</span><small>{plan.currentVersion?.subscriberCount ?? 0} subscribed</small></div>
            <span className={`badge ${plan.active && plan.isPublic ? "confirmed" : "pending"}`}>{plan.active ? plan.isPublic ? "PUBLIC" : "PRIVATE" : "ARCHIVED"}</span>
            <div className="plan-row-actions"><button className="secondary" onClick={() => setEditingPlanId(plan.id)}>Edit</button><button className="icon-action" title={plan.active ? "Archive plan" : "Reactivate plan"} aria-label={plan.active ? `Archive ${plan.name}` : `Reactivate ${plan.name}`} onClick={() => void togglePlan(plan)}>{plan.active ? <Archive size={17} /> : <RotateCcw size={17} />}</button></div>
          </div>)}
        </div></section>
        {editingPlanId && <PlanEditor key={editingPlanId} plan={editingPlan} onCancel={() => setEditingPlanId(null)} onSaved={(saved) => {
          setPlans((current) => current.some((plan) => plan.id === saved.id) ? current.map((plan) => plan.id === saved.id ? saved : plan) : [...current, saved].sort((a, b) => a.displayOrder - b.displayOrder));
          setEditingPlanId(null); setMessage(`${saved.name} published successfully.`);
        }} onError={setMessage} />}
      </div>}
      {view === "payments" && <section className="panel"><div className="panel-head"><div><h2>Telebirr invoices</h2><p className="muted-text">Automatic matches and items requiring review.</p></div><span className="badge active">LIVE DATA</span></div><div className="payment-admin-list">
        {!loading && payments.length === 0 && <div className="empty-state"><strong>No payment invoices yet</strong><span>New vendor invoices will appear after signup.</span></div>}
        {payments.map((payment) => <PaymentReviewRow key={payment.id} payment={payment} onOpen={() => void openPaymentProof(payment)} onReviewed={() => void load()} onError={setMessage} />)}
      </div></section>}
      {view === "users" && <section className="panel"><div className="panel-head"><h2>User accounts</h2><span className="badge active">{users.length} LOADED</span></div><form className="data-search-bar" onSubmit={(event) => { event.preventDefault(); void listAdminUsers({ q: userSearch, page: 1, pageSize: 100 }).then((rows) => { setUsers(rows); setUserPage(1); }); }}><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search user, email, phone, or business" /><button className="secondary">Search</button></form><div className="admin-data-list">{users.map((user) => <div className="admin-data-row" key={user.id}><div><strong>{user.name}</strong><small>{user.email}</small></div><span>{user.vendor?.name ?? "Platform"}</span><span>{user.role}</span><span className={`badge ${user.active ? "completed" : "pending"}`}>{user.active ? "ACTIVE" : "INACTIVE"}</span><small>{user.phoneVerifiedAt ? "Phone verified" : "Phone unverified"}</small></div>)}</div><div className="pagination-controls"><button className="secondary" disabled={userPage === 1} onClick={() => void listAdminUsers({ q: userSearch, page: userPage - 1, pageSize: 100 }).then((rows) => { setUsers(rows); setUserPage(userPage - 1); })}>Previous</button><span>Page {userPage}</span><button className="secondary" disabled={users.length < 100} onClick={() => void listAdminUsers({ q: userSearch, page: userPage + 1, pageSize: 100 }).then((rows) => { setUsers(rows); setUserPage(userPage + 1); })}>Next</button></div></section>}
      {view === "logs" && <section className="panel"><div className="panel-head"><h2>Operational logs</h2><div className="filters">{(["audit", "webhook", "notification"] as const).map((type) => <button className={logType === type ? "active" : ""} key={type} onClick={() => { setLogType(type); listAdminLogs(type).then(setLogs).catch((error) => setMessage(error.message)); }}>{type}</button>)}</div></div><div className="admin-data-list">{logs.map((log) => <div className="admin-data-row logs" key={log.id}><strong>{log.action ?? log.eventType ?? log.type}</strong><span>{log.channel ?? log.status ?? log.entityType}</span><span>{log.errorMessage ?? "No error"}</span><small>{new Date(log.createdAt).toLocaleString()}</small></div>)}</div></section>}
    </main>
  </div>;
}

function ReviewRow({ vendor, plans, onVerify, onReject, onPlanChange, onDomainActivate }: { vendor: AdminVendorRow; plans: SubscriptionPlan[]; onVerify: () => void; onReject: () => void; onPlanChange: (planId: string) => void; onDomainActivate: (domainId: string) => void }) {
  const phoneVerified = Boolean(vendor.phoneVerifiedAt);
  const pendingDomain = vendor.customDomains.find((domain) => domain.status === "PENDING");
  const currentPlanId = vendor.subscription?.planVersion.plan.id ?? "";
  const customDomainAllowed = vendor.subscription?.planVersion.entitlements.some((item) => item.key === "customDomain" && item.value === true);
  const health = [
    { label: "Phone", ok: phoneVerified },
    { label: "Paid plan", ok: vendor.subscription?.status === "ACTIVE" },
    { label: "SMS", ok: Boolean(vendor.messageSettings?.smsEnabled && vendor.messageSettings.encryptedSmsGatewayApiKey) },
    { label: "Domain", ok: !customDomainAllowed || vendor.customDomains.some((domain) => domain.status === "ACTIVE") }
  ];
  return <div className="row review-row">
    <div><strong>{vendor.name}</strong><small>{vendor.businessType} - {vendor._count?.appointments ?? 0} appointments</small></div><div><span>{vendor.email}</span><small>{phoneVerified ? `Verified ${vendor.phone ?? ""}` : "Waiting for SMS phone verification"}</small></div>
    <span className={`badge ${vendor.status === "ACTIVE" ? "confirmed" : "pending"}`}>{vendor.status}</span><span className={`badge ${vendor.subscription?.status === "ACTIVE" ? "completed" : "pending"}`}>{vendor.subscription?.status ?? "NO SUBSCRIPTION"}</span>
    <div className="vendor-health-strip">{health.map((item) => <span key={item.label} className={item.ok ? "ok" : ""}><i />{item.label}</span>)}<small>{vendor._count?.users ?? 0} users</small></div>
    <div className="review-actions"><select aria-label={`Subscription plan for ${vendor.name}`} value={currentPlanId} onChange={(event) => onPlanChange(event.target.value)}><option value="" disabled>Select paid plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>
      {currentPlanId && vendor.subscription?.status !== "ACTIVE" && <button onClick={() => onPlanChange(currentPlanId)}>Activate subscription</button>}{customDomainAllowed && pendingDomain && <button onClick={() => onDomainActivate(pendingDomain.id)}>Activate domain</button>}{vendor.status !== "ACTIVE" && <button disabled={!phoneVerified} onClick={onVerify}>Activate</button>}{vendor.status !== "SUSPENDED" && <button onClick={onReject}>Suspend</button>}</div>
  </div>;
}

function PaymentReviewRow({ payment, onOpen, onReviewed, onError }: { payment: AdminPayment; onOpen: () => void; onReviewed: () => void; onError: (message: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(decision: "approve" | "reject") { setBusy(true); try { await reviewPayment(payment.id, decision, note || undefined); onReviewed(); } catch (error) { onError(error instanceof Error ? error.message : "Payment review failed"); } finally { setBusy(false); } }
  return <div className="payment-admin-row"><div><strong>{payment.vendor.name}</strong><small>{payment.vendor.email ?? "No owner email"}</small></div><div><strong>{payment.plan.name}</strong><small>{new Date(payment.createdAt).toLocaleString()}</small></div><strong>{money(payment.amountCents)}</strong><code>{payment.transactionId ?? "Awaiting transaction"}</code><div className="payment-proof-actions"><span className={`badge ${payment.status === "PAID" ? "completed" : payment.status === "REVIEW" ? "pending" : "active"}`}>{payment.status}</span>{payment.hasProof && <button className="secondary" onClick={onOpen}>View proof</button>}</div>{payment.status === "REVIEW" && <div className="payment-review-controls"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Review note" maxLength={1000} /><button disabled={busy} onClick={() => void decide("approve")}>Approve</button><button className="danger" disabled={busy} onClick={() => void decide("reject")}>Reject</button></div>}</div>;
}

type PlanDraft = {
  code: string; name: string; description: string; displayOrder: string; isPublic: boolean; currency: string;
  monthlyPrice: string; annualPrice: string; trialDays: string; maxBranches: string; maxStaff: string;
  customDomain: boolean; calendarSync: boolean; smsAutomation: boolean; advancedReports: boolean;
  auditRetentionDays: string; prioritySupport: boolean; customIntegrations: boolean;
};

function planDraft(plan?: SubscriptionPlan): PlanDraft {
  const version = plan?.currentVersion;
  const entitlements = version?.entitlements;
  return {
    code: plan?.code ?? "", name: plan?.name ?? "", description: plan?.description ?? "", displayOrder: String(plan?.displayOrder ?? 10), isPublic: plan?.isPublic ?? true,
    currency: version?.currency ?? "ETB", monthlyPrice: version?.monthlyPriceCents == null ? "" : String(version.monthlyPriceCents / 100), annualPrice: version?.annualPriceCents == null ? "" : String(version.annualPriceCents / 100), trialDays: String(version?.trialDays ?? 0),
    maxBranches: String(entitlements?.maxBranches ?? 1), maxStaff: String(entitlements?.maxStaff ?? 5), customDomain: entitlements?.customDomain ?? false, calendarSync: entitlements?.calendarSync ?? true,
    smsAutomation: entitlements?.smsAutomation ?? true, advancedReports: entitlements?.advancedReports ?? false, auditRetentionDays: String(entitlements?.auditRetentionDays ?? 30), prioritySupport: entitlements?.prioritySupport ?? false, customIntegrations: entitlements?.customIntegrations ?? false
  };
}

function PlanEditor({ plan, onCancel, onSaved, onError }: { plan?: SubscriptionPlan; onCancel: () => void; onSaved: (plan: SubscriptionPlan) => void; onError: (message: string) => void }) {
  const [draft, setDraft] = useState<PlanDraft>(() => planDraft(plan));
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof PlanDraft,>(key: K, value: PlanDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    try {
      const entitlements: PlanEntitlements = { maxBranches: Number(draft.maxBranches), maxStaff: Number(draft.maxStaff), customDomain: draft.customDomain, calendarSync: draft.calendarSync, smsAutomation: draft.smsAutomation, advancedReports: draft.advancedReports, auditRetentionDays: Number(draft.auditRetentionDays), prioritySupport: draft.prioritySupport, customIntegrations: draft.customIntegrations };
      const version: PlanVersionInput = { currency: draft.currency.toUpperCase(), monthlyPriceCents: draft.monthlyPrice ? Math.round(Number(draft.monthlyPrice) * 100) : null, annualPriceCents: draft.annualPrice ? Math.round(Number(draft.annualPrice) * 100) : null, trialDays: Number(draft.trialDays), entitlements };
      const metadata = { name: draft.name, description: draft.description, displayOrder: Number(draft.displayOrder), isPublic: draft.isPublic };
      const saved = plan ? await publishSubscriptionPlan(plan.id, { ...version, metadata }) : await createSubscriptionPlan({ code: draft.code.toUpperCase().replace(/[^A-Z0-9_]/g, "_"), ...metadata, version });
      onSaved(saved);
    } catch (error) { onError(error instanceof Error ? error.message : "Could not publish plan"); } finally { setSaving(false); }
  }

  const toggles: Array<[keyof PlanEntitlements, string]> = [["customDomain", "Custom domains"], ["smsAutomation", "SMS automation"], ["advancedReports", "Advanced reports"], ["prioritySupport", "Priority support"], ["customIntegrations", "Custom integrations"]];
  return <section className="panel plan-editor"><div className="panel-head"><div><h2>{plan ? `Publish ${plan.name}` : "Create paid plan"}</h2><p className="muted-text">{plan ? `Current version ${plan.currentVersion?.version ?? "-"}` : "Initial published version"}</p></div></div><form onSubmit={save}>
    <div className="plan-editor-grid">
      <label>Plan code<input value={draft.code} disabled={Boolean(plan)} onChange={(event) => update("code", event.target.value.toUpperCase())} required /></label><label>Plan name<input value={draft.name} onChange={(event) => update("name", event.target.value)} required /></label>
      <label className="wide">Description<textarea value={draft.description} onChange={(event) => update("description", event.target.value)} required /></label><label>Display order<input type="number" min="0" value={draft.displayOrder} onChange={(event) => update("displayOrder", event.target.value)} required /></label>
      <label>Currency<input maxLength={3} value={draft.currency} onChange={(event) => update("currency", event.target.value)} required /></label><label>Monthly price<input type="number" min="0.01" step="0.01" value={draft.monthlyPrice} onChange={(event) => update("monthlyPrice", event.target.value)} placeholder="Custom quote" /></label>
      <label>Annual price<input type="number" min="0.01" step="0.01" value={draft.annualPrice} onChange={(event) => update("annualPrice", event.target.value)} placeholder="Custom quote" /></label><label>Trial days<input type="number" min="0" max="365" value={draft.trialDays} onChange={(event) => update("trialDays", event.target.value)} required /></label>
      <label>Branch limit<input type="number" min="-1" value={draft.maxBranches} onChange={(event) => update("maxBranches", event.target.value)} required /></label><label>Staff limit<input type="number" min="-1" value={draft.maxStaff} onChange={(event) => update("maxStaff", event.target.value)} required /></label>
      <label>Audit retention days<input type="number" min="1" max="3650" value={draft.auditRetentionDays} onChange={(event) => update("auditRetentionDays", event.target.value)} required /></label><label className="check-label"><input type="checkbox" checked={draft.isPublic} onChange={(event) => update("isPublic", event.target.checked)} /> Visible on public pricing</label>
    </div>
    <fieldset className="plan-entitlements"><legend>Capabilities</legend>{toggles.map(([key, label]) => <label className="check-label" key={key}><input type="checkbox" checked={Boolean(draft[key])} onChange={(event) => update(key, event.target.checked)} /> {label}</label>)}</fieldset>
    <div className="plan-editor-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={saving}><Save size={17} /> {saving ? "Publishing..." : "Publish plan"}</button></div>
  </form></section>;
}
