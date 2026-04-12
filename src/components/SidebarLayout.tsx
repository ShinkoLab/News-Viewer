"use client";

import { useState, useRef, useEffect } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import MenuIcon from "@mui/icons-material/Menu";
import HomeIcon from "@mui/icons-material/Home";
import Link from "next/link";

// Drawer width as a shared constant to avoid duplication
export const DRAWER_WIDTH = 240;

type Props = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  showHomeButton?: boolean;
};

export default function SidebarLayout({ sidebar, children, showHomeButton }: Props) {
  const [open, setOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // inert をモバイルでドロワー開放時にメインコンテンツへ適用
  // React 19 では inert は boolean 型になったが、DOM API は string を期待するため ref で設定
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    if (open) {
      el.setAttribute("inert", "");
    } else {
      el.removeAttribute("inert");
    }
  }, [open]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Android L スタイルのアプリバー — MD1 elevation 4 の shadow を直接指定 */}
      <Box
        component="header"
        sx={{
          bgcolor: "primary.main",
          height: 56,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          px: 1,
          // MuiPaper.elevation4 override と一致させる (Box は Paper ではないため直接指定)
          boxShadow:
            "0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23)",
          zIndex: "appBar",
        }}
      >
        <IconButton
          onClick={() => setOpen((v) => !v)}
          sx={{ color: "primary.contrastText", mr: 1 }}
          size="medium"
          aria-label={open ? "サイドバーを閉じる" : "サイドバーを開く"}
          aria-expanded={open}
          aria-controls="sidebar-nav"
        >
          <MenuIcon />
        </IconButton>
        {showHomeButton && (
          <IconButton
            component={Link}
            href="/"
            sx={{ color: "primary.contrastText", mr: 1 }}
            size="medium"
            aria-label="ホームへ戻る"
          >
            <HomeIcon />
          </IconButton>
        )}
      </Box>

      {/* ボディ */}
      <Box
        sx={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
          bgcolor: "background.default",
          position: "relative",
        }}
      >
        {/* モバイル用オーバーレイ背景 — 常時マウントして opacity でアニメーション */}
        <Box
          aria-hidden="true"
          onClick={() => setOpen(false)}
          sx={{
            display: { xs: "block", md: "none" },
            position: "absolute",
            inset: 0,
            bgcolor: "rgba(0,0,0,0.5)",
            zIndex: "drawer",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: "opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />

        {/* ナビゲーションドロワー */}
        <Box
          id="sidebar-nav"
          component="nav"
          aria-label="バッチ履歴ナビゲーション"
          aria-hidden={!open}
          sx={{
            // md以上: インラインでコンテンツを押し出す
            // xs/sm: オーバーレイとして表示（position absolute）
            position: { xs: "absolute", md: "relative" },
            zIndex: { xs: "drawer", md: "auto" },
            top: { xs: 0, md: "auto" },
            left: { xs: 0, md: "auto" },
            height: "100%",
            width: open ? DRAWER_WIDTH : 0,
            flexShrink: 0,
            overflow: "hidden",
            transition: "width 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            borderRight: open ? "1px solid" : "none",
            borderColor: "divider",
            bgcolor: "background.paper",
            // 影: ドロワーが開いた状態でのみ表示 (elevation 4)
            boxShadow: open
              ? "0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23)"
              : "none",
          }}
        >
          {sidebar}
        </Box>

        {/* メインコンテンツ — モバイルでドロワー表示中はフォーカスを遮断 (ref で inert を管理) */}
        <Box
          ref={mainRef}
          component="main"
          sx={{ flex: 1, overflowY: "auto", p: { xs: 2, sm: 3 } }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
