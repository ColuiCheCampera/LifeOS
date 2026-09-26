# Tasks and Projects — M3

## Everyday use

Use **Nuova attività** or press **N** outside a text field. Quick capture previews the title, due date/time, tags and priority before saving. Examples:

- `Pagare bolletta domani alle 17 #casa p1`
- `Read a chapter next Monday 5pm #study p2`
- `Camminare ogni giorno alle 8 #salute`

Dates are resolved in the configured timezone. Italian/English today, tomorrow, weekdays, ISO dates, explicit times, priorities and hashtags work offline. Unrecognized wording stays in the title; there is no AI service in M3. Ambiguous/nonexistent explicit local times during daylight-saving changes are rejected for correction.

Edit a task to add Markdown notes, a parent task, project, estimate/actual minutes, recurrence, reminder dates and attachment metadata. Markdown never executes raw HTML. Attachment entries are links and metadata, not uploaded file content. Parent depth has no arbitrary limit; cyclic and foreign-account relationships are rejected.

## Views and organization

Inbox contains active tasks without a project. Today includes due and overdue tasks; Upcoming shows future due dates. Project and tag selectors narrow active tasks. Kanban moves between To do, In progress and Completed. The deadline calendar changes task dates; it is separate from the Google event calendar planned for M4. Completed and Trash have explicit reopen/restore actions. Trash restore is limited to 30 days.

Create your own life areas, projects and milestones. Project progress counts completed, non-deleted tasks. Weekly review lists projects without changes for seven days, overdue tasks and unorganized Inbox items. There are no seeded personal records.

Saved filters combine terms with `&`: `p1`, `#work`, `due:today`, `due:overdue`, `due:this week`, `status:todo`, `status:doing`, `status:done`, and plain text. The current view also constrains results. Ctrl/Cmd+K opens fuzzy title search and navigation; `?` shows shortcuts.

## Interaction

Task rows offer completion, edit, delete, selection and up/down controls. Touch swipe right completes, swipe left edits, and a long press selects. Native desktop dragging moves tasks to board columns, project cards and calendar dates; the editor exposes the equivalent fields. Mobile dialogs act as bottom sheets: use the handle to change height, drag the heading up/down to resize, or drag down farther to close. Pull down from the top of the page to refresh, or use the visible refresh/sync controls.

Long lists are windowed. All saved tasks and projects use the same encrypted local vault as preferences. A new record enters the durable queue before success is shown. Reconnect replays mutations with field clocks and transactionally deduplicated IDs. Cache clearing discards unsynced data only after confirmation. Keep the browser profile and local database backed up.

## Recurrence and boundaries

Supported recurrence frequencies are DAILY, WEEKLY, MONTHLY and YEARLY with RRULE filters; interval is limited to 1–366 and COUNT to 1–10,000. The search for a next occurrence is bounded to ten calendar years. Completing a recurring task retains its completed occurrence and creates the next task in the same transaction. The original anchor is carried forward to preserve finite COUNT/UNTIL rules and wall-clock time. Push reminder delivery is M8; stored dates alone do not produce OS notifications.

Time blocking and linked calendar events are M4. Notes/trips as independent linked modules arrive in M6. AI and push are not implemented by this milestone. No Calendar resource scope is requested by M3.

Attachment URLs are metadata references; fetching/uploading files and linking to event/trip/note records are intentionally deferred to the modules that own those records. Gesture mappings and keyboard bindings are currently the documented defaults; custom remapping in Settings remains part of the later settings/hardening work.
