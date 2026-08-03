import "./styles.css";
import { AcceptInvitePage, BookingPage, ForgotPasswordPage, LandingPage, LoginPage, ManageBookingPage, PaymentPage, RenewalPage, ResetPasswordPage, SignupPage } from "./pages/PublicPages";
import { SuperAdminPage } from "./pages/SuperAdminPageV2";
import { VendorDashboard } from "./pages/VendorDashboard";
import { AuthGate } from "./components/AuthGate";
import { isCustomBookingHost } from "./lib/hosts";

export default function App() {
  if (location.pathname.startsWith("/manage-booking")) return <ManageBookingPage />;
  if (location.pathname.startsWith("/book/")) return <BookingPage />;
  if (location.pathname === "/" && isCustomBookingHost()) return <BookingPage />;
  if (location.pathname.startsWith("/dashboard")) return <AuthGate roles={["VENDOR_ADMIN", "RECEPTIONIST", "STAFF"]}><VendorDashboard /></AuthGate>;
  if (location.pathname.startsWith("/admin")) return <AuthGate roles={["SUPER_ADMIN"]}><SuperAdminPage /></AuthGate>;
  if (location.pathname.startsWith("/login")) return <LoginPage />;
  if (location.pathname.startsWith("/forgot-password")) return <ForgotPasswordPage />;
  if (location.pathname.startsWith("/reset-password")) return <ResetPasswordPage />;
  if (location.pathname.startsWith("/accept-invite")) return <AcceptInvitePage />;
  if (location.pathname.startsWith("/payment")) return <PaymentPage />;
  if (location.pathname.startsWith("/renew")) return <RenewalPage />;
  if (location.pathname.startsWith("/signup")) return <SignupPage />;
  return <LandingPage />;
}
