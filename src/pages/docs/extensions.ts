import { Extension, Mark, Node, mergeAttributes, type AnyExtension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Color, FontFamily, FontSize, LineHeight, TextStyle } from "@tiptap/extension-text-style";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: { setComment: (threadId: string) => ReturnType; unsetComment: (threadId: string) => ReturnType };
    pageBreak: { setPageBreak: () => ReturnType };
    indent: { indent: () => ReturnType; outdent: () => ReturnType };
    search: {
      setSearch: (term: string, caseSensitive?: boolean) => ReturnType;
      searchNext: () => ReturnType;
      searchPrev: () => ReturnType;
      replaceCurrent: (text: string) => ReturnType;
      replaceAll: (text: string) => ReturnType;
    };
  }
}

/** A passage someone commented on. The thread itself lives on the server; the mark just anchors it. */
export const Comment = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",
  addAttributes() { return { threadId: { default: null, parseHTML: (el) => el.getAttribute("data-comment"), renderHTML: (a) => ({ "data-comment": a.threadId }) } }; },
  parseHTML() { return [{ tag: "span[data-comment]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { class: "doc-comment" }), 0]; },
  addCommands() {
    return {
      setComment: (threadId) => ({ commands }) => commands.setMark(this.name, { threadId }),
      unsetComment: (threadId) => ({ tr, state, dispatch }) => {
        const type = state.schema.marks.comment;
        state.doc.descendants((node, pos) => {
          node.marks.forEach((m) => { if (m.type === type && m.attrs.threadId === threadId) tr.removeMark(pos, pos + node.nodeSize, m); });
        });
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});

/** Start the next part on a new page when printed or saved as PDF. */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() { return [{ tag: "div[data-page-break]" }]; },
  renderHTML() { return ["div", { "data-page-break": "", class: "page-break" }]; },
  addCommands() { return { setPageBreak: () => ({ chain }) => chain().insertContent({ type: this.name }).focus().run() }; },
  addKeyboardShortcuts() { return { "Mod-Enter": () => this.editor.commands.setPageBreak() }; },
});

/** Paragraph and heading indentation (Tab / Shift-Tab outside lists, like a word processor). */
export const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (el) => Math.min(8, Math.round((parseFloat(el.style.marginLeft) || 0) / 36)),
          renderHTML: (a) => (a.indent ? { style: `margin-left: ${a.indent * 36}px` } : {}),
        },
      },
    }];
  },
  addCommands() {
    const step = (d: number) => () => ({ tr, state, dispatch }: any) => {
      let changed = false;
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node: any, pos: number) => {
        if (node.type.name !== "paragraph" && node.type.name !== "heading") return;
        const next = Math.max(0, Math.min(8, (node.attrs.indent ?? 0) + d));
        if (next !== node.attrs.indent) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next }); changed = true; }
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return { indent: step(1), outdent: step(-1) };
  },
  addKeyboardShortcuts() {
    const inList = () => this.editor.isActive("listItem") || this.editor.isActive("taskItem");
    return {
      Tab: () => (inList() ? false : this.editor.commands.indent() || true),
      "Shift-Tab": () => (inList() ? false : this.editor.commands.outdent() || true),
    };
  },
});

// ── Find & replace ──────────────────────────────────────────────────────────
export interface SearchState { term: string; caseSensitive: boolean; results: { from: number; to: number }[]; index: number }
const searchKey = new PluginKey<SearchState>("docSearch");
export const searchState = (editor: Editor): SearchState => searchKey.getState(editor.state) ?? { term: "", caseSensitive: false, results: [], index: 0 };

function findAll(doc: any, term: string, caseSensitive: boolean) {
  const out: { from: number; to: number }[] = [];
  if (!term) return out;
  const needle = caseSensitive ? term : term.toLowerCase();
  doc.descendants((node: any, pos: number) => {
    if (!node.isTextblock) return;
    // Text of the block with positions, so matches can span bold/italic boundaries.
    let text = ""; const map: number[] = [];
    node.descendants((child: any, offset: number) => {
      if (child.isText) { for (let i = 0; i < child.text.length; i++) { map.push(pos + 1 + offset + i); } text += child.text; }
      else if (child.isLeaf) { map.push(pos + 1 + offset); text += "￼"; }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + Math.max(1, needle.length))) out.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
    return false;
  });
  return out;
}

