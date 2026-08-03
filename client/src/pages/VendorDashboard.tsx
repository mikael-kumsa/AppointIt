import React, { useCallback, useEffect, useRef, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Archive, BarChart3, Bell, Building2, CalendarDays, CalendarOff, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Coffee, Copy, CreditCard, Globe2, Image as ImageIcon, MapPin, MessageCircle, Pencil, Plus, RefreshCw, Settings, ShieldCheck, Stethoscope, Trash2, Users, Workflow, X } from "lucide-react";
import { addCustomDomain, api, changePassword, clearToken, createBranch, createBreakTime, createDashboardAppointment, createHoliday, createService, createStaff, createStaffInvite, createSubscriptionInvoice, deactivateBranch, deactivateService, deactivateStaff, deleteBranchPermanently, deleteBreakTime, deleteHoliday, deleteServicePermanently, deleteStaffPermanently, diagnoseAvailability, getAvailabilitySettings, getDomainSettings, getGoogleCalendarStatus, getMessagingSettings, getReportSummary, getSecuritySettings, getToken, getVendorProfile, listAppointments, listBranches, listCustomers, listPublicPlans, listServices, listStaff, listStaffInvites, logout, reactivateBranch, reactivateService, reactivateStaff, refreshCustomDomain, removeCustomDomain, removeStaffPhoto, removeVendorLogo, removeVendorPromoImage, replaceWorkingHours, sendTestSms, startGoogleCalendarConnection, updateBranch, updateCustomer, updateMessagingSettings, updateService, updateSmsTwoFactor, updateStaff, uploadStaffPhoto, uploadVendorLogo, uploadVendorPromoImage, type Appointment, type AvailabilityDiagnosis, type AvailabilitySettings, type Branch, type Customer, type DomainSettings, type GoogleCalendarStatus, type MessagingSettings, type ReportSummary, type SecuritySettings, type Service, type StaffInvite, type StaffMember, type SubscriptionPlan, type VendorProfile } from "../lib/api";
import { cancelAppointment, completeAppointment, markNoShowAppointment, rescheduleAppointment } from "../lib/api";
import { getAppointmentRules, revokeAppointmentManagement, updateAppointmentRules, type AppointmentRules } from "../lib/api";
import { getReminderSettings, listReminderSchedules, listVendorNotificationLogs, sendManualAppointmentReminder, updateReminderSettings, type ReminderSchedule, type ReminderSettings, type VendorNotificationLog } from "../lib/api";
import { deleteMessageTemplate, disconnectGoogleCalendar, getOverviewAnalytics, listActivityNotifications, listGoogleCalendars, listMessageTemplates, listTeamUsers, markActivityRead, markAllActivityRead, resendStaffInvite, resyncGoogleCalendar, retryGoogleCalendarSync, retryVendorNotification, revokeStaffInvite, saveMessageTemplate, subscribeToLiveEvents, updateGoogleCalendarConnection, updateTeamUser, updateVendorProfile, type ActivityNotification, type LiveConnectionStatus, type LiveResource, type MessageTemplate, type OverviewAnalytics, type TeamUser } from "../lib/api";
import { money } from "../lib/format";
import { bookingThemeById, bookingThemes, bookingThemeStyle, type BookingThemeId } from "../lib/bookingThemes";
import { Metric, StatusRow } from "../components/common";

type View = "dashboard" | "calendar" | "appointments" | "customers" | "staff" | "services" | "branches" | "reports" | "billing" | "settings";

