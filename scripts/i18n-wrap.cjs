// One-off codemod: wrap user-visible English text in tx("…") so it can be translated.
// Run: node scripts/i18n-wrap.cjs <files…>. Edits are applied as text replacements, preserving formatting.
const ts = require("typescript");
const fs = require("fs");
const ATTRS = new Set(["placeholder", "title", "aria-label", "label", "alt", "hint", "description", "subtitle"]);
const RENDER_PROPS = new Set(["label", "hint", "description", "sub", "summary_label"]);
const ENT = { "&nbsp;": " ", "&middot;": "·", "&amp;": "&", "&rarr;": "→", "&larr;": "←", "&hellip;": "…", "&mdash;": "—", "&ndash;": "–", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
const decode = (s) => s.replace(/&[a-z]+;/g, (e) => ENT[e] ?? e);
const has = (s) => /[A-Za-z]{2}/.test(s);

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.getText();
      const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const core = decode(m[2]).replace(/\s+/g, " ");
      if (has(core)) edits.push([node.getStart(), node.end, `${m[1]}{tx(${JSON.stringify(core)})}${m[3]}`]);
    } else if (ts.isJsxAttribute(node) && ATTRS.has(node.name.getText()) && node.initializer && ts.isStringLiteral(node.initializer) && has(node.initializer.text)) {
      edits.push([node.initializer.getStart(), node.initializer.end, `{tx(${JSON.stringify(node.initializer.text)})}`]);
    } else if (ts.isJsxExpression(node) && node.expression && ts.isPropertyAccessExpression(node.expression) && RENDER_PROPS.has(node.expression.name.text) && !ts.isJsxAttribute(node.parent) ) {
      edits.push([node.expression.getStart(), node.expression.end, `tx(${node.expression.getText()})`]);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["toast", "confirm"].includes(node.expression.text) && node.arguments[0]) {
      const a = node.arguments[0];
      if ((ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && has(a.text)) edits.push([a.getStart(), a.end, `tx(${JSON.stringify(a.text)})`]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  let out = src;
  for (const [s, e, r] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + r + out.slice(e);
  if (!/import \{[^}]*\btx\b[^}]*\} from "@\/i18n"/.test(out)) {
    // Add the import after the last import statement.
    const lines = out.split("\n");
    let last = -1;
    for (let i = 0; i < lines.length; i++) if (/^import .* from ".*";$/.test(lines[i]) || /^} from ".*";$/.test(lines[i])) last = i;
    lines.splice(last + 1, 0, 'import { tx } from "@/i18n";');
    out = lines.join("\n");
  }
  fs.writeFileSync(file, out);
  console.log(`${edits.length}\t${file}`);
}
