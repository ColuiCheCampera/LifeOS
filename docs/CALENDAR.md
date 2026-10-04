# Calendar — M4 increments 1–3

M4 is in progress. Local calendars and two-way synchronization of nonrecurring Google events are available; recurring Google series and watch channels remain pending.

## Available now

Open `/calendar` from desktop navigation or the mobile Calendar tab. Day, three-day, week, month and 30-day agenda views display events from the encrypted local work snapshot. On narrow screens the day columns stack into a readable list. Week/month alignment uses the configured first day of week. Times use the configured display timezone; the event keeps its own timezone.

Today shows up to five ongoing/upcoming occurrences in the next 30 days, including local recurring events and Google events already imported. Ended and deleted events are excluded; the list refreshes every 30 seconds and on window focus. Dates use the configured display timezone. Open an item to view/edit it with the same Calendar editor, without leaving the current page; this works in an unlocked offline tab. Google read-only restrictions and whole-series local recurrence editing still apply. Meet links open separately when available. This list is based on the encrypted snapshot, not a fresh provider availability query.

Global Search and commands (Ctrl/Cmd+K) includes events by title, location and notes, ignoring accents and case. Results exclude deleted records, show the Event type and open the shared event editor. Local task/project behavior is unchanged. Search operates on the current encrypted work snapshot and works offline.

Create and edit titles, notes, locations, color, start/end, all-day dates, RRULE, and task/project links. The end date of an all-day event is exclusive. Timed input rejects ambiguous/nonexistent local times; recurring events retain wall-clock time through daylight-saving changes. Editing/deleting a recurring event applies to its complete series. Deletions can be restored for 30 days. Drafts remain in memory until saved; closing a changed draft asks before discarding it.

The planning list offers Schedule and Find free slot, using the task estimate (15–480 minutes, default 60) and the selected date's 09:00–18:00 window. Scheduling creates a linked event; it does not complete or reschedule the task. Drag a task to a day, or drag a nonrecurring event to move it while retaining its local time. The editor provides keyboard/touch alternatives and duration changes. Overlaps are shown without preventing intentional double-booking. This is a day-card calendar, not yet an hourly drag/resize timeline.

Events use the existing encrypted offline queue, per-field reconciliation, tenant checks, audit and idempotency receipts. The complete schedule (start, end, all-day flag, timezone) is one field, avoiding invalid merged half-intervals. Calendar-aware clients request `work=1&calendar=1`; `work=1` alone omits events. Install the current application update on every tab/device before editing Calendar; downgrading old clients against the shared encrypted store is unsupported.

## Google connection

In Settings → Account, Connect Google Calendar starts a separate consent flow. Login still requests identity scopes only. Register `/api/calendar/google/callback` for the configured origin as described in SETUP_GOOGLE.md. PKCE and a random state are bound to an authenticated user and an HttpOnly same-site cookie; server state expires after ten minutes and is consumed once before exchange. The returned server-side access token is checked against Google userinfo, requiring the exact allowlisted subject, email and verified-email flag before persisting a refresh token. Calendar scope and an offline refresh token are mandatory.

Retained refresh tokens and PKCE verifiers use AES-256-GCM with user/purpose-bound authenticated data. State is hashed in PostgreSQL. Access tokens are used only server-side and are not retained. Check calendars refreshes access and lists calendar names, colors, roles and timezones. Provider text is rendered as text. Revoked/expired grants show Reconnect; no provider body or credential is forwarded to the browser or logs.

Disconnect removes LifeOS's stored Calendar credentials and pending consent state, leaving local events and the identity session intact. It does not revoke Google's combined identity/Calendar grant. Revocation can be performed in Google Account permissions. Reconnection/disconnection supersedes an older in-flight consent attempt.

Connecting alone does not select calendars or publish local events. In Calendar → Google Calendar, choose the calendars to synchronize. Reader calendars and events with guests are read-only; Meet links are available when provided. Pause keeps the imported local snapshot and stops subsequent exchanges. Resume verifies access again. Disconnect stops future jobs; an HTTP write already sent to Google may still finish.

Use Publish a local event to explicitly link a nonrecurring local event to a writable Google calendar. Subsequent changes to title, notes, location and the complete schedule flow both ways, including deletion. Local-only color/task/project links remain intact. Popup reminder offsets are imported initially and sent on creation; later reminder changes are not synchronized. Attendees, conference settings and unsupported Google fields are never patched. Events with guests cannot be changed from LifeOS.

The conflict panel previews both versions. Keep local copy and use Google preserves an independent local event before adopting Google; Use only Google asks before discarding the local version. Both the local event version and remote mirror version must still match the preview. A remotely deleted event cannot be restored under its old Google identity; create a new local copy from Trash instead.

Google recurring series, exceptions, special event types and events exceeding local validation limits are counted as unsupported. They are not expanded or published. Free-slot suggestions consider only the events represented in LifeOS and cannot certify availability across unsupported Google events.

## Worker and recovery

Apply migrations, then run `npm run worker:calendar` in a separate persistent process alongside `npm run dev` or the production web server. `npm run local` starts this worker automatically; Docker Compose has a separate `calendar-worker` service. Vercel needs an external Node 24 worker with this repository, its locked dependencies (including tsx), the same server environment and PostgreSQL. The web process only saves commands; it does not run a background polling loop. Docker and external worker deployment have not been exercised here.

PostgreSQL source rows store cursor, next-run deadline, error and retry count; bindings store the remote identity, ETag, last shared base and latest remote projection. The persisted difference between event and base is the outgoing work queue. The worker checks every five seconds, schedules healthy sources every minute and retries failures with exponential backoff and jitter (22.5 seconds to 75 minutes). Sync Google brings enabled sources forward. A database advisory lock prevents two workers processing the same source; process death releases it.

Every page of an incremental response is fetched before application, and the final cursor is saved only after all incoming records are reconciled. HTTP 410 triggers a complete download while preserving pending local changes; absent remote records become tombstones. A three-way merge combines disjoint field edits and holds competing edits/deletions for review. Conditional PATCH/DELETE use ETags; deterministic creation IDs prevent duplicates after a lost response. Provider import and mirror updates commit together, making replay safe. Each outgoing event holds the existing per-user work lock across its bounded HTTP request (15-second request timeout), trading brief write contention for consistent local state.

Tokens and cursors remain server-side. The browser receives safe source state and event metadata through authenticated, uncached APIs and the encrypted work snapshot. Reconnect all tabs with the current application version before editing; older calendar clients do not understand the added source metadata.

## Remaining M4 work

- Google recurring series/exceptions, richer reminder synchronization and supported guest-edit workflows.
- Authenticated watch channels with renewal; the current durable scheduler uses PostgreSQL source deadlines rather than the originally planned pg-boss queue.
- Hourly timeline move/resize and touch creation gestures with visible keyboard alternatives; configurable dashboard widget order/visibility.

Do not label M4 complete until those paths and their failure/replay tests are implemented. No personal Google account or personal database was used during automated testing.

Protocol references: [Google web-server authorization](https://developers.google.com/identity/protocols/oauth2/web-server), [incremental Calendar sync](https://developers.google.com/workspace/calendar/api/guides/sync), [conditional event patches](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [Calendar watch channels](https://developers.google.com/workspace/calendar/api/guides/push).
