import {
  Firestore,
  type DocumentData,
  type Query,
} from "@google-cloud/firestore";
import type { Article, ArticleSource, BatchWithArticles } from "@/lib/types";
import {
  DEFAULT_SORT_MODE,
  sortCategories,
  type CategorySort,
} from "@/lib/categorySort";
import type { ArticleFilters } from "@/lib/articleFilters";

export type BatchRecord = {
  id: number;
  executedAt: Date;
  totalArticles: number;
  digestText: string | null;
};

type ArticleRecord = Omit<Article, "sources"> & {
  batchId: number;
  category: string;
  groupId: number | null;
  feedTitle: string | null;
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
    // feed_title は後から追加したフィールド。それ以前の記事には存在しない
    // （表示側で URL のホスト名にフォールバックする）。
    feedTitle: typeof data.feed_title === "string" ? data.feed_title : null,
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

export async function listBatchesPage(limit: number, before?: Date, since?: Date) {
  let query: Query = firestore.collection("batches").orderBy("executed_at", "desc");
  if (before) query = query.where("executed_at", "<", before);
  if (since) query = query.where("executed_at", ">=", since);
  const snapshot = await query.limit(limit + 1).get();
  const records = snapshot.docs.map((doc) => mapBatch(doc.id, doc.data()));
  return { records: records.slice(0, limit), hasMore: records.length > limit };
}

const MAX_FILTER_SCAN_BATCHES = 30;

/**
 * フィルタUIに表示するカテゴリ候補。
 *
 * 本番は categories.yaml 由来の CATEGORY_ORDER をそのまま使う。未設定の
 * ローカル環境では、フィルタ結果とは独立した直近履歴から候補を復元する。
 */
export async function listCategoryOptions(sort: CategorySort): Promise<string[]> {
  if (sort.order.length > 0) return sort.order;

  const page = await listBatchesPage(30);
  const batches = await hydrateBatches(page.records, sort);
  return Array.from(
    new Set(batches.flatMap((batch) => batch.categories.map((entry) => entry.category)))
  ).sort((a, b) => a.localeCompare(b, "ja"));
}

export async function listFilteredBatchesPage(
  limit: number,
  sort: CategorySort,
  filters: ArticleFilters,
  before?: Date,
  since?: Date
) {
  let cursor = before;
  const matches: BatchWithArticles[] = [];
  let hasMore = false;
  let scanned = 0;

  while (matches.length < limit && scanned < MAX_FILTER_SCAN_BATCHES) {
    const scanLimit = Math.min(limit, MAX_FILTER_SCAN_BATCHES - scanned);
    const page = await listBatchesPage(scanLimit, cursor, since);
    if (page.records.length === 0) {
      hasMore = false;
      break;
    }
    scanned += page.records.length;

    const hydrated = await hydrateBatches(page.records, sort);
    for (const batch of hydrated) {
      const categories = filters.category
        ? batch.categories.filter((entry) => entry.category === filters.category)
        : batch.categories;
      if (categories.length === 0) continue;

      matches.push({
        ...batch,
        categories,
        totalArticles: filters.category
          ? categories.reduce(
              (total, entry) =>
                total + entry.articles.reduce((count, article) => count + article.sources.length, 0),
              0
            )
          : batch.totalArticles,
        // 全カテゴリの文章なので、カテゴリ指定時には誤解を避けるため表示しない。
        digestText: filters.category ? null : batch.digestText,
      });
      cursor = new Date(batch.executedAt);
      if (matches.length === limit) {
        hasMore = page.hasMore || batch.id !== hydrated.at(-1)?.id;
        break;
      }
    }

    if (matches.length === limit) break;
    cursor = page.records.at(-1)?.executedAt;
    if (!page.hasMore) {
      hasMore = false;
      break;
    }

    // カテゴリ索引がない現行スキーマで、希少または不正なカテゴリによる
    // 1リクエストの全履歴走査を防ぐ。続きは nextBefore から明示的に取得する。
    if (scanned >= MAX_FILTER_SCAN_BATCHES) hasMore = true;
  }

  return {
    batches: matches,
    hasMore,
    nextBefore: cursor?.toISOString() ?? null,
  };
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

function toSource(article: ArticleRecord): ArticleSource {
  return {
    id: article.id,
    originalTitle: article.originalTitle,
    originalUrl: article.originalUrl,
    feedTitle: article.feedTitle,
  };
}

/**
 * 同一クラスタの記事を1件の Article に畳む。
 *
 * サマライザは取得ソースの違う同じニュースを embedding でクラスタリングして
 * group_id を振っているが、ここで畳まないと同じ記事が人数分のカードとして並ぶ。
 *
 * 代表は要約本文が最も長いもの（＝最も情報量のあるカードを表に出す）。
 * 同点は id 昇順にして、実行ごとに表示が入れ替わらないようにする。
 */
function collapseCluster(members: ArticleRecord[]): Article {
  const representative = members.reduce((best, candidate) =>
    candidate.summaryText.length > best.summaryText.length ||
    (candidate.summaryText.length === best.summaryText.length && candidate.id < best.id)
      ? candidate
      : best
  );

  return {
    id: representative.id,
    summaryTitle: representative.summaryTitle,
    summaryText: representative.summaryText,
    keywords: representative.keywords,
    originalUrl: representative.originalUrl,
    originalTitle: representative.originalTitle,
    groupTopic: representative.groupTopic,
    sources: [
      toSource(representative),
      ...members.filter((member) => member.id !== representative.id).map(toSource),
    ],
  };
}

export async function hydrateBatches(
  records: BatchRecord[],
  sort: CategorySort = { mode: DEFAULT_SORT_MODE, order: [] }
): Promise<BatchWithArticles[]> {
  const articles = await listArticles(records.map((record) => record.id));
  const byBatch = new Map<number, Map<string, ArticleRecord[][]>>();
  for (const record of records) byBatch.set(record.id, new Map());

  // クラスタのキー。group_id はバッチ内で一意なので batchId と組にすれば足りる。
  // groupId が null なのはグルーピングに失敗した記事で、null どうしは無関係。
  // 記事 id を混ぜて必ず単独クラスタにする。
  const clusterKey = (article: ArticleRecord) =>
    article.groupId === null
      ? `${article.batchId} ${article.category} solo ${article.id}`
      : `${article.batchId} ${article.category} g${article.groupId}`;

  const clusterByKey = new Map<string, ArticleRecord[]>();

  for (const article of articles) {
    const categories = byBatch.get(article.batchId);
    if (!categories) continue;

    let clusters = categories.get(article.category);
    if (!clusters) {
      clusters = [];
      categories.set(article.category, clusters);
    }

    const key = clusterKey(article);
    const existing = clusterByKey.get(key);
    if (existing) {
      existing.push(article);
    } else {
      const members = [article];
      clusterByKey.set(key, members);
      clusters.push(members);
    }
  }

  return records.map((record) => ({
    id: record.id,
    executedAt: record.executedAt.toISOString(),
    totalArticles: record.totalArticles,
    digestText: record.digestText,
    categories: sortCategories(
      [...(byBatch.get(record.id) ?? new Map<string, ArticleRecord[][]>())].map(([category, clusters]) => ({
        category,
        articles: clusters.map(collapseCluster),
      })),
      sort
    ),
  }));
}
