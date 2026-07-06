# Football IQ API + worker image.
# Same image serves both roles: CMD switches between dist/main (HTTP) and
# dist/worker (BullMQ processors), so API and worker pods scale independently.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ---- build: full workspace install, compile contracts + api ----
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api --filter @fiq/contracts
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @fiq/contracts build \
  && cd apps/api \
  && pnpm exec prisma generate \
  && pnpm build

# ---- prune: production-only dependency tree for the api package ----
FROM build AS prune
RUN pnpm --filter api deploy --prod /prod

# ---- runner ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production
RUN addgroup -S fiq && adduser -S fiq -G fiq
WORKDIR /app
COPY --from=prune /prod/node_modules ./node_modules
COPY --from=prune /prod/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
# Prisma client engines were generated during build; regenerate against the
# pruned tree so the runtime engine is present in this layer.
RUN npx prisma generate && chown -R fiq:fiq /app
USER fiq
EXPOSE 4000
CMD ["node", "dist/main"]
