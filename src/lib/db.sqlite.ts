import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type { BatchWithArticles } from "@/lib/types";
import { DEFAULT_SORT_MODE, type CategorySort } from "@/lib/categorySort";
import {
  buildBatchesWithArticles,
  compareArticleRecords,
  parseKeywords,
  FALLBACK_CATEGORY,
  type ArticleRecord,
  type BatchRecord,
} from "@/lib/db.shared";

function createPrismaClient() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");
  // Strip the "file:" prefix for the adapter
  const url = dbUrl.replace(/^file:/, "") as ":memory:" | (string & object);
  const adapter = new PrismaBetterSqlite3({
    url,
    // Firestore 版と同じく「書き込みはサマライザ側だけ、Viewer は読み取り専用」という
    // 前提を、Firestore の IAM 相当の技術的な強制として持たせる（SQLITE_READONLY で拒否）。
    readonly: true,
    // News-Summarizer 側は WAL / busy_timeout の設定をしていない（AGENTS.md 参照）ため、
    // save_batch() の書き込み中に読みに行くと既定の 5000ms よりロック待ちが伸びうる。
    // 少し余裕を持たせて "database is locked" を減らす（根絶はできない）。
    timeout: 10000,
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// モジュール読み込み時に即座に Prisma クライアントを作らず、実際に呼ばれるまで
// 生成を遅らせる。db.ts は DB_BACKEND に応じてこのモジュールを動的 import する
// だけなので普段は問題にならないが、DATABASE_URL 未設定のまま何らかの経路で
// このモジュールが読み込まれても、実際にクエリを呼ぶまでは例外にならないように
// しておく（db.firestore.ts の getFirestore() と同じ方針）。
function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

// readonly: true で開くと SQLITE_OPEN_CREATE が付かないため、News-Summarizer が
// まだ一度もパイプラインを実行しておらず DB ファイル自体が存在しない状態（例えば
// Docker Compose を初回起動した直後）だと SQLITE_CANTOPEN で例外になる。また
// News-Summarizer 側は WAL/busy_timeout を設定していないため、書き込み中に
// 読みに行くと（アダプタの timeout 経過後）SQLITE_BUSY になることもある。
// どちらも Firestore 版が「バッチ0件」を普通に返せるのと同じ状態に見えるはずの
// 一時的な状況なので、空データとして扱う（それ以外の DB エラーはそのまま投げる）。
//
// PrismaClientKnownRequestError は SQLite のエラーコードを .code に持つ
// （実機で確認済み: 例外の .code === "SQLITE_CANTOPEN"）ため、それを優先して見る。
// .code が無いケース（マウント先ディレクトリごと存在しない場合に better-sqlite3
// が投げる TypeError は .code を持たない）のためだけに、メッセージ文言も保険として
// チェックする。SQLITE_CANTOPEN/SQLITE_BUSY 自体は .code 側で判定できるので
// ここには含めない（二重チェックを避ける）。
const RECOVERABLE_SQLITE_CODES = new Set(["SQLITE_CANTOPEN", "SQLITE_BUSY"]);
const RECOVERABLE_MESSAGE_SUBSTRINGS = [
  "unable to open database file",
  "database is locked",
  // マウント先ディレクトリごと存在しない場合（named volume 未マウント等）は
  // better-sqlite3 が別の文言の TypeError を投げる（.code を持たない）。
  "Cannot open database because the directory does not exist",
];

function isRecoverableSqliteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && RECOVERABLE_SQLITE_CODES.has(code)) return true;
  return RECOVERABLE_MESSAGE_SUBSTRINGS.some((substring) => error.message.includes(substring));
}

async function withMissingDbFallback<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isRecoverableSqliteError(error)) return fallback;
    throw error;
  }
}

type BatchRow = {
  id: number;
  executed_at: Date;
  total_articles: number;
  digest_text: string | null;
};

function toBatchRecord(row: BatchRow): BatchRecord {
  return {
    id: row.id,
    executedAt: row.executed_at,
    totalArticles: row.total_articles,
    digestText: row.digest_text,
  };
}

type ArticleRow = {
  id: number;
  batch_id: number;
  category: string;
  group_id: number | null;
  group_topic: string | null;
  summary_title: string;
  summary_text: string;
  keywords: string;
  original_url: string | null;
  original_title: string;
  feed_title: string | null;
};

