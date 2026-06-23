# ── Builder stage ─────────────────────────────────────────────────────────────
FROM node:24-slim AS builder

# pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy lockfile + workspace config first for layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY .npmrc ./

# Copy all package.json files for install
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/hermes-agent/package.json ./artifacts/hermes-agent/
COPY artifacts/sales-outreach/package.json ./artifacts/sales-outreach/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY scripts/package.json ./scripts/

# Install deps (frozen lockfile, approve esbuild)
RUN pnpm install --frozen-lockfile && pnpm approve-builds esbuild

# Copy source
COPY . .

# Build: typecheck + build all packages, then build frontend
RUN pnpm run build

# Build frontend
ENV PORT=3000
ENV BASE_PATH=/
RUN pnpm --filter @workspace/sales-outreach run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:24-slim AS runtime

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy lockfile + workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY .npmrc ./

# Copy all package.json files
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/hermes-agent/package.json ./artifacts/hermes-agent/
COPY artifacts/sales-outreach/package.json ./artifacts/sales-outreach/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY scripts/package.json ./scripts/

# Install production deps only
RUN pnpm install --frozen-lockfile --prod && pnpm approve-builds esbuild

# Copy built artifacts from builder
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/sales-outreach/dist ./artifacts/sales-outreach/dist
COPY --from=builder /app/lib/db/dist ./lib/db/dist
COPY --from=builder /app/lib/api-zod/dist ./lib/api-zod/dist
COPY --from=builder /app/lib/api-client-react/dist ./lib/api-client-react/dist

# Drizzle config for schema push
COPY lib/db/drizzle.config.ts ./lib/db/
COPY lib/db/src ./lib/db/src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Start the API server. Frontend is served separately (Cloudflare Pages or static).
CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
