/**
 * Prompt Collector Registry — Layer 5 上下文组装
 *
 * 将 buildStatePrompt 的 366 行大函数拆成独立 collector，
 * 每个 collector 可独立注册、独立降级、独立失败。
 *
 * 参考: pi-stage 的 Collector 注册表 + 双预算调度器
 */

import type { GameState } from "./types.ts";

// ── Collector 接口 ──

export interface PromptNode {
  text: string;
  priority: number;          // 0-99, 越小越靠前/越重要
  layer: "survival" | "stable" | "enhanced";
  degradeStrategy: "drop" | "truncate" | "compress" | "keep";
  sourceName: string;        // 用于调试
}

export interface Collector {
  name: string;
  priority: number;
  layer: PromptNode["layer"];
  degradeStrategy: PromptNode["degradeStrategy"];
  /** 返回 null 表示本轮不产出内容 */
  collect(state: GameState): Promise<PromptNode | null>;
}

// ── 注册表 ──

export class CollectorRegistry {
  private collectors: Collector[] = [];

  register(c: Collector): void {
    // 按 priority 插入正确位置
    const idx = this.collectors.findIndex(x => x.priority > c.priority);
    if (idx === -1) this.collectors.push(c);
    else this.collectors.splice(idx, 0, c);
  }

  /** 并行收集所有 collector，每个独立 try-catch */
  async collectAll(state: GameState): Promise<PromptNode[]> {
    const results: PromptNode[] = [];
    for (const c of this.collectors) {
      try {
        const node = await c.collect(state);
        if (node) results.push(node);
      } catch (e) {
        console.error("collectAll: collector 执行失败", e);
      }
    }
    return results;
  }

  getCollectors(): readonly Collector[] {
    return this.collectors;
  }
}

// ── 调度器 ──

export interface BudgetConfig {
  targetBytes: number;   // 舒适区（低于此不降级）
  hardBytes: number;     // 硬上限（超过的直接 drop）
}

export interface ScheduleResult {
  output: string;
  dropped: string[];
  totalBytes: number;
}

export function schedule(
  nodes: PromptNode[],
  budget: BudgetConfig = { targetBytes: 24000, hardBytes: 40000 }
): ScheduleResult {
  const encoder = new TextEncoder();
  const dropped: string[] = [];
  let output = "";
  let remaining = budget.hardBytes;

  // 已按 priority 排序（注册时保证）
  for (const node of nodes) {
    const bytes = encoder.encode(node.text).length;

    // 硬上限 — 直接丢弃
    if (bytes > remaining && node.degradeStrategy !== "keep") {
      dropped.push(node.sourceName);
      continue;
    }

    // 舒适区以内 — 原样拼接
    if (output.length + node.text.length <= budget.targetBytes) {
      output += "\n" + node.text;
      remaining -= bytes;
      continue;
    }

    // 超过舒适区但没到硬上限 — 按策略降级
    switch (node.degradeStrategy) {
      case "keep":
        output += "\n" + node.text;
        remaining -= bytes;
        break;
      case "drop":
        dropped.push(node.sourceName);
        break;
      case "truncate": {
        const capped = Math.floor(remaining * 0.6);
        const truncated = encoder.encode(node.text).slice(0, capped);
        const text = new TextDecoder().decode(truncated);
        if (text.length > 0) output += "\n" + text;
        else dropped.push(node.sourceName);
        remaining -= capped;
        break;
      }
      case "compress":
        // 简单压缩：保留首句 + 最后一句
        const sentences = node.text.split(/[。！？\n]+/).filter(Boolean);
        if (sentences.length <= 2) {
          output += "\n" + node.text;
        } else {
          const compressed = sentences[0] + "。…" + sentences[sentences.length - 1] + "。";
          output += "\n" + compressed;
        }
        remaining -= encoder.encode(compressed).length;
        break;
    }
  }

  return {
    output: output.trimStart(),
    dropped,
    totalBytes: encoder.encode(output).length,
  };
}

// ── 全局注册表实例 ──

export const promptCollectors = new CollectorRegistry();
