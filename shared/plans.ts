/**
 * Orbital Pro. The desktop app gives everyone a 14-day trial of everything; after that, the Pro
 * features below need a subscription (Stripe, through the license service in license-server/).
 * Nothing made with a Pro feature is ever locked away: it stays readable, only creating new
 * Pro items needs Pro.
 */
export const TRIAL_DAYS = 14;

export const PRO_FEATURES = {
  research: "Deep research, the contradiction lab and hypothesis testing",
  meetings: "Video meetings and meeting recordings",
  media: "The Media library: screen, voice and camera recordings",
  opportunities: "Opportunity discovery",
  automations: "Automations",
  maintenance: "Knowledge health scans",
} as const;
export type ProFeature = keyof typeof PRO_FEATURES;

export const PRICES = {
  monthly: { amount: 10, label: "$10/month" },
  yearly: { amount: 96, label: "$96/year", note: "2 months free" },
} as const;
export type BillingPeriod = keyof typeof PRICES;

/** License keys look like ORB-<subscription>-<signature>. */
export const LICENSE_KEY = /^ORB-[A-Za-z0-9_-]{8,120}-[A-Za-z0-9_-]{16,64}$/;

export type PlanState = "pro" | "trial" | "free" | "unlimited";
