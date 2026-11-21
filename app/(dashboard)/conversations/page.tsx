"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Search, Bookmark, Check, X, RotateCcw } from "lucide-react";
import { seoFetch } from "@/lib/seoClient";
import { Card, ErrorNote, Mini, Notice, Pill, RunButton } from "@/components/seo/common";
import { SOURCE_LABEL, searchLinks, type ConvoConfig, type ConvoData, type ConvoSource, type ConvoStatus } from "@/lib/conversationsCore";

const inputCls = "rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent";
const ago = (iso: string) => { const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000)); return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export default function ConversationsPage() {
  const [data, setData] = useState<ConvoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<ConvoStatus | "open">("open");
  const [source, setSource] = useState<ConvoSource | "all">("all");
  const [log, setLog] = useState({ url: "", title: "", note: "", status: "replied" });
  const [cfg, setCfg] = useState({ queries: "", ignore: "", subs: "", min: 35 });

  const adopt = useCallback((d: ConvoData) => {
    setData(d);
    setCfg({ queries: d.config.queries.join("\n"), ignore: d.config.ignore.join("\n"), subs: d.config.subreddits.join(", "), min: d.config.minScore });
  }, []);
  useEffect(() => { seoFetch<ConvoData>("/api/conversations").then(adopt).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load")); }, [adopt]);

  async function call(which: string, path: string, init?: RequestInit) {
    setBusy(which); setError(null);
    try { adopt(await seoFetch<ConvoData>(path, init)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }
  const scan = () => call("scan", "/api/conversations?scan=1");
  const saveCfg = () => {
    const config: ConvoConfig = { queries: lines(cfg.queries), ignore: lines(cfg.ignore), subreddits: cfg.subs.split(/[,\s]+/).filter(Boolean), minScore: cfg.min };
    return call("cfg", "/api/conversations", { method: "POST", body: JSON.stringify({ action: "config", config }) });
  };
  const logIt = async () => { await call("log", "/api/conversations", { method: "POST", body: JSON.stringify({ action: "log", ...log }) }); setLog({ url: "", title: "", note: "", status: log.status }); };
  const mark = (id: string, status: ConvoStatus) => call(`m${id}`, "/api/conversations", { method: "POST", body: JSON.stringify({ action: "mark", ids: [id], status }) });

  const items = useMemo(() => (data?.items ?? []).filter((i) => (view === "open" ? i.status === "new" || i.status === "saved" : i.status === view) && (source === "all" || i.source === source)), [data, view, source]);
  const count = (s: ConvoStatus) => (data?.items ?? []).filter((i) => i.status === s).length;

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNote>{error}</ErrorNote>}
      <Card
        title="Conversations worth joining"
        subtitle="Public posts on Reddit, Hacker News, Bluesky (and Threads, if connected) where someone is asking for help you can give. This only finds them and links to them — you reply by hand. Answer the question first; mention NorthBooks only when it genuinely fits or someone asks."
        action={<RunButton onClick={scan} busy={busy === "scan"}><Search size={14} /> Scan now</RunButton>}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="To review" value={String(count("new"))} />
          <Mini label="Saved" value={String(count("saved"))} />
          <Mini label="Replied" value={String(count("replied"))} />
          <Mini label="Last scan" value={data?.scannedAt ? ago(data.scannedAt) : "never"} />
        </div>
        {data?.sources.length ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {data.sources.map((s) => (
              <Pill key={s.source} tone={s.skipped ? "neutral" : s.ok ? "good" : "error"}>
                {SOURCE_LABEL[s.source as ConvoSource]}: {s.skipped ? "off" : s.ok ? `${s.found} found` : "failed"}{s.error && !s.skipped ? ` — ${s.error}` : ""}
              </Pill>
            ))}
          </div>
        ) : null}
        {data && !data.items.length && !data.scannedAt && <p className="mt-3 text-sm text-muted">Nothing yet — press <b>Scan now</b>. It also runs once a day.</p>}
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["open", "replied", "skipped"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`rounded-lg border px-3 py-1.5 ${view === v ? "border-accent text-text" : "border-border text-muted hover:text-text"}`}>
            {v === "open" ? "To review / saved" : v === "replied" ? "Replied" : "Skipped"}
          </button>
        ))}
        <select value={source} onChange={(e) => setSource(e.target.value as ConvoSource | "all")} className={inputCls}>
          <option value="all">All sources</option>
          {(Object.keys(SOURCE_LABEL) as ConvoSource[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </select>
      </div>

      {items.length === 0 ? (
        <Notice>{data?.scannedAt ? "No posts match this view. Try lowering the minimum score or adding search phrases below." : "Run a scan to find conversations."}</Notice>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((i) => (
            <div key={i.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Pill tone={i.score >= 70 ? "good" : i.score >= 50 ? "notice" : "neutral"}>{i.score}</Pill>
                <span>{SOURCE_LABEL[i.source as ConvoSource]}{i.community ? ` · ${i.community}` : ""}</span>
                <span>· {ago(i.postedAt)}</span>
                {i.comments !== null && <span>· {i.comments} repl{i.comments === 1 ? "y" : "ies"}</span>}
                {i.mentionsYou && <Pill tone="warning">mentions you</Pill>}
                {i.status === "saved" && <Pill tone="notice">saved</Pill>}
              </div>
              <a href={i.url} target="_blank" rel="noreferrer" className="mt-1 flex items-start gap-1.5 text-sm font-medium hover:underline">
                <span className="min-w-0 break-words">{i.title}</span><ExternalLink size={13} className="mt-1 shrink-0 text-muted" />
              </a>
              {i.snippet && <p className="mt-1 line-clamp-3 text-sm text-muted">{i.snippet}</p>}
              <p className="mt-1 text-xs text-muted">Why: {i.why.join(" · ") || "—"} · found by “{i.query}”</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {i.status !== "saved" && i.status !== "replied" && <RunButton onClick={() => mark(i.id, "saved")} busy={busy === `m${i.id}`}><Bookmark size={13} /> Save for later</RunButton>}
                {i.status !== "replied" && <RunButton onClick={() => mark(i.id, "replied")} busy={busy === `m${i.id}`}><Check size={13} /> I replied</RunButton>}
                {i.status !== "skipped" && i.status !== "replied" && <RunButton onClick={() => mark(i.id, "skipped")} busy={busy === `m${i.id}`}><X size={13} /> Not relevant</RunButton>}
                {(i.status === "skipped" || i.status === "replied") && <RunButton onClick={() => mark(i.id, "new")} busy={busy === `m${i.id}`}><RotateCcw size={13} /> Put back</RunButton>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Card title="Search by hand (LinkedIn, Facebook, Threads, X, Quora)" subtitle="These networks don't allow automated search, so each of your phrases gets one-click links that open the search in your own logged-in browser, newest first. Reply there, then log it below.">
        <div className="flex flex-col gap-2">
          {(data?.config.queries ?? []).map((q) => (
            <div key={q} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 basis-48 break-words">{q}</span>
              {searchLinks(q).map((l) => (
                <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg px-2.5 py-1 text-xs hover:bg-surface-2">
                  {l.label}<ExternalLink size={11} className="text-muted" />
                </a>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs text-muted">Found or answered a post yourself? Paste its link so it's tracked with the others (and included in the export).</p>
          <div className="grid gap-2 sm:grid-cols-[2fr_2fr_2fr_auto_auto]">
            <input value={log.url} onChange={(e) => setLog({ ...log, url: e.target.value })} placeholder="https://www.linkedin.com/posts/…" className={inputCls} />
            <input value={log.title} onChange={(e) => setLog({ ...log, title: e.target.value })} placeholder="Short title (optional)" className={inputCls} />
            <input value={log.note} onChange={(e) => setLog({ ...log, note: e.target.value })} placeholder="Note (optional)" className={inputCls} />
            <select value={log.status} onChange={(e) => setLog({ ...log, status: e.target.value })} className={inputCls}><option value="replied">I replied</option><option value="saved">Save for later</option></select>
            <RunButton onClick={logIt} busy={busy === "log"} disabled={!log.url.trim()}>Log it</RunButton>
          </div>
        </div>
      </Card>

      <Card title="What to look for" subtitle="One search phrase per line. Posts are scored on how closely they match, whether they're a question, how fresh they are and how few replies they have.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">Search phrases<textarea value={cfg.queries} onChange={(e) => setCfg({ ...cfg, queries: e.target.value })} rows={7} className={`${inputCls} mt-1 w-full font-mono text-xs`} /></label>
          <label className="text-xs text-muted">Ignore posts containing (one per line)<textarea value={cfg.ignore} onChange={(e) => setCfg({ ...cfg, ignore: e.target.value })} rows={7} className={`${inputCls} mt-1 w-full font-mono text-xs`} /></label>
          <label className="text-xs text-muted">Only these subreddits (optional, comma-separated, e.g. freelance, smallbusiness, PersonalFinanceCanada)<input value={cfg.subs} onChange={(e) => setCfg({ ...cfg, subs: e.target.value })} className={`${inputCls} mt-1 w-full`} /></label>
          <label className="text-xs text-muted">Minimum score to show ({cfg.min})<input type="range" min={0} max={90} value={cfg.min} onChange={(e) => setCfg({ ...cfg, min: Number(e.target.value) })} className="mt-3 w-full" /></label>
        </div>
        <div className="mt-3"><RunButton onClick={saveCfg} busy={busy === "cfg"}>Save</RunButton></div>
      </Card>
    </div>
  );
}
