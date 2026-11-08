import { handleMcp } from "@/lib/agentMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stateless Streamable HTTP: only POST carries messages. GET (SSE stream) and DELETE
// (session end) are answered with 405 by the handler.
export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;
