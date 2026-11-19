import { useMemo, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NeuralCore } from "@/neural/NeuralCore";
import { useCore } from "@/state/core";
import { api } from "@/lib/api";
import { OrbitalMark } from "@/components/Shell";
import { cx } from "@/components/ui";
import { AI_TOOLS, COMPUTERS, DEVICES, HEARD_FROM, MAX_RANKED, NOTES_APPS, PERSONAS, REMEMBER, SCALE } from "@shared/waitlist";
import { tx } from "@/i18n";
import { LanguagePicker } from "@/components/LanguagePicker";

/**
 * Public waitlist. While you answer, the Neural Core holds its knowledge-graph form and orbits;
 * every choice makes it flicker. Joining pulls it into Orbital's orb.
 */
interface Form {
  email: string; persona: string; remember: string[]; rememberOther: string; scale: string;
  aiTools: string[]; notesApps: string[]; computers: string[]; devices: string[]; heardFrom: string;
  discord: string; instagram: string; tiktok: string; compound: string; website: string; consent: boolean;
}
const EMPTY: Form = { email: "", persona: "", remember: [], rememberOther: "", scale: "", aiTools: [], notesApps: [], computers: [], devices: [], heardFrom: "", discord: "", instagram: "", tiktok: "", compound: "", website: "", consent: false };

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "Enter a valid email address";
  if (!f.persona) e.persona = "Pick one";
  if (!f.remember.length && !f.rememberOther.trim()) e.remember = "Pick at least one, or tell us";
  if (!f.scale) e.scale = "Pick one";
  if (!f.aiTools.length) e.aiTools = "Pick at least one";
  if (!f.notesApps.length) e.notesApps = "Pick at least one";
  if (!f.computers.length) e.computers = "Pick at least one";
  if (!f.devices.length) e.devices = "Pick at least one";
  if (!f.heardFrom) e.heardFrom = "Pick one";
  if (!f.consent) e.consent = "Tick this to join: it's how we'll tell you when you're in";
  for (const k of ["discord", "instagram", "tiktok"] as const) if (f[k] && !/^@?[A-Za-z0-9_.]+$/.test(f[k].trim())) e[k] = "Letters, numbers, dots and underscores only";
  return e;
}

