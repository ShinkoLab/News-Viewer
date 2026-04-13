# Stage 1: deps
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Debian 系で better-sqlite3 などのネイティブモジュールを扱うための最小構成
# バイナリ取得に失敗した場合のフォールバック用
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# npm ci 時の自動 prisma generate をスキップし、better-sqlite3 のビルドは正常に実行させる
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npm ci

# Stage 2: builder
FROM node:22-bookworm-slim AS builder
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js のビルド時に Prisma クライアントが初期化される際のチェックを回避するためのダミー
ENV DATABASE_URL="file:./dev.db"

# BuildKit のキャッシュマウントを利用して Prisma Engine の毎回ダウンロードを防ぐ
RUN --mount=type=cache,target=/root/.cache/prisma \
    npx prisma generate

# BuildKit のキャッシュマウントを利用して Next.js のビルドキャッシュを永続化し、フルビルドを回避
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# Stage 3: runner
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 nextjs

# Copy only the production output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy prisma-generated client (needed at runtime)
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# DATABASE_URL must be provided at runtime
CMD ["node", "server.js"]
