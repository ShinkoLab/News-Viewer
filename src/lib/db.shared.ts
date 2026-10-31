import type { Article, ArticleSource, BatchWithArticles } from "@/lib/types";
import { sortCategories, type CategorySort } from "@/lib/categorySort";
import type { ArticleFilters } from "@/lib/articleFilters";

export type BatchRecord = {
  id: number;
  executedAt: Date;
  totalArticles: number;
  digestText: string | null;
};

export type ArticleRecord = Omit<Article, "sources"> & {
  batchId: number;
  category: string;
  groupId: number | null;
  feedTitle: string | null;
};

/**
 * カテゴリが未設定/不正な記事のフォールバック表示名。
 * News-Summarizer 側 categories.yaml の `fallback: 未分類` とそろえている。
 */
export const FALLBACK_CATEGORY = "未分類";

/**
 * keywords の正規化。Firestore は配列（移行前データのみ JSON 文字列）、SQLite は
 * 常に JSON 文字列で保存されている。両実装の listArticles がここに一本化する。
 */
export function parseKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === "string");
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 記事 id の昇順比較。Firestore の doc id は非連番の英数字文字列なので文字列比較で
 * 問題ないが、SQLite の id は連番整数を文字列化したもの（"1","2",…,"10","11",…）
 * であり、単純な文字列比較では "10" < "9" になってしまい昇順の意図が崩れる。
 * 両方とも数値として解釈できる場合は数値で比較し、そうでなければ文字列比較に倒す。
 */
export function compareIds(a: string, b: string): number {
  // 全桁が数字のときだけ数値として比べる（"1e5" や "0x10" のような文字列は対象外）。
  // Number に通すと精度を失うので、桁数 → 辞書順で比較する（先頭の 0 は想定しない）。
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  }
  return a.localeCompare(b);
}

/**
 * カテゴリ内でのクラスタ表示順の決定的な並び。group_id 昇順、無い場合は id 昇順。
 * 実行ごとに表示が入れ替わらないようにする（Firestore/SQLite 共通）。
 */
export function compareArticleRecords(a: ArticleRecord, b: ArticleRecord): number {
  return (
    (a.groupId ?? Number.MAX_SAFE_INTEGER) - (b.groupId ?? Number.MAX_SAFE_INTEGER) || compareIds(a.id, b.id)
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
export function collapseCluster(members: ArticleRecord[]): Article {
  const representative = members.reduce((best, candidate) =>
    candidate.summaryText.length > best.summaryText.length ||
    (candidate.summaryText.length === best.summaryText.length && compareIds(candidate.id, best.id) < 0)
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

/**
 * クラスタのキー。group_id はバッチ内で一意なので batchId と組にすれば足りる。
 * groupId が null なのはグルーピングに失敗した記事で、null どうしは無関係。
 * 記事 id を混ぜて必ず単独クラスタにする。
 *
 * 検索もこれを使う。2か所に書くとフィードと検索で「同じニュース」の定義がずれる。
 */
export function clusterKeyOf(article: ArticleRecord): string {
  return article.groupId === null
    ? `${article.batchId} ${article.category} solo ${article.id}`
    : `${article.batchId} ${article.category} g${article.groupId}`;
}

/**
 * バックエンド非依存のクラスタ折り畳み・カテゴリ整列。Firestore/SQLite どちらの
 * 実装も、各自の `listArticles` で取得した ArticleRecord[] をここに渡すだけでよい
 * （バックエンドごとに再実装するとロジックがドリフトするため、ここに一本化する）。
 */
export function buildBatchesWithArticles(
  records: BatchRecord[],
  articles: ArticleRecord[],
  sort: CategorySort
): BatchWithArticles[] {
  const byBatch = new Map<number, Map<string, ArticleRecord[][]>>();
  for (const record of records) byBatch.set(record.id, new Map());

  const clusterByKey = new Map<string, ArticleRecord[]>();

  for (const article of articles) {
    const categories = byBatch.get(article.batchId);
    if (!categories) continue;

    let clusters = categories.get(article.category);
    if (!clusters) {
      clusters = [];
      categories.set(article.category, clusters);
    }

    const key = clusterKeyOf(article);
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

/** 絞り込み関数が各バックエンドに要求する最小の操作。 */
export type BatchSource = {
  listBatchesPage(
    limit: number,
    before?: Date,
    since?: Date
  ): Promise<{ records: BatchRecord[]; hasMore: boolean }>;
  hydrateBatches(records: BatchRecord[], sort: CategorySort): Promise<BatchWithArticles[]>;
};

const MAX_FILTER_SCAN_BATCHES = 30;

/**
 * フィルタUIに表示するカテゴリ候補。
 *
 * 本番は categories.yaml 由来の CATEGORY_ORDER をそのまま使う。未設定の
 * ローカル環境では、フィルタ結果とは独立した直近履歴から候補を復元する。
 */
export async function listCategoryOptionsFrom(source: BatchSource, sort: CategorySort): Promise<string[]> {
  if (sort.order.length > 0) return sort.order;

  const page = await source.listBatchesPage(30);
  const batches = await source.hydrateBatches(page.records, sort);
  return Array.from(
    new Set(batches.flatMap((batch) => batch.categories.map((entry) => entry.category)))
  ).sort((a, b) => a.localeCompare(b, "ja"));
}

export async function listFilteredBatchesPageFrom(
  source: BatchSource,
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
    const page = await source.listBatchesPage(scanLimit, cursor, since);
    if (page.records.length === 0) {
      hasMore = false;
      break;
    }
    scanned += page.records.length;

    const hydrated = await source.hydrateBatches(page.records, sort);
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