export function WaitlistPage() {
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ position: number | null; confirmation?: string } | null>(null);
  const pulse = () => useCore.getState().pulse("learning", 900);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };
  const toggle = (k: "remember" | "aiTools" | "notesApps", v: string) => { pulse(); set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]); };
  const toggleRanked = (k: "computers" | "devices", v: string) => {
    pulse();
    const cur = f[k];
    if (cur.includes(v)) return set(k, cur.filter((x) => x !== v));
    if (v === "None") return set(k, ["None"]);
    const next = cur.filter((x) => x !== "None");
    if (next.length >= MAX_RANKED) return; // main + two more
    set(k, [...next, v]);
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    const e = validate(f);
    setErrors(e);
    if (Object.values(e).some(Boolean)) {
      const first = Object.keys(e).find((k) => e[k as keyof Form]);
      document.getElementById(`wl-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/public/waitlist", { ...f, email: f.email.trim() });
      setJoined({ position: r.position, confirmation: r.confirmation });
      useCore.getState().pulse("opportunity", 5000);
    } catch (err: any) {
      setServerError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-black lg:flex-row">
      {/* The orbiting graph */}
      <div className="relative h-[42vh] shrink-0 lg:sticky lg:top-0 lg:h-full lg:w-[48%]">
        <NeuralCore framing="head" holdGraph={!joined} className="absolute inset-0" label={tx("Orbital's Neural Core: a knowledge graph that pulls into an orb when you join")} />
        <a href="/login" className="absolute right-6 top-5 z-10 rounded-full border border-white/20 px-4 py-1.5 text-[0.75rem] uppercase tracking-[0.16em] text-white/85 transition-colors hover:border-white hover:text-white lg:hidden">{tx("Sign in")}</a>
        <div className="pointer-events-none absolute left-6 top-6 flex items-center gap-2.5 lg:left-10 lg:top-9">
          <OrbitalMark size={20} />
          <span className="text-[0.8rem] tracking-[0.32em] text-white">{tx("ORBITAL")}</span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black via-black/60 to-transparent px-10 pb-10 pt-24 lg:block">
          <AnimatePresence mode="wait">
            {joined ? (
              <motion.p key="in" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[0.9rem] text-white/80">{tx("Your Orbital is forming.")}</motion.p>
            ) : (
              <motion.p key="out" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-sm text-[0.9rem] leading-relaxed text-mute">
                {tx("Right now it's a graph of scattered ideas. Join, and watch them fall into orbit.")}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* The form */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 hidden items-center justify-end gap-5 bg-gradient-to-b from-black via-black/90 to-transparent px-10 pb-6 pt-6 lg:flex">
          <LanguagePicker />
          <a href="/login" className="rounded-full border border-white/20 px-4 py-1.5 text-[0.72rem] uppercase tracking-[0.16em] text-white/85 transition-colors hover:border-white hover:text-white">{tx("Already have access? Sign in")}</a>
        </div>
        <div className="mx-auto max-w-[600px] px-6 pb-20 pt-10 lg:px-10 lg:pt-4">
          <div className="mb-6 flex justify-end lg:hidden"><LanguagePicker /></div>
          <AnimatePresence mode="wait">
            {joined ? (
              <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }} className="pt-[12vh]">
                <div className="wl-label">{tx("Confirmed")}</div>
                <h1 className="mt-3 text-[2.2rem] font-light leading-[1.1] tracking-[-0.03em]">{tx("You're in orbit.")}</h1>
                {joined.position && (
                  <p className="mt-6 flex items-baseline gap-3">
                    <span className="font-mono text-[3rem] font-light tabular-nums tracking-tight text-white">#{joined.position}</span>
                    <span className="text-[0.9rem] text-mute">{tx("on the list")}</span>
                  </p>
                )}
                <p className="mt-6 max-w-md text-[0.95rem] leading-relaxed text-mute-bright">
                  {tx("We'll write to")} <span className="text-white">{f.email.trim()}</span> {tx("when your Orbital is ready. Until then, every idea you have is one it'll remember.")}
                </p>
                {joined.confirmation === "sent" && <p className="mt-4 max-w-md text-[0.88rem] leading-relaxed text-emerald-200/90">{tx("Check your inbox: we sent a link to confirm your address.")}</p>}
                {joined.confirmation === "failed" && <p className="mt-4 max-w-md text-[0.88rem] leading-relaxed text-amber-200/90">{tx("You're on the list, but we couldn't send the confirmation email just now. We'll still let you know when you're in.")}</p>}
                <button type="button" onClick={() => { setJoined(null); }} className="mt-10 text-[0.8rem] text-mute underline decoration-white/20 underline-offset-4 hover:text-white">{tx("Change my answers")}</button>
              </motion.div>
            ) : (
              <motion.form key="form" onSubmit={submit} noValidate initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                <div className="wl-label">{tx("Early access")}</div>
                <h1 className="mt-3 text-[2.2rem] font-light leading-[1.1] tracking-[-0.03em]">{tx("Enter the orbit.")}</h1>
                <p className="mt-3 max-w-md text-[0.92rem] leading-relaxed text-mute">{tx("An intelligence that compounds with everything you learn. Tell us how you think and work, and we'll bring you in.")}</p>

                <div className="mt-10 grid grid-cols-1 gap-x-8 gap-y-9 sm:grid-cols-2">
                  <Field id="email" label={tx("Email")} error={errors.email}>
                    <input id="wl-email" type="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder={tx("you@domain.com")} className="wl-input" />
                  </Field>
                  <Field id="persona" label={tx("You are")} error={errors.persona}>
                    <select id="wl-persona" value={f.persona} onChange={(e) => { pulse(); set("persona", e.target.value); }} className={cx("wl-input wl-select", !f.persona && "text-mute-soft")}>
                      <option value="" disabled>{tx("Choose one")}</option>
                      {PERSONAS.map((p) => <option key={p} value={p} className="bg-ink-2 text-white">{p}</option>)}
                    </select>
                  </Field>
                </div>

                <Section id="remember" label={tx("What should Orbital compound for you?")} hint={tx("Pick at least one")} error={errors.remember}>
                  <Chips options={REMEMBER} selected={f.remember} onToggle={(v) => toggle("remember", v)} />
                  <input value={f.rememberOther} onChange={(e) => set("rememberOther", e.target.value)} placeholder={tx("Something else: tell us")} className="wl-input mt-4" aria-label={tx("Something else Orbital should compound")} />
                </Section>

                <Section id="scale" label={tx("Who is it for?")} error={errors.scale}>
                  <Chips options={SCALE} selected={f.scale ? [f.scale] : []} onToggle={(v) => { pulse(); set("scale", v); }} single />
                </Section>

                <Section id="aiTools" label={tx("Which AI tools do you use most?")} hint={tx("Pick at least one")} error={errors.aiTools}>
                  <Chips options={AI_TOOLS} selected={f.aiTools} onToggle={(v) => toggle("aiTools", v)} />
                </Section>

                <Section id="notesApps" label={tx("Where do your notes live today?")} hint={tx("Pick at least one")} error={errors.notesApps}>
                  <Chips options={NOTES_APPS} selected={f.notesApps} onToggle={(v) => toggle("notesApps", v)} />
                </Section>

                <Section id="computers" label={tx("Which computers do you use?")} hint={tx("Main one first, then up to two more")} error={errors.computers}>
                  <Chips options={COMPUTERS} selected={f.computers} onToggle={(v) => toggleRanked("computers", v)} ranked />
                </Section>

                <Section id="devices" label={tx("Which phones or tablets?")} hint={tx("Main one first, then up to two more")} error={errors.devices}>
                  <Chips options={DEVICES} selected={f.devices} onToggle={(v) => toggleRanked("devices", v)} ranked />
                </Section>

                <Section id="heardFrom" label={tx("How did you hear about Orbital?")} error={errors.heardFrom}>
                  <select id="wl-heardFrom" value={f.heardFrom} onChange={(e) => { pulse(); set("heardFrom", e.target.value); }} className={cx("wl-input wl-select", !f.heardFrom && "text-mute-soft")} aria-label={tx("How did you hear about Orbital?")}>
                    <option value="" disabled>{tx("Choose one")}</option>
                    {HEARD_FROM.map((p) => <option key={p} value={p} className="bg-ink-2 text-white">{p}</option>)}
                  </select>
                </Section>

                <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-3">
                  <Field id="discord" label={tx("Discord")} optional error={errors.discord}>
                    <input id="wl-discord" value={f.discord} onChange={(e) => set("discord", e.target.value)} placeholder={tx("yourname")} className="wl-input" autoComplete="off" />
                  </Field>
                  <Field id="instagram" label={tx("Instagram")} optional error={errors.instagram}>
                    <input id="wl-instagram" value={f.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder={tx("@yourname")} className="wl-input" autoComplete="off" />
                  </Field>
                  <Field id="tiktok" label={tx("TikTok")} optional error={errors.tiktok}>
                    <input id="wl-tiktok" value={f.tiktok} onChange={(e) => set("tiktok", e.target.value)} placeholder={tx("@yourname")} className="wl-input" autoComplete="off" />
                  </Field>
                </div>

                <Section id="compound" label={tx("One line: what would you build if you never forgot anything?")} hint={tx("Optional")}>
                  <textarea id="wl-compound" rows={3} maxLength={500} value={f.compound} onChange={(e) => set("compound", e.target.value)} className="wl-input resize-none" aria-label={tx("What would you build if you never forgot anything?")} />
                </Section>

                {/* Spam trap: hidden from people and assistive tech */}
                <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => set("website", e.target.value)} className="absolute -left-[9999px] h-px w-px opacity-0" />

                <label id="wl-consent" className="mt-10 flex max-w-xl cursor-pointer items-start gap-3 text-[0.85rem] leading-relaxed text-mute-bright">
                  <input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} className="mt-1 h-4 w-4 accent-white" aria-describedby={errors.consent ? "wl-consent-err" : undefined} />
                  <span>{tx("Email me about my Orbital access and product updates. I can unsubscribe any time.")}</span>
                </label>
                {errors.consent && <p id="wl-consent-err" className="mt-2 text-[0.78rem] text-red-300">{tx(errors.consent)}</p>}
                {serverError && <p role="alert" className="mt-8 text-[0.85rem] text-red-300">{tx(serverError)}</p>}
                <div className="mt-10 flex flex-wrap items-center gap-5">
                  <button type="submit" disabled={busy} className="group relative h-12 overflow-hidden bg-white px-8 text-[0.75rem] font-medium uppercase tracking-[0.24em] text-black transition-opacity disabled:opacity-60">
                    <span className="relative z-10">{busy ? tx("Entering…") : tx("Enter orbit")}</span>
                    <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-black/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  </button>
                  <span className="text-[0.75rem] text-mute-soft">{tx("We'll only email you about Orbital.")}</span>
                </div>
                <p className="mt-8 border-t border-white/10 pt-6 text-[0.85rem] text-mute">{tx("Already have an account?")} <a href="/login" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">{tx("Sign in to Orbital →")}</a></p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Field({ id, label, optional, error, children }: { id: string; label: string; optional?: boolean; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={`wl-${id}`} className="wl-label block">{label}{optional && <span className="text-mute-soft"> {tx("(optional)")}</span>}</label>
      <div className="mt-3">{children}</div>
      {error && <p className="mt-2 text-[0.75rem] text-red-300">{error}</p>}
    </div>
  );
}

function Section({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <fieldset id={`wl-${id}`} className="mt-11 scroll-mt-24">
      <legend className="wl-label">{label}{hint && <span className="text-mute-soft"> · {hint}</span>}</legend>
      <div className="mt-4">{children}</div>
      {error && <p className="mt-2.5 text-[0.75rem] text-red-300">{error}</p>}
    </fieldset>
  );
}

function Chips({ options, selected, onToggle, ranked, single }: { options: readonly string[]; selected: string[]; onToggle: (v: string) => void; ranked?: boolean; single?: boolean }) {
  const order = useMemo(() => new Map(selected.map((v, i) => [v, i + 1])), [selected]);
  return (
    <div className="flex flex-wrap gap-2.5" role={single ? "radiogroup" : "group"}>
      {options.map((o) => {
        const on = order.has(o);
        return (
          <button key={o} type="button" onClick={() => onToggle(o)} role={single ? "radio" : undefined} aria-checked={single ? on : undefined} aria-pressed={single ? undefined : on}
            className={cx("wl-chip", on && "wl-chip-on")}>
            {ranked && on && o !== "None" && <span className="mr-2 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black font-mono text-[0.65rem] text-white">{order.get(o)}</span>}
            {o}
          </button>
        );
      })}
    </div>
  );
}
