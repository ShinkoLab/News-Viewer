import { Prisma } from "@/generated/prisma/client";
import { periodStart, type SearchFilters } from "@/lib/articleFilters";
import {
  ARTICLE_SELECT,
  getBatchesByIds,
  getPrisma,
  toArticleRecord,
  withMissingDbFallback,
} from "@/lib/db.sqlite";
import {
  clusterKeyOf,
  collapseCluster,
  compareArticleRecords,
  type ArticleRecord,
} from "@/lib/db.shared";
import { normalizeQuery } from "@/lib/embedding";
import { scoreCandidate, sortSearchResults, type Scored } from "@/lib/search.shared";
import type { SearchApiResponse, SearchResult } from "@/lib/types";

/**
 * SQLite 構成の検索。**キーワード一致のみ**で、embedding エンドポイントは呼ばない
 * （EMBEDDING_* が設定されていても同じ）。意味検索は Firestore 構成だけの機能。
 *
 * 候補は SQL の部分一致（LIKE）で集め、順位付けは Firestore 側と同じ
 * `scoreCandidate`（キーワード完全一致 / タイトル部分一致 / 本文部分一致の加点）で行う。
 * 常に `degraded: true` を返し、UI の「キーワード一致のみ」の案内を出す。
 */

/**
 * 候補の取得上限。スコア付けはこの件数を取ってからなので、上限内なら古い記事でも
 * 関連度順に並ぶ。超えたら新しい順に切り捨てて truncated を立て、UI に不完全の可能性を伝える。
 */
const CANDIDATE_LIMIT = 1000;

/** 1クエリに載せるバッチ数（OR 条件の肥大を避ける）。 */
const COMPLETE_CHUNK = 50;

function emptyResponse(query: string, truncated = false): SearchApiResponse {
  return { query, results: [], degraded: true, truncated };
}

/** LIKE のワイルドカード（% _）とエスケープ文字そのものを、文字どおりの一致にする。 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 検索語を含む記事の id を新しい順に返す。
 *
 * Prisma の `contains` は `%` `_` をエスケープしないため（"50%" や "snake_case" が
 * ほぼ全件に一致してしまう）、ESCAPE 付きの生 SQL で引く。期間は executed_at を
 * datetime() で正規化して比較する（prisma/schema.prisma の注意書き参照）。
 */
