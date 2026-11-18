# Research intelligence

Orbital's research engine plans sub-questions, searches sources, synthesizes findings and verifies every citation and statistic against the retrieved text. On top of that it has six capabilities, described below. AI-dependent parts say so in the app; nothing is simulated.

## Source intelligence

Every source in a report gets a credibility score out of 100: **high** (75 and up), **moderate** (55–74) or **low**. The **Sources** tab on a report shows how each score breaks down, with a plain-language reason for each factor:

| Factor | Weight | Based on |
|---|---|---|
| Authority | 30% | Who published it, from the source's address and type. Government and intergovernmental bodies score highest, then scholarly records (higher still when widely cited), universities, encyclopedias and general web sources. Press-release services and user-generated platforms score lowest. |
| Methodology | 25% | What kind of evidence it is: meta-analysis, systematic review, randomized trial, official statistics, cohort study, survey, case study, news report, opinion, marketing… With an AI provider, the model reads the text for the study design and its basis (for example "Survey of 1,200 US firms"). Without one, only explicit study-design words count. |
| Recency | 15% | The publication or revision date. |
| Independence | 15% | Signs of a conflict of interest: stated funding, sponsorship, or an organisation describing its own product. These are judged only from the text and metadata, never assumed about a publisher. |
| Corroboration | 15% | Whether the report's verified findings rely on the source, and whether an independent source (a different site) supports the same finding. The score is capped when the source also appears in conflicting evidence. |

Scores are a guide to what to check, not a verdict on a publisher. Reports made before this feature can be scored with **Assess sources**.

## Contradiction lab

Choose **Contradiction lab** when starting research, or click **Investigate in the lab** on a contradiction the knowledge graph has found.

1. **Positions:** the AI maps 2 to 4 genuinely distinct positions.
2. **Searching:** each position's strongest sources are searched separately, and every source records which position it was gathered for.
3. **The report:**
   - each position, stated at its strongest and fairly
   - each point of disagreement: what each side claims (cited), *why* the sources disagree, and what evidence would settle it. The reasons are definitions, methodology, data, timeframe, scope, incentives, values, interpretation, or genuine uncertainty.
   - common ground
   - where the weight of evidence currently leans, with a confidence

The AI is told not to manufacture balance the evidence doesn't support.

## Research lineage

The **Lineage** tab traces any conclusion or finding all the way down, and **Trace** on any finding opens it there. Each conclusion breaks down into:

- **Findings** (verified, inference or speculation), each with:
  - **Reasoning:** how the sources lead to it
  - **Builds on:** earlier findings it depends on (only earlier ones, so there are no cycles)
  - **Evidence:** for each cited source:
    - the sentence in the retrieved text that best matches the finding
    - the source's credibility
    - the sub-question, or the position in the contradiction lab, whose search found it
  - **What you know:** the memories and notes it connects to
- **Original research:** the question, how it was interpreted, the searches run, when it ran, and the hypothesis it was testing, if any.

Conclusions, reasoning and "builds on" are produced during synthesis and checked by the server: they can only point to findings that exist. Reports made before lineage existed trace from the executive summary to their verified findings.

## Hypothesis testing

**Research → Hypotheses** (or `⌘K` → "Test a hypothesis"). Write what you believe and, optionally, why. A **test**:

1. Searches for supporting *and* disconfirming evidence with equal effort.
2. Weighs in your own saved knowledge.
3. Returns:
   - evidence for and against, each rated weak, moderate or strong, with citations
   - a **verdict**: supported, contested, refuted or insufficient
   - a confidence
   - the reasoning
   - the **next tests**: specific research questions, with what result would support or refute the hypothesis

Every citation is verified. A verdict can't claim support that verification removed: it falls back to "insufficient". **Research** on a next test runs it, linked to the hypothesis, and its findings join your knowledge, so the next **re-test** takes them into account. The test history shows how the verdict and confidence moved over time.

## Living research documents

During synthesis, every finding and statistic is tagged with how fast it goes out of date:

| Sensitivity | Examples | Shelf life |
|---|---|---|
| Fast | Prices, rankings, news | 45 days |
| Moderate | Market data, adoption figures | 8 months |
| Slow | Research consensus | 3 years |
| Stable | Definitions, history | No expiry |

A fact's age runs from its **newest** supporting source, or from its last refresh. Orbital re-checks reports roughly daily.

- Past 75% of its shelf life a fact is **aging**; past 100% it's **stale**.
- Stale reports show a banner, and also appear in Reminders under "Orbital noticed".
- **Refresh** (needs an AI provider) searches for current sources for the selected sections. Each section is then updated, marked as contradicted, confirmed, or flagged as unverifiable.
- A new statistic is only accepted if it appears in the new source's text.
- Each section keeps its history: what it said before, when it changed, and why.

## Research knowledge extraction

On any document, the **Extracted knowledge** tab turns long material (PDFs, books, reports, articles) into:

- **Concepts:** key terms and ideas, with a definition from the text and how often they appear
- **Evidence:** claims, figures, findings and arguments, each with its exact quote
- **Timeline:** dated events, in order
- **Relationships:** links of the form subject → relation → object, each with its quote

With an AI provider:
- The document is read in parts of about 6,000 characters, up to `EXTRACT_MAX_PARTS` (150 by default, several hundred pages), three at a time, with progress shown.
- Every evidence item, event and relationship must quote the part's text exactly: anything that doesn't is dropped and counted.
- The 25 most-mentioned concepts join the knowledge graph, linked to the document.
- Relationships between those concepts become suggested connections for you to confirm.

Without an AI provider, a basic pass still finds dated events, sentences with figures, and frequently used terms.

Everything extracted is searchable from universal search (the **Extracted** filter). Opening a result jumps to the item.
