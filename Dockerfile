FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN HUSKY=0 npm ci
FROM deps AS build
COPY . .
# Build-only dummy configuration: no real credentials baked into images.
RUN DATABASE_URL=postgresql://build:build@localhost/build AUTH_URL=https://build.invalid AUTH_SECRET=build-only-secret-with-at-least-32-characters AUTH_GOOGLE_ID=build AUTH_GOOGLE_SECRET=build ALLOWED_GOOGLE_SUB=build ALLOWED_EMAIL=build@example.test ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= npm run build
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node","server.js"]
