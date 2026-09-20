/**
 * 検索語のベクトル化。
 *
 * サマライザが `articleSummaries.embedding` に保存したベクトルと**同じ空間**で
 * 比較する必要があるため、モデルとエンドポイントは
 * News-Summarizer/infra/variables.tf の `embedding_model` / `embedding_base_url` と
 * 一致していなければならない。違っていても API は成功し findNearest も結果を返すが、
 * 中身は無関係な記事になる（例外もログも出ない）。定義元は Terraform 側ひとつで、
 * Job と Viewer の両方へ同じ変数から注入される。
 */

const EMBED_TIMEOUT_MS = 5000;

// 200件 × 1536次元 × 8バイト ≒ 2.5MiB。Cloud Run は 512Mi なので余裕がある。
const MAX_CACHE_ENTRIES = 200;

type EmbeddingCache = Map<string, Promise<number[]>>;

const globalForEmbedding = globalThis as unknown as {
  embeddingCache: EmbeddingCache | undefined;
  embeddingConfigWarned: boolean | undefined;
};

// db.ts の Firestore シングルトンと同じ理由で globalThis に載せる（HMR で作り直さない）。
const cache: EmbeddingCache = globalForEmbedding.embeddingCache ?? new Map();
if (process.env.NODE_ENV !== "production") {
  globalForEmbedding.embeddingCache = cache;
}

type EmbeddingConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  dimension: number | null;
};

function readConfig(): EmbeddingConfig | null {
  const baseUrl = process.env.EMBEDDING_BASE_URL;
  const model = process.env.LLM_EMBEDDING_MODEL;
  const apiKey = process.env.EMBEDDING_API_KEY;

  if (!baseUrl || !model || !apiKey) {
    // 検索のたびに出すと Cloud Logging が埋まるので一度だけ。
    if (!globalForEmbedding.embeddingConfigWarned) {
      globalForEmbedding.embeddingConfigWarned = true;
      console.warn(
        "[embedding] EMBEDDING_BASE_URL / LLM_EMBEDDING_MODEL / EMBEDDING_API_KEY が未設定のため、" +
          "意味検索を無効化してキーワード一致のみで検索します。"
      );
    }
    return null;
  }

  const rawDimension = Number(process.env.EMBEDDING_DIMENSION);
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    apiKey,
    dimension: Number.isFinite(rawDimension) && rawDimension > 0 ? rawDimension : null,
  };
}

/**
 * 表記ゆれを吸収した**比較用**の正規形。全角英数や大文字小文字の差を潰す。
 *
 * メモリ上の部分一致・完全一致の判定だけに使う。embedding には渡さないこと
 * （下の canonicalQuery を使う）。
 */
export function normalizeQuery(text: string): string {
  return text.trim().normalize("NFKC").toLowerCase();
}

/**
 * embedding API へ送る形。全角英数だけ畳み、**大文字小文字は保つ**。
 *
 * 小文字化すると意味ベクトルが実測で壊れる。本番データ8451件に対して
 * "AI" は距離0.564で200件ヒットするのに、"ai" は0.700で18件まで落ちる。
 * "OpenAI" → "openai" では上位が OpenAI の記事から NVIDIA の記事に変わる。
 * 頭字語は大文字小文字がそのまま語の同一性を担っているため。
 */
export function canonicalQuery(text: string): string {
  return text.trim().normalize("NFKC");
}

async function requestEmbedding(query: string, config: EmbeddingConfig): Promise<number[]> {
  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: query,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`embedding API ${response.status}: ${await response.text().catch(() => "")}`);
  }

  const json = await response.json();
  const vector = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0 || typeof vector[0] !== "number") {
    throw new Error("embedding API の応答にベクトルが含まれていません。");
  }

  if (config.dimension !== null && vector.length !== config.dimension) {
    // 次元が違うと findNearest はインデックスと噛み合わず、結果が0件になるか失敗する。
    // 黙って進むと「検索が壊れている」ようにしか見えないので、ここで気づけるようにする。
    throw new Error(
      `embedding の次元が想定と違います（期待 ${config.dimension} / 実際 ${vector.length}）。` +
        `LLM_EMBEDDING_MODEL がサマライザ側と一致しているか確認してください。`
    );
  }

  return vector as number[];
}

/**
 * 検索語をベクトルへ変換する。
 *
 * 設定が無い・API が落ちている・タイムアウトした場合は **例外を投げずに null** を返す。
 * 呼び出し側はキーワード一致だけの検索へ縮退する。検索ページが落ちてはいけない。
 */
export async function embedQuery(query: string): Promise<number[] | null> {
  // キャッシュキーは実際に API へ送る文字列と一致させる。比較用の正規形を
  // キーにすると "AI" と "ai" が同じベクトルを共有してしまう。
  const canonical = canonicalQuery(query);
  if (!canonical) return null;

  const config = readConfig();
  if (!config) return null;

  const cached = cache.get(canonical);
  if (cached) {
    // LRU: 参照されたものを末尾へ移す。
    cache.delete(canonical);
    cache.set(canonical, cached);
    try {
      return await cached;
    } catch {
      return null;
    }
  }

  // 配列ではなく Promise を入れる。同じ語の同時リクエスト（キーワードChip連打）も
  // 1回の API 呼び出しにまとまる。
  const pending = requestEmbedding(canonical, config);
  cache.set(canonical, pending);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }

  try {
    return await pending;
  } catch (e) {
    // 一時的な障害をキャッシュし続けない。
    if (cache.get(canonical) === pending) cache.delete(canonical);
    console.error("[embedding] 検索語のベクトル化に失敗しました:", e);
    return null;
  }
}
