"use client";

import { useCallback, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import BatchExpansionPanel from "./BatchExpansionPanel";
import { CategorySortSelect } from "./CategorySortProvider";
import type { BatchWithArticles, BatchesApiResponse } from "@/lib/types";
import type { ArticleFilters } from "@/lib/articleFilters";

type Props = {
  initialBatches: BatchWithArticles[];
  initialHasMore: boolean;
  initialNextBefore: string | null;
  filters: ArticleFilters;
};

export default function BatchFeed({ initialBatches, initialHasMore, initialNextBefore, filters }: Props) {
  const [batches, setBatches] = useState<BatchWithArticles[]>(initialBatches);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState(initialNextBefore);
  const filtering = filters.category !== null || filters.period !== "all";

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextBefore) params.set("before", nextBefore);
      if (filters.category) params.set("category", filters.category);
      if (filters.period !== "all") params.set("period", filters.period);
      const res = await fetch(`/api/batches?${params}`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const data: BatchesApiResponse = await res.json();
      setBatches((prev) => [...prev, ...data.batches]);
      setHasMore(data.hasMore);
      setNextBefore(data.nextBefore);
    } catch (e) {
      console.error(e);
      setError("追加のバッチを読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, nextBefore, filters]);

  return (
    <Box>
      {/* 並び順は全バッチ共通なので、パネルごとではなくページ単位で1つ置く */}
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
        <CategorySortSelect />
      </Box>

      {batches.map((batch, index) => (
        <BatchExpansionPanel
          key={batch.id}
          batch={batch}
          defaultExpanded={filtering || index === 0}
        />
      ))}

      {batches.length === 0 && (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <Typography variant="h6" component="p" sx={{ mb: 0.5 }}>
            {hasMore ? "直近の範囲に一致する記事がありません" : "条件に一致する記事がありません"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {hasMore
              ? "さらに古い記事を検索するには「もっと読み込む」を押してください。"
              : "カテゴリまたは期間を変更してください。"}
          </Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 3, gap: 1 }}>
        {error && (
          <Typography variant="body2" sx={{ color: "error.main" }}>
            {error}
          </Typography>
        )}

        {hasMore && (
          <Button
            variant="outlined"
            onClick={loadMore}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ textTransform: "none", minWidth: 160 }}
          >
            {loading ? "読み込み中..." : error ? "再試行" : "もっと読み込む"}
          </Button>
        )}

        {!hasMore && batches.length > 0 && (
          <Typography variant="body2" sx={{ color: "text.disabled" }}>
            すべてのバッチを表示しました
          </Typography>
        )}
      </Box>
    </Box>
  );
}
