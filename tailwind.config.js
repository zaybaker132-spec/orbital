import defaults from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

/**
 * Themes. Every colour the app uses resolves to a CSS variable, so one class on <html> switches the whole
 * interface between dark (default) and light:
 * - `white` is the foreground and `black` the background, so "bg-white text-black" (a primary button)
 *   stays high-contrast in both themes.
 * - ink/mute/line are the greys between them.
 * - Accent palettes (red, amber, sky…) keep Tailwind's values in dark; in light, each shade borrows its
 *   mirror shade (200 ↔ 700), so the pale accents designed for black stay readable on white.
 */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const ACCENTS = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const MIRROR = { 50: 950, 100: 900, 200: 700, 300: 700, 400: 600, 500: 600, 600: 500, 700: 400, 800: 300, 900: 200, 950: 100 };
const channels = (hex) => { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`; };

const accentColors = Object.fromEntries(ACCENTS.map((c) => [c, Object.fromEntries(SHADES.map((s) => [s, v(`${c}-${s}`)]))]));
const accentVars = (light) => Object.fromEntries(ACCENTS.flatMap((c) => SHADES.map((s) => [`--c-${c}-${s}`, channels(defaults[c][light ? MIRROR[s] : s])])));

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        white: v("fg"),
        black: v("bg"),
        ink: { 0: v("ink-0"), 1: v("ink-1"), 2: v("ink-2"), 3: v("ink-3"), 4: v("ink-4") },
        line: { DEFAULT: "rgb(var(--c-fg) / 0.08)", strong: "rgb(var(--c-fg) / 0.14)" },
        mute: { DEFAULT: v("mute"), soft: v("mute-soft"), bright: v("mute-bright") },
        ...accentColors,
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        brand: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ":root": {
          "--c-fg": "255 255 255", "--c-bg": "0 0 0",
          "--c-ink-0": "0 0 0", "--c-ink-1": "8 8 8", "--c-ink-2": "17 17 17", "--c-ink-3": "24 24 24", "--c-ink-4": "34 34 34",
          "--c-mute": "136 136 136", "--c-mute-soft": "95 95 95", "--c-mute-bright": "180 180 180",
          ...accentVars(false),
        },
        "html.light": {
          "--c-fg": "17 17 20", "--c-bg": "255 255 255",
          "--c-ink-0": "255 255 255", "--c-ink-1": "248 248 249", "--c-ink-2": "241 241 243", "--c-ink-3": "234 234 237", "--c-ink-4": "224 224 228",
          "--c-mute": "104 104 112", "--c-mute-soft": "146 146 154", "--c-mute-bright": "64 64 70",
          ...accentVars(true),
        },
      });
    }),
  ],
};
