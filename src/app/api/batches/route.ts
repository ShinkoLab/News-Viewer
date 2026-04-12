import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import type { Article, BatchWithArticles, BatchesApiResponse } from "@/lib/types";

const LIMIT = 3;

export async function GET(request: NextRequest) {
  const skipParam = request.nextUrl.searchParams.get("skip");
  const skip = Math.max(0, parseInt(skipParam ?? "0", 10) || 0);

  // Query 1: LIMIT+1 件取得して hasMore を判定
  const rawBatches = await prisma.batches.findMany({
    orderBy: { executed_at: "desc" },
    skip,
    take: LIMIT + 1,
    select: {
      id: true,
      executed_at: true,
      total_articles: true,
      digest_text: true,
    },
  });

  const hasMore = rawBatches.length > LIMIT;
  const batchSlice = rawBatches.slice(0, LIMIT);

  if (batchSlice.length === 0) {
    return Response.json({ batches: [], hasMore: false } satisfies BatchesApiResponse);
  }

  const batchIds = batchSlice.map((b) => b.id);

  // Query 2: 該当バッチの記事を一括取得（N+1なし）
  const articles = await prisma.article_summaries.findMany({
    where: { batch_id: { in: batchIds } },
    orderBy: [{ category: "asc" }, { group_id: "asc" }, { id: "asc" }],
    select: {
      id: true,
      batch_id: true,
      category: true,
      group_topic: true,
      summary_title: true,
      summary_text: true,
      keywords: true,
      original_url: true,
      original_title: true,
    },
  });

  // バッチID → カテゴリ → 記事 の Map に集計
  const byBatch = new Map<number, Record<string, Article[]>>();
  for (const id of batchIds) byBatch.set(id, {});

  for (const a of articles) {
    const categoryMap = byBatch.get(a.batch_id)!;
    if (!categoryMap[a.category]) categoryMap[a.category] = [];
    categoryMap[a.category].push({
      id: a.id,
      summaryTitle: a.summary_title,
      summaryText: a.summary_text,
      keywords: (() => {
        try {
          return JSON.parse(a.keywords) as string[];
        } catch {
          return [];
        }
      })(),
      originalUrl: a.original_url,
      originalTitle: a.original_title,
      groupTopic: a.group_topic,
    });
  }

  const batches: BatchWithArticles[] = batchSlice.map((b) => {
    const categoryMap = byBatch.get(b.id) ?? {};
    return {
      id: b.id,
      executedAt: b.executed_at.toISOString(),
      totalArticles: b.total_articles,
      digestText: b.digest_text,
      categories: Object.entries(categoryMap).map(([category, arts]) => ({
        category,
        articles: arts,
      })),
    };
  });

  return Response.json({ batches, hasMore } satisfies BatchesApiResponse);
}
