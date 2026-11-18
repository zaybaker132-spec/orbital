/**
 * The Orbital intelligence architecture: six levels, each building on the one below.
 * `today` lists what powers each level in the product now; `status` is honest about maturity.
 */
export interface Level { n: string; name: string; summary: string; today: string[]; status: "live" | "early"; color: string }

export const LEVELS: Level[] = [
  {
    n: "01", name: "Understand", color: "#ff1f2e", status: "live",
    summary: "Learn your interests, goals, preferences and knowledge.",
    today: ["Memories with evidence you can check", "Notes, files, web clips and voice conversations", "Everything you correct takes priority"],
  },
  {
    n: "02", name: "Connect", color: "#ff9a1a", status: "live",
    summary: "Discover relationships between memories, ideas and research.",
    today: ["A living knowledge graph", "Concepts and timelines extracted from long documents", "Contradictions found and explained"],
  },
  {
    n: "03", name: "Anticipate", color: "#ffd23a", status: "live",
    summary: "Identify upcoming needs, potential problems and opportunities.",
    today: ["Nudges about deadlines and slipping work", "Reports that flag their own outdated facts", "Opportunities found in what you know"],
  },
  {
    n: "04", name: "Simulate", color: "#2cff7a", status: "early",
    summary: "Model possible futures and evaluate different decisions.",
    today: ["Hypotheses tested for and against", "Competing views weighed in the contradiction lab", "Full scenario modelling is in development"],
  },
  {
    n: "05", name: "Strategize", color: "#1fd0ff", status: "live",
    summary: "Develop long-term plans based on accumulated knowledge.",
    today: ["Projects with goals, milestones and deadlines", "Execution plans from validated opportunities", "Briefs that pick up where you left off"],
  },
  {
    n: "06", name: "Execute", color: "#b02bff", status: "live",
    summary: "Carry out approved tasks, coordinate agents and track real-world outcomes.",
    today: ["An operations agent working toward your goals", "Nothing leaves without a person approving it", "Outcomes tracked day by day"],
  },
];
