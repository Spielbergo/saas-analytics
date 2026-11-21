"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { seoFetch } from "@/lib/seoClient";
import { useDashboard } from "@/lib/DashboardContext";
import { useDateRange } from "@/lib/DateRangeContext";
import { SeriesChart } from "@/components/SeriesChart";
import { CopyButton } from "@/components/CopyButton";
import { Card, ErrorNote, Mini, Notice, Pill, RunButton } from "@/components/seo/common";
import { dailySeries, evaluate, peopleFrom, VERDICT_TEXT, type Evaluation, type Experiment, type Verdict } from "@/lib/experiments";
import { addDays } from "@/lib/dates";
import { funnelIn, startBreakdown } from "@/lib/onboarding";
import { FunnelTable, StartTable } from "@/components/FunnelPanel";
import type { Annotation } from "@/lib/adminTypes";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
const money = (n: number | null) => (n === null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const rate = (n: number) => n.toFixed(2);
const TONE: Record<Verdict, string> = { helping: "good", possibly_helping: "good", no_clear_change: "neutral", possibly_hurting: "warning", hurting: "error", too_early: "neutral", no_data: "neutral" };
const inputCls = "rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent";

export default function ExperimentsPage() {
  const { metrics } = useDashboard();
  const { range } = useDateRange();
  const [exps, setExps] = useState<Experiment[] | null>(null);
  const [quickNotes, setQuickNotes] = useState<Annotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginDays, setLoginDays] = useState<Record<string, string[]> | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, t] = await Promise.all([
        seoFetch<{ experiments: Experiment[] }>("/api/experiments"),
        seoFetch<{ annotations: Annotation[] }>("/api/trends").catch(() => ({ annotations: [] as Annotation[] })),
      ]);
      setExps(e.experiments); setQuickNotes(t.annotations); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load tests"); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    seoFetch<{ available: boolean; days: Record<string, string[]> }>("/api/login-days").then((r) => setLoginDays(r.available ? r.days : null)).catch(() => {});
  }, []);

  async function send(body: object): Promise<boolean> {
    setBusy(true); setError(null);
    try { const r = await seoFetch<{ experiments: Experiment[] }>("/api/experiments", { method: "POST", body: JSON.stringify(body) }); setExps(r.experiments); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); return false; }
    finally { setBusy(false); }
  }

  const t = today();
  const people = useMemo(() => (metrics ? peopleFrom(metrics.subscriberList, loginDays) : []), [metrics, loginDays]);
  const evals = useMemo(() => new Map((exps ?? []).map((x) => [x.id, evaluate(x, exps ?? [], people, t)])), [exps, people, t]);

  // Chart window: the global range, else from the first signup (max 1 year).
  const first = people.reduce((m, p) => (p.joinedAt.slice(0, 10) < m ? p.joinedAt.slice(0, 10) : m), t);
  const from = range.from ?? (first < addDays(t, -364) ? addDays(t, -364) : first);
  const to = range.to ?? t;
  const rows = useMemo(() => (people.length ? dailySeries(people, from, to) : []), [people, from, to]);

  const marks: Annotation[] = useMemo(() => {
    const m: Annotation[] = [...quickNotes];
    for (const x of exps ?? []) {
      m.push({ id: `s${x.id}`, day: x.startDate, label: `▶ ${x.name}` });
      if (x.endDate) m.push({ id: `e${x.id}`, day: x.endDate, label: `■ ${x.name}` });
      for (const n of x.notes) m.push({ id: n.id, day: n.day, label: `${x.name}: ${n.text}` });
    }
    return m;
  }, [exps, quickNotes]);

  const ordered = useMemo(() => [...(exps ?? [])].sort((a, b) => Number(evals.get(b.id)?.running) - Number(evals.get(a.id)?.running) || b.startDate.localeCompare(a.startDate)), [exps, evals]);

  const exportText = () => ordered.map((x) => summarize(x, evals.get(x.id)!)).join("\n\n");

  if (!metrics) return null;
  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Card title="Subscribers & what you changed" subtitle={`Every test, note and event below is marked on the charts so you can see what moved when. Showing ${range.isAll ? "the last year at most" : range.label.toLowerCase()}.`}>
        {rows.length === 0 ? <p className="text-sm text-muted">No signup data yet.</p> : (
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-1 text-xs text-muted">Total subscribers (everyone who has signed up)</p>
              <SeriesChart data={rows} annotations={marks} series={[{ key: "total", label: "Total signups", color: "accent" }]} />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted">Signups per day (with 7-day average)</p>
              <SeriesChart data={rows} annotations={marks} height={200} series={[
                { key: "signups", label: "Signups", color: "muted" },
                { key: "avg7", label: "7-day average", color: "success" },
              ]} />
            </div>
          </div>
        )}
        <QuickNote onAdded={load} />
      </Card>

      <StartingPoints people={people} from={range.from ?? "0000-01-01"} to={range.to ?? t} today={t} status={metrics.startPointStatus} rangeLabel={range.label} loginBasis={loginDays ? "login history" : "last login"} />

      <NewTest busy={busy} onCreate={(e) => send({ action: "create", experiment: e })} />

      {exps && exps.length === 0 && <Notice>No tests yet. Add one when you start something new — a listing, an ad, a post, a price change — and the dashboard will compare signups before and during.</Notice>}

      {ordered.length > 0 && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Tests ({ordered.length})</h2>
          <CopyButton getText={exportText} label="Copy summary" />
        </div>
      )}
      {ordered.map((x) => <ExperimentCard key={x.id} x={x} ev={evals.get(x.id)!} busy={busy} send={send} />)}
      <p className="text-xs text-muted">
        How to read this: each test compares signups per day during the test with the same number of days right before it. &ldquo;Helping&rdquo; or &ldquo;hurting&rdquo; needs a difference big enough that chance alone is unlikely; with a small number of signups most results will say &ldquo;no clear change&rdquo;. It can&rsquo;t prove cause — seasonality, other tests and word of mouth all move signups too, which is why overlaps are flagged. Direct credit counts signups whose source or campaign mentions the service.
      </p>
    </>
  );
}

