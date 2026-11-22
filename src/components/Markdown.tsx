import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { memo } from "react";
import { tx } from "@/i18n";

/**
 * Markdown renderer. Context references like [M2] / [K1] / [C3] / [D1] become chips that
 * reveal what informed the answer; numeric [3] references become source links when provided.
 */
export const Markdown = memo(function Markdown({ text, onRef, sources }: { text: string; onRef?: (ref: string) => void; sources?: { ref_number: number; url: string; title: string }[] }) {
  let src = text.replace(/\[([MKCD]\d{1,2})\]/g, (_m, r) => `[${r}](#ref-${r})`);
  if (sources?.length) src = src.replace(/\[(\d{1,3})\](?!\()/g, (m, n) => (sources.some((s) => s.ref_number === +n) ? `[${n}](#src-${n})` : m));
  return (
    <div className="prose-orbital">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#ref-")) {
              const ref = href.slice(5);
              return (
                <button type="button" onClick={() => onRef?.(ref)} title={tx("Show what informed this")}
                  className="mx-px inline-flex translate-y-[-1px] items-center rounded border border-white/15 px-1 font-mono text-[0.68rem] leading-4 text-white/70 no-underline hover:border-white/40 hover:text-white">
                  {ref}
                </button>
              );
            }
            if (href?.startsWith("#src-")) {
              const s = sources?.find((x) => x.ref_number === +href.slice(5));
              return <a href={s?.url} target="_blank" rel="noreferrer noopener" title={s?.title} className="!no-underline font-mono text-[0.72rem] text-sky-200/80 hover:text-sky-100">[{children}]</a>;
            }
            const safe = href && /^(https?:|mailto:|\/)/i.test(href) ? href : undefined;
            // Links inside Orbital open in place (no reload); everything else in a new tab.
            if (safe?.startsWith("/") && !safe.startsWith("//")) return <Link to={safe}>{children}</Link>;
            return <a href={safe} target="_blank" rel="noreferrer noopener">{children}</a>;
          },
          img: () => null, // no remote images from model output or documents
        }}
      >
        {src}
      </ReactMarkdown>
    </div>
  );
});
