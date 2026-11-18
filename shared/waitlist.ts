/** Waitlist questions, shared by the public form and the server's validation. */

export const PERSONAS = [
  "Founder or operator",
  "Builder or engineer",
  "Researcher or student",
  "Creator or writer",
  "Investor or analyst",
  "Leading a team at a company",
  "Something else",
] as const;

/** "What should Orbital compound for you?" */
export const REMEMBER = [
  "Ideas and decisions I keep losing",
  "Research and the sources behind it",
  "Projects I'm building",
  "My business's knowledge",
  "Opportunities worth chasing",
  "Learning something deeply",
] as const;

export const SCALE = ["Just me", "Me and a small team", "A whole company"] as const;

export const AI_TOOLS = ["ChatGPT", "Claude", "Gemini", "Claude Code or Codex", "Cursor", "Perplexity", "None yet", "Other"] as const;

export const NOTES_APPS = ["Obsidian", "Notion", "Apple Notes", "Google Docs", "Paper", "Nowhere", "Other"] as const;

export const COMPUTERS = ["macOS", "Windows", "Linux", "ChromeOS", "None"] as const;

export const DEVICES = ["iPhone or iPad", "Android", "None"] as const;

export const HEARD_FROM = ["A friend", "X / Twitter", "TikTok", "Instagram", "YouTube", "Discord", "Reddit", "Search", "Somewhere else"] as const;

/** "Pick your main one first, then up to two more": order matters, max 3. */
export const MAX_RANKED = 3;
