import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pageAll } from "@/lib/pageAll";

export const dynamic = "force-dynamic";

// { available: false } until sql/crm_data.sql has been run.
export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    // One row per user per login day, so this passes 1,000 rows quickly — page through it.
    const supabase = createSupabaseAdminClient();
    const { data, error } = await pageAll<{ user_id: string; day: string }>((a, b) => supabase.rpc("admin_get_login_days").order("user_id").order("day").range(a, b) as never);
    if (error) return NextResponse.json({ available: false, days: {} });
    const days: Record<string, string[]> = {};
    for (const r of data) (days[r.user_id] ??= []).push(String(r.day).slice(0, 10));
    return NextResponse.json({ available: true, days });
  } catch (e) { return errorResponse("login-days", e); }
}
