import type { NextRequest } from "next/server";
import { hydrateBatches, listBatchesPage } from "@/lib/db";
import type { BatchesApiResponse } from "@/lib/types";

const LIMIT = 3;

export async function GET(request: NextRequest) {
  const beforeParam = request.nextUrl.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    return Response.json({ error: "invalid before cursor" }, { status: 400 });
  }

  const page = await listBatchesPage(LIMIT, before);
  const batches = await hydrateBatches(page.records);
  return Response.json({ batches, hasMore: page.hasMore } satisfies BatchesApiResponse);
}