function summarize(x: Experiment, ev: Evaluation): string {
  return [
    `${x.name}${x.category ? ` (${x.category})` : ""} — ${x.startDate} → ${x.endDate ?? "running"} · ${VERDICT_TEXT[ev.verdict]}`,
    `Signups/day: ${rate(ev.perDayBefore)} before → ${rate(ev.perDayDuring)} during${ev.changePct !== null ? ` (${ev.changePct >= 0 ? "+" : ""}${Math.round(ev.changePct * 100)}%)` : ""}; directly credited: ${ev.attributed}; paid from window: ${ev.during.paid}; cost: ${money(ev.totalCost)}`,
    ...x.notes.map((n) => `  ${n.day}: ${n.text}`),
  ].join("\n");
}

function QuickNote({ onAdded }: { onAdded: () => void }) {
  const [day, setDay] = useState(today());
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!label.trim()) return;
    setBusy(true);
    await seoFetch("/api/annotations", { method: "POST", body: JSON.stringify({ day, label }) }).catch(() => {});
    setLabel(""); setBusy(false); onAdded();
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm">
      <span className="text-muted">Quick note on the chart:</span>
      <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputCls} />
      <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. Emailed beta list" className={`${inputCls} min-w-[14rem] flex-1`} />
      <RunButton onClick={add} busy={busy} disabled={!label.trim()}>Add</RunButton>
    </div>
  );
}

