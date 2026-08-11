"use client";

import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import CategorySection from "./CategorySection";
import { CategorySortSelect, useCategorySort } from "./CategorySortProvider";
import { sortCategories } from "@/lib/categorySort";
import type { CategoryEntry } from "@/lib/types";

type OverrideSignal = { open: boolean; version: number };

type Props = {
  categories: CategoryEntry[];
  /**
   * 見出しレベルを CategorySection へ委譲。
   * BatchExpansionPanel 内: "h3"、ページ直下: "h2"
   */
  headingLevel?: "h2" | "h3" | "h4";
  /**
   * 並び順の切り替えをこのツールバーに出すか。1ページに1つだけにするため、
   * CategoryList が1つしかないバッチ詳細ページでのみ true にする。
   * フィード画面は BatchFeed 側がページ単位で1つ持つ。
   */
  showSortControl?: boolean;
};

export default function CategoryList({ categories, headingLevel, showSortControl }: Props) {
  const [override, setOverride] = useState<OverrideSignal | undefined>(
    undefined
  );
  const sort = useCategorySort();

  // サーバ側と同じ比較関数なので初回描画では並びが変わらず、
  // ユーザーが切り替えたときだけサーバ往復なしに並び替わる。
  const sortedCategories = useMemo(
    () => sortCategories(categories, sort),
    [categories, sort]
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
          alignItems: "center",
          justifyContent: "flex-end",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        {showSortControl && (
          <Box sx={{ mr: "auto" }}>
            <CategorySortSelect />
          </Box>
        )}
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

      {sortedCategories.map(({ category, articles }) => (
        <CategorySection
          key={`${category}-${override?.version ?? 0}`}
          category={category}
          articles={articles}
          openOverride={override}
          headingLevel={headingLevel}
        />
      ))}
    </Box>
  );
}
