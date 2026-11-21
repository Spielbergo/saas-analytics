// Sample-data separation. NorthBooks lets new users load sample data to look around; those invoices/expenses
// are not real use, so they must not count as activation. The main app logs each load in `sample_data_events`
// (user_id, created_at). Pure helpers here are client-safe; the fetch lives in lib/metrics.ts.

export type SampleInfo = {
  loads: number;
  firstAt: string; // ISO
  lastAt: string; // ISO
  /** "sample_only": nothing suggests real use yet. "real_after": real activity detected (see reason). */
  verdict: "sample_only" | "real_after";
  reason: string | null;
};

export const SAMPLE_NOTE =
  "People who loaded sample data are marked. Their invoices/expenses from the sample don't count as activation unless there is evidence of real use afterwards (an invoice dated after the last sample load, or the email is listed in SAMPLE_REAL_EMAILS).";

/** Decide whether a user who loaded sample data has since done real work. */
export function judgeSample(
  events: { at: string }[],
  lastInvoiceAt: string | null,
  forcedReal: boolean
): SampleInfo | null {
  if (!events.length) return null;
  const times = events.map((e) => e.at).sort();
  const lastAt = times[times.length - 1];
  const lastDay = lastAt.slice(0, 10);
  let verdict: SampleInfo["verdict"] = "sample_only";
  let reason: string | null = null;
  if (forcedReal) { verdict = "real_after"; reason = "marked as real in SAMPLE_REAL_EMAILS"; }
  else if (lastInvoiceAt && lastInvoiceAt.slice(0, 10) > lastDay) { verdict = "real_after"; reason = `invoice created ${lastInvoiceAt.slice(0, 10)}, after the last sample load (${lastDay})`; }
  return { loads: events.length, firstAt: times[0], lastAt, verdict, reason };
}
