"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ArticleCard from "./ArticleCard";
import type { SearchResult } from "@/lib/types";

/**
 * 一度に見せる件数。
 *
 * 検索結果はサーバ側で全件そろっているので、ここは表示の出し惜しみだけ。
 * findNearest はカーソルを持たず、続きを取るには再検索（＝再embedding + 再ANN走査）に
 * なるため、フィードのような追加読み込みはしない。
 */
const PAGE_SIZE = 24;

type Props = {
  query: string;
  results: SearchResult[];
  degraded: boolean;
  truncated: boolean;
};

export default function SearchResultGrid({ query, results, degraded, truncated }: Props) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const shown = results.slice(0, visible);
  const hasMore = visible < results.length;
  // カードは類似記事を束ねているので、枚数と記事数は一致しない（CategorySection と同じ数え方）。
  const articleCount = results.reduce((total, result) => total + result.article.sources.length, 0);

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" component="h1" sx={{ wordBreak: "break-word" }}>
          「{query}」の検索結果
        </Typography>
        {results.length > 0 && (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {results.length}件のトピック
            {articleCount > results.length && `（${articleCount}件の記事を統合）`}
          </Typography>
        )}
      </Box>

      {degraded && (
        <Alert severity="info" sx={{ mb: 2, borderRadius: "2px" }}>
          意味検索が利用できないため、キーワード一致のみで検索しています。
        </Alert>
      )}

      {truncated && (
        <Alert severity="warning" sx={{ mb: 2, borderRadius: "2px" }}>
          一致する記事の一部を取得できなかったため、結果が不完全な可能性があります。
          キーワードを具体的にするか、カテゴリや期間を指定すると精度が上がります。
        </Alert>
      )}

      {results.length === 0 ? (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <Typography variant="h6" component="p" sx={{ mb: 0.5 }}>
            条件に一致する記事がありません
          </Typography>
          <Typography variant="body2" color="text.secondary">
            別の言い回しを試すか、カテゴリまたは期間の条件を外してください。
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" },
            gap: 2,
            alignItems: "stretch",
          }}
        >
          {shown.map((result) => (
            <ArticleCard
              key={`${result.batchId}-${result.article.id}`}
              summaryTitle={result.article.summaryTitle}
              summaryText={result.article.summaryText}
              keywords={result.article.keywords}
              originalUrl={result.article.originalUrl}
              originalTitle={result.article.originalTitle}
              groupTopic={result.article.groupTopic}
              sources={result.article.sources}
              score={result.score}
              batchId={result.batchId}
              batchExecutedAt={result.batchExecutedAt}
              matchedKeyword={result.matchedKeyword}
            />
          ))}
        </Box>
      )}

      {results.length > 0 && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          {hasMore ? (
            <Button
              variant="outlined"
              onClick={() => setVisible((prev) => prev + PAGE_SIZE)}
              sx={{ textTransform: "none", minWidth: 160 }}
            >
              もっと見る
            </Button>
          ) : (
            <Typography variant="body2" sx={{ color: "text.disabled" }}>
              すべての結果を表示しました
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
