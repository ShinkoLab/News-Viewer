"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import SortIcon from "@mui/icons-material/Sort";
import {
  CATEGORY_SORT_MODES,
  DEFAULT_SORT_MODE,
  SORT_COOKIE_NAME,
  type CategorySort,
  type CategorySortMode,
} from "@/lib/categorySort";

const SORT_MODE_LABELS: Record<CategorySortMode, string> = {
  definition: "定義順",
  count: "記事数の多い順",
  name: "名前順",
};

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

type CategorySortContextValue = CategorySort & {
  setMode: (mode: CategorySortMode) => void;
};

const CategorySortContext = createContext<CategorySortContextValue>({
  mode: DEFAULT_SORT_MODE,
  order: [],
  setMode: () => {},
});

export function useCategorySort() {
  return useContext(CategorySortContext);
}

type Props = CategorySort & {
  children: React.ReactNode;
};

/**
 * カテゴリの並び順をページ単位で共有する。
 *
 * フィード画面には CategoryList がバッチの数だけ並ぶため、各リストに useState を
 * 持たせると相互にずれる。1ページ1つの状態にまとめるために Context を使う。
 *
 * initialMode はサーバが Cookie から読んだ値で、サーバ側の並べ替えと同じ値から
 * 始まるため初回描画はハイドレーション不整合を起こさない。
 */
export default function CategorySortProvider({ mode: initialMode, order, children }: Props) {
  const [mode, setModeState] = useState<CategorySortMode>(initialMode);

  const setMode = useCallback((next: CategorySortMode) => {
    setModeState(next);
    // Cookie に書くのはサーバが次回の初回描画から正しい順序で返せるようにするため。
    // 表示自体はクライアント側で即座に並び替わるので、サーバ往復は不要。
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${SORT_COOKIE_NAME}=${encodeURIComponent(next)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax${secure}`;
  }, []);

  const value = useMemo(() => ({ mode, order, setMode }), [mode, order, setMode]);

  return <CategorySortContext value={value}>{children}</CategorySortContext>;
}

/** 並び順の切り替え。1ページに1つだけ置く。 */
export function CategorySortSelect() {
  const { mode, setMode } = useCategorySort();

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <SortIcon aria-hidden="true" sx={{ fontSize: "1rem", color: "text.secondary" }} />
      <Typography
        component="label"
        htmlFor="category-sort-select"
        variant="caption"
        sx={{ color: "text.secondary" }}
      >
        並び順
      </Typography>
      <Select
        id="category-sort-select"
        value={mode}
        onChange={(event) => setMode(event.target.value as CategorySortMode)}
        variant="standard"
        disableUnderline
        sx={{
          fontSize: "0.75rem",
          color: "text.secondary",
          "& .MuiSelect-select": { py: 0.25, pl: 0.5 },
          "&:hover": { color: "primary.main" },
        }}
      >
        {CATEGORY_SORT_MODES.map((value) => (
          <MenuItem key={value} value={value} sx={{ fontSize: "0.8125rem" }}>
            {SORT_MODE_LABELS[value]}
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}
