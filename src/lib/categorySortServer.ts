import { cookies } from "next/headers";
import {
  parseCategoryOrder,
  parseSortMode,
  SORT_COOKIE_NAME,
  type CategorySort,
} from "@/lib/categorySort";

/**
 * リクエストごとのカテゴリ並び順を解決する。
 *
 * - 定義順は News-Summarizer/categories.yaml が唯一の定義元で、
 *   infra/main.tf が Cloud Run の CATEGORY_ORDER 環境変数として注入する。
 *   未設定なら空配列（表示は名前順へ縮退する）。
 * - ユーザーの選択は Cookie から読む。サーバ側で並べ替えてから返すことで、
 *   初回描画のちらつき（localStorage では避けられない）が出ない。
 *
 * next/headers を import しているためサーバ専用。Client Component から
 * 参照するとビルドエラーになる。
 */
export async function getCategorySort(): Promise<CategorySort> {
  const cookieStore = await cookies();
  return {
    mode: parseSortMode(cookieStore.get(SORT_COOKIE_NAME)?.value),
    order: parseCategoryOrder(process.env.CATEGORY_ORDER),
  };
}
