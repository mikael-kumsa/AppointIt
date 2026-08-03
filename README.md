# AppointIt

Production-oriented multi-vendor appointment management SaaS foundation.

## What is included

- Multi-tenant vendor model with super admin and vendor-scoped users.
- Branches, staff, services, customers, working hours, breaks, holidays, and appointments.
- Booking engine with service duration, buffer times, staff qualification, working-hour checks, holidays, breaks, and overlap prevention.
- Public booking flow at `/book/:vendorSlug`.
- Vendor dashboard UI with appointments, calendar, customers, staff, services, reports, messaging, and calendar settings surfaces.
- AfroMessage SMS OTP, per-vendor reminder credentials, delivery callbacks, and notification logs.
- Google Calendar OAuth connection, event sync, sync logs, and ICS appointment export.
- BullMQ notification queue and worker package.
- Prisma schema, seed data, Docker Compose for PostgreSQL and Redis, and focused tests for booking rules.
- API route tests for signup, phone-verification handoff, tenant access, public booking, and appointment conflicts.

Paid subscriptions use a Telebirr SMS reconciliation flow. A vendor pays the exact invoice amount, submits the Telebirr transaction number, and an authenticated Android SMS forwarder sends incoming credit messages from `127` to the platform. Exact transaction and amount matches activate the subscription automatically.
New vendors begin as `PENDING_REVIEW`. Payment activates the subscription; successful owner phone verification separately activates the vendor identity. Both checks are required before workspace access.

## Subscription plans

- Plans are database-backed and fully configurable by Super Admin under **Subscription plans**.
- The initial catalogue contains `STANDARD`, `PREMIUM`, and `ENTERPRISE`; names, descriptions, prices, ordering, visibility, limits, and capabilities are editable.
- Publishing changes creates an immutable plan version. Existing subscriptions remain on their assigned version until a super admin changes them.
- Plans in use are archived rather than deleted, preserving subscription history.
- Vendor subscriptions have independent lifecycle status (`PENDING`, `ACTIVE`, `PAST_DUE`, `CANCELLED`, or `EXPIRED`).
- New signups retain the plan selected from public pricing and receive a pending monthly Telebirr invoice.
- Branch and staff limits are enforced by the API. Custom-domain access is entitlement-based rather than inferred from a plan name.
- Public pricing loads the current published catalogue from `/api/plans/public`; no plan or price is hardcoded in the landing page.
- Public custom-domain requests resolve an exact active `VendorDomain`; a browser-supplied vendor ID is never accepted.
- Moving a vendor to a plan without custom-domain access disables custom-domain routing immediately.
- Vendor owners can renew or change plans from Billing. Expired owners receive a restricted 30-minute renewal session after password login; it can create a Telebirr invoice but cannot access tenant data.
- Active subscriptions are checked every 15 minutes by the worker and move to `EXPIRED` after their paid period ends.
- Super admins can approve or reject uploaded payment proof with a review note; decisions are audited and emailed to the vendor.

Custom-domain setup:

1. Set `PLATFORM_DOMAIN`, `CUSTOM_DOMAIN_A_TARGET`, and `CUSTOM_DOMAIN_CNAME_TARGET`. The A target must be the VM's reserved public IP; the CNAME target must be a hostname, never a URL.
2. Keep `CUSTOM_DOMAIN_PROVIDER=manual` for the current Caddy deployment. A Premium vendor enters a hostname such as `book.vendor.com`, adds either the displayed A record (recommended today) or CNAME record, and selects **Check DNS**.
3. The API activates only a hostname whose DNS resolves to the configured target. Caddy's guarded On-Demand TLS then obtains and renews its HTTPS certificate automatically.
4. Do not enter `https://`, a path, or an IP address in the vendor hostname field. Remove conflicting A, AAAA, or CNAME records for the same DNS name before verification.
5. Set `VITE_PLATFORM_HOSTS` to AppointIt's own frontend hostnames so any other validated hostname opens the public booking flow.

DNS terminology:

- An A record points a hostname directly to the clean static IP, for example `book.vendor.com -> 34.32.52.83`.
- A CNAME points a hostname to another hostname, for example `book.vendor.com -> domains.appointit.com`. It cannot point to `https://...` or include a path.
- Prefer the A record until AppointIt has a permanent branded CNAME target. Later, `domains.appointit.com` can point to the VM or load balancer and vendors will not need DNS changes when infrastructure moves.

