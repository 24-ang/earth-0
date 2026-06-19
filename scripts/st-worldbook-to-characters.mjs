#!/usr/bin/env node
/**
 * ST 世界书 → earth-0 characters.json (LLM 精提取版)
 * 用法: node scripts/worldbook-extract.mjs --input <世界书.json> --ip oregairu
 * 环境变量: DEEPSEEK_API_KEY
 */
import fs from "node:fs";

const CONFIG = {
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "",
  model: "deepseek-v4-pro",
  maxTokens: 16384,
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: "", ip: "oregairu", out: "" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i+1]) opts.input = args[++i];
    else if (args[i] === "--ip" && args[i+1]) opts.ip = args[++i];
    else if (args[i] === "--out" && args[i+1]) opts.out = args[++i];
    else if (args[i] === "--key" && args[i+1]) CONFIG.apiKey = args[++i];
  }
  if (!opts.input) { console.error("用法: --input <世界书.json> --ip oregairu --out <输出目录>"); process.exit(1); }
  return opts;
}

async function callLLM(prompt) {
  const res = await fetch("https://api.deepseek.com/anthropic/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CONFIG.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CONFIG.model, max_tokens: CONFIG.maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  // 跳过 thinking 块，取第一个 text 块
  for (const block of data?.content || []) {
    if (block.type === "text" && block.text) return block.text;
  }
  return "";
}

async function main() {
  const opts = parseArgs();
  if (!CONFIG.apiKey) { console.error("请设置 DEEPSEEK_API_KEY"); process.exit(1); }

  const wb = JSON.parse(fs.readFileSync(opts.input, "utf-8"));
  const entries = wb.entries || wb;
  const entriesText = typeof entries === "object" && !Array.isArray(entries)
    ? Object.entries(entries).map(([k, v]) => `[条目${k}] ${v.content}`).join("\n\n")
    : JSON.stringify(entries);

  const prompt = `你是数据提取专家。从以下 ST 世界书条目中提取所有角色信息，输出 earth-0 兼容 JSON。

提取规则：
- name: 角色名（日文原名优先）
- source: "${opts.ip}"
- gender: "男"/"女"/"未知"
- appearance_brief: 外貌描述（如有，≤30字）
- tags: 角色标签数组（如["学生会","侍奉部"]）
- default_location: 常出现的地点
- grade_info: 班级信息（如"2年J班"）
- 忽略 XML 标签、系统指令、格式模板等非角色内容
- 忽略纯数字ID、单字、明显不是人名的行

严格输出以下 JSON 格式（不要 markdown 代码块）：
[{"name":"角色名","source":"${opts.ip}","gender":"未知","appearance_brief":"","tags":[],"default_location":"","grade_info":""}]

只输出 JSON 数组。只输出 JSON。

世界书内容：
${entriesText.slice(0, 50000)}`;

  console.log(`发送 ${entriesText.length} 字符到 ${CONFIG.model}...`);
  const raw = await callLLM(prompt);
  console.log(`原始响应长度: ${raw.length} 字符`);
  // 尝试提取 JSON 数组（可能被截断，取第一个完整的 ] 为止）
  const jsonStart = raw.indexOf("[");
  const jsonEnd = raw.lastIndexOf("]");
  let clean = raw;
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    clean = raw.slice(jsonStart, jsonEnd + 1);
  } else {
    clean = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  }

  let chars = [];
  try { chars = JSON.parse(clean); } catch (e) {
    console.error("JSON 解析失败:", e.message);
    // 尝试修复截断的 JSON：找到最后一个完整的对象
    const lastComplete = clean.lastIndexOf('"}');
    if (lastComplete > 0 && !clean.endsWith("]")) {
      const salvaged = clean.slice(0, lastComplete + 2) + "\n]";
      try { chars = JSON.parse(salvaged); console.log(`修复成功: ${chars.length} 个角色`); } catch {}
    }
    if (chars.length === 0) {
      // 降级：逐行解析
      const lines = clean.split("\n").filter(l => {
        const t = l.trim();
        return t.startsWith("{") && (t.endsWith("}") || t.endsWith("},"));
      });
      chars = lines.map(l => { try { return JSON.parse(l.trim().replace(/,$/,'')); } catch { return null; } }).filter(Boolean);
      if (chars.length > 0) console.log(`降级解析: ${chars.length} 个角色`);
    }
  }

  const names = new Set();
  const deduped = chars.filter(c => {
    if (!c.name || c.name.length < 2 || names.has(c.name)) return false;
    names.add(c.name);
    return true;
  });

  const outDir = opts.out || process.cwd();
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = `${outDir}/characters_${opts.ip}_extracted.json`;
  fs.writeFileSync(outFile, JSON.stringify(deduped, null, 2), "utf-8");
  console.log(`提取: ${deduped.length} 个角色（原始 ${chars.length}）`);
  console.log(`输出: ${outFile}`);
}

main().catch(e => { console.error("失败:", e.message); process.exit(1); });
