import { useEffect, useState, type ReactNode } from "react";
import { CalendarCheck2 } from "lucide-react";
import { api, clearToken, getToken } from "../lib/api";

type Role = "SUPER_ADMIN" | "VENDOR_ADMIN" | "RECEPTIONIST" | "STAFF" | "CUSTOMER";

type AuthContext = {
  role: Role;
  vendorStatus?: string | null;
};

export function AuthGate({ children, roles }: { children: ReactNode; roles: Role[] }) {
  const [state, setState] = useState<"checking" | "allowed">("checking");

  useEffect(() => {
    let active = true;
    const returnTo = `${location.pathname}${location.search}`;

    if (!getToken()) {
      location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    api<AuthContext>("/api/auth/me")
      .then((context) => {
        if (!active) return;
        if (!roles.includes(context.role)) {
          location.replace(context.role === "SUPER_ADMIN" ? "/admin" : "/dashboard");
          return;
        }
        setState("allowed");
      })
      .catch(() => {
        if (!active) return;
        clearToken();
        location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}&session=expired`);
      });

    return () => { active = false; };
  }, [roles]);

  if (state !== "allowed") {
    return (
      <main className="auth-loading" aria-live="polite">
        <CalendarCheck2 size={30} />
        <strong>Opening your workspace</strong>
        <span>Checking your secure session...</span>
      </main>
    );
  }

  return children;
}
