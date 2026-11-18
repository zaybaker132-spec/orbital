import { config, EMBEDDING_DIM } from "../config.js";

/**
 * Embeddings for semantic retrieval.
 *  - local: hashed unigram+bigram features with light stemming. Deterministic, private, offline.
 *    It captures lexical overlap and morphology, not deep synonymy — documented as such in the UI.
 *  - openai: any OpenAI-compatible /embeddings endpoint, truncated to EMBEDDING_DIM via `dimensions`.
 */
export const embeddingModelId = () => (config.embeddings.provider === "openai" ? `remote:${config.embeddings.model}:${EMBEDDING_DIM}` : `local-hash-v1:${EMBEDDING_DIM}`);

const STOP = new Set("a an the and or but if then of to in on at for with by from as is are was were be been being it its this that these those i me my we our you your he she they them their what which who whom how why when where do does did done have has had not no so than too very can could should would will just about into over under also there here more most some any each other such only own same both few all".split(" "));

function stem(w: string) {
  for (const suf of ["ational", "ization", "fulness", "ousness", "iveness", "ations", "ation", "ments", "ment", "ness", "ings", "ing", "ies", "ied", "edly", "ers", "est", "ed", "ly", "es", "s"]) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) return suf === "ies" || suf === "ied" ? w.slice(0, -suf.length) + "y" : w.slice(0, -suf.length);
  }
  return w;
}

export function tokenize(text: string) {
  return (text.toLowerCase().normalize("NFKD").match(/[a-z0-9][a-z0-9+#.-]*/g) ?? [])
    .map((t) => t.replace(/[.-]+$/, ""))
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function localEmbed(text: string): number[] {
  const v = new Float64Array(EMBEDDING_DIM);
  const toks = tokenize(text);
  const add = (feat: string, w: number) => {
    const h = fnv1a(feat);
    v[h % EMBEDDING_DIM] += (h & 0x80000000 ? -1 : 1) * w;
  };
  const tf = new Map<string, number>();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const [t, n] of tf) {
    add(`u:${t}`, 1 + Math.log(n));
    if (t.length >= 5) for (let i = 0; i + 4 <= t.length; i += 2) add(`g:${t.slice(i, i + 4)}`, 0.25);
  }
  for (let i = 0; i + 1 < toks.length; i++) add(`b:${toks[i]}_${toks[i + 1]}`, 0.6);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => x / norm);
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  if (config.embeddings.provider !== "openai") return texts.map(localEmbed);
  const res = await fetch(`${config.embeddings.baseUrl}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY || ""}` },
    body: JSON.stringify({ model: config.embeddings.model, input: texts.map((t) => t.slice(0, 8000)), dimensions: EMBEDDING_DIM }),
  });
  if (!res.ok) throw new Error(`Embeddings error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  return j.data.map((d: any) => d.embedding as number[]);
}

export const embedOne = async (text: string) => (await embed([text]))[0];

export function cosine(a: number[], b: number[]) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na * nb) || 1);
}
