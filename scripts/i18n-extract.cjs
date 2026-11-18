// Lists every interface string that needs a translation: arguments of t()/tx()/tn() and
// label-like fields in object literals (menus, tabs, options). Prints JSON: { keys: [...] }.
// Used by the coverage test and when adding a language: node scripts/i18n-extract.cjs > keys.json
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "src");
const SKIP = [/[\\/]preview[\\/]/, /[\\/]neural[\\/]/, /[\\/]i18n[\\/]/];
const FIELDS = new Set(["label", "hint", "description", "title", "sub", "group", "subtitle", "placeholder", "blurb"]);
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|ts)$/.test(f) && !SKIP.some((r) => r.test(p))) files.push(p); } })(ROOT);

const keys = new Set();
const isText = (s) => /[A-Za-z]{2}/.test(s) && !/^[a-z0-9_./:-]+$/.test(s) && !/^(https?:|\/|#|sk-ant)/.test(s) && !/^[A-Z0-9_]+(=.*)?$/.test(s) && !/^[a-z]+(-[a-z]+)+$/.test(s);
const str = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
for (const file of files) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text;
      const args = name === "tn" ? n.arguments.slice(1, 3) : (name === "t" || name === "tx") ? n.arguments.slice(0, 1) : [];
      for (const a of args) { const s = str(a); if (s && /[A-Za-z]/.test(s)) keys.add(s); }
    }
    if (ts.isPropertyAssignment(n) && FIELDS.has(n.name.getText(src).replace(/["']/g, ""))) { const s = str(n.initializer); if (s && isText(s)) keys.add(s); }
    // Lookup tables of labels: const NUDGE_LABEL: Record<string, string> = { overdue: "Overdue", ... }
    if (ts.isVariableDeclaration(n) && /^[A-Z][A-Z_]+$/.test(n.name.getText(src)) && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
      for (const p of n.initializer.properties) if (ts.isPropertyAssignment(p)) { const s = str(p.initializer); if (s && isText(s) && /^[A-Z]/.test(s)) keys.add(s); }
    }
    // Tabs and sections written as [id, label] pairs: ["account", "Account"]
    if (ts.isArrayLiteralExpression(n) && n.elements.length === 2) {
      const [a, b] = n.elements.map(str);
      if (a && b && /^[a-z_]+$/.test(a) && /^[A-Z]/.test(b) && isText(b)) keys.add(b);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}
process.stdout.write(JSON.stringify({ keys: [...keys].sort() }, null, 1));
