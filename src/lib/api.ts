import { language } from "@/i18n";
/** Thin typed client. All state-changing requests carry the CSRF header the server requires. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Active workspace (tenant). Sent with every request; the server checks membership. */
let workspaceId: string | null = null;
try { workspaceId = localStorage.getItem("orbital.workspace"); } catch { /* private mode */ }
export const getWorkspaceId = () => workspaceId;
export function setWorkspaceId(id: string | null) {
  workspaceId = id;
  try { id ? localStorage.setItem("orbital.workspace", id) : localStorage.removeItem("orbital.workspace"); } catch { /* ignore */ }
}
const wsHeader = (): Record<string, string> => (workspaceId ? { "x-orbital-workspace": workspaceId } : {});

/** "This needs Orbital Pro" from the server opens the upgrade window (registered by components/Plan). */
const proListeners = new Set<(feature: string | null) => void>();
export const onProRequired = (fn: (feature: string | null) => void) => { proListeners.add(fn); return () => proListeners.delete(fn); };
const proRequired = (status: number, code: string | undefined, feature: unknown) => {
  if (status === 402 && code === "pro_required") proListeners.forEach((fn) => fn(typeof feature === "string" ? feature : null));
};

/** Called after any successful change (so views that summarise activity can refresh). */
const mutationListeners = new Set<() => void>();
export const onMutation = (fn: () => void) => { mutationListeners.add(fn); return () => mutationListeners.delete(fn); };

async function request<T>(method: string, url: string, body?: unknown, quiet = false): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${url}`, {
    method,
    credentials: "same-origin",
    headers: { "x-orbital-request": "1", "x-orbital-language": language(), ...wsHeader(), ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.statusText, code: string | undefined, feature: unknown;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
      code = j.code;
      feature = j.feature;
    } catch { /* not json */ }
    proRequired(res.status, code, feature);
    throw new ApiError(res.status, msg, code);
  }
  if (method !== "GET" && !quiet) mutationListeners.forEach((fn) => fn());
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  get: <T = any>(url: string) => request<T>("GET", url),
  post: <T = any>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  patch: <T = any>(url: string, body: unknown) => request<T>("PATCH", url, body),
  put: <T = any>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  del: <T = any>(url: string) => request<T>("DELETE", url),
  upload: <T = any>(url: string, form: FormData) => request<T>("POST", url, form),
  /** For high-frequency background writes (live doc edits) that shouldn't refresh activity views. */
  postQuiet: <T = any>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}, true),
  putQuiet: <T = any>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}, true),
};

/** POST that streams Server-Sent Events back (chat responses). */
export async function streamPost(url: string, body: unknown, onEvent: (event: string, data: any) => void, signal?: AbortSignal) {
  const res = await fetch(`/api${url}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-orbital-request": "1", "x-orbital-language": language(), ...wsHeader() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = res.statusText, code: string | undefined;
    try { const j = await res.json(); msg = j.error ?? msg; code = j.code; proRequired(res.status, code, j.feature); } catch { /* ignore */ }
    throw new ApiError(res.status, msg, code);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message", data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}
