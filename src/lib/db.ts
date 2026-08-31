import * as firestoreDb from "@/lib/db.firestore";
import * as sqliteDb from "@/lib/db.sqlite";

export type { BatchRecord } from "@/lib/db.shared";

/**
 * データストアの選択。DB_BACKEND=sqlite で Docker Compose 自前ホスト構成の
 * SQLite（Prisma 経由）を使う。それ以外（未設定含む）は既定の Firestore（Cloud Run）。
 * News-Summarizer 側の `database.backend` 切り替え（outputs/database.py の
 * `create_database()`）と同じ発想。
 */
const impl = process.env.DB_BACKEND === "sqlite" ? sqliteDb : firestoreDb;

export const listBatchHeaders = impl.listBatchHeaders;
export const listBatchesPage = impl.listBatchesPage;
export const getBatch = impl.getBatch;
export const hydrateBatches = impl.hydrateBatches;
