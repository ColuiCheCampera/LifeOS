# M3 quick capture — 29 September 2026

Quick capture now supports project selection and Save and add another, preserves unsaved drafts until explicit discard, prevents duplicate submissions and transfers drafts into the detailed editor without stale reuse. New prefilled records require discard confirmation. Clearing recurrence works; dialog actions wrap on mobile and shortcuts do not stack dialogs over an open editor.

Validation: TypeScript, ESLint, Prettier, 94 unit tests, all 20 Chromium scenarios and the production PWA build passed. Scope audit passed; production client JavaScript is 1,015 KiB gzip against the 1,200 KiB budget. The new browser test verifies project retention, focus restoration, canceled/confirmed discard, duplicate form submissions in both editors, recurrence clearing, offline reload/replay and exactly three persisted tasks. Mobile axe reports zero violations and the capture screenshot was visually inspected.

The expanded suite exposed accumulated rate-limit counters across scenarios. Each scenario now clears only the isolated test database's counters before running; production protections and the dedicated rate-limit test remain intact. The date-edit regression now waits for dialog closure and the server value instead of reading before the asynchronous save finishes. Test services use the separate OIDC issuer and disposable database, with no personal credentials or data. Unsaved drafts remain in memory only; they are not reload-persistent. M4 remains pending.

---

# M3 bulk task actions — 28 September 2026

Added select-all for filtered task lists/Kanban, bulk priority, move-to-Inbox and reopen controls. Bulk writes now await durable local persistence, prevent duplicate submissions and retain failures for retry; deletion requires confirmation with the selected count. Filtering clears stale selection. Individual writes remain independently durable, not an atomic batch.

Validation: TypeScript, ESLint, Prettier, 94 unit tests, all 19 Chromium scenarios and the production PWA build passed. Selected coverage: 97.50% statements, 93.66% branches, 97.40% functions and 98.85% lines. The new unit tests cover sequential writes, partial/total failure and empty selection. The browser scenario covers filtered selection, project/Inbox moves, priority, complete/reopen, canceled and confirmed deletion, offline reload/replay and preservation of unselected tasks. Mobile axe reports zero violations; the mobile bulk-toolbar screenshot was visually inspected.

Scope audit passed; production client JavaScript is 1,014 KiB gzip against the 1,200 KiB budget. One build attempt encountered a malformed generated `.next/dev/types/validator.ts`; removing only the generated development cache resolved it and the subsequent build passed. Tests used isolated OIDC/PostgreSQL services; no personal data or live Google credentials were used. M4 remains pending.

---

# M3 refinements — 28 September 2026

User-requested focus: improve tasks, projects and UI before M4. Added combined project title/goal search, area/status filtering, result counts, reset and contextual empty states. Fixed task date edits retaining the old instant and Cancel bypassing the unsaved-change confirmation.

Validated on Windows with Node 24: typecheck, ESLint, Prettier, 92 unit tests, all 18 Chromium scenarios and the production PWA build passed. Selected coverage: 97.44% statements, 93.66% branches, 97.36% functions and 98.82% lines. Scope audit passed; client JavaScript is 1,013 KiB gzip against the 1,200 KiB budget.

The added browser scenario verifies project filtering/reset, keeping or discarding edits, preserving 17:00 Europe/Rome when rescheduling across the March DST boundary, mobile offline filtering and zero axe violations. Desktop and mobile project screenshots were visually inspected. `.gitattributes` prevents CRLF-only formatting failures; isolated Windows PostgreSQL tests use synchronous I/O to avoid orphan workers on forced shutdown. Port 55439 was confirmed released after the final suite. No personal database, live Google configuration or deployment was changed. M4 remains pending.

---

# M3 verification — 26 September 2026

Tasks, projects, areas, milestones, saved filters, quick capture, command palette, review, deadline views and encrypted offline mutations are implemented. See TASKS_PROJECTS.md for supported behavior and boundaries. Calendar integration remains M4; gesture and shortcut remapping remains future settings work.

Validation: 91 unit tests passed; selected coverage is 97.44% statements, 93.88% branches, 97.33% functions and 98.82% lines. Chromium scenarios cover task CRUD and views, projects and progress, offline reload/replay, tenant isolation, field reconciliation, recurring completion, mobile gestures and accessibility. All 17 scenarios passed on 26 September; desktop projects and mobile navigation screenshots were visually inspected. TypeScript, ESLint, Prettier and the production Next.js/PWA build passed. M3 screenshots use an isolated test persona.

The desktop database migration was applied successfully after a cold backup at `.local/backups/postgres-before-m3.tar.gz` (excluded from Git). Drizzle regeneration reports no schema drift. Scope audit passed and npm audit reported zero vulnerabilities. Production client JavaScript is approximately 1,012 KiB gzip against the 1,200 KiB budget.

Deleted records reject queued field edits as acknowledged conflicts, preventing an obsolete edit from blocking later synchronization. Receipts store changed records rather than duplicating the entire snapshot.

Browser tests use a signed mock OIDC provider and disposable PostgreSQL on separate ports. They do not verify live Google UI, physical-device installation, OS background scheduling, Docker or remote CI. Existing credentials and personal data are excluded from Git.

