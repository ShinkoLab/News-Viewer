"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import SearchIcon from "@mui/icons-material/Search";
import type { ArticlePeriod } from "@/lib/articleFilters";

type Props = {
  defaultQuery: string;
  /** 絞り込みを保ったまま語だけ変えられるように、現在の条件を引き継ぐ。 */
  category: string | null;
  period: ArticlePeriod;
};

/**
 * 検索語の入力欄。
 *
 * ArticleFilterMenu とは別コンポーネントにしている。あちらは「このページを絞り込む」
 * ための Popover + ドラフト + router.replace で、検索語は「ページの主題」を決めて
 * /search へ router.push するもの。操作モデルも履歴の扱いも違う。
 */
export default function SearchBar({ defaultQuery, category, period }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(defaultQuery);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = value.trim();
    if (!q) return;

    const params = new URLSearchParams();
    params.set("q", q);
    if (category) params.set("category", category);
    if (period !== "all") params.set("period", period);
    startTransition(() => router.push(`/search?${params}`));
  };

  return (
    <Box
      component="form"
      role="search"
      onSubmit={submit}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 1,
        borderRadius: "2px",
        bgcolor: "rgba(255,255,255,0.15)",
        "&:focus-within": { bgcolor: "rgba(255,255,255,0.25)" },
        transition: "background-color 0.2s",
      }}
    >
      <InputBase
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="記事を検索"
        inputProps={{ "aria-label": "記事を検索" }}
        disabled={pending}
        sx={{
          color: "primary.contrastText",
          width: { xs: 140, sm: 220 },
          "& input::placeholder": { color: "primary.contrastText", opacity: 0.7 },
        }}
      />
      {pending ? (
        <CircularProgress size={20} aria-label="検索中" sx={{ color: "primary.contrastText", mx: 0.5 }} />
      ) : (
        <IconButton type="submit" aria-label="検索を実行" size="small" sx={{ color: "primary.contrastText" }}>
          <SearchIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
}
