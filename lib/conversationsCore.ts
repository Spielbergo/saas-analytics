// Conversation finder — pure helpers (client-safe): types, scoring, parsing.
// Finds public posts where someone is asking for help your product could answer, so you can reply by hand.
// Nothing here posts anything.

export type ConvoSource = "reddit" | "hackernews" | "bluesky" | "threads" | "manual";
export type ConvoStatus = "new" | "saved" | "replied" | "skipped";

export type Convo = {
  id: string; // reddit:abc, hn:123, bsky:..., threads:...
  source: ConvoSource;
  title: string;
  snippet: string | null;
  url: string;
  author: string | null;
  community: string | null; // r/sub, etc.
  postedAt: string; // ISO
  comments: number | null;
  likes: number | null;
  query: string; // the search that found it
  score: number; // 0–100 "worth replying to"
  why: string[]; // short reasons behind the score
  mentionsYou: boolean;
};

export type ConvoState = Record<string, { status: ConvoStatus; note?: string; firstSeen: string; updatedAt: string }>;

export type ConvoConfig = {
  queries: string[]; // phrases to search for
  ignore: string[]; // words/phrases that drop a post (hiring, promo, etc.)
  subreddits: string[]; // optional: limit Reddit to these (empty = all of Reddit)
  minScore: number;
};

export const DEFAULT_CONFIG: ConvoConfig = {
  queries: [
    "bookkeeping software freelancer",
    "invoicing software Canada",
    "track expenses self-employed",
    "alternative to QuickBooks",
    "Wave accounting alternative",
    "HST bookkeeping small business",
  ],
  ignore: ["hiring", "for hire", "[hiring]", "giveaway", "discount code", "referral link"],
  subreddits: [],
  minScore: 35,
};

export const MAX_QUERIES = 12;

