import type { SearchFilters } from "@/lib/articleFilters";
import type { SearchApiResponse } from "@/lib/types";

/**
 * 検索のバックエンド選択（db.ts と同じ DB_BACKEND）。
 *
 * - Firestore（既定）: ベクトル kNN とキーワード一致のハイブリッド（search.firestore.ts）
 * - SQLite: **キーワード一致のみ**（search.sqlite.ts）。embedding エンドポイントは
 *   EMBEDDING_* が設定されていても呼ばない。Firestore の `findNearest` 相当が無く、
 *   記事ベクトルを全件読んで総当たりするのは自前ホストの想定規模でも割に合わないため。
 *
 * 動的 import で選ばれた側だけを読み込む。これにより SQLite 構成では Firestore SDK を
 * 評価せず、Firestore 構成では better-sqlite3 のネイティブバイナリを評価しない。
 */
export async function searchArticles(
  filters: SearchFilters,
  now = new Date()
): Promise<SearchApiResponse> {
  if (process.env.DB_BACKEND === "sqlite") {
    const impl = await import("@/lib/search.sqlite");
    return impl.searchArticlesSqlite(filters, now);
  }
  const impl = await import("@/lib/search.firestore");
  return impl.searchArticlesFirestore(filters, now);
}
