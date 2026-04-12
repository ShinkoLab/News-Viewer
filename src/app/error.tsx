"use client";

import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";

// Next.js App Router の error.tsx は (error, reset) の2プロパティを受け取る
type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ reset }: Props) {
  return (
    <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
      <Box>
        <Typography variant="h5" component="h1" gutterBottom>
          エラーが発生しました
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          ページの読み込み中に問題が発生しました。
        </Typography>
        <Button variant="outlined" onClick={reset}>
          再試行
        </Button>
      </Box>
    </Container>
  );
}
