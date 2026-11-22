"use client";

import { useState } from "react";
import { DataTable } from "@/components/DataTable";
import { inspectAll, seoFetch } from "@/lib/seoClient";
import type { CrawlResult, InspectionResult, SchemaReport } from "@/lib/seo/types";
import { Card, ErrorNote, Mini, Notice, Pill, RunButton, UrlLink, col } from "./common";

function ReportView({ r }: { r: SchemaReport }) {
  if (r.blocks === 0) return <Notice>No JSON-LD found on that page. Adding Organization, WebSite and SoftwareApplication markup is a good start.</Notice>;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="JSON-LD blocks" value={r.blocks} />
        <Mini label="Types found" value={r.types.length} sub={r.types.join(", ") || undefined} />
        <Mini label="Errors" value={r.errorCount} tone={r.errorCount ? "bad" : "good"} sub="fix these first" />
        <Mini label="Suggestions" value={r.warningCount} tone={r.warningCount ? "warn" : "good"} sub="recommended fields" />
      </div>
      {r.blockErrors.map((e, i) => <ErrorNote key={i}>{e}</ErrorNote>)}
      {r.nodes.map((n, i) => (
        <div key={i} className="rounded-xl border border-border bg-bg p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={n.errors.length ? "error" : n.warnings.length ? "warning" : "good"}>{n.type}</Pill>
            {n.name && <span className="text-muted">{n.name}</span>}
            <span className="ml-auto font-mono text-xs text-muted">{n.path}</span>
          </div>
          {n.errors.length === 0 && n.warnings.length === 0 && <p className="mt-2 text-xs text-success">No problems found.</p>}
          {n.errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-danger">{n.errors.map((e, j) => <li key={j}>{e}</li>)}</ul>}
          {n.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-warning">{n.warnings.map((e, j) => <li key={j}>{e}</li>)}</ul>}
          {n.note && <p className="mt-2 text-xs text-muted">{n.note}</p>}
        </div>
      ))}
    </div>
  );
}

export function SchemaPanel({
  inspections,
  crawl,
  siteUrl,
  configured,
  onInspections,
}: {
  inspections: InspectionResult[];
  crawl: CrawlResult | null;
  siteUrl: string | null;
  configured: boolean;
  onInspections: (rows: InspectionResult[]) => void;
}) {
  const [url, setUrl] = useState(siteUrl ?? "");
  const [pasted, setPasted] = useState("");
  const [report, setReport] = useState<{ source: string; report: SchemaReport } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(body: { url?: string; jsonld?: string }, which: string) {
    setBusy(which); setError(null);
    try { setReport(await seoFetch("/api/seo/schema", { method: "POST", body: JSON.stringify(body) })); }
    catch (e) { setError(e instanceof Error ? e.message : "Check failed"); setReport(null); }
    finally { setBusy(null); }
  }

  async function inspect() {
    setBusy("inspect"); setError(null);
    try {
      onInspections(await inspectAll());
    } catch (e) { setError(e instanceof Error ? e.message : "Inspection failed"); }
    finally { setBusy(null); }
  }

  const withRich = inspections.filter((i) => i.richResults);
  const crawlRows = (crawl?.pages ?? []).filter((p) => p.indexable);
  const noSchema = crawlRows.filter((p) => !p.schemaTypes?.length).length;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Check structured data" subtitle="Fetches a page on your site (or takes pasted JSON-LD / page source) and checks it against the required and recommended fields from Google's structured-data docs. Runs locally — no data leaves your server.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yoursite.ca/pricing" className="min-w-[16rem] flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent" />
            <RunButton onClick={() => check({ url }, "url")} busy={busy === "url"} disabled={!url.trim()}>Check page</RunButton>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted hover:text-text">…or paste JSON-LD / page source</summary>
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={8} placeholder='{"@context":"https://schema.org","@type":"Organization",…}' className="mt-2 w-full rounded-lg border border-border bg-bg p-3 font-mono text-xs outline-none focus:border-accent" />
            <div className="mt-2"><RunButton onClick={() => check({ jsonld: pasted }, "paste")} busy={busy === "paste"} disabled={!pasted.trim()}>Check pasted markup</RunButton></div>
          </details>
          {error && <ErrorNote>{error}</ErrorNote>}
          {report && (<><p className="text-xs text-muted">Checked: {report.source}</p><ReportView r={report.report} /></>)}
        </div>
      </Card>

      <Card
        title="Google's verdict"
        subtitle="What Google itself detected on pages it has crawled, from the free URL Inspection API (the same run as the Indexing tab). There's no public Rich Results Test API, so for brand-new pages use Google's web tool at search.google.com/test/rich-results."
        action={<RunButton onClick={inspect} busy={busy === "inspect"} disabled={!configured || !crawl}>{withRich.length ? "Re-inspect pages" : "Inspect pages"}</RunButton>}
      >
        {!configured && <Notice>Needs the Search Console service account (see <code className="font-mono text-xs">docs/marketing-setup.md</code>).</Notice>}
        {configured && !crawl && <p className="text-sm text-muted">Run a site audit first — it supplies the list of pages.</p>}
        {inspections.length > 0 && withRich.length === 0 && <p className="text-sm text-muted">None of the {inspections.length} inspected pages has rich-result data yet. Click Re-inspect (older results were saved before this tab existed), and note Google only reports it for pages with eligible markup.</p>}
        {withRich.length > 0 && (
          <DataTable<InspectionResult>
            rows={withRich} rowKey={(r) => r.url} compact maxHeight={420} csvName="google-rich-results" viewsKey="seo-rich-results"
            searchText={(r) => `${r.url} ${r.richResults?.items.map((i) => i.type).join(" ")}`}
            filters={[{ key: "verdict", label: "Verdicts", getValue: (r) => r.richResults?.verdict ?? "—" }]}
            columns={[
              col<InspectionResult>("url", "URL", (r) => r.url, (r) => <UrlLink url={r.url} />),
              col<InspectionResult>("v", "Verdict", (r) => r.richResults?.verdict ?? "", (r) => <Pill tone={r.richResults?.verdict === "PASS" ? "good" : r.richResults?.verdict === "FAIL" ? "error" : "warning"}>{r.richResults?.verdict ?? "—"}</Pill>),
              col<InspectionResult>("t", "Rich result types", (r) => r.richResults?.items.map((i) => i.type).join(", ") ?? ""),
              col<InspectionResult>("i", "Issues", (r) => r.richResults?.items.reduce((n, i) => n + i.issues.length, 0) ?? 0, (r) => {
                const all = r.richResults?.items.flatMap((i) => i.issues.map((x) => `${i.type}: ${x.message}`)) ?? [];
                return all.length ? <span className="text-xs text-warning" title={all.join("\n")}>{all.length} — {all[0].slice(0, 70)}</span> : <span className="text-success">none</span>;
              }),
            ]}
          />
        )}
      </Card>

      {crawl && (
        <Card title="Across your site" subtitle={`${crawlRows.length - noSchema} of ${crawlRows.length} indexable pages have structured data (from your last site audit).`}>
          <DataTable<(typeof crawlRows)[number]>
            rows={crawlRows} rowKey={(r) => r.url} compact maxHeight={420} csvName="structured-data-by-page" viewsKey="seo-schema-pages"
            searchText={(r) => `${r.url} ${(r.schemaTypes ?? []).join(" ")}`}
            filters={[{ key: "has", label: "Structured data", getValue: (r) => (r.schemaTypes?.length ? (r.schemaProblems?.length ? "Has problems" : "Valid") : "None") }]}
            columns={[
              col("url", "URL", (r) => r.url, (r) => <UrlLink url={r.url} />),
              col("types", "Types", (r) => (r.schemaTypes ?? []).join(", ")),
              col("p", "Problems", (r) => r.schemaProblems?.length ?? 0, (r) => r.schemaProblems?.length ? <span className="text-xs text-warning" title={r.schemaProblems.join("\n")}>{r.schemaProblems.length} — {r.schemaProblems[0].slice(0, 70)}</span> : <span className="text-muted">—</span>),
              col("check", "", (r) => r.url, (r) => (
                <button className="text-xs text-accent hover:underline" onClick={() => { setUrl(r.url); check({ url: r.url }, "url"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Details</button>
              )),
            ]}
          />
        </Card>
      )}
    </div>
  );
}