export function VendorDashboard() {
  const [view, setView] = useState<View>("dashboard");
  const [authState, setAuthState] = useState<{ checked: boolean; vendorStatus?: string | null; name?: string; role?: string; error?: string }>({ checked: false });
  const [data, setData] = useState<{
    appointments: Appointment[];
    branches: Branch[];
    services: Service[];
    staff: StaffMember[];
    customers: Customer[];
    availability: AvailabilitySettings;
    vendor: VendorProfile | null;
  }>({
    appointments: [],
    branches: [],
    services: [],
    staff: [],
    customers: [],
    availability: { workingHours: [], breakTimes: [], holidays: [] },
    vendor: null
  });
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [liveStatus, setLiveStatus] = useState<LiveConnectionStatus>("disconnected");
  const [lastLiveUpdateAt, setLastLiveUpdateAt] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityNotification[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityToast, setActivityToast] = useState<ActivityNotification | null>(null);
  const [bookingSeedCustomer, setBookingSeedCustomer] = useState<Customer | null>(null);
  const latestActivityId = useRef<string | null>(null);
  const nav = [
    ["dashboard", Workflow, "Overview"],
    ["calendar", CalendarDays, "Calendar"],
    ["appointments", Clock, "Appointments"],
    ["customers", Users, "Customers"],
    ["staff", Stethoscope, "Staff"],
    ["services", CheckCircle2, "Services"],
    ["branches", Building2, "Branches"],
    ["reports", BarChart3, "Reports"],
    ["billing", CreditCard, "Billing"],
    ["settings", Settings, "Settings"]
  ] as const;
  const allowedNav = nav.filter(([id]) => {
    if (authState.role === "STAFF") return ["dashboard", "calendar", "appointments"].includes(id);
    if (authState.role === "RECEPTIONIST") return ["dashboard", "calendar", "appointments", "customers"].includes(id);
    return true;
  });

  async function loadDashboardData() {
    if (!getToken()) return;
    setDataLoading(true);
    setDataError("");
    try {
      const [appointments, branches, services, staff, customers, availability, vendor] = await Promise.all([
        listAppointments(),
        listBranches(),
        listServices(),
        listStaff(),
        listCustomers(),
        getAvailabilitySettings(),
        getVendorProfile()
      ]);
      setData({ appointments, branches, services, staff, customers, availability, vendor });
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Could not load your workspace");
    } finally {
      setDataLoading(false);
    }
  }

  const refreshResources = useCallback(async (resources: LiveResource[]) => {
    const unique = new Set(resources);
    const tasks: Promise<void>[] = [];
    if (unique.has("appointments")) tasks.push(listAppointments().then((appointments) => setData((current) => ({ ...current, appointments }))));
    if (unique.has("customers")) tasks.push(listCustomers().then((customers) => setData((current) => ({ ...current, customers }))));
    if (unique.has("staff") || unique.has("users")) tasks.push(listStaff().then((staff) => setData((current) => ({ ...current, staff }))));
    if (unique.has("services")) tasks.push(listServices().then((services) => setData((current) => ({ ...current, services }))));
    if (unique.has("branches")) tasks.push(listBranches().then((branches) => setData((current) => ({ ...current, branches }))));
    if (unique.has("availability")) tasks.push(getAvailabilitySettings().then((availability) => setData((current) => ({ ...current, availability }))));
    if (unique.has("vendor") || unique.has("billing") || unique.has("calendar") || unique.has("notifications")) tasks.push(getVendorProfile().then((vendor) => setData((current) => ({ ...current, vendor }))));
    await Promise.allSettled(tasks);
  }, []);

  const refreshActivity = useCallback(async (notify = false) => {
    const items = await listActivityNotifications();
    if (notify && latestActivityId.current && items[0] && items[0].id !== latestActivityId.current) {
      setActivityToast(items[0]);
      window.setTimeout(() => setActivityToast((current) => current?.id === items[0].id ? null : current), 5500);
    }
    latestActivityId.current = items[0]?.id ?? null;
    setActivity(items);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setAuthState({ checked: true });
      return;
    }
    api<{ name: string; role: string; vendorStatus?: string | null }>("/api/auth/me")
      .then((context) => setAuthState({ checked: true, vendorStatus: context.vendorStatus, name: context.name, role: context.role }))
      .catch((error) => setAuthState({ checked: true, error: error instanceof Error ? error.message : "Could not load session" }));
  }, []);

  useEffect(() => {
    if (!authState.checked || !getToken()) return;
    void refreshActivity();
    return subscribeToLiveEvents((resources) => {
      setLastLiveUpdateAt(new Date().toISOString());
      void refreshResources(resources);
      if (resources.includes("activity")) void refreshActivity(true);
    }, setLiveStatus);
  }, [authState.checked, refreshActivity, refreshResources]);

  useEffect(() => {
    if (!getToken()) return;
    void loadDashboardData();
  }, []);

  if (authState.checked && authState.vendorStatus && authState.vendorStatus !== "ACTIVE" && authState.vendorStatus !== "TRIAL") {
    return (
      <main className="signup-page">
        <section className="signup-card success">
          <Clock size={52} />
          <h1>Business pending activation</h1>
          <p>Verify the owner phone number to activate this workspace automatically. Current status: {authState.vendorStatus}.</p>
          <p className="muted-text">Sign out and sign in again to complete SMS phone verification.</p>
          <a className="primary" href="/admin">Open super admin review</a>
        </section>
      </main>
    );
  }

  const workspaceThemeStyle = bookingThemeStyle(bookingThemeById(data.vendor?.bookingTheme));

  return (
    <div className="app-shell" style={workspaceThemeStyle}>
      <aside className="sidebar">
        <div className="brand">
          <span className={data.vendor?.logoUrl ? "brand-logo" : ""}>{data.vendor?.logoUrl ? <img src={data.vendor.logoUrl} alt="" /> : "A"}</span>
          <div>
            <strong>{data.vendor?.name ?? "AppointIt"}</strong>
            <small>Vendor workspace</small>
          </div>
        </div>
        <nav>
          {allowedNav.map(([id, Icon, label]) => (
            <button className={view === id ? "active" : ""} key={id} onClick={() => setView(id)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="workspace-title">
            <p className="eyebrow">Vendor dashboard</p>
            <h1>{nav.find(([id]) => id === view)?.[2]}</h1>
            <span>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
          </div>
          <div className="top-actions">
            {authState.name && <span className="session-pill"><strong>{authState.name}</strong>{authState.role ? <small>{authState.role.replace("_", " ").toLowerCase()}</small> : null}</span>}
            <span className={`live-indicator ${liveStatus}`} title={lastLiveUpdateAt ? `Last update ${new Date(lastLiveUpdateAt).toLocaleTimeString()}` : "Waiting for live updates"}><i /> {liveStatus === "connected" ? "Live" : liveStatus === "connecting" ? "Reconnecting" : "Offline"}</span>
            <div className="activity-menu">
              <button className="icon-action activity-trigger" title="Activity" aria-label="Activity notifications" onClick={() => setActivityOpen((current) => !current)}><Bell size={19} />{activity.some((item) => !item.read) && <b>{Math.min(9, activity.filter((item) => !item.read).length)}</b>}</button>
              {activityOpen && <div className="activity-popover"><header><div><strong>Activity</strong><small>Bookings and schedule changes</small></div><button className="icon-action" title="Mark all as read" onClick={() => void markAllActivityRead().then(() => setActivity((items) => items.map((item) => ({ ...item, read: true }))))}><Check size={17} /></button></header><div className="activity-list">{activity.length === 0 && <p>No activity yet.</p>}{activity.map((item) => <button key={item.id} className={item.read ? "read" : ""} onClick={() => void markActivityRead(item.id).then(() => setActivity((items) => items.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry)))}><i /><span><strong>{item.title}</strong><small>{item.message}</small><time>{new Date(item.createdAt).toLocaleString()}</time></span></button>)}</div></div>}
            </div>
            {authState.role === "SUPER_ADMIN" && <a className="secondary" href="/admin">Super admin view</a>}
            {data.vendor?.slug && <a className="book-link" href={data.vendor.customDomains?.find((domain) => domain.status === "ACTIVE") ? `https://${data.vendor.customDomains.find((domain) => domain.status === "ACTIVE")!.hostname}` : `/book/${data.vendor.slug}`}>Public booking page</a>}
            {getToken() && <button className="secondary" onClick={() => { void logout().finally(() => { clearToken(); location.href = "/"; }); }}>Logout</button>}
          </div>
        </header>
        {dataLoading && <section className="panel workspace-state" aria-live="polite"><span className="loading-line" /><strong>Loading your workspace</strong><p>Fetching appointments, staff, services, and availability...</p></section>}
        {!dataLoading && dataError && <section className="panel workspace-state error-state"><strong>We could not load your workspace</strong><p>{dataError}</p><button className="primary" onClick={() => void loadDashboardData()}>Try again</button></section>}
        {!dataLoading && !dataError && view === "dashboard" && <Overview data={data} onNavigate={setView} />}
        {!dataLoading && !dataError && view === "calendar" && <CalendarView appointments={data.appointments} staff={data.staff} branches={data.branches} />}
        {!dataLoading && !dataError && view === "appointments" && <Appointments appointments={data.appointments} branches={data.branches} services={data.services} staff={data.staff} customers={data.customers} role={authState.role} initialCustomer={bookingSeedCustomer} onSeedConsumed={() => setBookingSeedCustomer(null)} onChanged={() => refreshResources(["appointments", "customers"])} />}
        {!dataLoading && !dataError && view === "customers" && <Customers customers={data.customers} onBookAgain={(customer) => { setBookingSeedCustomer(customer); setView("appointments"); }} onChanged={() => refreshResources(["customers"])} />}
        {!dataLoading && !dataError && view === "staff" && <Staff staff={data.staff} branches={data.branches} services={data.services} onChanged={() => refreshResources(["staff", "vendor"])} />}
        {!dataLoading && !dataError && view === "services" && <Services services={data.services} onChanged={() => refreshResources(["services", "vendor"])} />}
        {!dataLoading && !dataError && view === "branches" && <Branches branches={data.branches} onChanged={() => refreshResources(["branches", "vendor"])} />}
        {!dataLoading && !dataError && view === "reports" && <Reports />}
        {!dataLoading && !dataError && view === "billing" && <Billing vendor={data.vendor} />}
        {!dataLoading && !dataError && view === "settings" && <SettingsView vendor={data.vendor} availability={data.availability} branches={data.branches} staff={data.staff} onChanged={() => refreshResources(["vendor", "availability", "staff", "branches"])} />}
      </main>
      {activityToast && <div className="activity-toast" role="status"><Bell size={19} /><div><strong>{activityToast.title}</strong><span>{activityToast.message}</span></div><button className="icon-action" aria-label="Dismiss notification" onClick={() => setActivityToast(null)}><X size={16} /></button></div>}
    </div>
  );
}

function Overview({ data, onNavigate }: {
  data: {
    appointments: Appointment[];
    branches: Branch[];
    services: Service[];
    staff: StaffMember[];
    customers: Customer[];
    availability: AvailabilitySettings;
    vendor: VendorProfile | null;
  };
  onNavigate: (view: View) => void;
}) {
  const { appointments } = data;
  const [range, setRange] = useState(30);
  const [analytics, setAnalytics] = useState<OverviewAnalytics | null>(null);
  const loadAnalytics = useCallback(() => getOverviewAnalytics(range).then(setAnalytics), [range]);
  useEffect(() => { void loadAnalytics(); return subscribeToLiveEvents((resources) => { if (resources.includes("appointments")) void loadAnalytics(); }); }, [loadAnalytics]);
  const revenue = appointments.filter((item) => item.status === "COMPLETED").reduce((sum, item) => sum + item.service.priceCents, 0);
  const todayCount = appointments.filter((item) => new Date(item.startAt).toDateString() === new Date().toDateString()).length;
  const upcomingAppointments = appointments.filter((item) => new Date(item.startAt) > new Date() && !["CANCELLED", "NO_SHOW"].includes(item.status)).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const nextAppointment = upcomingAppointments[0];
  return (
    <>
      <section className="overview-hero">
        <div>
          <p className="eyebrow">Operations command</p>
          <h2>{todayCount ? `${todayCount} appointment${todayCount === 1 ? "" : "s"} on deck today` : "No appointments booked for today"}</h2>
          <span>{nextAppointment ? `Next: ${nextAppointment.customer.name} for ${nextAppointment.service.name} at ${new Date(nextAppointment.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Use the receptionist booking panel to create the next visit."}</span>
        </div>
        <div className="overview-hero-actions">
          <button className="primary" onClick={() => onNavigate("appointments")}><Plus size={17} /> New appointment</button>
          <button className="secondary" onClick={() => onNavigate("calendar")}><CalendarDays size={17} /> View calendar</button>
          <button className="secondary" onClick={() => onNavigate("settings")}><Settings size={17} /> Settings</button>
        </div>
      </section>
      <section className="overview-priority-grid">
        <div className="panel upcoming-priority-panel">
          <div className="panel-head"><div><p className="eyebrow">Next in line</p><h2>Upcoming appointments</h2></div><button className="secondary" onClick={() => onNavigate("appointments")}>Manage schedule</button></div>
          <AppointmentRows appointments={upcomingAppointments} compact />
        </div>
        <div className="panel integration-priority-panel">
          <div className="panel-head"><div><p className="eyebrow">Readiness</p><h2>Operations health</h2></div></div>
          <StatusRow icon={<MessageCircle size={18} />} label="SMS reminders" status={data.vendor?.messageSettings?.smsEnabled ? "Enabled" : "Disabled"} />
          <StatusRow icon={<MessageCircle size={18} />} label="SMS credentials" status={data.vendor?.messageSettings?.encryptedSmsGatewayApiKey ? "Configured" : "Not configured"} />
          <StatusRow icon={<Building2 size={18} />} label="Active branches" status={String(data.branches.filter((item) => item.active !== false).length)} />
        </div>
      </section>
      <SetupProgress data={data} onNavigate={onNavigate} />
      <section className="metrics">
        <Metric label="Today" value={String(todayCount)} detail="scheduled visits" />
        <Metric label="Completion" value={appointments.length ? `${Math.round(appointments.filter((item) => item.status === "COMPLETED").length / appointments.length * 100)}%` : "0%"} detail="visible appointments" />
        <Metric label="No-shows" value={String(appointments.filter((item) => item.status === "NO_SHOW").length)} detail="visible records" />
        <Metric label="Revenue estimate" value={money(revenue)} detail="completed services" />
      </section>
      <section className="analytics-section">
        <div className="analytics-heading"><div><p className="eyebrow">Performance pulse</p><h2>Booking activity</h2></div><select aria-label="Chart date range" value={range} onChange={(event) => setRange(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></div>
        <div className="analytics-grid">
          <article className="panel chart-panel"><div><strong>Appointments</strong><small>Daily bookings and completions</small></div><div className="chart-frame">{analytics && <ResponsiveContainer width="100%" height="100%"><AreaChart data={analytics.daily}><defs><linearGradient id="bookingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.32}/><stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e9e6"/><XAxis dataKey="date" tickFormatter={(value) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} tickLine={false} axisLine={false} minTickGap={24}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28}/><Tooltip labelFormatter={(value) => new Date(`${value}T00:00:00`).toLocaleDateString()} /><Area type="monotone" dataKey="total" name="Bookings" stroke="var(--primary)" strokeWidth={2.5} fill="url(#bookingFill)"/><Area type="monotone" dataKey="completed" name="Completed" stroke="#20a56b" strokeWidth={2} fill="transparent"/></AreaChart></ResponsiveContainer>}</div></article>
          <article className="panel chart-panel"><div><strong>Service demand</strong><small>Most-booked services in this period</small></div><div className="chart-frame">{analytics && <ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.popularServices} layout="vertical" margin={{ left: 8, right: 16 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e9e6"/><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false}/><YAxis type="category" dataKey="name" width={105} tickLine={false} axisLine={false}/><Tooltip/><Bar dataKey="count" name="Bookings" fill="var(--primary)" radius={[0, 4, 4, 0]}/></BarChart></ResponsiveContainer>}</div></article>
        </div>
      </section>
    </>
  );
}

function SetupProgress({ data, onNavigate }: {
  data: { branches: Branch[]; services: Service[]; staff: StaffMember[]; customers: Customer[]; availability: AvailabilitySettings; vendor: VendorProfile | null };
  onNavigate: (view: View) => void;
}) {
  const activeBranches = data.branches.filter((item) => item.active !== false).length;
  const activeServices = data.services.filter((item) => item.active !== false).length;
  const activeStaff = data.staff.filter((item) => item.active !== false).length;
  const items: Array<{ label: string; detail: string; done: boolean; view: View }> = [
    { label: "Paid subscription active", detail: data.vendor?.subscription?.planVersion.plan.name ?? "Choose and activate a paid plan", done: data.vendor?.subscription?.status === "ACTIVE", view: "billing" },
    { label: "Owner phone verified", detail: "Required before vendor activation", done: Boolean(data.vendor?.phoneVerifiedAt), view: "settings" },
    { label: "Branding added", detail: "Logo and booking theme make the page feel trusted", done: Boolean(data.vendor?.logoUrl && data.vendor?.bookingTheme), view: "settings" },
    { label: "Location ready", detail: `${activeBranches} active branch${activeBranches === 1 ? "" : "es"}`, done: activeBranches > 0, view: "branches" },
    { label: "Services published", detail: `${activeServices} active service${activeServices === 1 ? "" : "s"}`, done: activeServices > 0, view: "services" },
    { label: "Providers assigned", detail: `${activeStaff} active provider${activeStaff === 1 ? "" : "s"}`, done: activeStaff > 0, view: "staff" },
    { label: "Opening hours set", detail: "Vendor, branch, or staff hours are required for booking", done: data.availability.workingHours.length > 0, view: "settings" },
    { label: "SMS reminders ready", detail: "Token saved and reminders enabled", done: Boolean(data.vendor?.messageSettings?.smsEnabled && data.vendor.messageSettings.encryptedSmsGatewayApiKey), view: "settings" },
    { label: "First customer captured", detail: `${data.customers.length} customer${data.customers.length === 1 ? "" : "s"} in this workspace`, done: data.customers.length > 0, view: "customers" }
  ];
  const complete = items.filter((item) => item.done).length;
  const percentage = Math.round((complete / items.length) * 100);
  if (complete === items.length) return null;

  return (
    <section className="setup-progress-panel">
      <div className="setup-progress-copy">
        <span>Finish your setup</span>
        <strong>{complete} of {items.length} launch checks complete</strong>
        <p>Complete the remaining checks before sending real traffic to the booking page.</p>
        <div className="setup-progress-track"><i style={{ width: `${percentage}%` }} /></div>
      </div>
      <div className="setup-progress-items">
        {items.map((item) => <button key={item.label} className={item.done ? "done" : ""} onClick={() => onNavigate(item.view)}><CheckCircle2 size={17} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}
      </div>
    </section>
  );
}

function CalendarView({ appointments, staff, branches }: { appointments: Appointment[]; staff: StaffMember[]; branches: Branch[] }) {
  const [mode, setMode] = useState<"day" | "week" | "month">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [staffId, setStaffId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState("");
  const [rangeAppointments, setRangeAppointments] = useState(appointments);
  const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const start = dayStart(anchor);
  if (mode === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (mode === "month") start.setDate(1);
  const days = mode === "day" ? [new Date(start)] : mode === "week" ? Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)) : Array.from({ length: new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate() }, (_, index) => new Date(start.getFullYear(), start.getMonth(), index + 1));
  useEffect(() => {
    const rangeStart = new Date(days[0]); rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(days[days.length - 1]); rangeEnd.setHours(23, 59, 59, 999);
    void listAppointments({ from: rangeStart.toISOString(), to: rangeEnd.toISOString(), pageSize: 200 }).then(setRangeAppointments);
  }, [mode, anchor, appointments]);
  const move = (direction: number) => setAnchor((current) => { const next = new Date(current); if (mode === "day") next.setDate(next.getDate() + direction); if (mode === "week") next.setDate(next.getDate() + direction * 7); if (mode === "month") next.setMonth(next.getMonth() + direction); return next; });
  const visible = rangeAppointments.filter((item) => (!staffId || item.staff.id === staffId) && (!branchId || item.branch.id === branchId) && (!status || item.status === status));
  return (
    <div className="panel real-calendar">
      <div className="panel-head">
        <div><h2>{mode === "month" ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : `${days[0].toLocaleDateString()}${days.length > 1 ? ` - ${days[days.length - 1].toLocaleDateString()}` : ""}`}</h2><div className="calendar-nav"><button className="icon-action" onClick={() => move(-1)} aria-label="Previous period"><ChevronLeft size={17} /></button><button className="secondary" onClick={() => setAnchor(new Date())}>Today</button><button className="icon-action" onClick={() => move(1)} aria-label="Next period"><ChevronRight size={17} /></button></div></div>
        <div className="calendar-modes">{(["day", "week", "month"] as const).map((item) => <button className={mode === item ? "active" : ""} onClick={() => setMode(item)} key={item}>{item}</button>)}</div>
      </div>
      <div className="calendar-filters"><select value={staffId} onChange={(event) => setStaffId(event.target.value)}><option value="">All staff</option>{staff.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All branches</option>{branches.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"].map((item) => <option key={item}>{item}</option>)}</select></div>
      <div className={`calendar-period ${mode}`}>
        {days.map((date) => {
          const items = visible.filter((item) => new Date(item.startAt).toDateString() === date.toDateString()).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
          return <section className={`calendar-day${date.toDateString() === new Date().toDateString() ? " today" : ""}`} key={date.toISOString()}><header><span>{date.toLocaleDateString(undefined, { weekday: "short" })}</span><strong>{date.getDate()}</strong></header><div>{items.length === 0 && <small className="calendar-empty">No appointments</small>}{items.map((item) => <article className={`calendar-event status-${item.status.toLowerCase()}`} key={item.id}><time>{new Date(item.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><strong>{item.customer.name}</strong><span>{item.service.name} - {item.staff.name}</span></article>)}</div></section>;
        })}
      </div>
    </div>
  );
}

function Appointments({ appointments, branches, services, staff, customers, role, initialCustomer, onSeedConsumed, onChanged }: { appointments: Appointment[]; branches: Branch[]; services: Service[]; staff: StaffMember[]; customers: Customer[]; role?: string; initialCustomer?: Customer | null; onSeedConsumed?: () => void; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [visibleAppointments, setVisibleAppointments] = useState(appointments);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setVisibleAppointments(appointments), [appointments]);
  async function searchAppointments(nextPage = 1) { try { const rows = await listAppointments({ q: search || undefined, status: statusFilter || undefined, page: nextPage, pageSize: 50 }); setVisibleAppointments(rows); setPage(nextPage); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not search appointments"); } }
  const activeBranches = branches.filter((item) => item.active !== false);
  const activeServices = services.filter((item) => item.active !== false);
  const [branchId, setBranchId] = useState(activeBranches[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(activeServices[0]?.id ?? "");
  const todayInput = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const [bookingDate, setBookingDate] = useState(todayInput);
  const [staffId, setStaffId] = useState("");
  const [customStartAt, setCustomStartAt] = useState("");
  const [diagnosis, setDiagnosis] = useState<AvailabilityDiagnosis | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerDraft, setCustomerDraft] = useState({ name: "", phone: "", email: "", smsOptIn: false });
  const eligibleStaff = staff.filter((member) => member.active !== false && (!member.branchId || member.branchId === branchId) && member.services?.some((service) => service.serviceId === serviceId));
  const minimumDate = new Date(Date.now() + 60_000);
  const minimumLocalStart = new Date(minimumDate.getTime() - minimumDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const normalizedQuery = customerQuery.trim().toLowerCase();
  const matchingCustomers = normalizedQuery
    ? customers.filter((customer) => [customer.name, customer.phone, customer.email ?? ""].some((value) => value.toLowerCase().includes(normalizedQuery))).slice(0, 5)
    : customers.slice(0, 5);

  useEffect(() => {
    if (!activeBranches.some((branch) => branch.id === branchId)) setBranchId(activeBranches[0]?.id ?? "");
  }, [activeBranches, branchId]);
  useEffect(() => {
    if (!activeServices.some((service) => service.id === serviceId)) setServiceId(activeServices[0]?.id ?? "");
  }, [activeServices, serviceId]);
  useEffect(() => {
    if (staffId && !eligibleStaff.some((member) => member.id === staffId)) setStaffId("");
  }, [eligibleStaff, staffId]);

  function toLocalInput(value: string) {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }

  function normalizePhoneInput(value: string) {
    const trimmed = value.trim();
    const digits = trimmed.replace(/[^\d]/g, "");
    if (digits.startsWith("251") && digits.length >= 12) return `+${digits}`;
    if (digits.startsWith("0") && digits.length === 10) return `+251${digits.slice(1)}`;
    if (digits.startsWith("9") && digits.length === 9) return `+251${digits}`;
    if (trimmed.startsWith("+")) return `+${digits}`;
    return trimmed;
  }

  function chooseCustomer(customer: Customer) {
    setSelectedCustomerId(customer.id);
    setCustomerQuery(`${customer.name} ${customer.phone}`);
    setCustomerDraft({ name: customer.name, phone: customer.phone, email: customer.email ?? "", smsOptIn: customer.smsOptIn });
  }

  function clearCustomer() {
    setSelectedCustomerId("");
    setCustomerQuery("");
    setCustomerDraft({ name: "", phone: "", email: "", smsOptIn: false });
  }

  useEffect(() => {
    if (!initialCustomer) return;
    chooseCustomer(initialCustomer);
    setMessage(`Ready to book another appointment for ${initialCustomer.name}.`);
    onSeedConsumed?.();
  }, [initialCustomer, onSeedConsumed]);

  useEffect(() => {
    let cancelled = false;
    if (!branchId || !serviceId || !bookingDate) {
      setDiagnosis(null);
      return;
    }
    setSlotsLoading(true);
    diagnoseAvailability({ branchId, serviceId, date: bookingDate, staffId: staffId || undefined })
      .then((result) => {
        if (cancelled) return;
        setDiagnosis(result);
        if (!customStartAt && result.slots[0]) setCustomStartAt(toLocalInput(result.slots[0].startAt));
      })
      .catch((error) => {
        if (!cancelled) {
          setDiagnosis({ date: bookingDate, timezone: "UTC", qualifiedStaffCount: 0, slots: [], staff: [], reasons: [{ code: "diagnostic_failed", title: "Could not check availability", detail: error instanceof Error ? error.message : "Try again." }] });
        }
      })
      .finally(() => { if (!cancelled) setSlotsLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, serviceId, bookingDate, staffId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    try {
      await createDashboardAppointment({
        branchId,
        serviceId,
        staffId: staffId || undefined,
        startAt: new Date(customStartAt).toISOString(),
        notes: String(form.get("notes")) || undefined,
        customer: {
          name: customerDraft.name,
          phone: normalizePhoneInput(customerDraft.phone),
          email: customerDraft.email || undefined,
          smsOptIn: customerDraft.smsOptIn,
        }
      });
      formElement.reset();
      setCustomStartAt("");
      clearCustomer();
      await onChanged();
      setMessage("Appointment created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create appointment");
    }
  }

  return (
    <div className="panel-grid manage-grid">
      <div className="panel">
        <div className="panel-head"><h2>Appointments</h2><span className="badge confirmed">{appointments.length} total</span></div>
        {message && <p className="form-message" role="status">{message}</p>}
        <form className="data-search-bar" onSubmit={(event) => { event.preventDefault(); void searchAppointments(1); }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, phone, service, or staff" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{["PENDING", "CONFIRMED", "RESCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"].map((item) => <option key={item}>{item}</option>)}</select><button className="secondary">Search</button></form>
        <AppointmentRows appointments={visibleAppointments} staff={staff} role={role} onChanged={onChanged} onMessage={setMessage} />
        <div className="pagination-controls"><button className="secondary" disabled={page === 1} onClick={() => void searchAppointments(page - 1)}>Previous</button><span>Page {page}</span><button className="secondary" disabled={visibleAppointments.length < 50} onClick={() => void searchAppointments(page + 1)}>Next</button></div>
      </div>
      <div className="panel receptionist-panel">
        <div className="panel-head"><div><h2>Receptionist booking</h2><p className="muted-text">Find a real opening first, then collect customer details.</p></div><span className="badge active">{diagnosis?.slots.length ?? 0} slots</span></div>
        {message && <p className="form-message">{message}</p>}
        <form className="compact-form" onSubmit={submit}>
          <div className="booking-finder">
            <label>Branch<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setCustomStartAt(""); }} required>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label>Service<select value={serviceId} onChange={(event) => { setServiceId(event.target.value); setCustomStartAt(""); }} required>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
            <label>Date<input type="date" min={todayInput} value={bookingDate} onChange={(event) => { setBookingDate(event.target.value); setCustomStartAt(""); }} required /></label>
            <label>Provider<select value={staffId} onChange={(event) => { setStaffId(event.target.value); setCustomStartAt(""); }}><option value="">Any available staff</option>{eligibleStaff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </div>
          <AvailabilityDiagnostic diagnosis={diagnosis} loading={slotsLoading} selectedStartAt={customStartAt} onSelect={(slot) => { setStaffId(slot.staffId); setCustomStartAt(toLocalInput(slot.startAt)); }} />
          <label>Selected time<input value={customStartAt} onChange={(event) => setCustomStartAt(event.target.value)} type="datetime-local" min={minimumLocalStart} required /></label>
          <div className="customer-picker">
            <label>Find customer<input value={customerQuery} onChange={(event) => { setCustomerQuery(event.target.value); setSelectedCustomerId(""); }} placeholder="Search name, phone, or email" /></label>
            {customerQuery && <div className="customer-picker-results">
              {matchingCustomers.length === 0 ? <span>No matching customer. Continue as new.</span> : matchingCustomers.map((customer) => <button type="button" key={customer.id} className={selectedCustomerId === customer.id ? "selected" : ""} onClick={() => chooseCustomer(customer)}><strong>{customer.name}</strong><small>{customer.phone}{customer.email ? ` - ${customer.email}` : ""}</small></button>)}
              {selectedCustomerId && <button type="button" className="secondary" onClick={clearCustomer}>Clear selected customer</button>}
            </div>}
          </div>
          <input value={customerDraft.name} onChange={(event) => setCustomerDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Customer name" required />
          <input value={customerDraft.phone} onChange={(event) => setCustomerDraft((current) => ({ ...current, phone: event.target.value }))} onBlur={(event) => setCustomerDraft((current) => ({ ...current, phone: normalizePhoneInput(event.target.value) }))} placeholder="+2519..." required />
          <input value={customerDraft.email} onChange={(event) => setCustomerDraft((current) => ({ ...current, email: event.target.value }))} placeholder="Email optional" type="email" />
          <label className="consent-check"><input type="checkbox" checked={customerDraft.smsOptIn} onChange={(event) => setCustomerDraft((current) => ({ ...current, smsOptIn: event.target.checked }))} /><span><strong>Customer approved SMS updates</strong><small>Required for SMS reminders.</small></span></label>
          <input name="notes" placeholder="Notes optional" />
          <button className="primary" disabled={!customStartAt || activeBranches.length === 0 || activeServices.length === 0}>Create appointment</button>
        </form>
      </div>
    </div>
  );
}

function AvailabilityDiagnostic({ diagnosis, loading, selectedStartAt, onSelect }: { diagnosis: AvailabilityDiagnosis | null; loading: boolean; selectedStartAt: string; onSelect: (slot: { startAt: string; staffId: string }) => void }) {
  if (loading) return <div className="availability-diagnostic loading"><span className="loading-line" /><strong>Checking available openings...</strong></div>;
  if (!diagnosis) return <div className="availability-diagnostic"><Clock size={18} /><strong>Select a branch, service, and date.</strong></div>;
  if (diagnosis.slots.length > 0) {
    return (
      <div className="availability-diagnostic">
        <div className="diagnostic-head"><div><strong>Suggested openings</strong><small>{diagnosis.qualifiedStaffCount} matching provider{diagnosis.qualifiedStaffCount === 1 ? "" : "s"}</small></div><span>{diagnosis.timezone}</span></div>
        <div className="dashboard-slot-list">
          {diagnosis.slots.slice(0, 12).map((slot) => {
            const selected = selectedStartAt === new Date(new Date(slot.startAt).getTime() - new Date(slot.startAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
            return <button type="button" key={`${slot.startAt}-${slot.staffId}`} className={selected ? "selected" : ""} onClick={() => onSelect(slot)}>{new Date(slot.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</button>;
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="availability-diagnostic blocked">
      <div className="diagnostic-head"><div><strong>No bookable openings</strong><small>Here is what is blocking this date.</small></div><AlertTriangle size={19} /></div>
      {diagnosis.reasons.length === 0 ? <p className="muted-text">No staff member has a free slot that fits the selected service duration and buffers.</p> : diagnosis.reasons.map((reason) => <article key={`${reason.code}-${reason.detail}`}><strong>{reason.title}</strong><span>{reason.detail}</span></article>)}
      {diagnosis.staff.length > 0 && <div className="staff-diagnostic-list">{diagnosis.staff.map((member) => <span key={member.id}><b>{member.name}</b>{member.blockers.length ? member.blockers.join(", ") : "No open slots"}</span>)}</div>}
    </div>
  );
}

function AppointmentRows({ appointments, staff = [], compact = false, role, onChanged, onMessage }: { appointments: Appointment[]; staff?: StaffMember[]; compact?: boolean; role?: string; onChanged?: () => Promise<void>; onMessage?: (message: string) => void }) {
  const [selected, setSelected] = useState<Appointment | null>(null);
  const canManageSchedule = role !== "STAFF";
  const canSendReminder = role === "VENDOR_ADMIN" || role === "RECEPTIONIST";
  async function runAction(action: () => Promise<unknown>, success: string) {
    if (!onChanged || !onMessage) return;
    try {
      await action();
      await onChanged();
      onMessage(success);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Action failed");
    }
  }

  function reminderSummary(item: Appointment) {
    const schedules = item.reminderSchedules ?? [];
    const active = schedules.find((schedule) => ["SCHEDULED", "QUEUED"].includes(schedule.status));
    const failed = schedules.find((schedule) => schedule.status === "FAILED");
    const skipped = schedules.find((schedule) => schedule.status === "SKIPPED");
    const sent = schedules.find((schedule) => schedule.status === "SENT");
    const current = failed ?? active ?? skipped ?? sent;
    if (!current) return { label: "No reminder record", className: "muted", detail: "Save reminder schedule to create records" };
    if (current.status === "SCHEDULED") return { label: "SMS scheduled", className: "scheduled", detail: new Date(current.scheduledFor).toLocaleString() };
    if (current.status === "QUEUED") return { label: "SMS queued", className: "queued", detail: new Date(current.scheduledFor).toLocaleString() };
    if (current.status === "SENT") return { label: "SMS sent", className: "sent", detail: current.notificationLog?.providerMessageId || "Accepted by provider" };
    if (current.status === "FAILED") return { label: "SMS failed", className: "failed", detail: current.lastError || current.notificationLog?.errorMessage || "Retry from notifications" };
    return { label: "SMS skipped", className: "skipped", detail: current.skipReason || "Not eligible" };
  }

  async function reschedule(item: Appointment, form: HTMLFormElement) {
    const data = new FormData(form);
    await runAction(
      () => rescheduleAppointment(item.id, {
        startAt: new Date(String(data.get("startAt"))).toISOString(),
        staffId: String(data.get("staffId")) || undefined
      }),
      "Appointment rescheduled."
    );
    form.reset();
  }

  async function sendReminder(item: Appointment) {
    if (!onChanged || !onMessage) return;
    try {
      const result = await sendManualAppointmentReminder(item.id);
      await onChanged();
      onMessage(`Reminder queued via ${result.channels.join(" and ")}.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not send reminder");
    }
  }

  return (
    <div className="rows">
      {appointments.length === 0 && <div className="empty-state compact-empty"><strong>No upcoming appointments</strong><span>New customer bookings and receptionist-created appointments will appear here.</span></div>}
      {appointments.slice(0, compact ? 3 : appointments.length).map((item) => {
        const terminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(item.status);
        const minimumDate = new Date(Date.now() + 60_000);
        const minimumLocalStart = new Date(minimumDate.getTime() - minimumDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
        return (
        <div className="appointment-row" key={item.id}>
          <div className="row">
            <div><strong>{item.customer.name}</strong><small>{item.customer.phone}</small></div>
            <div><span>{item.service.name}</span><small>{item.staff.name}</small></div>
            <div><span>{new Date(item.startAt).toLocaleString()}</span><small>{item.branch.name}</small></div>
            <span className={`badge ${item.status.toLowerCase()}`}>{item.status}</span>
          </div>
          {!compact && <div className={`appointment-reminder-chip ${reminderSummary(item).className}`}><Bell size={14} /><strong>{reminderSummary(item).label}</strong><span>{reminderSummary(item).detail}</span></div>}
          {!compact && onChanged && onMessage && (
            <div className="appointment-actions">
              <button onClick={() => setSelected(item)}>Details</button>
              <button disabled={terminal} onClick={() => void runAction(() => completeAppointment(item.id), "Appointment marked completed.")}>Complete</button>
              <button disabled={terminal} onClick={() => void runAction(() => markNoShowAppointment(item.id), "Appointment marked no-show.")}>No-show</button>
              {canManageSchedule && <button disabled={terminal} onClick={() => void runAction(() => cancelAppointment(item.id, "Cancelled from dashboard"), "Appointment cancelled.")}>Cancel</button>}
              {canManageSchedule && <button onClick={() => void runAction(() => revokeAppointmentManagement(item.id), "Customer management links revoked.")}>Revoke client link</button>}
              {canSendReminder && <button disabled={terminal || new Date(item.startAt) <= new Date()} onClick={() => void sendReminder(item)}>Send SMS reminder</button>}
              {canManageSchedule && <form onSubmit={(event) => { event.preventDefault(); void reschedule(item, event.currentTarget); }}>
                <input name="startAt" type="datetime-local" min={minimumLocalStart} disabled={terminal} required />
                <select name="staffId"><option value="">Same staff</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
                <button disabled={terminal}>Reschedule</button>
              </form>}
              {item.history && item.history.length > 0 && <small>Last: {item.history[0].action} at {new Date(item.history[0].createdAt).toLocaleString()}</small>}
            </div>
          )}
        </div>
      );})}
      {selected && <AppointmentDetailDrawer appointment={selected} staff={staff} role={role} onClose={() => setSelected(null)} onChanged={onChanged} onMessage={onMessage} />}
    </div>
  );
}

function AppointmentDetailDrawer({ appointment, staff, role, onClose, onChanged, onMessage }: { appointment: Appointment; staff: StaffMember[]; role?: string; onClose: () => void; onChanged?: () => Promise<void>; onMessage?: (message: string) => void }) {
  const terminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status);
  const minimumDate = new Date(Date.now() + 60_000);
  const minimumLocalStart = new Date(minimumDate.getTime() - minimumDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const canManageSchedule = role !== "STAFF";
  const canSendReminder = role === "VENDOR_ADMIN" || role === "RECEPTIONIST";
  async function run(action: () => Promise<unknown>, success: string) {
    if (!onChanged || !onMessage) return;
    try {
      await action();
      await onChanged();
      onMessage(success);
      onClose();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Action failed");
    }
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="profile-modal appointment-detail-modal">
        <div className="panel-head">
          <div><p className="eyebrow">Appointment details</p><h2>{appointment.customer.name}</h2><p className="muted-text">{appointment.service.name} with {appointment.staff.name}</p></div>
          <button className="icon-action" aria-label="Close appointment details" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="appointment-detail-grid">
          <article><strong>Customer</strong><span>{appointment.customer.phone}</span></article>
          <article><strong>When</strong><span>{new Date(appointment.startAt).toLocaleString()}</span></article>
          <article><strong>Branch</strong><span>{appointment.branch.name}</span></article>
          <article><strong>Status</strong><span className={`badge ${appointment.status.toLowerCase()}`}>{appointment.status}</span></article>
        </div>
        <section className="appointment-detail-section">
          <h3>SMS reminders</h3>
          {(appointment.reminderSchedules ?? []).length === 0 ? <p className="muted-text">No reminder records for this appointment yet.</p> : appointment.reminderSchedules!.map((item) => <div className="reminder-schedule-row" key={item.id}><span className={`status-dot ${item.status.toLowerCase()}`} /><div><strong>{item.status}</strong><small>{item.type.replaceAll("_", " ")} - {new Date(item.scheduledFor).toLocaleString()}</small>{(item.skipReason || item.lastError || item.notificationLog?.errorMessage) && <em>{item.skipReason || item.lastError || item.notificationLog?.errorMessage}</em>}</div><span>{item.channel}</span><time>{item.notificationLog?.providerMessageId ?? ""}</time></div>)}
        </section>
        <section className="appointment-detail-section">
          <h3>History</h3>
          {appointment.history?.length ? appointment.history.map((item) => <div className="history-row" key={item.id}><strong>{item.action}</strong><time>{new Date(item.createdAt).toLocaleString()}</time></div>) : <p className="muted-text">No history yet.</p>}
        </section>
        {onChanged && onMessage && <div className="appointment-detail-actions">
          <button disabled={terminal} onClick={() => void run(() => completeAppointment(appointment.id), "Appointment marked completed.")}>Complete</button>
          <button disabled={terminal} onClick={() => void run(() => markNoShowAppointment(appointment.id), "Appointment marked no-show.")}>No-show</button>
          {canManageSchedule && <button disabled={terminal} onClick={() => void run(() => cancelAppointment(appointment.id, "Cancelled from dashboard"), "Appointment cancelled.")}>Cancel</button>}
          {canSendReminder && <button disabled={terminal || new Date(appointment.startAt) <= new Date()} onClick={() => void run(() => sendManualAppointmentReminder(appointment.id), "SMS reminder queued.")}>Send SMS reminder</button>}
        </div>}
        {onChanged && onMessage && canManageSchedule && <form className="compact-form appointment-detail-reschedule" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => rescheduleAppointment(appointment.id, { startAt: new Date(String(form.get("startAt"))).toISOString(), staffId: String(form.get("staffId")) || undefined }), "Appointment rescheduled."); }}>
          <label>New date and time<input name="startAt" type="datetime-local" min={minimumLocalStart} disabled={terminal} required /></label>
          <label>Provider<select name="staffId" disabled={terminal}><option value="">Same staff</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <button className="primary" disabled={terminal}>Reschedule appointment</button>
        </form>}
      </section>
    </div>
  );
}

