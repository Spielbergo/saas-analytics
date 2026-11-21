import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { listExperiments, mutateExperiments } from "@/lib/experimentStore";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ experiments: await listExperiments() });
  } catch (e) {
    return errorResponse("experiments", e);
  }
}

// body: { action: "create" | "update" | "delete" | "addNote" | "deleteNote", ... }
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    return NextResponse.json({ experiments: await mutateExperiments(body) });
  } catch (e) {
    // Validation errors are the user's to fix — show them as-is.
    if (e instanceof Error && /required|must be|before the start|Too many|not found|Write something/.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return errorResponse("experiments", e);
  }
}
