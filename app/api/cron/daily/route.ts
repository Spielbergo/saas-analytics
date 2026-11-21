import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronAuth";
import { captureSnapshot } from "@/lib/snapshots";
import { runInfraAlerts, runDailyDigest } from "@/lib/alerts";
import { syncSocial } from "@/lib/social/store";
import { scanConversations } from "@/lib/conversations";
import { metaConfigured } from "@/lib/social/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One daily job (Vercel Hobby allows very few cron jobs): snapshot → infra check → digest.
// Each step is isolated so one failure doesn't block the others.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { out[name] = await fn(); } catch (e) { out[name] = { error: e instanceof Error ? e.message : "failed" }; }
  };
  await step("snapshot", () => captureSnapshot(true));
  if (metaConfigured()) await step("social", () => syncSocial());
  await step("conversations", async () => { const d = await scanConversations(); return { found: d.items.length }; });
  await step("monitor", () => runInfraAlerts());
  await step("digest", async () => { const d = await runDailyDigest({ send: true }); return { sent: true, attention: d.attention }; });
  return NextResponse.json(out);
}