export const Search = Extension.create({
  name: "search",
  addProseMirrorPlugins() {
    return [new Plugin<SearchState>({
      key: searchKey,
      state: {
        init: () => ({ term: "", caseSensitive: false, results: [], index: 0 }),
        apply(tr, prev) {
          const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
          if (!meta && !tr.docChanged) return prev;
          const term = meta?.term ?? prev.term, caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
          const results = findAll(tr.doc, term, caseSensitive);
          const index = Math.min(meta?.index ?? prev.index, Math.max(0, results.length - 1));
          return { term, caseSensitive, results, index };
        },
      },
      props: {
        decorations(state) {
          const s = searchKey.getState(state);
          if (!s?.results.length) return null;
          return DecorationSet.create(state.doc, s.results.map((r, i) => Decoration.inline(r.from, r.to, { class: i === s.index ? "search-hit current" : "search-hit" })));
        },
      },
    })];
  },
  addCommands() {
    const go = (d: number) => () => ({ state, tr, dispatch, view }: any) => {
      const s = searchKey.getState(state)!;
      if (!s.results.length) return false;
      const index = (s.index + d + s.results.length) % s.results.length;
      if (dispatch) {
        dispatch(tr.setMeta(searchKey, { index }));
        const dom = view.domAtPos(s.results[index].from);
        (dom.node as HTMLElement)?.parentElement?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      }
      return true;
    };
    return {
      setSearch: (term, caseSensitive = false) => ({ tr, dispatch }) => { if (dispatch) dispatch(tr.setMeta(searchKey, { term, caseSensitive, index: 0 })); return true; },
      searchNext: go(1),
      searchPrev: go(-1),
      replaceCurrent: (text) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state)!;
        const hit = s.results[s.index];
        if (!hit) return false;
        if (dispatch) { tr.insertText(text, hit.from, hit.to); dispatch(tr); }
        return true;
      },
      replaceAll: (text) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state)!;
        if (!s.results.length) return false;
        if (dispatch) { [...s.results].reverse().forEach((r) => tr.insertText(text, r.from, r.to)); dispatch(tr); }
        return true;
      },
    };
  },
});

/**
 * Undo/redo that arrive as the system's "historyUndo" (the desktop app's Edit menu and ⌘Z on a Mac,
 * the right-click menu) rather than as a key press the editor sees. Collaborative undo doesn't
 * listen for these by itself.
 */
export const SystemUndo = Extension.create({
  name: "systemUndo",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      props: {
        handleDOMEvents: {
          beforeinput: (_view, event) => {
            const type = (event as InputEvent).inputType;
            if (type !== "historyUndo" && type !== "historyRedo") return false;
            event.preventDefault();
            if (type === "historyUndo") editor.commands.undo(); else editor.commands.redo();
            return true;
          },
        },
      },
    })];
  },
});

export const FONTS = [
  { label: "Inter", value: "" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
  { label: "JetBrains Mono", value: "'JetBrains Mono', monospace" },
];

export interface CollabOptions { doc: Y.Doc; awareness: Awareness; user: { name: string; color: string } }

/** Everything the doc editor understands. Without `collab` it's a plain editor (version previews, templates). */
export function docExtensions(opts: { collab?: CollabOptions; placeholder?: string } = {}): AnyExtension[] {
  const exts: AnyExtension[] = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      // Real-time collaboration brings its own undo history (only your own changes are undone).
      undoRedo: opts.collab ? false : undefined,
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
    }),
    TaskList, TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight.configure({ multicolor: true }),
    Image.configure({ allowBase64: true, inline: false }),
    TextStyle, Color, FontFamily, FontSize, LineHeight.configure({ types: ["paragraph", "heading"] }),
    CharacterCount,
    Comment, PageBreak, Indent, Search,
  ];
  if (opts.placeholder) exts.push(Placeholder.configure({ placeholder: opts.placeholder }));
  if (opts.collab) {
    exts.push(Collaboration.configure({ document: opts.collab.doc, field: "content" }), SystemUndo);
    exts.push(CollaborationCaret.configure({ provider: { awareness: opts.collab.awareness }, user: opts.collab.user }));
  }
  return exts;
}
