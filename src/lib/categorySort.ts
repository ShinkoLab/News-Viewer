import type { CategoryEntry } from "@/lib/types";

/**
 * カテゴリの並び順。サーバ（初回描画）とクライアント（切り替え時）の双方が
 * この同じ比較関数を使うため、初回描画でハイドレーション不整合が起きない。
 */
export const CATEGORY_SORT_MODES = ["definition", "count", "name"] as const;

export type CategorySortMode = (typeof CATEGORY_SORT_MODES)[number];

export const DEFAULT_SORT_MODE: CategorySortMode = "definition";

/** 並び順の選択を保存する Cookie 名。サーバが読み、クライアントが書く。 */
export const SORT_COOKIE_NAME = "category_sort";

export type CategorySort = {
  mode: CategorySortMode;
  /** categories.yaml の定義順。空なら definition は名前順に縮退する。 */
  order: string[];
};

export function parseSortMode(raw: string | undefined): CategorySortMode {
  return CATEGORY_SORT_MODES.includes(raw as CategorySortMode)
    ? (raw as CategorySortMode)
    : DEFAULT_SORT_MODE;
}

/**
 * CATEGORY_ORDER 環境変数（カンマ区切り）をカテゴリ名の配列に変換する。
 * 値の定義元は News-Summarizer/categories.yaml で、infra/main.tf が注入する。
 */
export function parseCategoryOrder(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * 実記事数。カードは類似記事を束ねているので枚数とは一致しない。
 * CategorySection の件数バッジと同じ数え方にして、並びとバッジが矛盾しないようにする。
 */
function articleCount(entry: CategoryEntry): number {
  return entry.articles.reduce((total, article) => total + article.sources.length, 0);
}

/**
 * 定義順の順位。order にないカテゴリ（「未分類」等）は末尾へ回す。
 * サマライザ側のダイジェスト生成（summarizer/digest.py）と同じ規則。
 */
function definitionRank(category: string, order: string[]): number {
  const index = order.indexOf(category);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

const byName = (a: CategoryEntry, b: CategoryEntry) =>
  a.category.localeCompare(b.category, "ja");

/**
 * カテゴリを指定の並び順に整列する（非破壊）。
 *
 * order が空（CATEGORY_ORDER 未設定のローカル開発など）のときは全カテゴリが
 * 同順位になり、definition は名前順へ縮退する。
 */
export function sortCategories(
  entries: CategoryEntry[],
  { mode, order }: CategorySort
): CategoryEntry[] {
  const byDefinition = (a: CategoryEntry, b: CategoryEntry) =>
    definitionRank(a.category, order) - definitionRank(b.category, order) || byName(a, b);

  const comparator =
    mode === "count"
      ? (a: CategoryEntry, b: CategoryEntry) =>
          articleCount(b) - articleCount(a) || byDefinition(a, b)
      : mode === "name"
        ? byName
        : byDefinition;

  return [...entries].sort(comparator);
}
