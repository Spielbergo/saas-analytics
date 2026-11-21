import "server-only";
import { flattenInsights, mapFacebookPost, mapInstagramMedia } from "./parse";
import type { SocialAccount, SocialPost } from "./types";

const V = process.env.META_GRAPH_VERSION || "v23.0";
const BASE = `https://graph.facebook.com/${V}`;

type Json = Record<string, unknown>;

async function graph(path: string, token: string, params: Record<string, string> = {}): Promise<Json> {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const e = (j.error ?? {}) as { message?: string; code?: number };
    throw Object.assign(new Error(e.message ?? `Graph API ${res.status}`), { code: e.code });
  }
  return j;
}

export const metaConfigured = () => !!(process.env.META_PAGE_TOKENS || process.env.META_ACCESS_TOKEN);

type PageTok = { id: string; name: string; token: string; igId: string | null; igUsername: string | null };

/** Page tokens from META_PAGE_TOKENS ("id=token,…" or just tokens) or from /me/accounts using META_ACCESS_TOKEN. */
async function resolvePages(): Promise<PageTok[]> {
  const only = (process.env.SOCIAL_PAGE_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const raw: { id?: string; token: string }[] = [];
  if (process.env.META_PAGE_TOKENS) {
    for (const part of process.env.META_PAGE_TOKENS.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [a, b] = part.includes("=") ? part.split("=") : [undefined, part];
      raw.push({ id: a, token: b });
    }
  } else if (process.env.META_ACCESS_TOKEN) {
    let after: string | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await graph("me/accounts", process.env.META_ACCESS_TOKEN, { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50", ...(after ? { after } : {}) });
      for (const p of (r.data as Json[]) ?? []) raw.push({ id: String(p.id), token: String(p.access_token) });
      after = ((r.paging as Json | undefined)?.cursors as Json | undefined)?.after as string | undefined;
      if (!(r.paging as Json | undefined)?.next) break;
    }
  }
  const out: PageTok[] = [];
  for (const r of raw) {
    try {
      const p = await graph(r.id ?? "me", r.token, { fields: "id,name,instagram_business_account{id,username}" });
      const ig = p.instagram_business_account as { id?: string; username?: string } | undefined;
      if (only.length && !only.includes(String(p.id))) continue;
      out.push({ id: String(p.id), name: String(p.name), token: r.token, igId: ig?.id ?? null, igUsername: ig?.username ?? null });
    } catch { /* surfaced per page below if it has an id; otherwise skipped */ }
  }
  return out;
}

/** Try each metric on its own so one retired metric doesn't hide the rest. */
async function metricEach(path: string, token: string, metrics: string[], extra: Record<string, string> = {}): Promise<{ values: Record<string, number>; refused: string[] }> {
  const values: Record<string, number> = {};
  const refused: string[] = [];
  for (const m of metrics) {
    try { Object.assign(values, flattenInsights(await graph(`${path}/insights`, token, { metric: m, ...extra }))); }
    catch { refused.push(m); }
  }
  return { values, refused };
}

export type SyncResult = { posts: SocialPost[]; accounts: SocialAccount[]; errors: string[] };

const PER_ACCOUNT = Number(process.env.SOCIAL_POSTS_PER_ACCOUNT) || 40;

export async function syncMeta(): Promise<SyncResult> {
  const now = new Date().toISOString();
  const posts: SocialPost[] = [];
  const accounts: SocialAccount[] = [];
  const errors: string[] = [];
  const pages = await resolvePages();
  if (pages.length === 0) errors.push("No Facebook Pages found for the token(s). Check the permissions and that you're an admin of the Pages.");

  for (const pg of pages) {
    // ----- Facebook Page -----
    const fbAcc: SocialAccount = { key: `fb:${pg.id}`, network: "facebook", name: pg.name, username: null, followers: null, posts: 0, syncedAt: now, error: null, insightsNote: null };
    try {
      const info = await graph(pg.id, pg.token, { fields: "followers_count,fan_count,link" });
      fbAcc.followers = (info.followers_count as number | undefined) ?? (info.fan_count as number | undefined) ?? null;
      const list = await graph(`${pg.id}/posts`, pg.token, {
        fields: "id,message,story,created_time,permalink_url,shares,attachments{media_type,type},reactions.summary(true).limit(0),comments.summary(true).limit(0)",
        limit: String(PER_ACCOUNT),
      });
      const refusedAll = new Set<string>();
      for (const raw of (list.data as Json[]) ?? []) {
        // Meta retired many "impressions" metrics in late 2025; ask for the current names and tolerate refusals.
        const a = await metricEach(String(raw.id), pg.token, ["post_media_view", "post_total_media_view_unique", "post_clicks"]);
        a.refused.forEach((m) => refusedAll.add(m));
        const ins = { views: a.values.post_media_view, reach: a.values.post_total_media_view_unique, clicks: a.values.post_clicks };
        posts.push(mapFacebookPost(raw, pg.name, Object.fromEntries(Object.entries(ins).filter(([, v]) => v !== undefined)) as Record<string, number>, now));
        fbAcc.posts++;
      }
      if (refusedAll.size) fbAcc.insightsNote = `Meta wouldn't return: ${[...refusedAll].join(", ")} (blank in the table).`;
    } catch (e) {
      fbAcc.error = e instanceof Error ? e.message : "Facebook sync failed";
      errors.push(`${pg.name} (Facebook): ${fbAcc.error}`);
    }
    accounts.push(fbAcc);

    // ----- Instagram business account linked to the Page -----
    if (pg.igId) {
      const igAcc: SocialAccount = { key: `ig:${pg.igId}`, network: "instagram", name: pg.name, username: pg.igUsername, followers: null, posts: 0, syncedAt: now, error: null, insightsNote: null };
      try {
        const info = await graph(pg.igId, pg.token, { fields: "followers_count,media_count,username" });
        igAcc.followers = (info.followers_count as number | undefined) ?? null;
        igAcc.username = (info.username as string | undefined) ?? igAcc.username;
        const media = await graph(`${pg.igId}/media`, pg.token, { fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count", limit: String(PER_ACCOUNT) });
        const refusedAll = new Set<string>();
        for (const raw of (media.data as Json[]) ?? []) {
          // Metrics differ by media type, so try them one at a time.
          const a = await metricEach(String(raw.id), pg.token, ["reach", "views", "saved", "shares"]);
          a.refused.forEach((m) => refusedAll.add(m));
          posts.push(mapInstagramMedia(raw, pg.name, a.values, now));
          igAcc.posts++;
        }
        if (refusedAll.size) igAcc.insightsNote = `Not returned for some posts: ${[...refusedAll].join(", ")} (normal for some media types).`;
      } catch (e) {
        igAcc.error = e instanceof Error ? e.message : "Instagram sync failed";
        errors.push(`${pg.name} (Instagram): ${igAcc.error}`);
      }
      accounts.push(igAcc);
    }
  }
  return { posts, accounts, errors };
}
