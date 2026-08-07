# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Dependency layer — cached unless the manifests change.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Prisma schema + config must be present before `prisma generate`.
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Prisma 7 uses the in-process query compiler, so no engine binaries are
# downloaded and no platform-specific binaryTargets are required.
RUN bunx prisma generate

COPY . .
RUN bunx nest build

# Drop dev dependencies from the layer we copy forward.
RUN bun install --frozen-lockfile --production

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Production Runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS production

WORKDIR /app

# Run unprivileged. The base image already ships a `node` user.
RUN mkdir -p /app/logs && chown -R node:node /app

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/prisma ./prisma

USER node

ENV NODE_ENV=production
ENV PORT=3000
# api | worker | combined — see src/config/runtime.config.ts
ENV PROCESS_ROLE=api

EXPOSE 3000

# dumb-init-free: node handles SIGTERM and main.ts calls enableShutdownHooks(),
# which drains in-flight BullMQ jobs before exit.
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Override with ["node","dist/worker"] on the worker deployment.
CMD ["node", "dist/main"]
