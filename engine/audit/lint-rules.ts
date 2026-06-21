/**
 * 散文 Lint 引擎 — 渲染输出后的正则扫描。
 *
 * prompt 约束是"建议"，这里的是"机械保证"。
 * 唯一不可替代的功能：秘密泄露检测（只有引擎知道 state 里存了什么秘密）。
 */

import type { GameState } from "../types.ts";

// ── 类型 ──

export type LintSeverity = "block" | "warn";

export interface LintFinding {
  ruleId: string;
  severity: LintSeverity;
  match: string;
  excerpt: string;
}

export interface LintResult {
  /** 清理后的正文（block 可自动修复的规则已应用） */
  prose: string;
  findings: LintFinding[];
  /** 是否有不可自动修复的 block 命中（需重试） */
  needsRetry: boolean;
}

// ── 规则定义 ──

interface ProseRule {
  id: string;
  severity: LintSeverity;
  /** 匹配范围 */
  scope: "opening" | "ending" | "anywhere";
  pattern: RegExp;
  /** 命中后的处理：trim=裁剪, reject=需重试, log=仅记录 */
  action: "trim" | "reject" | "log";
}

const EXCERPT_RADIUS = 30;
const ENDING_WINDOW_CHARS = 200;

const BUILTIN_RULES: ProseRule[] = [
  // ── block + trim：自动裁剪废话开头 ──
  {
    id: "opening-delivery-wrapper",
    severity: "block",
    scope: "opening",
    pattern: /^[「『"'（(]?(?:好的[。，,!！\s]|好[。，,!！\s]|以下是|那么[，,。.!！\s]|状态已经|现在为你写)/gm,
    action: "trim",
  },
  // ── block + reject：伪菜单结尾 ──
  {
    id: "pseudo-menu-ending",
    severity: "block",
    scope: "ending",
    pattern: /你可以[^。！？\n]{0,50}(?:也可以|或者)|左边是[^。！？\n]{0,50}右边是|是[^。！？\n，]{1,30}还是[^。！？\n]{1,30}[？?]/g,
    action: "reject",
  },
  // ── block + reject：报告体总结句 ──
  {
    id: "report-sentence",
    severity: "block",
    scope: "anywhere",
    pattern: /目标完成|威胁提升|当前局势[^。！？\n]{0,30}[。]|可选行动如下/g,
    action: "reject",
  },
  // ── block + reject：面板数值泄露 ──
  {
    id: "panel-value-leak",
    severity: "block",
    scope: "anywhere",
    pattern: /好感度\s*\d+|HP\s*\d+|AC\s*\d+|STR\s*\d+|DEX\s*\d+|力量\s*\d+\s*点/g,
    action: "reject",
  },
  // ── warn + log：感知报告动词 ──
  {
    id: "perception-report-verb",
    severity: "warn",
    scope: "anywhere",
    pattern: /你看到|你听到|你感觉到|你发现|你注意到/g,
    action: "log",
  },
  // ── warn + log：模糊镜头 ──
  {
    id: "vague-hedge",
    severity: "warn",
    scope: "anywhere",
    pattern: /似乎|仿佛|宛如/g,
    action: "log",
  },
  // ── warn + log：禁止词汇（来自 gm-contract.md） ──
  {
    id: "banned-vocabulary",
    severity: "warn",
    scope: "anywhere",
    pattern: /四肢百骸|虔诚|指节泛白|蚊子哼哼|沙哑|生理性|共犯|瞳孔骤缩|如遭雷击|血液凝固|浑身颤抖|心脏停跳|眼眶泛红/g,
    action: "log",
  },
  // ── warn + log：手术刀/针类/小动物比喻 ──
  {
    id: "banned-metaphor",
    severity: "warn",
    scope: "anywhere",
    pattern: /手术刀[^，。！？\n]{0,20}(?:般|似|一样|的)|针[^，。！？\n]{0,10}(?:般|似|一样|的?)刺|像.*小动物/g,
    action: "log",
  },
];

// ── 核心函数 ──

/** 扫描渲染正文，返回清理后的正文 + 发现列表 */
export function lintProse(raw: string, gameState?: GameState): LintResult {
  const findings: LintFinding[] = [];
  let prose = raw;
  let needsRetry = false;

  for (const rule of BUILTIN_RULES) {
    // 重置 lastIndex（规则 pattern 带 g flag）
    rule.pattern.lastIndex = 0;

    const matches = findAllMatches(prose, rule);
    for (const match of matches) {
      const excerpt = extractExcerpt(prose, match.index, match.text.length);
      const finding: LintFinding = {
        ruleId: rule.id,
        severity: rule.severity,
        match: match.text,
        excerpt,
      };
      findings.push(finding);

      switch (rule.action) {
        case "trim":
          prose = prose.replace(match.text, "");
          break;
        case "reject":
          needsRetry = true;
          break;
        case "log":
          break; // 仅记录
      }
    }
  }

  // ── 秘密泄露检测（只有引擎能做） ──
  if (gameState) {
    const secretFindings = scanSecretLeaks(prose, gameState);
    findings.push(...secretFindings);
    if (secretFindings.length > 0) {
      needsRetry = true;
    }
  }

  // 裁剪后清理多余空白
  if (findings.some(f => f.ruleId === "opening-delivery-wrapper")) {
    prose = prose.replace(/^\s+/, "");
  }

  return { prose: prose.trim(), findings, needsRetry };
}

/** 扫描正文是否包含未揭示的秘密字符串 */
function scanSecretLeaks(prose: string, gameState: GameState): LintFinding[] {
  const findings: LintFinding[] = [];

  // 遍历所有 NPC 的 secret 槽
  const secrets = (gameState as any).secrets;
  if (!secrets) return findings;

  for (const [actorId, slots] of Object.entries(secrets) as any) {
    if (!slots || typeof slots !== "object") continue;

    // 真名
    if (slots.trueName?.revealState !== "revealed" && slots.trueName?.value) {
      const secret = String(slots.trueName.value);
      if (prose.includes(secret)) {
        const idx = prose.indexOf(secret);
        findings.push({
          ruleId: "secret-leak-true-name",
          severity: "block",
          match: secret,
          excerpt: extractExcerpt(prose, idx, secret.length),
        });
      }
    }

    // 隐藏宝具
    for (const np of slots.hiddenNoblePhantasms || []) {
      if (np.revealState !== "revealed" && np.value?.name) {
        const secret = String(np.value.name);
        if (prose.includes(secret)) {
          const idx = prose.indexOf(secret);
          findings.push({
            ruleId: "secret-leak-noble-phantasm",
            severity: "block",
            match: secret,
            excerpt: extractExcerpt(prose, idx, secret.length),
          });
        }
      }
    }

    // 隐藏动机/归属
    for (const motive of slots.privateMotives || []) {
      if (motive.revealState !== "revealed" && motive.value) {
        const secret = String(motive.value);
        if (secret.length >= 3 && prose.includes(secret)) {
          const idx = prose.indexOf(secret);
          findings.push({
            ruleId: "secret-leak-motive",
            severity: "block",
            match: secret,
            excerpt: extractExcerpt(prose, idx, secret.length),
          });
        }
      }
    }
  }

  return findings;
}

// ── 辅助 ──

interface TextMatch {
  text: string;
  index: number;
}

function findAllMatches(text: string, rule: ProseRule): TextMatch[] {
  const results: TextMatch[] = [];
  rule.pattern.lastIndex = 0;

  if (rule.scope === "opening") {
    // 只检查前 200 字符
    const head = text.slice(0, 200);
    rule.pattern.lastIndex = 0;
    for (const m of head.matchAll(rule.pattern)) {
      if (m.index !== undefined) {
        results.push({ text: m[0], index: m.index });
      }
    }
  } else if (rule.scope === "ending") {
    // 只检查末尾窗口
    const start = Math.max(0, text.length - ENDING_WINDOW_CHARS);
    const tail = text.slice(start);
    rule.pattern.lastIndex = 0;
    for (const m of tail.matchAll(rule.pattern)) {
      if (m.index !== undefined) {
        results.push({ text: m[0], index: start + m.index });
      }
    }
  } else {
    for (const m of text.matchAll(rule.pattern)) {
      if (m.index !== undefined) {
        results.push({ text: m[0], index: m.index });
      }
    }
  }

  return results;
}

function extractExcerpt(text: string, index: number, matchLen: number): string {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + matchLen + EXCERPT_RADIUS);
  let excerpt = text.slice(start, end);
  if (start > 0) excerpt = "…" + excerpt;
  if (end < text.length) excerpt = excerpt + "…";
  return excerpt;
}
