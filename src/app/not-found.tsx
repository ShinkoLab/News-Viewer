"use client";

import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Link from "next/link";

export default function NotFound() {
  return (
    <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
      <Box>
        <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
          ページが見つかりません
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          お探しのページは存在しないか、移動した可能性があります。
        </Typography>
        <Button component={Link} href="/" variant="outlined">
          トップに戻る
        </Button>
      </Box>
    </Container>
  );
}
