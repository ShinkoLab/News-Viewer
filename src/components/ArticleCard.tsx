"use client";

import { useRef, useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LayersIcon from "@mui/icons-material/Layers";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Link from "@mui/material/Link";
import ShareMenuButton from "./ShareMenuButton";
import type { ArticleSource } from "@/lib/types";

type Props = {
  summaryTitle: string;
  summaryText: string;
  keywords: string[];
  originalUrl: string | null;
  originalTitle: string;
  groupTopic: string | null;
  /** 同じニュースを報じた記事の出典。代表が先頭。単独記事なら要素1。 */
  sources: ArticleSource[];
};

/** ソース一覧の表示名。feed_title を持たない移行前の記事は URL のホスト名で代用する。 */
function sourceLabel(source: ArticleSource): string {
  if (source.feedTitle) return source.feedTitle;
  if (source.originalUrl) {
    try {
      return new URL(source.originalUrl).hostname.replace(/^www\./, "");
    } catch {
      // URL として解釈できないものは元記事タイトルに落とす
    }
  }
  return source.originalTitle || "出典不明";
}

export default function ArticleCard({
  summaryTitle,
  summaryText,
  keywords,
  originalUrl,
  originalTitle,
  groupTopic,
  sources,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const merged = sources.length > 1;
  const sourcesId = `article-sources-${sources[0]?.id ?? summaryTitle}`;

  return (
    <Card
      ref={cardRef}
      sx={{ borderRadius: "2px", display: "flex", flexDirection: "column" }}
      elevation={1}
    >
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <CardContent
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            height: "100%",
            width: "100%",
            minWidth: 0,
            // MUI が最後の子要素に 24px を適用するのを正規化
            pb: "16px !important",
          }}
        >
          {/* 複数記事を束ねたカードであることを最初に示す */}
          {merged && groupTopic && (
            <Typography
              variant="caption"
              sx={{ color: "primary.main", fontWeight: 600, letterSpacing: "0.02em" }}
            >
              {groupTopic}
            </Typography>
          )}

          {/* タイトル行 */}
          <Typography variant="subtitle2" sx={{ color: "text.primary", wordBreak: "break-word" }}>
            {summaryTitle}
          </Typography>

          {/* 要約テキスト */}
          <Typography variant="body2" sx={{ color: "text.primary", flex: 1, wordBreak: "break-word" }}>
            {summaryText}
          </Typography>

          {/* キーワードChip — 最大5件表示して情報過多を防ぐ */}
          {keywords.length > 0 && (
            // role="group" + aria-label でスクリーンリーダーにコンテキストを提供
            <Box
              role="group"
              aria-label="キーワード"
              sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: "auto", pt: 0.5 }}
            >
              {keywords.slice(0, 5).map((kw) => (
                <Chip
                  key={kw}
                  label={kw}
                  size="small"
                  variant="outlined"
                  sx={{
                    color: "primary.main",
                    borderColor: "primary.light",
                    bgcolor: "transparent",
                  }}
                />
              ))}
            </Box>
          )}

          {/* 統合カード: 折りたたみのソース一覧。共有画像には含めない（UIコントロールのため） */}
          {merged ? (
            <Box data-share-controls="true" sx={{ mt: 1 }}>
              <Divider sx={{ mb: 0.5 }} />
              {/* ButtonBase の中にボタンは置けないので、共有ボタンは兄弟にする */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                <ButtonBase
                  onClick={() => setSourcesOpen((prev) => !prev)}
                  aria-expanded={sourcesOpen}
                  aria-controls={sourcesId}
                  focusRipple
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    py: 0.5,
                    borderRadius: "2px",
                    color: "text.secondary",
                    "&:hover": { color: "primary.main" },
                  }}
                >
                  <LayersIcon aria-hidden="true" sx={{ fontSize: "0.9rem", color: "inherit" }} />
                  <Typography variant="caption" sx={{ flex: 1, color: "inherit", fontWeight: 600 }}>
                    {sources.length}つのソース
                  </Typography>
                  <ExpandMoreIcon
                    aria-hidden="true"
                    sx={{
                      fontSize: "1rem",
                      color: "inherit",
                      transition: "transform 0.2s",
                      transform: sourcesOpen ? "rotate(0deg)" : "rotate(-90deg)",
                    }}
                  />
                </ButtonBase>

                <Box component="span" sx={{ flexShrink: 0, lineHeight: 0 }}>
                  <ShareMenuButton
                    summaryTitle={summaryTitle}
                    summaryText={summaryText}
                    keywords={keywords}
                    originalUrl={originalUrl}
                    originalTitle={originalTitle}
                    cardRef={cardRef}
                  />
                </Box>
              </Box>

              <Collapse in={sourcesOpen} timeout={200}>
                <Box
                  id={sourcesId}
                  component="ul"
                  sx={{ listStyle: "none", m: 0, pl: 2.5, pb: 0.5, minWidth: 0 }}
                >
                  {sources.map((source) => (
                    <Box component="li" key={source.id} sx={{ minWidth: 0 }}>
                      {source.originalUrl ? (
                        <Link
                          href={source.originalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          underline="hover"
                          title={source.originalTitle}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                            minWidth: 0,
                            py: 0.25,
                            color: "text.disabled",
                            "&:hover": { color: "primary.main" },
                          }}
                        >
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: 1,
                              color: "inherit",
                            }}
                          >
                            {sourceLabel(source)}
                          </Typography>
                          <OpenInNewIcon
                            sx={{ fontSize: "0.7rem", flexShrink: 0, color: "inherit" }}
                            aria-hidden="true"
                          />
                        </Link>
                      ) : (
                        <Typography
                          variant="caption"
                          title={source.originalTitle}
                          sx={{
                            display: "block",
                            py: 0.25,
                            color: "text.disabled",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {sourceLabel(source)}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              </Collapse>
            </Box>
          ) : (
            /* 単独記事: 元記事タイトル行 + 共有メニューボタン */
            originalTitle && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                {originalUrl ? (
                  <Link
                    href={originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    underline="hover"
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      minWidth: 0,
                      flex: 1,
                      color: "text.disabled",
                      "&:hover": { color: "primary.main" },
                    }}
                    title={originalTitle}
                  >
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        color: "inherit",
                      }}
                    >
                      {originalTitle}
                    </Typography>
                    <OpenInNewIcon
                      sx={{ fontSize: "0.75rem", flexShrink: 0, color: "inherit" }}
                      aria-hidden="true"
                    />
                  </Link>
                ) : (
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.disabled",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                    title={originalTitle}
                  >
                    {originalTitle}
                  </Typography>
                )}

                <Box component="span" data-share-controls="true" sx={{ flexShrink: 0, lineHeight: 0 }}>
                  <ShareMenuButton
                    summaryTitle={summaryTitle}
                    summaryText={summaryText}
                    keywords={keywords}
                    originalUrl={originalUrl}
                    originalTitle={originalTitle}
                    cardRef={cardRef}
                  />
                </Box>
              </Box>
            )
          )}
        </CardContent>
      </Box>
    </Card>
  );
}
