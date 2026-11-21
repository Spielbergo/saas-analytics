import "server-only";
import { kvGet, kvSet } from "./adminStore";
import { brandTerms } from "./seo/config";
import {
  type ConvoData, type SourceReport,
  cleanConfig, parseManualLink, parseBluesky, parseHackerNews, parseRedditAtom, parseRedditJson, parseThreads, scorePost,
  type Convo, type ConvoConfig, type ConvoSource, type ConvoState, type ConvoStatus, type RawPost,
} from "./conversationsCore";

// Free sources only. Reddit (public JSON, falling back to its Atom feed), Hacker News (Algolia),
// Bluesky (public search; optional free app-password login if it's refused) and Threads
// (optional, needs a Threads token with keyword-search permission). Read-only: nothing is posted anywhere.

const UA = "NorthBooksDashboard/1.0 (personal admin tool; read-only search)";
const CFG_KEY = "convo_config";
const STATE_KEY = "convo_state";
const ITEMS_KEY = "convo_items";
const MAX_ITEMS = 600;

export type { ConvoData, SourceReport } from "./conversationsCore";

export const getConvoConfig = async () => cleanConfig(await kvGet<unknown>(CFG_KEY, null));
export async function saveConvoConfig(raw: unknown) { const c = cleanConfig(raw); await kvSet(CFG_KEY, c); return c; }

async function get(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function reddit(q: string, subs: string[]): Promise<RawPost[]> {
  const scope = subs.length ? `r/${subs.join("+")}/search` : "search";
  const qs = `q=${encodeURIComponent(q)}${subs.length ? "&restrict_sr=on" : ""}&sort=new&t=week&limit=40`;
  try {
    return parseRedditJson(await (await get(`https://www.reddit.com/${scope}.json?${qs}`, { headers: { Accept: "application/json" } })).json());
  } catch {
    // JSON is often refused from cloud IPs; the Atom feed usually isn't.
    return parseRedditAtom(await (await get(`https://www.reddit.com/${scope}.rss?${qs}`)).text());
  }
}

async function hackerNews(q: string): Promise<RawPost[]> {
  const since = Math.floor(Date.now() / 1000) - 14 * 86_400;
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=(story,comment)&numericFilters=created_at_i>${since}&hitsPerPage=30`;
  return parseHackerNews(await (await get(url)).json());
}

let bskyJwt: { token: string; at: number } | null = null;
const bskyCreds = () => process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD ? { id: process.env.BLUESKY_HANDLE, pw: process.env.BLUESKY_APP_PASSWORD } : null;
async function bluesky(q: string): Promise<RawPost[]> {
  const qs = `q=${encodeURIComponent(q)}&sort=latest&limit=30`;
  try {
    return parseBluesky(await (await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?${qs}`)).json());
  } catch (e) {
    const c = bskyCreds();
    if (!c) throw e;
    if (!bskyJwt || Date.now() - bskyJwt.at > 50 * 60_000) {
      const r = await get("https://bsky.social/xrpc/com.atproto.server.createSession", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: c.id, password: c.pw }) });
      bskyJwt = { token: ((await r.json()) as { accessJwt: string }).accessJwt, at: Date.now() };
    }
    return parseBluesky(await (await get(`https://bsky.social/xrpc/app.bsky.feed.searchPosts?${qs}`, { headers: { Authorization: `Bearer ${bskyJwt.token}` } })).json());
  }
}

async function threads(q: string): Promise<RawPost[]> {
  const t = process.env.THREADS_ACCESS_TOKEN;
  if (!t) return [];
  const url = `https://graph.threads.net/keyword_search?q=${encodeURIComponent(q)}&search_type=RECENT&fields=id,text,permalink,timestamp,username,like_count,reply_count&access_token=${encodeURIComponent(t)}`;
  return parseThreads(await (await get(url)).json());
}

export const convoAvailable = () => ({ threads: Boolean(process.env.THREADS_ACCESS_TOKEN), blueskyLogin: Boolean(bskyCreds()) });

