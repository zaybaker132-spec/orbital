import * as Y from "yjs";
import { db } from "../db/client.js";
import { emit } from "../lib/events.js";
import { enqueueOnce } from "../lib/jobs.js";
import { createDocument } from "./knowledge.js";

/**
 * Docs: full documents edited together in real time.
 *
 * The live state of a doc is a Yjs document. Every editor sends its changes as Yjs updates; the
 * server merges them into the stored state and relays them to everyone else with the doc open
 * (over the workspace's live event stream). Yjs merges concurrent edits without conflicts, so two
 * people typing in the same paragraph both keep their words. Editors also re-sync by state vector
 * every few seconds, so a dropped connection never loses or duplicates text.
 *
 * Alongside the live state, the editor saves a snapshot (HTML + plain text) a moment after
 * changes settle: that's what search, Orbital's answers, the knowledge graph and exports read.
 */

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** One writer at a time per doc: merges are read-modify-write. */
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(id, next);
  try { return await next; } finally { if (locks.get(id) === next) locks.delete(id); }
}

export class DocError extends Error { constructor(message: string, public status = 400) { super(message); } }

export async function getState(workspaceId: string, id: string) {
  const r = (await db().query<{ ydoc: Buffer | null }>("SELECT ydoc FROM documents WHERE id=$1 AND workspace_id=$2 AND kind='doc'", [id, workspaceId])).rows[0];
  if (!r) return null;
  return r.ydoc ? new Uint8Array(r.ydoc) : new Uint8Array(Y.encodeStateAsUpdate(new Y.Doc()));
}

/**
 * Exchange changes with one editor. `update` (optional) is merged and relayed to the others;
 * `stateVector` (optional) asks for whatever the editor hasn't seen. Returns the missing changes and
 * the server's own state vector, so the editor can send back anything the server is missing.
 */
export async function sync(workspaceId: string, id: string, input: { update?: string; stateVector?: string; client: string }, canWrite: boolean) {
  if (input.update && !canWrite) throw new DocError("Viewers can read this doc but not change it.", 403);
  return withLock(id, async () => {
    const found = await getState(workspaceId, id);
    if (!found) throw new DocError("Doc not found", 404);
    let state: Uint8Array = found;
    if (input.update) {
      const update = fromB64(input.update);
      if (update.byteLength > 8 * 1024 * 1024) throw new DocError("That change is too large.");
      let merged: Uint8Array;
      try { merged = Y.mergeUpdates([state, update]); } catch { throw new DocError("Couldn't read that change."); }
      // Keep the stored state compact: merging update logs grows it; re-encoding through a doc garbage-collects deletions.
      if (merged.byteLength > 512 * 1024) { const d = new Y.Doc(); Y.applyUpdate(d, merged); merged = Y.encodeStateAsUpdate(d); }
      if (merged.byteLength > 24 * 1024 * 1024) throw new DocError("This doc has reached its size limit.");
      state = merged;
      await db().query("UPDATE documents SET ydoc=$3 WHERE id=$1 AND workspace_id=$2", [id, workspaceId, Buffer.from(state)]);
      emit(workspaceId, { type: "doc.update", docId: id, update: input.update, client: input.client });
    }
    let missing: Uint8Array | null = null;
    if (input.stateVector !== undefined) {
      try { missing = Y.diffUpdate(state, fromB64(input.stateVector)); } catch { missing = state; }
    }
    return { update: missing ? b64(missing) : null, stateVector: b64(Y.encodeStateVectorFromUpdate(state)) };
  });
}

/** Cursors and selections: relayed, never stored. */
export function relayAwareness(workspaceId: string, id: string, update: string, client: string) {
  if (update.length > 64 * 1024) throw new DocError("Too large");
  emit(workspaceId, { type: "doc.awareness", docId: id, update, client });
}

const VERSION_EVERY_MS = 10 * 60_000;

