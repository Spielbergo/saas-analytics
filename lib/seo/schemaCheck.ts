// Detailed, per-node JSON-LD check (pure; client-safe). Required fields come
// from Google's structured-data docs; "recommended" ones improve eligibility.
// This is a local sanity check — Google's own verdict for indexed pages comes
// from the URL Inspection API (see urlInspection.ts).

import type { SchemaNodeReport, SchemaReport } from "./types";

type Json = Record<string, unknown>;
type Field = string | string[]; // an array means "at least one of"

type Spec = { required: Field[]; recommended: Field[]; note?: string };

const ORG: Spec = { required: ["name"], recommended: ["url", "logo", "sameAs", "contactPoint"] };
const APP: Spec = {
  required: ["name", "applicationCategory", ["offers", "aggregateRating", "review"]],
  recommended: ["operatingSystem", "description", "image", "aggregateRating"],
  note: "Software rich results need an offer, rating or review.",
};
const ARTICLE: Spec = { required: ["headline", "datePublished"], recommended: ["author", "image", "dateModified", "publisher", "description"] };

export const SPECS: Record<string, Spec> = {
  Organization: ORG, Corporation: ORG, NGO: ORG,
  WebSite: { required: ["name", "url"], recommended: ["potentialAction", "publisher"] },
  WebPage: { required: [], recommended: ["name", "description"] },
  SoftwareApplication: APP, WebApplication: APP, MobileApplication: APP,
  Product: { required: ["name", ["offers", "review", "aggregateRating"]], recommended: ["image", "description", "brand", "sku"] },
  Article: ARTICLE, BlogPosting: ARTICLE, NewsArticle: ARTICLE,
  FAQPage: {
    required: ["mainEntity"], recommended: [],
    note: "Google only shows FAQ rich results for well-known government and health sites; the markup is still valid for other sites and read by other engines.",
  },
  HowTo: { required: ["name", "step"], recommended: ["image"], note: "Google retired HowTo rich results in 2023; the markup is harmless but no longer shown." },
  BreadcrumbList: { required: ["itemListElement"], recommended: [] },
  LocalBusiness: { required: ["name", "address"], recommended: ["telephone", "openingHours", "geo", "image", "url"] },
  ProfessionalService: { required: ["name", "address"], recommended: ["telephone", "openingHours", "geo", "image", "url"] },
  AccountingService: { required: ["name", "address"], recommended: ["telephone", "openingHours", "geo", "image", "url"] },
  Review: { required: ["author", "reviewRating", "itemReviewed"], recommended: ["datePublished"] },
  VideoObject: { required: ["name", "thumbnailUrl", "uploadDate"], recommended: ["description", "contentUrl", "duration"] },
  Offer: { required: ["price", "priceCurrency"], recommended: ["availability", "url"] },
  Person: { required: ["name"], recommended: ["url", "sameAs"] },
};

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const has = (o: Json, k: string) => {
  const v = o[k];
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
};
const label = (f: Field) => (Array.isArray(f) ? `one of ${f.map((x) => `"${x}"`).join(" / ")}` : `"${f}"`);
const ok = (o: Json, f: Field) => (Array.isArray(f) ? f.some((k) => has(o, k)) : has(o, f));

