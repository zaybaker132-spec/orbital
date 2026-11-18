import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Globe, Scissors } from "lucide-react";
import { api } from "@/lib/api";
import { useResource, invalidate } from "@/lib/resource";
import { Button, Input, Select, Textarea, cx } from "@/components/ui";

/**
 * The web clipper's landing page. The "Clip to Orbital" bookmarklet opens it in a small window with
 * the page's address, title and any selected text; it also works on its own with a pasted link.
 */
export function ClipPage({ embedded = false, onDone }: { embedded?: boolean; onDone?: () => void }) {
  const [params] = useSearchParams();
  const [url, setUrl] = useState(embedded ? "" : params.get("url") ?? "");
  const [title, setTitle] = useState(embedded ? "" : params.get("title") ?? "");
  const [selection, setSelection] = useState(embedded ? "" : params.get("sel") ?? "");
  const [note, setNote] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; title: string; existing?: boolean; partial?: boolean } | null>(null);
  const { data: projects } = useResource<any[]>("/projects");
  const popup = !embedded && !!window.opener;

  const save = async () => {
    setError(null);
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    try { new URL(u); } catch { return setError("Enter a web address, like https://example.com/article."); }
    setBusy(true);
    try {
      const d = await api.post("/clip", { url: u, title: title.trim() || undefined, selection: selection.trim() || undefined, note: note.trim() || undefined, projectId: projectId || null });
      setSaved(d);
      invalidate("/documents", "/tags", "/graph", "/growth");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't clip that page.");
    } finally { setBusy(false); }
  };

  const body = saved ? (
    <div className="grid justify-items-start gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black"><Check size={16} /></span>
      <h1 className="text-[1.3rem] font-light tracking-[-0.02em]">{saved.existing ? "Already in Orbital" : "Saved to Orbital"}</h1>
      <p className="text-[0.88rem] text-mute">{saved.title}{saved.partial ? " — your selection was saved; the full page couldn't be fetched." : ""}</p>
      <div className="mt-1 flex gap-2">
        {popup ? (
          <>
            <Button variant="primary" onClick={() => { window.opener?.focus?.(); window.open(`/knowledge/${saved.id}`, "_blank", "noopener"); }}>Open in Orbital</Button>
            <Button onClick={() => window.close()}>Close</Button>
          </>
        ) : (
          <>
            <Link to={`/knowledge/${saved.id}`} onClick={onDone} className="inline-flex h-9 items-center rounded-lg bg-white px-3.5 text-[0.88rem] text-black hover:bg-white/90">Open</Link>
            <Button onClick={() => { setSaved(null); setUrl(""); setTitle(""); setSelection(""); setNote(""); }}>Clip another</Button>
          </>
        )}
      </div>
    </div>
  ) : (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {!embedded && (
        <div className="flex items-center gap-2">
          <Scissors size={15} className="text-mute" />
          <h1 className="text-[1.15rem] font-light tracking-[-0.01em]">Clip to Orbital</h1>
        </div>
      )}
      <label className="grid gap-1.5"><span className="label">Page</span>
        <div className="relative"><Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" className="pl-9" autoFocus={!url} inputMode="url" /></div>
      </label>
      <label className="grid gap-1.5"><span className="label">Title <span className="normal-case tracking-normal text-mute-soft">optional</span></span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Taken from the page if left empty" /></label>
      {selection && (
        <div className="grid gap-1.5"><span className="label">Your highlight</span>
          <blockquote className="max-h-32 overflow-y-auto border-l border-white/30 pl-3 text-[0.84rem] text-white/80">{selection}</blockquote></div>
      )}
      <label className="grid gap-1.5"><span className="label">Note <span className="normal-case tracking-normal text-mute-soft">optional</span></span>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you're saving it" autoFocus={!!url} /></label>
      {projects && projects.length > 0 && (
        <Select label="Project" value={projectId} onChange={setProjectId} options={[{ value: "", label: "No project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
      )}
      {error && <p className="text-[0.84rem] text-red-300" role="alert">{error}</p>}
      <Button variant="primary" type="submit" loading={busy} className="justify-self-start">Save to Orbital</Button>
      <p className="text-[0.76rem] text-mute-soft">Orbital fetches the page and keeps the article text, so it's searchable and joins your knowledge graph.</p>
    </form>
  );

  if (embedded) return body;
  return (
    <div className="flex min-h-full items-start justify-center bg-black px-5 py-8">
      <div className={cx("w-full max-w-[460px]")}>{body}</div>
    </div>
  );
}

/** A draggable "Clip to Orbital" bookmarklet for this server. */
export function ClipBookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const code = `(()=>{var s=String(getSelection()).slice(0,8000),u=${JSON.stringify(location.origin + "/clip")}+'?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+'&sel='+encodeURIComponent(s);var w=open(u,'orbital-clip','width=500,height=640');if(!w)location.href=u;})()`;
    // Set directly on the element: React refuses javascript: URLs in JSX.
    ref.current?.setAttribute("href", `javascript:${encodeURIComponent(code)}`);
  }, []);
  return (
    <a ref={ref} onClick={(e) => e.preventDefault()} draggable
      className="inline-flex h-8 cursor-grab items-center gap-2 rounded-lg border border-dashed border-white/30 px-3 text-[0.82rem] text-white hover:border-white/60">
      <Scissors size={13} /> Clip to Orbital
    </a>
  );
}
