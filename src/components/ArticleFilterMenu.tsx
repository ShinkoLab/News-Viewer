"use client";

import { useState, useTransition, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import Autocomplete from "@mui/material/Autocomplete";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
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

export default function ArticleFilterMenu({ filters, categories }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(filters);

  const update = (next: ArticleFilters) => {
    const params = new URLSearchParams();
    if (next.category) params.set("category", next.category);
    if (next.period !== "all") params.set("period", next.period);
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };

  const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
    setDraft(filters);
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => setAnchorEl(null);
  const handleApply = () => {
    update({
      category: draft.category?.trim() || null,
      period: draft.period,
    });
    handleClose();
  };
  const handleReset = () => {
    const reset: ArticleFilters = { category: null, period: "all" };
    setDraft(reset);
    update(reset);
  };
  const activeCount = Number(filters.category !== null) + Number(filters.period !== "all");
  const changed = draft.category !== filters.category || draft.period !== filters.period;
  const open = anchorEl !== null;

  return (
    <>
      <IconButton
        onClick={handleOpen}
        aria-label={activeCount > 0 ? `記事を絞り込む（${activeCount}件の条件を適用中）` : "記事を絞り込む"}
        aria-expanded={open}
        aria-controls={open ? "article-filter-menu" : undefined}
        sx={{ color: "primary.contrastText" }}
      >
        <Badge badgeContent={activeCount} color="secondary" invisible={activeCount === 0}>
          <FilterListIcon />
        </Badge>
      </IconButton>

      <Popover
        id="article-filter-menu"
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              width: { xs: "calc(100vw - 32px)", sm: 340 },
              maxWidth: 340,
              mt: 1,
              borderRadius: "2px",
            },
          },
        }}
      >
        <Box
          component="section"
          aria-label="記事の絞り込み条件"
          sx={{ display: "flex", flexDirection: "column", gap: 2, p: 2 }}
        >
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
            記事を絞り込む
          </Typography>

          <Autocomplete
            freeSolo
            options={categories}
            value={draft.category}
            inputValue={draft.category ?? ""}
            disabled={pending}
            onInputChange={(_event, value) =>
              setDraft((current) => ({ ...current, category: value || null }))
            }
            onChange={(_event, value) =>
              setDraft((current) => ({
                ...current,
                category: typeof value === "string" && value.trim() ? value.trim() : null,
              }))
            }
            renderInput={(params) => (
              <TextField {...params} label="カテゴリ（入力可）" size="small" />
            )}
          />

          <FormControl size="small">
            <InputLabel id="period-filter-label">期間</InputLabel>
            <Select
              labelId="period-filter-label"
              value={draft.period}
              label="期間"
              disabled={pending}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  period: event.target.value as ArticlePeriod,
                }))
              }
            >
              {PERIOD_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ display: "flex", minHeight: 32, alignItems: "center", gap: 1 }}>
            {activeCount > 0 && (
              <Button
                size="small"
                startIcon={<RestartAltIcon />}
                disabled={pending}
                onClick={handleReset}
                sx={{ textTransform: "none" }}
              >
                条件を解除
              </Button>
            )}
            <Button
              variant="contained"
              size="small"
              disabled={pending || !changed}
              onClick={handleApply}
              sx={{ ml: "auto", textTransform: "none" }}
            >
              適用
            </Button>
            {pending && <CircularProgress size={20} aria-label="絞り込み中" sx={{ ml: "auto" }} />}
          </Box>
        </Box>
      </Popover>
    </>
  );
}
