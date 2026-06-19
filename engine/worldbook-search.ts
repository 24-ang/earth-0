/**
 * TF-IDF 世界书检索引擎
 *
 * 从 pi-stage 移植：中文 bigram 分词 + 余弦相似度匹配。
 * 不转换 ST 世界书格式，直接读 JSON 按触发词+内容做检索。
 *
 * 用法:
 *   import { loadWorldbook, searchWorldbook } from "./worldbook-search.ts";
 *   const wb = loadWorldbook("worldpacks/oregairu/动漫角色.json");
 *   const results = searchWorldbook(wb, "侍奉部", { topK: 3, maxTokens: 2000 });
 */

import fs from "node:fs";
import path from "node:path";

// ── 类型 ──

export interface WorldbookEntry {
  id: string;
  keys: string[];         // 触发词
  content: string;
  comment?: string;
}

export interface WorldbookIndex {
  entries: WorldbookEntry[];
  idf: Map<string, number>; // term → inverse document frequency
  vectors: Map<string, Map<string, number>>; // entry id → term → tfidf weight
}

export interface SearchResult {
  entry: WorldbookEntry;
  score: number; // cosine similarity
}

// ── 加载 ──

/** 从 ST 世界书 JSON 加载并建索引。跳过 disabled 条目。 */
export function loadWorldbook(filePath: string): WorldbookIndex | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    const entriesData = data.entries || data;
    if (!entriesData || Object.keys(entriesData).length === 0) return null;

    const entries: WorldbookEntry[] = [];
    for (const [id, v] of Object.entries(entriesData)) {
      const entry = v as any;
      if (entry.disable === true) continue;
      const content = (entry.content || "").trim();
      if (!content) continue;
      entries.push({
        id,
        keys: entry.key || [],
        content,
        comment: entry.comment || "",
      });
    }

    if (entries.length === 0) return null;

    // 建索引
    const docs = entries.map(e => tokenize([...e.keys, e.content.slice(0, 200)].join(" ")));
    const idf = computeIDF(docs);
    const vectors = new Map<string, Map<string, number>>();
    for (let i = 0; i < entries.length; i++) {
      vectors.set(entries[i].id, computeTFIDF(docs[i], idf));
    }

    return { entries, idf, vectors };
  } catch {
    return null;
  }
}

/** 加载当前活跃世界的所有世界书 */
export function loadActiveWorldbooks(activeWorld: string): WorldbookIndex | null {
  const worldpackDir = path.resolve(process.cwd(), "worldpacks", activeWorld);
  if (!fs.existsSync(worldpackDir)) return null;

  // 合并该世界包下所有 JSON 文件
  let allEntries: WorldbookEntry[] = [];
  for (const f of fs.readdirSync(worldpackDir)) {
    if (!f.endsWith(".json")) continue;
    const wb = loadWorldbook(path.join(worldpackDir, f));
    if (wb) allEntries = allEntries.concat(wb.entries);
  }
  if (allEntries.length === 0) return null;

  const docs = allEntries.map(e => tokenize([...e.keys, e.content.slice(0, 200)].join(" ")));
  const idf = computeIDF(docs);
  const vectors = new Map<string, Map<string, number>>();
  for (let i = 0; i < allEntries.length; i++) {
    vectors.set(allEntries[i].id, computeTFIDF(docs[i], idf));
  }
  return { entries: allEntries, idf, vectors };
}

// ── 检索 ──

export function searchWorldbook(
  index: WorldbookIndex,
  query: string,
  opts: { topK?: number; maxTokens?: number } = {}
): SearchResult[] {
  const { topK = 3, maxTokens = 2000 } = opts;
  const queryTokens = tokenize(query);
  const queryVec = computeTFIDF(queryTokens, index.idf);

  // 计算每条目的余弦相似度
  const scored: SearchResult[] = [];
  for (const entry of index.entries) {
    const entryVec = index.vectors.get(entry.id);
    if (!entryVec) continue;
    const score = cosineSimilarity(queryVec, entryVec);
    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // Truncate to maxTokens
  const results: SearchResult[] = [];
  let tokenBudget = 0;
  for (const s of scored) {
    const tokens = estimateTokens(s.entry.content);
    if (results.length >= topK) break;
    if (tokenBudget + tokens > maxTokens) break;
    results.push(s);
    tokenBudget += tokens;
  }
  return results;
}

// ── 中文分词 ──

/** CJK bigram + 英文单词连续。纯 JS，无外部依赖。 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let englishWord = "";

  for (const ch of text) {
    if (/[一-鿿㐀-䶿]/.test(ch)) {
      if (englishWord) { tokens.push(englishWord.toLowerCase()); englishWord = ""; }
      tokens.push(ch);
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      englishWord += ch;
    } else {
      if (englishWord) { tokens.push(englishWord.toLowerCase()); englishWord = ""; }
    }
  }
  if (englishWord) tokens.push(englishWord.toLowerCase());

  // Bigram
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (/[一-鿿]/.test(tokens[i]) && /[一-鿿]/.test(tokens[i + 1])) {
      bigrams.push(tokens[i] + tokens[i + 1]);
    }
  }
  // 单字也保留（匹配单字关键词）
  return [...tokens.filter(t => /[一-鿿]/.test(t)), ...bigrams];
}

function computeIDF(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set(doc);
    for (const term of seen) df.set(term, (df.get(term) || 0) + 1);
  }
  const idf = new Map<string, number>();
  const N = docs.length;
  for (const [t, d] of df) idf.set(t, Math.log((N + 1) / (d + 1)) + 1);
  return idf;
}

function computeTFIDF(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const vec = new Map<string, number>();
  for (const [t, f] of tf) {
    const idfVal = idf.get(t) || 0;
    vec.set(t, (f / tokens.length) * idfVal);
  }
  return vec;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, magA = 0, magB = 0;
  for (const [t, v] of a) {
    magA += v * v;
    if (b.has(t)) dot += v * (b.get(t)!);
  }
  for (const v of b.values()) magB += v * v;
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** 粗略 token 估算（CJK ~1.5 字/tok） */
function estimateTokens(text: string): number {
  let cjk = 0, other = 0;
  for (const ch of text) {
    if (/[一-鿿]/.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}
