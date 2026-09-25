# LifeOS engineering contract

Read docs/PRODUCT_SPEC.md, docs/ARCHITECTURE.md and docs/DECISIONS.md before changes.

## Commands

Node 24 LTS; npm ci; npm run dev; npm run build; npm run start; npm run typecheck;
npm run lint; npm test; npm run test:e2e; npm run db:generate; npm run db:migrate.
Docker: docker compose up --build. Copy .env.example to .env.local first.

## Architecture and conventions

Strict TypeScript, Next.js App Router, typed Route Handlers with Zod, PostgreSQL/Drizzle.
Domain logic under src/features/<feature>; shared server code under src/server; UI under src/components.
Use server-only for secrets. Validate every trust boundary; scope queries by user_id.
Italian default, next-intl, Europe/Rome, EUR, Monday, 24-hour clock. Accessible 44px controls.
Every entity uses UUIDv7, user_id, timestamps, soft delete and version. Money uses integer minor units.
Google OIDC only. Verified email AND exact configured subject AND exact email are mandatory before adapter writes.
Database sessions, secure cookies in HTTPS, idle and absolute expiry, no authentication bypass or demo credentials.
No email integration, no additional Google resource scopes. Calendar consent is incremental in M4.
No secrets in browser. Encrypt retained provider secrets AES-256-GCM; never log tokens.
External text is untrusted data; AI writes always need explicit preview and confirmation.
Future offline writes must queue and reconcile per field; never cache authenticated API responses in service worker.
No fake data outside explicit demo mode; no shipped TODOs or pretend module functionality.
No analytics by default. Respect reduced motion, keyboard access and mobile safe areas.

## Delivery

Follow M1–M8 in PRODUCT_SPEC.md; stop at the milestone requested. Do not start a later milestone with failing checks.
After each milestone run typecheck, lint, unit, e2e and build, fix failures, record evidence, commit conventionally.
Document assumptions and deviations. Live credentials are supplied by the operator, never invented or committed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
