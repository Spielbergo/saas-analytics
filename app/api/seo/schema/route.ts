import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/adminAuth";
import { seoSiteUrl } from "@/lib/seo/config";
import { checkJsonLd, extractJsonLd } from "@/lib/seo/schemaCheck";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// body: { url } (must be on your own site) or { jsonld } (pasted JSON-LD / full HTML).
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.jsonld === "string" && body.jsonld.trim()) {
      const text: string = body.jsonld.slice(0, 500_000);
      // Accept either a bare JSON-LD document or a pasted page / <script> snippet.
      const blocks = /<script\b/i.test(text) ? extractJsonLd(text) : [text.trim()];
      return NextResponse.json({ source: "pasted", report: checkJsonLd(blocks) });
    }
    if (typeof body?.url === "string") {
      const site = seoSiteUrl();
      let target: URL;
      try { target = new URL(body.url.startsWith("http") ? body.url : `https://${body.url}`); }
      catch { return NextResponse.json({ error: "That isn't a valid URL." }, { status: 400 }); }
      // Only your own site: stops this being used to make the server fetch arbitrary addresses.
      if (!site || target.hostname !== new URL(site).hostname) {
        return NextResponse.json({ error: `Only pages on ${site ? new URL(site).hostname : "your site (set SEO_SITE_URL)"} can be fetched. Paste JSON-LD to check anything else.` }, { status: 400 });
      }
      const res = await fetch(target, { headers: { "user-agent": "NorthBooksSchemaCheck/1.0" }, signal: AbortSignal.timeout(15_000), redirect: "follow", cache: "no-store" });
      if (!res.ok) return NextResponse.json({ error: `Page returned HTTP ${res.status}.` }, { status: 400 });
      if (new URL(res.url).hostname !== target.hostname) return NextResponse.json({ error: "The page redirected to another site." }, { status: 400 });
      const html = (await res.text()).slice(0, 2_000_000);
      return NextResponse.json({ source: target.toString(), report: checkJsonLd(extractJsonLd(html)) });
    }
    return NextResponse.json({ error: "Send a url or pasted jsonld." }, { status: 400 });
  } catch (err) {
    return errorResponse("/api/seo/schema", err);
  }
}
