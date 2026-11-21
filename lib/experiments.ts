// "Is this service helping?" — pure logic (client-safe).
// An experiment is anything you start or stop that might move signups:
// a directory listing, an ad channel, a pricing change, a blog push.
import { addDays, daysBetween } from "./dates";
import type { SubscriberRow } from "./metrics";
import { funnelIn, startBreakdown, twoProportionZ, type FunnelCounts, type FunnelPerson, type StartRow } from "./onboarding";

export type ExperimentNote = { id: string; day: string; text: string };
export type Experiment = {
  id: string;
  name: string;
  category: string; // free text: "Directory", "Ads", "Pricing"…
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // null = still running
  monthlyCost: number | null; // optional, for cost per signup
  matchTerms: string[]; // text that appears in a signup's source/campaign if it came from here
  goal: string;
  focus: "signups" | "activation"; // what the test is trying to move
  notes: ExperimentNote[];
  createdAt: string;
};

export type Person = FunnelPerson & {
  joinedAt: string;
  sourceText: string; // lead source + campaign + touch sources, lowercased
  isPaid: boolean;
  activated: boolean | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Validate untrusted input into an Experiment (throws a readable Error). */
export function cleanExperiment(input: unknown, existing?: Experiment): Experiment {
  const i = (input ?? {}) as Partial<Experiment> & { matchTerms?: unknown };
  const name = String(i.name ?? "").trim().slice(0, 80);
  if (!name) throw new Error("A name is required.");
  const startDate = String(i.startDate ?? "");
  if (!ISO.test(startDate)) throw new Error("Start date must be YYYY-MM-DD.");
  const endRaw = i.endDate ? String(i.endDate) : null;
  if (endRaw && !ISO.test(endRaw)) throw new Error("End date must be YYYY-MM-DD.");
  if (endRaw && endRaw < startDate) throw new Error("End date is before the start date.");
  const cost = i.monthlyCost === null || i.monthlyCost === undefined || i.monthlyCost === ("" as unknown) ? null : Number(i.monthlyCost);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error("Monthly cost must be a positive number.");
  const terms = (Array.isArray(i.matchTerms) ? i.matchTerms : String(i.matchTerms ?? "").split(","))
    .map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 10);
  return {
    id: existing?.id ?? newId("x"),
    name,
    category: String(i.category ?? "").trim().slice(0, 40),
    startDate, endDate: endRaw, monthlyCost: cost,
    matchTerms: terms,
    goal: String(i.goal ?? "").trim().slice(0, 200),
    focus: i.focus === "activation" ? "activation" : i.focus === "signups" ? "signups" : existing?.focus ?? "signups",
    notes: existing?.notes ?? [],
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
}

export function cleanNote(input: unknown): ExperimentNote {
  const i = (input ?? {}) as Partial<ExperimentNote>;
  const text = String(i.text ?? "").trim().slice(0, 500);
  if (!text) throw new Error("Write something in the note.");
  if (!ISO.test(String(i.day ?? ""))) throw new Error("Note date must be YYYY-MM-DD.");
  return { id: newId("n"), day: String(i.day), text };
}

// ---------- counting ----------

type Counts = { signups: number; activated: number; paid: number };
const countIn = (people: Person[], from: string, to: string): Counts => {
  const c: Counts = { signups: 0, activated: 0, paid: 0 };
  for (const p of people) {
    const d = p.joinedAt.slice(0, 10);
    if (d < from || d > to) continue;
    c.signups++;
    if (p.activated) c.activated++;
    if (p.isPaid) c.paid++;
  }
  return c;
};

export type Verdict = "helping" | "possibly_helping" | "no_clear_change" | "possibly_hurting" | "hurting" | "too_early" | "no_data";

export type Evaluation = {
  id: string;
  running: boolean;
  from: string; to: string; days: number;
  beforeFrom: string; beforeTo: string; beforeDays: number;
  during: Counts; before: Counts;
  perDayDuring: number; perDayBefore: number;
  changePct: number | null; // signups/day, during vs before
  after: { from: string; to: string; days: number; perDay: number } | null; // only for ended tests
  attributed: number; // signups whose source text mentions this service
  attributedPaid: number;
  totalCost: number | null;
  costPerSignup: number | null; costPerAttributed: number | null; costPerPaid: number | null;
  z: number | null;
  verdict: Verdict;
  funnel: { before: FunnelCounts; during: FunnelCounts };
  starts: { before: StartRow[]; during: StartRow[] };
  activationZ: number | null; // activation rate, during vs before
  activationVerdict: Verdict;
  overlaps: string[]; // names of other tests running in the same window
  caveats: string[];
};

export const VERDICT_TEXT: Record<Verdict, string> = {
  helping: "Helping",
  possibly_helping: "Possibly helping",
  no_clear_change: "No clear change",
  possibly_hurting: "Possibly hurting",
  hurting: "Hurting",
  too_early: "Too early to tell",
  no_data: "No data",
};

export function evaluate(exp: Experiment, all: Experiment[], people: Person[], today: string): Evaluation {
  const running = !exp.endDate || exp.endDate >= today;
  const to = exp.endDate && exp.endDate < today ? exp.endDate : today;
  const from = exp.startDate;
  const days = Math.max(1, daysBetween(from, to) + 1);
  const firstEver = people.reduce((m, p) => (p.joinedAt.slice(0, 10) < m ? p.joinedAt.slice(0, 10) : m), "9999-12-31");
  const beforeTo = addDays(from, -1);
  let beforeFrom = addDays(from, -days);
  const caveats: string[] = [];
  if (beforeFrom < firstEver) { beforeFrom = firstEver; caveats.push("Your signup history is shorter than the test window, so the 'before' period is shorter."); }
  const beforeDays = Math.max(0, daysBetween(beforeFrom, beforeTo) + 1);

  const during = countIn(people, from, to);
  const before = beforeDays > 0 ? countIn(people, beforeFrom, beforeTo) : { signups: 0, activated: 0, paid: 0 };
  const perDayDuring = during.signups / days;
  const perDayBefore = beforeDays ? before.signups / beforeDays : 0;
  const changePct = beforeDays && before.signups > 0 ? (perDayDuring - perDayBefore) / perDayBefore : null;

  // After (ended tests): same length as during, capped by today.
  let after: Evaluation["after"] = null;
  if (!running && exp.endDate) {
    const aFrom = addDays(exp.endDate, 1);
    const aTo = addDays(aFrom, days - 1) > today ? today : addDays(aFrom, days - 1);
    const aDays = daysBetween(aFrom, aTo) + 1;
    if (aDays >= 7) after = { from: aFrom, to: aTo, days: aDays, perDay: countIn(people, aFrom, aTo).signups / aDays };
  }

  const terms = (exp.matchTerms.length ? exp.matchTerms : [slug(exp.name)]).map((t) => t.toLowerCase()).filter(Boolean);
  const hits = people.filter((p) => {
    const d = p.joinedAt.slice(0, 10);
    return d >= from && d <= to && terms.some((t) => p.sourceText.toLowerCase().includes(t) || p.sourceText.toLowerCase().replace(/[^a-z0-9]+/g, "").includes(slug(t)));
  });
  const attributed = hits.length;
  const attributedPaid = hits.filter((p) => p.isPaid).length;

  const totalCost = exp.monthlyCost ? Math.round((exp.monthlyCost * days / 30.44) * 100) / 100 : null;
  const per = (n: number) => (totalCost && n > 0 ? Math.round((totalCost / n) * 100) / 100 : null);

  // Compare counts as Poisson with equal exposure (scaled if the before window is shorter).
  let z: number | null = null;
  let verdict: Verdict;
  if (beforeDays === 0 || during.signups + before.signups === 0) verdict = "no_data";
  else {
    const expected = before.signups * (days / beforeDays);
    z = (during.signups - expected) / Math.sqrt(Math.max(1, during.signups + expected));
    if (days < 7) verdict = "too_early";
    else if (z >= 1.96) verdict = "helping";
    else if (z >= 1.28) verdict = "possibly_helping";
    else if (z <= -1.96) verdict = "hurting";
    else if (z <= -1.28) verdict = "possibly_hurting";
    else verdict = "no_clear_change";
  }
  if (days < 14 && verdict !== "too_early" && verdict !== "no_data") caveats.push("Under 14 days of data — treat this as a hint, not a conclusion.");
  if (during.signups + before.signups < 10) caveats.push("Very few signups in total, so random swings can look like trends.");
  if (attributed === 0 && !!exp.matchTerms.length) caveats.push(`No signups mention ${terms.join(" / ")} in their source or campaign, so direct credit is zero (a listing may send people without tagged links).`);

  const fBefore = beforeDays > 0 ? funnelIn(people, beforeFrom, beforeTo, today) : funnelIn([], from, to, today);
  const fDuring = funnelIn(people, from, to, today);
  const aZ = fBefore.activated !== null && fDuring.activated !== null ? twoProportionZ(fBefore.activated, fBefore.n, fDuring.activated, fDuring.n) : null;
  let activationVerdict: Verdict = "no_data";
  if (fDuring.activated !== null) {
    if (aZ === null) activationVerdict = fDuring.n < 8 || fBefore.n < 8 ? "too_early" : "no_data";
    else activationVerdict = aZ >= 1.96 ? "helping" : aZ >= 1.28 ? "possibly_helping" : aZ <= -1.96 ? "hurting" : aZ <= -1.28 ? "possibly_hurting" : "no_clear_change";
  }
  if (exp.focus === "activation" && fDuring.n < 20) caveats.push(`Only ${fDuring.n} signups in the window so far — activation rates swing a lot with numbers this small.`);
  if (fDuring.matured < fDuring.n) caveats.push(`${fDuring.n - fDuring.matured} of ${fDuring.n} signups are under 7 days old, so "came back" and "disappeared" aren't settled for them yet (they're left out of those two rows).`);

  const overlaps = all
    .filter((o) => o.id !== exp.id)
    .filter((o) => o.startDate <= to && (o.endDate ?? "9999-12-31") >= beforeFrom)
    .map((o) => o.name);
  if (overlaps.length) caveats.push(`Overlaps with ${overlaps.join(", ")}, so their effects are mixed together.`);

  return {
    id: exp.id, running, from, to, days, beforeFrom, beforeTo, beforeDays, during, before,
    perDayDuring, perDayBefore, changePct, after, attributed, attributedPaid, totalCost,
    costPerSignup: per(during.signups), costPerAttributed: per(attributed), costPerPaid: per(during.paid),
    z, verdict, overlaps, caveats, funnel: { before: fBefore, during: fDuring }, activationZ: aZ, activationVerdict,
    starts: { before: beforeDays > 0 ? startBreakdown(people, beforeFrom, beforeTo, today) : [], during: startBreakdown(people, from, to, today) },
  };
}

// ---------- chart series ----------

export type DayRow = { day: string; signups: number; total: number; avg7: number | null };

/** Daily signups, cumulative total (counting everyone before `from` too) and a 7-day average. */
export function dailySeries(people: Person[], from: string, to: string): DayRow[] {
  const perDay = new Map<string, number>();
  let base = 0;
  for (const p of people) {
    const d = p.joinedAt.slice(0, 10);
    if (d < from) base++;
    else if (d <= to) perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const rows: DayRow[] = [];
  let total = base;
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) {
    const day = addDays(from, i);
    const s = perDay.get(day) ?? 0;
    total += s;
    rows.push({ day, signups: s, total, avg7: null });
  }
  rows.forEach((r, i) => {
    if (i >= 6) r.avg7 = Math.round((rows.slice(i - 6, i + 1).reduce((a, x) => a + x.signups, 0) / 7) * 100) / 100;
  });
  return rows;
}

/** Does the person have a login on a later day, within 7 days of signing up? */
export function cameBackWithin7(joinedAt: string, days: string[]): boolean {
  const join = joinedAt.slice(0, 10);
  const end = new Date(Date.parse(`${join}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  return days.some((d) => d > join && d <= end);
}

/** Map dashboard subscribers to the shape the maths needs. loginDays (user id → login dates) gives
 *  a true "came back within 7 days"; without it we fall back to "last login was on a later day". */
export function peopleFrom(rows: SubscriberRow[], loginDays: Record<string, string[]> | null = null): Person[] {
  return rows.map((r) => ({
    joinedAt: r.joinedAt,
    sourceText: [r.leadSource, r.signupCampaign, r.signupContent, r.firstTouchSource, r.signupTouchSource].filter(Boolean).join(" ").toLowerCase(),
    isPaid: r.isPaid,
    activated: r.activated,
    start: r.startingPoint,
    didSomething: r.activationStage !== "not_started",
    cameBack7: loginDays
      ? cameBackWithin7(r.joinedAt, loginDays[r.id] ?? [])
      : r.lastLoginAt ? r.lastLoginAt.slice(0, 10) > r.joinedAt.slice(0, 10) : false,
  }));
}
