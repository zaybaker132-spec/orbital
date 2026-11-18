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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${url}`, {
    method,
    credentials: "same-origin",
    headers: { "x-orbital-request": "1", ...wsHeader(), ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.statusText, code: string | undefined;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
      code = j.code;
    } catch { /* not json */ }
    throw new ApiError(res.status, msg, code);
  }
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
};

/** POST that streams Server-Sent Events back (chat responses). */
export async function streamPost(url: string, body: unknown, onEvent: (event: string, data: any) => void, signal?: AbortSignal) {
  const res = await fetch(`/api${url}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-orbital-request": "1", ...wsHeader() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
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
