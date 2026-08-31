# Stage 1: deps
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 (DB_BACKEND=sqlite 用) のネイティブビルドに必要
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# package.json の postinstall（prisma generate）がスキーマを必要とするため、
# npm ci より前にコピーしておく（このステージではまだソース全体を COPY しない）。
# ここで生成される src/generated/prisma はこのステージにしか存在せず
# （下の builder ステージへは node_modules しか COPY しないため）使われないが、
# 削っても npm ci の高速化にはならない一方、postinstall 自体は消せない
# （消すと npm ci が「schema.prisma が無い」で失敗する）ので、無駄を承知で
# そのままにしてある。実際にビルドで使われる生成物は builder ステージの
# 明示的な `npx prisma generate`（下）が作る方。
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

# Stage 2: builder
FROM node:22-bookworm-slim AS builder
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# prisma/schema.prisma の datasource ブロックは url を持たない（接続先は実行時に
# db.sqlite.ts が DATABASE_URL からアダプタへ直接渡す）ため、generate 自体は
# DATABASE_URL 無しで完結する。ここで生成される src/generated/prisma が
# 実際に runner ステージへコピーされる版になる。
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
