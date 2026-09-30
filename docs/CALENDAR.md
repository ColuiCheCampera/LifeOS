# Calendar — M4 increment 1

This increment starts M4. It does **not** complete Google event synchronization.

## Available now

Open `/calendar` from desktop navigation or the mobile Calendar tab. Day, three-day, week, month and 30-day agenda views display events from the encrypted local work snapshot. On narrow screens the day columns stack into a readable list. Week/month alignment uses the configured first day of week. Times use the configured display timezone; the event keeps its own timezone.

Create and edit titles, notes, locations, color, start/end, all-day dates, RRULE, and task/project links. The end date of an all-day event is exclusive. Timed input rejects ambiguous/nonexistent local times; recurring events retain wall-clock time through daylight-saving changes. Editing/deleting a recurring event applies to its complete series. Deletions can be restored for 30 days. Drafts remain in memory until saved; closing a changed draft asks before discarding it.

The planning list offers Schedule and Find free slot, using the task estimate (15–480 minutes, default 60) and the selected date's 09:00–18:00 window. Scheduling creates a linked event; it does not complete or reschedule the task. Drag a task to a day, or drag a nonrecurring event to move it while retaining its local time. The editor provides keyboard/touch alternatives and duration changes. Overlaps are shown without preventing intentional double-booking. This is a day-card calendar, not yet an hourly drag/resize timeline.

Events use the existing encrypted offline queue, per-field reconciliation, tenant checks, audit and idempotency receipts. The complete schedule (start, end, all-day flag, timezone) is one field, avoiding invalid merged half-intervals. Calendar-aware clients request `work=1&calendar=1`; `work=1` alone omits events. Install the current application update on every tab/device before editing Calendar; downgrading old clients against the shared encrypted store is unsupported.

## Google connection

In Settings → Account, Connect Google Calendar starts a separate consent flow. Login still requests identity scopes only. Register `/api/calendar/google/callback` for the configured origin as described in SETUP_GOOGLE.md. PKCE and a random state are bound to an authenticated user and an HttpOnly same-site cookie; server state expires after ten minutes and is consumed once before exchange. The returned server-side access token is checked against Google userinfo, requiring the exact allowlisted subject, email and verified-email flag before persisting a refresh token. Calendar scope and an offline refresh token are mandatory.

Retained refresh tokens and PKCE verifiers use AES-256-GCM with user/purpose-bound authenticated data. State is hashed in PostgreSQL. Access tokens are used only server-side and are not retained. Check calendars refreshes access and lists calendar names, colors, roles and timezones. Provider text is rendered as text. Revoked/expired grants show Reconnect; no provider body or credential is forwarded to the browser or logs.

Disconnect removes LifeOS's stored Calendar credentials and pending consent state, leaving local events and the identity session intact. It does not revoke Google's combined identity/Calendar grant. Revocation can be performed in Google Account permissions. Reconnection/disconnection supersedes an older in-flight consent attempt.

**Connecting does not yet import, export, or publish any events.** The Settings panel states this explicitly. Credentials remain inactive until Check calendars or a later synchronization implementation uses them.

## Remaining M4 work

- Calendar selection and provider-event mapping, including read-only calendars, recurring series exceptions, Meet links and reminder metadata.
- Durable two-way event jobs, conditional writes/conflict resolution, incremental sync tokens and 410 full recovery without losing pending local edits.
- A separate persistent worker, quota backoff/jitter, authenticated watch channels with renewal and polling fallback.
- Hourly timeline move/resize and touch creation gestures with visible keyboard alternatives; global event search and Today event widgets.

Do not label M4 complete until those paths and their failure/replay tests are implemented. No personal Google account or personal database was used during automated testing.

Protocol references: [Google web-server authorization](https://developers.google.com/identity/protocols/oauth2/web-server), [incremental Calendar sync](https://developers.google.com/workspace/calendar/api/guides/sync), [conditional event patches](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [Calendar watch channels](https://developers.google.com/workspace/calendar/api/guides/push).
