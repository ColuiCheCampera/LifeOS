# LifeOS

Personal life operating system. **Step 0 + M1–M3 complete; M4 in progress**: Google-only identity, strict account allowlist, database sessions, private app shell, editable settings, design system and CI. M2 adds an installable PWA, encrypted offline preferences and durable reconciliation. M3 implements tasks and projects. M4 adds a local offline calendar, task time blocks, separate Google consent, two-way synchronization of nonrecurring events and optional server push updates. Google recurring series and M5–M8 remain pending.

## Local setup

1. Install Node 24 LTS and PostgreSQL 18. `npm ci`.
2. Copy `.env.example` to `.env.local`; supply Google credentials and exact allowlist values (see docs/SETUP_GOOGLE.md). Generate AUTH_SECRET and ENCRYPTION_KEY with `openssl rand -base64 32`; do not use example values in production.
3. `npm run db:migrate`, then `npm run dev`. Open http://localhost:3000.
4. `npm run typecheck`, `npm run lint`, `npm test`, `npx playwright install chromium`, `npm run test:e2e`, `npm run build` (production build requires HTTPS AUTH_URL).

E2E starts isolated ephemeral PostgreSQL on 55439, an OIDC issuer on 4011, and Next dev on 3100. Those ports must be free. The signed test issuer exists only in tests; the application has no test-auth bypass. Run as a regular user, not root. Test fixtures are fake data; production starts empty. `DEMO_MODE=true npm run db:seed` seeds a disconnected fake persona, not an authenticated demo account.

## Docker

Set POSTGRES_PASSWORD in your shell (URL-safe generated value), configure `.env.local` for the public HTTPS origin, then `docker compose up --build`. Compose waits for PostgreSQL and runs migrations before starting the app. Place an HTTPS reverse proxy in front of localhost:3000; preserve the configured Host and strip untrusted forwarding headers. Back up the PostgreSQL volume and encryption key independently. Migration failures stop app startup.

## Vercel

Import this repository, select Node 24 and configure the same server-only env variables with the public HTTPS origin. Use managed PostgreSQL with SSL and pooled connections; run migrations from CI or a trusted administrative job before deploying. Do not expose database credentials as NEXT_PUBLIC variables. Google Calendar requires a separate persistent Node worker running `npm run worker:calendar`; see CALENDAR.md. Its database connection must support session advisory locks (direct connection or session pooling).

## Security and scope

Every private page and API validates an Auth.js database session. Public exceptions are login, OAuth endpoints, static assets and non-sensitive errors. Exact Google sub + exact verified email are required. API mutations require same-origin JSON. Session tokens are hashed; unnecessary OIDC tokens are discarded. Secrets encryption utilities use authenticated encryption with tenant-bound additional data. Idle/absolute timeouts and revoke-all are functional.
See docs/ARCHITECTURE.md, SCHEMA.md, DECISIONS.md, PRODUCT_SPEC.md, and VERIFICATION.md. No email integration or third-party analytics.

## Offline and installation

Use HTTPS (localhost also works). The build generates the Serwist worker and public offline shell. Visit Settings online once, then open the offline workspace or reload the same tab without a connection. Saved preference edits remain encrypted and queue for reconnect; security settings require online access. A new offline tab cannot unlock private data. Offline authorization expires with the server-issued lease. See [offline design and limitations](docs/OFFLINE.md).

Install from the explicit browser prompt; iOS uses Share → Add to Home Screen. Updates require approval and block while edits or queued changes remain. Clear cache removes local keys and pending edits and signs out when online. Background Sync is optional; focus, reconnect and Sync now provide fallbacks.

## Tasks and projects (M3)

Tasks, projects, editable areas and milestones now have real local-first CRUD, quick capture, saved filters, recurrence, a weekly review and keyboard/touch controls. Start with `/tasks` or `/projects`; see [usage and boundaries](docs/TASKS_PROJECTS.md).

## Calendar (M4 in progress)

Open `/calendar` for local events and task time blocks. Connect Google Calendar in Settings → Account, then select calendars in the Calendar page. Nonrecurring events synchronize through the separate worker; publication of local events is explicit, and conflicting changes have a review panel. Apply the new database migrations and register the additional OAuth callback. For manual development run `npm run worker:calendar` alongside the web server; the local launcher and Docker Compose start it automatically. See [Calendar usage, setup and remaining M4 work](docs/CALENDAR.md).

Today now shows ongoing/upcoming events from the encrypted local snapshot. Global search includes event titles, locations and notes; both surfaces open the same event editor and remain usable in an unlocked offline tab.

For a deployed public HTTPS origin, `CALENDAR_PUSH_ENABLED=true` enables watch-channel registration/renewal by the worker after migration 0006. The callback is `/api/calendar/google/notifications`; polling remains active for recovery. Keep the flag false on localhost. See CALENDAR.md for authentication, lifecycle and live-delivery verification requirements.

On the configured personal computer use `./Avvia-LifeOS.sh` (or `npm run local`). It starts the persistent local database, applies migrations and serves the app on loopback port 3000. It uses the private `.env.local`; never copy credentials into documentation or Git. Browser tests run on port 3100 and a separate disposable database.