async function findCandidateIds(terms: string[], filters: SearchFilters, since: Date | undefined) {
  // keywords は JSON 配列の文字列（["AI", "OpenAI"]）で保存されている。素の部分一致を掛けると
  // `"` や `,` のような記号だけの検索語が全行に一致して候補を埋めてしまうので、
  // スコアで加点される「要素の完全一致」だけを `"語"` の形で引く。
  const textMatch = Prisma.join(
    terms.map((term) => {
      const pattern = `%${escapeLike(term)}%`;
      const keywordPattern = `%${escapeLike(JSON.stringify(term))}%`;
      return Prisma.sql`(summary_title LIKE ${pattern} ESCAPE '\\' OR summary_text LIKE ${pattern} ESCAPE '\\' OR keywords LIKE ${keywordPattern} ESCAPE '\\')`;
    }),
    " OR "
  );
  const period = since
    ? Prisma.sql`AND batch_id IN (SELECT id FROM batches WHERE datetime(executed_at) >= datetime(${since.toISOString()}))`
    : Prisma.empty;
  const category = filters.category ? Prisma.sql`AND category = ${filters.category}` : Prisma.empty;

  const rows = await getPrisma().$queryRaw<{ id: number }[]>`
    SELECT id FROM article_summaries
    WHERE (${textMatch}) ${period} ${category}
    ORDER BY batch_id DESC, id ASC
    LIMIT ${CANDIDATE_LIMIT + 1}
  `;
  return rows.map((row) => row.id);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** ヒットしたクラスタの全メンバーを読み直す（フィードと同じ畳み込みにするため）。 */
async function completeClusters(scored: Scored[]): Promise<Map<string, ArticleRecord[]>> {
  const complete = new Map<string, ArticleRecord[]>();
  const groupsByBatch = new Map<number, Set<number>>();
  for (const entry of scored) {
    if (entry.record.groupId === null) continue;
    const groups = groupsByBatch.get(entry.record.batchId) ?? new Set<number>();
    groups.add(entry.record.groupId);
    groupsByBatch.set(entry.record.batchId, groups);
  }

  for (const batches of chunk([...groupsByBatch], COMPLETE_CHUNK)) {
    const rows = await getPrisma().article_summaries.findMany({
      where: {
        OR: batches.map(([batchId, groups]) => ({
          batch_id: batchId,
          group_id: { in: [...groups] },
        })),
      },
      select: ARTICLE_SELECT,
    });
    for (const row of rows) {
      const record = toArticleRecord(row);
      const key = clusterKeyOf(record);
      const members = complete.get(key);
      if (members) members.push(record);
      else complete.set(key, [record]);
    }
  }
  for (const members of complete.values()) members.sort(compareArticleRecords);
  return complete;
}

async function search(filters: SearchFilters, now: Date): Promise<SearchApiResponse> {
  const rawQuery = filters.q.trim();
  const normalized = normalizeQuery(rawQuery);
  if (!normalized) return emptyResponse(rawQuery);

  const since = periodStart(filters.period, now);

  // 生の語と正規形（NFKC + 小文字）の両方で当てる。LIKE は ASCII の大文字小文字しか区別しないので、
  // 全角英数など NFKC でしか一致しない表記は SQL 側では拾えない（Firestore 側の
  // キーワード脚も完全一致のみで、同程度の制約）。
  const terms = [...new Set([rawQuery, normalized])];
  const ids = await findCandidateIds(terms, filters, since);
  const truncated = ids.length > CANDIDATE_LIMIT;
  if (ids.length === 0) return emptyResponse(rawQuery);

  const rows = await getPrisma().article_summaries.findMany({
    where: { id: { in: ids.slice(0, CANDIDATE_LIMIT) } },
    select: ARTICLE_SELECT,
  });

  // SQL は部分一致で広く拾うので、完全一致 / タイトル / 本文のいずれにも当たらないもの
  // （keywords の部分文字列にだけ当たったなど）は落とす。
  const scored = rows
    .map((row) => scoreCandidate({ record: toArticleRecord(row), distance: null }, normalized))
    .filter((entry) => entry.score > 0);
  if (scored.length === 0) return emptyResponse(rawQuery, truncated);

  const matchedByKey = new Map<string, Scored[]>();
  for (const entry of scored) {
    const key = clusterKeyOf(entry.record);
    const members = matchedByKey.get(key);
    if (members) members.push(entry);
    else matchedByKey.set(key, [entry]);
  }

  const [completeByKey, batches] = await Promise.all([
    completeClusters(scored),
    getBatchesByIds(scored.map((entry) => entry.record.batchId)),
  ]);

  const results: SearchResult[] = [];
  for (const [key, matched] of matchedByKey) {
    const batch = batches.get(matched[0].record.batchId);
    if (!batch) continue;

    const members = completeByKey.get(key) ?? matched.map((entry) => entry.record);
    results.push({
      article: collapseCluster(members),
      category: matched[0].record.category,
      batchId: batch.id,
      batchExecutedAt: batch.executedAt.toISOString(),
      score: Math.max(...matched.map((entry) => entry.score)),
      matchedKeyword: matched.some((entry) => entry.matchedKeyword),
    });
  }
  sortSearchResults(results);

  return { query: rawQuery, results, degraded: true, truncated };
}

export async function searchArticlesSqlite(
  filters: SearchFilters,
  now = new Date()
): Promise<SearchApiResponse> {
  // DB ファイルが未作成 / ロック中は、一覧と同じく空の結果として扱う。
  return withMissingDbFallback(() => search(filters, now), emptyResponse(filters.q.trim()));
}