function NewTest({ busy, onCreate }: { busy: boolean; onCreate: (e: object) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", category: "", startDate: today(), endDate: "", monthlyCost: "", matchTerms: "", goal: "", focus: "signups" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit() {
    const ok = await onCreate({ ...f, endDate: f.endDate || null, monthlyCost: f.monthlyCost === "" ? null : Number(f.monthlyCost) });
    if (ok) { setF({ name: "", category: "", startDate: today(), endDate: "", monthlyCost: "", matchTerms: "", goal: "", focus: "signups" }); setOpen(false); }
  }
  return (
    <Card title="Track a service or change" subtitle="HeyCatch, a directory listing, an ad campaign, a pricing change — anything you want to judge by its effect on signups."
      action={<RunButton onClick={() => setOpen((o) => !o)}><Plus size={14} /> {open ? "Close" : "New test"}</RunButton>}>
      {open && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">Name<input value={f.name} onChange={set("name")} placeholder="HeyCatch" className={inputCls} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Category (anything)<input value={f.category} onChange={set("category")} placeholder="Directory, Ads, Pricing…" className={inputCls} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Started<input type="date" value={f.startDate} onChange={set("startDate")} className={inputCls} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Ended (leave blank while running)<input type="date" value={f.endDate} onChange={set("endDate")} className={inputCls} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Cost per month, $ (optional)<input type="number" min="0" value={f.monthlyCost} onChange={set("monthlyCost")} className={inputCls} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Words that tag its signups (optional)<input value={f.matchTerms} onChange={set("matchTerms")} placeholder="heycatch, hey-catch" className={inputCls} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">What are you trying to move?
            <select value={f.focus} onChange={set("focus")} className={inputCls}>
              <option value="signups">More signups (ads, listings, posts…)</option>
              <option value="activation">Better activation — what new signups do (onboarding, sample data, emails…)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">What you hope it does<input value={f.goal} onChange={set("goal")} placeholder="+10 signups a month" className={inputCls} /></label>
          <div className="sm:col-span-2"><RunButton onClick={submit} busy={busy} disabled={!f.name.trim()}><FlaskConical size={14} /> Start tracking</RunButton></div>
          <p className="text-xs text-muted sm:col-span-2">Tip: use links with <code>?utm_source=heycatch</code> wherever the service lets you, so signups can be credited directly. Matching looks at each signup&rsquo;s source, campaign and first-touch text.</p>
        </div>
      )}
    </Card>
  );
}

