ROLE
You are a senior full stack engineer and product designer. You will build "LifeOS", a personal life operating system delivered as an installable PWA. Work autonomously, make reasonable decisions but always ask questions if necessary, and document every assumption in /docs/DECISIONS.md.

1. PRODUCT GOAL
LifeOS is a single user web app that centralizes daily, work and personal life: tasks, projects, calendar, commitments, finances, travel, plus an AI assistant that can read and act on all of it. LifeOS has NO email integration of any kind. Priorities in order: correctness, security, speed, mobile ergonomics, then visual polish. It must feel like a native app on a phone and be equally efficient on desktop with keyboard.

2. NON NEGOTIABLE PRINCIPLES
- Single user, but structure the code so multi user could be added later (every table has user_id).
- Local first UX: the UI reads from a local cache (IndexedDB) and syncs in the background. Every write is optimistic, queued when offline, and reconciled on reconnect (last write wins per field, with updated_at and a version counter).
- The AI never performs a write action without an explicit user confirmation step showing a diff/preview.
- All external text (calendar event descriptions, imported CSV rows, pasted booking text, uploaded documents) is untrusted data. It must never be treated as instructions (prompt injection defense).
- No secrets in the client. OAuth tokens and API keys are encrypted at rest (AES 256 GCM, key from env) and used server side only.
- Nothing is ever served to an unauthenticated request. Security is a feature, not a phase.
- UI language: Italian by default, with an i18n layer (next-intl) ready for English. Timezone default Europe/Rome, currency default EUR, week starts on Monday, 24h clock. All configurable in Settings.

3. STACK
- TypeScript strict mode, Next.js App Router, React Server Components where useful.
- Tailwind CSS + shadcn/ui + Radix primitives, Framer Motion for gestures and transitions.
- PostgreSQL + Drizzle ORM with migrations; Zod for every API boundary; tRPC or typed Route Handlers.
- Auth.js (NextAuth v5) with the Google provider only, database sessions.
- PWA via Serwist (Workbox based), Dexie for IndexedDB, TanStack Query for cache and offline mutation queue.
- Background jobs: a lightweight queue (pg boss or equivalent) for calendar sync, reminders, recurring transactions.
- Testing: Vitest (unit), Playwright (e2e, including offline, auth and install flows), MSW for API mocks.
- Tooling: ESLint, Prettier, Husky pre commit, GitHub Actions CI (typecheck, lint, test, build).
- Deployment: Dockerfile + docker compose (app + postgres), plus a documented Vercel option. Env vars validated at boot with Zod (t3 env style). Provide .env.example.

