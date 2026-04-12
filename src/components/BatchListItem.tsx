"use client";

import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "next/link";
import { formatJapaneseDateTime } from "@/lib/format";

type Props = {
  id: number;
  executedAt: Date;
  totalArticles: number;
  digestText: string | null;
};

export default function BatchListItem({
  id,
  executedAt,
  totalArticles,
  digestText,
}: Props) {
  const dateLabel = formatJapaneseDateTime(executedAt);

  const preview = digestText ? digestText.slice(0, 120) + (digestText.length > 120 ? "…" : "") : null;

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardActionArea component={Link} href={`/batches/${id}`}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
              {dateLabel}
            </Typography>
            <Chip label={`${totalArticles}件`} size="small" color="primary" variant="outlined" />
          </Box>
          {preview && (
            <Typography variant="body2" color="text.secondary">
              {preview}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
