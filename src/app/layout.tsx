import type { Metadata } from "next";
import ThemeRegistry from "@/components/ThemeRegistry";
import "./globals.css";

export const metadata: Metadata = {
  title: "News Viewer",
  description: "ニュース要約ビューア",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the inline script below adds data-ios-standalone before hydration.
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* iOS home-screen web apps opened without a manifest report display-mode: browser,
            so (display-mode: standalone) never matches there. navigator.standalone still does.
            Mark <html> before first paint so SidebarLayout's top-edge workaround applies. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(navigator.standalone===true)document.documentElement.setAttribute("data-ios-standalone","")}catch(e){}`,
          }}
        />
      </head>
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
