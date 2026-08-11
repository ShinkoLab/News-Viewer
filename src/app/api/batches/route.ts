import type { NextRequest } from "next/server";
import { hydrateBatches, listBatchesPage } from "@/lib/db";
import { getCategorySort } from "@/lib/categorySortServer";
import type { BatchesApiResponse } from "@/lib/types";

const LIMIT = 3;

export async function GET(request: NextRequest) {
  const beforeParam = request.nextUrl.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    return Response.json({ error: "invalid before cursor" }, { status: 400 });
  }

  // 同一オリジンの fetch なので Cookie は自動で送られてくる。
  // 追加読み込み分も初回描画と同じ並び順で返す。
  const sort = await getCategorySort();
  const page = await listBatchesPage(LIMIT, before);
  const batches = await hydrateBatches(page.records, sort);
  return Response.json({ batches, hasMore: page.hasMore } satisfies BatchesApiResponse);
}
