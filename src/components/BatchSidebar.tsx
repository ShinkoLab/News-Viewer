"use client";

import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import Link from "next/link";
import { formatJapaneseDateShort } from "@/lib/format";
import { DRAWER_WIDTH } from "./SidebarLayout";

type Batch = {
  id: number;
  executed_at: Date;
};

type Props = {
  batches: Batch[];
  currentId: number;
};

export default function BatchSidebar({ batches, currentId }: Props) {
  return (
    <Box
      sx={{
        width: DRAWER_WIDTH,
        overflowY: "auto",
        height: "100%",
        // 末尾フェードでスクロール可能であることを示唆
        maskImage:
          "linear-gradient(to bottom, black calc(100% - 24px), transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, black calc(100% - 24px), transparent 100%)",
      }}
    >
      {/* セクションラベル — caption + text.primary で WCAG AA を確保 */}
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography
          variant="caption"
          sx={{
            color: "text.primary",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            display: "block",
          }}
        >
          バッチ履歴
        </Typography>
      </Box>
      <Divider />
      <List disablePadding>
        {batches.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
            <Typography variant="caption" sx={{ color: "text.disabled" }}>
              バッチがありません
            </Typography>
          </Box>
        ) : (
          batches.map((batch) => {
            const selected = batch.id === currentId;
            return (
              <ListItemButton
                key={batch.id}
                component={Link}
                href={`/batches/${batch.id}`}
                selected={selected}
                aria-current={selected ? "page" : undefined}
                sx={{
                  py: 1.25,
                  px: 2,
                  // 選択スタイルは theme.ts の MuiListItemButton override で定義
                }}
              >
                <ListItemText
                  primary={formatJapaneseDateShort(batch.executed_at)}
                  slotProps={{
                    primary: {
                      sx: {
                        fontSize: "0.875rem",
                        fontWeight: selected ? 600 : 400,
                      },
                    },
                  }}
                />
              </ListItemButton>
            );
          })
        )}
      </List>
    </Box>
  );
}