4. AUTH AND GOOGLE INTEGRATION
- Authentication is Sign in with Google ONLY (OpenID Connect via Auth.js). Do NOT implement username/password, magic links or any other credential flow: no password storage, no reset flow.
- Access control: a hard allowlist. Login succeeds only if the ID token has email_verified true AND the Google "sub" equals ALLOWED_GOOGLE_SUB AND the email equals ALLOWED_EMAIL (both from env). Any other account is rejected server side in the signIn callback and never gets a session or a database row.
- Sessions: database sessions, httpOnly + secure + sameSite=lax cookies, rotation on login, idle timeout and absolute timeout configurable in Settings, "sign out everywhere" action, session list with device and last seen.
- Every API route, server action and data fetch must verify the session server side. Add e2e tests that hit every route unauthenticated and expect 401 or redirect.
- Optional app lock on resume (passkey via WebAuthn, or PIN) on top of the Google session, configurable in Settings.
- Brute force and abuse: rate limiting on auth and API endpoints, security headers, strict CSP, CSRF protection.
- Incremental authorization: request only openid, email, profile at login. Request the Google Calendar scope (https://www.googleapis.com/auth/calendar) only when the user enables the Calendar module in Settings. NO Gmail scopes and NO Drive scopes anywhere in the code, consent screen or docs.
- Store the Calendar refresh token encrypted at rest (AES 256 GCM, key from env), server side only. Handle refresh, revocation and re consent with a clear "Reconnect Google" state in the UI.
- Calendar sync: incremental sync with syncToken, handle 410 Gone with full resync, push notifications (watch channels) with polling fallback. Support multiple calendars, colors, recurring events (RRULE), all day events, time zones, reminders, Google Meet links. Exponential backoff with jitter for quotas.

5. MODULES (each is a self contained feature folder with its own schema, API, UI, tests)

5.1 Today (home dashboard)
A single screen answering "what matters now": next events, tasks due today and overdue, top priority project, budget status for the month, upcoming trip countdown, and an AI "daily briefing" card (generated on demand and cached). Widgets are reorderable and hideable from Settings.

5.2 Tasks
- Fields: title, notes (markdown), status, priority (P1 to P4), due date/time, start date, estimate, actual time, tags, project, parent task (subtasks, unlimited depth), recurrence (RRULE), reminders, linked event/trip/note, attachments (metadata).
- Views: Inbox, Today, Upcoming, By project, By tag, Kanban, Calendar timeline, Completed. Saved filters with a query language (e.g. "p1 & due:this week & #work").
- Quick capture: global "+" button, keyboard shortcut, and natural language parsing ("pay the tax bill next Friday 5pm #finance p1") with live preview of parsed fields. Parsing must work offline for common patterns (deterministic parser), with AI as optional enhancement.
- Time blocking: drag a task onto the calendar to create a linked event.

5.3 Projects
- Project with goal, status, deadline, milestones, tasks, notes, linked events, linked files, and progress computed from tasks.
- Areas of life (Work, Study, Health, Home, Finance, etc.) as a top level grouping, fully user editable.
- Weekly review flow: guided screen that lists stalled projects, overdue tasks, and inbox items to process.

5.4 Calendar
Day, 3 day, week, month, agenda views. Drag and drop to move, resize to change duration, tap and hold to create. Two way sync with Google Calendar (section 4). Local only events supported. Conflict detection and "find a free slot" helper.

5.5 Finance
- Accounts (cash, bank, card, savings), transactions (amount, currency, category, merchant, date, notes, tags, account, recurring flag), transfers, budgets per category per month, recurring transactions and subscriptions detection, savings goals.
- Import: CSV with column mapping wizard and deduplication (hash of date+amount+description). No bank scraping. Design an adapter interface so a bank API provider can be added later.
- Reports: monthly cash flow, category breakdown, trend over time, net worth, upcoming recurring charges. Charts with Recharts, accessible, with data table fallback.
- Money is stored as integer minor units, never floats. Multi currency ready with stored exchange rate per transaction.

5.6 Travel
- Trip with dates, destinations, itinerary by day, bookings (flight, hotel, train, rental, activity) with confirmation codes, documents checklist, packing list templates, budget linked to Finance, and a map view.
- Import from pasted text: the user pastes a booking confirmation text or uploads a PDF or screenshot, AI extraction proposes structured bookings, the user confirms or edits before saving.
- Trip mode: offline available read only view of the next trip with all key info cached.

5.7 Notes and Commitments
Quick notes (markdown), commitments and appointments not on the calendar (bureaucratic deadlines, subscriptions, renewals of documents or insurance) with lead time reminders, and a global "link anything to anything" relation system.

5.8 Global features
Command palette (Cmd/Ctrl+K) with fuzzy search across every entity and every action. Global full text search (Postgres tsvector plus local index for offline). Activity log and audit trail. Undo for destructive actions (toast with undo, soft delete with 30 day trash). Data export (JSON + CSV zip) and full data import.

6. AI ASSISTANT
- Chat panel accessible from anywhere (bottom sheet on mobile, side panel on desktop) with streaming responses.
- Provider abstraction layer (interface plus adapters), model selectable in Settings, API key server side. Default provider OpenAI, structured so others can be plugged in.
- Tool calling over internal domain functions (search_tasks, create_task, update_task, list_events, create_event, add_transaction, summarize_spending, plan_trip_day, etc.), each with a Zod schema.
- Read tools execute immediately. Write tools return a proposed change; the UI shows a confirmation card (before and after) and only then commits. Bulk actions show a checklist to approve individually.
- Features: daily briefing, weekly review, "plan my day" (proposes time blocks from tasks and free calendar slots), natural language quick capture, spending insights, trip planning suggestions, booking text extraction.
- Safety: strict separation of system prompt, tool outputs and untrusted content; neutralize instructions found in event descriptions or pasted text; log every tool call with inputs and outputs; per day token and cost cap configurable in Settings; graceful degradation when the API is down (the app remains fully usable without AI).

7. PWA REQUIREMENTS
- Valid web app manifest: name, short_name, id, start_url, scope, display standalone, display_override (window controls overlay on desktop where supported), theme and background colors for light and dark, maskable and monochrome icons (192, 512 plus Apple touch icon), screenshots for rich install UI, categories, lang.
- Manifest shortcuts: New task, New event, Add expense, Open Today.
- Share target: receive text, URLs and files from the OS share sheet and turn them into a task, note or transaction attachment via a chooser screen.
- Service worker: precache app shell, runtime caching strategies per resource type (stale while revalidate for static, network first with fallback for API GET, never cache auth endpoints or authenticated API responses beyond the encrypted local store), navigation preload, offline fallback page, versioned cache cleanup, and a clear "New version available, reload" prompt (no silent breaking updates).
- Background Sync for the mutation queue where supported, with a foreground fallback (flush on focus and on online event).
- Web Push notifications (VAPID) for reminders, upcoming events, and due tasks; per category toggles and quiet hours in Settings. Handle iOS constraints (push only after install to Home Screen, iOS 16.4 or later), and document them.
- Custom install UX: capture beforeinstallprompt on Chromium and show a non intrusive install card; on iOS Safari show a short instruction sheet (Share, Add to Home Screen).
- App Badging API for overdue task count where supported.
- Safe area insets (env(safe-area-inset-*)), viewport-fit=cover, no rubber band overscroll glitches, 100dvh layouts, no layout shift when the keyboard opens, tap highlight disabled, correct theme-color for status bar.
- Lighthouse targets on mobile: Performance 90+, Accessibility 95+, Best Practices 95+, all PWA installability checks passing.

8. GESTURES AND INTERACTION (mobile first, with desktop equivalents)
- Swipe right on a task row: complete. Swipe left: reveal actions (reschedule, move, delete). Long swipe triggers the primary action with haptic feedback (navigator.vibrate where available). All actions configurable in Settings.
- Pull to refresh on lists (custom implementation, disabled when it conflicts with scroll containers).
- Long press: multi select mode with bulk actions bar.
- Drag and drop: reorder tasks, move between projects, drag onto calendar, with keyboard accessible alternatives.
- Bottom sheets with snap points and drag to dismiss for create and edit forms.
- Edge swipe back navigation consistent with the router, and swipe between calendar days and weeks.
- Pinch to zoom timeline in day view (optional, behind a flag).
- Double tap on empty calendar slot: create event.
- Desktop: full keyboard map (documented in a shortcuts cheat sheet opened with "?"), hover actions, context menus on right click.
- Every gesture must have a visible non gesture alternative (accessibility), respect prefers-reduced-motion, and never conflict with native browser gestures.

9. SETTINGS (structured, searchable, persisted server side and mirrored locally)
Sections: Account and Google connection (Calendar on/off, scope status, reconnect), General (language, timezone, first day of week, date and number formats, default currency), Appearance (light, dark, system, accent color, density, font size), Modules (enable/disable, reorder navigation), Dashboard widgets, Notifications (push, quiet hours, per category), Gestures (map each swipe to an action, sensitivity, haptics), Keyboard shortcuts (view and rebind), AI (provider, model, key status, daily cap, confirmation strictness, memory on/off), Sync and offline (status, force resync, clear local cache), Data (export, import, delete all data), Security (allowlisted account shown read only, session list, sign out everywhere, app lock with passkey or PIN, idle timeout), About (version, changelog).

10. DATA MODEL
Design the full relational schema up front in /docs/SCHEMA.md and implement with Drizzle migrations. Every table: id (uuid v7), user_id, created_at, updated_at, deleted_at (soft delete), version. Include indexes for all common queries and FTS columns. Provide seed data and a demo mode with fake data for screenshots and tests.

11. DESIGN SYSTEM
Define design tokens (color, spacing, radius, typography scale, elevation, motion durations) in one place. Light and dark themes with WCAG AA contrast. Consistent empty states, skeleton loaders, error boundaries with retry, and toasts. One coherent visual identity: calm, dense but readable, minimal chrome. Bottom tab bar on mobile (Today, Tasks, Calendar, Projects, More), collapsible sidebar on desktop. Touch targets at least 44x44 px.

12. QUALITY, SECURITY, PERFORMANCE
- Security: CSRF protection, strict CSP, secure/httpOnly/sameSite cookies, rate limiting on API and auth, input validation everywhere, output escaping, dependency audit in CI.
- Scope audit: CI greps the repo and the built bundle for Gmail and Drive scopes and fails if any is found.
- Privacy: no third party analytics by default; optional self hosted, off by default.
- Performance: route level code splitting, virtualized long lists, image optimization, bundle budget checked in CI, p95 interaction latency under 100 ms for local operations.
- Accessibility: semantic HTML, focus management, ARIA where needed, screen reader labels for gestures, tested with axe in Playwright.
- Observability: structured logging (pino), error reporting hook, health endpoint.
- Tests: unit tests for parsers, recurrence logic, money math, sync reconciliation, allowlist logic; e2e for login (mocked OAuth, including a rejected non allowlisted account), unauthenticated access to every route, offline create then sync, install prompt logic, and each module's critical path. Minimum 80 percent coverage on domain logic.

13. WORKFLOW (follow strictly)
Step 0: create AGENTS.md at the repo root with coding conventions, commands (dev, build, test, lint, db:migrate), architecture overview, and the rules from this prompt. Create /docs with ARCHITECTURE.md, SCHEMA.md, DECISIONS.md, SETUP_GOOGLE.md. SETUP_GOOGLE.md must cover only: project creation, OAuth consent screen, credentials, redirect URIs, enabling the Google Calendar API, and how to find and set ALLOWED_GOOGLE_SUB and ALLOWED_EMAIL. It must also state that with the consent screen in "Testing" status refresh tokens expire after 7 days, and explain how to move to "In production" as an unverified personal app.
Then implement in milestones. After each milestone: run typecheck, lint, unit and e2e tests, fix everything, commit with a conventional commit message, and print a short summary of what works and what is pending. Do not start the next milestone with failing tests.
 M1: scaffolding, design system, Google login with hard allowlist, sessions, settings shell, database, CI.
 M2: PWA foundation (manifest, service worker, offline shell, install UX), local first sync engine and mutation queue.
 M3: Tasks and Projects with all views, quick capture, gestures, command palette.
 M4: Calendar with Google two way sync, time blocking.
 M5: Finance (accounts, transactions, CSV import, budgets, reports).
 M6: Travel and Notes/Commitments.
 M7: AI assistant with tool calling and confirmation flow, briefing, planning.
 M8: Push notifications, badging, share target, app lock, export/import, hardening, Lighthouse and accessibility pass, final documentation.

14. DEFINITION OF DONE
The app installs on Android Chrome, desktop Chrome or Edge and iOS Safari (Home Screen), works offline for tasks, notes, finance entry and the cached calendar, syncs correctly on reconnect, logs in only with the allowlisted Google account (any other account and any unauthenticated request is rejected), passes CI, and every module in section 5 is functional end to end with no placeholder screens, no TODO stubs in shipped paths, and no mocked data outside demo mode.

Begin with Step 0 and Milestone M1 now.