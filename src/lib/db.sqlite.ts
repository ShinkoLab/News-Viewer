import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type { BatchWithArticles } from "@/lib/types";
import { DEFAULT_SORT_MODE, type CategorySort } from "@/lib/categorySort";
import {
  buildBatchesWithArticles,
  compareArticleRecords,
  parseKeywords,
  type ArticleRecord,
  type BatchRecord,
} from "@/lib/db.shared";

function createPrismaClient() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");
  // Strip the "file:" prefix for the adapter
  const url = dbUrl.replace(/^file:/, "") as ":memory:" | (string & object);
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// db.ts はバックエンドに関係なく db.firestore.ts と db.sqlite.ts を両方静的 import
// するため、ここでモジュール読み込み時に Prisma クライアントを作ってしまうと
// DB_BACKEND=sqlite でない環境（DATABASE_URL 未設定）でも即座に例外になる。
// 実際に呼ばれるまで生成を遅らせる。
function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

type BatchRow = {
  id: number;
  executed_at: Date;
  total_articles: number;
  digest_text: string | null;
};

function toBatchRecord(row: BatchRow): BatchRecord {
  return {
    id: row.id,
    executedAt: row.executed_at,
    totalArticles: row.total_articles,
    digestText: row.digest_text,
  };
}

type ArticleRow = {
  id: number;
  batch_id: number;
  category: string;
  group_id: number | null;
  group_topic: string | null;
  summary_title: string;
  summary_text: string;
  keywords: string;
  original_url: string | null;
  original_title: string;
  feed_title: string | null;
};

function toArticleRecord(row: ArticleRow): ArticleRecord {
  return {
    id: String(row.id),
    batchId: row.batch_id,
    category: row.category ?? "未分類",
    groupId: row.group_id,
    groupTopic: row.group_topic,
    summaryTitle: row.summary_title,
    summaryText: row.summary_text,
    keywords: parseKeywords(row.keywords),
    originalUrl: row.original_url,
    originalTitle: row.original_title,
    // feed_title は後から追加した列。それ以前の記事には値が無い
    // （表示側で URL のホスト名にフォールバックする）。
    feedTitle: row.feed_title,
  };
}

export async function listBatchHeaders(limit = 30) {
  const rows = await getPrisma().batches.findMany({
    orderBy: { executed_at: "desc" },
    take: limit,
    select: { id: true, executed_at: true },
  });
  return rows.map((row) => ({ id: row.id, executed_at: row.executed_at }));
}

export async function listBatchesPage(limit: number, before?: Date) {
  const rows = await getPrisma().batches.findMany({
    where: before ? { executed_at: { lt: before } } : undefined,
    orderBy: { executed_at: "desc" },
    take: limit + 1,
  });
  const records = rows.map(toBatchRecord);
  return { records: records.slice(0, limit), hasMore: records.length > limit };
}

export async function getBatch(batchId: number): Promise<BatchRecord | null> {
  const row = await getPrisma().batches.findUnique({ where: { id: batchId } });
  return row ? toBatchRecord(row) : null;
}

async function listArticles(batchIds: number[]): Promise<ArticleRecord[]> {
  if (batchIds.length === 0) return [];
  const rows = await getPrisma().article_summaries.findMany({
    where: { batch_id: { in: batchIds } },
  });
  // カテゴリの表示順はここでは決めない（hydrateBatches が sortCategories で確定する）。
  // カテゴリのグルーピング自体は Map のキーが担うので、ここで必要なのは
  // カテゴリ内のクラスタ順を実行ごとにぶれさせないことだけ（Firestore版と同じ方針）。
  return rows.map(toArticleRecord).sort(compareArticleRecords);
}

export async function hydrateBatches(
  records: BatchRecord[],
  sort: CategorySort = { mode: DEFAULT_SORT_MODE, order: [] }
): Promise<BatchWithArticles[]> {
  const articles = await listArticles(records.map((record) => record.id));
  return buildBatchesWithArticles(records, articles, sort);
}