Cloudflare-backed domains are considered active only when hostname status and SSL status are both `active`. The API dynamically allows CORS only for the platform origin and active custom-domain vendors.

## Local setup

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Default seed logins:

- Super admin: `super@appointit.local` / `Password123!`
- Vendor admin: `admin@addisdental.local` / `Password123!`

Vendor lifecycle:

1. A business completes the onboarding wizard at `/signup`.
2. The API transaction creates the owner, first branch, service, provider assignment, and default working hours.
3. The owner pays the exact Telebirr amount shown at `/payment` and submits the transaction number.
4. The SMS gateway forwards the matching credit message and the subscription becomes `ACTIVE`.
5. The owner signs in and verifies the business phone with a six-digit SMS code.
6. Successful phone verification changes the vendor to `ACTIVE` automatically.
7. The owner signs in and opens the live workspace at `/dashboard`; super admins retain oversight at `/admin`.

## Telebirr payment gateway

Configure the Android SMS forwarder to send only messages received from sender `127`:

```http
POST https://YOUR_DOMAIN/api/webhooks/telebirr-sms
Content-Type: application/json
X-Gateway-Token: YOUR_TELEBIRR_SMS_GATEWAY_SECRET

{
  "sender": "127",
  "deviceId": "payments-phone-1",
  "message": "Dear Michael ... Your transaction number is DFT3DDIXIX. ..."
}
```

Set `TELEBIRR_PAYMENT_PHONE` to the receiving Telebirr number and use a long random `TELEBIRR_SMS_GATEWAY_SECRET`. The endpoint rejects other senders, encrypts the original SMS at rest, deduplicates messages and transaction IDs, and activates a subscription only when both the submitted transaction number and exact ETB amount match. Messages may arrive before or after the vendor submits the transaction number.

Transaction matching waits for 20 seconds before allowing a corrected transaction number. Customers can alternatively upload a validated JPG, PNG, WebP, or PDF receipt of up to 5 MB. Proof is stored with the invoice, placed in the super-admin review queue, and never exposed through public payment APIs.

## Apps

- Landing page: `http://localhost:4200`
- Login: `http://localhost:4200/login`
- Vendor signup: `http://localhost:4200/signup`
- Vendor dashboard: `http://localhost:4200/dashboard`
- Super admin dashboard: `http://localhost:4200/admin`
- API: `http://localhost:4201`
- Public booking: `http://localhost:4200/book/addis-dental-clinic`

`/dashboard` and `/admin` are protected routes and only render authenticated live data. `/book/:slug` exposes a limited public vendor profile and accepts bookings only for active vendors. Development builds retain a booking-page preview fallback; production builds show explicit unavailable states instead of demo data.

Vendor dashboard management now includes:

- Add branches.
- Add services with price, duration, and buffer times.
- Add staff and assign services.
- Deactivate branches, services, and staff without deleting appointment history.
- Edit customer contact details, consent, and notes.
- Real day, week, and month calendar periods with staff, branch, and status filters.
- Date-filtered reports for appointment outcomes, revenue estimates, popular services, staff performance, and upcoming visits.
- Billing and Telebirr renewal/plan-change invoices.
- Create receptionist and staff login invites.
- Create appointments manually from the dashboard.
- Reschedule, cancel, complete, and mark appointments as no-show.
- View the latest appointment history event in the appointment list.
- Edit customer notes.
- Manage vendor working hours, break times, and holidays from Settings.

Staff and receptionist access:

- Vendor admins create staff profiles and invite receptionist/staff user accounts from Dashboard > Staff.
- Invitees open `/accept-invite?token=...`, set a password, and then log in normally.
- Receptionists can manage appointments and customer notes, but cannot access vendor settings or create staff/services/branches.
- Staff users see only appointments assigned to their linked staff profile and can complete or mark those appointments as no-show.
- Staff users cannot manually create, reschedule, or cancel appointments.

Authentication hardening:

- Access tokens remain short-lived.
- Refresh tokens are stored server-side as hashes and rotated on refresh.
- Logout revokes the active refresh token.
- Password changes revoke active refresh tokens and require login again.
- Password reset creates a one-hour reset token; in development the API returns the reset URL so it can be tested without an email provider.
- Login, logout, password reset, password change, and invite acceptance write audit logs.
- Vendor owners can enable SMS two-factor authentication from Settings > Security after phone verification. Changing the setting requires the current password and revokes active refresh sessions.
- With SMS 2FA enabled, password login creates an AfroMessage challenge and issues tokens only after the code is verified.

