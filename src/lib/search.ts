import type { DocumentData, Query } from "@google-cloud/firestore";
import {
  clusterKeyOf,
  collapseCluster,
  firestore,
  getBatchesByIds,
  listBatchesPage,
  mapArticle,
  type ArticleRecord,
  type BatchRecord,
} from "@/lib/db";
import { embedQuery, normalizeQuery } from "@/lib/embedding";
import { periodStart, type SearchFilters } from "@/lib/articleFilters";
import type { SearchApiResponse, SearchResult } from "@/lib/types";

/** findNearest の取得件数。1件が1536次元(約12KiB)を運ぶので、512Mi では200が実質の上限。 */
const BASE_K = 60;
const MAX_K = 200;

const KEYWORD_LEG_LIMIT = 40;

/**
 * コサイン距離の足切り。0.75 ≒ 類似度 0.25。
 *
 * サマライザのクラスタリング（grouper.py, similarity_threshold=0.7 → 距離0.3）より
 * 大幅に緩い。あちらは「記事 対 記事」だが、こちらは「数語の検索語 対 タイトル+本文」で
 * 非対称性がずっと大きく、同じ値を使うと何も返らない。
 * ここは明らかなゴミを落とすだけで、関連度は UI のスコア表示で伝える。
 */
const DISTANCE_THRESHOLD = 0.75;

/** エミュレータ専用のブルートフォース経路の走査上限。本番では使わない。 */
const BRUTE_FORCE_MAX_DOCS = 500;

/**
 * 期間指定時に「その期間を全走査する」方式へ切り替える上限（記事数）。
 *
 * findNearest は不等式の事前フィルタを受け付けないため、素直に書くと
 * 「全期間の上位K件を取ってから期間で捨てる」ことになり、古い記事が上位を
 * 占めると当日の記事が1件も残らない（＝ヒットがあるのに0件と表示される）。
 * 期間が狭いうちは対象記事を全部読んでメモリで順位付けするほうが正確で安い。
 * 件数は batches.total_articles の合計で事前に分かるので、追加の読み取りは要らない。
 *
 * 上限は findNearest の実質上限（MAX_K = 200）と同じ桁に置く。走査では1件ずつ
 * 1536次元のベクトルを復号するので、512Mi / 1cpu の Viewer では件数がそのまま
 * ピークメモリになる。超える期間は findNearest 経路へ回し、欠落の可能性を UI へ出す。
 */
const SCOPED_SCAN_MAX_ARTICLES = 300;

/** Firestore の `in` は1クエリ30値まで。 */
const IN_CHUNK = 30;

/** 期間内のバッチを数えるときの上限。これを超える期間は全走査に切り替えない。 */
const PERIOD_BATCH_LOOKUP_LIMIT = 120;

const EXACT_KEYWORD_BOOST = 0.35;
const TITLE_SUBSTRING_BOOST = 0.15;
const BODY_SUBSTRING_BOOST = 0.05;

const DISTANCE_FIELD = "vector_distance";

/** クラスタ補完で読むフィールド。embedding を外すのが主目的（1件の大半を占める）。 */
const CLUSTER_FIELDS = [
  "id",
  "batch_id",
  "category",
  "group_id",
  "group_topic",
  "summary_title",
  "summary_text",
  "keywords",
  "original_url",
  "original_title",
  "feed_title",
];

type Candidate = {
  record: ArticleRecord;
  /** コサイン距離。キーワード脚だけで拾ったものは null。 */
  distance: number | null;
};

