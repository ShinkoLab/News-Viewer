"use client";

import { useRef } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Link from "@mui/material/Link";
import ShareMenuButton from "./ShareMenuButton";

type Props = {
  summaryTitle: string;
  summaryText: string;
  keywords: string[];
  originalUrl: string | null;
  originalTitle: string;
};

export default function ArticleCard({
  summaryTitle,
  summaryText,
  keywords,
  originalUrl,
  originalTitle,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <Card
      ref={cardRef}
      sx={{ borderRadius: "2px", display: "flex", flexDirection: "column" }}
      elevation={1}
    >
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <CardContent
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            height: "100%",
            width: "100%",
            minWidth: 0,
            // MUI が最後の子要素に 24px を適用するのを正規化
            pb: "16px !important",
          }}
        >
          {/* タイトル行 */}
          <Typography variant="subtitle2" sx={{ color: "text.primary", wordBreak: "break-word" }}>
            {summaryTitle}
          </Typography>

          {/* 要約テキスト */}
          <Typography variant="body2" sx={{ color: "text.primary", flex: 1, wordBreak: "break-word" }}>
            {summaryText}
          </Typography>

          {/* キーワードChip — 最大5件表示して情報過多を防ぐ */}
          {keywords.length > 0 && (
            // role="group" + aria-label でスクリーンリーダーにコンテキストを提供
            <Box
              role="group"
              aria-label="キーワード"
              sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: "auto", pt: 0.5 }}
            >
              {keywords.slice(0, 5).map((kw) => (
                <Chip
                  key={kw}
                  label={kw}
                  size="small"
                  variant="outlined"
                  sx={{
                    color: "primary.main",
                    borderColor: "primary.light",
                    bgcolor: "transparent",
                  }}
                />
              ))}
            </Box>
          )}

          {/* 元記事タイトル行 + 共有メニューボタン */}
          {originalTitle && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
              {originalUrl ? (
                <Link
                  href={originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  underline="hover"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    minWidth: 0,
                    flex: 1,
                    color: "text.disabled",
                    "&:hover": { color: "primary.main" },
                  }}
                  title={originalTitle}
                >
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      color: "inherit",
                    }}
                  >
                    {originalTitle}
                  </Typography>
                  <OpenInNewIcon
                    sx={{ fontSize: "0.75rem", flexShrink: 0, color: "inherit" }}
                    aria-hidden="true"
                  />
                </Link>
              ) : (
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.disabled",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                  title={originalTitle}
                >
                  {originalTitle}
                </Typography>
              )}

              <Box component="span" data-share-controls="true" sx={{ flexShrink: 0, lineHeight: 0 }}>
                <ShareMenuButton
                  summaryTitle={summaryTitle}
                  summaryText={summaryText}
                  keywords={keywords}
                  originalUrl={originalUrl}
                  originalTitle={originalTitle}
                  cardRef={cardRef}
                />
              </Box>
            </Box>
          )}
        </CardContent>
      </Box>
    </Card>
  );
}