/** The editor's snapshot: what search, answers, the graph and exports read. Also keeps version history. */
export async function saveSnapshot(workspaceId: string, id: string, userId: string, s: { title: string; html: string; text: string; words: number }) {
  return withLock(`${id}:snapshot`, async () => {
    const cur = (await db().query<any>("SELECT html, body, title FROM documents WHERE id=$1 AND workspace_id=$2 AND kind='doc'", [id, workspaceId])).rows[0];
    if (!cur) throw new DocError("Doc not found", 404);
    const title = s.title.trim().slice(0, 300) || "Untitled document";
    const changed = cur.html !== s.html || cur.title !== title;
    if (!changed) return { saved: false };
    await db().query("UPDATE documents SET title=$3, html=$4, body=$5, words=$6, updated_at=now(), updated_by=$7 WHERE id=$1 AND workspace_id=$2",
      [id, workspaceId, title, s.html, s.text, s.words, userId]);
    // Version history: an automatic version at most every ten minutes while people write.
    const last = (await db().query<{ created_at: Date }>("SELECT created_at FROM doc_versions WHERE document_id=$1 ORDER BY created_at DESC LIMIT 1", [id])).rows[0];
    if (!last || Date.now() - new Date(last.created_at).getTime() > VERSION_EVERY_MS) {
      await db().query("INSERT INTO doc_versions(document_id, workspace_id, title, html, body, words, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, workspaceId, title, s.html, s.text, s.words, userId]);
    }
    if (cur.body !== s.text || cur.title !== title) await enqueueOnce(workspaceId, "document.index", "documentId", { documentId: id });
    if (cur.title !== title) emit(workspaceId, { type: "doc.meta", docId: id });
    return { saved: true };
  });
}

export async function createDoc(workspaceId: string, userId: string, input: { title?: string; html?: string; text?: string; projectId?: string | null; folderId?: string | null; ydoc?: Uint8Array | null }) {
  const doc = await createDocument(workspaceId, { title: input.title?.trim() || "Untitled document", body: input.text ?? "", kind: "doc", projectId: input.projectId ?? null, folderId: input.folderId ?? null });
  await db().query("UPDATE documents SET html=$3, ydoc=$4, created_by=$5, updated_by=$5, words=$6 WHERE id=$1 AND workspace_id=$2",
    [doc.id, workspaceId, input.html ?? "", input.ydoc ? Buffer.from(input.ydoc) : null, userId, countWords(input.text ?? "")]);
  return doc;
}

export const countWords = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

/** The first editor to open a doc made from HTML (a template, a note, a restored version) turns it into live content. */
export async function claimSeed(workspaceId: string, id: string) {
  const r = await db().query("UPDATE documents SET page = page || '{\"seeded\":true}'::jsonb WHERE id=$1 AND workspace_id=$2 AND kind='doc' AND NOT (page ? 'seeded') AND ydoc IS NULL RETURNING id", [id, workspaceId]);
  return r.rows.length > 0;
}

/** Rename from outside the editor (the docs list): changes the live title too, so open editors update. */
export async function renameDoc(workspaceId: string, id: string, title: string, userId: string) {
  const clean = title.trim().slice(0, 300) || "Untitled document";
  await withLock(id, async () => {
    const state = await getState(workspaceId, id);
    if (!state) throw new DocError("Doc not found", 404);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const before = Y.encodeStateVector(doc);
    doc.getMap("meta").set("title", clean);
    const update = Y.encodeStateAsUpdate(doc, before);
    await db().query("UPDATE documents SET ydoc=$3, title=$4, updated_at=now(), updated_by=$5 WHERE id=$1 AND workspace_id=$2", [id, workspaceId, Buffer.from(Y.encodeStateAsUpdate(doc)), clean, userId]);
    emit(workspaceId, { type: "doc.update", docId: id, update: b64(update), client: "server" });
  });
  emit(workspaceId, { type: "doc.meta", docId: id });
  await enqueueOnce(workspaceId, "document.index", "documentId", { documentId: id });
}
