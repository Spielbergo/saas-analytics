/** Same page, one spelling: drops #fragment and any trailing slash (so "https://x.ca" and "https://x.ca/" match). */
export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    let s = x.toString();
    if (x.pathname === "/" && !x.search) s = s.replace(/\/$/, "");
    else if (!x.search) s = s.replace(/\/$/, "");
    return s;
  } catch {
    return u.replace(/#.*$/, "").replace(/\/$/, "");
  }
}