function ExperimentCard({ x, ev, busy, send }: { x: Experiment; ev: Evaluation; busy: boolean; send: (b: object) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const [noteDay, setNoteDay] = useState(today());
  const delta = ev.changePct;
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{x.name}</h3>
        {x.category && <Pill>{x.category}</Pill>}
        <Pill tone={ev.running ? "notice" : "neutral"}>{ev.running ? "running" : "ended"}</Pill>
        {x.focus === "activation"
          ? <><Pill tone={TONE[ev.activationVerdict]}>Activation: {VERDICT_TEXT[ev.activationVerdict]}</Pill><Pill>aimed at activation</Pill></>
          : <Pill tone={TONE[ev.verdict]}>{VERDICT_TEXT[ev.verdict]}</Pill>}
        <span className="text-xs text-muted">{x.startDate} → {x.endDate ?? "now"} · {ev.days} days</span>
        <span className="ml-auto flex gap-2">
          {ev.running && <RunButton onClick={() => { send({ action: "update", id: x.id, experiment: { endDate: today() } }); }} disabled={busy}>End today</RunButton>}
          <button title="Delete test" disabled={busy} onClick={() => { if (window.confirm(`Delete "${x.name}" and its notes?`)) send({ action: "delete", id: x.id }); }} className="rounded-lg border border-border p-1.5 text-muted hover:text-danger"><Trash2 size={14} /></button>
        </span>
      </div>
      {x.goal && <p className="mt-1 text-xs text-muted">Goal: {x.goal}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Signups / day" value={`${rate(ev.perDayBefore)} → ${rate(ev.perDayDuring)}`} sub={`before (${ev.beforeDays}d) → during`} tone={delta === null ? undefined : delta > 0.1 ? "good" : delta < -0.1 ? "bad" : undefined} />
        <Mini label="Change" value={delta === null ? "n/a" : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%`} sub={`${ev.before.signups} → ${ev.during.signups} signups`} />
        <Mini label="Credited directly" value={ev.attributed} sub={ev.attributed ? `${ev.attributedPaid} paid` : "no tagged signups"} />
        <Mini label={x.monthlyCost ? "Cost per signup" : "Paid from window"} value={x.monthlyCost ? money(ev.costPerSignup) : ev.during.paid} sub={x.monthlyCost ? `${money(ev.totalCost)} spent · ${money(ev.costPerPaid)} / paid` : `${ev.during.activated} activated`} />
      </div>
      <details className="mt-4" open={x.focus === "activation"}>
        <summary className="cursor-pointer text-xs font-medium text-muted hover:text-text">What new signups did — before vs during{ev.activationZ !== null ? ` · activation ${ev.activationZ > 0 ? "up" : "down"} (z ${ev.activationZ.toFixed(1)})` : ""}</summary>
        <div className="mt-2 flex flex-col gap-4">
          <FunnelTable before={ev.funnel.before} during={ev.funnel.during} beforeLabel={`Before (${ev.beforeFrom.slice(5)} → ${ev.beforeTo.slice(5)})`} duringLabel={`During (${ev.from.slice(5)} → ${ev.to.slice(5)})`} />
          {ev.starts.during.some((r) => r.point !== "none") && <StartTable rows={ev.starts.during} />}
        </div>
      </details>
      {ev.after && <p className="mt-3 text-xs text-muted">After it ended ({ev.after.days} days): {rate(ev.after.perDay)} signups/day — compare with {rate(ev.perDayDuring)} during.</p>}
      {ev.caveats.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs text-warning">{ev.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>}

      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-2 text-xs font-medium text-muted">Notes</p>
        {x.notes.length === 0 && <p className="text-xs text-muted">No notes yet.</p>}
        <ul className="flex flex-col gap-1.5">
          {x.notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 text-sm">
              <span className="w-24 shrink-0 text-xs text-muted">{n.day}</span>
              <span className="flex-1">{n.text}</span>
              <button title="Delete note" onClick={() => send({ action: "deleteNote", id: x.id, noteId: n.id })} className="text-muted hover:text-danger"><Trash2 size={12} /></button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <input type="date" value={noteDay} onChange={(e) => setNoteDay(e.target.value)} className={inputCls} />
          <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && note.trim()) { if (await send({ action: "addNote", id: x.id, note: { day: noteDay, text: note } })) setNote(""); } }} placeholder="Add a note (changed the listing, got featured, paused…)" className={`${inputCls} min-w-[14rem] flex-1`} />
          <RunButton onClick={async () => { if (await send({ action: "addNote", id: x.id, note: { day: noteDay, text: note } })) setNote(""); }} disabled={!note.trim() || busy}>Add note</RunButton>
        </div>
      </div>
    </div>
  );
}

function StartingPoints({ people, from, to, today, status, rangeLabel, loginBasis }: { people: ReturnType<typeof peopleFrom>; from: string; to: string; today: string; status: "not_configured" | "column_missing" | "ok"; rangeLabel: string; loginBasis: string }) {
  const counts = useMemo(() => funnelIn(people, from, to, today), [people, from, to, today]);
  const starts = useMemo(() => startBreakdown(people, from, to, today), [people, from, to, today]);
  return (
    <Card title="What people do after signing up" subtitle={`Everyone who signed up in ${rangeLabel.toLowerCase()}: where they go first and whether they stick. "Came back" uses ${loginBasis}. Use this to see what people expect NorthBooks to do when they arrive.`}>
      {status !== "ok" && (
        <Notice>
          {status === "column_missing"
            ? <>The column named in <code>ONBOARDING_START_COLUMN</code> wasn&rsquo;t found on <code>profiles</code>. </>
            : <>The starting point they choose isn&rsquo;t being recorded yet. </>}
          The new onboarding has to save it (one column, one line of code) — see <code>docs/onboarding-start.md</code>. Everything else below already works.
        </Notice>
      )}
      {counts.n === 0 ? <p className="text-sm text-muted">No signups in this range.</p> : (
        <div className="flex flex-col gap-5">
          <FunnelTable before={null} during={counts} duringLabel="Signups" />
          {status === "ok" && <StartTable rows={starts} />}
        </div>
      )}
    </Card>
  );
}
