"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Upload, Plus, Trash2, ExternalLink } from "lucide-react";
import { seoFetch } from "@/lib/seoClient";
import { useDashboard } from "@/lib/DashboardContext";
import { useDateRange } from "@/lib/DateRangeContext";
import { DataTable } from "@/components/DataTable";
import { SeriesChart } from "@/components/SeriesChart";
import { Card, ErrorNote, Mini, Notice, Pill, RunButton, col } from "@/components/seo/common";
import { engagement, engagementRate, signupsAfter, sourceMentions } from "@/lib/social/parse";
import { peopleFrom } from "@/lib/experiments";
import type { Network, SocialData, SocialPost } from "@/lib/social/types";

const NET_LABEL: Record<Network, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" };
const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString());
const inputCls = "rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent";

type Row = SocialPost & { eng: number; rate: number | null; after: number };

export default function SocialPage() {
  const { metrics } = useDashboard();
  const { within, range } = useDateRange();
  const [data, setData] = useState<SocialData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await seoFetch<SocialData>("/api/social")); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load social data"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function post<T extends { data?: SocialData }>(body: object, which: string): Promise<T | null> {
    setBusy(which); setError(null); setMsg(null);
    try { const r = await seoFetch<T>("/api/social", { method: "POST", body: JSON.stringify(body) }); if (r.data) setData(r.data); return r; }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); return null; }
    finally { setBusy(null); }
  }

  async function sync() {
    const r = await post<{ errors: string[]; fetched: number; data: SocialData }>({ action: "sync" }, "sync");
    if (r) setMsg(`Fetched ${r.fetched} posts${r.errors.length ? ` — ${r.errors.length} problem(s), see below` : ""}.`);
    if (r?.errors.length) setError(r.errors.join("\n"));
  }

  const people = useMemo(() => (metrics ? peopleFrom(metrics.subscriberList) : []), [metrics]);
  const joinedDays = useMemo(() => people.map((p) => p.joinedAt.slice(0, 10)), [people]);

  const rows: Row[] = useMemo(
    () => (data?.posts ?? []).filter((p) => within(p.postedAt)).map((p) => ({ ...p, eng: engagement(p), rate: engagementRate(p), after: signupsAfter(p.postedAt, joinedDays) })),
    [data, within, joinedDays]
  );

  // Weekly engagement by network for the chart.
  const weekly = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>();
    for (const r of rows) {
      const d = new Date(r.postedAt); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const wk = d.toISOString().slice(0, 10);
      const row = map.get(wk) ?? { day: wk, facebook: 0, instagram: 0, linkedin: 0 };
      row[r.network] = (row[r.network] as number) + r.eng;
      map.set(wk, row);
    }
    return [...map.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  }, [rows]);

  // Signups credited to each network via utm/source text (in range).
  const credited = useMemo(() => {
    const c: Record<Network, number> = { facebook: 0, instagram: 0, linkedin: 0 };
    for (const p of people) if (within(p.joinedAt)) for (const n of Object.keys(c) as Network[]) if (sourceMentions(p.sourceText, n)) c[n]++;
    return c;
  }, [people, within]);

  if (!data) return error ? <ErrorNote>{error}</ErrorNote> : <p className="text-sm text-muted">Loading…</p>;

  const accounts = data.accounts;
  return (
    <>
      {error && <ErrorNote><span className="whitespace-pre-line">{error}</span></ErrorNote>}
      {!data.configured.meta && (
        <Notice>Facebook and Instagram aren&rsquo;t connected yet. Add <code>META_PAGE_TOKENS</code> to <code>.env.local</code> (README → Social has the 10-minute setup), restart, and press Sync. LinkedIn works now via import below.</Notice>
      )}

      <Card
        title="Accounts"
        subtitle={`${data.syncedAt ? `Last synced ${new Date(data.syncedAt).toLocaleString()}` : "Not synced yet"}. Facebook and Instagram sync from Meta (also daily from cron); LinkedIn comes from imports.`}
        action={<RunButton onClick={sync} busy={busy === "sync"} disabled={!data.configured.meta}><RefreshCw size={14} /> Sync Meta now</RunButton>}
      >
        {accounts.length === 0 ? <p className="text-sm text-muted">No accounts yet.</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <div key={a.key} className="rounded-xl border border-border bg-bg p-3 text-sm">
                <div className="flex items-center gap-2"><Pill tone={a.error ? "error" : "good"}>{NET_LABEL[a.network as Network]}</Pill><span className="font-medium">{a.name}</span></div>
                {a.username && <p className="text-xs text-muted">@{a.username}</p>}
                <p className="mt-2 text-xs text-muted">{fmt(a.followers)} followers · {a.posts} posts held</p>
                {a.error && <p className="mt-1 text-xs text-danger">{a.error}</p>}
                {a.insightsNote && <p className="mt-1 text-xs text-muted">{a.insightsNote}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="At a glance" subtitle={`Posts in ${range.label.toLowerCase()}. “Credited signups” counts people whose signup source or campaign mentions the network — use ?utm_source=facebook / instagram / linkedin in your links.`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Mini label="Posts" value={rows.length} />
          <Mini label="Views" value={fmt(rows.reduce((n, r) => n + (r.views ?? 0), 0))} />
          <Mini label="Engagements" value={fmt(rows.reduce((n, r) => n + r.eng, 0))} />
          {(["facebook", "instagram", "linkedin"] as Network[]).map((n) => <Mini key={n} label={`${NET_LABEL[n]} signups`} value={credited[n]} sub="credited" />)}
        </div>
        {weekly.length > 1 && (
          <div className="mt-4">
            <p className="mb-1 text-xs text-muted">Engagements per week (reactions + comments + shares + saves + clicks)</p>
            <SeriesChart data={weekly} height={200} series={[
              { key: "facebook", label: "Facebook", color: "accent" },
              { key: "instagram", label: "Instagram", color: "warning" },
              { key: "linkedin", label: "LinkedIn", color: "success" },
            ]} />
          </div>
        )}
      </Card>

      <Card title="Posts" subtitle="“Signups 48h after” counts signups that joined in the two days after the post — a hint, not proof, and it blurs when you post often. Use the Tests tab for bigger efforts.">
        <DataTable<Row>
          rows={rows} rowKey={(r) => r.id} compact maxHeight={560} csvName="social-posts" viewsKey="social-posts"
          initialSort={{ key: "date", dir: "desc" }}
          searchText={(r) => `${r.text} ${r.account} ${r.type}`}
          filters={[
            { key: "network", label: "Networks", getValue: (r) => NET_LABEL[r.network] },
            { key: "account", label: "Accounts", getValue: (r) => r.account },
            { key: "type", label: "Types", getValue: (r) => r.type },
          ]}
          columns={[
            col<Row>("date", "Posted", (r) => r.postedAt, (r) => r.postedAt.slice(0, 10), { firstDir: "desc" }),
            col<Row>("net", "Network", (r) => r.network, (r) => <span>{NET_LABEL[r.network]} <span className="text-muted">· {r.account}</span></span>),
            col<Row>("text", "Post", (r) => r.text, (r) => <span className="line-clamp-2 max-w-[22rem] text-xs">{r.text || <span className="text-muted">(no text)</span>}</span>),
            col<Row>("type", "Type", (r) => r.type),
            col<Row>("views", "Views", (r) => r.views ?? -1, (r) => fmt(r.views), { firstDir: "desc" }),
            col<Row>("reach", "Reach", (r) => r.reach ?? -1, (r) => fmt(r.reach), { firstDir: "desc" }),
            col<Row>("react", "Reactions", (r) => r.reactions ?? -1, (r) => fmt(r.reactions), { firstDir: "desc" }),
            col<Row>("com", "Comments", (r) => r.comments ?? -1, (r) => fmt(r.comments), { firstDir: "desc" }),
            col<Row>("sh", "Shares", (r) => r.shares ?? -1, (r) => fmt(r.shares), { firstDir: "desc" }),
            col<Row>("sv", "Saves", (r) => r.saves ?? -1, (r) => fmt(r.saves), { firstDir: "desc" }),
            col<Row>("cl", "Clicks", (r) => r.clicks ?? -1, (r) => fmt(r.clicks), { firstDir: "desc" }),
            col<Row>("rate", "Eng. rate", (r) => r.rate ?? -1, (r) => (r.rate === null ? "—" : `${(r.rate * 100).toFixed(1)}%`), { firstDir: "desc" }),
            col<Row>("after", "Signups 48h after", (r) => r.after, (r) => r.after, { firstDir: "desc" }),
            col<Row>("link", "", (r) => r.url ?? "", (r) => (
              <span className="flex items-center gap-2">
                {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-muted hover:text-text" title="Open post"><ExternalLink size={13} /></a>}
                {r.source !== "api" && <button title="Remove this post" onClick={() => { if (window.confirm("Remove this post from the dashboard?")) post({ action: "delete", id: r.id }, "del"); }} className="text-muted hover:text-danger"><Trash2 size={13} /></button>}
              </span>
            )),
          ]}
        />
      </Card>

      <LinkedInImport busy={busy} onImport={async (account, src) => {
        const r = await post<{ imported: number; skipped: number; sheets?: string[]; data: SocialData }>({ action: "importLinkedIn", account, ...(src.xlsxBase64 ? { xlsxBase64: src.xlsxBase64 } : { csv: src.csv }) }, "li");
        if (r) setMsg(`Imported ${r.imported} LinkedIn posts${r.sheets?.length ? ` from ${r.sheets.join(" + ")}` : ""}${r.skipped ? ` (${r.skipped} rows skipped)` : ""}.`);
        return !!r;
      }} onManual={async (p) => !!(await post({ action: "addManual", post: p }, "manual"))} />
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </>
  );
}

function LinkedInImport({ busy, onImport, onManual }: { busy: string | null; onImport: (account: string, src: { csv?: string; xlsxBase64?: string }) => Promise<boolean>; onManual: (p: object) => Promise<boolean> }) {
  const [account, setAccount] = useState("NorthBooks");
  const [csv, setCsv] = useState("");
  const [xlsx, setXlsx] = useState<{ name: string; b64: string } | null>(null);
  const [m, setM] = useState({ network: "linkedin", account: "NorthBooks", date: new Date().toISOString().slice(0, 10), text: "", url: "", views: "", reactions: "", comments: "", shares: "", clicks: "" });
  const setMF = (k: keyof typeof m) => (e: { target: { value: string } }) => setM({ ...m, [k]: e.target.value });

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      setXlsx({ name: f.name, b64: btoa(bin) }); setCsv("");
    } else { setXlsx(null); setCsv(await f.text()); }
  }

  return (
    <Card title="LinkedIn (import) and manual posts" subtitle="LinkedIn doesn't let apps read this data without a lengthy approval (and never for personal profiles), so download the analytics export from LinkedIn (the Excel file with its two tabs works as-is) and import it here. Re-importing the same file is safe — posts are matched, not duplicated.">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted">Account</label>
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="NorthBooks or Scott" className={`${inputCls} w-48`} />
          {xlsx && <span className="text-xs text-muted">{xlsx.name} ready</span>}
          <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" onChange={(e) => onFile(e.target.files?.[0])} className="text-xs text-muted" />
        </div>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} placeholder="…or paste the exported rows here (tab-separated or CSV, header row included)" className="w-full rounded-lg border border-border bg-bg p-3 font-mono text-xs outline-none focus:border-accent" />
        <div><RunButton onClick={async () => { if (await onImport(account, xlsx ? { xlsxBase64: xlsx.b64 } : { csv })) { setCsv(""); setXlsx(null); } }} busy={busy === "li"} disabled={(!csv.trim() && !xlsx) || !account.trim()}><Upload size={14} /> Import</RunButton></div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-text">Add a single post by hand (any network)</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <select value={m.network} onChange={setMF("network")} className={inputCls}><option value="linkedin">LinkedIn</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option></select>
            <input value={m.account} onChange={setMF("account")} placeholder="Account" className={inputCls} />
            <input type="date" value={m.date} onChange={setMF("date")} className={inputCls} />
            <input value={m.url} onChange={setMF("url")} placeholder="Post link" className={inputCls} />
            <input value={m.text} onChange={setMF("text")} placeholder="What you posted" className={`${inputCls} sm:col-span-4`} />
            {(["views", "reactions", "comments", "shares", "clicks"] as const).map((k) => <input key={k} type="number" min="0" value={m[k]} onChange={setMF(k)} placeholder={k[0].toUpperCase() + k.slice(1)} className={inputCls} />)}
            <RunButton onClick={() => onManual(m)} busy={busy === "manual"} disabled={!m.account.trim()}><Plus size={14} /> Add post</RunButton>
          </div>
        </details>
      </div>
    </Card>
  );
}
