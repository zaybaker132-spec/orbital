# Papers

Full documents, written in Orbital: like Google Docs, with Orbital's knowledge built in.

Open **Papers** in the sidebar (or `g d`, or "New document" in the command palette ⌘K / Ctrl K).

## Writing

- **Start from** a blank page or a template: meeting notes, project proposal, report, letter, brainstorm.
- **Menus:** File, Edit, View, Insert, Format, Tools. **Toolbar:** undo/redo, print, zoom, styles (normal text, headings 1–4,
  code), font, size, bold/italic/underline/strikethrough, text and highlight colour, link, comment, image, table,
  alignment, line spacing, checklists, bulleted and numbered lists, indent, quote, clear formatting.
- **Markdown shortcuts** while typing: `# ` heading, `- ` bullets, `1. ` numbers, `[] ` checklist, `> ` quote, `---` line.
- **Images:** insert, paste or drop them in (scaled down so the doc stays fast). **Tables:** add/remove rows and columns
  from the Format menu; drag column edges to resize. **Page breaks:** ⌘↵ / Ctrl+Enter.
- **Find and replace:** ⌘F / Ctrl+F; replace with ⌘⇧H on a Mac (⌘H hides apps there), Ctrl+H on Windows.
- **Outline** of your headings on the left; **word count** bottom-left (⌘⇧C / Ctrl+Shift+C).
- **View:** a white paper page (default) or a dark page; zoom 50–200%. The page shrinks to fit when panels are open.
- **Voice typing:** Tools → Voice typing (uses the same speech input as chat).
- **Everything saves automatically.** Offline? Keep writing: changes sync when the connection returns.

## Writing together

In a business workspace, everyone in the workspace can open the workspace's papers (your personal workspace stays
private). Several people can edit the same paper at once: each person's cursor shows with their name, edits merge
character by character (no "someone else changed this" conflicts), and the title, comments and formatting update live.
Viewers can read and follow along but not edit.

- **Comments:** select text → comment button (⌘⌥M / Ctrl+Alt+M). Reply, resolve, reopen; resolved threads hide their
  highlight. Others see new comments as they're posted.
- **Version history:** a version is saved automatically every ten minutes of writing. Name one ("Sent to client"), view any
  version, and restore it (restoring is itself undoable).

## Orbital helps

- **Ask Orbital** (toolbar): write something new ("a two-paragraph intro for investors"), drawing on what Orbital knows
  from your notes, memories and research if you want; or select text and improve it, fix spelling and grammar, make it
  shorter/longer/simpler, more professional or friendlier; continue writing, summarize, or suggest an outline. You see the
  result first and choose to replace, insert or discard. Needs an AI provider. Answers follow your language setting.
- **Papers are knowledge:** every paper is searchable from universal search, feeds Orbital's answers, and joins your
  knowledge graph, like any note.

## Sharing it outside Orbital

File → Download as **PDF** (via print: "Save as PDF" on Mac, "Microsoft Print to PDF" on Windows), **Word (.doc)**,
**Markdown**, **plain text** or **web page**, or Print.

## Desktop app (Mac and Windows)

Everything above works in the desktop app. Right-click gives spelling suggestions, cut/copy/paste and link actions; the
Edit menu's Undo/Redo work in papers; links open in your browser; downloads ask where to save.

## How it works

A paper is a `documents` row with `kind = 'doc'`. Its live content is a [Yjs](https://yjs.dev) document: editors send
their changes to `POST /api/docs/:id/sync`, the server merges them into the stored state and relays them to everyone
else over the workspace's live event stream; editors also exchange state vectors every few seconds (and on reconnect)
so nothing is lost or duplicated. Cursors travel the same way (`/awareness`, never stored). A moment after edits settle,
the editor saves a snapshot (HTML + Markdown text, `PUT /snapshot`) that search, answers, the knowledge graph, version
history and exports read. See `server/engines/docs.ts`, `server/routes/docs.ts`, `src/lib/docSync.ts`, `src/pages/docs/`.
