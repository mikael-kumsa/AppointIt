import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { appointmentsRouter } from "./modules/appointments/appointments.routes.js";
import { publicRouter } from "./modules/public/public.routes.js";
import { vendorsRouter } from "./modules/vendors/vendors.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";
import { calendarRouter } from "./modules/calendar/calendar.routes.js";
import { webhooksRouter } from "./modules/webhooks/webhooks.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { staffRouter } from "./modules/staff/staff.routes.js";
import { servicesRouter } from "./modules/services/services.routes.js";
import { customersRouter } from "./modules/customers/customers.routes.js";
import { branchesRouter } from "./modules/vendors/branches.routes.js";
import { availabilityRouter } from "./modules/availability/availability.routes.js";
import { domainsRouter } from "./modules/domains/domains.routes.js";
import { plansRouter } from "./modules/plans/plans.routes.js";
import { paymentsRouter } from "./modules/payments/payments.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { allowCorsOrigin } from "./middleware/cors-origin.js";
import { activityRouter } from "./modules/activity/activity.routes.js";

export const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    void allowCorsOrigin(origin)
      .then((allowed) => callback(null, allowed))
      .catch(() => callback(null, false));
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 300 }));

app.get("/health", (_req, res) => res.json({ ok: true, name: "AppointIt API" }));
app.use("/api/auth", authRouter);
app.use("/api/public", publicRouter);
app.use("/api/vendors", vendorsRouter);
app.use("/api/branches", branchesRouter);
app.use("/api/services", servicesRouter);
app.use("/api/staff", staffRouter);
app.use("/api/customers", customersRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/availability", availabilityRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/domains", domainsRouter);
app.use("/api/plans", plansRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/activity", activityRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "Unexpected server error" });
});
