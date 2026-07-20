import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { hydrateBatches, listBatchHeaders, listBatchesPage } from "@/lib/db";
import SidebarLayout from "@/components/SidebarLayout";
import BatchSidebar from "@/components/BatchSidebar";
import BatchFeed from "@/components/BatchFeed";

export const dynamic = "force-dynamic";

const LIMIT = 3;

export default async function HomePage() {
  const [allBatches, page] = await Promise.all([
    listBatchHeaders(),
    listBatchesPage(LIMIT),
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

  const initialBatches = await hydrateBatches(page.records);
  return (
    <SidebarLayout sidebar={<BatchSidebar batches={allBatches} currentId={-1} />}>
      <BatchFeed initialBatches={initialBatches} initialHasMore={page.hasMore} />
    </SidebarLayout>
  );
}
