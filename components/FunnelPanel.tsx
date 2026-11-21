"use client";

import { pct, START_POINTS, type FunnelCounts, type StartRow } from "@/lib/onboarding";

const P = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const label = (id: string) => START_POINTS.find((s) => s.id === id)?.label ?? "Not recorded";

type Step = { key: string; label: string; get: (c: FunnelCounts) => { n: number | null; of: number }; goodWhenLower?: boolean; hint?: string };

const STEPS: Step[] = [
  { key: "signed", label: "Signed up", get: (c) => ({ n: c.n, of: c.n }) },
  { key: "chose", label: "Chose a starting point", get: (c) => ({ n: c.chose, of: c.n }), hint: "Needs the starting point recorded by the app" },
  { key: "did", label: "Did something (company, products, or any task)", get: (c) => ({ n: c.didSomething, of: c.n }) },
  { key: "act", label: "Activated (invoice, expense or bank statement)", get: (c) => ({ n: c.activated, of: c.n }) },
  { key: "back", label: "Came back within 7 days", get: (c) => ({ n: c.cameBack, of: c.matured }), hint: "Only signups at least 7 days old" },
  { key: "paid", label: "Paid", get: (c) => ({ n: c.paid, of: c.n }), hint: "Paying today (not necessarily within 7 days)" },
  { key: "gone", label: "Disappeared (did nothing, never came back)", get: (c) => ({ n: c.disappeared, of: c.matured }), goodWhenLower: true, hint: "Only signups at least 7 days old" },
];

function Cell({ n, of }: { n: number | null; of: number }) {
  if (n === null) return <span className="text-muted">n/a</span>;
  return <span>{n} <span className="text-muted">({P(pct(n, of))})</span></span>;
}

export function FunnelTable({ before, during, beforeLabel = "Before", duringLabel = "During" }: { before: FunnelCounts | null; during: FunnelCounts; beforeLabel?: string; duringLabel?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1 pr-3 font-medium">Step</th>
            {before && <th className="px-2 py-1 font-medium">{beforeLabel}</th>}
            <th className="px-2 py-1 font-medium">{duringLabel}</th>
            {before && <th className="px-2 py-1 font-medium">Change</th>}
          </tr>
        </thead>
        <tbody>
          {STEPS.map((s) => {
            const d = s.get(during);
            const b = before ? s.get(before) : null;
            const dp = pct(d.n, d.of), bp = b ? pct(b.n, b.of) : null;
            const delta = dp !== null && bp !== null ? (dp - bp) * 100 : null;
            const good = delta === null || Math.abs(delta) < 3 ? null : (delta > 0) !== !!s.goodWhenLower;
            return (
              <tr key={s.key} className="border-t border-border">
                <td className="py-1.5 pr-3" title={s.hint}>{s.label}</td>
                {b && <td className="px-2 py-1.5"><Cell n={b.n} of={b.of} /></td>}
                <td className="px-2 py-1.5"><Cell n={d.n} of={d.of} /></td>
                {b && <td className={`px-2 py-1.5 text-xs ${good === null ? "text-muted" : good ? "text-success" : "text-danger"}`}>{s.key === "signed" || delta === null ? "—" : `${delta > 0 ? "+" : ""}${Math.round(delta)} pts`}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StartTable({ rows }: { rows: StartRow[] }) {
  const total = rows.reduce((n, r) => n + r.counts.n, 0);
  if (!total) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1 pr-3 font-medium">Starting point</th>
            <th className="px-2 py-1 font-medium">Signups</th>
            <th className="px-2 py-1 font-medium">Did something</th>
            <th className="px-2 py-1 font-medium">Activated</th>
            <th className="px-2 py-1 font-medium">Came back (7d)</th>
            <th className="px-2 py-1 font-medium">Paid</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.point} className="border-t border-border">
              <td className="py-1.5 pr-3">{label(r.point)}</td>
              <td className="px-2 py-1.5">{r.counts.n} <span className="text-muted">({P(r.counts.n / total)})</span></td>
              <td className="px-2 py-1.5">{P(pct(r.counts.didSomething, r.counts.n))}</td>
              <td className="px-2 py-1.5">{P(pct(r.counts.activated, r.counts.n))}</td>
              <td className="px-2 py-1.5">{P(pct(r.counts.cameBack, r.counts.matured))}</td>
              <td className="px-2 py-1.5">{P(pct(r.counts.paid, r.counts.n))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
