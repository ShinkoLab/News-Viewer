import type { ArticleRecord } from "@/lib/db.shared";
import { normalizeQuery } from "@/lib/embedding";
import type { SearchResult } from "@/lib/types";

/**
 * 検索のバックエンド非依存部分（スコア計算と並び順）。
 * Firestore 実装（ハイブリッド）と SQLite 実装（キーワードのみ）が共有する。
 * 2か所に書くと、同じ記事に両バックエンドで別のスコアが付いてしまう。
 */

export const EXACT_KEYWORD_BOOST = 0.35;
export const TITLE_SUBSTRING_BOOST = 0.15;
export const BODY_SUBSTRING_BOOST = 0.05;

export type Candidate = {
  record: ArticleRecord;
  /** コサイン距離。キーワード脚だけで拾ったものは null。 */
  distance: number | null;
};

export type Scored = {
  record: ArticleRecord;
  score: number;
  matchedKeyword: boolean;
};

export function scoreCandidate(candidate: Candidate, normalized: string): Scored {
  const { record, distance } = candidate;

  // 1 - distance はコサイン類似度そのもので、サマライザの similarity_threshold と
  // 同じ単位。UI の「一致度 72%」がシステム全体で同じ意味になる。
  const vectorScore = distance === null ? 0 : Math.max(0, Math.min(1, 1 - distance));

  const matchedKeyword = record.keywords.some((kw) => normalizeQuery(kw) === normalized);
  const titleHit = normalizeQuery(record.summaryTitle).includes(normalized);
  const bodyHit = normalizeQuery(record.summaryText).includes(normalized);

  const score = Math.min(
    1,
    vectorScore +
      (matchedKeyword ? EXACT_KEYWORD_BOOST : 0) +
      (titleHit ? TITLE_SUBSTRING_BOOST : 0) +
      (bodyHit ? BODY_SUBSTRING_BOOST : 0)
  );

  return { record, score, matchedKeyword };
}

/** 実行ごとに並びがぶれないよう、スコアが同点でも決定的に並べる。 */
export function sortSearchResults(results: SearchResult[]): void {
  results.sort(
    (a, b) =>
      b.score - a.score ||
      b.batchExecutedAt.localeCompare(a.batchExecutedAt) ||
      a.article.id.localeCompare(b.article.id)
  );
}
