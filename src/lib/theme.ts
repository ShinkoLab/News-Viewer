import { createTheme } from "@mui/material/styles";
import type { Shadows } from "@mui/material/styles";

// Android L / MD1 カスタム shadow スケール
// Box に boxShadow: N で参照したときに MuiPaper override と同じ値になるよう統一する
const androidLShadows: Shadows = [
  "none",                                                                                 // 0
  "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)",                              // 1
  "0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23)",                              // 2
  "0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23)",                              // 3
  "0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23)",                            // 4
  "0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23)",                            // 5
  "0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23)",                            // 6
  "0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23)",                            // 7
  "0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22)",                          // 8
  "0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22)",                          // 9
  "0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22)",                          // 10
  "0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22)",                          // 11
  "0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22)",                          // 12
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 13
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 14
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 15
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 16
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 17
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 18
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 19
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 20
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 21
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 22
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 23
  "0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22)",                          // 24
];

const theme = createTheme({
  shadows: androidLShadows,
  palette: {
    mode: "light",
    primary: {
      main: "#3F51B5",   // Indigo 500 — Android L signature color
      dark: "#303F9F",   // Indigo 700
      light: "#7986CB",  // Indigo 300
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#FF4081",   // Pink A200 — Android L accent
    },
    background: {
      default: "#F5F5F5", // Grey 100 — Material Design content background
      paper: "#FFFFFF",
    },
    text: {
      primary: "rgba(0, 0, 0, 0.87)",
      secondary: "rgba(0, 0, 0, 0.54)",
      disabled: "rgba(0, 0, 0, 0.38)",
    },
  },
  shape: {
    borderRadius: 2, // Material Design 1 uses minimal rounding
  },
  typography: {
    fontFamily: [
      "Roboto",
      '"Noto Sans JP"',
      "-apple-system",
      "BlinkMacSystemFont",
      "sans-serif",
    ].join(","),
    h5: {
      fontWeight: 700,
      fontSize: "1.375rem",
      lineHeight: 1.4,
    },
    h6: {
      fontWeight: 500,
      fontSize: "1.125rem",
      lineHeight: 1.4,
    },
    subtitle1: {
      fontWeight: 600,
      fontSize: "1rem",
      lineHeight: 1.5,
    },
    subtitle2: {
      fontWeight: 700,
      fontSize: "0.9375rem",
      lineHeight: 1.5,
    },
    body1: {
      fontSize: "1rem",
      lineHeight: 1.75,
    },
    body2: {
      fontSize: "0.875rem",
      lineHeight: 1.7,
    },
    caption: {
      fontSize: "0.75rem",
      lineHeight: 1.5,
    },
    overline: {
      fontWeight: 600,
      fontSize: "0.6875rem",
      letterSpacing: "0.1em",
      lineHeight: 1.6,
      textTransform: "uppercase",
    },
  },
  components: {
    MuiCard: {
      defaultProps: { elevation: 1 },
    },
    MuiPaper: {
      styleOverrides: {
        elevation1: { boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)" },
        elevation2: { boxShadow: "0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23)" },
        elevation4: { boxShadow: "0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23)" },
        elevation8: { boxShadow: "0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22)" },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          height: 24,
        },
        label: {
          fontSize: "0.75rem",
          paddingLeft: 8,
          paddingRight: 8,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          "&.Mui-selected": {
            backgroundColor: "rgba(63, 81, 181, 0.12)",
            color: "#3F51B5",
            "&:hover": {
              backgroundColor: "rgba(63, 81, 181, 0.18)",
            },
          },
        },
      },
    },
    // フォーカスリング — WCAG 2.4.7 (Focus Visible) 準拠
    // primary.light (#7986CB) はコンテンツエリアの白/グレー背景に対して視認性が高い
    MuiButtonBase: {
      styleOverrides: {
        root: {
          "&.Mui-focusVisible": {
            outline: "2px solid #7986CB",
            outlineOffset: "2px",
          },
        },
      },
    },
    // AppBar 上の IconButton は白アウトラインを使用（primary 背景に対して視認性確保）
    MuiIconButton: {
      styleOverrides: {
        root: {
          "&.Mui-focusVisible": {
            outline: "2px solid rgba(255,255,255,0.8)",
            outlineOffset: "2px",
          },
        },
      },
    },
  },
});

export default theme;
