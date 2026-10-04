# M4 increment 4: Google watch channels — 4 October 2026

Implemented opt-in Google server notifications with expiring channel registration, early renewal, best-effort replacement cleanup and exponential retry/jitter. The new callback uses a hashed per-channel secret, resource binding, expiry and connection version instead of browser credentials. Only authenticated signals schedule work; notification bodies never modify events. A durable generation counter preserves wake-ups arriving during synchronization. Polling continues every minute, including after channel failures.

Validation: strict TypeScript, ESLint, Prettier, 131 unit tests, all 27 Chromium scenarios and the production PWA build passed. The watch scenario was rerun after refining retry scheduling and source/channel lock ordering. Selected domain/security coverage is 97.61% statements, 95.47% branches, 96.85% functions and 98.69% lines; database watch lifecycle logic is exercised by the integration scenario, outside that unit coverage set. Migration 0006 applied only to disposable PostgreSQL; regeneration reports no drift. Scope audit passed; production client JavaScript remains 1,077 KiB gzip against the 1,200 KiB budget.

The new scenario exercises initial notification delivery before the watch response, hashed token storage, invalid secrets/resources/channel IDs/states/message numbers, duplicate/out-of-order suppression, high-precision message numbers, notification-to-worker import, a callback racing with an active pull, renewal failures with polling still usable, retry deadlines, successful replacement/stop, expiry, pause/resume, disconnect and reconnect. Existing browser scenarios continue to verify offline behavior, Calendar conflicts and mobile accessibility. Provider transport is mocked only in the isolated test process; the Next callback and domain/database services run normally.

No public HTTPS endpoint, live Google channel, personal database migration or deployment was configured. `CALENDAR_PUSH_ENABLED` defaults to false; operators must apply migration 0006 and configure a public HTTPS origin to enable provisioning. Localhost keeps polling. Old/orphaned registrations may expire at Google when stop is unavailable, but local state rejects their callbacks. See CALENDAR.md for lifecycle and deployment details. Google recurring series and remaining M4 interface work are still pending.

---

# M4 increment 3: Today events and global search — 30 September 2026

Today shows up to five ongoing/upcoming occurrences in a rolling 30-day window. It uses the configured timezone, includes local recurring events and already-imported Google events, and excludes ended/deleted events. Global search now matches event titles, locations and notes. Both surfaces reuse the extracted Calendar editor in place, retaining the existing encrypted offline queue, recurrence semantics and read-only restrictions.

Validation: strict TypeScript, ESLint, Prettier, 129 unit tests, all 26 Chromium scenarios and production PWA build passed. Selected coverage: 97.60% statements, 95.43% branches, 96.80% functions and 98.68% lines. Calendar domain statement/line coverage is 100%. Tests cover ongoing boundaries, exclusive all-day ends, recurrence across DST, result limits and accent-insensitive event search. The new browser scenario edits an event from Today offline, finds it by location, opens its notes in the shared editor and verifies persistence after reconnect/reload. Mobile axe reports zero violations; the screenshot was visually inspected.

Full-suite testing caught a Next Link runtime dependency entering the standalone offline bundle; the shared widget uses a standard anchor. Existing offline reload, expired-lease, task and capture tests all pass after the fix. The Settings conflict test now creates a real concurrent update before replaying the stale version, rather than subtracting one from a possibly initial version.

Scope audit passed. Production client JavaScript is 1,077 KiB gzip against the 1,200 KiB ceiling. No schema migration, live Google call, personal database change or deployment was performed. Google recurring series, watch channels, timeline gestures and dashboard customization remain pending within M4.

---

# M4 increment 2: two-way Google synchronization — 30 September 2026

Added calendar selection/pause, nonrecurring event import and explicit publication, source colors, Meet links, read-only access, and conflict previews with local-copy preservation. A persistent worker stores cursors/retries in PostgreSQL, merges disjoint edits, uses conditional writes and deterministic creation IDs, and recovers expired cursors without dropping pending local changes. Local launcher and Compose include the worker; manual/Vercel setup is documented in CALENDAR.md. M4 remains in progress for Google recurring series, watch channels and richer timeline gestures.

