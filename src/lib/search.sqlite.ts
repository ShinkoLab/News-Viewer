import type { Prisma } from "@/generated/prisma/client";
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

/** 候補の取得上限。超えたら truncated を立てて UI に不完全の可能性を伝える。 */
const CANDIDATE_LIMIT = 200;

/** 1クエリに載せるバッチ数（OR 条件の肥大を避ける）。 */
const COMPLETE_CHUNK = 50;

function emptyResponse(query: string, truncated = false): SearchApiResponse {
  return { query, results: [], degraded: true, truncated };
}

/** 期間内のバッチ ID。executed_at は datetime() で正規化して比較する（prisma/schema.prisma の注意書き参照）。 */
async function batchIdsSince(since: Date): Promise<number[]> {
  const rows = await getPrisma().$queryRaw<{ id: number }[]>`
    SELECT id FROM batches
    WHERE datetime(executed_at) >= datetime(${since.toISOString()})
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
  const where: Prisma.article_summariesWhereInput[] = [];

  if (since) {
    const ids = await batchIdsSince(since);
    if (ids.length === 0) return emptyResponse(rawQuery);
    where.push({ batch_id: { in: ids } });
  }
  if (filters.category) where.push({ category: filters.category });

  // 生の語と正規形（NFKC + 小文字）の両方で当てる。LIKE は ASCII の大文字小文字を区別しない。
  const terms = [...new Set([rawQuery, normalized])];
  where.push({
    OR: terms.flatMap((term) => [
      { summary_title: { contains: term } },
      { summary_text: { contains: term } },
      { keywords: { contains: term } },
    ]),
  });

  const rows = await getPrisma().article_summaries.findMany({
    where: { AND: where },
    select: ARTICLE_SELECT,
    // 新しい順。上限に当たったら古い一致を取りこぼす。
    orderBy: [{ batch_id: "desc" }, { id: "asc" }],
    take: CANDIDATE_LIMIT + 1,
  });
  const truncated = rows.length > CANDIDATE_LIMIT;

  // SQL は部分一致で広く拾うので、完全一致 / タイトル / 本文のいずれにも当たらないもの
  // （keywords の部分文字列にだけ当たったなど）は落とす。
  const scored = rows
    .slice(0, CANDIDATE_LIMIT)
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