type VectorLegResult = {
  hits: Candidate[];
  /** クエリ自体が失敗したか。インデックス作成中などに立つ。 */
  failed: boolean;
  /** 期間内を全走査したか。false なら期間内の記事が欠けうる。 */
  scoped: boolean;
  /** 件数上限に当たったか。当たっていれば一致する記事を取りこぼしている可能性がある。 */
  capped: boolean;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 保存されたベクトルを配列として取り出す。
 *
 * `instanceof VectorValue` は使わない。db.ts の `asDate()` と同じく、Route Handler と
 * Server Component で @google-cloud/firestore が別バンドルとしてロードされると
 * クラスの実体が変わるため（dual package hazard）。
 * バックフィル前の素の配列も受ける。
 */
function toVector(value: unknown): number[] | null {
  if (value && typeof (value as { toArray?: unknown }).toArray === "function") {
    return (value as { toArray: () => number[] }).toArray();
  }
  if (Array.isArray(value) && typeof value[0] === "number") return value as number[];
  return null;
}

function cosineDistance(a: number[], b: number[]): number | null {
  if (a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return null;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 片方の脚が落ちても検索全体は返す。失敗したかどうかは呼び出し側へ伝える。
 *
 * findNearest はベクトルインデックスの作成が終わるまで FAILED_PRECONDITION で失敗する。
 * 黙ってキーワード一致だけの結果を返すと「検索が効いていない」ことに誰も気づけないので、
 * 縮退したことを UI まで持ち上げる。
 */
async function leg<T>(label: string, run: () => Promise<T>, fallback: T): Promise<{ value: T; failed: boolean }> {
  try {
    return { value: await run(), failed: false };
  } catch (e) {
    console.error(`[search] ${label} に失敗しました（この脚を無視して続行します）:`, e);
    return { value: fallback, failed: true };
  }
}

function targetK(filters: SearchFilters): number {
  // 期間で後から捨てるぶん、候補を広く取る。
  return filters.period === "all" ? BASE_K : MAX_K;
}

function candidatesFromDocs(
  docs: { id: string; data: () => DocumentData }[],
  withDistance: boolean
): Candidate[] {
  return docs.map((doc) => {
    const data = doc.data();
    const distance = data[DISTANCE_FIELD];
    return {
      record: mapArticle(doc.id, data),
      distance: withDistance && typeof distance === "number" ? distance : null,
    };
  });
}

/**
 * 期間指定を「全走査」で処理できるか判定する。
 *
 * 対象バッチのIDと記事数は `batches` の1クエリで分かる。記事数は
 * `total_articles` をそのまま合計するだけで、articleSummaries は読まない。
 */
async function periodScope(
  since: Date
): Promise<{ batchIds: number[]; scannable: boolean }> {
  const { records, hasMore } = await listBatchesPage(PERIOD_BATCH_LOOKUP_LIMIT, undefined, since);
  const batchIds = records.map((record) => record.id);
  const totalArticles = records.reduce((total, record) => total + record.totalArticles, 0);
  // batchIds が空（期間内に実行が無い）ときも scannable。走るクエリが無いだけで
  // 「期間内を網羅した（＝0件）」は正しい。ここで false にすると全期間の
  // findNearest が走り、その結果を全部期間で捨てたうえに
  // 「上限に達したので欠けているかも」という誤った警告まで出る。
  return {
    batchIds,
    scannable: !hasMore && totalArticles <= SCOPED_SCAN_MAX_ARTICLES,
  };
}

/** 与えられたバッチの記事を全部読んで、メモリでコサイン距離を計算する。 */
async function scanBatches(
  queryVector: number[],
  batchIds: number[],
  filters: SearchFilters,
  label: string
): Promise<VectorLegResult> {
  const { value, failed } = await leg(
    label,
    async () => {
      const scored: Candidate[] = [];
      // チャンクは**逐次**処理する。並行にすると全チャンクのベクトルが同時に
      // メモリへ載る。Candidate は mapArticle の戻り値だけを持ち embedding を
      // 捨てるので、逐次ならピークは1チャンクぶんで済む。
      for (const ids of chunk(batchIds, IN_CHUNK)) {
        let query: Query = firestore
          .collection("articleSummaries")
          .where("batch_id", "in", ids);
        if (filters.category) query = query.where("category", "==", filters.category);

        const snapshot = await query.get();
        for (const doc of snapshot.docs) {
          const data = doc.data();
          const vector = toVector(data.embedding);
          if (!vector) continue;
          const distance = cosineDistance(queryVector, vector);
          if (distance === null || distance > DISTANCE_THRESHOLD) continue;
          scored.push({ record: mapArticle(doc.id, data), distance });
        }
      }
      scored.sort((a, b) => (a.distance ?? 1) - (b.distance ?? 1));
      // ここで MAX_K に切らない。切ると期間内を網羅したのに結果だけ欠け、
      // scoped:true のせいで警告も出ない状態になる。走査自体が
      // SCOPED_SCAN_MAX_ARTICLES 件に制限されており、Candidate は embedding を
      // 持たないので全部返しても軽い。
      return scored;
    },
    [] as Candidate[]
  );
  // 走査自体が落ちたなら「期間を網羅した」とは言えない。
  return { hits: value, failed, scoped: !failed, capped: false };
}

async function vectorLeg(
  queryVector: number[],
  filters: SearchFilters,
  scope: { batchIds: number[]; scannable: boolean } | null
): Promise<VectorLegResult> {
  // 期間が狭いなら、その期間だけを全走査するのが最も正確。
  // 普通の where クエリなので findNearest を持たないエミュレータでも同じ経路が通る。
  // findNearest は不等式の事前フィルタを受け付けず、「全期間の上位K件を取ってから
  // 期間で捨てる」形にしかできないため、古い記事が上位を占めると当日の記事が
  // 1件も残らない（ヒットがあるのに0件と表示される）。
  if (scope?.scannable) {
    return scanBatches(queryVector, scope.batchIds, filters, "期間内のベクトル走査");
  }

  // エミュレータは findNearest を実装していない。ローカル開発用の総当たり経路。
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const { value, failed } = await leg(
      "総当たりベクトル検索",
      async () => {
        let query: Query = firestore.collection("articleSummaries");
        if (filters.category) query = query.where("category", "==", filters.category);
        const snapshot = await query.orderBy("batch_id", "desc").limit(BRUTE_FORCE_MAX_DOCS).get();

        const scored: Candidate[] = [];
        for (const doc of snapshot.docs) {
          const data = doc.data();
          const vector = toVector(data.embedding);
          if (!vector) continue;
          const distance = cosineDistance(queryVector, vector);
          if (distance === null || distance > DISTANCE_THRESHOLD) continue;
          scored.push({ record: mapArticle(doc.id, data), distance });
        }
        scored.sort((a, b) => (a.distance ?? 1) - (b.distance ?? 1));
        return {
          hits: scored.slice(0, targetK(filters)),
          // 直近 BRUTE_FORCE_MAX_DOCS 件しか見ていないので、
          // ヒット数が K に届かなくても取りこぼしている可能性がある。
          capped: snapshot.docs.length >= BRUTE_FORCE_MAX_DOCS,
        };
      },
      { hits: [] as Candidate[], capped: false }
    );
    // 総当たりは直近 BRUTE_FORCE_MAX_DOCS 件しか見ないので「期間内を網羅した」とは言えない。
    return { hits: value.hits, failed, scoped: false, capped: value.capped };
  }

  const { value, failed } = await leg(
    "ベクトル検索",
    async () => {
      let base: Query = firestore.collection("articleSummaries");
      // カテゴリは等価なので事前フィルタにできる（複合ベクトルインデックスが必要）。
      // 期間は不等式なので findNearest の事前フィルタにできず、呼び出し側で事後処理する。
      if (filters.category) base = base.where("category", "==", filters.category);

      const snapshot = await base
        .findNearest({
          vectorField: "embedding",
          queryVector,
          limit: targetK(filters),
          distanceMeasure: "COSINE",
          distanceResultField: DISTANCE_FIELD,
          distanceThreshold: DISTANCE_THRESHOLD,
        })
        .get();

      return candidatesFromDocs(snapshot.docs, true);
    },
    [] as Candidate[]
  );
  return {
    hits: value,
    failed,
    scoped: false,
    // 上位K件を使い切っていれば、期間で捨てた先にまだ一致があったかもしれない。
    capped: value.length >= targetK(filters),
  };
}

type KeywordLegResult = {
  hits: Candidate[];
  /**
   * 取りこぼしうる状態か。
   *
   * - 複合インデックス未作成で並べ替えを諦めた場合、取れるのは一致する記事の
   *   **任意の** KEYWORD_LEG_LIMIT 件で、新しい順ですらない。期間で絞ると
   *   全部が期間外になり、確実に最近の一致があるタグでも0件に見えうる
   * - 上限ちょうどまで取れた場合も、その先に一致が残っている
   */
  capped: boolean;
};

async function keywordLeg(rawQuery: string): Promise<KeywordLegResult> {
  const base: Query = firestore
    .collection("articleSummaries")
    .where("keywords", "array-contains", rawQuery);

  // 新しい順で決定的に返したいので order_by を付けるが、これには複合インデックスが要る。
  // 未作成なら順序なしで取り直す（array-contains 単体は自動インデックスで引ける）。
  try {
    const snapshot = await base.orderBy("batch_id", "desc").limit(KEYWORD_LEG_LIMIT).get();
    return {
      hits: candidatesFromDocs(snapshot.docs, false),
      capped: snapshot.docs.length >= KEYWORD_LEG_LIMIT,
    };
  } catch (e) {
    console.error("[search] キーワード検索の並べ替えに失敗しました（順序なしで再試行します）:", e);
    const { value } = await leg(
      "キーワード検索",
      async () => candidatesFromDocs((await base.limit(KEYWORD_LEG_LIMIT).get()).docs, false),
      [] as Candidate[]
    );
    // 並べ替えられなかった時点で、返ってきた集合は「任意の40件」でしかない。
    return { hits: value, capped: true };
  }
}

type Scored = {
  record: ArticleRecord;
  score: number;
  matchedKeyword: boolean;
};

function scoreCandidate(candidate: Candidate, normalized: string): Scored {
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

/**
 * ヒットしたクラスタの**全メンバー**を読み直す。
 *
 * 検索でヒットするのはクラスタの一部だけのことがある。そのまま畳むと
 * 「2つのソース」と出ているのに実は5件だったり、代表（要約本文が最長のもの）が
 * フィード側と食い違って、カードをクリックした先で別の見出しが出たりする。
 *
 * embedding を落として取るので1件あたりの転送量は桁で小さい。ベクトルはもう要らない。
 */
async function completeClusters(
  scored: Scored[]
): Promise<Map<string, ArticleRecord[]>> {
  const complete = new Map<string, ArticleRecord[]>();

  // 単独クラスタ（group_id が null）は読み直す必要がない。
  // バッチ単位で group_id を集め、**ヒットしたクラスタだけ**を引く。
  // `where("batch_id","in",...)` だけで引くとバッチ丸ごと返ってきて、
  // 1検索あたりの読み取りが桁で増える（45バッチ × 40記事 ≒ 1800件）。
  //
  // 条件は等価だけなので複合インデックスは要らない（Firestore が自動の
  // 単一フィールド索引をマージして引く）。
  const groupsByBatch = new Map<number, Set<number>>();
  for (const entry of scored) {
    if (entry.record.groupId === null) continue;
    const groups = groupsByBatch.get(entry.record.batchId) ?? new Set<number>();
    groups.add(entry.record.groupId);
    groupsByBatch.set(entry.record.batchId, groups);
  }
  if (groupsByBatch.size === 0) return complete;

  const { value: snapshots } = await leg(
    "クラスタの補完",
    async () => {
      const queries = [];
      for (const [batchId, groups] of groupsByBatch) {
        for (const ids of chunk([...groups], IN_CHUNK)) {
          queries.push(
            firestore
              .collection("articleSummaries")
              .where("batch_id", "==", batchId)
              .where("group_id", "in", ids)
              .select(...CLUSTER_FIELDS)
              .get()
          );
        }
      }
      return Promise.all(queries);
    },
    []
  );

  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      const record = mapArticle(doc.id, doc.data());
      if (record.groupId === null) continue;
      const key = clusterKeyOf(record);
      const members = complete.get(key);
      if (members) members.push(record);
      else complete.set(key, [record]);
    }
  }
  return complete;
}

/**
 * 検索語に意味的・字面的に近い記事を返す。
 *
 * ベクトル検索とキーワード完全一致の2脚を合流させ、その候補集合に対してだけ
 * メモリ上で部分一致を評価する。Firestore は日本語の部分一致をサーバ側でできない
 * （前方一致の範囲クエリしかなく、語が文中に現れる日本語では役に立たない）ので、
 * **候補集合の外にある部分一致は拾えない**。そこはベクトル脚が埋める前提。
 * 将来の打ち手はサマライザ側に keywords の n-gram を持たせて array-contains-any で引くこと。
 */
export async function searchArticles(
  filters: SearchFilters,
  now = new Date()
): Promise<SearchApiResponse> {
  const rawQuery = filters.q.trim();
  const normalized = normalizeQuery(rawQuery);
  if (!normalized) {
    return { query: rawQuery, results: [], degraded: false, truncated: false };
  }

  const since = periodStart(filters.period, now);
  const [queryVector, scopeResult] = await Promise.all([
    embedQuery(rawQuery),
    // ここだけ leg を通さないと、batches の一時的なエラーで検索ページごと落ちる。
    // 他の経路はすべて縮退するので、ここも縮退（＝findNearest 経路）へ倒す。
    since
      ? leg("期間内バッチの確認", () => periodScope(since), null)
      : Promise.resolve({ value: null, failed: false }),
  ]);
  const scope = scopeResult.value;

  const [vector, keyword] = await Promise.all([
    queryVector
      ? vectorLeg(queryVector, filters, scope)
      : Promise.resolve<VectorLegResult>({ hits: [], failed: false, scoped: false, capped: false }),
    // array-contains はバイト単位の完全一致。キーワードChipのクリックは
    // 保存されている文字列そのものを渡してくるので、正規化前の生の語で引く。
    keywordLeg(rawQuery),
  ]);

  // 「意味検索が効いていない」状態は、キーが無いときだけでなく
  // インデックス作成中に findNearest が落ちたときにも起きる。両方を UI へ伝える。
  const degraded = queryVector === null || vector.failed;

  // 候補の取得段階で取りこぼしたか。バッチ情報の取得失敗は後で合流させる。
  //
  // - 期間指定があるのに期間内を網羅できず、上位K件を使い切った場合。
  //   findNearest は不等式の事前フィルタを受け付けないので「全期間の上位K件を
  //   取ってから期間で捨てる」しかなく、古い記事が上位を占めると期間内の
  //   ヒットが1件も残らないことがある。素の0件表示と区別がつかないので明示する
  // - キーワード脚が上限に当たった、または索引未作成で順序を諦めた場合
  const truncatedCandidates =
    (since !== undefined && !vector.scoped && vector.capped) || keyword.capped;

  // 全記事の embedding が Vector 型に変換されていないと、findNearest は成功したまま
  // それらを黙って除外する。0件とキーワードのみヒットが同時に起きたら疑う。
  // 期間指定があるとベクトル脚だけが期間で絞られ、キーワード脚は絞られないので、
  // 「ベクトル0件 + キーワードあり」が正常に起きる。誤検知を避けて全期間のときだけ見る。
  if (
    since === undefined &&
    queryVector !== null &&
    !vector.failed &&
    vector.hits.length === 0 &&
    keyword.hits.length > 0
  ) {
    console.warn(
      "[search] ベクトル検索が0件でキーワード一致だけがヒットしました。" +
        "articleSummaries.embedding が Vector 型へ変換済みか確認してください" +
        "（News-Summarizer/scripts/backfill_embedding_vectors.py）。"
    );
  }

  // 重複排除。ベクトル脚の距離を優先して残す。
  const byId = new Map<string, Candidate>();
  for (const candidate of [...vector.hits, ...keyword.hits]) {
    const existing = byId.get(candidate.record.id);
    if (!existing) {
      byId.set(candidate.record.id, candidate);
    } else if (existing.distance === null && candidate.distance !== null) {
      byId.set(candidate.record.id, candidate);
    }
  }

  const scored = [...byId.values()]
    .map((candidate) => scoreCandidate(candidate, normalized))
    // カテゴリ絞り込みはベクトル脚では事前フィルタ済みだが、キーワード脚は素通りなのでここで揃える。
    .filter((entry) => !filters.category || entry.record.category === filters.category);

  if (scored.length === 0) {
    return { query: rawQuery, results: [], degraded, truncated: truncatedCandidates };
  }

  // ヒットしたメンバーでクラスタを引き当て、表示は全メンバーで畳む。
  const matchedByKey = new Map<string, Scored[]>();
  for (const entry of scored) {
    const key = clusterKeyOf(entry.record);
    const members = matchedByKey.get(key);
    if (members) members.push(entry);
    else matchedByKey.set(key, [entry]);
  }

  const [completeByKey, batchLookup] = await Promise.all([
    completeClusters(scored),
    // ここも他の脚と同じく縮退させる。素通しにすると batches の一時的な失敗だけで
    // 検索ページ全体が error.tsx に落ちる（ベクトル脚もキーワード脚も成功していても）。
    leg(
      "バッチ情報の取得",
      () => getBatchesByIds(scored.map((entry) => entry.record.batchId)),
      new Map<number, BatchRecord>()
    ),
  ]);
  const batches = batchLookup.value;
  // バッチ情報が引けないと表示日時を出せず全件落とすことになるので、
  // 「結果が不完全かもしれない」側に倒して黙って0件にしない。
  const truncated = truncatedCandidates || batchLookup.failed;

  const results: SearchResult[] = [];
  for (const [key, matched] of matchedByKey) {
    const batch = batches.get(matched[0].record.batchId);
    // バッチのドキュメントが無い記事は Viewer から辿れない（save_batch が最後の1書き込みで
    // 失敗した場合に起きうる）。表示日時を出せないので落とす。
    if (!batch) continue;
    // scannable 経路なら期間はクエリ時点で確定しているが、findNearest 経路では
    // ここで初めて絞れる。二重に適用しても害はない。
    if (since && batch.executedAt < since) continue;

    const members = completeByKey.get(key) ?? matched.map((entry) => entry.record);
    results.push({
      article: collapseCluster(members),
      category: matched[0].record.category,
      batchId: batch.id,
      batchExecutedAt: batch.executedAt.toISOString(),
      score: Math.max(...matched.map((entry) => entry.score)),
      // スコアとバッジは**同じ集合**（実際にヒットしたメンバー）から導く。
      // 片方を代表から導くと、代表が検索語のタグを持たないクラスタで
      // 「+0.35 が乗った一致度なのにバッジが無い」という説明のつかない表示になる。
      //
      // 代表のChip列に検索語が出ないことはあるが、それは純粋な意味一致のカードでも
      // 同じで、バッジは「この話題のいずれかの出典がタグに一致した」という
      // 正しい主張のままになる（カードは何件のソースを束ねたかも表示している）。
      // 代表そのものをヒットしたメンバーへ寄せる案は、バッチ詳細ページと
      // 別の見出しが出る問題（クリック先で別のカードに見える）に戻るので採らない。
      matchedKeyword: matched.some((entry) => entry.matchedKeyword),
    });
  }

  // 実行ごとに並びがぶれないよう、スコアが同点でも決定的に並べる。
  results.sort(
    (a, b) =>
      b.score - a.score ||
      b.batchExecutedAt.localeCompare(a.batchExecutedAt) ||
      a.article.id.localeCompare(b.article.id)
  );

  return { query: rawQuery, results, degraded, truncated };
}
