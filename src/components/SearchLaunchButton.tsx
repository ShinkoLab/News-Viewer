"use client";

import IconButton from "@mui/material/IconButton";
import SearchIcon from "@mui/icons-material/Search";
import NextLink from "next/link";

/**
 * アプリバーから検索ページへ移る導線。
 *
 * next/link は関数を props として MUI の Client Component へ渡すことになるため
 * "use client" が要る（SidebarLayout のホームボタンと同じ理由）。
 */
export default function SearchLaunchButton() {
  return (
    <IconButton
      component={NextLink}
      href="/search"
      aria-label="記事を検索する"
      sx={{ color: "primary.contrastText" }}
    >
      <SearchIcon />
    </IconButton>
  );
}
