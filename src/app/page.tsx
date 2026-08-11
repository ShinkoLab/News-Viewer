import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { hydrateBatches, listBatchHeaders, listBatchesPage } from "@/lib/db";
import { getCategorySort } from "@/lib/categorySortServer";
import SidebarLayout from "@/components/SidebarLayout";
import BatchSidebar from "@/components/BatchSidebar";
import BatchFeed from "@/components/BatchFeed";
import CategorySortProvider from "@/components/CategorySortProvider";

export const dynamic = "force-dynamic";

const LIMIT = 3;

export default async function HomePage() {
  const [allBatches, page, sort] = await Promise.all([
    listBatchHeaders(),
    listBatchesPage(LIMIT),
    getCategorySort(),
  ]);

  if (page.records.length === 0) {
    return (
      <SidebarLayout sidebar={<BatchSidebar batches={[]} currentId={-1} />}>
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">データがありません。</Typography>
        </Box>
      </SidebarLayout>
    );
  }

  const initialBatches = await hydrateBatches(page.records, sort);
  return (
    <SidebarLayout sidebar={<BatchSidebar batches={allBatches} currentId={-1} />}>
      <CategorySortProvider mode={sort.mode} order={sort.order}>
        <BatchFeed initialBatches={initialBatches} initialHasMore={page.hasMore} />
      </CategorySortProvider>
    </SidebarLayout>
  );
}
