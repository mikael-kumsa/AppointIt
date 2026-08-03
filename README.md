# AppointIt

A concise, production-ready multi-vendor appointment booking platform.

This repository contains the backend, worker, and frontend for AppointIt — a multi-tenant scheduling system with vendor workspaces, a public booking flow, notification delivery, and integrations for SMS and Google Calendar.

Highlights

- Multi-tenant vendor model with super-admin and vendor-scoped users
- Branches, staff, services, customers, working hours, holidays, and appointments
- Booking engine with duration, buffers, staff qualifications, working-hour checks, holiday/break handling, and overlap prevention
- Public booking at `/book/:vendorSlug` and vendor dashboard (appointments, calendar, customers, staff, services, billing)
- Notification worker (BullMQ); per-vendor SMS credentials (AfroMessage) and email via SMTP
- Google Calendar sync and ICS export
- Docker Compose for local Postgres and Redis; Prisma schema and seed data

Quick start (development)

1. Install dependencies and copy example env:

```bash
npm install
cp .env.example .env
```

2. Start local services and prepare the database:

```bash
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Development accounts (seeds)

- Super admin: `super@appointit.local` / `Password123!`
- Vendor admin: `admin@addisdental.local` / `Password123!`

Local hosts

- Frontend: http://localhost:4200
- API: http://localhost:4201
- Example public booking: http://localhost:4200/book/addis-dental-clinic

Important env variables (summary)

DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, TOKEN_ENCRYPTION_KEY, APP_ORIGIN, PASSWORD_RESET_ORIGIN, PLATFORM_DOMAIN, VITE_PLATFORM_HOSTS, AFROMESSAGE_*, TELEBIRR_*, SMTP_*, GOOGLE_CLIENT_*

Deployment

- Production is driven by `compose.production.yml` and the `deploy/` scripts (VM bootstrap, deploy, backup).
- See `deploy/` for Google Cloud VM instructions and operational commands.

Where to look next

- Frontend entry: `client/src/main.tsx` and `client/src/App.tsx`
- Key pages: `client/src/pages/PublicPages.tsx`, `client/src/pages/VendorDashboard.tsx`, `client/src/pages/SuperAdminPageV2.tsx`
- Worker and SMS gateway in `sms-gateway/` and `worker/`

If you'd like, I can further shorten this to a 1-page README, add a short architecture diagram, or split detailed operational instructions into a separate CONTRIBUTING.md or DEPLOYMENT.md. Tell me which option you prefer.