---

# M2 verification — 25 September 2026

## Completed scope

Installable manifest and icons, public Serwist offline shell, explicit install/update controls, encrypted Dexie settings cache and durable queue, TanStack optimistic state, per-field reconciliation, transactional replay receipts, background sync with online/focus fallback, cache controls and cross-tab session locking. M3–M8 remain pending.

| Check                             | Result                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| TypeScript, ESLint, Prettier      | Passed                                                                                          |
| Vitest                            | 53 tests passed                                                                                 |
| Selected domain/security coverage | 95.17% statements, 88.75% branches, 100% functions, 98.44% lines; 80% minimum enforced          |
| Playwright Chromium               | All 12 scenarios passed                                                                         |
| Production Next.js + PWA build    | Passed; 13 public precache assets, approximately 1,085 KiB uncompressed                         |
| Client JavaScript                 | 783 KiB gzip including all route chunks, standalone offline bundle and worker; 1,200 KiB budget |
| Database migration                | Applied during browser tests against isolated PostgreSQL; regeneration reports no drift         |
| Scope and dependency audits       | Passed; zero reported npm vulnerabilities                                                       |

M2 browser scenarios exercise manifest assets/public-only caches, locked cold offline navigation, encrypted edits surviving reload and reconnect, duplicate replay and conflicts, invalid/future/security-field mutations, expired leases, cross-tab logout/key erasure, user-triggered install/dismissal, and a real waiting service-worker update blocked until unsaved edits are saved. M1 scenarios remain in the suite, including axe checks for login and desktop/mobile settings. Screenshots prefixed m2 in docs/screenshots are captured from the test persona; the offline screenshot was visually inspected.

The build needed permission to bind Turbopack's local subprocess port. No production service was deployed. Physical-device installation, Safari/Edge execution, OS background scheduling, live Google consent, Docker execution and external CI execution remain unverified. The offline lease and encryption threat model are documented in OFFLINE.md. The offline cache is not a backup; a cold offline tab cannot unlock it.

Coverage percentages apply to the configured pure domain/security/environment logic and local vault. Server database services and client integration are covered by browser scenarios, not included in that percentage.

---

# M1 verification — 24 September 2026

## Completed scope

Step 0 documentation and M1: Next.js/TypeScript scaffold, Italian/English i18n, responsive light/dark design tokens, Google-only Auth.js allowlist, PostgreSQL/Drizzle migration, hashed database sessions, idle/absolute expiry, token rotation, session listing and revoke-all, server-persisted settings with version checks, CSP/CSRF/rate limits, logging, Docker/Compose and GitHub Actions configuration.

## Local evidence

| Check                                                             | Result                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| TypeScript strict typecheck                                       | Passed                                                                                |
| ESLint, zero warnings                                             | Passed                                                                                |
| Vitest                                                            | 34 tests passed                                                                       |
| Pure security, settings validation and environment logic coverage | 100% statements, branches, functions and lines; 80% enforced minimum                  |
| Playwright Chromium                                               | 6 scenarios passed, desktop 1280×720 and mobile 390×844                               |
| axe                                                               | No violations on tested login, desktop light settings and mobile dark settings states |
| Production Next.js build                                          | Passed; all application routes dynamically server rendered                            |
| Drizzle migration                                                 | Applied to real isolated PostgreSQL; regenerating finds no schema drift               |
| Scope audit                                                       | Passed against source and built output                                                |
| Client JavaScript budget                                          | 365 KiB gzip across all production chunks; 1,200 KiB ceiling                          |
| npm dependency audit                                              | Zero reported vulnerabilities after scoped development dependency override            |

The browser suite covers allowed signed OIDC authentication; wrong sub, wrong email and unverified email producing no user/account/session rows; every private page/API unauthenticated; settings persistence and stale-version rejection; same-origin enforcement, oversized body rejection and invalid settings; session listing; keyboard theme selection and Italian-to-English switching and document language after clearing the locale cookie; idle/absolute expiry; token rotation; revoke-all; Auth.js CSRF rejection; and the durable rate limiter.

Screenshots in `docs/screenshots/` were captured from these tests using a fake test persona. Test OAuth is an isolated HTTP service importing the same production auth configuration/adapter; it overrides only provider endpoints. It never ships as an application route. Tests exercise PKCE, state, nonce and a signed ID-token exchange. Real Google consent has not been exercised.

## Boundaries and pending work

- Live Google credentials, allowlist subject/email, production secrets, HTTPS origin and production database must be supplied by the operator. No live account was connected or deployed.
- Docker/Compose and Vercel instructions are supplied; Docker execution and Vercel deployment were not tested in this environment. The CI workflow is checked in; no GitHub remote/run was created.
- Mobile testing is Chromium at a phone viewport, not a physical iPhone/Android install test. Full PWA install/offline tests start in M2; Lighthouse targets and cross-browser hardening belong to M8.
- M2–M8 remain pending. No tasks, calendar, finance, travel, AI, push, app lock or data portability features are claimed complete.
- Coverage figures apply to pure domain/security/environment logic. Database adapters and services are exercised through browser tests, not included in the unit coverage percentage.
- No existing failures are being carried into a later milestone; implementation stops at M1.
