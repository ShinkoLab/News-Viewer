import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { prisma } from "@/lib/db";
import SidebarLayout from "@/components/SidebarLayout";
import BatchSidebar from "@/components/BatchSidebar";
import BatchFeed from "@/components/BatchFeed";
import type { Article, BatchWithArticles } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIMIT = 3;

export default async function HomePage() {
  // 2本並列: サイドバー用全件 + フィード初期ページ
  const [allBatches, rawFirst] = await Promise.all([
    prisma.batches.findMany({
      orderBy: { executed_at: "desc" },
      select: { id: true, executed_at: true },
    }),
    prisma.batches.findMany({
      orderBy: { executed_at: "desc" },
      take: LIMIT + 1,
      select: {
        id: true,
        executed_at: true,
        total_articles: true,
        digest_text: true,
      },
    }),
  ]);

  if (rawFirst.length === 0) {
    return (
      <SidebarLayout sidebar={<BatchSidebar batches={[]} currentId={-1} />}>
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">データがありません。</Typography>
        </Box>
      </SidebarLayout>
    );
  }

  const hasMore = rawFirst.length > LIMIT;
  const batchSlice = rawFirst.slice(0, LIMIT);
  const batchIds = batchSlice.map((b) => b.id);

  // 依存クエリ: 初期3バッチの記事を一括取得
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

  const initialBatches: BatchWithArticles[] = batchSlice.map((b) => ({
    id: b.id,
    executedAt: b.executed_at.toISOString(),
    totalArticles: b.total_articles,
    digestText: b.digest_text,
    categories: Object.entries(byBatch.get(b.id) ?? {}).map(
      ([category, arts]) => ({ category, articles: arts })
    ),
  }));

  return (
    <SidebarLayout sidebar={<BatchSidebar batches={allBatches} currentId={-1} />}>
      <BatchFeed initialBatches={initialBatches} initialHasMore={hasMore} />
    </SidebarLayout>
  );
}