function toArticleRecord(row: ArticleRow): ArticleRecord {
  return {
    id: String(row.id),
    batchId: row.batch_id,
    category: row.category ?? FALLBACK_CATEGORY,
    groupId: row.group_id,
    groupTopic: row.group_topic,
    summaryTitle: row.summary_title,
    summaryText: row.summary_text,
    keywords: parseKeywords(row.keywords),
    originalUrl: row.original_url,
    originalTitle: row.original_title,
    // feed_title は後から追加した列。それ以前の記事には値が無い
    // （表示側で URL のホスト名にフォールバックする）。
    feedTitle: row.feed_title,
  };
}

export async function listBatchHeaders(limit = 30) {
  return withMissingDbFallback(async () => {
    const rows = await getPrisma().batches.findMany({
      orderBy: { executed_at: "desc" },
      take: limit,
      select: { id: true, executed_at: true },
    });
    return rows.map((row) => ({ id: row.id, executed_at: row.executed_at }));
  }, []);
}

export async function listBatchesPage(limit: number, before?: Date) {
  return withMissingDbFallback(() => listBatchesPageInternal(limit, before), {
    records: [],
    hasMore: false,
  });
}

async function listBatchesPageInternal(limit: number, before?: Date) {
  let rows: BatchRow[];
  if (before) {
    // SQLite の executed_at は News-Summarizer が CURRENT_TIMESTAMP で書き込む
    // "YYYY-MM-DD HH:MM:SS"（スペース区切り）形式の TEXT だが、Prisma の
    // typed API（下の findMany）に渡す JS Date は "...T...Z" 形式に直列化されて
    // バインドされるため、素の `{ executed_at: { lt: before } }` はテキストの
    // 辞書式比較が壊れて同日内の並びが誤る（'T'(0x54) は ' '(0x20) より常に
    // 大きいので、同じ日なら常に "before" 側が辞書順で小さくなってしまう）。
    // datetime() で両辺を正規化した生 SQL で対象 id だけを先に絞り込む。
    //
    // 注意: $queryRaw が返す行の executed_at 列はローカルタイムゾーンとして
    // 誤って解釈される（typed API は正しく UTC 扱いする）ため、ここでは id の
    // 抽出だけに使い、実データは必ず typed API で取り直す。
    const idRows = await getPrisma().$queryRaw<{ id: number }[]>`
      SELECT id FROM batches
      WHERE datetime(executed_at) < datetime(${before.toISOString()})
      ORDER BY executed_at DESC, id DESC
      LIMIT ${limit + 1}
    `;
    rows = await getPrisma().batches.findMany({
      where: { id: { in: idRows.map((row) => row.id) } },
      // News-Summarizer の CURRENT_TIMESTAMP は秒精度なので、短時間に複数バッチが
      // 生成されると executed_at が完全に一致しうる。id を副次キーにして、
      // ページをまたいでも順序が安定するようにする。
      orderBy: [{ executed_at: "desc" }, { id: "desc" }],
    });
  } else {
    rows = await getPrisma().batches.findMany({
      orderBy: [{ executed_at: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
  }
  const records = rows.map(toBatchRecord);
  return { records: records.slice(0, limit), hasMore: records.length > limit };
}

export async function getBatch(batchId: number): Promise<BatchRecord | null> {
  return withMissingDbFallback(async () => {
    const row = await getPrisma().batches.findUnique({ where: { id: batchId } });
    return row ? toBatchRecord(row) : null;
  }, null);
}

async function listArticles(batchIds: number[]): Promise<ArticleRecord[]> {
  if (batchIds.length === 0) return [];
  return withMissingDbFallback(() => listArticlesInternal(batchIds), []);
}

async function listArticlesInternal(batchIds: number[]): Promise<ArticleRecord[]> {
  const rows = await getPrisma().article_summaries.findMany({
    where: { batch_id: { in: batchIds } },
    // embedding は表示に使わず、記事数によってはサイズが大きいので読まない。
    select: {
      id: true,
      batch_id: true,
      category: true,
      group_id: true,
      group_topic: true,
      summary_title: true,
      summary_text: true,
      keywords: true,
      original_url: true,
      original_title: true,
      feed_title: true,
    },
  });
  // カテゴリの表示順はここでは決めない（hydrateBatches が sortCategories で確定する）。
  // カテゴリのグルーピング自体は Map のキーが担うので、ここで必要なのは
  // カテゴリ内のクラスタ順を実行ごとにぶれさせないことだけ（Firestore版と同じ方針）。
  return rows.map(toArticleRecord).sort(compareArticleRecords);
}

export async function hydrateBatches(
  records: BatchRecord[],
  sort: CategorySort = { mode: DEFAULT_SORT_MODE, order: [] }
): Promise<BatchWithArticles[]> {
  const articles = await listArticles(records.map((record) => record.id));
  return buildBatchesWithArticles(records, articles, sort);
}