Validation: strict TypeScript, ESLint, Prettier, 127 unit tests, all 25 Chromium scenarios and production PWA build passed. Selected domain coverage: 97.57% statements, 95.38% branches, 96.72% functions and 98.67% lines. Migration 0005 applied to isolated PostgreSQL; schema regeneration reports no drift. Production dependency audit reports zero vulnerabilities.

Scope audit passed against source and build output; production JavaScript is 1,072 KiB gzip against the 1,200 KiB budget. After disabling unsupported recurrence editing on Google-linked events, the focused browser scenario and production build were rerun successfully.

The new end-to-end scenario covers authenticated/CSRF guards, paginated initial import, UTC normalization, all-day events, encrypted offline editing, disjoint merging, stale conflict preview rejection, preserving local copies, a provider write race (412), deletion/edit conflicts, duplicate publication requests, a lost creation response, full recovery after 410 including missing remote records, reader calendars, events with guests, quota backoff, outgoing deletion and paused sources. The worker's job runner and real database/domain services run with transport mocked only in the test harness; production Google endpoints remain fixed. Mobile axe reports zero violations; the conflict-panel screenshot was inspected. Tests caught and fixed a skipped heading level, and calendar fixtures now reset only the disposable test cluster to avoid cross-scenario state leakage.

No live Google account, personal database or deployment was changed. Docker/external worker execution and real Google provider behavior remain unverified. Reminder synchronization is limited to initial import/creation; unsupported recurring and special Google events are explicitly counted and excluded from availability suggestions.

---

# M4 increment 1: local calendar and Google consent — 30 September 2026

Implemented local offline events, five date-range views, recurring series, overlap/free-slot helpers, task time blocks, desktop day moves and an accessible event editor/trash. Added a separate Google Calendar consent flow and calendar metadata check in Settings. M4 remains in progress: no provider event import/export, two-way synchronization, watch channels or persistent worker is enabled.

Validation: TypeScript, ESLint, Prettier, 117 unit tests, all 24 Chromium scenarios and the production PWA build passed. Selected coverage is 98.15% statements, 95.07% branches, 98.07% functions and 99.14% lines. Calendar domain coverage is 100% statements/lines, including exclusive all-day boundaries, both DST transitions, finite recurrence, overlapping intervals, free slots, move semantics and atomic schedule reconciliation.

Browser tests verify offline create/edit/delete/restore, conflict indicators, task-linked free-slot placement, encrypted-queue replay without duplicate events and the legacy bootstrap response. OAuth coverage checks unauthenticated/CSRF rejection, cookie binding, hashed expiring one-use state, PKCE verifier encryption, unauthorized identity rejection, encrypted refresh persistence, disconnect cleanup and superseded callbacks. The service transport is mocked only inside the test harness; production keeps fixed Google HTTPS endpoints. Mobile axe reported zero violations, and the Calendar screenshot was visually inspected.

The tests found and fixed task-position injection into new event mutations. Three older Settings assertions now specifically target their save-status region, since Calendar adds a separate connection-status region. Scope audit passed; production client JavaScript is 1,070 KiB gzip against the 1,200 KiB budget. Migrations 0003 and 0004 were applied only to the disposable test database. No real Google consent, personal database migration or deployment was performed. The additional OAuth redirect URI and remaining M4 scope are documented in CALENDAR.md and SETUP_GOOGLE.md.

---

# M3 subtasks and long lists — 29 September 2026

Added direct subtask creation from task-row actions with parent/project prefilled, parent labels and completion counts for direct children. Parent selection excludes self and descendants while retaining the existing server checks. Windowed lists reserve a consistent 104px row plus 8px gap and reset their scroll position when filtering.

Validation: TypeScript, ESLint, Prettier, 95 unit tests, all 22 Chromium scenarios and the production PWA build passed. Selected coverage: 97.61% statements, 93.91% branches, 97.50% functions and 98.89% lines. Unit checks include a 30-level hierarchy, deleted intermediate nodes and cycle-safe traversal. New browser scenarios verify offline child/grandchild creation, inherited project, unavailable cyclic parent choices, independent completion, reload/replay, and filtering a 130-task list down to 111 tasks with a reset scroll window and measured row spacing.

Mobile axe reports zero violations; the hierarchy screenshot was visually inspected. Scope audit passed; client JavaScript is 1,016 KiB gzip against the 1,200 KiB budget. No database migration or personal data changes were required; fixtures used the isolated test database. M4 remains pending.

---

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