export function cleanConfig(raw: unknown): ConvoConfig {
  const r = (raw ?? {}) as Partial<ConvoConfig>;
  const list = (v: unknown, max: number, len = 80) =>
    (Array.isArray(v) ? v : []).map((x) => String(x).trim().slice(0, len)).filter(Boolean).slice(0, max);
  const queries = list(r.queries, MAX_QUERIES, 100);
  const min = Number(r.minScore);
  return {
    queries: queries.length ? queries : DEFAULT_CONFIG.queries,
    ignore: list(r.ignore, 40),
    subreddits: list(r.subreddits, 30, 40).map((s) => s.replace(/^\/?r\//i, "").replace(/[^A-Za-z0-9_]/g, "")).filter(Boolean),
    minScore: Number.isFinite(min) ? Math.min(90, Math.max(0, Math.round(min))) : DEFAULT_CONFIG.minScore,
  };
}

const STOP = new Set("a an the and or for to of in on with is are my me i we you your any best good software app tool tools".split(" "));
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%+#\s-]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

const INTENT = /\b(recommend\w*|suggest\w*|looking for|alternatives?|any tips|which (one|software|app|tool)|best way|how (do|can|should|to)|need help|struggl\w+|advice|what do you use|switch(ing)? from|worth it|can't figure|confused|help me)\b/i;

/** Score one post for "worth replying to" (0–100) with human-readable reasons. */
export function scorePost(p: { title: string; snippet: string | null; postedAt: string; comments: number | null }, query: string, cfg: Pick<ConvoConfig, "ignore">, brand: string[], now = Date.now()): { score: number; why: string[]; mentionsYou: boolean; dropped: boolean } {
  const text = `${p.title} ${p.snippet ?? ""}`.toLowerCase();
  const why: string[] = [];
  if (cfg.ignore.some((w) => w && text.includes(w.toLowerCase()))) return { score: 0, why: ["matches an ignore word"], mentionsYou: false, dropped: true };
  const q = tokens(query);
  const hit = q.filter((w) => text.includes(w));
  let score = q.length ? (hit.length / q.length) * 40 : 0;
  if (hit.length) why.push(`matches ${hit.length}/${q.length} words of “${query}”`);
  if (text.includes(query.toLowerCase())) { score += 12; why.push("exact phrase"); }
  const title = p.title;
  if (title.includes("?")) { score += 10; why.push("a question"); }
  if (INTENT.test(text)) { score += 15; why.push("asking for help/recommendations"); }
  const ageH = (now - new Date(p.postedAt).getTime()) / 3_600_000;
  if (ageH < 12) { score += 20; why.push("posted in the last 12h"); }
  else if (ageH < 48) { score += 12; why.push("posted in the last 2 days"); }
  else if (ageH < 24 * 7) { score += 5; }
  const c = p.comments;
  if (c !== null) {
    if (c <= 5) { score += 10; why.push(c === 0 ? "no replies yet" : "few replies"); }
    else if (c <= 20) score += 5;
    else if (c > 50) { score -= 10; why.push("crowded thread"); }
  }
  const mentionsYou = brand.some((b) => b && text.includes(b.toLowerCase()));
  if (mentionsYou) { score += 10; why.push("mentions your brand"); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), why, mentionsYou, dropped: ageH > 24 * 30 };
}

// ---------- parsers (pure, so they can be tested) ----------

const decode = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const strip = (s: string) => decode(decode(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export type RawPost = Omit<Convo, "score" | "why" | "mentionsYou" | "query">;

export function parseRedditJson(j: unknown): RawPost[] {
  const kids = (j as { data?: { children?: { data: Record<string, unknown> }[] } })?.data?.children ?? [];
  return kids.map(({ data: d }) => ({
    id: `reddit:${d.id}`, source: "reddit" as const, title: String(d.title ?? ""),
    snippet: d.selftext ? String(d.selftext).replace(/\s+/g, " ").slice(0, 400) : null,
    url: `https://www.reddit.com${d.permalink}`, author: (d.author as string) ?? null, community: d.subreddit ? `r/${d.subreddit}` : null,
    postedAt: new Date(Number(d.created_utc) * 1000).toISOString(), comments: typeof d.num_comments === "number" ? d.num_comments : null, likes: typeof d.score === "number" ? d.score : null,
  })).filter((p) => p.title);
}

/** Reddit's Atom feed — used when the JSON endpoint is blocked. */
export function parseRedditAtom(xml: string): RawPost[] {
  const out: RawPost[] = [];
  for (const e of xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) ?? []) {
    const tag = (t: string) => e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "";
    const url = e.match(/<link[^>]*href="([^"]+)"/)?.[1];
    const title = strip(tag("title"));
    const id = url?.match(/comments\/([a-z0-9]+)/i)?.[1];
    if (!url || !title || !id) continue;
    const sub = url.match(/\/r\/([^/]+)/i)?.[1];
    const date = tag("published") || tag("updated");
    out.push({
      id: `reddit:${id}`, source: "reddit", title, snippet: strip(tag("content")).replace(/submitted by.*$/i, "").slice(0, 400) || null, url: decode(url),
      author: strip(tag("name")).replace(/^\/u\//, "") || null, community: sub ? `r/${sub}` : null,
      postedAt: date ? new Date(date).toISOString() : new Date().toISOString(), comments: null, likes: null,
    });
  }
  return out;
}

export function parseHackerNews(j: unknown): RawPost[] {
  return (((j as { hits?: Record<string, unknown>[] })?.hits) ?? []).map((h) => {
    const id = String(h.objectID);
    const comment = h.comment_text != null;
    return {
      id: `hn:${id}`, source: "hackernews" as const,
      title: String(h.title ?? h.story_title ?? "(comment)"),
      snippet: comment ? strip(String(h.comment_text)).slice(0, 400) : h.story_text ? strip(String(h.story_text)).slice(0, 400) : null,
      url: `https://news.ycombinator.com/item?id=${id}`, author: (h.author as string) ?? null, community: comment ? "HN comment" : "HN",
      postedAt: String(h.created_at ?? new Date().toISOString()), comments: typeof h.num_comments === "number" ? h.num_comments : null, likes: typeof h.points === "number" ? h.points : null,
    };
  });
}

export function parseBluesky(j: unknown): RawPost[] {
  return (((j as { posts?: Record<string, unknown>[] })?.posts) ?? []).map((p) => {
    const author = (p.author ?? {}) as Record<string, unknown>;
    const rec = (p.record ?? {}) as Record<string, unknown>;
    const handle = String(author.handle ?? "");
    const rkey = String(p.uri ?? "").split("/").pop();
    const text = String(rec.text ?? "");
    return {
      id: `bsky:${String(p.uri ?? "")}`, source: "bluesky" as const, title: text.slice(0, 140), snippet: text.length > 140 ? text.slice(0, 400) : null,
      url: `https://bsky.app/profile/${handle}/post/${rkey}`, author: handle || null, community: "Bluesky",
      postedAt: String(rec.createdAt ?? p.indexedAt ?? new Date().toISOString()), comments: typeof p.replyCount === "number" ? p.replyCount : null, likes: typeof p.likeCount === "number" ? p.likeCount : null,
    };
  }).filter((p) => p.title);
}

export function parseThreads(j: unknown): RawPost[] {
  return (((j as { data?: Record<string, unknown>[] })?.data) ?? []).map((p) => {
    const text = String(p.text ?? "");
    return {
      id: `threads:${p.id}`, source: "threads" as const, title: text.slice(0, 140), snippet: text.length > 140 ? text.slice(0, 400) : null,
      url: String(p.permalink ?? ""), author: (p.username as string) ?? null, community: "Threads",
      postedAt: String(p.timestamp ? new Date(String(p.timestamp)).toISOString() : new Date().toISOString()), comments: typeof p.reply_count === "number" ? p.reply_count : null, likes: typeof p.like_count === "number" ? p.like_count : null,
    };
  }).filter((p) => p.title && p.url);
}

export const SOURCE_LABEL: Record<ConvoSource, string> = { reddit: "Reddit", hackernews: "Hacker News", bluesky: "Bluesky", threads: "Threads", manual: "Logged by hand" };

export type SourceReport = { source: ConvoSource; ok: boolean; found: number; error: string | null; skipped?: string };
export type ConvoData = {
  config: ConvoConfig;
  items: (Convo & { status: ConvoStatus; note: string | null; firstSeen: string })[];
  sources: SourceReport[];
  scannedAt: string | null;
  available: { threads: boolean; blueskyLogin: boolean };
};


/** One-click searches that open in YOUR logged-in browser — for networks with no search API (LinkedIn, Facebook…). */
export function searchLinks(query: string): { label: string; url: string }[] {
  const q = encodeURIComponent(query);
  return [
    { label: "LinkedIn", url: `https://www.linkedin.com/search/results/content/?keywords=${q}&datePosted=%22past-week%22&sortBy=%22date_posted%22` },
    { label: "Facebook", url: `https://www.facebook.com/search/posts/?q=${q}` },
    { label: "Threads", url: `https://www.threads.com/search?q=${q}&serp_type=default&filter=recent` },
    { label: "X", url: `https://x.com/search?q=${q}&f=live` },
    { label: "Quora", url: `https://www.quora.com/search?q=${q}` },
  ];
}

const HOSTS: [RegExp, string][] = [
  [/linkedin\.com$/, "LinkedIn"], [/facebook\.com$|fb\.com$/, "Facebook"], [/threads\.(net|com)$/, "Threads"], [/(^|\.)(x|twitter)\.com$/, "X"],
  [/quora\.com$/, "Quora"], [/reddit\.com$/, "Reddit"], [/instagram\.com$/, "Instagram"],
];

/** Validate and describe a link the user pasted after replying by hand. */
export function parseManualLink(raw: string): { url: string; where: string } | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./, "");
  const where = HOSTS.find(([re]) => re.test(host))?.[1] ?? host;
  u.hash = "";
  return { url: u.toString(), where };
}
