import { useState } from "react";
import { motion } from "framer-motion";
import { NeuralCore } from "@/neural/NeuralCore";
import { api } from "@/lib/api";
import { useApp } from "@/state/app";
import { Button, ErrorNote, Input } from "@/components/ui";
import { OrbitalMark } from "@/components/Shell";
import { tx } from "@/i18n";
import { LanguagePicker } from "@/components/LanguagePicker";

export function AuthPage() {
  const signupAllowed = useApp((s) => s.signupAllowed);
  const load = useApp((s) => s.load);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(`/auth/${mode}`, mode === "signup" ? { email, password, displayName: name || undefined } : { email, password });
      await load();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="relative grid h-full grid-cols-1 bg-black lg:grid-cols-[1.25fr_1fr]">
      <div className="relative hidden lg:block">
        <NeuralCore framing="full" className="absolute inset-0" />
        <div className="pointer-events-none absolute bottom-10 left-12">
          <div className="text-[0.82rem] tracking-[0.32em] text-white">{tx("ORBITAL")}</div>
          <p className="mt-2 text-[1.5rem] font-light tracking-[-0.02em] text-white">{tx("Your intelligence. Compounding.")}</p>
          <p className="mt-1 text-[0.86rem] text-mute">{tx("The more you learn, the more valuable your Orbital becomes.")}</p>
        </div>
      </div>
      <div className="flex items-center justify-center border-l border-line px-8">
        <motion.form initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} onSubmit={submit} className="w-full max-w-[340px]" aria-label={mode === "login" ? tx("Sign in") : tx("Create account")}>
          <OrbitalMark size={26} />
          <h1 className="mt-6 text-[1.3rem] font-light tracking-[-0.015em]">{mode === "login" ? tx("Welcome back") : tx("Create your Orbital")}</h1>
          <p className="mt-1 text-[0.85rem] text-mute">{mode === "login" ? tx("Sign in to continue.") : tx("A private knowledge system that grows with you.")}</p>
          <div className="mt-7 space-y-3">
            {mode === "signup" && <Input placeholder={tx("Name (optional)")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-label={tx("Name")} />}
            <Input type="email" placeholder={tx("Email")} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required aria-label={tx("Email")} autoFocus />
            <Input type="password" placeholder={mode === "signup" ? tx("Password (10+ characters)") : tx("Password")} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 10 : undefined} aria-label={tx("Password")} />
            <ErrorNote error={error} />
            <Button type="submit" variant="primary" className="w-full" loading={busy}>{mode === "login" ? tx("Sign in") : tx("Create account")}</Button>
          </div>
          {signupAllowed && (
            <p className="mt-6 text-center text-[0.82rem] text-mute">
              {mode === "login" ? tx("New to Orbital? ") : tx("Already have an account? ")}
              <button type="button" className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}>
                {mode === "login" ? tx("Create an account") : tx("Sign in")}
              </button>
            </p>
          )}
          <p className="mt-6 text-center text-[0.8rem] text-mute"><a href="/waitlist" className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white">{tx("Join the waitlist")}</a> {tx("for early access")}</p>
          <p className="mt-10 text-center text-[0.72rem] leading-relaxed text-mute-soft">{tx("Your data stays on this server and is never used to answer anyone else's questions.")}</p>
          <div className="mt-4 flex justify-center"><LanguagePicker /></div>
        </motion.form>
      </div>
    </div>
  );
}
