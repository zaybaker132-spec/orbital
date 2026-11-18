import http from "node:http";

/**
 * TEST-ONLY deterministic stand-in for the Anthropic Messages API, so the AI pipeline
 * (streaming, structured outputs, web-search citations) can be exercised through the real SDK
 * in CI without network access or credentials. Never used by the application at runtime.
 */
export interface MockCall { body: any; headers: http.IncomingHttpHeaders }

const msg = (content: any[], stop = "end_turn") => ({
  id: `msg_${Math.random().toString(36).slice(2)}`, type: "message", role: "assistant", model: "mock",
  content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
});

const WEB_SOURCE = { url: "https://example.org/small-business-ai-2025", title: "Small Business AI Adoption 2025", cited: "In 2025, 42% of small businesses used AI tools for scheduling and customer communication." };

function userText(body: any): string {
  const last = body.messages?.[body.messages.length - 1];
  return typeof last?.content === "string" ? last.content : (last?.content ?? []).map((b: any) => b.text ?? "").join("");
}

function structured(body: any): unknown {
  const props = Object.keys(body.output_config?.format?.schema?.properties ?? {});
  const text = userText(body);
  if (props.includes("memories")) {
    const said = text.match(/<user>([\s\S]*?)<\/user>/)?.[1] ?? "";
    const evidence = said.split(/[.!?]/)[0].trim();
    return { memories: evidence.length > 10 ? [{ content: `User said: ${evidence}`, category: "goal", evidence, confidence: 0.9, importance: 0.7, reason: "Stated goal." }] : [] };
  }
  if (props.includes("title")) return { title: "Mock conversation title" };
  if (props.includes("links")) return { links: [{ index: 0, relation: "supports", direction: "forward", confidence: 0.8, rationale: "Mock classification." }] };
  if (props.includes("positions") && props.includes("unknowns") && !props.includes("executive_summary")) {
    return { interpretation: "Whether remote work raises productivity is disputed.", unknowns: ["Long-run effects"], positions: [
      { label: "Remote work raises productivity", summary: "Fewer interruptions and no commute.", search_queries: ["remote work productivity gains", "work from home output study"] },
      { label: "Remote work lowers productivity", summary: "Weaker collaboration and mentoring.", search_queries: ["remote work productivity decline", "work from home collaboration costs"] },
    ] };
  }
  if (props.includes("for_queries")) return { interpretation: "Small businesses are adopting AI scheduling quickly.", for_queries: ["small business AI scheduling adoption"], against_queries: ["small business AI adoption barriers"], unknowns: ["Regional differences"] };
  if (props.includes("assessments")) {
    const ns = [...text.matchAll(/<source n="(\d+)"/g)].map((m) => Number(m[1]));
    return { assessments: ns.map((n) => ({ n, methodology: "survey", methodology_note: "Survey of small businesses, 2025.", conflict_level: "none_evident", conflict_note: "" })) };
  }
  if (props.includes("updates")) {
    const ns = [...text.matchAll(/<source n="(\d+)"/g)].map((m) => Number(m[1]));
    return { updates: [{ item: 0, status: "updated", statement: "48% of small businesses used AI for scheduling in 2026.", value: "", quote: "", source_refs: [Math.max(...ns)], note: "A newer survey reports higher adoption." }] };
  }
  if (props.includes("concepts") && props.includes("events")) {
    const part = text.match(/<text>\n([\s\S]*?)\n<\/text>/)?.[1] ?? "";
    const sentences = part.split(/(?<=\.)\s+/).filter((x) => x.length > 20);
    const dated = sentences.find((x) => /\b(19|20)\d{2}\b/.test(x));
    const figure = sentences.find((x) => /\d+%/.test(x));
    return {
      concepts: [{ name: "Booking software", definition: "Software salons use to take appointments." }, { name: "No-shows", definition: "Clients who miss appointments." }],
      evidence: [
        ...(figure ? [{ statement: figure, kind: "statistic", quote: figure }] : []),
        { statement: "An invented claim", kind: "fact", quote: "This sentence is not in the text at all." },
      ],
      events: dated ? [{ date_text: dated.match(/\b(19|20)\d{2}\b/)![0], iso_date: dated.match(/\b(19|20)\d{2}\b/)![0], event: dated.slice(0, 80), quote: dated }] : [],
      relations: [{ subject: "Booking software", relation: "reduces", object: "No-shows", quote: sentences.find((x) => /reduce/i.test(x)) ?? "missing quote that is not present" }],
    };
  }
  if (props.includes("subquestions")) return { interpretation: "Mock interpretation", subquestions: [{ question: "How widely is AI used by small businesses?", search_query: "small business AI adoption" }], unknowns: ["Regional differences"] };
  if (props.includes("executive_summary")) {
    const base = {
      executive_summary: "Small businesses are adopting AI for scheduling [1].",
      conclusions: [{ statement: "AI scheduling is mainstream among small businesses.", finding_refs: [0, 2, 9] }],
      findings: [
        { statement: "42% of small businesses used AI for scheduling in 2025.", source_refs: [1], level: "verified", reasoning: "The survey in source 1 states the figure directly.", builds_on: [], knowledge_refs: ["K1", "K99"], time_sensitivity: "fast" },
        { statement: "Fabricated claim citing a source that was never retrieved.", source_refs: [7], level: "verified", reasoning: "None.", builds_on: [], knowledge_refs: [], time_sensitivity: "moderate" },
        { statement: "Scheduling is the most common entry point for AI in small firms.", source_refs: [], level: "inference", reasoning: "Follows from the adoption figure in finding 0.", builds_on: [0, 2], knowledge_refs: [], time_sensitivity: "slow" },
      ],
      statistics: [
        { value: "42%", context: "AI scheduling adoption", source_ref: 1, quote: "42% of small businesses used AI tools for scheduling", time_sensitivity: "fast" },
        { value: "90%", context: "Invented figure", source_ref: 1, quote: "90% of businesses love AI", time_sensitivity: "fast" },
      ],
      supporting_evidence: [{ point: "Adoption is growing.", source_refs: [1] }],
      conflicting_evidence: [],
      further_research: ["What do salons currently pay for booking software?"],
      limitations: "Single source.",
    };
    if (props.includes("disagreements")) return { ...base,
      positions: [{ label: "Remote work raises productivity", summary: "Output per hour rises.", source_refs: [1] }, { label: "Remote work lowers productivity", summary: "Collaboration suffers.", source_refs: [5] }],
      disagreements: [{ topic: "Does output rise?", claims: [{ position: "Remote work raises productivity", claim: "Output rose.", source_refs: [1] }, { position: "Remote work lowers productivity", claim: "Innovation fell.", source_refs: [5] }], causes: ["methodology", "timeframe"], explanation: "They measure different outputs over different periods.", resolution: "A multi-year study measuring both." }],
      common_ground: [{ point: "Commute time falls.", source_refs: [1] }],
      weight_of_evidence: { leaning: "Modest gains for individual tasks", confidence: "medium", reasoning: "Most cited evidence measures individual output." } };
    if (props.includes("verdict")) return { ...base,
      evidence_for: [{ point: "42% adoption in 2025.", source_refs: [1], strength: "strong" }, { point: "Uncited claim.", source_refs: [8], strength: "strong" }],
      evidence_against: [],
      knowledge_evidence: [{ point: "Your notes say salons struggle with no-shows.", knowledge_refs: ["K1"], stance: "for" }],
      verdict: "supported", confidence: 0.72, reasoning: "Strong survey evidence, nothing contrary found.",
      next_tests: [{ question: "Is AI scheduling adoption growing among salons specifically?", why: "Salons may differ.", would_support_if: "Salon adoption above 40%.", would_refute_if: "Salon adoption below 15%." }] };
    return base;
  }
  if (props.includes("opportunities")) {
    return { opportunities: [{ title: "AI booking assistant for salons", area: "software_product", explanation: "Automate bookings.", why_identified: "Your goal [M1] and skills.", memory_refs: ["M1"], source_refs: ["S1"], problem: "Missed bookings.", business_model: "Subscription.", difficulty: "moderate", resources: "Time.", risks: "Competition.", next_action: "Interview 5 salon owners.", uncertainty: "Willingness to pay." }] };
  }
  if (props.includes("gaps")) return { gaps: [{ question: "What do salons pay for scheduling tools today?", why: "Pricing." }] };
  if (props.includes("milestones")) return { goals: "Validate then build.", milestones: [{ title: "Validate", tasks: ["Interview 5 owners", "Map competitors"] }] };
  if (props.includes("assessment")) {
    const blank = { project_ref: "", task_title: "", note_body: "", research_question: "", message_text: "" };
    return { assessment: "Pipeline needs follow-ups.", actions: [
      { ...blank, kind: "create_task", title: "Follow up with three warm leads", rationale: "Objective is pipeline.", project_ref: "P1", task_title: "Follow up with three warm leads" },
      { ...blank, kind: "start_research", title: "Research competitor pricing", rationale: "Pricing unknown.", research_question: "What do salon booking tools charge?" },
      { ...blank, kind: "send_message", title: "Weekly pipeline nudge", rationale: "Keep the team aligned.", message_text: "Reminder: log every lead this week." },
    ] };
  }
  if (props.includes("headline")) return { headline: "Quiet day", summary_markdown: "Two documents were added.", needs_attention: ["Review pending approvals"] };
  if (props.includes("where_you_left_off")) return { where_you_left_off: "You finished interviews.", suggested_next_steps: ["Prototype"], open_questions: ["Pricing?"] };
  return {};
}

