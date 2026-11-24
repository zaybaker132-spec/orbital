import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { create } from "zustand";
import { Check, Sparkles } from "lucide-react";
import { api, onProRequired } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { toast, toastError } from "@/state/ui";
import { Badge, Button, Dialog, Input, cx } from "./ui";
import { locale, t, tx } from "@/i18n";
import type { PlanState } from "../../shared/plans";

/**
 * Orbital Pro in the app: the plan (trial, Pro, free), the upgrade window that opens when a Pro
 * feature is used after the trial, the Settings → Plan section and the sidebar's trial badge.
 */
export interface PlanInfo {
  enabled: boolean; state: PlanState; trialEndsAt: string | null; trialDaysLeft: number; trialDays: number;
  license: null | { plan: string | null; email: string | null; status: string | null; renewsAt: string | null; cancelAtPeriodEnd: boolean; keyEnding: string };
  features: Record<string, string>; prices: { monthly: { label: string }; yearly: { label: string; note: string } };
  buyUrl: { monthly: string; yearly: string } | null;
}
export const usePlan = () => useResource<PlanInfo>("/plan").data;

/** The upgrade window: opened by any "this is a Pro feature" answer from the server. */
const useUpgrade = create<{ feature: string | null; open: boolean; show(feature?: string | null): void; close(): void }>((set) => ({
  feature: null, open: false,
  show: (feature = null) => set({ open: true, feature }),
  close: () => set({ open: false }),
}));
export const showUpgrade = (feature?: string | null) => useUpgrade.getState().show(feature);
onProRequired((feature) => showUpgrade(feature));

const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

function Buy({ plan, compact }: { plan: PlanInfo; compact?: boolean }) {
  if (!plan.buyUrl) return null;
  return (
    <div className={cx("flex flex-wrap gap-2", compact && "justify-center")}>
      <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => openExternal(plan.buyUrl!.monthly)}>{tx("Get Pro · {price}", { price: tx(plan.prices.monthly.label) })}</Button>
      <Button onClick={() => openExternal(plan.buyUrl!.yearly)}>{tx("{price} · {note}", { price: tx(plan.prices.yearly.label), note: tx(plan.prices.yearly.note) })}</Button>
    </div>
  );
}

