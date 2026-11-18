import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { languageInstruction, normalizeLanguage, runInLanguage, currentLanguage } from "../lib/language.js";

// Every interface string has a translation in every language, with the same placeholders.
const root = path.join(import.meta.dirname, "..", "..");
const keys: string[] = JSON.parse(execFileSync("node", [path.join(root, "scripts", "i18n-extract.cjs")], { encoding: "utf8" })).keys;
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

for (const lang of ["es", "fr", "pt", "de"]) {
  test(`${lang}: every interface string is translated`, () => {
    const catalog: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "src", "i18n", "locales", `${lang}.json`), "utf8"));
    const missing = keys.filter((k) => !(k in catalog));
    assert.deepEqual(missing, [], `${missing.length} strings have no ${lang} translation (add them to scripts/i18n/${lang}.txt and rebuild)`);
    for (const k of keys) assert.equal(placeholders(catalog[k]), placeholders(k), `${lang} placeholders differ for: ${k}`);
  });
}

test("language instruction is added only for non-English, and follows async work", async () => {
  assert.equal(languageInstruction("en"), "");
  assert.match(languageInstruction("de"), /German/);
  assert.equal(normalizeLanguage("pt-BR"), "pt");
  assert.equal(normalizeLanguage("xx"), "en");
  assert.equal(normalizeLanguage(undefined), "en");
  const seen = await runInLanguage("fr", async () => { await new Promise((r) => setTimeout(r, 5)); return currentLanguage(); });
  assert.equal(seen, "fr");
  assert.equal(currentLanguage(), "en");
});
