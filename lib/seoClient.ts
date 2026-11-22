"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { InspectionResult, SeoBundle } from "@/lib/seo/types";

/** Authenticated fetch against /api/seo/*. Throws with the server's detail. */
async function accessToken(forceRefresh = false): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  let { data: { session } } = await supabase.auth.getSession();
  // Background tabs throttle Supabase's refresh timer, so a long-open tab can hold an expired token.
  const expiring = session?.expires_at ? session.expires_at * 1000 - Date.now() < 60_000 : false;
  if (session && (forceRefresh || expiring)) {
    const r = await supabase.auth.refreshSession();
    if (r.data.session) session = r.data.session;
  }
  if (!session) throw new Error("Your session has expired. Please sign in again.");
  return session.access_token;
}

/** Authenticated fetch against the admin API routes. Refreshes the session and retries once on a 401. */
export async function seoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const send = async (token: string) =>
    fetch(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
    });

  let res = await send(await accessToken());
  if (res.status === 401) res = await send(await accessToken(true));
  if (res.status === 401) {
    throw new Error("Your session has expired or this account isn't on the admin allow-list. Sign out and sign in again (check ALLOWED_ADMIN_EMAILS if it keeps happening).");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.error ?? "";
    } catch {
      /* not JSON */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export const fetchSeoBundle = (refresh = false) =>
  seoFetch<SeoBundle>(`/api/seo${refresh ? "?refresh=1" : ""}`);

/** Inspect pages in small batches so every request stays inside the host's time limit (Vercel Hobby: 60s). */
export async function inspectAll(onProgress?: (done: number, total: number) => void): Promise<InspectionResult[]> {
  let offset = 0;
  let rows: InspectionResult[] = [];
  for (let guard = 0; guard < 30; guard++) {
    const r = await seoFetch<{ inspections: InspectionResult[]; next: number | null; total: number }>("/api/seo/inspect", {
      method: "POST",
      body: JSON.stringify({ offset, limit: 6 }),
    });
    rows = r.inspections;
    onProgress?.(r.next ?? r.total, r.total);
    if (r.next === null) break;
    offset = r.next;
  }
  return rows;
}
