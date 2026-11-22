import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/adminAuth";
import { seoSiteUrl } from "@/lib/seo/config";
import { loadLatestCrawl } from "@/lib/seo/crawlJob";
import { getInspectionCache, inspectUrls } from "@/lib/seo/urlInspection";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby cap

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const site = seoSiteUrl();
    const host = site ? new URL(site).hostname : null;
    let urls: string[] = (Array.isArray(body?.urls) ? body.urls : []).filter(
      (u: unknown): u is string => typeof u === "string"
    );
    if (urls.length === 0) {
      // Default: indexable pages from the last crawl, sitemap pages first.
      const crawl = await loadLatestCrawl();
      urls = (crawl?.pages ?? [])
        .filter((p) => p.indexable)
        .sort((a, b) => Number(b.inSitemap) - Number(a.inSitemap))
        .map((p) => p.url);
    }
    urls = urls.filter((u) => {
      try {
        return host !== null && new URL(u).hostname === host;
      } catch {
        return false;
      }
    });
    if (urls.length === 0) {
      return NextResponse.json({ error: site ? "No URLs to inspect yet — run a site audit first (the SEO tab's crawl), then try again." : "No site configured — set SEO_SITE_URL or SEARCH_CONSOLE_SITE_URL in the environment variables." }, { status: 400 });
    }
    // Work in small batches (the page loops over them) so each request finishes inside the host's time limit.
    const total = Math.min(urls.length, 60);
    const offset = Math.max(0, Math.min(total, Number(body?.offset) || 0));
    const limit = Math.max(1, Math.min(10, Number(body?.limit) || 6));
    const end = Math.min(total, offset + limit);
    await inspectUrls(urls.slice(offset, end));
    return NextResponse.json({ inspections: await getInspectionCache(), next: end < total ? end : null, total });
  } catch (err) {
    return errorResponse("/api/seo/inspect", err);
  }
}
