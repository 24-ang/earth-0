/**
 * engine/token-counter.ts — DeepSeek 模型 token 估算器
 *
 * 不依赖 tiktoken/WASM，用 Unicode block 分析做近似估算。
 * 对 DeepSeek-V3/V4 (BPE tokenizer, 类似 GPT-4) 误差 ~±15%。
 *
 * 规则（来自实测）：
 *   - CJK 字符（中文/日文汉字/韩文）：~0.55-0.65 token/char（平均 ~0.6）
 *   - 日文假名：~0.5 token/char
 *   - ASCII 字母数字：~0.25 token/char（≈4 字符/token）
 *   - 标点/符号：~0.3 token/char
 *   - 换行/空格：不计入 token（BPE 合并）
 *
 * 保守估计用字符数 × 0.5（混合文本上限），精确估计用分块统计。
 */

// ── Unicode block 分类 ──

function charClass(cp: number): "cjk" | "kana" | "hangul" | "ascii" | "punct" | "space" {
  // CJK Unified Ideographs + Extensions
  if ((cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Ext-A
      (cp >= 0x20000 && cp <= 0x2A6DF) || // CJK Ext-B
      (cp >= 0xF900 && cp <= 0xFAFF))     // CJK Compat
    return "cjk";
  // Japanese kana
  if ((cp >= 0x3040 && cp <= 0x309F) ||   // Hiragana
      (cp >= 0x30A0 && cp <= 0x30FF))     // Katakana
    return "kana";
  // Hangul
  if ((cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul Syllables
      (cp >= 0x1100 && cp <= 0x11FF))     // Hangul Jamo
    return "hangul";
  // ASCII letters + digits
  if ((cp >= 0x41 && cp <= 0x5A) ||       // A-Z
      (cp >= 0x61 && cp <= 0x7A) ||       // a-z
      (cp >= 0x30 && cp <= 0x39))         // 0-9
    return "ascii";
  // Whitespace
  if (cp === 0x20 || cp === 0x0A || cp === 0x0D || cp === 0x09)
    return "space";
  // Everything else: punctuation, symbols, emoji
  return "punct";
}

// ── 单字符 token 权重 ──

const TOKEN_WEIGHTS: Record<ReturnType<typeof charClass>, number> = {
  cjk: 0.60,     // 中文汉字/日文汉字：~0.6 token/char
  kana: 0.50,    // 假名：~0.5 token/char
  hangul: 0.55,  // 韩文：~0.55 token/char
  ascii: 0.25,   // 英文：~0.25 token/char
  punct: 0.30,   // 标点/符号
  space: 0.0,    // 空白不计（BPE 合并）
};

// ── 公开 API ──

export interface TokenBreakdown {
  cjk: number;
  kana: number;
  hangul: number;
  ascii: number;
  punct: number;
  space: number;
  /** 估算总 token 数 */
  totalTokens: number;
  /** 总字符数（不含纯空白）*/
  totalChars: number;
}

/** 估算一段文本的 token 数 */
export function estimateTokens(text: string): TokenBreakdown {
  const counts: Record<string, number> = { cjk: 0, kana: 0, hangul: 0, ascii: 0, punct: 0, space: 0 };
  let totalChars = 0;

  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i) || 0;
    const cls = charClass(cp);
    counts[cls] = (counts[cls] || 0) + 1;
    if (cls !== "space") totalChars++;
    // Surrogate pair → skip next char
    if (cp > 0xFFFF) i++;
  }

  let totalTokens = 0;
  for (const [cls, weight] of Object.entries(TOKEN_WEIGHTS)) {
    totalTokens += (counts[cls] || 0) * weight;
  }

  // BPE overhead: short strings have proportionally more tokens
  // Add 5% padding for BPE fragmentation on short texts
  if (totalChars < 200) {
    totalTokens *= 1.08;
  } else if (totalChars < 1000) {
    totalTokens *= 1.04;
  }

  return {
    cjk: counts.cjk || 0,
    kana: counts.kana || 0,
    hangul: counts.hangul || 0,
    ascii: counts.ascii || 0,
    punct: counts.punct || 0,
    space: counts.space || 0,
    totalTokens: Math.round(totalTokens),
    totalChars,
  };
}

/** 快速估算（只返回 token 数） */
export function quickTokens(text: string): number {
  return estimateTokens(text).totalTokens;
}

/** 格式化 token 数为可读字符串 */
export function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

/** 估算 messages 数组的总 token 数 */
export function estimateMessagesTokens(messages: { role: string; content: string }[]): number {
  let total = 0;
  for (const msg of messages) {
    // role overhead: ~3 tokens
    total += 3 + estimateTokens(msg.content).totalTokens;
  }
  return total;
}
