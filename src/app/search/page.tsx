import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { listBatchHeaders, listCategoryOptions } from "@/lib/db";
import { getCategorySort } from "@/lib/categorySortServer";
import { parseSearchParams } from "@/lib/articleFilters";
import { searchArticles } from "@/lib/search";
import SidebarLayout from "@/components/SidebarLayout";
import BatchSidebar from "@/components/BatchSidebar";
import ArticleFilterMenu from "@/components/ArticleFilterMenu";
import SearchBar from "@/components/SearchBar";
import SearchResultGrid from "@/components/SearchResultGrid";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    q?: string | string[];
    category?: string | string[];
    period?: string | string[];
  }>;
};

export default async function SearchPage({ searchParams }: Props) {
  const filters = parseSearchParams(await searchParams);

  const [allBatches, sort] = await Promise.all([listBatchHeaders(), getCategorySort()]);

  // 検索語が空なら Firestore も embedding API も叩かない。
  const [data, categoryOptions] = await Promise.all([
    filters.q ? searchArticles(filters) : Promise.resolve(null),
    listCategoryOptions(sort),
  ]);

  const categories = Array.from(
    new Set([...(filters.category ? [filters.category] : []), ...categoryOptions])
  );

  return (
    <SidebarLayout
      sidebar={<BatchSidebar batches={allBatches} currentId={-1} />}
      showHomeButton
      appBarActions={
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {/* 検索語が変わったら入力欄を作り直す。/search 内の遷移（キーワードChip・戻る）では
              同じ位置の同じ型なので React はマウントし続け、useState の初期値が更新されない。 */}
          <SearchBar
            key={filters.q}
            defaultQuery={filters.q}
            category={filters.category}
            period={filters.period}
          />
          <ArticleFilterMenu filters={filters} categories={categories} query={filters.q} />
        </Box>
      }
    >
      {/* 結果は関連度順のフラットな並びなので CategorySortProvider は載せない。
          カテゴリ単位の並べ替えという概念がこのページには無い。 */}
      {data ? (
        <SearchResultGrid
          key={`${filters.q}:${filters.category ?? "all"}:${filters.period}`}
          query={data.query}
          results={data.results}
          degraded={data.degraded}
          truncated={data.truncated}
        />
      ) : (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <Typography variant="h6" component="h1" sx={{ mb: 0.5 }}>
            記事を検索
          </Typography>
          <Typography variant="body2" color="text.secondary">
            調べたいことばを入力してください。表記が違っても意味の近い記事を探します。
          </Typography>
        </Box>
      )}
    </SidebarLayout>
  );
}
