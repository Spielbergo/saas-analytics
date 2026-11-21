import "server-only";
import { inflateRawSync } from "node:zlib";
import type { Sheet } from "./parse";

// Minimal .xlsx reader (zip + XML) so the importer needs no extra dependency.
// Reads sheet names, shared strings, inline strings and numbers. Dates arrive as Excel serial
// numbers and are converted by the LinkedIn parser.

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a valid .xlsx file (no zip directory).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    if (/\.(xml|rels)$/.test(name)) files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export function readXlsx(buf: Buffer): Sheet[] {
  if (buf.length > 4 && buf[0] === 0xd0 && buf[1] === 0xcf) {
    throw new Error("That's the older .xls format. Open it in Excel (or Google Sheets) and Save As .xlsx, then import again.");
  }
  const files = unzip(buf);
  const text = (n: string) => files.get(n)?.toString("utf8") ?? "";
  const shared: string[] = [];
  for (const si of text("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    shared.push(unescapeXml([...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
  }
  const rels = new Map<string, string>();
  for (const m of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1], target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target.replace(/^\//, "").replace(/^(?!xl\/)/, "xl/"));
  }
  const sheets: Sheet[] = [];
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(m[0].match(/\bname="([^"]*)"/)?.[1] ?? "Sheet");
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1];
    const xml = rid ? text(rels.get(rid) ?? "") : "";
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = cm[1].match(/\br="([A-Z]+\d+)"/)?.[1];
        if (!ref) continue;
        const t = cm[1].match(/\bt="([^"]+)"/)?.[1];
        const body = cm[2] ?? "";
        let v = "";
        if (t === "inlineStr") v = unescapeXml([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
        else {
          const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
          v = t === "s" ? shared[Number(raw)] ?? "" : unescapeXml(raw);
        }
        row[colIndex(ref)] = v;
      }
      for (let i = 0; i < row.length; i++) row[i] ??= "";
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error("Couldn't read any sheets from that file.");
  return sheets;
}
