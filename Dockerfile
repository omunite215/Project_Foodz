# syntax=docker/dockerfile:1.7

FROM node:26-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---------------------------------------------------------------- dependencies
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------- build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Secrets are not available at build time; they are validated when the server starts.
ENV SKIP_ENV_VALIDATION=1
RUN npx prisma generate && npx next build

# ---------------------------------------------------------------- migrations (one-shot job)
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/db/generated ./server/db/generated
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
# The seed builds the menu from the original constants.
COPY constants ./constants
COPY scripts/storage-setup.mjs ./scripts/
USER node
# Apply migrations, seed (idempotent: existing rows are left alone), prepare storage buckets.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node node_modules/tsx/dist/cli.mjs prisma/seed.ts && node scripts/storage-setup.mjs"]

# ---------------------------------------------------------------- runtime
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The runtime never installs packages; removing npm, yarn and corepack drops their dependencies
# (and any vulnerabilities in them) from the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
