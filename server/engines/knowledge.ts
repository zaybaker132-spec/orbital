import { db, toVector } from "../db/client.js";
import { embed, embeddingModelId } from "../ai/embeddings.js";
import { linkWikiBacklinks, linkWikiReferences, upsertNode, deleteNodeByRef } from "./graph.js";
import { logActivity } from "../lib/activity.js";
import { registerJob, enqueue } from "../lib/jobs.js";

/** Knowledge management: documents become searchable chunks and graph nodes. */

export function chunkText(text: string, target = 900, overlap = 120): string[] {
  const paras = text.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > target * 1.5) {
      if (cur) { chunks.push(cur); cur = ""; }
      for (let i = 0; i < p.length; i += target - overlap) chunks.push(p.slice(i, i + target));
      continue;
    }
    if ((cur + "\n\n" + p).length > target && cur) {
      chunks.push(cur);
      cur = cur.slice(-overlap) + "\n\n" + p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks.slice(0, 400);
}

const docKind = (kind: string) => (kind === "note" ? "note" : "document") as "note" | "document";

export async function indexDocument(workspaceId: string, docId: string) {
  const d = (await db().query<any>("SELECT id, title, body, kind, tags FROM documents WHERE id=$1 AND workspace_id=$2", [docId, workspaceId])).rows[0];
  if (!d) return;
  const chunks = chunkText(`${d.title}\n\n${d.body}`);
  const vectors = await embed(chunks);
  await db().tx(async (q) => {
    await q.query("DELETE FROM document_chunks WHERE document_id=$1 AND workspace_id=$2", [docId, workspaceId]);
    for (let i = 0; i < chunks.length; i++) {
      await q.query("INSERT INTO document_chunks(document_id, workspace_id, idx, content, embedding, embedding_model) VALUES ($1,$2,$3,$4,$5,$6)",
        [docId, workspaceId, i, chunks[i], toVector(vectors[i]), embeddingModelId()]);
    }
  });
  const nodeId = await upsertNode(workspaceId, {
    kind: docKind(d.kind), title: d.title, summary: d.body.replace(/\s+/g, " ").slice(0, 1200),
    category: d.tags?.[0] ?? "", refType: "document", refId: docId,
  });
  await linkWikiReferences(workspaceId, nodeId, d.body);
  await linkWikiBacklinks(workspaceId, nodeId, d.title);
}

registerJob("document.index", async ({ workspaceId, payload }) => indexDocument(workspaceId, payload.documentId));

export async function createDocument(workspaceId: string, input: { title: string; body: string; kind?: string; tags?: string[]; folderId?: string | null; projectId?: string | null; sourceUrl?: string | null; fileName?: string | null; mimeType?: string | null; aiGenerated?: boolean }) {
  const r = await db().query<any>(
    `INSERT INTO documents(workspace_id, title, body, kind, tags, folder_id, project_id, source_url, file_name, mime_type, ai_generated)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, title, kind, created_at`,
    [workspaceId, input.title.slice(0, 300) || "Untitled", input.body, input.kind ?? "note", (input.tags ?? []).map(cleanTag).filter(Boolean),
     input.folderId ?? null, input.projectId ?? null, input.sourceUrl ?? null, input.fileName ?? null, input.mimeType ?? null, !!input.aiGenerated],
  );
  const doc = r.rows[0];
  if (input.projectId) await db().query("INSERT INTO project_links(project_id, workspace_id, item_type, item_id) VALUES ($1,$2,'document',$3) ON CONFLICT DO NOTHING", [input.projectId, workspaceId, doc.id]);
  await logActivity(workspaceId, input.kind === "web_clip" ? "document.clipped" : input.fileName ? "document.imported" : "document.created", doc.title, { type: "document", id: doc.id });
  await enqueue(workspaceId, "document.index", { documentId: doc.id });
  return doc;
}

export const cleanTag = (t: string) => t.trim().toLowerCase().replace(/^#/, "").replace(/[^\p{L}\p{N}_/-]+/gu, "-").slice(0, 40);

export async function updateDocument(workspaceId: string, id: string, patch: { title?: string; body?: string; tags?: string[]; folderId?: string | null; projectId?: string | null }) {
  const cur = (await db().query<any>("SELECT * FROM documents WHERE id=$1 AND workspace_id=$2", [id, workspaceId])).rows[0];
  if (!cur) return null;
  const r = await db().query<any>(
    `UPDATE documents SET title=$3, body=$4, tags=$5, folder_id=$6, project_id=$7, updated_at=now() WHERE id=$1 AND workspace_id=$2
     RETURNING id, title, body, kind, tags, folder_id, project_id, source_url, file_name, ai_generated, created_at, updated_at`,
    [id, workspaceId, patch.title ?? cur.title, patch.body ?? cur.body, (patch.tags ?? cur.tags).map(cleanTag).filter(Boolean),
     patch.folderId !== undefined ? patch.folderId : cur.folder_id, patch.projectId !== undefined ? patch.projectId : cur.project_id],
  );
  if (patch.title !== undefined || patch.body !== undefined || patch.tags !== undefined) await enqueue(workspaceId, "document.index", { documentId: id });
  return r.rows[0];
}

export async function deleteDocument(workspaceId: string, id: string) {
  const r = await db().query("DELETE FROM documents WHERE id=$1 AND workspace_id=$2 RETURNING id", [id, workspaceId]);
  if (r.rows.length) {
    await deleteNodeByRef(workspaceId, "document", id);
    await db().query("DELETE FROM project_links WHERE workspace_id=$1 AND item_type='document' AND item_id=$2", [workspaceId, id]);
  }
  return r.rows.length > 0;
}

/** Suggested related knowledge for a document: nearest nodes plus existing graph links. */
export async function relatedForDocument(workspaceId: string, id: string) {
  const node = (await db().query<{ id: string }>("SELECT id FROM knowledge_nodes WHERE workspace_id=$1 AND ref_type='document' AND ref_id=$2", [workspaceId, id])).rows[0];
  if (!node) return { nodeId: null, related: [] };
  const r = await db().query(
    `SELECT n.id, n.kind, n.title, n.ref_type, n.ref_id, round((1 - (n.embedding <=> s.embedding))::numeric, 3) AS similarity,
            (SELECT e.status FROM knowledge_edges e WHERE e.workspace_id=$1 AND ((e.source_id=s.id AND e.target_id=n.id) OR (e.source_id=n.id AND e.target_id=s.id)) LIMIT 1) AS link_status
     FROM knowledge_nodes n, knowledge_nodes s
     WHERE s.id=$2 AND n.workspace_id=$1 AND s.workspace_id=$1 AND n.id<>s.id AND n.embedding_model = s.embedding_model
     ORDER BY n.embedding <=> s.embedding LIMIT 8`,
    [workspaceId, node.id],
  );
  return { nodeId: node.id, related: r.rows };
}

export async function extractPdfText(buf: Buffer) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), pages: totalPages };
}
