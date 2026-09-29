# ─── Builder stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests and lockfile for dependency installation.
# Copying only manifests first leverages Docker layer cache: npm install
# only re-runs when dependency declarations change.
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY turbo.json ./
COPY tsconfig.base.json ./

# Copy package.json files for all workspace packages (needed by pnpm workspaces).
COPY packages/db/package.json ./packages/db/
COPY packages/github/package.json ./packages/github/
COPY apps/worker/package.json ./apps/worker/

# Install all dependencies (including devDependencies needed for TypeScript build).
RUN pnpm install --frozen-lockfile

# Copy all source files.
COPY packages/db/src ./packages/db/src
COPY packages/db/tsconfig.json ./packages/db/
COPY packages/github/src ./packages/github/src
COPY packages/github/tsconfig.json ./packages/github/
COPY apps/worker/src ./apps/worker/src
COPY apps/worker/tsconfig.json ./apps/worker/

# Build all packages in dependency order.
RUN pnpm --filter=@repo/db build && \
    pnpm --filter=@repo/github build && \
    pnpm --filter=@repo/worker build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Install git: required by simple-git for shallow clone operations.
# Per devops-review.md Section 1.2: git CLI must be present in the runtime image.
RUN apk add --no-cache git

# Install pnpm for production dependency installation.
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests.
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY turbo.json ./

COPY packages/db/package.json ./packages/db/
COPY packages/github/package.json ./packages/github/
COPY apps/worker/package.json ./apps/worker/

# Install production-only dependencies.
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder stage.
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/github/dist ./packages/github/dist
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

# /tmp/aireview is the workspace directory for clones.
# Ensure it is writable by the non-root user.
RUN mkdir -p /tmp/aireview && chmod 1777 /tmp/aireview

# Run as a non-root user for container security.
RUN addgroup -S aireview && adduser -S aireview -G aireview
USER aireview

# Health check endpoint.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

EXPOSE 3001

CMD ["node", "apps/worker/dist/main.js"]
