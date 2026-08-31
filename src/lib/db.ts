import type { CategorySort } from "@/lib/categorySort";
import type { BatchRecord } from "@/lib/db.shared";

export type { BatchRecord } from "@/lib/db.shared";

/**
 * データストアの選択。DB_BACKEND=sqlite で Docker Compose 自前ホスト構成の
 * SQLite（Prisma 経由）を使う。それ以外（未設定含む）は既定の Firestore（Cloud Run）。
 * News-Summarizer 側の `database.backend` 切り替え（outputs/database.py の
 * `create_database()`）と同じ発想。
 *
 * 両実装を静的 import すると、選ばれなかった側の重い依存（Firestore SDK /
 * better-sqlite3 のネイティブバイナリ）までモジュール読み込み時に評価されて
 * しまう（クライアント生成自体は遅延化していても、`@prisma/adapter-better-sqlite3`
 * のようにモジュール本体が import 時点で native addon を require するパッケージも
 * あるため）。動的 import で実際に選ばれた側だけを読み込む。
 */
type DbModule = typeof import("@/lib/db.firestore") | typeof import("@/lib/db.sqlite");

let modulePromise: Promise<DbModule> | undefined;

function loadImpl(): Promise<DbModule> {
  if (!modulePromise) {
    modulePromise = (
      process.env.DB_BACKEND === "sqlite" ? import("@/lib/db.sqlite") : import("@/lib/db.firestore")
    ).catch((error: unknown) => {
      // 失敗した Promise をキャッシュしたままにすると、起動直後の一過性の問題
      // （native addon の require 失敗など）が解消した後もずっと同じエラーで
      // 失敗し続けてしまう。次回呼び出しで読み込みをやり直せるようにする。
      modulePromise = undefined;
      throw error;
    });
  }
  return modulePromise;
}

export async function listBatchHeaders(limit?: number) {
  const impl = await loadImpl();
  return impl.listBatchHeaders(limit);
}

export async function listBatchesPage(limit: number, before?: Date) {
  const impl = await loadImpl();
  return impl.listBatchesPage(limit, before);
}

export async function getBatch(batchId: number) {
  const impl = await loadImpl();
  return impl.getBatch(batchId);
}

export async function hydrateBatches(records: BatchRecord[], sort?: CategorySort) {
  const impl = await loadImpl();
  return impl.hydrateBatches(records, sort);
}
