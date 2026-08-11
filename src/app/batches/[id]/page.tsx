import { notFound } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { getBatch, hydrateBatches, listBatchHeaders } from "@/lib/db";
import { getCategorySort } from "@/lib/categorySortServer";
import DigestSection from "@/components/DigestSection";
import CategoryList from "@/components/CategoryList";
import CategorySortProvider from "@/components/CategorySortProvider";
import BatchSidebar from "@/components/BatchSidebar";
import SidebarLayout from "@/components/SidebarLayout";
import { formatJapaneseDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function BatchPage({ params }: Props) {
  const { id } = await params;
  const batchId = Number(id);
  if (!Number.isSafeInteger(batchId) || batchId < 1) notFound();

  const [batchRecord, allBatches, sort] = await Promise.all([
    getBatch(batchId),
    listBatchHeaders(),
    getCategorySort(),
  ]);
  if (!batchRecord) notFound();

  const [batch] = await hydrateBatches([batchRecord], sort);
  const executedAt = new Date(batch.executedAt);

  return (
    <SidebarLayout sidebar={<BatchSidebar batches={allBatches} currentId={batchId} />} showHomeButton>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" component="h1">
          {formatJapaneseDateTime(executedAt)}
        </Typography>
        <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
          <Chip
            label={`${batch.totalArticles}件の記事`}
            size="small"
            sx={{ borderRadius: "2px", bgcolor: "primary.main", color: "white", fontWeight: 600 }}
          />
          {batch.categories.length > 0 && (
            <Chip
              label={`${batch.categories.length}カテゴリ`}
              size="small"
              variant="outlined"
              sx={{ borderRadius: "2px", borderColor: "primary.light", color: "primary.main", fontWeight: 600 }}
            />
          )}
        </Box>
      </Box>

      {batch.digestText && <DigestSection digestText={batch.digestText} />}
      <CategorySortProvider mode={sort.mode} order={sort.order}>
        <CategoryList categories={batch.categories} headingLevel="h2" showSortControl />
      </CategorySortProvider>
    </SidebarLayout>
  );
}