function Customers({ customers, onBookAgain, onChanged }: { customers: Customer[]; onBookAgain: (customer: Customer) => void; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [visibleCustomers, setVisibleCustomers] = useState(customers);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setVisibleCustomers(customers), [customers]);
  async function runSearch(nextPage = 1) { try { const rows = await listCustomers({ q: search || undefined, page: nextPage, pageSize: 50 }); setVisibleCustomers(rows); setPage(nextPage); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not search customers"); } }
  async function save(event: React.FormEvent<HTMLFormElement>, customerId: string) { event.preventDefault(); const form = new FormData(event.currentTarget); try { await updateCustomer(customerId, { name: String(form.get("name")), phone: String(form.get("phone")), email: String(form.get("email")) || null, notes: String(form.get("notes")), smsOptIn: form.get("smsOptIn") === "on" }); await onChanged(); setMessage("Customer updated."); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update customer"); } }
  return <div className="panel customer-workspace">
    <div className="panel-head"><div><h2>Customers</h2><p className="muted-text">Profiles, notes, consent, history, and quick rebooking.</p></div><span className="badge active">{customers.length} loaded</span></div>
    {message && <p className="form-message">{message}</p>}
    <form className="data-search-bar" onSubmit={(event) => { event.preventDefault(); void runSearch(1); }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, or email" /><button className="secondary">Search</button></form>
    {visibleCustomers.length === 0 && <div className="empty-state"><strong>No customers found</strong><span>Try another search or wait for the first booking.</span></div>}
    <div className="customer-profile-grid">
      {visibleCustomers.map((customer) => {
        const visits = customer.appointments ?? [];
        const lastVisit = visits[0];
        const completedVisits = visits.filter((item) => item.status === "COMPLETED").length;
        return <details className="customer-profile-card" key={customer.id}>
          <summary>
            <div className="customer-avatar">{customer.name.slice(0, 1).toUpperCase()}</div>
            <div><strong>{customer.name}</strong><span>{customer.phone}</span><small>{customer.email || "No email saved"}</small></div>
            <div className="customer-risk"><span className={`badge ${customer.smsOptIn ? "completed" : "pending"}`}>{customer.smsOptIn ? "SMS OK" : "No SMS consent"}</span><small>{customer.noShowCount} no-shows</small></div>
          </summary>
          <div className="customer-profile-body">
            <div className="customer-insights">
              <article><strong>{visits.length}</strong><span>recent visits</span></article>
              <article><strong>{completedVisits}</strong><span>completed</span></article>
              <article><strong>{lastVisit ? new Date(lastVisit.startAt).toLocaleDateString() : "None"}</strong><span>last appointment</span></article>
            </div>
            <form className="compact-form customer-edit" onSubmit={(event) => void save(event, customer.id)}>
              <input name="name" defaultValue={customer.name} required />
              <input name="phone" defaultValue={customer.phone} required />
              <input name="email" type="email" defaultValue={customer.email ?? ""} placeholder="Email optional" />
              <textarea name="notes" defaultValue={customer.notes ?? ""} placeholder="Customer notes, preferences, allergies, or follow-up context" />
              <label className="consent-check"><input name="smsOptIn" type="checkbox" defaultChecked={customer.smsOptIn} /><span><strong>SMS notifications permitted</strong><small>Only enable this with the customer's consent.</small></span></label>
              <div className="customer-profile-actions"><button className="primary">Save customer</button><button type="button" className="secondary" onClick={() => onBookAgain(customer)}>Book again</button></div>
            </form>
            <div className="customer-history">
              <h3>Appointment history</h3>
              {visits.length === 0 ? <p className="muted-text">No appointments yet.</p> : visits.map((appointment) => <article key={appointment.id}>
                <div><strong>{appointment.service.name}</strong><small>{appointment.staff?.name ?? "Any provider"} at {appointment.branch?.name ?? "branch"}</small></div>
                <span className={`badge ${(appointment.status ?? "confirmed").toLowerCase()}`}>{appointment.status ?? "CONFIRMED"}</span>
                <time>{new Date(appointment.startAt).toLocaleString()}</time>
              </article>)}
            </div>
          </div>
        </details>;
      })}
    </div>
    <div className="pagination-controls"><button className="secondary" disabled={page === 1} onClick={() => void runSearch(page - 1)}>Previous</button><span>Page {page}</span><button className="secondary" disabled={visibleCustomers.length < 50} onClick={() => void runSearch(page + 1)}>Next</button></div>
  </div>;
}

function Staff({ staff, branches, services, onChanged }: { staff: StaffMember[]; branches: Branch[]; services: Service[]; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadInvites() {
    try {
      setInvites(await listStaffInvites());
    } catch {
      setInvites([]);
    }
  }

  useEffect(() => {
    void loadInvites();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    try {
      await createStaff({
        branchId: String(form.get("branchId")) || undefined,
        name: String(form.get("name")),
        roleTitle: String(form.get("roleTitle")),
        phone: String(form.get("phone")) || undefined,
        email: String(form.get("email")) || undefined,
        serviceIds: form.getAll("serviceIds").map(String)
      });
      formElement.reset();
      await onChanged();
      setMessage("Staff member added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add staff");
    }
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    try {
      const created = await createStaffInvite({
        role: String(form.get("role")) as "RECEPTIONIST" | "STAFF",
        staffId: String(form.get("staffId")) || undefined,
        name: String(form.get("name")),
        email: String(form.get("email")),
        phone: String(form.get("phone")) || undefined
      });
      setInvites((current) => [created, ...current]);
      setMessage(`Invite created: ${created.inviteUrl}`);
      formElement.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create invite");
    }
  }

  async function changeState(action: () => Promise<unknown>, success: string) {
    setMessage("");
    try { await action(); await onChanged(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update staff member"); }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setMessage("");
    try {
      await updateStaff(editing.id, {
        branchId: String(form.get("branchId")) || null,
        name: String(form.get("name")),
        roleTitle: String(form.get("roleTitle")),
        phone: String(form.get("phone")) || null,
        email: String(form.get("email")) || null,
        serviceIds: form.getAll("serviceIds").map(String)
      });
      const photo = form.get("photo");
      if (photo instanceof File && photo.size > 0) await uploadStaffPhoto(editing.id, photo);
      await onChanged();
      setEditing(null);
      setMessage("Staff profile updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update staff profile");
    } finally {
      setSaving(false);
    }
  }

  async function clearPhoto() {
    if (!editing) return;
    setSaving(true);
    try {
      await removeStaffPhoto(editing.id);
      await onChanged();
      setEditing((current) => current ? { ...current, profileImageUrl: null } : null);
      setMessage("Profile photo removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove profile photo");
    } finally {
      setSaving(false);
    }
  }

  function removePermanently(item: StaffMember) {
    if (!window.confirm(`Permanently delete ${item.name}? This is only possible when no history is linked.`)) return;
    void changeState(() => deleteStaffPermanently(item.id), "Staff member deleted permanently.");
  }

  const activeStaff = staff.filter((item) => item.active !== false);
  const archivedStaff = staff.filter((item) => item.active === false);

  return <div className="resource-page">
    {message && <p className="form-message resource-message">{message}</p>}
    <TeamAccessPanel staff={activeStaff} />
    <div className="panel-grid manage-grid">
      <section className="panel resource-list"><div className="panel-head"><div><h2>Staff and providers</h2><p className="muted-text">People customers can select when booking.</p></div><span className="badge active">{activeStaff.length} active</span></div>
        <div className="resource-grid">{activeStaff.map((item) => <article className="resource-card" key={item.id}><div className="resource-icon profile-thumb">{item.profileImageUrl ? <img src={item.profileImageUrl} alt="" /> : <Stethoscope />}</div><div><strong>{item.name}</strong><span>{item.roleTitle}</span><small>{item.email ?? item.phone ?? "No contact details"}</small></div><div className="resource-actions"><button className="secondary" onClick={() => setEditing(item)}><Pencil size={16} /> Edit</button><button className="secondary" onClick={() => void changeState(() => deactivateStaff(item.id), "Staff member archived.")}><Archive size={16} /> Archive</button></div></article>)}</div>
        {activeStaff.length === 0 && <div className="empty-state"><strong>No active staff</strong><span>Add a provider or restore one from the archive.</span></div>}
        {archivedStaff.length > 0 && <details className="archive-section"><summary><Archive size={17} /> Archived staff <span>{archivedStaff.length}</span></summary><div className="resource-grid">{archivedStaff.map((item) => <article className="resource-card archived" key={item.id}><div className="resource-icon"><Stethoscope /></div><div><strong>{item.name}</strong><span>{item.roleTitle}</span><small>Hidden from new bookings</small></div><div className="resource-actions"><button className="secondary" onClick={() => void changeState(() => reactivateStaff(item.id), "Staff member restored.")}><RefreshCw size={16} /> Restore</button><button className="icon-action danger" title="Delete permanently" aria-label={`Delete ${item.name} permanently`} onClick={() => removePermanently(item)}><Trash2 size={17} /></button></div></article>)}</div></details>}
      </section>
      <section className="panel resource-editor"><div className="section-title"><span><Plus /></span><div><h2>Add staff profile</h2><p>Create the provider customers will see.</p></div></div><form className="compact-form labeled-form" onSubmit={submit}><label>Full name<input name="name" placeholder="e.g. Dr. Hana Tesfaye" required /></label><label>Role or title<input name="roleTitle" placeholder="e.g. Dentist" required /></label><label>Phone <span>Optional</span><input name="phone" type="tel" /></label><label>Email <span>Optional</span><input name="email" type="email" /></label><label>Primary branch<select name="branchId"><option value="">Works across branches</option>{branches.filter((item) => item.active !== false).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><fieldset className="service-assignment"><legend>Services they perform</legend><div className="check-list">{services.filter((item) => item.active !== false).map((service) => <label key={service.id}><input type="checkbox" name="serviceIds" value={service.id} /> {service.name}</label>)}</div></fieldset><button className="primary"><Plus size={17} /> Add staff profile</button></form></section>
    </div>
    <section className="panel invite-panel"><div className="panel-head"><div><h2>Workspace access</h2><p className="muted-text">Invite a staff member or receptionist to sign in.</p></div><span className="badge">{invites.length} invites</span></div><form className="inline-invite-form" onSubmit={invite}><label>Access level<select name="role"><option value="STAFF">Staff</option><option value="RECEPTIONIST">Receptionist</option></select></label><label>Linked profile<select name="staffId"><option value="">No linked profile</option>{activeStaff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>Name<input name="name" required /></label><label>Email<input name="email" type="email" required /></label><label>Phone <span>Optional</span><input name="phone" /></label><button className="primary">Create invite</button></form>{invites.length > 0 && <div className="invite-list">{invites.map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.role}</span><small>{item.acceptedAt ? "Accepted" : `Expires ${new Date(item.expiresAt).toLocaleDateString()}`}</small>{item.inviteUrl && <input readOnly value={item.inviteUrl} />}</div>)}</div>}</section>
    {editing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="staff-profile-title"><div className="panel-head"><div><p className="eyebrow">Staff profile</p><h2 id="staff-profile-title">Edit {editing.name}</h2></div><button className="icon-action" type="button" title="Close" aria-label="Close" onClick={() => setEditing(null)}><X /></button></div><form className="compact-form labeled-form" onSubmit={saveProfile}><div className="profile-photo-control"><div className="profile-photo-preview">{editing.profileImageUrl ? <img src={editing.profileImageUrl} alt={`${editing.name} profile`} /> : <Stethoscope />}</div><div><label className="secondary file-button"><ImageIcon size={17} /> Choose photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></label><small>JPG, PNG, or WebP. Maximum 2 MB.</small>{editing.profileImageUrl && <button type="button" className="text-danger" disabled={saving} onClick={() => void clearPhoto()}>Remove current photo</button>}</div></div><div className="form-split"><label>Full name<input name="name" defaultValue={editing.name} required /></label><label>Role or title<input name="roleTitle" defaultValue={editing.roleTitle} required /></label></div><div className="form-split"><label>Phone<input name="phone" type="tel" defaultValue={editing.phone ?? ""} /></label><label>Email<input name="email" type="email" defaultValue={editing.email ?? ""} /></label></div><label>Primary branch<select name="branchId" defaultValue={editing.branchId ?? ""}><option value="">Works across branches</option>{branches.filter((item) => item.active !== false).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><fieldset className="service-assignment"><legend>Services they perform</legend><div className="check-list">{services.filter((item) => item.active !== false).map((service) => <label key={service.id}><input type="checkbox" name="serviceIds" value={service.id} defaultChecked={editing.services?.some((assigned) => assigned.serviceId === service.id)} /> {service.name}</label>)}</div></fieldset><div className="modal-actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button></div></form></section></div>}
  </div>;
}

function TeamAccessPanel({ staff }: { staff: StaffMember[] }) {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const [accounts, pending] = await Promise.all([listTeamUsers(), listStaffInvites()]);
    setUsers(accounts); setInvites(pending.filter((item) => !item.acceptedAt));
  }, []);
  useEffect(() => { void load().catch(() => undefined); return subscribeToLiveEvents((resources) => { if (resources.includes("users") || resources.includes("staff")) void load(); }); }, [load]);
  async function run(action: () => Promise<unknown>, success: string) { try { setMessage(""); await action(); await load(); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update team access"); } }
  return <section className="panel team-access-panel"><div className="panel-head"><div><h2>Team accounts</h2><p className="muted-text">Control workspace access without deleting staff history.</p></div><span className="badge active">{users.filter((user) => user.active).length} active</span></div>{message && <p className="form-message">{message}</p>}<div className="team-account-list">{users.map((user) => <article key={user.id}><div><strong>{user.name}</strong><small>{user.email}</small></div><select aria-label={`Role for ${user.name}`} value={user.role} onChange={(event) => void run(() => updateTeamUser(user.id, { role: event.target.value as TeamUser["role"], staffId: event.target.value === "STAFF" ? user.staffId ?? null : null }), "Access role updated.")}><option value="RECEPTIONIST">Receptionist</option><option value="STAFF">Staff</option></select>{user.role === "STAFF" && <select aria-label={`Staff profile for ${user.name}`} value={user.staffId ?? ""} onChange={(event) => void run(() => updateTeamUser(user.id, { staffId: event.target.value || null }), "Staff profile linked.")}><option value="">Choose profile</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}<button className={user.active ? "secondary danger" : "secondary"} onClick={() => void run(() => updateTeamUser(user.id, { active: !user.active }), user.active ? "Account deactivated and sessions revoked." : "Account reactivated.")}>{user.active ? "Deactivate" : "Reactivate"}</button></article>)}</div>{invites.length > 0 && <div className="pending-invites"><h3>Pending invitations</h3>{invites.map((invite) => <article key={invite.id}><div><strong>{invite.name}</strong><small>{invite.email} · expires {new Date(invite.expiresAt).toLocaleDateString()}</small></div><button className="secondary" onClick={() => void run(() => resendStaffInvite(invite.id), "Invitation resent by email.")}>Resend</button><button className="icon-action danger" aria-label={`Revoke invitation for ${invite.name}`} onClick={() => void run(() => revokeStaffInvite(invite.id), "Invitation revoked.")}><Trash2 size={16} /></button></article>)}</div>}</section>;
}

function LegacyServices({ services, onChanged }: { services: Service[]; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    try {
      await createService({
        name: String(form.get("name")),
        description: String(form.get("description")) || undefined,
        category: String(form.get("category")) || undefined,
        priceCents: Math.round(Number(form.get("price")) * 100),
        durationMinutes: Number(form.get("durationMinutes")),
        bufferBeforeMinutes: Number(form.get("bufferBeforeMinutes") || 0),
        bufferAfterMinutes: Number(form.get("bufferAfterMinutes") || 0)
      });
      formElement.reset();
      await onChanged();
      setMessage("Service added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add service");
    }
  }

  async function changeState(action: () => Promise<unknown>, success: string) {
    setMessage("");
    try { await action(); await onChanged(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update service"); }
  }
  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setMessage("");
    try {
      await updateService(editing.id, {
        name: String(form.get("name")),
        category: String(form.get("category")),
        description: String(form.get("description")),
        priceCents: Math.round(Number(form.get("price")) * 100),
        durationMinutes: Number(form.get("durationMinutes")),
        bufferBeforeMinutes: Number(form.get("bufferBeforeMinutes")),
        bufferAfterMinutes: Number(form.get("bufferAfterMinutes"))
      });
      await onChanged();
      setEditing(null);
      setMessage("Service updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update service");
    } finally {
      setSaving(false);
    }
  }
  function removePermanently(service: Service) {
    if (!window.confirm(`Permanently delete ${service.name}? Services with appointment history cannot be deleted.`)) return;
    void changeState(() => deleteServicePermanently(service.id), "Service deleted permanently.");
  }
  const activeServices = services.filter((item) => item.active !== false);
  const archivedServices = services.filter((item) => item.active === false);

  return <div className="resource-page">{message && <p className="form-message resource-message">{message}</p>}<div className="panel-grid manage-grid"><section className="panel resource-list"><div className="panel-head"><div><h2>Services</h2><p className="muted-text">What customers can book from your public page.</p></div><span className="badge active">{activeServices.length} active</span></div><div className="resource-grid">{activeServices.map((service) => <article className="resource-card" key={service.id}><div className="resource-icon"><CheckCircle2 /></div><div><strong>{service.name}</strong><span>{service.category || "Uncategorized"}</span><small>{service.durationMinutes} min · {money(service.priceCents)}</small></div><div className="resource-actions"><button className="secondary" onClick={() => void changeState(() => deactivateService(service.id), "Service archived.")}><Archive size={16} /> Archive</button></div></article>)}</div>{activeServices.length === 0 && <div className="empty-state"><strong>No active services</strong><span>Add a service or restore one from the archive.</span></div>}{archivedServices.length > 0 && <details className="archive-section"><summary><Archive size={17} /> Archived services <span>{archivedServices.length}</span></summary><div className="resource-grid">{archivedServices.map((service) => <article className="resource-card archived" key={service.id}><div className="resource-icon"><CheckCircle2 /></div><div><strong>{service.name}</strong><span>{service.durationMinutes} min · {money(service.priceCents)}</span><small>Hidden from new bookings</small></div><div className="resource-actions"><button className="secondary" onClick={() => void changeState(() => reactivateService(service.id), "Service restored.")}><RefreshCw size={16} /> Restore</button><button className="icon-action danger" title="Delete permanently" aria-label={`Delete ${service.name} permanently`} onClick={() => removePermanently(service)}><Trash2 size={17} /></button></div></article>)}</div></details>}</section><section className="panel resource-editor"><div className="section-title"><span><Plus /></span><div><h2>Add service</h2><p>Set its public details and booking duration.</p></div></div><form className="compact-form labeled-form" onSubmit={submit}><label>Service name<input name="name" placeholder="e.g. Dental cleaning" required /></label><label>Category <span>Optional</span><input name="category" placeholder="e.g. Preventive care" /></label><label>Description <span>Optional</span><textarea name="description" placeholder="A short customer-facing description" /></label><div className="form-split"><label>Price (ETB)<input name="price" type="number" min="0" step="0.01" required /></label><label>Duration (minutes)<input name="durationMinutes" type="number" min="1" defaultValue="30" required /></label></div><div className="form-split"><label>Buffer before<input name="bufferBeforeMinutes" type="number" min="0" defaultValue="0" /></label><label>Buffer after<input name="bufferAfterMinutes" type="number" min="0" defaultValue="0" /></label></div><p className="field-help">Buffers reserve setup or cleanup time without extending the customer-facing duration.</p><button className="primary"><Plus size={17} /> Add service</button></form></section></div></div>;
}

function LegacyBranches({ branches, onChanged }: { branches: Branch[]; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    try {
      await createBranch({
        name: String(form.get("name")),
        address: String(form.get("address")),
        phone: String(form.get("phone")) || undefined,
        timezone: String(form.get("timezone")) || undefined
      });
      formElement.reset();
      await onChanged();
      setMessage("Branch added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add branch");
    }
  }

  async function changeState(action: () => Promise<unknown>, success: string) {
    setMessage("");
    try { await action(); await onChanged(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update branch"); }
  }
  function removePermanently(branch: Branch) {
    if (!window.confirm(`Permanently delete ${branch.name}? Branches with staff or appointment history cannot be deleted.`)) return;
    void changeState(() => deleteBranchPermanently(branch.id), "Branch deleted permanently.");
  }
  const activeBranches = branches.filter((item) => item.active !== false);
  const archivedBranches = branches.filter((item) => item.active === false);

  return <div className="resource-page">{message && <p className="form-message resource-message">{message}</p>}<div className="panel-grid manage-grid"><section className="panel resource-list"><div className="panel-head"><div><h2>Branches</h2><p className="muted-text">Locations customers can choose when booking.</p></div><span className="badge active">{activeBranches.length} active</span></div><div className="resource-grid">{activeBranches.map((branch) => <article className="resource-card" key={branch.id}><div className="resource-icon"><Building2 /></div><div><strong>{branch.name}</strong><span>{branch.address}</span><small>{branch.phone || "No public phone"}</small></div><div className="resource-actions"><button className="secondary" onClick={() => void changeState(() => deactivateBranch(branch.id), "Branch archived.")}><Archive size={16} /> Archive</button></div></article>)}</div>{archivedBranches.length > 0 && <details className="archive-section"><summary><Archive size={17} /> Archived branches <span>{archivedBranches.length}</span></summary><div className="resource-grid">{archivedBranches.map((branch) => <article className="resource-card archived" key={branch.id}><div className="resource-icon"><Building2 /></div><div><strong>{branch.name}</strong><span>{branch.address}</span><small>Hidden from new bookings</small></div><div className="resource-actions"><button className="secondary" onClick={() => void changeState(() => reactivateBranch(branch.id), "Branch restored.")}><RefreshCw size={16} /> Restore</button><button className="icon-action danger" title="Delete permanently" aria-label={`Delete ${branch.name} permanently`} onClick={() => removePermanently(branch)}><Trash2 size={17} /></button></div></article>)}</div></details>}</section><section className="panel resource-editor"><div className="section-title"><span><MapPin /></span><div><h2>Add branch</h2><p>Create a customer-facing service location.</p></div></div><form className="compact-form labeled-form" onSubmit={submit}><label>Branch name<input name="name" placeholder="e.g. Bole Main Branch" required /></label><label>Street address<input name="address" placeholder="e.g. Bole Road, Addis Ababa" required /></label><label>Public phone <span>Optional</span><input name="phone" type="tel" /></label><label>Timezone<select name="timezone" defaultValue="Africa/Addis_Ababa"><option value="Africa/Addis_Ababa">Africa/Addis Ababa (EAT)</option><option value="Africa/Nairobi">Africa/Nairobi (EAT)</option><option value="UTC">UTC</option></select></label><button className="primary"><Plus size={17} /> Add branch</button></form></section></div></div>;
}

function Services({ services, onChanged }: { services: Service[]; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<Service | null>(null);
  const active = services.filter((item) => item.active !== false);
  const archived = services.filter((item) => item.active === false);

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage("");
    try { await action(); await onChanged(); setMessage(success); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update service"); return false; }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const created = await run(() => createService({
      name: String(form.get("name")),
      category: String(form.get("category")) || undefined,
      description: String(form.get("description")) || undefined,
      priceCents: Math.round(Number(form.get("price")) * 100),
      durationMinutes: Number(form.get("durationMinutes")),
      bufferBeforeMinutes: Number(form.get("bufferBeforeMinutes") || 0),
      bufferAfterMinutes: Number(form.get("bufferAfterMinutes") || 0)
    }), "Service added.");
    if (created) element.reset();
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const saved = await run(() => updateService(editing.id, {
      name: String(form.get("name")),
      category: String(form.get("category")),
      description: String(form.get("description")),
      priceCents: Math.round(Number(form.get("price")) * 100),
      durationMinutes: Number(form.get("durationMinutes")),
      bufferBeforeMinutes: Number(form.get("bufferBeforeMinutes")),
      bufferAfterMinutes: Number(form.get("bufferAfterMinutes"))
    }), "Service updated.");
    if (saved) setEditing(null);
  }

  function remove(item: Service) {
    if (window.confirm(`Permanently delete ${item.name}? Services with appointment history cannot be deleted.`)) {
      void run(() => deleteServicePermanently(item.id), "Service deleted permanently.");
    }
  }

  return <div className="resource-page">
    {message && <p className="form-message resource-message">{message}</p>}
    <div className="panel-grid manage-grid">
      <section className="panel resource-list">
        <div className="panel-head"><div><h2>Services</h2><p className="muted-text">What customers can book from your public page.</p></div><span className="badge active">{active.length} active</span></div>
        <div className="resource-grid">{active.map((item) => <article className="resource-card" key={item.id}><div className="resource-icon"><CheckCircle2 /></div><div><strong>{item.name}</strong><span>{item.category || "Uncategorized"}</span><small>{item.durationMinutes} min - {money(item.priceCents)}</small></div><div className="resource-actions"><button className="secondary" onClick={() => setEditing(item)}><Pencil size={16} /> Edit</button><button className="secondary" onClick={() => void run(() => deactivateService(item.id), "Service archived.")}><Archive size={16} /> Archive</button></div></article>)}</div>
        {active.length === 0 && <div className="empty-state"><strong>No active services</strong><span>Add a service or restore one from the archive.</span></div>}
        {archived.length > 0 && <details className="archive-section"><summary><Archive size={17} /> Archived services <span>{archived.length}</span></summary><div className="resource-grid">{archived.map((item) => <article className="resource-card archived" key={item.id}><div className="resource-icon"><CheckCircle2 /></div><div><strong>{item.name}</strong><span>{item.durationMinutes} min - {money(item.priceCents)}</span><small>Hidden from new bookings</small></div><div className="resource-actions"><button className="secondary" onClick={() => void run(() => reactivateService(item.id), "Service restored.")}><RefreshCw size={16} /> Restore</button><button className="icon-action danger" title="Delete permanently" aria-label={`Delete ${item.name} permanently`} onClick={() => remove(item)}><Trash2 size={17} /></button></div></article>)}</div></details>}
      </section>
      <section className="panel resource-editor"><div className="section-title"><span><Plus /></span><div><h2>Add service</h2><p>Set its public details and booking duration.</p></div></div><form className="compact-form labeled-form" onSubmit={create}><label>Service name<input name="name" required /></label><label>Category <span>Optional</span><input name="category" /></label><label>Description <span>Optional</span><textarea name="description" /></label><div className="form-split"><label>Price (ETB)<input name="price" type="number" min="0" step="0.01" required /></label><label>Duration (minutes)<input name="durationMinutes" type="number" min="1" defaultValue="30" required /></label></div><div className="form-split"><label>Buffer before<input name="bufferBeforeMinutes" type="number" min="0" defaultValue="0" /></label><label>Buffer after<input name="bufferAfterMinutes" type="number" min="0" defaultValue="0" /></label></div><button className="primary"><Plus size={17} /> Add service</button></form></section>
    </div>
    {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="profile-modal" role="dialog" aria-modal="true"><div className="panel-head"><div><p className="eyebrow">Service details</p><h2>Edit {editing.name}</h2></div><button className="icon-action" type="button" aria-label="Close" onClick={() => setEditing(null)}><X /></button></div><form className="compact-form labeled-form" onSubmit={save}><label>Service name<input name="name" defaultValue={editing.name} required /></label><label>Category<input name="category" defaultValue={editing.category ?? ""} /></label><label>Description<textarea name="description" defaultValue={editing.description ?? ""} /></label><div className="form-split"><label>Price (ETB)<input name="price" type="number" min="0" step="0.01" defaultValue={(editing.priceCents / 100).toFixed(2)} required /></label><label>Duration (minutes)<input name="durationMinutes" type="number" min="1" defaultValue={editing.durationMinutes} required /></label></div><div className="form-split"><label>Buffer before<input name="bufferBeforeMinutes" type="number" min="0" defaultValue={editing.bufferBeforeMinutes ?? 0} required /></label><label>Buffer after<input name="bufferAfterMinutes" type="number" min="0" defaultValue={editing.bufferAfterMinutes ?? 0} required /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary">Save service</button></div></form></section></div>}
  </div>;
}

function Branches({ branches, onChanged }: { branches: Branch[]; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<Branch | null>(null);
  const active = branches.filter((item) => item.active !== false);
  const archived = branches.filter((item) => item.active === false);

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage("");
    try { await action(); await onChanged(); setMessage(success); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update branch"); return false; }
  }

  function values(form: FormData) {
    return { name: String(form.get("name")), address: String(form.get("address")), phone: String(form.get("phone")), timezone: String(form.get("timezone")) };
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const created = await run(() => createBranch(values(new FormData(element))), "Branch added.");
    if (created) element.reset();
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const saved = await run(() => updateBranch(editing.id, values(new FormData(event.currentTarget))), "Branch updated.");
    if (saved) setEditing(null);
  }

  function remove(item: Branch) {
    if (window.confirm(`Permanently delete ${item.name}? Branches with staff or appointment history cannot be deleted.`)) {
      void run(() => deleteBranchPermanently(item.id), "Branch deleted permanently.");
    }
  }

  const fields = (defaults?: Branch) => <><label>Branch name<input name="name" defaultValue={defaults?.name} required /></label><label>Street address<input name="address" defaultValue={defaults?.address} required /></label><label>Public phone <span>Optional</span><input name="phone" type="tel" defaultValue={defaults?.phone} /></label><label>Timezone<select name="timezone" defaultValue={defaults?.timezone ?? "Africa/Addis_Ababa"}><option value="Africa/Addis_Ababa">Africa/Addis Ababa (EAT)</option><option value="Africa/Nairobi">Africa/Nairobi (EAT)</option><option value="UTC">UTC</option></select></label></>;

  return <div className="resource-page">
    {message && <p className="form-message resource-message">{message}</p>}
    <div className="panel-grid manage-grid">
      <section className="panel resource-list"><div className="panel-head"><div><h2>Branches</h2><p className="muted-text">Locations customers can choose when booking.</p></div><span className="badge active">{active.length} active</span></div><div className="resource-grid">{active.map((item) => <article className="resource-card" key={item.id}><div className="resource-icon"><Building2 /></div><div><strong>{item.name}</strong><span>{item.address}</span><small>{item.phone || "No public phone"}</small></div><div className="resource-actions"><button className="secondary" onClick={() => setEditing(item)}><Pencil size={16} /> Edit</button><button className="secondary" onClick={() => void run(() => deactivateBranch(item.id), "Branch archived.")}><Archive size={16} /> Archive</button></div></article>)}</div>{archived.length > 0 && <details className="archive-section"><summary><Archive size={17} /> Archived branches <span>{archived.length}</span></summary><div className="resource-grid">{archived.map((item) => <article className="resource-card archived" key={item.id}><div className="resource-icon"><Building2 /></div><div><strong>{item.name}</strong><span>{item.address}</span><small>Hidden from new bookings</small></div><div className="resource-actions"><button className="secondary" onClick={() => void run(() => reactivateBranch(item.id), "Branch restored.")}><RefreshCw size={16} /> Restore</button><button className="icon-action danger" aria-label={`Delete ${item.name} permanently`} onClick={() => remove(item)}><Trash2 size={17} /></button></div></article>)}</div></details>}</section>
      <section className="panel resource-editor"><div className="section-title"><span><MapPin /></span><div><h2>Add branch</h2><p>Create a customer-facing service location.</p></div></div><form className="compact-form labeled-form" onSubmit={create}>{fields()}<button className="primary"><Plus size={17} /> Add branch</button></form></section>
    </div>
    {editing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><section className="profile-modal" role="dialog" aria-modal="true"><div className="panel-head"><div><p className="eyebrow">Branch details</p><h2>Edit {editing.name}</h2></div><button className="icon-action" type="button" aria-label="Close" onClick={() => setEditing(null)}><X /></button></div><form className="compact-form labeled-form" onSubmit={save}>{fields(editing)}<div className="modal-actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary">Save branch</button></div></form></section></div>}
  </div>;
}

function Reports() {
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [from, setFrom] = useState(() => { const date = new Date(); date.setDate(1); return date.toISOString().slice(0, 10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  async function load() { try { setReport(await getReportSummary(`${from}T00:00:00`, `${to}T23:59:59`)); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load reports"); } }
  useEffect(() => { void load(); }, []);
  return <div className="reports-view"><div className="panel report-toolbar"><div><h2>Performance reports</h2><p className="muted-text">Completed-service revenue estimates and operational trends.</p></div><div className="date-filters"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="primary" onClick={() => void load()}>Apply</button></div></div>{message && <p className="form-message">{message}</p>}{report && <><section className="metrics"><Metric label="Appointments" value={String(report.total)} detail="selected period" /><Metric label="Completed" value={String(report.completed)} detail="finished visits" /><Metric label="No-shows" value={String(report.noShows)} detail="missed visits" /><Metric label="Revenue estimate" value={money(report.revenueEstimateCents)} detail="completed services" /></section><div className="panel-grid"><section className="panel"><h2>Popular services</h2>{report.popularServices.map((item) => <div className="report-row" key={item.id}><strong>{item.name}</strong><span>{item.count} bookings</span></div>)}</section><section className="panel"><h2>Staff performance</h2>{report.staffPerformance.map((item) => <div className="report-row" key={item.id}><strong>{item.name}</strong><span>{item.completed}/{item.total} completed · {item.noShows} no-shows</span></div>)}</section></div><section className="panel"><h2>Upcoming appointments</h2>{report.upcomingAppointments.length === 0 && <p className="muted-text">No upcoming appointments in this period.</p>}{report.upcomingAppointments.map((item) => <div className="report-row" key={item.id}><div><strong>{item.customerName}</strong><small>{item.serviceName} with {item.staffName}</small></div><span>{new Date(item.startAt).toLocaleString()}</span></div>)}</section></>}</div>;
}

function Billing({ vendor }: { vendor: VendorProfile | null }) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { listPublicPlans().then(setPlans).catch((error) => setMessage(error instanceof Error ? error.message : "Could not load plans")); }, []);
  async function choose(planId: string) { setBusy(true); setMessage(""); try { const payment = await createSubscriptionInvoice(planId); location.href = `/payment?${new URLSearchParams({ invoice: payment.invoiceId, token: payment.token })}`; } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create renewal invoice"); setBusy(false); } }
  const subscription = vendor?.subscription;
  return <div className="billing-view"><section className="panel billing-current"><div><p className="eyebrow">Current subscription</p><h2>{subscription?.planVersion.plan.name ?? "No active plan"}</h2><p className="muted-text">Status: {subscription?.status ?? "Unavailable"}</p></div><span className={`badge ${subscription?.status === "ACTIVE" ? "completed" : "pending"}`}>{subscription?.status ?? "NONE"}</span></section>{message && <p className="form-message">{message}</p>}<section className="billing-plans">{plans.filter((plan) => plan.currentVersion?.monthlyPriceCents != null).map((plan) => <article className="panel" key={plan.id}><span className="badge active">{plan.code}</span><h2>{plan.name}</h2><p>{plan.description}</p><strong className="billing-price">{money(plan.currentVersion!.monthlyPriceCents!)} <small>/ month</small></strong><button className={subscription?.planVersion.plan.id === plan.id ? "secondary" : "primary"} disabled={busy} onClick={() => void choose(plan.id)}>{subscription?.planVersion.plan.id === plan.id ? "Renew this plan" : "Choose plan"}</button></article>)}</section></div>;
}

function SettingsView({ vendor, availability, branches, staff, onChanged }: { vendor: VendorProfile | null; availability: AvailabilitySettings; branches: Branch[]; staff: StaffMember[]; onChanged: () => Promise<void> }) {
  const [section, setSection] = useState<"profile" | "availability" | "booking" | "security" | "notifications" | "domain">("profile");
  const sections = [
    ["profile", Building2, "Business profile"],
    ["availability", Clock, "Availability"],
    ["booking", Settings, "Booking rules"],
    ["security", ShieldCheck, "Security"],
    ["notifications", MessageCircle, "Notifications"],
    ["domain", Globe2, "Domain"]
  ] as const;

  return (
    <div className="settings-shell">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {sections.map(([id, Icon, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="settings-section" role="tabpanel">
        {section === "profile" && <BusinessProfilePanel vendor={vendor} onChanged={onChanged} />}
        {section === "availability" && <AvailabilityRules availability={availability} branches={branches} staff={staff} onChanged={onChanged} />}
        {section === "booking" && <AppointmentRulesPanel />}
        {section === "security" && <div className="settings-grid"><TwoFactorPanel /><ChangePasswordPanel /></div>}
        {section === "notifications" && <div className="settings-grid notification-settings-grid"><MessagingSettingsPanel /><ReminderCenterPanel /><MessageTemplatesPanel /></div>}
        {section === "domain" && <DomainSettingsPanel />}
      </div>
    </div>
  );
}

function BusinessProfilePanel({ vendor, onChanged }: { vendor: VendorProfile | null; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<BookingThemeId>(bookingThemeById(vendor?.bookingTheme).id);

  useEffect(() => {
    setSelectedTheme(bookingThemeById(vendor?.bookingTheme).id);
  }, [vendor?.bookingTheme]);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("logo");
    if (!(file instanceof File) || file.size === 0) return setMessage("Choose a logo first.");
    setBusy(true);
    setMessage("");
    try {
      await uploadVendorLogo(file);
      await onChanged();
      setMessage("Business logo updated.");
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload logo");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage("");
    try {
      await removeVendorLogo();
      await onChanged();
      setMessage("Business logo removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove logo");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPromo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("promoImage");
    if (!(file instanceof File) || file.size === 0) return setMessage("Choose a promotional image first.");
    setBusy(true);
    setMessage("");
    try {
      await uploadVendorPromoImage(file);
      await onChanged();
      setMessage("Promotional image updated.");
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload promotional image");
    } finally {
      setBusy(false);
    }
  }

  async function removePromo() {
    setBusy(true);
    setMessage("");
    try {
      await removeVendorPromoImage();
      await onChanged();
      setMessage("Promotional image reset to the default.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove promotional image");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setMessage("");
    try {
      await updateVendorProfile({ name: String(form.get("name")), slug: String(form.get("slug")), businessType: String(form.get("businessType")), description: String(form.get("description")) || null, phone: String(form.get("phone")) || null, email: String(form.get("email")) || null, timezone: String(form.get("timezone")), bookingTheme: selectedTheme });
      await onChanged(); setMessage("Business profile saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save business profile"); }
    finally { setBusy(false); }
  }

  const activeTheme = bookingThemeById(selectedTheme);

  return <section className="panel business-profile-panel"><div className="section-title"><span><Building2 /></span><div><h2>Business identity</h2><p>Keep public business information and branding accurate.</p></div></div>{message && <p className="form-message">{message}</p>}<div className="business-profile-layout"><div className="business-logo-preview">{vendor?.logoUrl ? <img src={vendor.logoUrl} alt={`${vendor.name} logo`} /> : <span>{vendor?.name?.charAt(0) ?? "A"}</span>}</div><div className="business-profile-copy"><h3>{vendor?.name ?? "Your business"}</h3><p>{vendor?.slug ? `appointit.com/book/${vendor.slug}` : "Public booking address"}</p><form className="logo-upload-form" onSubmit={upload}><label className="secondary file-button"><ImageIcon size={17} /> Choose logo<input name="logo" type="file" accept="image/jpeg,image/png,image/webp" required /></label><button className="primary" disabled={busy}>{busy ? "Uploading..." : "Upload logo"}</button>{vendor?.logoUrl && <button type="button" className="secondary" disabled={busy} onClick={() => void remove()}><Trash2 size={16} /> Remove</button>}</form><small>Use a square JPG, PNG, or WebP up to 2 MB.</small></div></div><div className="promo-image-panel"><div className="promo-image-preview"><img src={vendor?.promoImageUrl ?? ""} alt="" /></div><div><h3>Booking page promotional image</h3><p>Use a bright image of the space, team, or client experience. Recommended size: 1600 x 1000 px. JPG, PNG, or WebP up to 4 MB.</p><form className="logo-upload-form" onSubmit={uploadPromo}><label className="secondary file-button"><ImageIcon size={17} /> Choose image<input name="promoImage" type="file" accept="image/jpeg,image/png,image/webp" required /></label><button className="primary" disabled={busy}>{busy ? "Uploading..." : "Upload image"}</button>{vendor?.promoImageUrl && <button type="button" className="secondary" disabled={busy} onClick={() => void removePromo()}><Trash2 size={16} /> Use default</button>}</form></div></div><form className="compact-form labeled-form business-details-form" onSubmit={saveProfile}><div className="form-split"><label>Business name<input name="name" defaultValue={vendor?.name ?? ""} required /></label><label>Business type<input name="businessType" defaultValue={vendor?.businessType ?? ""} required /></label></div><label>Booking page slug<input name="slug" defaultValue={vendor?.slug ?? ""} pattern="[a-z0-9-]{3,80}" required /><small>Changing this updates the hosted booking URL. Existing links using the old slug will stop working.</small></label><label>Public description<textarea name="description" defaultValue={vendor?.description ?? ""} maxLength={1000} placeholder="Describe what customers can expect." /></label><div className="form-split"><label>Business phone<input name="phone" type="tel" defaultValue={vendor?.phone ?? ""} /></label><label>Business email<input name="email" type="email" defaultValue={vendor?.email ?? ""} /></label></div><label>Timezone<select name="timezone" defaultValue={vendor?.timezone ?? "Africa/Addis_Ababa"}><option value="Africa/Addis_Ababa">Africa/Addis Ababa (EAT)</option><option value="Africa/Nairobi">Africa/Nairobi (EAT)</option><option value="UTC">UTC</option></select></label><div className="booking-theme-settings"><div className="section-title compact"><span><Settings /></span><div><h2>Booking page theme</h2><p>Choose the visual style customers see on this vendor's booking page and workspace.</p></div></div><div className="booking-theme-grid">{bookingThemes.map((theme) => <button type="button" key={theme.id} className={theme.id === selectedTheme ? "selected" : ""} onClick={() => setSelectedTheme(theme.id)}><span className="theme-swatches">{theme.colors.map((color) => <i key={color} style={{ background: color }} />)}</span><strong>{theme.name}</strong><small>{theme.description}</small>{theme.id === selectedTheme && <CheckCircle2 size={17} />}</button>)}</div><div className="booking-theme-preview" style={bookingThemeStyle(activeTheme)}><div><span>{vendor?.logoUrl ? <img src={vendor.logoUrl} alt="" /> : vendor?.name?.charAt(0) ?? "A"}</span><strong>{vendor?.name ?? "Your business"}</strong></div><button type="button">Confirm appointment</button></div></div><button className="primary" disabled={busy}>{busy ? "Saving..." : "Save business profile"}</button></form></section>;
}

function AppointmentRulesPanel() {
  const [rules, setRules] = useState<AppointmentRules | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAppointmentRules().then(setRules).catch((error) => setMessage(error instanceof Error ? error.message : "Could not load booking rules"));
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rules) return;
    setBusy(true);
    setMessage("");
    try {
      const updated = await updateAppointmentRules(rules);
      setRules(updated);
      setMessage("Customer booking rules saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save booking rules");
    } finally {
      setBusy(false);
    }
  }

  if (!rules) return <section className="panel workspace-state"><span className="loading-line" /><strong>Loading booking rules</strong>{message && <p>{message}</p>}</section>;
  return <section className="panel booking-rules-panel"><div className="section-title"><span><Settings /></span><div><h2>Customer self-service</h2><p>Control how close to an appointment customers may make changes.</p></div></div>{message && <p className="form-message">{message}</p>}<form className="compact-form labeled-form" onSubmit={save}><label className="toggle-setting"><span><strong>Allow customer cancellation</strong><small>Customers with a secure management link may cancel online.</small></span><span className="switch-control"><input type="checkbox" checked={rules.allowCustomerCancellation} onChange={(event) => setRules({ ...rules, allowCustomerCancellation: event.target.checked })} /><i /></span></label><label>Minimum cancellation notice (hours)<input type="number" min="0" max="168" value={rules.cancellationNoticeHours} disabled={!rules.allowCustomerCancellation} onChange={(event) => setRules({ ...rules, cancellationNoticeHours: Number(event.target.value) })} /></label><label className="toggle-setting"><span><strong>Allow customer rescheduling</strong><small>Replacement times still follow staff hours, breaks, and availability.</small></span><span className="switch-control"><input type="checkbox" checked={rules.allowCustomerReschedule} onChange={(event) => setRules({ ...rules, allowCustomerReschedule: event.target.checked })} /><i /></span></label><div className="form-split"><label>Minimum reschedule notice (hours)<input type="number" min="0" max="168" value={rules.rescheduleNoticeHours} disabled={!rules.allowCustomerReschedule} onChange={(event) => setRules({ ...rules, rescheduleNoticeHours: Number(event.target.value) })} /></label><label>Maximum customer reschedules<input type="number" min="0" max="10" value={rules.maxCustomerReschedules} disabled={!rules.allowCustomerReschedule} onChange={(event) => setRules({ ...rules, maxCustomerReschedules: Number(event.target.value) })} /></label></div><button className="primary" disabled={busy}>{busy ? "Saving..." : "Save booking rules"}</button></form></section>;
}

function DomainSettingsPanel() {
  const [settings, setSettings] = useState<DomainSettings | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setMessage("");
    try {
      setSettings(await getDomainSettings());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load domain settings");
    }
  }

  useEffect(() => { void load(); }, []);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      await addCustomDomain(String(form.get("hostname")));
      await load();
      setMessage("Domain added. Complete the DNS records below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add domain");
    } finally {
      setBusy(false);
    }
  }

  async function refresh(id: string) {
    setBusy(true);
    try {
      const updated = await refreshCustomDomain(id);
      await load();
      setMessage(updated.status === "ACTIVE" ? "DNS verified. HTTPS will be issued automatically when the domain is opened." : "DNS is not pointing to AppointIt yet. Check the record and try again after propagation.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh domain");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await removeCustomDomain(id);
      await load();
      setMessage("Custom domain removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove domain");
    } finally {
      setBusy(false);
    }
  }

  const domain = settings?.domains[0];
  return (
    <div className="panel domain-panel">
      <div className="panel-head">
        <h2>Booking domain</h2>
        <span className={`badge ${domain?.status === "ACTIVE" ? "completed" : "pending"}`}>{settings?.canUseCustomDomain ? domain?.status ?? "NOT CONNECTED" : settings?.plan?.name ?? "NO PLAN"}</span>
      </div>
      {message && <p className="form-message">{message}</p>}
      <StatusRow icon={<Globe2 />} label="Hosted booking URL" status={settings?.hostedUrl ?? "Loading..."} />
      {settings && !settings.canUseCustomDomain && <p className="muted-text">{settings.plan?.name ?? "The current subscription"} does not include custom domains.</p>}
      {settings?.canUseCustomDomain && !domain && (
        <div className="domain-onboarding"><ol><li><strong>Choose a booking hostname</strong><span>Use a subdomain such as <code>book.yourbusiness.com</code>. Do not enter <code>https://</code> or a page path.</span></li><li><strong>Add it here</strong><span>We will show the exact DNS record to create with your domain provider.</span></li><li><strong>Verify DNS</strong><span>After DNS propagates, AppointIt provisions and renews HTTPS automatically.</span></li></ol><form className="compact-form domain-form" onSubmit={add}><input name="hostname" placeholder="book.yourbusiness.com" inputMode="url" autoCapitalize="none" required /><button className="primary" disabled={busy || settings.providerReady === false}>{busy ? "Adding..." : "Add domain"}</button></form></div>
      )}
      {domain && (
        <div className="domain-details">
          <StatusRow icon={<Globe2 />} label="Custom hostname" status={domain.hostname} />
          <StatusRow icon={<ShieldCheck />} label="HTTPS certificate" status={domain.status === "ACTIVE" ? "Managed automatically" : "Waiting for DNS verification"} />
          <div className="domain-instructions"><h3>Connect your DNS</h3><p>Add the recommended record at the company where you manage <strong>{domain.hostname}</strong>. DNS records contain a hostname or IP address, never a URL.</p><ol><li>Add the recommended <strong>A record</strong> below. If your provider requires a short Host value, use the subdomain portion such as <code>book</code>.</li><li>Remove any conflicting A, AAAA, or CNAME record for the same hostname.</li><li>Wait for propagation, then select <strong>Check DNS</strong>. This can take a few minutes or, with some providers, several hours.</li></ol></div>
          <div className="domain-records domain-dns-table">
            {(settings?.dnsRecords ?? []).map((record) => <div className={record.recommended ? "recommended" : ""} key={`${record.type}-${record.value}`}><strong>{record.type}{record.recommended ? " · Recommended" : " · Alternative"}</strong><code>{record.host}</code><code>{record.value}</code><button className="icon-action" title={`Copy ${record.value}`} aria-label={`Copy ${record.type} value`} onClick={() => void navigator.clipboard.writeText(record.value)}><Copy size={15} /></button></div>)}
            {domain.verificationRecords.map((record, index) => <div key={`${record.name}-${index}`}><strong>{record.type}</strong><code>{record.name}</code><code>{record.value}</code></div>)}
          </div>
          {domain.status === "ACTIVE" && <a className="primary domain-open" href={`https://${domain.hostname}`} target="_blank" rel="noreferrer">Open custom booking page</a>}
          <div className="domain-actions">
            <button className="secondary" disabled={busy} onClick={() => void refresh(domain.id)}><RefreshCw size={16} /> {busy ? "Checking..." : "Check DNS"}</button>
            <button className="secondary danger" disabled={busy} onClick={() => void remove(domain.id)}><Trash2 size={16} /> Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

function GoogleCalendarPanel() {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [calendarOptions, setCalendarOptions] = useState<Record<string, Array<{ id: string; name: string; primary: boolean }>>>({});

  const load = useCallback(() => getGoogleCalendarStatus().then(setStatus), []);
  useEffect(() => {
    if (!getToken()) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendarConnection") === "success") setMessage("Google Calendar connected.");
    if (params.get("calendarConnection") === "failed") setMessage(params.get("reason") ?? "Google Calendar connection failed.");
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load Google Calendar status"));
    return subscribeToLiveEvents((resources) => { if (resources.includes("calendar")) void load(); });
  }, [load]);

  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      const result = await startGoogleCalendarConnection();
      window.location.href = result.url;
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Could not start Google Calendar connection");
    }
  }

  async function copyCallback() {
    if (!status?.redirectUri) return;
    await navigator.clipboard.writeText(status.redirectUri);
    setMessage("OAuth callback URL copied.");
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await action(); await load(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Calendar operation failed"); }
    finally { setBusy(false); }
  }

  async function loadCalendarOptions(connectionId: string) {
    if (calendarOptions[connectionId]) return;
    try { const options = await listGoogleCalendars(connectionId); setCalendarOptions((current) => ({ ...current, [connectionId]: options })); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Reconnect Google Calendar to choose a calendar"); }
  }

  return (
    <div className="panel calendar-settings-panel">
      <div className="panel-head">
        <h2>Google Calendar</h2>
        <span className={`badge ${status?.connected ? "completed" : "pending"}`}>{status?.connected ? "Connected" : "Not connected"}</span>
      </div>
      {message && <p className="form-message">{message}</p>}
      <StatusRow icon={<CalendarDays />} label="OAuth configuration" status={status?.configured ? "Ready" : "Missing Google env values"} />
      <StatusRow icon={<ShieldCheck />} label="Plan access" status={status?.canUseCalendarSync ? "Included" : "Upgrade required"} />
      <StatusRow icon={<CalendarDays />} label="Sync status" status={status?.syncEnabled ? "Enabled" : "Disabled"} />
      {status?.expiresAt && <p className="muted-text">Access token expires at {new Date(status.expiresAt).toLocaleString()}.</p>}
      {status?.redirectUri && <div className="oauth-callback"><div><strong>Authorized redirect URI</strong><code>{status.redirectUri}</code></div><button className="icon-action" title="Copy callback URL" onClick={() => void copyCallback()}><Copy size={16} /></button></div>}
      <p className="muted-text">Register this exact HTTPS URI in the Google Cloud OAuth client. AppointIt builds the authorization request at runtime for the signed-in vendor.</p>
      <div className="calendar-setting-actions"><button className="primary" disabled={busy || status?.configured === false || status?.canUseCalendarSync === false} onClick={() => void connect()}>{busy ? "Working..." : status?.connected ? "Reconnect" : "Connect Google Calendar"}</button>{status?.connected && <button className="secondary" disabled={busy} onClick={() => void run(() => resyncGoogleCalendar(), "Upcoming appointments synchronized.")}>Sync upcoming</button>}</div>
      {status?.connections.map((connection) => <article className="calendar-connection-row" key={connection.id}><div><strong>{connection.staff?.name ?? "Business calendar"}</strong><small>{connection.syncEnabled ? "New changes are synchronized" : "Synchronization paused"}</small></div><select aria-label="Destination Google calendar" value={connection.calendarId} onFocus={() => void loadCalendarOptions(connection.id)} onChange={(event) => void run(() => updateGoogleCalendarConnection(connection.id, { calendarId: event.target.value }), "Destination calendar updated.")}><option value={connection.calendarId}>{calendarOptions[connection.id]?.find((item) => item.id === connection.calendarId)?.name ?? (connection.calendarId === "primary" ? "Primary calendar" : connection.calendarId)}</option>{calendarOptions[connection.id]?.filter((item) => item.id !== connection.calendarId).map((item) => <option key={item.id} value={item.id}>{item.name}{item.primary ? " (Primary)" : ""}</option>)}</select><button className="secondary" disabled={busy} onClick={() => void run(() => updateGoogleCalendarConnection(connection.id, { syncEnabled: !connection.syncEnabled }), connection.syncEnabled ? "Calendar sync paused." : "Calendar sync enabled.")}>{connection.syncEnabled ? "Pause" : "Enable"}</button><button className="icon-action danger" disabled={busy} title="Disconnect" onClick={() => void run(() => disconnectGoogleCalendar(connection.id), "Google Calendar disconnected.")}><Trash2 size={16} /></button></article>)}
      {status?.logs.some((log) => log.status === "FAILED") && <div className="calendar-failure-list"><h3>Recent failures</h3>{status.logs.filter((log) => log.status === "FAILED").map((log) => <article key={log.id}><div><strong>{log.action.replaceAll("_", " ")}</strong><small>{log.errorMessage}</small></div><button className="secondary" disabled={busy || !log.appointmentId} onClick={() => void run(() => retryGoogleCalendarSync(log.id), "Calendar sync retried.")}>Retry</button></article>)}</div>}
    </div>
  );
}

function ChangePasswordPanel() {
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage("");
    try {
      await changePassword(String(form.get("currentPassword")), String(form.get("newPassword")));
      clearToken();
      setMessage("Password changed. Please log in again.");
      setTimeout(() => { location.href = "/login"; }, 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change password");
    }
  }

  return (
    <div className="panel">
      <div className="panel-head"><h2>Account security</h2><span className="badge confirmed">Password</span></div>
      {message && <p className="form-message">{message}</p>}
      <form className="compact-form" onSubmit={submit}>
        <input name="currentPassword" placeholder="Current password" type="password" minLength={8} required />
        <input name="newPassword" placeholder="New password" type="password" minLength={8} required />
        <button className="primary">Change password</button>
      </form>
    </div>
  );
}

function TwoFactorPanel() {
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSecuritySettings()
      .then((result) => {
        setSettings(result);
        setEnabled(result.smsTwoFactorEnabled);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load security settings"));
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const updated = await updateSmsTwoFactor(enabled, String(form.get("currentPassword")));
      setSettings(updated);
      setMessage(`SMS two-factor authentication ${updated.smsTwoFactorEnabled ? "enabled" : "disabled"}. Sign in again.`);
      setTimeout(() => {
        clearToken();
        location.href = "/login";
      }, 1000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update two-factor authentication");
      setBusy(false);
    }
  }

  const verified = Boolean(settings?.phoneVerifiedAt);
  const changed = settings ? enabled !== settings.smsTwoFactorEnabled : false;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>SMS two-factor authentication</h2>
        <span className={`badge ${settings?.smsTwoFactorEnabled ? "completed" : "pending"}`}>{settings?.smsTwoFactorEnabled ? "Enabled" : "Disabled"}</span>
      </div>
      <StatusRow icon={<ShieldCheck />} label="Verified phone" status={settings?.phone ?? "Not verified"} />
      {message && <p className="form-message">{message}</p>}
      <form className="compact-form" onSubmit={submit}>
        <label className="toggle-setting">
          <span>Require SMS code at sign-in</span>
          <span className="switch-control">
            <input type="checkbox" checked={enabled} disabled={!verified || busy} onChange={(event) => setEnabled(event.target.checked)} />
            <i />
          </span>
        </label>
        <input name="currentPassword" placeholder="Current password" type="password" autoComplete="current-password" minLength={8} required />
        <button className="primary" disabled={!changed || busy}>{busy ? "Saving..." : enabled ? "Enable 2FA" : "Disable 2FA"}</button>
      </form>
    </div>
  );
}

function MessagingSettingsPanel() {
  const [settings, setSettings] = useState<MessagingSettings | null>(null);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    getMessagingSettings()
      .then((loaded) => { setSettings(loaded); setSmsEnabled(Boolean(loaded.smsEnabled)); })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load messaging settings"));
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    try {
      const updated = await updateMessagingSettings({
        smsEnabled,
        smsProvider: "afromessage",
        smsGatewayApiKey: String(form.get("smsGatewayApiKey")) || undefined,
        smsIdentifierId: String(form.get("smsIdentifierId")) || undefined,
        smsFrom: String(form.get("smsFrom")) || undefined
      });
      setSettings(updated);
      setSmsEnabled(Boolean(updated.smsEnabled));
      const tokenInput = formElement.elements.namedItem("smsGatewayApiKey");
      if (tokenInput instanceof HTMLInputElement) tokenInput.value = "";
      setMessage("AfroMessage reminder settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save messaging settings");
    }
  }

  async function sendTest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setTestBusy(true);
    setMessage("");
    try {
      const result = await sendTestSms({
        phone: String(form.get("testPhone")),
        message: String(form.get("testMessage")) || undefined
      });
      setMessage(result.providerMessageId ? `Test SMS sent. Provider ID: ${result.providerMessageId}` : "Test SMS sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send test SMS");
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Notifications</h2>
        <span className={`badge ${settings?.smsEnabled && settings?.encryptedSmsGatewayApiKey ? "completed" : "pending"}`}>{settings?.smsEnabled && settings?.encryptedSmsGatewayApiKey ? "SMS active" : "Not configured"}</span>
      </div>
      {message && <p className="form-message">{message}</p>}
      <form className="compact-form" onSubmit={submit} key={settings ? "messaging-loaded" : "messaging-loading"}>
        <label className="toggle-setting">
          <span>Enable SMS reminders</span>
          <span className="switch-control"><input name="smsEnabled" type="checkbox" checked={smsEnabled} onChange={(event) => setSmsEnabled(event.target.checked)} /><i /></span>
        </label>
        <input name="smsIdentifierId" placeholder="Identifier ID (optional when using the account default)" defaultValue={settings?.smsIdentifierId ?? ""} />
        <input name="smsGatewayApiKey" type="password" autoComplete="off" placeholder={settings?.encryptedSmsGatewayApiKey ? "API token saved. Enter a new token only to replace it." : "AfroMessage API token"} required={smsEnabled && !settings?.encryptedSmsGatewayApiKey} />
        <input name="smsFrom" placeholder="Sender name (optional)" defaultValue={settings?.smsFrom ?? ""} />
        <button className="primary">Save SMS settings</button>
      </form>
      <p className="muted-text">Use this business's own AfroMessage token. Identifier ID and sender name are optional and only needed when AfroMessage has approved them for this account.</p>
      <form className="compact-form sms-test-form" onSubmit={sendTest}>
        <div className="section-title"><span><MessageCircle /></span><div><h3>Send test SMS</h3><p>Confirm the vendor token and sender settings before using real reminders.</p></div></div>
        <input name="testPhone" placeholder="+2519..." required />
        <textarea name="testMessage" rows={3} placeholder="Optional test message" />
        <button className="secondary" disabled={testBusy || !settings?.smsEnabled || !settings?.encryptedSmsGatewayApiKey}>{testBusy ? "Sending..." : "Send test SMS"}</button>
      </form>
    </div>
  );
}

function MessageTemplatesPanel() {
  const types: MessageTemplate["type"][] = ["confirmation", "reminder", "cancellation", "reschedule", "follow_up"];
  const defaultText = "Hello {{customer}}, your {{service}} appointment is scheduled for {{date_time}} with {{provider}} at {{business}}. Manage: {{manage_url}}";
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [type, setType] = useState<MessageTemplate["type"]>("confirmation");
  const [channel, setChannel] = useState<"SMS" | "EMAIL">("SMS");
  const [message, setMessage] = useState("");
  const [body, setBody] = useState(defaultText);
  const [subject, setSubject] = useState("");
  const [active, setActive] = useState(true);
  const load = useCallback(() => listMessageTemplates().then(setTemplates), []);
  useEffect(() => { void load(); return subscribeToLiveEvents((resources) => { if (resources.includes("notifications")) void load(); }); }, [load]);
  const current = templates.find((item) => item.type === type && item.channel === channel);
  useEffect(() => { setBody(current?.body ?? defaultText); setSubject(current?.subject ?? ""); setActive(current?.active ?? true); }, [current?.id, current?.updatedAt, type, channel]);
  const previewValues: Record<string, string> = {
    customer: "Mekdes",
    customer_name: "Mekdes",
    service: "Dental cleaning",
    date_time: "Friday, 9:00 AM",
    datetime: "Friday, 9:00 AM",
    date: "Friday, 9:00 AM",
    time: "Friday, 9:00 AM",
    provider: "Dr. Hana",
    provider_name: "Dr. Hana",
    staff: "Dr. Hana",
    staff_name: "Dr. Hana",
    business: "Your business",
    business_name: "Your business",
    branch: "Main branch",
    location: "Main branch",
    address: "Bole Road",
    manage_url: "https://appointit.example/manage-booking"
  };
  const preview = body.replace(/{{\s*([a-z_]+)\s*}}/gi, (_match, key: string) => previewValues[key.toLowerCase()] ?? `{{${key}}}`);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    try { await saveMessageTemplate(type, { channel, templateName: `${type} ${channel}`, subject: channel === "EMAIL" ? subject || null : null, body, active }); await load(); setMessage("Message template saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save template"); }
  }
  return <section className="panel message-template-panel"><div className="panel-head"><div><h2>Message templates</h2><p className="muted-text">Personalize customer communication using safe appointment variables.</p></div></div>{message && <p className="form-message">{message}</p>}<div className="template-picker"><select value={type} onChange={(event) => setType(event.target.value as MessageTemplate["type"])}>{types.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}</select><div className="calendar-modes"><button type="button" className={channel === "SMS" ? "active" : ""} onClick={() => setChannel("SMS")}>SMS</button><button type="button" className={channel === "EMAIL" ? "active" : ""} onClick={() => setChannel("EMAIL")}>Email</button></div></div><div className="template-editor-layout"><form key={`${current?.id ?? "new"}-${type}-${channel}`} className="compact-form labeled-form" onSubmit={save}>{channel === "EMAIL" && <label>Subject<input name="subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Appointment update from {{business}}" /></label>}<label>Message<textarea name="body" value={body} onChange={(event) => setBody(event.target.value)} rows={7} required /></label><small>Variables: {"{{customer}}, {{customer_name}}, {{service}}, {{date_time}}, {{date}}, {{provider}}, {{staff}}, {{business}}, {{branch}}, {{location}}, {{address}}, {{manage_url}}"}</small><label className="toggle-setting"><span><strong>Template active</strong></span><span className="switch-control"><input name="active" type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><i /></span></label><div className="modal-actions"><button className="primary">Save template</button>{current && <button type="button" className="secondary danger" onClick={() => void deleteMessageTemplate(current.id).then(load)}>Use default</button>}</div></form><aside className="template-preview"><span>Preview</span>{channel === "EMAIL" && <strong>{subject || "Appointment update"}</strong>}<p>{preview}</p></aside></div></section>;
}

function ReminderCenterPanel() {
  const presets = [{ minutes: 10_080, label: "1 week" }, { minutes: 1440, label: "1 day" }, { minutes: 120, label: "2 hours" }, { minutes: 60, label: "1 hour" }];
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [logs, setLogs] = useState<VendorNotificationLog[]>([]);
  const [schedules, setSchedules] = useState<ReminderSchedule[]>([]);
  const [messaging, setMessaging] = useState<MessagingSettings | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [customHours, setCustomHours] = useState("4");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadReminderData = useCallback(() => Promise.all([getReminderSettings(), listVendorNotificationLogs(), listReminderSchedules(), getMessagingSettings(), listMessageTemplates()])
    .then(([loadedSettings, loadedLogs, loadedSchedules, loadedMessaging, loadedTemplates]) => {
      setSettings(loadedSettings);
      setLogs(loadedLogs);
      setSchedules(loadedSchedules);
      setMessaging(loadedMessaging);
      setTemplates(loadedTemplates);
    }), []);

  useEffect(() => {
    void loadReminderData().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load reminder center"));
    return subscribeToLiveEvents((resources) => { if (resources.includes("notifications")) void loadReminderData(); });
  }, [loadReminderData]);

  function timingLabel(minutes: number) {
    if (minutes % 10_080 === 0) return `${minutes / 10_080} week${minutes === 10_080 ? "" : "s"}`;
    if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
    if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
    return `${minutes} minutes`;
  }

  function toggleOffset(minutes: number) {
    if (!settings) return;
    const exists = settings.offsetsMinutes.includes(minutes);
    setSettings({ ...settings, offsetsMinutes: exists ? settings.offsetsMinutes.filter((item) => item !== minutes) : [...settings.offsetsMinutes, minutes].sort((a, b) => b - a) });
  }

  function addCustomOffset() {
    if (!settings) return;
    const minutes = Math.round(Number(customHours) * 60);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 10_080) return setMessage("Custom timing must be between 15 minutes and 1 week.");
    if (settings.offsetsMinutes.includes(minutes)) return setMessage("That reminder timing is already selected.");
    if (settings.offsetsMinutes.length >= 6) return setMessage("Choose up to six automatic reminders.");
    setSettings({ ...settings, offsetsMinutes: [...settings.offsetsMinutes, minutes].sort((a, b) => b - a) });
    setMessage("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    if (settings.automaticEnabled && settings.offsetsMinutes.length === 0) return setMessage("Choose at least one timing, or switch to Manual only.");
    setBusy(true);
    setMessage("");
    try {
      const updated = await updateReminderSettings(settings);
      setSettings(updated);
      await loadReminderData();
      setMessage(`Reminder schedule saved for ${updated.rescheduledAppointments ?? 0} upcoming appointments.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save reminder schedule");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <section className="panel workspace-state"><span className="loading-line" /><strong>Loading reminder center</strong>{message && <p>{message}</p>}</section>;

  const activeReminderTemplate = templates.some((template) => template.channel === "SMS" && template.type === "reminder" && template.active);
  const readiness = [
    { label: "AfroMessage token saved", done: Boolean(messaging?.encryptedSmsGatewayApiKey), help: "Add the vendor token in Notifications." },
    { label: "SMS reminders enabled", done: Boolean(messaging?.smsEnabled), help: "Turn on Enable SMS reminders." },
    { label: "Automatic schedule selected", done: Boolean(settings.automaticEnabled && settings.offsetsMinutes.length), help: "Choose at least one reminder timing." },
    { label: "Reminder SMS template active", done: activeReminderTemplate, help: "Use the default template or save a custom reminder SMS template." }
  ];
  const readyCount = readiness.filter((item) => item.done).length;
  const upcomingSchedules = schedules.filter((item) => ["SCHEDULED", "QUEUED", "SKIPPED", "FAILED"].includes(item.status)).slice(0, 10);

  return (
    <section className="panel reminder-timing-panel reminder-center">
      <div className="panel-head">
        <div><h2>SMS Reminder Center</h2><p className="muted-text">See whether reminders are ready, when they will send, and what happened after delivery.</p></div>
        <span className={`badge ${readyCount === readiness.length ? "completed" : "pending"}`}>{readyCount}/{readiness.length} ready</span>
      </div>
      {message && <p className="form-message">{message}</p>}

      <div className="reminder-readiness">
        {readiness.map((item) => <article key={item.label} className={item.done ? "ready" : ""}><CheckCircle2 size={18} /><div><strong>{item.label}</strong><small>{item.done ? "Ready" : item.help}</small></div></article>)}
      </div>

      <form className="compact-form labeled-form reminder-automation-form" onSubmit={save}>
        <label className="toggle-setting">
          <span><strong>Automatic reminders</strong><small>When enabled, upcoming active appointments get visible SMS reminder records and queue jobs.</small></span>
          <span className="switch-control"><input type="checkbox" checked={settings.automaticEnabled} onChange={(event) => setSettings({ ...settings, automaticEnabled: event.target.checked })} /><i /></span>
        </label>
        <fieldset className="reminder-presets" disabled={!settings.automaticEnabled}>
          <legend>Send before the appointment</legend>
          {presets.map((preset) => <label key={preset.minutes}><input type="checkbox" checked={settings.offsetsMinutes.includes(preset.minutes)} onChange={() => toggleOffset(preset.minutes)} /><span>{preset.label}</span></label>)}
        </fieldset>
        <div className="custom-reminder-time">
          <label>Custom hours before<input type="number" min="0.25" max="168" step="0.25" value={customHours} disabled={!settings.automaticEnabled} onChange={(event) => setCustomHours(event.target.value)} /></label>
          <button type="button" className="secondary" disabled={!settings.automaticEnabled} onClick={addCustomOffset}>Add timing</button>
        </div>
        {settings.automaticEnabled && <div className="selected-reminders">{settings.offsetsMinutes.map((minutes) => <button type="button" key={minutes} title="Remove timing" onClick={() => toggleOffset(minutes)}>{timingLabel(minutes)} <X size={13} /></button>)}</div>}
        <button className="primary" disabled={busy}>{busy ? "Updating appointments..." : "Save reminder schedule"}</button>
      </form>

      <div className="reminder-queue-list">
        <div className="section-title"><span><Clock /></span><div><h3>Upcoming SMS reminder records</h3><p>Scheduled and skipped reminders are shown before send time.</p></div></div>
        {upcomingSchedules.length === 0 ? <p className="muted-text">No scheduled SMS reminders yet. Save the schedule or create an upcoming appointment with SMS consent.</p> : upcomingSchedules.map((item) => (
          <article key={item.id} className={`reminder-schedule-row status-${item.status.toLowerCase()}`}>
            <span className={`status-dot ${item.status.toLowerCase()}`} />
            <div>
              <strong>{item.appointment.customer.name}</strong>
              <small>{item.appointment.service.name} with {item.appointment.staff.name}</small>
              {(item.skipReason || item.lastError) && <em>{item.skipReason || item.lastError}</em>}
            </div>
            <span>{item.status}</span>
            <time>{new Date(item.scheduledFor).toLocaleString()}</time>
          </article>
        ))}
      </div>

      <div className="reminder-activity">
        <h3>Recent delivery activity</h3>
        {logs.length === 0 ? <p className="muted-text">No notification attempts yet.</p> : logs.slice(0, 8).map((log) => <div key={log.id}><span className={`status-dot ${log.status.toLowerCase()}`} /><div><strong>{log.appointment?.customer.name ?? "Customer"}</strong><small>{log.appointment?.service.name ?? log.type.replaceAll("_", " ")} - {log.channel} · {log.attemptCount ?? 1} attempt(s)</small></div><span>{log.status}</span><time>{new Date(log.createdAt).toLocaleString()}</time>{log.status === "FAILED" && <button className="secondary" type="button" onClick={() => void retryVendorNotification(log.id).then(() => { setMessage("Notification retry queued."); void loadReminderData(); })}>Retry</button>}</div>)}
      </div>
    </section>
  );
}

function ReminderTimingPanel() {
  const presets = [{ minutes: 10_080, label: "1 week" }, { minutes: 1440, label: "1 day" }, { minutes: 120, label: "2 hours" }, { minutes: 60, label: "1 hour" }];
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [logs, setLogs] = useState<VendorNotificationLog[]>([]);
  const [customHours, setCustomHours] = useState("4");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadReminderData = useCallback(() => Promise.all([getReminderSettings(), listVendorNotificationLogs()])
    .then(([loadedSettings, loadedLogs]) => { setSettings(loadedSettings); setLogs(loadedLogs); }), []);
  useEffect(() => {
    void loadReminderData().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load reminder settings"));
    return subscribeToLiveEvents((resources) => { if (resources.includes("notifications")) void loadReminderData(); });
  }, [loadReminderData]);

  function toggleOffset(minutes: number) {
    if (!settings) return;
    const exists = settings.offsetsMinutes.includes(minutes);
    setSettings({ ...settings, offsetsMinutes: exists ? settings.offsetsMinutes.filter((item) => item !== minutes) : [...settings.offsetsMinutes, minutes].sort((a, b) => b - a) });
  }

  function addCustomOffset() {
    if (!settings) return;
    const minutes = Math.round(Number(customHours) * 60);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 10_080) return setMessage("Custom timing must be between 15 minutes and 1 week.");
    if (settings.offsetsMinutes.includes(minutes)) return setMessage("That reminder timing is already selected.");
    if (settings.offsetsMinutes.length >= 6) return setMessage("Choose up to six automatic reminders.");
    setSettings({ ...settings, offsetsMinutes: [...settings.offsetsMinutes, minutes].sort((a, b) => b - a) });
    setMessage("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    if (settings.automaticEnabled && settings.offsetsMinutes.length === 0) return setMessage("Choose at least one timing, or switch to Manual only.");
    setBusy(true);
    setMessage("");
    try {
      const updated = await updateReminderSettings(settings);
      setSettings(updated);
      setMessage(`Reminder schedule saved for ${updated.rescheduledAppointments ?? 0} upcoming appointments.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save reminder schedule");
    } finally { setBusy(false); }
  }

  function timingLabel(minutes: number) {
    if (minutes % 10_080 === 0) return `${minutes / 10_080} week${minutes === 10_080 ? "" : "s"}`;
    if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
    if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
    return `${minutes} minutes`;
  }

  if (!settings) return <section className="panel workspace-state"><span className="loading-line" /><strong>Loading reminder schedule</strong>{message && <p>{message}</p>}</section>;
  return <section className="panel reminder-timing-panel"><div className="panel-head"><div><h2>Reminder timing</h2><p className="muted-text">Choose when automatic reminders enter the delivery queue.</p></div><span className={`badge ${settings.automaticEnabled ? "completed" : "pending"}`}>{settings.automaticEnabled ? "Automatic" : "Manual only"}</span></div>{message && <p className="form-message">{message}</p>}<form className="compact-form labeled-form" onSubmit={save}><label className="toggle-setting"><span><strong>Automatic reminders</strong><small>Turn this off when reminders should only be sent from an appointment.</small></span><span className="switch-control"><input type="checkbox" checked={settings.automaticEnabled} onChange={(event) => setSettings({ ...settings, automaticEnabled: event.target.checked })} /><i /></span></label><fieldset className="reminder-presets" disabled={!settings.automaticEnabled}><legend>Send before the appointment</legend>{presets.map((preset) => <label key={preset.minutes}><input type="checkbox" checked={settings.offsetsMinutes.includes(preset.minutes)} onChange={() => toggleOffset(preset.minutes)} /><span>{preset.label}</span></label>)}</fieldset><div className="custom-reminder-time"><label>Custom hours before<input type="number" min="0.25" max="168" step="0.25" value={customHours} disabled={!settings.automaticEnabled} onChange={(event) => setCustomHours(event.target.value)} /></label><button type="button" className="secondary" disabled={!settings.automaticEnabled} onClick={addCustomOffset}>Add timing</button></div>{settings.automaticEnabled && <div className="selected-reminders">{settings.offsetsMinutes.map((minutes) => <button type="button" key={minutes} title="Remove timing" onClick={() => toggleOffset(minutes)}>{timingLabel(minutes)} <X size={13} /></button>)}</div>}<button className="primary" disabled={busy}>{busy ? "Updating appointments..." : "Save reminder schedule"}</button></form><div className="reminder-activity"><h3>Recent delivery activity</h3>{logs.length === 0 ? <p className="muted-text">No notification attempts yet.</p> : logs.slice(0, 8).map((log) => <div key={log.id}><span className={`status-dot ${log.status.toLowerCase()}`} /><div><strong>{log.appointment?.customer.name ?? "Customer"}</strong><small>{log.appointment?.service.name ?? log.type.replaceAll("_", " ")} - {log.channel} · {log.attemptCount ?? 1} attempt(s)</small></div><span>{log.status}</span><time>{new Date(log.createdAt).toLocaleString()}</time>{log.status === "FAILED" && <button className="secondary" type="button" onClick={() => void retryVendorNotification(log.id).then(() => setMessage("Notification retry queued."))}>Retry</button>}</div>)}</div></section>;
}

function AvailabilityRules({ availability, branches, staff, onChanged }: { availability: AvailabilitySettings; branches: Branch[]; staff: StaffMember[]; onChanged: () => Promise<void> }) {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const [message, setMessage] = useState("");
  const [hoursScope, setHoursScope] = useState<ScheduleScope>("vendor");
  const [hoursTarget, setHoursTarget] = useState("");
  const [breakScope, setBreakScope] = useState<ScheduleScope>("vendor");
  const [breakTarget, setBreakTarget] = useState("");
  const [holidayScope, setHolidayScope] = useState<ScheduleScope>("vendor");
  const [holidayTarget, setHolidayTarget] = useState("");
  const [weeklyHours, setWeeklyHours] = useState(() => weekdayNames.map((_, weekday) => ({ weekday, open: false, startTime: "09:00", endTime: "17:00" })));

  useEffect(() => {
    const selected = availability.workingHours.filter((item) => hoursScope === "vendor"
      ? !item.branchId && !item.staffId
      : hoursScope === "branch"
        ? Boolean(hoursTarget) && item.branchId === hoursTarget && !item.staffId
        : Boolean(hoursTarget) && item.staffId === hoursTarget);
    setWeeklyHours(weekdayNames.map((_, weekday) => {
      const existing = selected.find((item) => item.weekday === weekday);
      return { weekday, open: Boolean(existing), startTime: existing?.startTime ?? "09:00", endTime: existing?.endTime ?? "17:00" };
    }));
  }, [availability.workingHours, hoursScope, hoursTarget]);

  async function saveHours(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await replaceWorkingHours({ scope: hoursScope, branchId: hoursScope === "branch" ? hoursTarget : undefined, staffId: hoursScope === "staff" ? hoursTarget : undefined, hours: weeklyHours.filter((item) => item.open).map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })) });
      await onChanged();
      setMessage("Weekly hours saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save weekly hours"); }
  }

  async function addBreak(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    try {
      await createBreakTime({ branchId: breakScope === "branch" ? breakTarget : undefined, staffId: breakScope === "staff" ? breakTarget : undefined, weekday: Number(form.get("weekday")), startTime: String(form.get("startTime")), endTime: String(form.get("endTime")) });
      formElement.reset();
      await onChanged();
      setMessage("Recurring break added.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add recurring break"); }
  }

  async function addHoliday(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("");
    try {
      await createHoliday({ branchId: holidayScope === "branch" ? holidayTarget : undefined, staffId: holidayScope === "staff" ? holidayTarget : undefined, date: String(form.get("date")), reason: String(form.get("reason")) || undefined });
      formElement.reset();
      await onChanged();
      setMessage("Closed date added.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add closed date"); }
  }

  async function removeRule(action: () => Promise<unknown>, success: string) {
    setMessage("");
    try { await action(); await onChanged(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove rule"); }
  }

  function scopeLabel(branchId?: string | null, staffId?: string | null) {
    if (staffId) return staff.find((item) => item.id === staffId)?.name ?? "Staff member";
    if (branchId) return branches.find((item) => item.id === branchId)?.name ?? "Branch";
    return "Entire business";
  }

  return <div className="availability-page">{message && <p className="form-message resource-message">{message}</p>}<section className="panel availability-intro"><div className="resource-icon"><Clock /></div><div><h2>Booking availability</h2><p>Set bookable hours, recurring breaks, and one-off closures.</p></div><div className="availability-count"><strong>{availability.workingHours.length}</strong><span>weekly rules</span></div></section><div className="availability-layout"><section className="panel availability-editor">
    <div className="schedule-editor-section"><div className="section-title"><span><Clock /></span><div><h2>Weekly opening hours</h2><p>Choose who this schedule applies to, then mark each day open or closed.</p></div></div><form className="compact-form labeled-form" onSubmit={saveHours}><ScheduleScopePicker scope={hoursScope} target={hoursTarget} onScope={setHoursScope} onTarget={setHoursTarget} branches={branches} staff={staff} /><div className="weekly-hours-editor">{weeklyHours.map((item) => <div className={`weekly-day-row${item.open ? " open" : ""}`} key={item.weekday}><label className="day-toggle"><input type="checkbox" checked={item.open} onChange={(event) => setWeeklyHours((current) => current.map((day) => day.weekday === item.weekday ? { ...day, open: event.target.checked } : day))} /><span>{weekdayNames[item.weekday]}</span></label>{item.open ? <div className="day-time-range"><label>Open<input type="time" value={item.startTime} onChange={(event) => setWeeklyHours((current) => current.map((day) => day.weekday === item.weekday ? { ...day, startTime: event.target.value } : day))} required /></label><span>to</span><label>Close<input type="time" value={item.endTime} onChange={(event) => setWeeklyHours((current) => current.map((day) => day.weekday === item.weekday ? { ...day, endTime: event.target.value } : day))} required /></label></div> : <strong>Closed</strong>}</div>)}</div><button className="primary" disabled={hoursScope !== "vendor" && !hoursTarget}>Save weekly hours</button></form></div>
    <div className="schedule-editor-section"><div className="section-title"><span><Coffee /></span><div><h2>Recurring break</h2><p>Block a repeated period such as lunch.</p></div></div><form className="compact-form labeled-form" onSubmit={addBreak}><ScheduleScopePicker scope={breakScope} target={breakTarget} onScope={setBreakScope} onTarget={setBreakTarget} branches={branches} staff={staff} /><label>Day<select name="weekday" defaultValue="1">{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label><div className="form-split"><label>Starts at<input name="startTime" type="time" defaultValue="12:00" required /></label><label>Ends at<input name="endTime" type="time" defaultValue="13:00" required /></label></div><button className="secondary" disabled={breakScope !== "vendor" && !breakTarget}>Add recurring break</button></form></div>
    <div className="schedule-editor-section"><div className="section-title"><span><CalendarOff /></span><div><h2>Closed date</h2><p>Block a holiday, leave, or one-off closure.</p></div></div><form className="compact-form labeled-form" onSubmit={addHoliday}><ScheduleScopePicker scope={holidayScope} target={holidayTarget} onScope={setHolidayScope} onTarget={setHolidayTarget} branches={branches} staff={staff} /><label>Date<input name="date" type="date" required /></label><label>Reason <span>Optional</span><input name="reason" placeholder="e.g. Public holiday" /></label><button className="secondary" disabled={holidayScope !== "vendor" && !holidayTarget}>Add closed date</button></form></div>
  </section><aside className="panel schedule-summary"><div className="panel-head"><div><h2>Current rules</h2><p className="muted-text">Applied by the booking engine.</p></div></div><div className="schedule-rule-group"><h3><Clock size={16} /> Weekly hours</h3>{availability.workingHours.length === 0 ? <p className="empty-copy">No opening hours set.</p> : availability.workingHours.map((item) => <ScheduleRule key={item.id} primary={weekdays[item.weekday]} secondary={`${item.startTime} - ${item.endTime}`} scope={scopeLabel(item.branchId, item.staffId)} />)}</div><div className="schedule-rule-group"><h3><Coffee size={16} /> Breaks</h3>{availability.breakTimes.length === 0 ? <p className="empty-copy">No recurring breaks.</p> : availability.breakTimes.map((item) => <ScheduleRule key={item.id} primary={weekdays[item.weekday]} secondary={`${item.startTime} - ${item.endTime}`} scope={scopeLabel(item.branchId, item.staffId)} onRemove={() => void removeRule(() => deleteBreakTime(item.id), "Break removed.")} />)}</div><div className="schedule-rule-group"><h3><CalendarOff size={16} /> Closed dates</h3>{availability.holidays.length === 0 ? <p className="empty-copy">No closed dates.</p> : availability.holidays.map((item) => <ScheduleRule key={item.id} primary={String(item.date).slice(0, 10)} secondary={item.reason ?? "Closed"} scope={scopeLabel(item.branchId, item.staffId)} onRemove={() => void removeRule(() => deleteHoliday(item.id), "Closed date removed.")} />)}</div></aside></div></div>;
}

type ScheduleScope = "vendor" | "branch" | "staff";

function ScheduleScopePicker({ scope, target, onScope, onTarget, branches, staff }: { scope: ScheduleScope; target: string; onScope: (scope: ScheduleScope) => void; onTarget: (value: string) => void; branches: Branch[]; staff: StaffMember[] }) {
  function choose(next: ScheduleScope) { onScope(next); onTarget(""); }
  return <div className="scope-picker"><span>Applies to</span><div className="segmented-control"><button type="button" className={scope === "vendor" ? "selected" : ""} onClick={() => choose("vendor")}>Entire business</button><button type="button" className={scope === "branch" ? "selected" : ""} onClick={() => choose("branch")}>One branch</button><button type="button" className={scope === "staff" ? "selected" : ""} onClick={() => choose("staff")}>One staff member</button></div>{scope === "branch" && <select aria-label="Choose branch" value={target} onChange={(event) => onTarget(event.target.value)} required><option value="">Choose a branch</option>{branches.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}{scope === "staff" && <select aria-label="Choose staff member" value={target} onChange={(event) => onTarget(event.target.value)} required><option value="">Choose a staff member</option>{staff.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</div>;
}

function ScheduleRule({ primary, secondary, scope, onRemove }: { primary: string; secondary: string; scope: string; onRemove?: () => void }) {
  return <div className={`schedule-rule${onRemove ? " removable" : ""}`}><strong>{primary}</strong><span>{secondary}</span><small>{scope}</small>{onRemove && <button className="icon-action danger" title="Remove rule" onClick={onRemove}><Trash2 size={16} /></button>}</div>;
}
