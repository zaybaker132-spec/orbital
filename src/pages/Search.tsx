import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Brain, CheckSquare, Compass, FileText, FolderKanban, Globe, Lightbulb, MessageSquare, Paperclip, Search as SearchIcon, Layers, FlaskConical } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader, Pulse, cx } from "@/components/ui";
import { timeAgo } from "@/lib/format";

const TYPES = [
  { value: "conversation", label: "Conversations", icon: MessageSquare },
  { value: "note", label: "Notes", icon: FileText },
  { value: "file", label: "Files", icon: Paperclip },
  { value: "clip", label: "Web clips", icon: Globe },
  { value: "research", label: "Research", icon: Compass },
  { value: "extracted", label: "Extracted", icon: Layers },
  { value: "hypothesis", label: "Hypotheses", icon: FlaskConical },
  { value: "memory", label: "Memories", icon: Brain },
  { value: "project", label: "Projects", icon: FolderKanban },
  { value: "task", label: "Tasks", icon: CheckSquare },
  { value: "opportunity", label: "Opportunities", icon: Lightbulb },
] as const;
const ICON = Object.fromEntries(TYPES.map((t) => [t.value, t.icon]));

/** Render the server's ⟦highlight⟧ markers as <mark> without injecting HTML. */
/** Snippets come from Markdown: drop the syntax so they read as plain sentences. */
const plain = (t: string) => t.replace(/\[\[|\]\]/g, "").replace(/\*\*|__|`/g, "").replace(/(^|\s)[_*](\S[^_*]*?)[_*](?=\s|[.,;:]|$)/g, "$1$2").replace(/^#+\s*/gm, "").replace(/\s*\n\s*/g, " ");

function Highlighted({ text }: { text: string }) {
  const parts = plain(text).split(/(⟦[^⟧]*⟧)/g);
  return <>{parts.map((p, i) => p.startsWith("⟦") ? <mark key={i} className="rounded-sm bg-white/15 px-0.5 text-white">{p.slice(1, -1)}</mark> : <Fragment key={i}>{p}</Fragment>)}</>;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get("q") ?? "");
  const types = (params.get("types") ?? "").split(",").filter(Boolean);
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = params.get("q") ?? "";

  // Type to search: update the URL after a short pause so results are shareable and Back works.
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim() !== query) setParams((p) => { const n = new URLSearchParams(p); if (q.trim()) n.set("q", q.trim()); else n.delete("q"); return n; }, { replace: true }); }, 250);
    return () => clearTimeout(t);
  }, [q, query, setParams]);

  useEffect(() => {
    if (!query) { setResults(null); return; }
    let live = true;
    setLoading(true); setError(null);
    api.get(`/search/all?q=${encodeURIComponent(query)}${types.length ? `&types=${types.join(",")}` : ""}`)
      .then((r) => { if (live) { setResults(r); setCursor(0); } })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, params.get("types")]);

  const toggleType = (t: string) => {
    const next = types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
    setParams((p) => { const n = new URLSearchParams(p); if (next.length) n.set("types", next.join(",")); else n.delete("types"); return n; });
  };
  const counts = results?.reduce<Record<string, number>>((m, r) => ({ ...m, [r.type]: (m[r.type] ?? 0) + 1 }), {}) ?? {};

  return (
    <div className="h-full overflow-y-auto pb-16">
      <PageHeader title="Search" subtitle={<>Every conversation, note, file, web clip and research report. Use <span className="font-mono text-[0.8rem]">"exact phrase"</span>, <span className="font-mono text-[0.8rem]">or</span> and <span className="font-mono text-[0.8rem]">-exclude</span>.</>} />
      <div className="mx-auto max-w-[900px] px-8">
        <div className="relative">
          <SearchIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
          <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search everything" placeholder="Search everything"
            onKeyDown={(e) => {
              if (!results?.length) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
              if (e.key === "Enter") navigate(results[cursor].link);
            }}
            className="input h-12 pl-11 text-[1rem]" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
          {TYPES.map((t) => (
            <button key={t.value} onClick={() => toggleType(t.value)} aria-pressed={types.includes(t.value)}
              className={cx("inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[0.78rem] transition-colors", types.includes(t.value) ? "border-white bg-white text-black" : "border-line text-mute-bright hover:text-white")}>
              <t.icon size={12} />{t.label}{results && !types.length && counts[t.value] ? <span className="opacity-60">{counts[t.value]}</span> : null}
            </button>
          ))}
        </div>

        <div className="mt-6" aria-live="polite">
          {loading && !results && <div className="py-8 text-center"><Pulse /></div>}
          {error && <p className="text-[0.86rem] text-red-300">{error}</p>}
          {!query && <p className="py-8 text-center text-[0.88rem] text-mute">Search finds words inside your conversations, notes, imported files, web clips and research reports, not just titles.</p>}
          {results && results.length === 0 && !loading && <p className="py-8 text-center text-[0.88rem] text-mute">Nothing matches “{query}”{types.length ? " in the selected types" : ""}.</p>}
          <ul className={cx("divide-y divide-line", loading && "opacity-60")}>
            {results?.map((r, i) => {
              const Icon = ICON[r.type] ?? FileText;
              return (
                <li key={`${r.type}:${r.id}`}>
                  <Link to={r.link} onMouseEnter={() => setCursor(i)} className={cx("flex gap-3 rounded-lg px-3 py-3 transition-colors", i === cursor ? "bg-white/[0.05]" : "hover:bg-white/[0.03]")}>
                    <Icon size={15} className="mt-0.5 shrink-0 text-mute" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-3"><span className="truncate text-[0.92rem] text-white">{r.title}</span><span className="ml-auto shrink-0 text-[0.7rem] text-mute-soft">{timeAgo(r.at)}</span></div>
                      <div className="text-[0.72rem] text-mute">{r.meta}</div>
                      {r.snippet && <p className="mt-1 line-clamp-2 text-[0.82rem] leading-relaxed text-mute-bright"><Highlighted text={r.snippet} /></p>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
