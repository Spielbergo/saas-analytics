// Pure helpers for social data (client-safe): Graph API mappers, LinkedIn CSV
// import, engagement maths and "signups after a post".
import type { Network, SocialPost } from "./types";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s%]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export const engagement = (p: SocialPost): number =>
  p.engagements ?? ((p.reactions ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0) + (p.clicks ?? 0));

/** Engagement as a share of views (preferred) or reach; null when neither is known. */
export const engagementRate = (p: SocialPost): number | null => {
  const base = p.views ?? p.reach;
  return base && base > 0 ? engagement(p) / base : null;
};

// ---------- Meta Graph API ----------

type Json = Record<string, unknown>;
const iso = (v: unknown, fallback: string): string => { const d = new Date(String(v ?? "")); return Number.isNaN(d.getTime()) ? fallback : d.toISOString(); };
const summary = (o: unknown): number | null => num(((o as Json | undefined)?.summary as Json | undefined)?.total_count);

export function mapFacebookPost(raw: Json, account: string, insights: Record<string, number>, now: string): SocialPost {
  const att = (((raw.attachments as Json | undefined)?.data as Json[] | undefined) ?? [])[0];
  return {
    id: `fb:${raw.id}`, network: "facebook", account,
    postedAt: iso(raw.created_time, now),
    text: String(raw.message ?? raw.story ?? "").slice(0, 600),
    url: (raw.permalink_url as string | undefined) ?? null,
    type: String(att?.media_type ?? att?.type ?? "post").toLowerCase(),
    views: insights.views ?? null,
    reach: insights.reach ?? null,
    reactions: summary(raw.reactions),
    comments: summary(raw.comments),
    shares: num((raw.shares as Json | undefined)?.count) ?? 0,
    saves: null,
    clicks: insights.clicks ?? null,
    source: "api", fetchedAt: now,
  };
}

export function mapInstagramMedia(raw: Json, account: string, insights: Record<string, number>, now: string): SocialPost {
  const product = String(raw.media_product_type ?? "").toLowerCase(); // FEED | REELS | STORY
  const type = product === "reels" ? "reel" : String(raw.media_type ?? "post").toLowerCase().replace("carousel_album", "carousel");
  return {
    id: `ig:${raw.id}`, network: "instagram", account,
    postedAt: iso(raw.timestamp, now),
    text: String(raw.caption ?? "").slice(0, 600),
    url: (raw.permalink as string | undefined) ?? null,
    type,
    views: insights.views ?? insights.impressions ?? insights.plays ?? null,
    reach: insights.reach ?? null,
    reactions: num(raw.like_count),
    comments: num(raw.comments_count),
    shares: insights.shares ?? null,
    saves: insights.saved ?? null,
    clicks: null,
    source: "api", fetchedAt: now,
  };
}

/** Graph "insights" responses → { metricName: value } (handles values[] and total_value). */
export function flattenInsights(resp: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of ((resp as Json | undefined)?.data as Json[] | undefined) ?? []) {
    const name = String(m.name);
    const tv = num((m.total_value as Json | undefined)?.value);
    const v = tv ?? num(((m.values as Json[] | undefined) ?? [])[0]?.value);
    if (v !== null) out[name] = v;
  }
  return out;
}

// ---------- LinkedIn import (CSV / TSV pasted or uploaded) ----------

function splitRows(text: string): string[][] {
  const delim = (text.split("\n", 5).join("\n").match(/\t/g)?.length ?? 0) > (text.split("\n", 5).join("\n").match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export type Sheet = { name: string; rows: string[][] };
export type LinkedInParse = { posts: SocialPost[]; skipped: number; matched: string[]; sheets: string[]; error: string | null };

type Field = "url" | "text" | "date" | "type" | "views" | "reach" | "clicks" | "reactions" | "comments" | "shares" | "engagements";

// Headers are matched loosely (startsWith-style) because LinkedIn adds suffixes like "(organic)".
const HEADER_MAP: [Field, (h: string) => boolean][] = [
  ["url", (h) => /^(post )?(link|url)\b/.test(h)],
  ["text", (h) => /^(post )?(title|text|commentary)\b/.test(h)],
  ["date", (h) => /(created|publish|posted).{0,12}date|^date$/.test(h) && !/campaign/.test(h)],
  ["type", (h) => /^(post|content) type\b/.test(h)],
  ["views", (h) => /^impressions\b/.test(h) && !/unique/.test(h)],
  ["reach", (h) => /^unique impressions|^reach\b|^members reached/.test(h)],
  ["clicks", (h) => /^clicks\b/.test(h)],
  ["reactions", (h) => /^(reactions|likes)\b/.test(h)],
  ["comments", (h) => /^comments\b/.test(h)],
  ["shares", (h) => /^(reposts|shares)\b/.test(h)],
  ["engagements", (h) => /^engagements\b/.test(h)],
];
const METRIC_FIELDS: Field[] = ["views", "reach", "clicks", "reactions", "comments", "shares", "engagements"];

const fieldOf = (header: string): Field | null => {
  const h = header.trim().toLowerCase();
  return h ? HEADER_MAP.find(([, test]) => test(h))?.[0] ?? null : null;
};

/** A header row has a post identifier (link/title) AND at least one metric — this rules out the daily "Metrics" tab. */
function isHeaderRow(row: string[]): boolean {
  const fs = row.map(fieldOf);
  return fs.some((f) => f === "url" || f === "text") && fs.some((f) => f && METRIC_FIELDS.includes(f));
}

function parseDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const serial = /^\d{5}(\.\d+)?$/.test(t) ? Number(t) : null; // Excel date serial
  if (serial && serial > 30000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000 + 12 * 3_600_000).toISOString();
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // LinkedIn uses M/D/YYYY
  if (us) {
    const [, a, b, y] = us;
    const month = Number(a) > 12 ? Number(b) : Number(a);
    const day = Number(a) > 12 ? Number(a) : Number(b);
    return new Date(Date.UTC(Number(y), month - 1, day, 12)).toISOString();
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12)).toISOString();
}

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const cleanUrl = (u: string) => u.trim().replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();

