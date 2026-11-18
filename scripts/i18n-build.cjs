// Builds src/i18n/locales/<lang>.json from translation files of "id|text" lines and an id→English map.
// node scripts/i18n-build.cjs <ids.json> <lang> <file...>
// "=" keeps the English text (codes, product names). "\n" in a line is a line break.
// Checks every translation keeps the English placeholders ({n}, {name}) and edge whitespace.
const fs = require("fs");
const path = require("path");
const [idsFile, lang, ...files] = process.argv.slice(2);
const ids = JSON.parse(fs.readFileSync(idsFile, "utf8"));
const out = {};
let problems = 0;
for (const f of files) {
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const bar = line.indexOf("|");
    const id = line.slice(0, bar), en = ids[id];
    if (en === undefined) { console.error(`unknown id ${id}`); problems++; continue; }
    let text = line.slice(bar + 1);
    if (text === "=") { out[en] = en; continue; }
    text = text.replace(/\\n/g, "\n").trim();
    text = en.match(/^\s*/)[0] + text + en.match(/\s*$/)[0];
    const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    if (ph(en) !== ph(text)) { console.error(`${lang} ${id}: placeholders differ\n  ${en}\n  ${text}`); problems++; }
    out[en] = text;
  }
}
const missing = Object.entries(ids).filter(([, en]) => !(en in out));
for (const [id, en] of missing) console.error(`${lang} missing ${id}: ${en.slice(0, 70)}`);
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
fs.writeFileSync(path.join(__dirname, "..", "src", "i18n", "locales", `${lang}.json`), JSON.stringify(sorted, null, 1) + "\n");
console.log(`${lang}: ${Object.keys(out).length} strings, ${missing.length} missing, ${problems} problems`);
