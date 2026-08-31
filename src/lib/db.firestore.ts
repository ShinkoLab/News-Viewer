import {
  Firestore,
  type DocumentData,
  type Query,
} from "@google-cloud/firestore";
import type { BatchWithArticles } from "@/lib/types";
import { DEFAULT_SORT_MODE, type CategorySort } from "@/lib/categorySort";
import { buildBatchesWithArticles, type ArticleRecord, type BatchRecord } from "@/lib/db.shared";

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

// db.ts はバックエンドに関係なく db.firestore.ts と db.sqlite.ts を両方静的 import
// するため、ここでモジュール読み込み時に Firestore クライアントを作ってしまうと
// DB_BACKEND=sqlite の環境でも常に ADC 解決などの初期化コストが発生する。
// 実際に呼ばれるまで生成を遅らせる（db.sqlite.ts の getPrisma() と同じ方針）。
function getFirestore(): Firestore {
  if (!globalForFirestore.firestore) {
    globalForFirestore.firestore = createFirestore();
  }
  return globalForFirestore.firestore;
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
    // feed_title は後から追加したフィールド。それ以前の記事には存在しない
    // （表示側で URL のホスト名にフォールバックする）。
    feedTitle: typeof data.feed_title === "string" ? data.feed_title : null,
  };
}

export async function listBatchHeaders(limit = 30) {
  const snapshot = await getFirestore()
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
  let query: Query = getFirestore().collection("batches").orderBy("executed_at", "desc");
  if (before) query = query.where("executed_at", "<", before);
  const snapshot = await query.limit(limit + 1).get();
  const records = snapshot.docs.map((doc) => mapBatch(doc.id, doc.data()));
  return { records: records.slice(0, limit), hasMore: records.length > limit };
}

export async function getBatch(batchId: number): Promise<BatchRecord | null> {
  const snapshot = await getFirestore().collection("batches").doc(String(batchId)).get();
  return snapshot.exists ? mapBatch(snapshot.id, snapshot.data()!) : null;
}

async function listArticles(batchIds: number[]): Promise<ArticleRecord[]> {
  if (batchIds.length === 0) return [];
  const snapshot = await getFirestore()
    .collection("articleSummaries")
    .where("batch_id", "in", batchIds)
    .get();
  // カテゴリの表示順はここでは決めない（hydrateBatches が sortCategories で確定する）。
  // カテゴリのグルーピング自体は Map のキーが担うので、ここで必要なのは
  // カテゴリ内のクラスタ順を実行ごとにぶれさせないことだけ。
  return snapshot.docs
    .map((doc) => mapArticle(doc.id, doc.data()))
    .sort((a, b) =>
      (a.groupId ?? Number.MAX_SAFE_INTEGER) - (b.groupId ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id)
    );
}

export async function hydrateBatches(
  records: BatchRecord[],
  sort: CategorySort = { mode: DEFAULT_SORT_MODE, order: [] }
): Promise<BatchWithArticles[]> {
  const articles = await listArticles(records.map((record) => record.id));
  return buildBatchesWithArticles(records, articles, sort);
}
