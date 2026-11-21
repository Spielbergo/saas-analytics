// Turns a short-lived Graph API Explorer user token into long-lived Page tokens
// (Page tokens obtained this way don't expire) and prints the .env.local lines.
//
//   META_APP_ID=... META_APP_SECRET=... META_SHORT_TOKEN=... node docs/social/meta-token.mjs
//
// Nothing is stored; copy the output into .env.local yourself.
const { META_APP_ID: id, META_APP_SECRET: secret, META_SHORT_TOKEN: short } = process.env;
const V = process.env.META_GRAPH_VERSION || "v23.0";
if (!id || !secret || !short) {
  console.error("Set META_APP_ID, META_APP_SECRET and META_SHORT_TOKEN first (see README → Social).");
  process.exit(1);
}
const get = async (path, params) => {
  const u = new URL(`https://graph.facebook.com/${V}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j;
};
const long = await get("oauth/access_token", { grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: short });
const pages = await get("me/accounts", { access_token: long.access_token, fields: "id,name,access_token,instagram_business_account{username}", limit: "100" });
console.log(`\nFound ${pages.data.length} Page(s):\n`);
for (const p of pages.data) console.log(` - ${p.name} (${p.id})${p.instagram_business_account ? `  + Instagram @${p.instagram_business_account.username}` : "  (no Instagram linked)"}`);
console.log("\nAdd this to .env.local (Page tokens don't expire unless you change your password / lose the Page role):\n");
console.log(`META_PAGE_TOKENS=${pages.data.map((p) => `${p.id}=${p.access_token}`).join(",")}\n`);
