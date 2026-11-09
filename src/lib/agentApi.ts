import { createHash, timingSafeEqual } from "node:crypto";
import * as db from "@/lib/db";
import { searchArticles } from "@/lib/search";
import { ARTICLE_PERIODS, parseArticleFilters, periodStart } from "@/lib/articleFilters";
import { parseBatchBoundary } from "@/lib/batchCursor";
import { parseCategoryOrder } from "@/lib/categorySort";
import type { Article, BatchWithArticles } from "@/lib/types";

/**
 * エージェント向け読み取り API の共通部分。REST（/api/v1）と MCP（/mcp）の両方がここを使う。
 *
 * - 認証: `X-News-Api-Key` または `Authorization: Bearer <key>`（Muse などの MCP クライアントは後者）
 * - レート制限: プロセス単位で 60 件/分・同時 4 件。キー付きの呼び出しは REST と MCP で **1 つの予算を共有** する。
 *   キーなしで届く MCP の要求（initialize / tools/list など）は別の予算で数える（匿名の大量送信で
 *   正規の呼び出しの枠を食い潰させないため）
 * - 操作: 文字列の入力を検証して、REST の応答本文と同じ形のオブジェクトを返す。失敗は ApiError
 */

type Dependencies = Pick<typeof db, "getBatch" | "hydrateBatches" | "listFilteredBatchesPage" | "listCategoryOptions"> & {
  searchArticles: typeof searchArticles;
};
type Env = Record<string, string | undefined>;
const dependencies: Dependencies = { ...db, searchArticles };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

/** 入力は文字列で受ける（REST はクエリ文字列、MCP は引数を文字列にしてから渡す）。 */
export type RawInput = Record<string, string | undefined>;

export const MAX_SEARCH_RESULTS = 50;
const RATE_LIMIT_PER_MINUTE = 60;
const MAX_CONCURRENT = 4;

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
function parseBatchId(raw: string | undefined) {
  if (raw === undefined || !/^[1-9]\d{0,15}$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new ApiError(400, "invalid_batch_id");
  }
  return Number(raw);
}
function parseArticleId(raw: string | undefined) {
  if (raw === undefined || !/^[A-Za-z0-9_-]{1,128}$/.test(raw)) throw new ApiError(400, "invalid_article_id");
  return raw;
}
function parseFilters(input: RawInput) {
  const { period, category } = input;
  if (period !== undefined && !(ARTICLE_PERIODS as readonly string[]).includes(period)) throw new ApiError(400, "invalid_period");
  if (category !== undefined && (!category.trim() || category.length > 100)) throw new ApiError(400, "invalid_category");
  return parseArticleFilters({ period, category });
}

/** 呼び出し側が許可した入力名以外を拒む（REST のクエリ・MCP の引数の両方）。 */
export function rejectUnknownInputs(input: RawInput, allowed: readonly string[]) {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new ApiError(400, "invalid_parameters");
  }
}

type Budget = { windowStart: number; requests: number; active: number };
export type Budgets = { authorized: Budget; anonymous: Budget };
export function newBudgets(): Budgets {
  return { authorized: { windowStart: 0, requests: 0, active: 0 }, anonymous: { windowStart: 0, requests: 0, active: 0 } };
}
/**
 * 既定の予算は globalThis に 1 組だけ置く。Next.js は Route Handler ごとに別バンドルを作ることが
 * あり（/api/v1 と /mcp）、モジュール変数だと予算が 2 つになって上限が倍になるため。
 */
const globalForBudget = globalThis as unknown as { __newsAgentBudgets?: Budgets };
function sharedBudgets(): Budgets {
  return (globalForBudget.__newsAgentBudgets ??= newBudgets());
}

/** 予算を 1 件使って fn を実行する。超過は fn を呼ばずに 429。 */
async function spend<T>(budget: Budget, time: number, fn: () => Promise<T>): Promise<T> {
  if (time - budget.windowStart >= 60000) { budget.windowStart = time; budget.requests = 0; }
  if (budget.requests >= RATE_LIMIT_PER_MINUTE || budget.active >= MAX_CONCURRENT) throw new ApiError(429, "rate_limited");
  budget.requests++; budget.active++;
  try { return await fn(); } finally { budget.active--; }
}

