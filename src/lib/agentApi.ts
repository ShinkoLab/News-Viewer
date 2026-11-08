import { createHash, timingSafeEqual } from "node:crypto";
import * as db from "@/lib/db";
import { searchArticles } from "@/lib/search";
import { ARTICLE_PERIODS, parseArticleFilters, periodStart } from "@/lib/articleFilters";
import { parseBatchBoundary } from "@/lib/batchCursor";
import { parseCategoryOrder } from "@/lib/categorySort";
import type { Article, BatchWithArticles } from "@/lib/types";

type Dependencies = Pick<typeof db, "getBatch" | "hydrateBatches" | "listFilteredBatchesPage" | "listCategoryOptions"> & {
  searchArticles: typeof searchArticles;
};
const dependencies: Dependencies = { ...db, searchArticles };
class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
}
function articleDto(a: Article, batchId: number, batchExecutedAt: string, category: string) {
  return {
    id: a.id, batchId, category, batchExecutedAt,
    publishedAt: a.publishedAt ?? null, storedAt: a.storedAt ?? null, fetchedAt: null,
    summaryTitle: a.summaryTitle, summaryText: a.summaryText, keywords: a.keywords,
    originalTitle: a.originalTitle, originalUrl: a.originalUrl, groupTopic: a.groupTopic,
    sources: a.sources.map(s => ({
      id: s.id, originalTitle: s.originalTitle, originalUrl: s.originalUrl,
      feedTitle: s.feedTitle, publishedAt: s.publishedAt ?? null, storedAt: s.storedAt ?? null,
    })),
    contentKind: "cluster_summary", fullTextAvailable: false,
  };
}
function batchDto(b: BatchWithArticles) {
  return {
    id: b.id, batchExecutedAt: b.executedAt, totalArticles: b.totalArticles,
    status: b.status ?? "unknown", digestText: b.digestText,
    categories: b.categories.map(c => ({
      category: c.category, articles: c.articles.map(a => articleDto(a, b.id, b.executedAt, c.category)),
    })),
  };
}
function batchId(raw: string) {
  if (!/^[1-9]\d{0,15}$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new ApiError(400, "invalid_batch_id");
  return Number(raw);
}
function params(url: URL, allowed: string[]) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new ApiError(400, "invalid_parameters");
  }
  const period = url.searchParams.get("period");
  if (period !== null && !(ARTICLE_PERIODS as readonly string[]).includes(period)) throw new ApiError(400, "invalid_period");
  const category = url.searchParams.get("category");
  if (category !== null && (!category.trim() || category.length > 100)) throw new ApiError(400, "invalid_category");
  return parseArticleFilters({ period: period ?? undefined, category: category ?? undefined });
}

