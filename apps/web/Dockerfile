# Football IQ web (Next.js standalone output).
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web --filter @fiq/contracts
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @fiq/contracts build && pnpm --filter web build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
RUN addgroup -S fiq && adduser -S fiq -G fiq
WORKDIR /app
COPY --from=build --chown=fiq:fiq /app/apps/web/.next/standalone ./
COPY --from=build --chown=fiq:fiq /app/apps/web/.next/static ./apps/web/.next/static
USER fiq
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
