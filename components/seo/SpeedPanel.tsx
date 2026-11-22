"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { seoFetch } from "@/lib/seoClient";
import type { CrawlResult, Opportunities, PageSpeedResult } from "@/lib/seo/types";
import { normUrl } from "@/lib/seo/urlNorm";
import { Card, ErrorNote, Pill, RunButton, UrlLink, col, num } from "./common";

const score = (v: number | null) =>
  v === null ? <span className="text-muted">—</span> : <Pill tone={v >= 90 ? "good" : v >= 50 ? "warning" : "error"}>{v}</Pill>;
const MAX_PAGES = 15; // per run: ~20s each, so a full run is a few minutes
const pathOf = (u: string) => { try { const x = new URL(u); return (x.pathname === "/" ? "/ (home)" : x.pathname) + x.search; } catch { return u; } };
const sec = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);

export function SpeedPanel({
  siteUrl,
  crawl,
  results,
  opportunities,
  hasKey,
  onChange,
}: {
  siteUrl: string | null;
  crawl: CrawlResult | null;
  results: PageSpeedResult[];
  opportunities: Opportunities;
  hasKey: boolean;
  onChange: (rows: PageSpeedResult[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<"mobile" | "desktop" | "both">("mobile");
  const [progress, setProgress] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("");
  const [extra, setExtra] = useState("");
  const [open, setOpen] = useState(false);

  // Every page we know about, one spelling each: home, Search Console's top pages, then the audit's indexable pages.
  const candidates = useMemo(() => {
    const m = new Map<string, { url: string; note: string }>();
    const add = (u: string, note: string) => { const k = normUrl(u); if (!m.has(k)) m.set(k, { url: k, note }); };
    if (siteUrl) add(siteUrl, "home");
    for (const p of opportunities.topPages) add(p.page, `Search Console · ${p.clicks} clicks`);
    for (const p of crawl?.pages ?? []) if (p.indexable) add(p.url, "from site audit");
    return Array.from(m.values());
  }, [siteUrl, opportunities, crawl]);

  const defaults = useMemo(() => [siteUrl, ...opportunities.topPages.slice(0, 4).map((p) => p.page)].filter(Boolean).map((u) => normUrl(u as string)).filter((u, i, a) => a.indexOf(u) === i), [siteUrl, opportunities]);
  useEffect(() => {
    try { const raw = localStorage.getItem("speed-pages"); if (raw) setPicked(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  const selected = (picked ?? defaults).slice(0, MAX_PAGES);
  const setSel = (next: string[]) => {
    const clean = Array.from(new Set(next)).slice(0, MAX_PAGES);
    setPicked(clean);
    try { localStorage.setItem("speed-pages", JSON.stringify(clean)); } catch { /* ignore */ }
  };
  const toggle = (u: string) => setSel(selected.includes(u) ? selected.filter((x) => x !== u) : [...selected, u]);
  function addExtra() {
    const raw = extra.trim();
    if (!raw) return;
    try {
      const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      if (siteUrl && u.hostname !== new URL(siteUrl).hostname) { setError(`Only pages on ${new URL(siteUrl).hostname} can be tested.`); return; }
      setError(null); setSel([...selected, normUrl(u.toString())]); setExtra("");
    } catch { setError("That isn't a valid URL."); }
  }

  async function run() {
    if (!siteUrl || selected.length === 0) return;
    setBusy(true);
    setError(null);
    const modes: ("mobile" | "desktop")[] = strategy === "both" ? ["mobile", "desktop"] : [strategy];
    const jobs = selected.flatMap((url) => modes.map((m) => ({ url, m })));
    try {
      // One page per request: each takes ~20s and hosted functions are capped at 60s.
      for (const [i, j] of jobs.entries()) {
        setProgress(`${i + 1} of ${jobs.length}`);
        const r = await seoFetch<{ pagespeed: PageSpeedResult[] }>("/api/seo/pagespeed", {
          method: "POST",
          body: JSON.stringify({ urls: [j.url], strategy: j.m }),
        });
        onChange(r.pagespeed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "PageSpeed failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Core Web Vitals & speed"
        subtitle={`Google PageSpeed Insights (free). Choose up to ${MAX_PAGES} pages; each takes ~20s per device.${hasKey ? "" : " No PAGESPEED_API_KEY set — works, but Google may rate-limit the shared quota."}`}
        action={
          <div className="flex items-center gap-2">
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as "mobile" | "desktop" | "both")}
              className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs"
              aria-label="Device"
            >
              <option value="mobile">Mobile</option>
              <option value="desktop">Desktop</option>
              <option value="both">Both</option>
            </select>
            <RunButton onClick={run} busy={busy} disabled={!siteUrl || selected.length === 0}>
              {busy ? `Testing ${progress ?? ""}` : `Test ${selected.length} page${selected.length === 1 ? "" : "s"}`}
            </RunButton>
          </div>
        }
      >
        <div className="mb-4">
          <button type="button" onClick={() => setOpen(!open)} className="text-sm text-accent hover:underline">
            {open ? "Hide page list" : `Choose pages (${selected.length} selected)`}
          </button>
          {open && (
            <div className="mt-3 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter pages…" className="rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent" />
                <button type="button" onClick={() => setSel(defaults)} className="rounded-lg border border-border px-2.5 py-1.5 hover:bg-surface-2">Home + top 4</button>
                <button type="button" onClick={() => setSel([])} className="rounded-lg border border-border px-2.5 py-1.5 hover:bg-surface-2">Clear</button>
                <span className="text-muted">{selected.length}/{MAX_PAGES} selected</span>
              </div>
              <div className="mt-3 max-h-64 overflow-y-auto">
                {candidates.filter((c) => !filter || c.url.toLowerCase().includes(filter.toLowerCase())).map((c) => {
                  const on = selected.includes(c.url);
                  const tested = results.some((r) => normUrl(r.url) === c.url);
                  return (
                    <label key={c.url} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-2">
                      <input type="checkbox" checked={on} disabled={!on && selected.length >= MAX_PAGES} onChange={() => toggle(c.url)} />
                      <span className="min-w-0 flex-1 truncate">{pathOf(c.url)}</span>
                      <span className="shrink-0 text-xs text-muted">{c.note}{tested ? " · tested" : ""}</span>
                    </label>
                  );
                })}
                {candidates.length === 0 && <p className="text-sm text-muted">No pages yet — run a site audit first, or add one below.</p>}
              </div>
              <div className="mt-3 flex gap-2">
                <input value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addExtra()} placeholder="Add a page URL on your site…" className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent" />
                <button type="button" onClick={addExtra} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">Add</button>
              </div>
            </div>
          )}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {(() => {
          const reasons = Array.from(new Set(results.filter((r) => r.error).map((r) => r.error as string)));
          if (!reasons.length) return null;
          const quota = reasons.some((m) => /quota|429|rate/i.test(m));
          return (
            <ErrorNote>
              {`PageSpeed failed: ${reasons.slice(0, 2).join(" | ")}`}
              {quota || !hasKey ? " — Google's shared PageSpeed quota is often used up. Add a free PAGESPEED_API_KEY (Google Cloud → enable “PageSpeed Insights API” → create an API key) to your environment variables and redeploy." : ""}
            </ErrorNote>
          );
        })()}
        {results.length === 0 && !busy && <p className="text-sm text-muted">No results yet.</p>}
        {results.length > 0 && (
          <DataTable<PageSpeedResult>
            rows={results}
            rowKey={(r) => `${r.strategy}|${r.url}`}
            compact
            filters={[{ key: "strategy", label: "Devices", getValue: (r) => r.strategy }]}
            columns={[
              col<PageSpeedResult>("url", "URL", (r) => r.url, (r) => <UrlLink url={r.url} max={40} />),
              col<PageSpeedResult>("strategy", "Device", (r) => r.strategy),
              num<PageSpeedResult>("perf", "Performance", (r) => r.performance, (r) => (r.error ? <span title={r.error}><Pill tone="error">error</Pill></span> : score(r.performance))),
              num<PageSpeedResult>("seo", "SEO", (r) => r.seo, (r) => score(r.seo)),
              num<PageSpeedResult>("a11y", "Accessibility", (r) => r.accessibility, (r) => score(r.accessibility)),
              num<PageSpeedResult>("bp", "Best practices", (r) => r.bestPractices, (r) => score(r.bestPractices)),
              num<PageSpeedResult>("lcp", "LCP (s)", (r) => sec(r.lcpMs), undefined, { firstDir: "asc" }),
              num<PageSpeedResult>("cls", "CLS", (r) => r.cls, (r) => <span className="text-muted">{r.cls === null ? "—" : r.cls.toFixed(3)}</span>, { firstDir: "asc" }),
              num<PageSpeedResult>("tbt", "TBT (ms)", (r) => (r.tbtMs === null ? null : Math.round(r.tbtMs)), undefined, { firstDir: "asc" }),
              col<PageSpeedResult>("field", "Real users", (r) => r.fieldCategory, (r) =>
                r.fieldCategory ? <Pill tone={r.fieldCategory === "FAST" ? "good" : r.fieldCategory === "AVERAGE" ? "warning" : "error"}>{r.fieldCategory.toLowerCase()}</Pill> : <span className="text-muted" title="Not enough Chrome-user traffic for field data">n/a</span>
              ),
            ]}
          />
        )}
        {results.some((r) => r.opportunities.length > 0) && (
          <div className="mt-5 border-t border-border pt-4">
            <h4 className="mb-2 text-sm font-medium">Biggest fixes</h4>
            <ul className="space-y-2 text-sm">
              {results
                .filter((r) => r.opportunities.length > 0)
                .map((r) => (
                  <li key={`${r.strategy}|${r.url}`}>
                    <UrlLink url={r.url} max={60} /> <span className="text-xs text-muted">({r.strategy})</span>
                    <ul className="mt-0.5 list-disc pl-5 text-muted">
                      {r.opportunities.map((o) => (
                        <li key={o.title}>
                          {o.title}
                          {o.savings && <span className="text-xs"> — {o.savings}</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
