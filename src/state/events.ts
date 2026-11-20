import { useEffect } from "react";
import { useCore } from "./core";
import { invalidate } from "@/lib/resource";
import { toast, useJobs, useQuiet } from "./ui";
import { api } from "@/lib/api";
import { t, tn } from "@/i18n";

const runningResearch = new Set<string>();

/** Live doc traffic (edits, cursors, comments) for whichever doc editors are open, plus "reconnected" so they resync. */
type DocListener = (e: { type: string; docId?: string; [k: string]: any }) => void;
const docListeners = new Set<DocListener>();
export const onDocEvent = (fn: DocListener) => { docListeners.add(fn); return () => { docListeners.delete(fn); }; };

/** Subscribe to the server's live event stream. Every Neural Core state here reflects real work. */
export function useLiveEvents(enabled: boolean, workspaceId?: string) {
  useEffect(() => {
    if (!enabled) return;
    const core = useCore.getState();
    api.get("/growth").then((g) => core.setKnowledge(g.stats.kinds ?? {}, g.stats.volume.confirmedEdges + g.stats.volume.suggestedEdges)).catch(() => {});
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      // EventSource can't send headers: the workspace goes in the query string and is checked server-side.
      es = new EventSource(`/api/events${workspaceId ? `?workspace=${workspaceId}` : ""}`, { withCredentials: true });
      es.onmessage = (m) => handle(JSON.parse(m.data));
      // After a reconnect, open docs fetch whatever they missed while the stream was down.
      es.onopen = () => docListeners.forEach((fn) => fn({ type: "doc.reconnected" }));
      es.onerror = () => { es?.close(); retry = setTimeout(connect, 4000); };
    };
    connect();
    return () => { es?.close(); clearTimeout(retry); };
  }, [enabled, workspaceId]);
}

function handle(e: any) {
  if (typeof e.type === "string" && e.type.startsWith("doc.")) { docListeners.forEach((fn) => fn(e)); if (e.type === "doc.meta") invalidate("/docs"); return; }
  const core = useCore.getState();
  switch (e.type) {
    case "core":
      if (e.state === "idle") core.set("thinking", false);
      else if (e.state === "thinking") core.set("thinking", true, { detail: e.detail });
      else if (e.state === "learning") core.pulse("learning", 2600);
      else if (e.state === "connecting") core.pulse("connecting", 3200);
      else if (e.state === "opportunity") core.pulse("opportunity", 5200);
      else if (e.state === "researching") core.set("researching", true, { detail: e.detail });
      break;
    case "research": {
      const done = e.status === "completed" || e.status === "failed";
      if (done) runningResearch.delete(e.id);
      else runningResearch.add(e.id);
      core.set("researching", runningResearch.size > 0);
      if (done || !e.step) invalidate("/research");
      else invalidate(`/research/${e.id}`);
      if (e.status === "completed") { toast(t("Research report ready"), { action: { label: "Open", to: `/research/${e.id}` } }); invalidate("/conversations", "/growth", "/graph"); }
      if (e.status === "failed") toast(t("Research could not complete"), { tone: "error", action: { label: "View", to: `/research/${e.id}` } });
      break;
    }
    case "knowledge":
      if (e.nodesAdded) { core.pulse("learning", 2600); core.bump("concept", e.nodesAdded); }
      if (e.edgesAdded) { core.pulse("connecting", 3200); core.bumpEdges(e.edgesAdded); }
      if (e.memoriesAdded) core.bump("memory", e.memoriesAdded);
      if (e.pending) toast(t("Orbital proposed a memory for your review"), { action: { label: "Review", to: "/knowledge?tab=review" } });
      invalidate("/memories", "/graph", "/growth", "/documents", "/nodes");
      break;
    case "opportunities":
      useJobs.getState().setDiscovering(e.status === "started");
      if (e.status === "done") {
        invalidate("/opportunities", "/graph", "/growth");
        toast(e.count ? tn(e.count, "{n} new opportunity identified", "{n} new opportunities identified") : t("No well-grounded opportunities found yet"), { action: e.count ? { label: t("View"), to: "/opportunities" } : undefined });
      }
      if (e.status === "error") toast(e.error, { tone: "error" });
      break;
    case "actions":
      invalidate("/actions", "/automations", "/documents", "/projects", "/research", "/growth");
      break;
    case "maintenance":
      invalidate("/maintenance", "/nudges");
      break;
    case "extraction":
      invalidate(`/documents/${e.documentId}/extraction`);
      if (e.status === "completed") { invalidate("/graph", "/growth", "/search"); toast(t("Knowledge extracted"), { action: { label: "Open", to: `/knowledge/${e.documentId}?view=extraction` } }); }
      break;
    case "reminder": {
      invalidate("/reminders");
      toast(t("Reminder: {title}", { title: e.title }), { sticky: true, action: { label: e.link ? "Open" : "View", to: e.link ?? "/reminders" } });
      try {
        const desk = window.orbitalDesktop;
        // Desktop app: it shows a native notification unless Orbital's window is open and in front
        // (a hidden window can't tell from in here that it's hidden).
        if (!useQuiet.getState().on && desk?.notify) {
          void desk.notify({ title: t("Orbital reminder"), body: e.note ? `${e.title}\n${e.note}` : e.title, link: e.link ?? "/reminders" });
        } else if (!useQuiet.getState().on && !desk && "Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
          const n = new Notification("Orbital reminder", { body: e.note ? `${e.title}\n${e.note}` : e.title, tag: `reminder-${e.id}` });
          n.onclick = () => { window.focus(); location.assign(e.link ?? "/reminders"); };
        }
      } catch { /* notifications unavailable */ }
      break;
    }
    case "notice":
      toast(e.message, { tone: e.level === "warn" ? "error" : "info" });
      break;
  }
}
