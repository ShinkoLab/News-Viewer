"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Autocomplete from "@mui/material/Autocomplete";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import FilterListIcon from "@mui/icons-material/FilterList";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import type { ArticleFilters, ArticlePeriod } from "@/lib/articleFilters";

const PERIOD_OPTIONS: { value: ArticlePeriod; label: string }[] = [
  { value: "all", label: "すべての期間" },
  { value: "1d", label: "過去24時間" },
  { value: "3d", label: "過去3日間" },
  { value: "7d", label: "過去7日間" },
  { value: "30d", label: "過去30日間" },
];

type Props = {
  filters: ArticleFilters;
  categories: string[];
};

export default function ArticleFilterBar({ filters, categories }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const update = (next: ArticleFilters) => {
    const params = new URLSearchParams();
    if (next.category) params.set("category", next.category);
    if (next.period !== "all") params.set("period", next.period);
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };

  const active = filters.category !== null || filters.period !== "all";

  return (
    <Paper
      component="section"
      aria-label="記事の絞り込み"
      elevation={1}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        mb: 2,
        px: { xs: 1.5, sm: 2 },
        py: 1.5,
        borderLeft: "4px solid",
        borderColor: active ? "secondary.main" : "primary.main",
        borderRadius: "2px",
        flexWrap: "wrap",
      }}
    >
      <FilterListIcon aria-hidden="true" sx={{ color: "primary.main", mr: 0.5 }} />
      <Autocomplete
        freeSolo
        options={categories}
        value={filters.category}
        disabled={pending}
        onChange={(_event, value) =>
          update({ ...filters, category: typeof value === "string" && value.trim() ? value.trim() : null })
        }
        renderInput={(params) => (
          <TextField {...params} label="カテゴリ（入力可）" size="small" />
        )}
        sx={{ minWidth: { xs: "calc(100% - 44px)", sm: 190 } }}
      />

      <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 160 } }}>
        <InputLabel id="period-filter-label">期間</InputLabel>
        <Select
          labelId="period-filter-label"
          value={filters.period}
          label="期間"
          disabled={pending}
          onChange={(event) => update({ ...filters, period: event.target.value as ArticlePeriod })}
        >
          {PERIOD_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {active && (
        <Button
          size="small"
          startIcon={<RestartAltIcon />}
          disabled={pending}
          onClick={() => update({ category: null, period: "all" })}
          sx={{ ml: { sm: "auto" }, textTransform: "none" }}
        >
          解除
        </Button>
      )}
      {pending && <CircularProgress size={20} aria-label="絞り込み中" sx={{ ml: active ? 0 : "auto" }} />}
    </Paper>
  );
}
