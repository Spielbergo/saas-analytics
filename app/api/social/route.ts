import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { addPosts, deletePost, getSocial, syncSocial } from "@/lib/social/store";
import { parseLinkedInExport, parseLinkedInSheets } from "@/lib/social/parse";
import { readXlsx } from "@/lib/social/xlsx";
import type { SocialPost } from "@/lib/social/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getSocial());
  } catch (e) {
    return errorResponse("social", e);
  }
}

// body.action: "sync" | "importLinkedIn" {account, csv} | "addManual" {post} | "delete" {id}
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const now = new Date().toISOString();
    if (body.action === "sync") {
      const r = await syncSocial();
      return NextResponse.json({ ...r, data: await getSocial() });
    }
    if (body.action === "importLinkedIn") {
      const account = String(body.account ?? "").trim().slice(0, 60);
      if (!account) return NextResponse.json({ error: "Name the LinkedIn account (e.g. NorthBooks or Scott)." }, { status: 400 });
      // Either a CSV/TSV text, or an .xlsx file sent as base64 (LinkedIn's own export format).
      let r;
      if (typeof body.xlsxBase64 === "string" && body.xlsxBase64) {
        if (body.xlsxBase64.length > 12_000_000) return NextResponse.json({ error: "That file is too large." }, { status: 400 });
        try { r = parseLinkedInSheets(readXlsx(Buffer.from(body.xlsxBase64, "base64")), account, now); }
        catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't read that Excel file." }, { status: 400 }); }
      } else {
        r = parseLinkedInExport(String(body.csv ?? "").slice(0, 2_000_000), account, now);
      }
      if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
      await addPosts(r.posts);
      return NextResponse.json({ imported: r.posts.length, skipped: r.skipped, matched: r.matched, sheets: r.sheets, data: await getSocial() });
    }
    if (body.action === "addManual") {
      const p = body.post ?? {};
      const net = ["facebook", "instagram", "linkedin"].includes(p.network) ? p.network : "linkedin";
      const day = String(p.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !String(p.account ?? "").trim()) return NextResponse.json({ error: "Account and a date (YYYY-MM-DD) are required." }, { status: 400 });
      const n = (v: unknown) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
      const post: SocialPost = {
        id: `${net.slice(0, 2)}:m${Date.now().toString(36)}`, network: net, account: String(p.account).trim().slice(0, 60),
        postedAt: `${day}T12:00:00.000Z`, text: String(p.text ?? "").slice(0, 600), url: p.url ? String(p.url).slice(0, 500) : null,
        type: "post", views: n(p.views), reach: n(p.reach), reactions: n(p.reactions), comments: n(p.comments), shares: n(p.shares), saves: null, clicks: n(p.clicks),
        source: "manual", fetchedAt: now,
      };
      await addPosts([post]);
      return NextResponse.json({ data: await getSocial() });
    }
    if (body.action === "delete") {
      await deletePost(String(body.id));
      return NextResponse.json({ data: await getSocial() });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return errorResponse("social", e);
  }
}
