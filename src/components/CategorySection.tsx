"use client";

import { useState, useEffect } from "react";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import Collapse from "@mui/material/Collapse";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ArticleCard from "./ArticleCard";

type Article = {
  id: number;
  summaryTitle: string;
  summaryText: string;
  keywords: string[];
  originalUrl: string | null;
  originalTitle: string;
  groupTopic: string | null;
};

type OverrideSignal = { open: boolean; version: number };

type Props = {
  category: string;
  articles: Article[];
  openOverride?: OverrideSignal;
  /**
   * 見出しレベルをコンテキストに応じて指定。
   * BatchExpansionPanel 内（h2 の下）では "h3"、
   * ページ直下では "h2"。デフォルト: "h3"
   */
  headingLevel?: "h2" | "h3" | "h4";
};

export default function CategorySection({
  category,
  articles,
  openOverride,
  headingLevel = "h3",
}: Props) {
  const [open, setOpen] = useState(true);
  const contentId = `category-content-${category.replace(/\s+/g, "-")}`;

  // グローバルな展開/折りたたみシグナルに同期
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (openOverride !== undefined) setOpen(openOverride.open);
  }, [openOverride?.version]);

  return (
    <Box component="section" aria-label={`カテゴリ: ${category}`} sx={{ mb: 4 }}>
      {/* Android L スタイルのセクションヘッダー — ButtonBase で完全なキーボード操作と ripple を実現 */}
      <ButtonBase
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={contentId}
        focusRipple
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          mb: open ? 2 : 0,
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          borderRadius: "2px",
          py: 0.5,
          // Mui-focusVisible は MuiButtonBase テーマ override で処理
        }}
      >
        {/* 左端のカラーアクセントバー */}
        <Box
          aria-hidden="true"
          sx={{
            width: 4,
            height: 20,
            bgcolor: "primary.main",
            borderRadius: "1px",
            flexShrink: 0,
          }}
        />
        <Typography
          variant="subtitle1"
          component={headingLevel}
          sx={{ color: "primary.main", letterSpacing: "0.01em" }}
        >
          {category}
        </Typography>
        {/* 記事件数バッジ */}
        <Typography
          variant="caption"
          sx={{
            color: "text.disabled",
            bgcolor: "action.selected",
            px: 0.75,
            py: 0.25,
            borderRadius: "2px",
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          {articles.length}件
        </Typography>
        <Divider sx={{ flex: 1 }} />
        {/* アイコンは装飾 — ButtonBase 全体がインタラクティブ要素 */}
        <ExpandMoreIcon
          aria-hidden="true"
          sx={{
            fontSize: "1.25rem",
            color: "action.active",
            transition: "transform 0.2s",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            ml: 0.5,
          }}
        />
      </ButtonBase>

      <Collapse in={open} timeout={200}>
        <Box
          id={contentId}
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "1fr 1fr",
              lg: "1fr 1fr 1fr",
            },
            gap: 2,
            alignItems: "stretch",
          }}
        >
          {articles.map((article) => (
            <ArticleCard
              key={article.id}
              summaryTitle={article.summaryTitle}
              summaryText={article.summaryText}
              keywords={article.keywords}
              originalUrl={article.originalUrl}
              originalTitle={article.originalTitle}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
