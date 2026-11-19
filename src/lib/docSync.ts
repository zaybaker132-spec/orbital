import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { api } from "./api";
import { onDocEvent } from "@/state/events";

/**
 * Keeps one open doc in step with the server and everyone else editing it.
 *
 * Local edits are batched (a few per second) and posted as Yjs updates; the server merges them and
 * relays them over the live event stream. Every few seconds — and whenever the stream reconnects or
 * the window regains focus — the editor also exchanges state vectors with the server, so anything
 * dropped on the way in either direction is recovered. Yjs makes all of this idempotent.
 */
const toB64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * The awareness object handed to the cursor plugin. Its "change" listeners redraw other people's
 * cursors; redraws wait while the mouse button is down so they don't rebuild the page under a click.
 */
function deferredAwareness(aw: Awareness): Awareness {
  let down = false;
  const queued = new Set<(...a: any[]) => void>();
  const flush = () => { const fns = [...queued]; queued.clear(); fns.forEach((fn) => fn()); };
  const onDown = () => { down = true; };
  const onUp = () => { down = false; setTimeout(flush, 0); };
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  const wrapped = new Map<Function, (...a: any[]) => void>();
  aw.on("destroy", () => { window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("pointerup", onUp, true); window.removeEventListener("pointercancel", onUp, true); });
  return new Proxy(aw, {
    get(target, prop) {
      if (prop === "on") return (ev: string, fn: (...a: any[]) => void) => {
        if (ev !== "change") return target.on(ev as any, fn);
        const w = (...args: any[]) => { if (down) queued.add(() => fn(...args)); else fn(...args); };
        wrapped.set(fn, w);
        return target.on("change", w);
      };
      if (prop === "off") return (ev: string, fn: (...a: any[]) => void) => target.off(ev as any, wrapped.get(fn) ?? fn);
      const v = (target as any)[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

export type SyncStatus = "connecting" | "saving" | "saved" | "offline" | "readonly";

export class DocSync {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  /** For the cursor plugin: same awareness, with redraws held while the mouse button is down. */
  readonly caretAwareness = deferredAwareness(this.awareness);
  readonly client = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  status: SyncStatus = "connecting";
  /** True once the server's content has been loaded into `doc`. */
  ready = false;
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private offs: (() => void)[] = [];
  private listeners = new Set<(s: SyncStatus) => void>();
  private destroyed = false;

  constructor(readonly docId: string, initial: string | null, readonly canWrite: boolean) {
    if (initial) Y.applyUpdate(this.doc, fromB64(initial), "server");
    this.ready = true;
    this.status = canWrite ? "saved" : "readonly";

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || origin === "server" || !this.canWrite) return;
      this.pending.push(update);
      this.set("saving");
      this.schedule();
    });
    this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === "remote") return;
      const changed = [...added, ...updated, ...removed];
      if (!changed.includes(this.doc.clientID)) return;
      void api.postQuiet(`/docs/${docId}/awareness`, { update: toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])), client: this.client }).catch(() => {});
    });
    this.offs.push(onDocEvent((e) => {
      if (e.type === "doc.reconnected") { void this.resync(); return; }
      if (e.docId !== docId || e.client === this.client) return;
      if (e.type === "doc.update") Y.applyUpdate(this.doc, fromB64(e.update), "remote");
      if (e.type === "doc.awareness") applyAwarenessUpdate(this.awareness, fromB64(e.update), "remote");
    }));
    const onFocus = () => void this.resync();
    const onOnline = () => { this.set(this.pending.length ? "saving" : "saved"); void this.flush(); void this.resync(); };
    const onOffline = () => this.set("offline");
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    this.offs.push(() => { window.removeEventListener("focus", onFocus); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); });
    this.timers.push(setInterval(() => void this.resync(), 8000));
    void this.resync();
  }

  onStatus(fn: (s: SyncStatus) => void) { this.listeners.add(fn); fn(this.status); return () => { this.listeners.delete(fn); }; }
  private set(s: SyncStatus) { if (this.status === s || this.status === "readonly") return; this.status = s; this.listeners.forEach((fn) => fn(s)); }
  get hasPending() { return this.pending.length > 0 || this.inflight; }

  private schedule() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, 120);
  }

  /** Send batched local edits. On failure they stay queued and are retried. */
  async flush() {
    if (this.inflight || !this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    this.inflight = true;
    try {
      await api.postQuiet(`/docs/${this.docId}/sync`, { update: toB64(Y.mergeUpdates(batch)), client: this.client });
      this.set(this.pending.length ? "saving" : "saved");
    } catch (e: any) {
      this.pending = [...batch, ...this.pending];
      this.set(navigator.onLine === false || !e?.status ? "offline" : "saving");
      if (!this.destroyed && e?.status !== 403) setTimeout(() => void this.flush(), 3000);
    } finally {
      this.inflight = false;
      if (this.pending.length && !this.flushTimer) this.schedule();
    }
  }

  /** Exchange state vectors: pull what we missed, push what the server is missing. */
  async resync() {
    if (this.destroyed) return;
    try {
      const r = await api.postQuiet<{ update: string | null; stateVector: string }>(`/docs/${this.docId}/sync`, { stateVector: toB64(Y.encodeStateVector(this.doc)), client: this.client });
      if (r.update) Y.applyUpdate(this.doc, fromB64(r.update), "remote");
      if (this.canWrite && !this.hasPending) {
        // Anything we wrote that the server never got (its clock for us is behind ours): send it again.
        const server = Y.decodeStateVector(fromB64(r.stateVector));
        const ahead = [...Y.decodeStateVector(Y.encodeStateVector(this.doc))].some(([client, clock]) => clock > (server.get(client) ?? 0));
        if (ahead) { this.pending.push(Y.encodeStateAsUpdate(this.doc, fromB64(r.stateVector))); this.set("saving"); this.schedule(); }
      }
      if (this.status === "offline") this.set(this.hasPending ? "saving" : "saved");
    } catch { this.set("offline"); }
  }

  destroy() {
    this.destroyed = true;
    void this.flush();
    removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    this.timers.forEach(clearInterval);
    this.offs.forEach((f) => f());
    this.awareness.destroy();
  }
}
