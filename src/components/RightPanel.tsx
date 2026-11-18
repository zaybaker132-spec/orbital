import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePanel } from "@/state/ui";
import { useResource } from "@/lib/resource";
import { cx } from "./ui";
import { label } from "@/lib/format";

/**
 * Context panel: what informed the current answer (memories, knowledge, connected concepts,
 * document sources) plus live insights from the growth system. Pages can provide their own content.
 */
export function RightPanel() {
  const { answer, highlight, content, title } = usePanel();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center px-5 text-[0.8rem] text-mute">{content ? title : "Context"}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        {content ?? (
          <>
            {answer ? <AnswerContextView highlight={highlight} /> : <p className="py-2 text-[0.82rem] leading-relaxed text-mute">When Orbital answers, the memories, knowledge and sources it drew on appear here.</p>}
            <Insights />
          </>
        )}
      </div>
    </div>
  );
}

export function Section({ title, children, count }: { title: string; children: ReactNode; count?: number }) {
  return (
    <section className="mt-6 first:mt-2">
      <h3 className="label mb-2.5 flex items-center gap-2">{title}{count !== undefined && <span className="text-mute-soft">{count}</span>}</h3>
      {children}
    </section>
  );
}

function AnswerContextView({ highlight }: { highlight: string | null }) {
  const a = usePanel((s) => s.answer)!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.querySelector(`[data-ref="${highlight}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);
  const empty = !a.memories.length && !a.nodes.length && !a.connected.length && !a.documents.length;
  const item = (refId: string, children: ReactNode, to?: string) => (
    <li key={refId} data-ref={refId} className={cx("group -mx-2 rounded-lg px-2 py-1.5 transition-colors", highlight === refId ? "bg-white/[0.08]" : "hover:bg-white/[0.03]")}>
      <div className="flex gap-2.5">
        <span className="mt-0.5 shrink-0 font-mono text-[0.66rem] text-mute-soft">{refId}</span>
        <div className="min-w-0 text-[0.84rem] leading-snug text-white/85">{to ? <Link to={to} className="hover:text-white hover:underline decoration-white/30 underline-offset-2">{children}</Link> : children}</div>
      </div>
    </li>
  );
  return (
    <div ref={ref}>
      {a.project && <Section title="Project"><Link className="text-[0.85rem] text-white hover:underline" to={`/projects/${a.project.id}`}>{a.project.name}</Link></Section>}
      {empty && <p className="py-2 text-[0.82rem] leading-relaxed text-mute">Nothing in your knowledge base was relevant to this answer. As you add notes, memories and research, answers draw on them.</p>}
      {a.memories.length > 0 && (
        <Section title="Relevant memories" count={a.memories.length}>
          <ul>{a.memories.map((m) => item(m.ref, <>{m.content}<span className="ml-1.5 text-[0.7rem] text-mute">{label(m.category)}</span></>, "/knowledge?tab=memory"))}</ul>
        </Section>
      )}
      {a.nodes.length > 0 && (
        <Section title="Related knowledge" count={a.nodes.length}>
          <ul>{a.nodes.map((n) => item(n.ref, <>{n.title}<span className="ml-1.5 text-[0.7rem] text-mute">{n.kind}</span></>, `/connections?node=${n.id}`))}</ul>
        </Section>
      )}
      {a.connected.length > 0 && (
        <Section title="Connected concepts" count={a.connected.length}>
          <ul>{a.connected.map((n) => item(n.ref, <>{n.title}<span className="ml-1.5 text-[0.7rem] text-mute">via {n.via}</span></>, `/connections?node=${n.id}`))}</ul>
        </Section>
      )}
      {a.documents.length > 0 && (
        <Section title="Sources" count={a.documents.length}>
          <ul>{a.documents.map((d) => item(d.ref, <><span className="text-white">{d.title}</span><span className="mt-0.5 block text-[0.76rem] leading-snug text-mute">{d.excerpt}…</span></>, `/knowledge/${d.id}`))}</ul>
        </Section>
      )}
      {a.gaps.length > 0 && (
        <Section title="Open questions considered">
          <ul className="space-y-1.5">{a.gaps.map((g) => <li key={g.id} className="text-[0.82rem] leading-snug text-mute-bright">{g.question}</li>)}</ul>
        </Section>
      )}
    </div>
  );
}

function Insights() {
  const { data } = useResource<any>("/growth/maintenance");
  if (!data) return null;
  const items: { text: string; to: string }[] = [];
  if (data.pendingMemories) items.push({ text: `${data.pendingMemories} proposed memor${data.pendingMemories === 1 ? "y" : "ies"} awaiting review`, to: "/knowledge?tab=review" });
  if (data.contradictions.length) items.push({ text: `${data.contradictions.length} possible contradiction${data.contradictions.length === 1 ? "" : "s"} in your knowledge`, to: "/core#maintenance" });
  if (data.duplicates.length) items.push({ text: `${data.duplicates.length} near-duplicate memor${data.duplicates.length === 1 ? "y" : "ies"}`, to: "/core#maintenance" });
  if (data.gaps.length) items.push({ text: `${data.gaps.length} unresolved question${data.gaps.length === 1 ? "" : "s"}`, to: "/core#questions" });
  if (data.outdated.length) items.push({ text: `${data.outdated.length} memor${data.outdated.length === 1 ? "y" : "ies"} may be outdated`, to: "/core#maintenance" });
  if (!items.length) return null;
  return (
    <Section title="Insights">
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.text}><Link to={i.to} className="block rounded-lg py-1 text-[0.83rem] text-mute-bright transition-colors hover:text-white">{i.text} →</Link></li>
        ))}
      </ul>
    </Section>
  );
}
