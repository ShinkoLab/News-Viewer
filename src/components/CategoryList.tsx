"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import CategorySection from "./CategorySection";

type Article = {
  id: number;
  summaryTitle: string;
  summaryText: string;
  keywords: string[];
  originalUrl: string | null;
  originalTitle: string;
  groupTopic: string | null;
};

type CategoryEntry = {
  category: string;
  articles: Article[];
};

type OverrideSignal = { open: boolean; version: number };

type Props = {
  categories: CategoryEntry[];
  /**
   * 見出しレベルを CategorySection へ委譲。
   * BatchExpansionPanel 内: "h3"、ページ直下: "h2"
   */
  headingLevel?: "h2" | "h3" | "h4";
};

export default function CategoryList({ categories, headingLevel }: Props) {
  const [override, setOverride] = useState<OverrideSignal | undefined>(
    undefined
  );

  const expandAll = () =>
    setOverride((prev) => ({ open: true, version: (prev?.version ?? 0) + 1 }));

  const collapseAll = () =>
    setOverride((prev) => ({
      open: false,
      version: (prev?.version ?? 0) + 1,
    }));

  return (
    <Box>
      {/* 一括操作ツールバー — text variant で低ノイズ、divider で区切り */}
      <Box
        sx={{
          display: "flex",
          gap: 1,
          mb: 2,
          pb: 1.5,
          justifyContent: "flex-end",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Button
          size="small"
          variant="text"
          startIcon={<UnfoldMoreIcon fontSize="small" />}
          onClick={expandAll}
          sx={{
            borderRadius: "2px",
            textTransform: "none",
            fontSize: "0.75rem",
            color: "text.secondary",
            "&:hover": { color: "primary.main", bgcolor: "action.hover" },
          }}
        >
          全て展開
        </Button>
        <Button
          size="small"
          variant="text"
          startIcon={<UnfoldLessIcon fontSize="small" />}
          onClick={collapseAll}
          sx={{
            borderRadius: "2px",
            textTransform: "none",
            fontSize: "0.75rem",
            color: "text.secondary",
            "&:hover": { color: "primary.main", bgcolor: "action.hover" },
          }}
        >
          全て折りたたむ
        </Button>
      </Box>

      {categories.map(({ category, articles }) => (
        <CategorySection
          key={category}
          category={category}
          articles={articles}
          openOverride={override}
          headingLevel={headingLevel}
        />
      ))}
    </Box>
  );
}
