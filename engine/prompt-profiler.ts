/**
 * engine/prompt-profiler.ts — 提示词日志
 *
 * generateCompletion 每次调用自动记录一条，含完整 prompt 文本 + token 估算。
 * 存 gameState._promptLog（内存，不持久化，最多 20 条）。
 * /tokens 面板读取这些数据。
 */

import { estimateTokens } from "./token-counter.ts";

export interface PromptEntry {
  turn: number;
  time: string;
  label: string;
  model: string;
  chars: number;
  tokens: number;
  maxOut: number;
  /** 完整 prompt 文本 */
  text: string;
}

function log(): PromptEntry[] {
  try {
    const { gameState } = require("./state.ts");
    if (!(gameState as any)._promptLog) (gameState as any)._promptLog = [];
    return (gameState as any)._promptLog;
  } catch { return []; }
}

export function record(label: string, model: string, text: string, maxOut: number): void {
  const list = log();
  let turn = 0;
  try { const { gameState } = require("./state.ts"); turn = gameState.turn || 0; } catch {}
  const est = estimateTokens(text);
  list.push({ turn, time: new Date().toISOString().slice(11, 19), label, model,
    chars: est.totalChars, tokens: est.totalTokens, maxOut, text,
  });
  while (list.length > 20) list.shift();
}

export function getAll(): PromptEntry[] { return [...log()]; }