/** One budget per handler/process, independent of spoofable client IP headers. */
export function createAgentApi(deps: Dependencies = dependencies, env = process.env, now = () => Date.now()) {
  let windowStart = 0, requests = 0, active = 0;
  return async function handle(request: Request, path: string[]): Promise<Response> {
    try {
      const key = env.NEWS_API_KEY;
      if (!key || key.length < 32 || key.length > 256) throw new ApiError(503, "api_disabled");
      const supplied = request.headers.get("x-news-api-key") ?? "";
      if (supplied.length > 256 || !timingSafeEqual(
        createHash("sha256").update(key).digest(), createHash("sha256").update(supplied).digest()
      )) throw new ApiError(401, "unauthorized");
      if (request.method !== "GET") throw new ApiError(405, "method_not_allowed");
      const backend = env.DB_BACKEND ?? "firestore";
      if (!["sqlite", "firestore"].includes(backend)) throw new ApiError(503, "invalid_backend");
      const time = now();
      if (time - windowStart >= 60000) { windowStart = time; requests = 0; }
      if (requests >= 60 || active >= 4) throw new ApiError(429, "rate_limited");
      requests++; active++;
      try {
        const url = new URL(request.url);
        if (url.search.length > 4096) throw new ApiError(400, "parameters_too_long");
        const sort = { mode: "definition" as const, order: parseCategoryOrder(env.CATEGORY_ORDER) };
        const meta = {
          apiVersion: "v1", backend, periodBasis: "batchExecutedAt",
          // SQLite's legacy reader can turn unavailable/locked DB errors into empty results.
          availability: backend === "sqlite" ? "not_verified" : "queried",
        };
        if (path.length === 1 && path[0] === "categories") {
          params(url, []);
          return json({ categories: await deps.listCategoryOptions(sort), meta: {
            ...meta, categoryScope: sort.order.length ? "configured" : "latest_30_batches",
          } });
        }
        if (path.length === 1 && path[0] === "search") {
          const filters = params(url, ["q", "category", "period"]);
          const q = url.searchParams.get("q")?.trim() ?? "";
          if (!q || q.length > 500) throw new ApiError(400, "invalid_query");
          if (backend === "firestore" && env.NEWS_API_ALLOW_FIRESTORE_SEARCH !== "true") {
            throw new ApiError(403, "firestore_search_not_enabled");
          }
          const found = await deps.searchArticles({ ...filters, q }, new Date(time));
          return json({
            query: found.query,
            results: found.results.slice(0, 50).map(r => ({
              article: articleDto(r.article, r.batchId, r.batchExecutedAt, r.category),
              score: r.score, matchedKeyword: r.matchedKeyword,
            })),
            degraded: found.degraded, truncated: found.truncated || found.results.length > 50,
            meta: { ...meta, searchMode: backend === "sqlite" || found.degraded ? "keyword" : "hybrid",
              completeness: found.truncated || found.results.length > 50 ? "possibly_incomplete" : "not_guaranteed" },
          });
        }
        if (path.length === 1 && path[0] === "batches") {
          const filters = params(url, ["category", "period", "before", "limit"]);
          const rawLimit = url.searchParams.get("limit") ?? "3";
          if (!/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit) > 10) throw new ApiError(400, "invalid_limit");
          let before;
          try {
            const raw = url.searchParams.get("before");
            before = raw === null ? undefined : parseBatchBoundary(raw);
          } catch { throw new ApiError(400, "invalid_cursor"); }
          const page = await deps.listFilteredBatchesPage(Number(rawLimit), sort, filters, before, periodStart(filters.period, new Date(time)));
          return json({ batches: page.batches.map(batchDto), hasMore: page.hasMore,
            nextBefore: page.hasMore ? page.nextBefore : null,
            meta: { ...meta, scanLimited: page.hasMore && page.batches.length < Number(rawLimit) } });
        }
        if (path[0] === "batches" && (path.length === 2 || (path.length === 4 && path[2] === "articles"))) {
          params(url, []);
          const id = batchId(path[1]);
          if (path.length === 4 && !/^[A-Za-z0-9_-]{1,128}$/.test(path[3])) throw new ApiError(400, "invalid_article_id");
          const record = await deps.getBatch(id);
          if (!record) throw new ApiError(404, "batch_not_found");
          const [batch] = await deps.hydrateBatches([record], sort);
          if (!batch) throw new ApiError(503, "batch_unavailable");
          if (path.length === 2) return json({ batch: batchDto(batch), meta });
          for (const c of batch.categories) {
            // Resolve any source ID to its current representative cluster summary.
            const article = c.articles.find(a => a.sources.some(s => s.id === path[3]));
            if (article) return json({ requestedArticleId: path[3], article: articleDto(article, id, batch.executedAt, c.category), meta });
          }
          throw new ApiError(404, "article_not_found");
        }
        throw new ApiError(404, "not_found");
      } finally { active--; }
    } catch (error) {
      // Do not log tokens, queries, upstream URLs or database error messages.
      return error instanceof ApiError
        ? json({ error: { code: error.code } }, error.status)
        : json({ error: { code: "upstream_unavailable" } }, 503);
    }
  };
}
export const handleAgentApi = createAgentApi();