Notification delivery:

- Appointment actions enqueue notification jobs.
- The worker processes appointment notification and reminder jobs.
- Confirmed appointments schedule 24-hour and 2-hour reminders relative to the appointment start time.
- Reschedules remove old reminder jobs and create new reminder jobs.
- Cancellations remove pending reminder and follow-up jobs.
- Completed appointments schedule a follow-up/review request.
- Email delivery is sent through SMTP when `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are configured.
- SMS delivery uses each vendor's own AfroMessage credentials and approved business sender name.
- If SMTP or provider adapters are not configured, notification logs are written with `FAILED` status and the reason.
- Telegram login and customer messaging are not used in the current product flow.
- WhatsApp is intentionally deferred for now.

AfroMessage delivery:

- Platform OTP uses one AppointIt AfroMessage account. Set its single bearer token in `AFROMESSAGE_API_TOKEN`. During beta testing, `AFROMESSAGE_SENDER_NAME` and `AFROMESSAGE_IDENTIFIER_ID` may be blank so AfroMessage uses the account defaults; production should use the exact approved sender name and identifier.
- OTP codes are generated and verified by AfroMessage. AppointIt stores only the provider verification ID and an opaque challenge token hash, never the OTP code.
- AfroMessage beta accounts require test recipients to be verified manually in the provider's Contacts screen. Provider errors are logged with phone numbers redacted and are not exposed to end users.
- Every vendor enters its own AfroMessage API token, identifier ID, and approved sender name in Dashboard > Settings. The token is encrypted at rest and is resolved from the appointment tenant by the worker.
- Configure `AFROMESSAGE_CALLBACK_URL` as the public API URL ending in `/api/webhooks/afromessage/status` and set a long random `AFROMESSAGE_CALLBACK_SECRET`. Delivery callbacks update the matching notification log.
- Vendor credentials are used only for appointment messages. The platform OTP credentials are used only for identity verification.
- The legacy GE'EZ and generic HTTP adapters remain in the backend for migration compatibility but are not shown in the current UI.
- Run the bundled gateway locally with:

```bash
npm run dev -w sms-gateway
```

- Or run it through Docker Compose:

```bash
docker compose up -d sms-gateway
```

- The gateway supports two providers:
  - `mock`: accepts requests and writes durable JSONL logs, useful for development and staging.
  - `spool`: writes `.sms` files to `SMS_GATEWAY_SPOOL_DIR` for SMS Server Tools, Gammu, or another modem spooler to send.
- AppointIt sends:

```http
POST /send-sms
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "to": "+251911000001",
  "message": "Appointment reminder...",
  "from": "AppointIt",
  "vendorId": "vendor-id",
  "appointmentId": "appointment-id"
}
```

- The HTTP gateway can be backed by Gammu SMSD, SMS Server Tools, Kannel, SMPP, or any custom modem service.
- Gateway endpoints:
  - `GET /health`
  - `POST /send-sms`
  - `GET /messages`
  - `GET /messages/:id`
- Secure the gateway in production by changing `SMS_GATEWAY_API_KEY`, running it behind TLS or a private network, and mounting persistent storage for `SMS_GATEWAY_LOG_FILE` and the spool directory.
- When run with `npm run dev -w sms-gateway`, the gateway reads `sms-gateway/.env` first and then the root `.env`.

SMS phone verification:

- Password validation happens before AppointIt requests an OTP, preventing unauthenticated code sends for arbitrary accounts.
- Login is completed only after AfroMessage verifies the code. Challenges expire after five minutes, resends have a cooldown, attempts are limited, and OTP routes are rate limited.
- Successful owner verification marks both the user and vendor phone as verified and changes a new vendor from `PENDING_REVIEW` to `ACTIVE`.
- Manual activation by a super admin remains blocked until the vendor phone is verified.

Google Calendar sync:

- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env`.
- Add the redirect URI to the Google Cloud OAuth client.
- Vendors connect from Dashboard > Settings > Google Calendar.
- Confirmed appointments create Google Calendar events, reschedules update the event, and cancellations delete it.
- Sync results are stored in `CalendarSyncLog`; missing calendar connection is treated as a no-op.

Run the worker:

```bash
npm run dev -w worker
```

If Vite dev server hits `spawn EPERM` on Windows, use the static production server instead:

```bash
npm run build -w client
npm run serve:client
```

## Google Cloud VM deployment

