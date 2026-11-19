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
  // /reset-password?token=… opens straight into choosing a new password.
  const resetToken = location.pathname === "/reset-password" ? new URLSearchParams(location.search).get("token") : null;
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">(resetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      if (mode === "forgot") {
        await api.post("/auth/password/forgot", { email });
        setInfo(tx("If an account exists for that address, a reset link is on its way. It expires in an hour."));
      } else if (mode === "reset") {
        if (password !== password2) { setError(tx("The new passwords don't match.")); return; }
        await api.post("/auth/password/reset", { token: resetToken, password });
        location.assign("/"); // signed in with the new password; a full load drops the token from the address
        return;
      } else {
        await api.post(`/auth/${mode}`, mode === "signup" ? { email, password, displayName: name || undefined } : { email, password });
        await load();
      }
    } catch (err: any) { setError(tx(err.message)); } finally { setBusy(false); }
  };
  const go = (m: typeof mode) => { setMode(m); setError(null); setInfo(null); };

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
        <motion.form initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} onSubmit={submit} className="w-full max-w-[340px]" aria-label={mode === "signup" ? tx("Create account") : mode === "forgot" ? tx("Reset your password") : mode === "reset" ? tx("Choose a new password") : tx("Sign in")}>
          <OrbitalMark size={26} />
          <h1 className="mt-6 text-[1.3rem] font-light tracking-[-0.015em]">{mode === "login" ? tx("Welcome back") : mode === "signup" ? tx("Create your Orbital") : mode === "forgot" ? tx("Reset your password") : tx("Choose a new password")}</h1>
          <p className="mt-1 text-[0.85rem] text-mute">{mode === "login" ? tx("Sign in to continue.") : mode === "signup" ? tx("A private knowledge system that grows with you.") : mode === "forgot" ? tx("We'll email you a link to choose a new password.") : tx("Every device signed in to your account will be signed out.")}</p>
          <div className="mt-7 space-y-3">
            {mode === "signup" && <Input placeholder={tx("Name (optional)")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-label={tx("Name")} />}
            {mode !== "reset" && <Input type="email" placeholder={tx("Email")} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required aria-label={tx("Email")} autoFocus />}
            {mode !== "forgot" && <Input type="password" placeholder={mode === "login" ? tx("Password") : mode === "reset" ? tx("New password (at least 10 characters)") : tx("Password (10+ characters)")} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? undefined : 10} aria-label={mode === "reset" ? tx("New password") : tx("Password")} autoFocus={mode === "reset"} />}
            {mode === "reset" && <Input type="password" placeholder={tx("Repeat new password")} value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required minLength={10} aria-label={tx("Repeat new password")} />}
            <ErrorNote error={error} />
            {info && <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[0.82rem] text-emerald-100" role="status">{info}</p>}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>{mode === "login" ? tx("Sign in") : mode === "signup" ? tx("Create account") : mode === "forgot" ? tx("Send reset link") : tx("Save and sign in")}</Button>
            {mode === "login" && <button type="button" className="w-full text-center text-[0.78rem] text-mute hover:text-white" onClick={() => go("forgot")}>{tx("Forgot your password?")}</button>}
          </div>
          {mode === "signup" && !signupAllowed && <p className="mt-3 text-[0.76rem] leading-relaxed text-mute">{tx("Orbital is invite-only for now. Use the email you joined the waitlist with once you've been let in.")}</p>}
          <p className="mt-6 text-center text-[0.82rem] text-mute">
            {mode === "login" ? tx("New to Orbital? ") : tx("Already have an account? ")}
            <button type="button" className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white" onClick={() => go(mode === "login" ? "signup" : "login")}>
              {mode === "login" ? tx("Create an account") : tx("Sign in")}
            </button>
          </p>
          <p className="mt-6 text-center text-[0.8rem] text-mute"><a href="/waitlist" className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white">{tx("Join the waitlist")}</a> {tx("for early access")}</p>
          <p className="mt-10 text-center text-[0.72rem] leading-relaxed text-mute-soft">{tx("Your data stays on this server and is never used to answer anyone else's questions.")}</p>
          <div className="mt-4 flex justify-center"><LanguagePicker /></div>
        </motion.form>
      </div>
    </div>
  );
}
