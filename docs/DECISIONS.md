# Decisions and assumptions

1. The initial delivery covered Step 0 and M1; subsequent continuation requests authorize M2, now implemented. M3–M8 remain future work. The complete product brief is preserved in PRODUCT_SPEC.md.
2. Repository is outputs/lifeos because the provided workspace is empty and its parent Git metadata is read-only. It is a standalone Git repository.
3. Node 24 LTS, Next.js App Router, Auth.js v5 beta (v5 remains a prerelease), typed Route Handlers, Drizzle and PostgreSQL. Lockfile pins the actual dependency graph.
4. “Nothing served unauthenticated” means no private data or application UI. Login, OAuth protocol endpoints and build assets must be reachable to establish a session. Errors contain no private data. Health is authenticated.
5. Only Google OIDC is enabled in M1. Calendar consent, encrypted refresh credentials and sync arrive in M4. OIDC access/id/refresh tokens are discarded rather than stored needlessly.
6. The users row owns itself (user_id = id); operational rate-limit rows use a reserved system UUID as owner. All application tables have the common metadata contract. Auth adapter uses UUIDv7 for users, accounts and sessions.
7. Session tokens are SHA-256 hashed in storage. Idle timeout defaults to 60 minutes; absolute lifetime 30 days. Last-seen updates do not extend absolute expiry. Settings changes take effect on the next check. Re-login rotates the browser token; other devices stay signed in until revoked.
8. HTTPS production uses Secure, HttpOnly, SameSite=Lax cookies; local HTTP development necessarily omits Secure. Production AUTH_URL must be HTTPS. Production deployments must strip client-supplied forwarding headers; auth rate limiting uses an application-wide bucket plus per-user API buckets.
9. Explicit DEMO_MODE seeds fake data only through a CLI; it never bypasses Google authentication. Tests use an isolated OAuth server and test database, never a production login route.
10. Settings persist on PostgreSQL in M1. IndexedDB mirroring and optimistic reconciliation are implemented in M2. Navigation exposes only implemented M1 destinations; future modules are described in documentation, not fake screens.
11. Design: warm ivory and forest green, semantic tokens, locally available system fonts, responsive sidebar and mobile tabs. Theme respects OS until explicitly selected.
12. CSRF: Auth.js protects its own POSTs; custom mutations enforce same-origin Origin and JSON content type. No cross-origin API access is enabled.
13. M1 schema migration implements identity, settings, sessions, audit and distributed rate limiting. SCHEMA.md specifies every planned domain up front; feature tables are added with their respective milestone, avoiding untested empty APIs.
14. No external account provisioning or deployment is attempted. OAuth consent and production PostgreSQL require operator configuration; local automated tests do not certify live Google behavior.

15. The installed Drizzle CLI depends on an older development-only esbuild. A scoped override to esbuild 0.25.x removes its advisory; migration generation and actual PostgreSQL migrations were verified after the override.
16. Screenshots use the isolated OAuth test persona, never real personal information. They are UI evidence, not proof of live Google configuration.

17. Authenticated request locale is read from server-persisted settings, including the HTML language tag. The locale cookie is only a convenience for the public sign-in page, never the source of truth for signed-in preferences.

18. M2 offline writes cover existing general/appearance preferences only. Security settings remain online. New task/event/expense shortcuts will arrive with their actual modules; the manifest exposes Today and the offline workspace now.
19. The public offline document contains no identity or private values. Offline access is restricted to an already authenticated tab with an unexpired server-issued lease. This deliberately prevents cold offline launches from revealing private data. See OFFLINE.md for encryption limitations and recovery.
20. Field clocks are stored as typed JSON on settings rather than a separate field_clocks table. Mutation receipts are durable and scoped to user plus mutation UUID; a canonical payload hash rejects UUID reuse with different content. Receipt retention must be designed before introducing cleanup.
