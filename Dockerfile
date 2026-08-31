# Stage 1: deps
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 (DB_BACKEND=sqlite 用) のネイティブビルドに必要
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# prisma generate は builder ステージで明示的に走らせるので、npm install 中には不要
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npm ci

# Stage 2: builder
FROM node:22-bookworm-slim AS builder
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ビルド時点では実データベースは無いのでダミーの DATABASE_URL で prisma generate だけ行う
# （実際の接続先は実行時に DB_BACKEND=sqlite の場合のみ DATABASE_URL 経由で渡される）
ENV DATABASE_URL="file:./dev.db"
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
# standalone 出力には Prisma のクライアント生成物は含まれないため別途コピーする
# （DB_BACKEND=sqlite のときのみ実際に読み込まれる）
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated

# Copy license and notice files for compliance
COPY --from=builder --chown=nextjs:nodejs /app/LICENSE ./LICENSE
COPY --from=builder --chown=nextjs:nodejs /app/THIRD-PARTY-NOTICES.md ./THIRD-PARTY-NOTICES.md
COPY --from=builder --chown=nextjs:nodejs /app/README.md ./README.md

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
