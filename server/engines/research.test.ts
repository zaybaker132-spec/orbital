import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyReport } from "./research.js";
import { parseOpenAlex, parseWikipediaExtracts, invertAbstract } from "../research/sources.js";

const sources = [
  { ref_number: 1, excerpt: "In 2023, 35% of companies reported using AI in at least one business function, according to the survey." },
  { ref_number: 2, excerpt: "Adoption remains uneven across industries and regions." },
];

const base = { executive_summary: "x", supporting_evidence: [], conflicting_evidence: [], further_research: [], limitations: "" };

test("citations to sources that were never retrieved are removed and the finding downgraded", () => {
  const v = verifyReport({ ...base, findings: [{ statement: "AI is everywhere", source_refs: [7], level: "verified" }], statistics: [] }, sources);
  assert.deepEqual(v.findings[0].source_refs, []);
  assert.equal(v.findings[0].level, "inference");
  assert.equal(v.dropped.findings, 1);
});

test("statistics that don't appear in the source text are dropped", () => {
  const v = verifyReport({
    ...base,
    findings: [],
    statistics: [
      { value: "35%", context: "AI adoption", source_ref: 1, quote: "35% of companies reported using AI in at least one business function" },
      { value: "72%", context: "invented", source_ref: 1, quote: "72% of companies use AI" },
      { value: "35%", context: "wrong source", source_ref: 2, quote: "35% of companies" },
    ],
  }, sources);
  assert.equal(v.statistics.length, 1);
  assert.equal(v.statistics[0].verified, true);
  assert.equal(v.dropped.statistics, 2);
});

test("valid citations are kept", () => {
  const v = verifyReport({ ...base, findings: [{ statement: "Adoption is uneven", source_refs: [2, 2], level: "verified" }], statistics: [] }, sources);
  assert.deepEqual(v.findings[0].source_refs, [2]);
  assert.equal(v.findings[0].level, "verified");
});

test("OpenAlex abstracts are reconstructed from the inverted index", () => {
  assert.equal(invertAbstract({ Hello: [0], world: [1], again: [3], big: [2] }), "Hello world big again");
  const s = parseOpenAlex({ results: [{ id: "https://openalex.org/W1", doi: "https://doi.org/10.1/x", title: "A study", publication_year: 2024, cited_by_count: 12, authorships: [{ author: { display_name: "A. Author" } }], abstract_inverted_index: { An: [0], abstract: [1] } }] });
  assert.equal(s[0].url, "https://doi.org/10.1/x");
  assert.equal(s[0].excerpt, "An abstract");
  assert.match(s[0].published ?? "", /2024 · cited by 12/);
});

test("Wikipedia extracts keep page order and skip stubs", () => {
  const s = parseWikipediaExtracts({ query: { pages: { "5": { pageid: 5, title: "Stub", extract: "short" }, "9": { pageid: 9, title: "Artificial intelligence", fullurl: "https://en.wikipedia.org/wiki/Artificial_intelligence", extract: "Artificial intelligence is ".repeat(10) } } } }, [9, 5]);
  assert.equal(s.length, 1);
  assert.equal(s[0].title, "Artificial intelligence — Wikipedia");
});

test("AI errors become plain sentences, never raw JSON", async () => {
  const { describeAiError } = await import("../ai/provider.js");
  const billing = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'),
    { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } } });
  assert.match(describeAiError(billing), /^Your Anthropic account has no API credit/);
  assert.match(describeAiError({ status: 401, error: { error: { type: "authentication_error", message: "invalid x-api-key" } } }), /rejected the API key/);
  assert.match(describeAiError({ status: 529, error: { error: { type: "overloaded_error" } } }), /temporarily unavailable/);
  assert.doesNotMatch(describeAiError(new Error('400 {"type":"error"}')), /\{/);
});
