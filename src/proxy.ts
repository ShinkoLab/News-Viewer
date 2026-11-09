import { NextResponse, type NextRequest } from "next/server";

/**
 * エージェント専用モード（`NEWS_AGENT_ONLY=true`）。
 *
 * 同じイメージを IAP なしの Cloud Run サービス（news-agent）として公開するとき、
 * 画面・旧 API（/api/batches）・静的ファイルを含め、キーで守られた `/mcp` と `/api/v1/*`
 * 以外をすべて 404 にする。IAP を外してよい根拠はこの関数なので、matcher は付けず
 * すべてのリクエスト（_next/static・_next/data・public/ を含む）で判定する。
 *
 * 未設定（通常の Viewer）なら何もしない。
 */
export function isAgentPathAllowed(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/api/v1/");
}

export function proxy(request: NextRequest) {
  if (process.env.NEWS_AGENT_ONLY !== "true") return NextResponse.next();
  if (isAgentPathAllowed(request.nextUrl.pathname)) return NextResponse.next();
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
