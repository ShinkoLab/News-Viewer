import {
  Firestore,
  type DocumentData,
  type Query,
} from "@google-cloud/firestore";
import type { Article, BatchWithArticles } from "@/lib/types";

export type BatchRecord = {
  id: number;
  executedAt: Date;
  totalArticles: number;
  digestText: string | null;
};

type ArticleRecord = Article & {
  batchId: number;
  category: string;
  groupId: number | null;
};

function createFirestore() {
  return new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined,
    databaseId: process.env.FIRESTORE_DATABASE || "(default)",
    ignoreUndefinedProperties: true,
  });
}

const globalForFirestore = globalThis as unknown as {
  firestore: Firestore | undefined;
};

export const firestore = globalForFirestore.firestore ?? createFirestore();

if (process.env.NODE_ENV !== "production") {
  globalForFirestore.firestore = firestore;
}

function asDate(value: unknown): Date {
  // Route Handler と Server Component で @google-cloud/firestore が別バンドルとして
  // 重複ロードされることがあり、Timestamp クラスの実体が異なると instanceof が
  // falseになるため、toDate の有無で判定する（dual package hazard対策）。
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  throw new Error("Firestore batch has an invalid executed_at value");
}

function mapBatch(id: string, data: DocumentData): BatchRecord {
  return {
    id: Number(data.id ?? id),
    executedAt: asDate(data.executed_at),
    totalArticles: Number(data.total_articles ?? 0),
    digestText: typeof data.digest_text === "string" ? data.digest_text : null,
  };
}

function mapArticle(id: string, data: DocumentData): ArticleRecord {
  let keywords: string[] = [];
  if (Array.isArray(data.keywords)) {
    keywords = data.keywords.filter((value: unknown): value is string => typeof value === "string");
  } else if (typeof data.keywords === "string") {
    try {
      const parsed = JSON.parse(data.keywords);
      if (Array.isArray(parsed)) keywords = parsed.filter((value): value is string => typeof value === "string");
    } catch {
      keywords = [];
    }
  }

  return {
    id: String(data.id ?? id),
    batchId: Number(data.batch_id),
    category: String(data.category ?? "未分類"),
    groupId: typeof data.group_id === "number" ? data.group_id : null,
    groupTopic: typeof data.group_topic === "string" ? data.group_topic : null,
    summaryTitle: String(data.summary_title ?? ""),
    summaryText: String(data.summary_text ?? ""),
    keywords,
    originalUrl: typeof data.original_url === "string" ? data.original_url : null,
    originalTitle: String(data.original_title ?? ""),
  };
}

export async function listBatchHeaders(limit = 30) {
  const snapshot = await firestore
    .collection("batches")
    .orderBy("executed_at", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => {
    const batch = mapBatch(doc.id, doc.data());
    return { id: batch.id, executed_at: batch.executedAt };
  });
}

export async function listBatchesPage(limit: number, before?: Date) {
  let query: Query = firestore.collection("batches").orderBy("executed_at", "desc");
  if (before) query = query.where("executed_at", "<", before);
  const snapshot = await query.limit(limit + 1).get();
  const records = snapshot.docs.map((doc) => mapBatch(doc.id, doc.data()));
  return { records: records.slice(0, limit), hasMore: records.length > limit };
}

export async function getBatch(batchId: number): Promise<BatchRecord | null> {
  const snapshot = await firestore.collection("batches").doc(String(batchId)).get();
  return snapshot.exists ? mapBatch(snapshot.id, snapshot.data()!) : null;
}

async function listArticles(batchIds: number[]): Promise<ArticleRecord[]> {
  if (batchIds.length === 0) return [];
  const snapshot = await firestore
    .collection("articleSummaries")
    .where("batch_id", "in", batchIds)
    .get();
  return snapshot.docs
    .map((doc) => mapArticle(doc.id, doc.data()))
    .sort((a, b) =>
      a.category.localeCompare(b.category, "ja") ||
      (a.groupId ?? Number.MAX_SAFE_INTEGER) - (b.groupId ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id)
    );
}

export async function hydrateBatches(records: BatchRecord[]): Promise<BatchWithArticles[]> {
  const articles = await listArticles(records.map((record) => record.id));
  const byBatch = new Map<number, Record<string, Article[]>>();
  for (const record of records) byBatch.set(record.id, {});

  for (const article of articles) {
    const categories = byBatch.get(article.batchId);
    if (!categories) continue;
    if (!categories[article.category]) categories[article.category] = [];
    categories[article.category].push({
      id: article.id,
      summaryTitle: article.summaryTitle,
      summaryText: article.summaryText,
      keywords: article.keywords,
      originalUrl: article.originalUrl,
      originalTitle: article.originalTitle,
      groupTopic: article.groupTopic,
    });
  }

  return records.map((record) => ({
    id: record.id,
    executedAt: record.executedAt.toISOString(),
    totalArticles: record.totalArticles,
    digestText: record.digestText,
    categories: Object.entries(byBatch.get(record.id) ?? {}).map(([category, categoryArticles]) => ({
      category,
      articles: categoryArticles,
    })),
  }));
}
