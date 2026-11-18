// Second pass: wrap text inside JSX expressions (ternaries, &&, template strings with values) and toast/confirm template strings.
const ts = require("typescript");
const fs = require("fs");
const SKIP_ATTR = /^(className|href|to|type|role|id|key|name|src|variant|size|tone|rel|target|htmlFor|autoComplete|inputMode|method|action|accept|download|value|defaultValue|min|max|step|style|framing|engine|kind|mode|status|layout|d|viewBox|fill|stroke|dominantBaseline|textAnchor|transform|width|height|x|y|cx|cy|r)$/;
const has = (s) => /[A-Za-z]{2}/.test(s) && !/^[a-z0-9_\-./:#?=&%]+$/.test(s) && !s.startsWith("/");
const inTx = (n) => n.parent && ts.isCallExpression(n.parent) && ts.isIdentifier(n.parent.expression) && ["tx", "tn", "t"].includes(n.parent.expression.text);
const nameOf = (e, i) => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) ? e.expression.name.text : `v${i}`);

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const wrapLiteral = (lit) => { if (!inTx(lit) && has(lit.text)) edits.push([lit.getStart(), lit.end, `tx(${JSON.stringify(lit.text)})`]); };
  const wrapTemplate = (tpl) => {
    if (inTx(tpl)) return;
    const textParts = [tpl.head.text, ...tpl.templateSpans.map((s) => s.literal.text)].join("");
    if (!has(textParts) || /^\/|^https?:/.test(tpl.head.text)) return;
    const used = new Set(); const vars = [];
    let key = tpl.head.text;
    tpl.templateSpans.forEach((s, i) => {
      let nm = nameOf(s.expression, i); while (used.has(nm)) nm = nm + i; used.add(nm);
      vars.push(`${nm}: ${s.expression.getText()}`);
      key += `{${nm}}` + s.literal.text;
    });
    edits.push([tpl.getStart(), tpl.end, `tx(${JSON.stringify(key)}, { ${vars.join(", ")} })`]);
  };
  // Visit expressions in "display" positions only.
  const display = (e) => {
    if (!e) return;
    if (ts.isParenthesizedExpression(e)) return display(e.expression);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return wrapLiteral(e);
    if (ts.isTemplateExpression(e)) return wrapTemplate(e);
    if (ts.isConditionalExpression(e)) { display(e.whenTrue); display(e.whenFalse); return; }
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) { display(e.right); if (e.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) display(e.left); return; }
  };
  const visit = (node) => {
    if (ts.isJsxExpression(node) && node.expression) {
      if (ts.isJsxAttribute(node.parent)) { if (!SKIP_ATTR.test(node.parent.name.getText()) && !/^on[A-Z]/.test(node.parent.name.getText())) display(node.expression); }
      else display(node.expression);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["toast", "confirm", "setError", "setErr", "flash"].includes(node.expression.text) && node.arguments[0]) display(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  // Drop edits nested inside other edits (keep the outermost).
  edits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const kept = [];
  for (const e of edits) if (!kept.some((k) => e[0] >= k[0] && e[1] <= k[1])) kept.push(e);
  let out = src;
  for (const [s, e, r] of kept.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + r + out.slice(e);
  if (!/import \{[^}]*\btx\b[^}]*\} from "@\/i18n"/.test(out)) {
    const lines = out.split("\n"); let last = -1;
    for (let i = 0; i < lines.length; i++) if (/^import .* from ".*";$/.test(lines[i]) || /^} from ".*";$/.test(lines[i])) last = i;
    lines.splice(last + 1, 0, 'import { tx } from "@/i18n";'); out = lines.join("\n");
  }
  fs.writeFileSync(file, out);
  console.log(`${kept.length}\t${file}`);
}