function KeyEntry({ initial = "", onDone }: { initial?: string; onDone?: () => void }) {
  const [key, setKey] = useState(initial);
  const [busy, setBusy] = useState(false);
  const activate = async (k = key) => {
    if (!k.trim()) return;
    setBusy(true);
    try {
      await api.post("/plan/activate", { key: k.trim() }); invalidate("/plan"); toast(tx("Welcome to Orbital Pro!")); setKey(""); onDone?.();
      // Don't leave the key in the page address (it came from an "Activate in Orbital" link).
      if (location.search.includes("license=")) history.replaceState(history.state, "", `${location.pathname}${location.hash}`);
    }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  // Arriving from the purchase page ("Activate in Orbital"): activate straight away.
  useEffect(() => { if (initial) void activate(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void activate(); }}>
      <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder={tx("ORB-…")} aria-label={tx("License key")} autoComplete="off" spellCheck={false} className="font-mono text-[0.8rem]" />
      <Button type="submit" loading={busy} disabled={!key.trim()}>{tx("Activate")}</Button>
    </form>
  );
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" }) : "");

export function UpgradeDialog() {
  const { open, feature, close } = useUpgrade();
  const plan = usePlan();
  const [haveKey, setHaveKey] = useState(false);
  useEffect(() => { if (open) { setHaveKey(false); invalidate("/plan"); } }, [open]);
  if (!plan?.enabled) return null;
  return (
    <Dialog open={open} onClose={close} title={tx("Orbital Pro")} width="max-w-md">
      <p className="text-[0.88rem] leading-relaxed text-mute-bright">
        {feature ? tx("That's part of Orbital Pro, and your free trial has ended.") : tx("Unlock everything in Orbital.")}
        {" "}{tx("Everything you've already made stays here.")}
      </p>
      <ul className="mt-4 space-y-1.5 text-[0.84rem]">
        {Object.entries(plan.features).map(([k, f]) => <li key={k} className={cx("flex gap-2", k === feature ? "font-medium text-white" : "text-white/80")}><Check size={15} className="mt-0.5 shrink-0 text-white" />{tx(f)}</li>)}
      </ul>
      <div className="mt-5"><Buy plan={plan} /></div>
      <p className="mt-2 text-[0.74rem] text-mute">{tx("Checkout opens in your browser (Stripe). Cancel any time.")}</p>
      <div className="mt-4 border-t border-line pt-3">
        {haveKey ? <KeyEntry onDone={close} /> : <button className="text-[0.8rem] text-mute-bright underline decoration-white/20 underline-offset-2 hover:text-white" onClick={() => setHaveKey(true)}>{tx("I already have a license key")}</button>}
      </div>
    </Dialog>
  );
}

/** Settings → Plan. */
export function PlanSettings({ Group, Row }: { Group: any; Row: any }) {
  const plan = usePlan();
  const [busy, setBusy] = useState(false);
  const fromLink = new URLSearchParams(location.search).get("license") ?? "";
  if (!plan?.enabled) return null;
  const manage = async () => {
    setBusy(true);
    try { const r = await api.post("/plan/manage"); openExternal(r.url); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(tx("Remove the license from this computer? Your subscription isn't cancelled; you can add the key again any time."))) return;
    try { await api.del("/plan/license"); invalidate("/plan"); } catch (e) { toastError(e); }
  };
  const l = plan.license;
  return (
    <Group id="plan" title={tx("Plan")} description={tx("Pro unlocks deep research, meetings, the Media library and more. Everything else in Orbital is free.")}>
      <Row label={tx("Your plan")}>
        {plan.state === "pro" ? <span className="flex flex-wrap items-center gap-2"><Badge tone="ok">{tx("Orbital Pro")}</Badge>{l?.plan === "yearly" ? tx("Yearly") : tx("Monthly")}</span>
          : plan.state === "trial" ? <span className="flex flex-wrap items-center gap-2"><Badge>{tx("Pro trial")}</Badge>{t(plan.trialDaysLeft === 1 ? "1 day left" : "{n} days left", { n: plan.trialDaysLeft })} · {tx("ends {date}", { date: fmtDate(plan.trialEndsAt) })}</span>
          : <span className="flex flex-wrap items-center gap-2"><Badge tone="warn">{tx("Free")}</Badge>{tx("Your Pro trial has ended.")}</span>}
      </Row>
      {plan.state === "pro" && l && (
        <Row label={tx("Subscription")}>
          <div className="text-[0.84rem] text-mute-bright">
            {l.cancelAtPeriodEnd ? tx("Cancelled · Pro until {date}", { date: fmtDate(l.renewsAt) }) : l.renewsAt ? tx("Renews {date}", { date: fmtDate(l.renewsAt) }) : null}
            {l.email && <> · {l.email}</>} · <span className="font-mono">…{l.keyEnding}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={manage}>{tx("Manage subscription")}</Button>
            <Button size="sm" variant="ghost" onClick={remove}>{tx("Remove from this computer")}</Button>
          </div>
        </Row>
      )}
      {plan.state !== "pro" && (
        <>
          <Row label={tx("Upgrade")}>
            <Buy plan={plan} />
            <p className="mt-1.5 text-[0.76rem] text-mute">{tx("Checkout opens in your browser (Stripe). Cancel any time.")}</p>
          </Row>
          <Row label={tx("License key")}>
            <KeyEntry initial={fromLink} />
            <p className="mt-1.5 text-[0.76rem] text-mute">{tx("Bought Pro already? Paste the key from your purchase page.")}</p>
          </Row>
        </>
      )}
    </Group>
  );
}

/** Sidebar: how long the trial has left, or a way to upgrade once it's over. */
export function PlanBadge({ collapsed }: { collapsed: boolean }) {
  const plan = usePlan();
  if (!plan?.enabled || plan.state === "pro" || plan.state === "unlimited" || collapsed) return null;
  const urgent = plan.state === "free" || plan.trialDaysLeft <= 3;
  return (
    <NavLink to="/settings#plan" className={cx("mx-2.5 mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[0.78rem] transition-colors", urgent ? "border-white/30 text-white hover:bg-white/[0.05]" : "border-line text-mute-bright hover:text-white")}>
      <Sparkles size={13} className="shrink-0" />
      <span className="truncate">{plan.state === "free" ? tx("Upgrade to Pro") : t(plan.trialDaysLeft === 1 ? "Pro trial · 1 day left" : "Pro trial · {n} days left", { n: plan.trialDaysLeft })}</span>
    </NavLink>
  );
}