function nested(o: Json, type: string, errors: string[], warnings: string[]) {
  if (type === "FAQPage") {
    arr(o.mainEntity).forEach((q, i) => {
      const qq = q as Json;
      if (!qq || typeof qq !== "object" || !has(qq, "name")) errors.push(`Question ${i + 1} has no "name"`);
      else if (!qq.acceptedAnswer || typeof qq.acceptedAnswer !== "object" || !has(qq.acceptedAnswer as Json, "text")) errors.push(`Question ${i + 1} ("${String(qq.name).slice(0, 40)}") has no acceptedAnswer.text`);
    });
  }
  if (type === "BreadcrumbList") {
    arr(o.itemListElement).forEach((it, i) => {
      const li = it as Json;
      if (!li || !has(li, "position")) errors.push(`Breadcrumb item ${i + 1} has no "position"`);
      const named = li && (has(li, "name") || (li.item && typeof li.item === "object" && has(li.item as Json, "name")));
      if (!named) errors.push(`Breadcrumb item ${i + 1} has no "name"`);
      if (li && !has(li, "item") && i < arr(o.itemListElement).length - 1) warnings.push(`Breadcrumb item ${i + 1} has no "item" URL (only the last crumb may omit it)`);
    });
  }
  if (type === "Product" || type === "SoftwareApplication" || type === "WebApplication") {
    arr(o.offers).forEach((f, i) => {
      const of = f as Json;
      if (!of || typeof of !== "object") return;
      if (!has(of, "price") && !has(of, "lowPrice")) errors.push(`Offer ${i + 1} has no "price"`);
      if (!has(of, "priceCurrency")) errors.push(`Offer ${i + 1} has no "priceCurrency"`);
      if (typeof of.price === "string" && /[$€£,]/.test(of.price)) warnings.push(`Offer ${i + 1} price "${of.price}" should be a plain number (no currency symbol)`);
    });
    const ar = o.aggregateRating as Json | undefined;
    if (ar && typeof ar === "object") {
      if (!has(ar, "ratingValue")) errors.push('aggregateRating has no "ratingValue"');
      if (!has(ar, "reviewCount") && !has(ar, "ratingCount")) errors.push('aggregateRating needs "reviewCount" or "ratingCount"');
    }
  }
  const dates = ["datePublished", "dateModified", "uploadDate"] as const;
  for (const k of dates) if (has(o, k) && Number.isNaN(Date.parse(String(o[k])))) errors.push(`"${k}" is not a valid ISO 8601 date`);
}

function* walk(v: unknown, path: string): Generator<{ node: Json; path: string }> {
  if (Array.isArray(v)) { let i = 0; for (const x of v) yield* walk(x, `${path}[${i++}]`); return; }
  if (v && typeof v === "object") {
    const o = v as Json;
    if (o["@type"]) yield { node: o, path };
    if (o["@graph"]) yield* walk(o["@graph"], `${path}.@graph`);
  }
}

export function checkJsonLd(blocks: string[]): SchemaReport {
  const nodes: SchemaNodeReport[] = [];
  const blockErrors: string[] = [];
  blocks.forEach((raw, bi) => {
    let data: unknown;
    try { data = JSON.parse(raw); }
    catch (e) { blockErrors.push(`Block ${bi + 1}: invalid JSON — ${e instanceof Error ? e.message.slice(0, 100) : "parse error"}`); return; }
    for (const root of arr(data)) {
      if (root && typeof root === "object") {
        const ctx = (root as Json)["@context"];
        if (!ctx) blockErrors.push(`Block ${bi + 1}: missing "@context" (should be "https://schema.org")`);
        else if (!/schema\.org/i.test(JSON.stringify(ctx))) blockErrors.push(`Block ${bi + 1}: "@context" isn't schema.org`);
        else if (typeof ctx === "string" && ctx.startsWith("http://")) blockErrors.push(`Block ${bi + 1}: "@context" uses http:// — use https://schema.org`);
      }
    }
    for (const { node, path } of walk(data, `block${bi + 1}`)) {
      for (const type of arr(node["@type"]).map(String)) {
        const spec = SPECS[type];
        const errors: string[] = [];
        const warnings: string[] = [];
        if (spec) {
          for (const f of spec.required) if (!ok(node, f)) errors.push(`Missing ${label(f)}`);
          for (const f of spec.recommended) if (!ok(node, f)) warnings.push(`Recommended: ${label(f)}`);
          nested(node, type, errors, warnings);
        } else warnings.push("No local rules for this type (only syntax was checked)");
        nodes.push({ type, path, name: typeof node.name === "string" ? node.name.slice(0, 60) : typeof node.headline === "string" ? node.headline.slice(0, 60) : null, errors, warnings, note: spec?.note ?? null });
      }
    }
  });
  const errorCount = blockErrors.length + nodes.reduce((n, x) => n + x.errors.length, 0);
  const warningCount = nodes.reduce((n, x) => n + x.warnings.filter((w) => w.startsWith("Recommended") || !w.startsWith("No local")).length, 0);
  return { blocks: blocks.length, nodes, blockErrors, errorCount, warningCount, types: [...new Set(nodes.map((n) => n.type))] };
}

/** Pull JSON-LD script bodies out of raw HTML (same pattern the crawler uses). */
export function extractJsonLd(html: string): string[] {
  return Array.from(html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)).map((m) => m[1].trim()).filter(Boolean);
}
