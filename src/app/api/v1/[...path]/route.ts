import { handleAgentApi } from "@/lib/agentApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return handleAgentApi(request, (await context.params).path);
}
