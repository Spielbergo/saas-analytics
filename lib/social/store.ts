import "server-only";
import { kvGet, kvSet } from "../adminStore";
import { metaConfigured, syncMeta } from "./meta";
import { mergePosts } from "./parse";
import type { SocialAccount, SocialData, SocialPost } from "./types";

const POSTS = "social_posts";
const ACCTS = "social_accounts";
const SYNCED = "social_synced_at";

export async function getSocial(): Promise<SocialData> {
  const [posts, accounts, syncedAt] = await Promise.all([
    kvGet<SocialPost[]>(POSTS, []), kvGet<SocialAccount[]>(ACCTS, []), kvGet<string | null>(SYNCED, null),
  ]);
  // Account post counts follow the data we hold (imports and manual posts included).
  const counts = new Map<string, number>();
  for (const p of posts) counts.set(`${p.network}:${p.account}`, (counts.get(`${p.network}:${p.account}`) ?? 0) + 1);
  const known = new Set(accounts.map((a) => `${a.network}:${a.name}`));
  const extra: SocialAccount[] = [...counts.keys()]
    .filter((k) => !known.has(k))
    .map((k) => { const [network, ...n] = k.split(":"); return { key: `${network}:${n.join(":")}`, network: network as SocialAccount["network"], name: n.join(":"), username: null, followers: null, posts: 0, syncedAt: null, error: null, insightsNote: null }; });
  const all = [...accounts, ...extra].map((a) => ({ ...a, posts: counts.get(`${a.network}:${a.name}`) ?? 0 }));
  return { posts, accounts: all, syncedAt, configured: { meta: metaConfigured() }, durable: true };
}

export async function syncSocial(): Promise<{ errors: string[]; fetched: number }> {
  if (!metaConfigured()) throw new Error("Set META_ACCESS_TOKEN or META_PAGE_TOKENS in .env.local (see README → Social).");
  const r = await syncMeta();
  const existing = await kvGet<SocialPost[]>(POSTS, []);
  await kvSet(POSTS, mergePosts(existing, r.posts));
  // Keep non-Meta accounts (LinkedIn) untouched; replace Meta accounts with what we just saw.
  const prev = await kvGet<SocialAccount[]>(ACCTS, []);
  const keep = prev.filter((a) => a.network === "linkedin");
  await kvSet(ACCTS, [...r.accounts, ...keep]);
  if (r.posts.length || !r.errors.length) await kvSet(SYNCED, new Date().toISOString());
  return { errors: r.errors, fetched: r.posts.length };
}

export async function addPosts(incoming: SocialPost[]): Promise<number> {
  const existing = await kvGet<SocialPost[]>(POSTS, []);
  const merged = mergePosts(existing, incoming);
  await kvSet(POSTS, merged);
  return incoming.length;
}

export async function deletePost(id: string): Promise<void> {
  const existing = await kvGet<SocialPost[]>(POSTS, []);
  await kvSet(POSTS, existing.filter((p) => p.id !== id));
}
