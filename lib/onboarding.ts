// Onboarding funnel maths (pure, client-safe).
// Signed up → chose a starting point → did something → activated → came back → paid.

export type StartPoint = "import" | "sample" | "company" | "invoice" | "other";

export const START_POINTS: { id: StartPoint; label: string; blurb: string }[] = [
  { id: "import", label: "Import existing data", blurb: "I already have books" },
  { id: "sample", label: "Try sample data", blurb: "Show me around" },
  { id: "company", label: "Create a company", blurb: "Set up my business" },
  { id: "invoice", label: "Create an invoice", blurb: "Get paid first" },
  { id: "other", label: "Other", blurb: "Anything else recorded" },
];

/** Map whatever the app stores in the column to one of the four starting points. */
export function normalizeStart(raw: unknown): StartPoint | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/import|upload|existing|migrate/.test(s)) return "import";
  if (/sample|demo|tour|explore|try/.test(s)) return "sample";
  if (/invoice|bill/.test(s)) return "invoice";
  if (/company|business|set.?up|new/.test(s)) return "company";
  return "other";
}

export type FunnelPerson = {
  joinedAt: string;
  start: StartPoint | null;
  didSomething: boolean; // created a company, products/projects, or any core task
  activated: boolean | null; // null = usage data not installed
  cameBack7: boolean | null; // logged in again on a later day within 7 days; null = unknown
  isPaid: boolean;
};

export type FunnelCounts = {
  n: number; // signups in the window
  chose: number; // recorded a starting point
  didSomething: number;
  activated: number | null; // null when unknown for everyone
  matured: number; // signups at least 7 days old (the only ones whose "came back" is settled)
  cameBack: number; // of matured
  disappeared: number; // of matured: did nothing and never came back
  paid: number;
};

const DAY = 86_400_000;

export function funnelIn(people: FunnelPerson[], from: string, to: string, today: string): FunnelCounts {
  const c: FunnelCounts = { n: 0, chose: 0, didSomething: 0, activated: 0, matured: 0, cameBack: 0, disappeared: 0, paid: 0 };
  let knownActivated = 0;
  const maturityCutoff = Date.parse(`${today}T00:00:00Z`) - 7 * DAY;
  for (const p of people) {
    const d = p.joinedAt.slice(0, 10);
    if (d < from || d > to) continue;
    c.n++;
    if (p.start) c.chose++;
    if (p.didSomething) c.didSomething++;
    if (p.activated !== null) { knownActivated++; if (p.activated) c.activated = (c.activated ?? 0) + 1; }
    if (p.isPaid) c.paid++;
    if (Date.parse(`${d}T00:00:00Z`) <= maturityCutoff && p.cameBack7 !== null) {
      c.matured++;
      if (p.cameBack7) c.cameBack++;
      else if (!p.didSomething) c.disappeared++;
    }
  }
  if (knownActivated === 0) c.activated = null;
  return c;
}

export type StartRow = { point: StartPoint | "none"; counts: FunnelCounts };

/** The same funnel, split by which starting point people picked ("none" = nothing recorded). */
export function startBreakdown(people: FunnelPerson[], from: string, to: string, today: string): StartRow[] {
  const ids: (StartPoint | "none")[] = ["import", "sample", "company", "invoice", "other", "none"];
  return ids
    .map((id) => ({ point: id, counts: funnelIn(people.filter((p) => (p.start ?? "none") === id), from, to, today) }))
    .filter((r) => r.counts.n > 0);
}

export const pct = (num: number | null, den: number): number | null => (num === null || den <= 0 ? null : num / den);

/** Two-proportion z (positive = "during" rate is higher). Null if either group is too small. */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number, minN = 8): number | null {
  if (n1 < minN || n2 < minN) return null;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se === 0 ? 0 : (x2 / n2 - x1 / n1) / se;
}
