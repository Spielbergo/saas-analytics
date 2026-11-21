import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { getConversations, markConversations, logManualConversation, saveConvoConfig, scanConversations } from "@/lib/conversations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const scan = new URL(request.url).searchParams.get("scan") === "1";
    return NextResponse.json(scan ? await scanConversations() : await getConversations());
  } catch (e) { return errorResponse("conversations", e); }
}

// body: { action: "config", config } | { action: "mark", ids, status, note? }
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const b = await request.json();
    if (b.action === "config") await saveConvoConfig(b.config);
    else if (b.action === "mark") await markConversations(Array.isArray(b.ids) ? b.ids.map(String) : [], String(b.status), typeof b.note === "string" ? b.note : undefined);
    else if (b.action === "log") await logManualConversation({ url: String(b.url ?? ""), title: typeof b.title === "string" ? b.title : undefined, note: typeof b.note === "string" ? b.note : undefined, status: typeof b.status === "string" ? b.status : undefined });
    else return NextResponse.json({ error: "unknown action" }, { status: 400 });
    return NextResponse.json(await getConversations());
  } catch (e) {
    if (e instanceof Error && /must be|must be a full link/.test(e.message)) return NextResponse.json({ error: e.message }, { status: 400 });
    return errorResponse("conversations", e);
  }
}
