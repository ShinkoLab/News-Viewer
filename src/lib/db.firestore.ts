import {
  Firestore,
  type DocumentData,
  type Query,
} from "@google-cloud/firestore";
import type { BatchWithArticles } from "@/lib/types";
import { DEFAULT_SORT_MODE, type CategorySort } from "@/lib/categorySort";
import {
  buildBatchesWithArticles,
  compareArticleRecords,
  parseKeywords,
  FALLBACK_CATEGORY,
  type ArticleRecord,
  type BatchRecord,
} from "@/lib/db.shared";

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

// モジュール読み込み時に即座に Firestore クライアントを作らず、実際に呼ばれる
// まで生成を遅らせる（db.sqlite.ts の getPrisma() と同じ方針）。db.ts は
// DB_BACKEND に応じてこのモジュールを動的 import するだけなので普段は問題に
// ならないが、HMR や将来の呼び出し経路の変化に対しても ADC 解決などの
// 初期化コストを本当に必要になるまで発生させない、という安全側の設計にしておく。
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
  return {
    id: String(data.id ?? id),
    batchId: Number(data.batch_id),
    category: String(data.category ?? FALLBACK_CATEGORY),
    groupId: typeof data.group_id === "number" ? data.group_id : null,
    groupTopic: typeof data.group_topic === "string" ? data.group_topic : null,
    summaryTitle: String(data.summary_title ?? ""),
    summaryText: String(data.summary_text ?? ""),
    keywords: parseKeywords(data.keywords),
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
  return snapshot.docs.map((doc) => mapArticle(doc.id, doc.data())).sort(compareArticleRecords);
}

export async function hydrateBatches(
  records: BatchRecord[],
  sort: CategorySort = { mode: DEFAULT_SORT_MODE, order: [] }
): Promise<BatchWithArticles[]> {
  const articles = await listArticles(records.map((record) => record.id));
  return buildBatchesWithArticles(records, articles, sort);
}
