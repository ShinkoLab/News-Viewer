import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import SummarizeIcon from "@mui/icons-material/Summarize";

type Props = {
  digestText: string;
  /**
   * elevation を呼び出し元から制御可能にする。
   * 白背景 (background.paper) の上に配置する場合は elevation={2} を指定し、
   * グレー背景 (background.default) の上に配置する場合はデフォルトの elevation={1} を使用。
   */
  elevation?: number;
};

export default function DigestSection({ digestText, elevation = 1 }: Props) {
  return (
    <Paper
      component="section"
      aria-label="ダイジェスト"
      elevation={elevation}
      sx={{
        mb: 3,
        borderRadius: "2px",
        overflow: "hidden",
      }}
    >
      {/* カラーヘッダーバー（Android L スタイル） */}
      <Box
        sx={{
          bgcolor: "primary.main",
          px: 2.5,
          py: 1.25,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <SummarizeIcon
          sx={{ color: "primary.contrastText", fontSize: "1.1rem" }}
          aria-hidden="true"
        />
        <Typography variant="subtitle1" sx={{ color: "primary.contrastText" }}>
          ダイジェスト
        </Typography>
      </Box>
      <Box sx={{ p: 2.5 }}>
        {/* body1 でテーマの lineHeight 1.75 を継承 */}
        <Typography
          variant="body1"
          sx={{ whiteSpace: "pre-wrap", color: "text.primary" }}
        >
          {digestText}
        </Typography>
      </Box>
    </Paper>
  );
}
