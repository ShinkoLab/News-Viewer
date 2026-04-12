"use client";

import Button from "@mui/material/Button";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Link from "next/link";

export default function BackButton({ href, label }: { href: string; label: string }) {
  return (
    <Button component={Link} href={href} startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
      {label}
    </Button>
  );
}