type Partial_ = Partial<Record<Field, string>>;

/** Parse LinkedIn analytics sheets (Page export: "Metrics" + "All posts"; personal export: "PERFORMANCE" +
 *  "TOP POSTS" with two side-by-side tables). Tables are found by their headers, and rows describing the
 *  same post (same link) are merged across tables and tabs. */
export function parseLinkedInSheets(sheets: Sheet[], account: string, now: string): LinkedInParse {
  const merged = new Map<string, Partial_>();
  const used: string[] = [];
  const matched = new Set<string>();
  let skipped = 0;

  for (const sh of sheets) {
    const hi = sh.rows.slice(0, 25).findIndex(isHeaderRow);
    if (hi < 0) continue;
    const header = sh.rows[hi];
    // Side-by-side tables start wherever a link column header repeats.
    const starts = header.map((h, i) => (fieldOf(h) === "url" ? i : -1)).filter((i) => i >= 0);
    const blocks = starts.length ? starts.map((st, k) => [st, starts[k + 1] ?? header.length] as const) : [[0, header.length] as const];
    // A block may also include columns just left of its link (e.g. a title), so extend left up to the previous block.
    let tookRows = 0;
    for (const [bi, [st, en]] of blocks.entries()) {
      const lo = bi === 0 ? 0 : st;
      const map: [number, Field][] = [];
      const seen = new Set<Field>();
      for (let c = lo; c < en; c++) { const f = fieldOf(header[c] ?? ""); if (f && !seen.has(f)) { seen.add(f); map.push([c, f]); matched.add(f); } }
      if (!seen.has("url") && !seen.has("text")) continue;
      for (const r of sh.rows.slice(hi + 1)) {
        const rec: Partial_ = {};
        for (const [c, f] of map) { const v = (r[c] ?? "").trim(); if (v) rec[f] = v; }
        if (!rec.url && !rec.text) continue;
        if (!rec.url && !rec.date) { skipped++; continue; }
        const key = rec.url ? cleanUrl(rec.url) : `${rec.date}|${rec.text}`;
        const prev = merged.get(key) ?? {};
        for (const [k, v] of Object.entries(rec)) if (prev[k as Field] === undefined) prev[k as Field] = v;
        merged.set(key, prev);
        tookRows++;
      }
    }
    if (tookRows) used.push(sh.name);
  }

  if (merged.size === 0) {
    return { posts: [], skipped, matched: [...matched], sheets: used, error: "Couldn't find a posts table: I look for a header row with a post link/title plus Impressions, Reactions, Engagements or similar. Use the posts tab ('All posts' or 'TOP POSTS')." };
  }
  const posts: SocialPost[] = [];
  for (const [key, rec] of merged) {
    const at = rec.date ? parseDate(rec.date) : null;
    if (!at) { skipped++; continue; }
    const g = (k: Field) => (rec[k] !== undefined ? num(rec[k]) : null);
    const post: SocialPost = {
      id: `li:${hash(`${account}|${key}`)}`, network: "linkedin", account, postedAt: at,
      text: (rec.text ?? "").slice(0, 600), url: rec.url ?? null, type: (rec.type ?? "post").toLowerCase(),
      views: g("views"), reach: g("reach"), reactions: g("reactions"), comments: g("comments"),
      shares: g("shares"), saves: null, clicks: g("clicks"), engagements: g("engagements"),
      source: "import", fetchedAt: now,
    };
    posts.push(post);
  }
  return { posts, skipped, matched: [...matched], sheets: used, error: posts.length ? null : "Found posts but none had a readable date." };
}

/** CSV / TSV text → the same parser. */
export function parseLinkedInExport(text: string, account: string, now: string): LinkedInParse {
  return parseLinkedInSheets([{ name: "csv", rows: splitRows(text.replace(/^\uFEFF/, "")) }], account, now);
}

// ---------- merging & attribution ----------

/** New data replaces old for the same id; hand-entered/imported rows are never dropped by an API sync. */
export function mergePosts(existing: SocialPost[], incoming: SocialPost[], cap = 3000): SocialPost[] {
  const map = new Map(existing.map((p) => [p.id, p]));
  for (const p of incoming) map.set(p.id, p);
  return [...map.values()].sort((a, b) => b.postedAt.localeCompare(a.postedAt)).slice(0, cap);
}

export const NETWORK_TERMS: Record<Network, string[]> = {
  facebook: ["facebook", "fb.com", "fb", "m.facebook"],
  instagram: ["instagram", "ig", "l.instagram"],
  linkedin: ["linkedin", "lnkd"],
};

/** Signups that joined within `hours` after a post (a rough "did this move anything" signal). */
export function signupsAfter(postedAt: string, joinedDays: string[], hours = 48): number {
  const start = new Date(postedAt).getTime();
  const end = start + hours * 3_600_000;
  // joinedDays carry only a date; count a day if any part of it falls in the window.
  return joinedDays.filter((d) => {
    const dayStart = Date.parse(`${d}T00:00:00Z`);
    return dayStart + 86_400_000 > start && dayStart < end;
  }).length;
}

/** Does a person's source text point at this network? (word-ish match so "ig" doesn't match "digital") */
export function sourceMentions(sourceText: string, network: Network): boolean {
  const tokens = sourceText.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  return NETWORK_TERMS[network].some((t) => tokens.includes(t) || (t.length > 3 && sourceText.toLowerCase().includes(t)));
}
