import { notFound } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { prisma } from "@/lib/db";
import DigestSection from "@/components/DigestSection";
import CategoryList from "@/components/CategoryList";
import BatchSidebar from "@/components/BatchSidebar";
import SidebarLayout from "@/components/SidebarLayout";
import { formatJapaneseDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function BatchPage({ params }: Props) {
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (isNaN(batchId)) notFound();

  const [batch, allBatches, articles] = await Promise.all([
    prisma.batches.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        executed_at: true,
        total_articles: true,
        digest_text: true,
      },
    }),
    prisma.batches.findMany({
      orderBy: { executed_at: "desc" },
      select: { id: true, executed_at: true },
    }),
    prisma.article_summaries.findMany({
      where: { batch_id: batchId },
      orderBy: [{ category: "asc" }, { group_id: "asc" }, { id: "asc" }],
      select: {
        id: true,
        category: true,
        group_topic: true,
        summary_title: true,
        summary_text: true,
        keywords: true,
        original_url: true,
        original_title: true,
      },
    }),
  ]);

  if (!batch) notFound();

  const byCategory = articles.reduce<
    Record<
      string,
      {
        id: number;
        summaryTitle: string;
        summaryText: string;
        keywords: string[];
        originalUrl: string | null;
        originalTitle: string;
        groupTopic: string | null;
      }[]
    >
  >((acc, a) => {
    if (!acc[a.category]) acc[a.category] = [];
    acc[a.category].push({
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
    return acc;
  }, {});

  const categoryCount = Object.keys(byCategory).length;

  return (
    <SidebarLayout sidebar={<BatchSidebar batches={allBatches} currentId={batchId} />} showHomeButton>
      {/* ページヘッダー */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" component="h1">
          {formatJapaneseDateTime(batch.executed_at)}
        </Typography>
        {/* バッチ統計 — 記事数とカテゴリ数を一目でわかるように */}
        <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
          <Chip
            label={`${batch.total_articles}件の記事`}
            size="small"
            sx={{ borderRadius: "2px", bgcolor: "primary.main", color: "white", fontWeight: 600 }}
          />
          {categoryCount > 0 && (
            <Chip
              label={`${categoryCount}カテゴリ`}
              size="small"
              variant="outlined"
              sx={{ borderRadius: "2px", borderColor: "primary.light", color: "primary.main", fontWeight: 600 }}
            />
          )}
        </Box>
      </Box>

      {batch.digest_text && <DigestSection digestText={batch.digest_text} />}

      {/* ページ直下の CategoryList — カテゴリ見出しは h2（h1 の直下） */}
      <CategoryList
        categories={Object.entries(byCategory).map(([category, articles]) => ({
          category,
          articles,
        }))}
        headingLevel="h2"
      />
    </SidebarLayout>
  );
}
