"use client";

import { useRef, useState } from "react";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CameraAltIcon from "@mui/icons-material/CameraAlt";

type Props = {
  summaryTitle: string;
  summaryText: string;
  keywords: string[];
  originalUrl: string | null;
  originalTitle: string;
  cardRef: React.RefObject<HTMLDivElement | null>;
};

export default function ShareMenuButton({
  summaryTitle,
  summaryText,
  keywords,
  originalUrl,
  originalTitle,
  cardRef,
}: Props) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const open = Boolean(anchorEl);

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => setAnchorEl(null);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2000);
  };

  const handleCopyMarkdown = async () => {
    handleClose();
    const lines: string[] = [];
    lines.push(`## ${summaryTitle}`);
    lines.push("");
    lines.push(summaryText);
    if (keywords.length > 0) {
      lines.push("");
      lines.push(`**キーワード**: ${keywords.join(", ")}`);
    }
    if (originalTitle) {
      lines.push("");
      const linkPart = originalUrl
        ? `[${originalTitle}](${originalUrl})`
        : originalTitle;
      lines.push(`**元記事**: ${linkPart}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showFeedback("コピーしました");
    } catch {
      showFeedback("コピーに失敗しました");
    }
  };

  const handleCopyImage = async () => {
    handleClose();
    if (!cardRef.current) return;

    // カードの実際の幅を取得し、パディング付きラッパーで包んでキャプチャすることで
    // シャドウがクリップされずカードらしい枠付き画像を生成する
    const PADDING = 8;
    const cardWidth = cardRef.current.offsetWidth;

    const wrapper = document.createElement("div");
    wrapper.style.cssText = [
      "position:fixed",
      "top:-9999px",
      "left:-9999px",
      `width:${cardWidth + PADDING * 2}px`,
      `padding:${PADDING}px`,
      "background:#F5F5F5",
      "box-sizing:border-box",
    ].join(";");

    const clone = cardRef.current.cloneNode(true) as HTMLElement;
    // シャドウがラッパー内で完全に見えるよう幅を固定
    clone.style.width = `${cardWidth}px`;
    // 共有ボタンはUIコントロールなのでキャプチャ対象から除去
    clone.querySelectorAll("[data-share-controls]").forEach((el) => el.remove());
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#F5F5F5",
      });
      canvas.toBlob(async (blob) => {
        if (!blob) {
          showFeedback("画像の生成に失敗しました");
          return;
        }
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          showFeedback("画像をコピーしました");
        } catch {
          showFeedback("画像のコピーに失敗しました");
        }
      }, "image/png");
    } catch {
      showFeedback("画像の生成に失敗しました");
    } finally {
      document.body.removeChild(wrapper);
    }
  };

  return (
    <>
      <Tooltip title={feedback ?? "共有"} placement="top">
        <IconButton
          size="small"
          onClick={handleOpen}
          aria-label="共有メニューを開く"
          sx={{
            p: 0,
            color: feedback ? "primary.main" : "text.disabled",
            flexShrink: 0,
            "&:hover": { color: "primary.main", bgcolor: "transparent" },
            transition: "color 0.15s",
          }}
        >
          <MoreVertIcon sx={{ fontSize: "0.9rem" }} />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            elevation: 8,
            sx: { borderRadius: "2px", minWidth: 200 },
          },
        }}
      >
        <MenuItem onClick={handleCopyMarkdown} dense>
          <ListItemIcon>
            <ContentCopyIcon sx={{ fontSize: "1rem" }} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { variant: "body2" } }}>
            Markdownとしてコピー
          </ListItemText>
        </MenuItem>
        <MenuItem onClick={handleCopyImage} dense>
          <ListItemIcon>
            <CameraAltIcon sx={{ fontSize: "1rem" }} />
          </ListItemIcon>
          <ListItemText slotProps={{ primary: { variant: "body2" } }}>
            画像としてコピー
          </ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