function suppliedKey(request: Request): string {
  const header = request.headers.get("x-news-api-key");
  if (header) return header;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  return match ? match[1] : "";
}

export function createAgentCore(
  deps: Dependencies = dependencies,
  env: Env = process.env,
  now = () => Date.now(),
  budgets: Budgets = sharedBudgets(),
) {
  function backend() {
    const value = env.DB_BACKEND ?? "firestore";
    if (!["sqlite", "firestore"].includes(value)) throw new ApiError(503, "invalid_backend");
    return value;
  }

  /**
   * キーとバックエンド設定の検証。キーが無効な設定なら 503、合わなければ 401、
   * DB_BACKEND が不正なら 503。DB には触れない。
   */
  function authorize(request: Request) {
    const key = env.NEWS_API_KEY;
    if (!key || key.length < 32 || key.length > 256) throw new ApiError(503, "api_disabled");
    const supplied = suppliedKey(request);
    if (supplied.length > 256 || !timingSafeEqual(
      createHash("sha256").update(key).digest(), createHash("sha256").update(supplied).digest()
    )) throw new ApiError(401, "unauthorized");
    backend();
  }

  /** キー付きの呼び出しの予算（REST と MCP の tools/call で共有）。 */
  function withBudget<T>(fn: () => Promise<T>): Promise<T> {
    return spend(budgets.authorized, now(), fn);
  }
  /** キーなしで届いた MCP の要求の予算。 */
  function withAnonymousBudget<T>(fn: () => Promise<T>): Promise<T> {
    return spend(budgets.anonymous, now(), fn);
  }

  function context() {
    const name = backend();
    return {
      sort: { mode: "definition" as const, order: parseCategoryOrder(env.CATEGORY_ORDER) },
      meta: {
        apiVersion: "v1", backend: name, periodBasis: "batchExecutedAt",
        // SQLite's legacy reader can turn unavailable/locked DB errors into empty results.
        availability: name === "sqlite" ? "not_verified" : "queried",
      },
    };
  }

  const ops = {
    async categories() {
      const { sort, meta } = context();
      return { categories: await deps.listCategoryOptions(sort), meta: {
        ...meta, categoryScope: sort.order.length ? "configured" : "latest_30_batches",
      } };
    },

    async search(input: RawInput) {
      const { meta } = context();
      const filters = parseFilters(input);
      const q = input.q?.trim() ?? "";
      if (!q || q.length > 500) throw new ApiError(400, "invalid_query");
      if (meta.backend === "firestore" && env.NEWS_API_ALLOW_FIRESTORE_SEARCH !== "true") {
        throw new ApiError(403, "firestore_search_not_enabled");
      }
      const found = await deps.searchArticles({ ...filters, q }, new Date(now()));
      const overflow = found.results.length > MAX_SEARCH_RESULTS;
      return {
        query: found.query,
        results: found.results.slice(0, MAX_SEARCH_RESULTS).map(r => ({
          article: articleDto(r.article, r.batchId, r.batchExecutedAt, r.category),
          score: r.score, matchedKeyword: r.matchedKeyword,
        })),
        degraded: found.degraded, truncated: found.truncated || overflow,
        meta: { ...meta, searchMode: meta.backend === "sqlite" || found.degraded ? "keyword" : "hybrid",
          completeness: found.truncated || overflow ? "possibly_incomplete" : "not_guaranteed" },
      };
    },

    async batches(input: RawInput) {
      const { sort, meta } = context();
      const filters = parseFilters(input);
      const rawLimit = input.limit ?? "3";
      if (!/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit) > 10) throw new ApiError(400, "invalid_limit");
      let before;
      try {
        before = input.before === undefined ? undefined : parseBatchBoundary(input.before);
      } catch { throw new ApiError(400, "invalid_cursor"); }
      const time = new Date(now());
      const page = await deps.listFilteredBatchesPage(Number(rawLimit), sort, filters, before, periodStart(filters.period, time));
      return { batches: page.batches.map(batchDto), hasMore: page.hasMore,
        nextBefore: page.hasMore ? page.nextBefore : null,
        meta: { ...meta, scanLimited: page.hasMore && page.batches.length < Number(rawLimit) } };
    },

    async batch(rawId: string | undefined) {
      const { sort, meta } = context();
      const id = parseBatchId(rawId);
      const batch = await loadBatch(id, sort);
      return { batch: batchDto(batch), meta };
    },

    async article(rawBatchId: string | undefined, rawArticleId: string | undefined) {
      const { sort, meta } = context();
      const id = parseBatchId(rawBatchId);
      const articleId = parseArticleId(rawArticleId);
      const batch = await loadBatch(id, sort);
      for (const c of batch.categories) {
        // Resolve any source ID to its current representative cluster summary.
        const article = c.articles.find(a => a.sources.some(s => s.id === articleId));
        if (article) return { requestedArticleId: articleId, article: articleDto(article, id, batch.executedAt, c.category), meta };
      }
      throw new ApiError(404, "article_not_found");
    },
  };

  async function loadBatch(id: number, sort: ReturnType<typeof context>["sort"]) {
    const record = await deps.getBatch(id);
    if (!record) throw new ApiError(404, "batch_not_found");
    const [batch] = await deps.hydrateBatches([record], sort);
    if (!batch) throw new ApiError(503, "batch_unavailable");
    return batch;
  }

  return { authorize, withBudget, withAnonymousBudget, ops };
}
export type AgentCore = ReturnType<typeof createAgentCore>;