The production stack is defined in `compose.production.yml`. It runs Caddy, the compiled web app, API, queue worker, PostgreSQL, Redis, and one-shot Prisma migrations. Only ports 80 and 443 are published.

Prerequisites:

- A Google Cloud project with billing enabled.
- A domain or subdomain you control, such as `app.example.com`.
- The repository available from the VM through Git or a secure upload.

Run the following from Google Cloud Shell, replacing the project ID. `me-central1-b` is Doha; choose another region after measuring latency if needed.

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable compute.googleapis.com

gcloud compute addresses create appointit-ip --region=me-central1

gcloud compute instances create appointit-prod \
  --zone=me-central1-b \
  --machine-type=e2-medium \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-balanced \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --address=appointit-ip \
  --tags=appointit-web

gcloud compute firewall-rules create appointit-allow-web \
  --allow=tcp:80,tcp:443,udp:443 \
  --target-tags=appointit-web

gcloud compute addresses describe appointit-ip \
  --region=me-central1 \
  --format='value(address)'
```

Create an `A` record for the production hostname pointing to the printed static IP. Then connect:

```bash
gcloud compute ssh appointit-prod --zone=me-central1-b
```

On the VM, clone the repository and run:

```bash
cd AppointIt
sudo bash deploy/bootstrap-vm.sh
exit
```

Reconnect so Docker group membership applies. Configure production secrets and deploy:

```bash
cd AppointIt
cp .env.production.example .env.production
nano .env.production
bash deploy/deploy.sh
```

Create the first production super admin once, using a temporary environment file or shell session rather than storing the password in `.env.production`:

```bash
ADMIN_NAME="Platform Admin" \
ADMIN_EMAIL="owner@example.com" \
ADMIN_PASSWORD="use-a-long-random-password" \
docker compose --env-file .env.production -f compose.production.yml \
  exec -T api node server/prisma/bootstrap-admin.cjs
```

Set `APP_DOMAIN`, `APP_ORIGIN`, `PASSWORD_RESET_ORIGIN`, OAuth redirects, and callback URLs to the real HTTPS hostname. Never use localhost or ngrok in production email links. Caddy requests and renews the TLS certificate after DNS points to the VM.

Operations:

```bash
# Status and logs
docker compose --env-file .env.production -f compose.production.yml ps
docker compose --env-file .env.production -f compose.production.yml logs -f api worker web

# Deploy an update after pulling code
git pull
bash deploy/deploy.sh

# Create a compressed database backup
bash deploy/backup.sh

# Install the daily 02:30 UTC backup timer
bash deploy/install-backup-timer.sh
```

Schedule `deploy/backup.sh` daily and copy backups to a separate system such as a private Cloud Storage bucket. A single VM is appropriate for the first production stage, but PostgreSQL should move to Cloud SQL before requiring multi-zone availability.

Frontend structure note:

- `client/src/main.tsx` is now only the React entrypoint.
- `client/src/App.tsx` handles top-level route selection.
- `client/src/pages/PublicPages.tsx` contains landing, login, signup, and public booking pages.
- `client/src/pages/SuperAdminPageV2.tsx` contains vendor review and versioned subscription-plan management.
- Super Admin also exposes payment decisions, user accounts, audit/webhook/notification logs, and Google Calendar connection health.
- `client/src/pages/VendorDashboard.tsx` contains the vendor workspace screens.
- `client/src/components/common.tsx` and `client/src/lib/format.ts` hold shared UI helpers.

## Important environment variables

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `APP_ORIGIN`
- `PASSWORD_RESET_ORIGIN` (localhost during development; a stable HTTPS application domain in production)
- `PLATFORM_DOMAIN`, `VITE_PLATFORM_HOSTS`, and custom-domain provider variables
- Google OAuth variables
- AfroMessage platform OTP variables
- `TELEBIRR_PAYMENT_PHONE`, `TELEBIRR_SMS_GATEWAY_SECRET`, and `PAYMENT_INVOICE_TTL_HOURS`
- SMTP variables
- Vendor reminder credentials are configured in the dashboard, not global environment variables

## Next production hardening tasks

- Add staff-specific calendar connection controls and deeper calendar conflict import checks.
- Add an SMPP adapter if you connect directly to a carrier instead of a modem/spooler.
- Add WhatsApp template send calls and delivery status mapping if WhatsApp is reintroduced.
- Add CSRF token exchange if cookie-based auth is enabled.
- Add row-level database policies if deploying to a shared Postgres environment.
- Add complete integration tests against a test database.
