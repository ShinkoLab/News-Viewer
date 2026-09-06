import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { listBatchHeaders, listCategoryOptions, listFilteredBatchesPage } from "@/lib/db";
import { getCategorySort } from "@/lib/categorySortServer";
import { parseArticleFilters, periodStart } from "@/lib/articleFilters";
import SidebarLayout from "@/components/SidebarLayout";
import BatchSidebar from "@/components/BatchSidebar";
import BatchFeed from "@/components/BatchFeed";
import CategorySortProvider from "@/components/CategorySortProvider";
import ArticleFilterMenu from "@/components/ArticleFilterMenu";

export const dynamic = "force-dynamic";

const LIMIT = 3;

type Props = {
  searchParams: Promise<{ category?: string | string[]; period?: string | string[] }>;
};

export default async function HomePage({ searchParams }: Props) {
  const filters = parseArticleFilters(await searchParams);
  const [allBatches, sort] = await Promise.all([
    listBatchHeaders(),
    getCategorySort(),
  ]);

  const [page, categoryOptions] = await Promise.all([
    listFilteredBatchesPage(LIMIT, sort, filters, undefined, periodStart(filters.period)),
    listCategoryOptions(sort),
  ]);
  const categories = Array.from(
    new Set([...(filters.category ? [filters.category] : []), ...categoryOptions])
  );

  if (allBatches.length === 0) {
    return (
      <SidebarLayout sidebar={<BatchSidebar batches={[]} currentId={-1} />}>
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">データがありません。</Typography>
        </Box>
      </SidebarLayout>
    );
  }

  return (
    <SidebarLayout
      sidebar={<BatchSidebar batches={allBatches} currentId={-1} />}
      appBarActions={<ArticleFilterMenu filters={filters} categories={categories} />}
    >
      <CategorySortProvider mode={sort.mode} order={sort.order}>
        <BatchFeed
          key={`${filters.category ?? "all"}:${filters.period}`}
          initialBatches={page.batches}
          initialHasMore={page.hasMore}
          initialNextBefore={page.nextBefore}
          filters={filters}
        />
      </CategorySortProvider>
    </SidebarLayout>
  );
}