export function jsonResponse(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, { status, headers: {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...(status === 429 ? { "Retry-After": "60" } : {}),
    ...extra,
  } });
}

/** URL のクエリを RawInput にする。同じ名前の重複は拒む。 */
function queryInput(url: URL, allowed: readonly string[]): RawInput {
  const input: RawInput = {};
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new ApiError(400, "invalid_parameters");
    input[key] = url.searchParams.get(key) ?? undefined;
  }
  return input;
}

/** REST（/api/v1）。応答の形は v1.7.0 から変えない。 */
export function createRestHandler(core: AgentCore) {
  return async function handle(request: Request, path: string[]): Promise<Response> {
    try {
      core.authorize(request);
      if (request.method !== "GET") throw new ApiError(405, "method_not_allowed");
      return await core.withBudget(async () => {
        const url = new URL(request.url);
        if (url.search.length > 4096) throw new ApiError(400, "parameters_too_long");
        if (path.length === 1 && path[0] === "categories") {
          queryInput(url, []);
          return jsonResponse(await core.ops.categories());
        }
        if (path.length === 1 && path[0] === "search") {
          return jsonResponse(await core.ops.search(queryInput(url, ["q", "category", "period"])));
        }
        if (path.length === 1 && path[0] === "batches") {
          return jsonResponse(await core.ops.batches(queryInput(url, ["category", "period", "before", "limit"])));
        }
        if (path[0] === "batches" && path.length === 2) {
          queryInput(url, []);
          return jsonResponse(await core.ops.batch(path[1]));
        }
        if (path[0] === "batches" && path.length === 4 && path[2] === "articles") {
          queryInput(url, []);
          return jsonResponse(await core.ops.article(path[1], path[3]));
        }
        throw new ApiError(404, "not_found");
      });
    } catch (error) {
      // Do not log tokens, queries, upstream URLs or database error messages.
      return error instanceof ApiError
        ? jsonResponse({ error: { code: error.code } }, error.status)
        : jsonResponse({ error: { code: "upstream_unavailable" } }, 503);
    }
  };
}

/** One budget per process, independent of spoofable client IP headers. */
export function createAgentApi(deps: Dependencies = dependencies, env: Env = process.env, now = () => Date.now()) {
  return createRestHandler(createAgentCore(deps, env, now, newBudgets()));
}

let defaultCore: AgentCore | undefined;
/** 本番で使う既定のコア（予算は globalThis で共有）。 */
export function agentCore(): AgentCore {
  return (defaultCore ??= createAgentCore());
}
let defaultRestHandler: ReturnType<typeof createRestHandler> | undefined;
export function handleAgentApi(request: Request, path: string[]) {
  return (defaultRestHandler ??= createRestHandler(agentCore()))(request, path);
}