/** Run all searches, score, merge into the stored list (keeping your statuses), and return everything. */
export async function scanConversations(): Promise<ConvoData> {
  const cfg = await getConvoConfig();
  const brand = [...brandTerms(), ...(process.env.MENTION_TERMS?.split(",") ?? [])].map((s) => s.trim()).filter((s) => s.length > 3);
  const found = new Map<string, Convo>();
  const sources: SourceReport[] = [];
  const now = Date.now();

  const run = async (source: ConvoSource, fn: (q: string) => Promise<RawPost[]>, skipped?: string) => {
    if (skipped) { sources.push({ source, ok: true, found: 0, error: null, skipped }); return; }
    const rs = await Promise.allSettled(cfg.queries.map(async (q) => ({ q, posts: await fn(q) })));
    let n = 0; let err: string | null = null;
    for (const r of rs) {
      if (r.status === "rejected") { err = r.reason instanceof Error ? r.reason.message : String(r.reason); continue; }
      for (const p of r.value.posts) {
        const s = scorePost(p, r.value.q, cfg, brand, now);
        if (s.dropped) continue;
        const prev = found.get(p.id);
        if (!prev || s.score > prev.score) { if (!prev) n++; found.set(p.id, { ...p, query: r.value.q, score: s.score, why: s.why, mentionsYou: s.mentionsYou }); }
      }
    }
    sources.push({ source, ok: !err || n > 0, found: n, error: err });
  };
  await run("reddit", (q) => reddit(q, cfg.subreddits));
  await run("hackernews", hackerNews);
  await run("bluesky", bluesky);
  await run("threads", threads, process.env.THREADS_ACCESS_TOKEN ? undefined : "No THREADS_ACCESS_TOKEN set (optional)");

  const stored = await kvGet<Convo[]>(ITEMS_KEY, []);
  const merged = new Map(stored.map((c) => [c.id, c]));
  for (const c of found.values()) merged.set(c.id, c);
  const keepAfter = now - 45 * 86_400_000;
  const state = await kvGet<ConvoState>(STATE_KEY, {});
  const nowIso = new Date(now).toISOString();
  for (const c of found.values()) if (!state[c.id]) state[c.id] = { status: "new", firstSeen: nowIso, updatedAt: nowIso };
  // Keep recent posts, plus anything you've acted on.
  const list = [...merged.values()]
    .filter((c) => new Date(c.postedAt).getTime() > keepAfter || (state[c.id] && state[c.id].status !== "new"))
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt)).slice(0, MAX_ITEMS);
  const ids = new Set(list.map((c) => c.id));
  for (const k of Object.keys(state)) if (!ids.has(k)) delete state[k];
  await kvSet(ITEMS_KEY, list);
  await kvSet(STATE_KEY, state);
  await kvSet("convo_scanned_at", nowIso);
  return buildData(cfg, list, state, sources, nowIso);
}

function buildData(config: ConvoConfig, list: Convo[], state: ConvoState, sources: SourceReport[], scannedAt: string | null): ConvoData {
  const items = list.filter((c) => c.score >= config.minScore || (state[c.id] && state[c.id].status !== "new"))
    .map((c) => ({ ...c, status: state[c.id]?.status ?? "new" as ConvoStatus, note: state[c.id]?.note ?? null, firstSeen: state[c.id]?.firstSeen ?? c.postedAt }))
    .sort((a, b) => (a.status === "new" ? 0 : 1) - (b.status === "new" ? 0 : 1) || b.score - a.score);
  return { config, items, sources, scannedAt, available: convoAvailable() };
}

export async function getConversations(): Promise<ConvoData> {
  const [config, list, state, scannedAt] = await Promise.all([getConvoConfig(), kvGet<Convo[]>(ITEMS_KEY, []), kvGet<ConvoState>(STATE_KEY, {}), kvGet<string | null>("convo_scanned_at", null)]);
  return buildData(config, list, state, [], scannedAt);
}

const STATUSES = new Set<ConvoStatus>(["new", "saved", "replied", "skipped"]);
export async function markConversations(ids: string[], status: string, note?: string) {
  if (!STATUSES.has(status as ConvoStatus)) throw new Error("status must be new, saved, replied or skipped");
  const state = await kvGet<ConvoState>(STATE_KEY, {});
  const now = new Date().toISOString();
  for (const id of ids.slice(0, 200)) {
    const prev = state[id] ?? { status: "new" as ConvoStatus, firstSeen: now, updatedAt: now };
    state[id] = { ...prev, status: status as ConvoStatus, updatedAt: now, ...(note !== undefined ? { note: note.slice(0, 500) } : {}) };
  }
  await kvSet(STATE_KEY, state);
}

const hashStr = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/** Log a post you found yourself (LinkedIn, Facebook, anywhere) so replies are tracked with the rest. */
export async function logManualConversation(input: { url: string; title?: string; note?: string; status?: string }) {
  const link = parseManualLink(String(input.url ?? ""));
  if (!link) throw new Error("url must be a full link starting with http(s)://");
  const status = input.status === "saved" ? "saved" : "replied";
  const id = `manual:${hashStr(link.url)}`;
  const now = new Date().toISOString();
  const list = await kvGet<Convo[]>(ITEMS_KEY, []);
  if (!list.some((c) => c.id === id)) {
    list.unshift({
      id, source: "manual", title: (input.title ?? "").trim().slice(0, 200) || `${link.where} post`, snippet: null, url: link.url, author: null,
      community: link.where, postedAt: now, comments: null, likes: null, query: "logged by hand", score: 0, why: ["logged by hand"], mentionsYou: false,
    });
    await kvSet(ITEMS_KEY, list.slice(0, MAX_ITEMS));
  }
  const state = await kvGet<ConvoState>(STATE_KEY, {});
  state[id] = { status, firstSeen: state[id]?.firstSeen ?? now, updatedAt: now, ...(input.note?.trim() ? { note: input.note.trim().slice(0, 500) } : {}) };
  await kvSet(STATE_KEY, state);
}
