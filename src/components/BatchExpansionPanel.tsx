"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import DigestSection from "./DigestSection";
import CategoryList from "./CategoryList";
import { formatJapaneseDateTime } from "@/lib/format";
import type { BatchWithArticles } from "@/lib/types";

type Props = {
  batch: BatchWithArticles;
  defaultExpanded: boolean;
};

export default function BatchExpansionPanel({ batch, defaultExpanded }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggle = () => setExpanded((prev) => !prev);
  const contentId = `batch-content-${batch.id}`;

  return (
    <Box
      component="section"
      aria-label={formatJapaneseDateTime(batch.executedAt)}
      sx={{
        mb: 3,
        bgcolor: "background.paper",
        borderRadius: "2px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)",
      }}
    >
      {/* 折りたたみヘッダー — ButtonBase で完全なキーボード操作と ripple を実現 */}
      <ButtonBase
        component="div"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={contentId}
        focusRipple
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.5,
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          borderBottom: expanded ? "1px solid" : "none",
          borderColor: "divider",
          "&:hover": { bgcolor: "action.hover" },
          // MuiButtonBase の Mui-focusVisible テーマ override でアウトラインを適用
        }}
      >
        <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
          {formatJapaneseDateTime(batch.executedAt)}
        </Typography>

        {/* color="primary" を使いテーマの contrastText を自動適用 */}
        <Chip
          label={`${batch.totalArticles}件の記事`}
          size="small"
          color="primary"
          sx={{ fontWeight: 600 }}
        />
        {batch.categories.length > 0 && (
          <Chip
            label={`${batch.categories.length}カテゴリ`}
            size="small"
            variant="outlined"
            sx={{
              borderColor: "primary.light",
              color: "primary.main",
              fontWeight: 600,
            }}
          />
        )}

        {/* アイコンは装飾 — ButtonBase 全体がインタラクティブ要素 */}
        <ExpandMoreIcon
          aria-hidden="true"
          sx={{
            fontSize: "1.25rem",
            color: "action.active",
            flexShrink: 0,
            transition: "transform 0.2s",
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        />
      </ButtonBase>

      <Collapse in={expanded} timeout={200}>
        <Box id={contentId} sx={{ p: { xs: 2, sm: 3 } }}>
          {batch.digestText && (
            // 白背景の Panel 上では elevation 2 で視覚的な奥行きを確保
            <DigestSection digestText={batch.digestText} elevation={2} />
          )}
          <CategoryList categories={batch.categories} headingLevel="h3" />
        </Box>
      </Collapse>
    </Box>
  );
}
