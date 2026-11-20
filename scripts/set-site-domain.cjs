// Point the public website at your own domain:  node scripts/set-site-domain.cjs orbital.org
// Updates the canonical address, sharing previews, structured data, robots.txt and sitemap.xml in site/,
// and writes site/CNAME. Then set the same domain in GitHub → Settings → Pages → Custom domain.
const fs = require("fs");
const path = require("path");
const domain = (process.argv[2] || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) { console.error("Usage: node scripts/set-site-domain.cjs yourdomain.org"); process.exit(1); }
const dir = path.join(__dirname, "..", "site");
for (const f of ["index.html", "privacy.html", "robots.txt", "sitemap.xml"]) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) continue;
  const before = fs.readFileSync(p, "utf8");
  // Only the site's own address changes; links to GitHub releases and other sites stay as they are.
  const after = before.replace(/https:\/\/zaybaker132-spec\.github\.io\/orbital\//g, `https://${domain}/`);
  fs.writeFileSync(p, after);
  console.log(`${f}: ${before === after ? "no change" : "updated"}`);
}
fs.writeFileSync(path.join(dir, "CNAME"), `${domain}\n`);
console.log(`CNAME: ${domain}`);