export function startMockAnthropic(): Promise<{ url: string; calls: MockCall[]; close: () => void }> {
  const calls: MockCall[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      calls.push({ body, headers: req.headers });
      if (body.tools?.some((t: any) => t.name === "web_search")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(msg([
          { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q" } },
          { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: WEB_SOURCE.url, title: WEB_SOURCE.title, encrypted_content: "x", page_age: "March 2025" }] },
          { type: "text", text: "Adoption is rising.", citations: [{ type: "web_search_result_location", url: WEB_SOURCE.url, title: WEB_SOURCE.title, cited_text: WEB_SOURCE.cited, encrypted_index: "x" }] },
        ])));
      }
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const send = (type: string, data: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        send("message_start", { message: { ...msg([], null as any), content: [] } });
        send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        const chunks = body.output_config?.format ? [JSON.stringify(structured(body))] : ["Based on your goal [M1], ", "here is a grounded answer."];
        for (const t of chunks) send("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } });
        send("content_block_stop", { index: 0 });
        send("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } });
        send("message_stop", {});
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(msg([{ type: "text", text: JSON.stringify(structured(body)) }])));
    });
  });
  return new Promise((resolve) => server.listen(0, () => {
    const a = server.address();
    resolve({ url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, calls, close: () => server.close() });
  }));
}
