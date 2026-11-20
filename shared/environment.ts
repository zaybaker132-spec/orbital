/**
 * Your Orbital environment: dashboards made of widgets, the app's layout, and its visual theme.
 * Shared by the server (validation) and the app (rendering), so both agree on what exists.
 */

export const WIDGET_TYPES = [
  "today", "ask", "core", "quick-note", "tasks", "projects", "reminders", "nudges",
  "notes", "papers", "research", "focus", "activity", "growth", "questions", "opportunities",
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
export const WIDGET_SIZES = ["s", "m", "l"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export interface WidgetMeta { type: WidgetType; title: string; description: string; size: WidgetSize }
/** The widget catalog, in the order the "Add widget" list shows it. */
export const WIDGETS: WidgetMeta[] = [
  { type: "today", title: "Today", description: "A greeting, the date and what's due today.", size: "l" },
  { type: "ask", title: "Ask Orbital", description: "Start a conversation from anywhere.", size: "m" },
  { type: "core", title: "Neural Core", description: "Your living orb, growing with what you know.", size: "m" },
  { type: "quick-note", title: "Quick note", description: "Capture a thought in one line.", size: "m" },
  { type: "tasks", title: "Upcoming tasks", description: "Open tasks across your projects, soonest first.", size: "m" },
  { type: "projects", title: "Projects", description: "Active projects and how far along they are.", size: "m" },
  { type: "reminders", title: "Reminders", description: "What's coming up.", size: "s" },
  { type: "nudges", title: "Nudges", description: "Overdue work, slipping deadlines and stalled projects.", size: "s" },
  { type: "notes", title: "Recent notes", description: "The notes, files and clips you touched last.", size: "s" },
  { type: "papers", title: "Recent papers", description: "Documents you're writing.", size: "s" },
  { type: "research", title: "Research", description: "Your latest research and its status.", size: "s" },
  { type: "focus", title: "Focus", description: "Start a focus session; this week's focused time.", size: "s" },
  { type: "activity", title: "Activity", description: "A year of your work, day by day.", size: "l" },
  { type: "growth", title: "Growth", description: "How your knowledge is growing.", size: "m" },
  { type: "questions", title: "Open questions", description: "Gaps in what you know, ready to research.", size: "s" },
  { type: "opportunities", title: "Opportunities", description: "Opportunities you're tracking.", size: "s" },
];

export interface Widget { id: string; type: WidgetType; size: WidgetSize }
export interface Dashboard { id: string; name: string; widgets: Widget[] }

const w = (type: WidgetType, size?: WidgetSize): Widget => ({ id: type, type, size: size ?? WIDGETS.find((x) => x.type === type)!.size });
/** Starting points for a new dashboard. */
export const TEMPLATES: { id: string; name: string; description: string; widgets: Widget[] }[] = [
  { id: "overview", name: "Overview", description: "A bit of everything: your day, work and knowledge.",
    widgets: [w("today"), w("tasks"), w("projects"), w("quick-note"), w("ask"), w("reminders"), w("notes"), w("focus"), w("activity")] },
  { id: "focus", name: "Deep work", description: "Just today's work and a timer.",
    widgets: [w("today"), w("focus", "m"), w("tasks"), w("nudges", "m"), w("quick-note", "l")] },
  { id: "research", name: "Research", description: "Questions, research and your growing knowledge.",
    widgets: [w("ask", "l"), w("research", "m"), w("questions", "m"), w("growth"), w("core"), w("notes"), w("papers")] },
  { id: "founder", name: "Founder", description: "Projects, opportunities and what needs attention.",
    widgets: [w("today"), w("projects"), w("opportunities", "m"), w("tasks"), w("nudges", "m"), w("papers"), w("reminders"), w("activity")] },
  { id: "blank", name: "Blank", description: "Start empty and add your own widgets.", widgets: [] },
];

/** Sidebar sections that can be reordered or hidden (Settings and New conversation always stay). */
export const NAV_KEYS = ["dashboard", "core", "research", "papers", "knowledge", "connections", "projects", "reminders", "focus", "opportunities", "meetings", "operations"] as const;
export type NavKey = (typeof NAV_KEYS)[number];

export const ACCENTS = ["white", "violet", "magenta", "red", "orange", "amber", "lime", "green", "cyan", "blue"] as const;
export type Accent = (typeof ACCENTS)[number];
/** Accent colours as [dark-theme, light-theme] hex. White in dark is near-black in light. */
export const ACCENT_HEX: Record<Accent, [string, string]> = {
  white: ["#ffffff", "#111114"], violet: ["#b88cff", "#7c3aed"], magenta: ["#ff5ce1", "#c026d3"], red: ["#ff6b74", "#dc2626"],
  orange: ["#ff9257", "#ea580c"], amber: ["#ffd23a", "#b45309"], lime: ["#b8ff5c", "#4d7c0f"], green: ["#4cff95", "#15803d"],
  cyan: ["#5ee1ff", "#0e7490"], blue: ["#6ea4ff", "#2563eb"],
};

export const CORE_PALETTES = ["spectrum", "aurora", "ember", "ocean", "mono"] as const;
export type CorePalette = (typeof CORE_PALETTES)[number];
/** Colour stops each Neural Core palette maps the original spectrum onto (spectrum = unchanged). */
export const CORE_PALETTE_STOPS: Record<Exclude<CorePalette, "spectrum">, string[]> = {
  aurora: ["#2cff7a", "#1fd0ff", "#7a2cff", "#b02bff", "#2cffd1"],
  ember: ["#ff1f2e", "#ff5a1f", "#ff9a1a", "#ffd23a", "#ff2b6b"],
  ocean: ["#1fd0ff", "#2f7dff", "#7a2cff", "#2cd9ff", "#4f5bff"],
  mono: ["#ffffff", "#c8c8d0", "#8f8f9a", "#e6e6ec", "#a8a8b4"],
};

export const BACKGROUNDS = ["plain", "glow", "grid", "stars"] as const;
export type Background = (typeof BACKGROUNDS)[number];
export const TEXT_SIZES = ["small", "default", "large"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export interface Environment {
  /** What opens when Orbital starts. */
  home?: "chat" | "dashboard";
  dashboards?: Dashboard[];
  activeDashboard?: string;
  nav?: { order: NavKey[]; hidden: NavKey[] };
  contextPanel?: "remember" | "open" | "closed";
  accent?: Accent;
  corePalette?: CorePalette;
  background?: Background;
  textSize?: TextSize;
}

export const DEFAULT_DASHBOARD: Dashboard = { id: "main", name: "My Orbital", widgets: TEMPLATES[0].widgets };
export const DEFAULT_ENVIRONMENT: Required<Omit<Environment, "activeDashboard">> & { activeDashboard: string } = {
  home: "chat", dashboards: [DEFAULT_DASHBOARD], activeDashboard: "main", nav: { order: [...NAV_KEYS], hidden: [] },
  contextPanel: "remember", accent: "white", corePalette: "spectrum", background: "plain", textSize: "default",
};

/** Limits the server enforces (and the app respects). */
export const LIMITS = { dashboards: 8, widgets: 24, name: 40 };
