/* Legacy implementation retained temporarily for migration history.
import { useEffect, useState } from "react";
import { CalendarDays, MessageCircle, Shield, Users } from "lucide-react";
import { clearToken, listVendors, logout, updateCustomDomainStatus, updateVendorPlan, updateVendorStatus, type VendorDomain, type VendorPlan } from "../lib/api";
import { Metric } from "../components/common";

type AdminVendorRow = {
  id: string;
  name: string;
  businessType: string;
  status: string;
  plan: VendorPlan;
  email: string;
  phoneVerifiedAt?: string | null;
  customDomains: VendorDomain[];
};

export function SuperAdminPage() {
  const [vendors, setVendors] = useState<AdminVendorRow[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const rows = await listVendors();
      setVendors(rows.map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        businessType: vendor.businessType,
        status: vendor.status,
        plan: vendor.plan,
        email: vendor.email ?? "No owner email",
        phoneVerifiedAt: vendor.phoneVerifiedAt ?? null,
        customDomains: vendor.customDomains ?? [],
      })));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load vendors");
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(id: string, status: string) {
    try {
      const updated = await updateVendorStatus(id, status);
      setVendors((current) => current.map((vendor) => vendor.id === id ? { ...vendor, status: updated.status } : vendor));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Status update failed");
    }
  }

  async function changePlan(id: string, plan: VendorPlan) {
    try {
      const updated = await updateVendorPlan(id, plan);
      setVendors((current) => current.map((vendor) => vendor.id === id ? { ...vendor, plan: updated.plan } : vendor));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Plan update failed");
    }
  }

  async function activateDomain(vendorId: string, domainId: string) {
    try {
      const updated = await updateCustomDomainStatus(domainId, "ACTIVE");
      setVendors((current) => current.map((vendor) => vendor.id === vendorId
        ? { ...vendor, customDomains: vendor.customDomains.map((domain) => domain.id === domainId ? updated : domain) }
        : vendor));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Domain activation failed");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const pendingCount = vendors.filter((vendor) => vendor.status === "PENDING_REVIEW").length;
  const activeCount = vendors.filter((vendor) => vendor.status === "ACTIVE").length;
  const suspendedCount = vendors.filter((vendor) => vendor.status === "SUSPENDED").length;

  return (
    <div className="app-shell admin-shell">
      <aside className="sidebar admin-sidebar">
        <div className="brand">
          <span>S</span>
          <div>
            <strong>Platform Admin</strong>
            <small>Verification center</small>
          </div>
        </div>
        <nav>
          <button className="active"><Shield size={18} /> Vendor reviews</button>
          <button><Users size={18} /> Users</button>
          <button><MessageCircle size={18} /> System logs</button>
          <button><CalendarDays size={18} /> Calendar health</button>
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <p>Super admin dashboard</p>
            <h1>Vendor oversight</h1>
          </div>
          <div className="top-actions">
            <button className="secondary" onClick={() => void load()}>{loading ? "Loading..." : "Refresh"}</button>
            <a className="secondary" href="/">Landing page</a>
            <button className="secondary" onClick={() => { void logout().finally(() => { clearToken(); location.href = "/"; }); }}>Logout</button>
          </div>
        </header>
        <section className="metrics">
          <Metric label="Pending review" value={String(pendingCount)} detail="new businesses" />
          <Metric label="Active vendors" value={String(activeCount)} detail="approved workspaces" />
          <Metric label="Suspended" value={String(suspendedCount)} detail="requires follow-up" />
          <Metric label="Total vendors" value={String(vendors.length)} detail="registered workspaces" />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Business accounts</h2>
            <span className="badge active">LIVE DATA</span>
          </div>
          {message && <p className="form-message">{message}</p>}
          <div className="review-list">
            {!loading && vendors.length === 0 && <div className="empty-state"><strong>No vendors yet</strong><span>New business accounts will appear here after signup.</span></div>}
            {vendors.map((vendor) => (
              <ReviewRow
                key={vendor.id}
                name={vendor.name}
                owner={vendor.email}
                type={vendor.businessType}
                status={vendor.status}
                plan={vendor.plan}
                phoneVerifiedAt={vendor.phoneVerifiedAt}
                customDomains={vendor.customDomains}
                onVerify={() => void changeStatus(vendor.id, "ACTIVE")}
                onReject={() => void changeStatus(vendor.id, "SUSPENDED")}
                onPlanChange={(plan) => void changePlan(vendor.id, plan)}
                onDomainActivate={(domainId) => void activateDomain(vendor.id, domainId)}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
*/
export { SuperAdminPage } from "./SuperAdminPageV2";

/*
function ReviewRow({ name, owner, type, status, plan, phoneVerifiedAt, customDomains, onVerify, onReject, onPlanChange, onDomainActivate }: { name: string; owner: string; type: string; status: string; plan: VendorPlan; phoneVerifiedAt?: string | null; customDomains: VendorDomain[]; onVerify: () => void; onReject: () => void; onPlanChange: (plan: VendorPlan) => void; onDomainActivate: (domainId: string) => void }) {
  const phoneVerified = Boolean(phoneVerifiedAt);
  const pendingDomain = customDomains.find((domain) => domain.status === "PENDING");
  return (
    <div className="row review-row">
      <div><strong>{name}</strong><small>{type}</small></div>
      <div><span>{owner}</span><small>{phoneVerified ? "Verified by SMS OTP" : "Waiting for SMS phone verification"}</small></div>
      <span className={`badge ${status === "ACTIVE" ? "confirmed" : "pending"}`}>{status}</span>
      <span className={`badge ${phoneVerified ? "completed" : "pending"}`}>{phoneVerified ? "PHONE VERIFIED" : "PHONE PENDING"}</span>
      <div className="review-actions">
        <select aria-label={`Subscription plan for ${name}`} value={plan} onChange={(event) => onPlanChange(event.target.value as VendorPlan)}>
          <option value="HOSTED">Hosted</option>
          <option value="CUSTOM_DOMAIN">Custom domain</option>
        </select>
        {plan === "CUSTOM_DOMAIN" && pendingDomain && <button onClick={() => onDomainActivate(pendingDomain.id)}>Activate domain</button>}
        {status !== "ACTIVE" && <button disabled={!phoneVerified} onClick={onVerify}>Activate</button>}
        {status !== "SUSPENDED" && <button onClick={onReject}>Suspend</button>}
      </div>
    </div>
  );
}
*/
