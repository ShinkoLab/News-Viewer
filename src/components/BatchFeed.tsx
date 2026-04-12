"use client";

import { useCallback, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import BatchExpansionPanel from "./BatchExpansionPanel";
import type { BatchWithArticles, BatchesApiResponse } from "@/lib/types";

type Props = {
  initialBatches: BatchWithArticles[];
  initialHasMore: boolean;
};

export default function BatchFeed({ initialBatches, initialHasMore }: Props) {
  const [batches, setBatches] = useState<BatchWithArticles[]>(initialBatches);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/batches?skip=${batches.length}`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const data: BatchesApiResponse = await res.json();
      setBatches((prev) => [...prev, ...data.batches]);
      setHasMore(data.hasMore);
    } catch (e) {
      console.error(e);
      setError("追加のバッチを読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, batches.length]);

  return (
    <Box>
      {batches.map((batch, index) => (
        <BatchExpansionPanel
          key={batch.id}
          batch={batch}
          defaultExpanded={index === 0}
        />
      ))}

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
