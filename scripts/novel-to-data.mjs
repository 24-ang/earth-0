#!/usr/bin/env node
/**
 * novel-to-data — 小说文本 → earth-0 结构化数据
 *
 * 两段式 LLM 提取流水线：
 *   Pass 1 (Flash): 粗筛——识别含角色/场景/事件的段落
 *   Pass 2 (Pro):   精提取——按 BAML 风格 Schema 输出 JSON
 *
 * 用法:
 *   node scripts/novel-to-data.mjs --input 春物卷1.txt --ip oregairu
 *   node scripts/novel-to-data.mjs --input 小说.txt --ip myworld --pass2-model deepseek-v4-pro
 *
 * 环境变量: DEEPSEEK_API_KEY 或 ANTHROPIC_AUTH_TOKEN
 */

import fs from "node:fs";
import path from "node:path";

// ── 配置 ──

const CONFIG = {
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "",
  baseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com/anthropic/v1/messages",
  pass1Model: "deepseek-v4-flash",
  pass2Model: "deepseek-v4-pro",
  pass1MaxTokens: 4096,
  pass2MaxTokens: 4096,

  // Pass 1 每次处理的文本块大小（字符）
  chunkSize: 15000,
  // Pass 1 每块最多提取的段落数
  maxPassagesPerChunk: 8,
};

// ── 参数解析 ──

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: "", ip: "custom" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) opts.input = args[++i];
    else if (args[i] === "--ip" && args[i + 1]) opts.ip = args[++i];
    else if (args[i] === "--pass1-model" && args[i + 1]) CONFIG.pass1Model = args[++i];
    else if (args[i] === "--pass2-model" && args[i + 1]) CONFIG.pass2Model = args[++i];
    else if (args[i] === "--key" && args[i + 1]) CONFIG.apiKey = args[++i];
  }
  if (!opts.input) {
    console.error("用法: node novel-to-data.mjs --input <小说.txt> --ip <世界名>");
    console.error("可选: --pass1-model <模型> --pass2-model <模型> --key <API_KEY>");
    process.exit(1);
  }
  return opts;
}

// ── LLM 调用 ──

async function callLLM(model, prompt, maxTokens = 2048) {
  const res = await fetch(CONFIG.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      thinking: { type: "disabled" },
    }),
  });
  if (!res.ok) throw new Error(`LLM API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  for (const block of data?.content || []) {
    if (block.type === "text" && block.text) return block.text;
  }
  return "";
}

// ── Pass 1: 粗筛 ──
// 用 Flash 快速扫描，只输出含角色/场景信息的段落编号

const PASS1_PROMPT = (chunk) => `你是小说分析助手。分析以下文本，识别包含下列信息的段落：

1. 关键事件（情节转折、冲突爆发、关系突破、告白、争吵、分离、重伤/死亡——故事走向改变的地方）
2. 场景切换（地点变化、时间跳跃、章节开头）
3. 情感高潮（角色情绪达到峰值、内心崩溃或释放、泪流或怒吼）
4. 人物登场或退场（重要角色首次出现或离开场景）

每段开头有类似 [123] 的编号。请只输出符合条件的段落编号（例如如果 [123] 和 [125] 符合条件，则只输出 "123, 125"），用逗号分隔。
不要输出任何其他解释文字。只输出编号。

文本：
${chunk}`;

async function pass1CoarseFilter(text) {
  const paragraphs = text.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
  
  // Group paragraphs into chunks of ~15,000 characters
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;
  
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    currentChunk.push({ index: i, text: p });
    currentLength += p.length;
    if (currentLength >= CONFIG.chunkSize || i === paragraphs.length - 1) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }
  }

  console.log(`[Pass 1] 文本共分 ${paragraphs.length} 个自然段，划分成 ${chunks.length} 块进行粗筛`);

  const allPassages = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const formattedChunk = chunks[ci].map(item => `[${item.index}] ${item.text}`).join("\n");
    const response = await callLLM(
      CONFIG.pass1Model,
      PASS1_PROMPT(formattedChunk),
      CONFIG.pass1MaxTokens
    );

    // 解析段落编号
    const nums = response.match(/\d+/g);
    if (nums) {
      for (const n of nums) {
        const idx = parseInt(n);
        if (!isNaN(idx) && idx >= 0 && idx < paragraphs.length) {
          // 提取该段落以及前后各一段，作为上下文提供给 Pass 2
          const start = Math.max(0, idx - 1);
          const end = Math.min(paragraphs.length, idx + 2);
          const sliceText = paragraphs.slice(start, end).join("\n");
          allPassages.push(sliceText);
        }
      }
    }
    console.log(`[Pass 1] 块 ${ci + 1}/${chunks.length}: 提取 ${nums?.length || 0} 段`);
  }

  // 去重 + 限制数量
  const unique = [...new Set(allPassages)].slice(0, 300);
  console.log(`[Pass 1] 去重后保留 ${unique.length} 段高浓度文本`);
  return unique;
}

// ── Pass 1.5: 小说分析 (Pre-Analysis) ──
// 用 Flash 读开头几章，自动生成世界观提取指南

async function preAnalysis(text, ip) {
  const sample = text.slice(0, 3000); // 前 3000 字
  const prompt = `你是小说分析专家。读以下小说开头，用 3-5 句话概括：

1. 时代背景（古代/近代/现代/未来？具体年代？）
2. 地理范围（哪个国家/地区？）
3. 题材类型（历史/科幻/奇幻/现实？）
4. 主角身份（普通人/军人/政客/商人？）
5. 语言风格（文言/白话/翻译腔？）

只输出概括，不要建议。

${sample}`;

  console.log("[Pre-Analysis] 分析小说设定...");
  const analysis = await callLLM(CONFIG.pass1Model, prompt, 512);
  console.log(`[Pre-Analysis] ${analysis.trim()}`);
  return analysis.trim();
}

// ── Pass 2: 精提取 ──
// 用 Pro 严格按 Schema 输出 JSON，融入世界观上下文

const PASS2_CHARACTER_PROMPT = (passages, ip, context) => `你是小说数据提取专家。${context ? "作品背景: " + context : ""}从以下精选段落中提取所有角色信息。

提取规则：
- name: 角色名（使用原文中的名字）
- source: "${ip}"
- gender: "男"/"女"
- base_age: 估计年龄数字
- appearance_brief: 外貌描述（≤50字，空缺可留空）
- tags: 角色标签数组（如身份/职业/阵营）
- default_location: 经常出现的地点或势力范围

输出 JSON 数组（不要 markdown）。每个元素:
{"name":"","source":"${ip}","gender":"","base_age":0,"appearance_brief":"","tags":[],"default_location":""}

只输出 JSON 数组。

文本:
${typeof passages === "string" ? passages : passages.join("\n---\n")}`;

const PASS2_TIMELINE_PROMPT = (passages, ip, context) => `你是小说剧情分析专家。${context ? "作品背景: " + context : ""}从以下段落中提取可转化为游戏的剧情事件。

每个事件: id(英文snake_case), title, source:"${ip}", trigger:{min_day,location,affection?(可选),time_of_day?[]}, expires_days, repeatable:false, hook:{source_npc, hook_text(≤80字), urgency("low"/"medium"/"high")}, beats:[{id,label,prompt,outcomes:[{pick,effects:{flags?{},affection?{}},next_beat?}]}]

输出 JSON 数组。只输出 JSON。

文本:
${typeof passages === "string" ? passages : passages.join("\n---\n")}`;

const PASS2_SCENE_PROMPT = (passages, ip, context) => `你是场景描写专家。${context ? "作品背景: " + context : ""}从以下段落中提取场景氛围描写，用于GM生成环境。

每条: { "location": "地点名", "atmosphere": "氛围≤100字", "sensory": "五感细节≤50字" }

输出 JSON 数组。只输出 JSON。

文本:
${typeof passages === "string" ? passages : passages.join("\n---\n")}`;

const PASS2_OUTFIT_PROMPT = (passages, ip, context) => `你是服装描写专家。${context ? "作品背景: " + context : ""}从以下段落中提取角色服装描写（校服/私服/泳装/女仆装/内衣等）。

每条: { "character": "角色名", "outfit_type": "制服/私服/泳装/内衣/其他", "description": "服装细节≤80字", "occasion": "穿着场景" }

输出 JSON 数组。只输出 JSON。

文本:
${typeof passages === "string" ? passages : passages.join("\n---\n")}`;

async function pass2FineExtract(passages, ip, context = "") {
  console.log(`[Pass 2] 开始精提取... (${passages.length} 段)`);

  // 分批处理，每批最多 40 段
  const BATCH_SIZE = 40;
  const batches = [];
  for (let i = 0; i < passages.length; i += BATCH_SIZE) {
    batches.push(passages.slice(i, i + BATCH_SIZE));
  }

  let allChars = [];
  let allTimelines = [];
  let allLore = {};

  const cleanJSON = (s) => (s || "").replace(/```json\s*/gi, "").replace(/```\s+/g, "").replace(/```\s*$/g, "").trim();

  for (let bi = 0; bi < batches.length; bi++) {
    const batchText = batches[bi].join("\n---\n");
    console.log(`[Pass 2] 批次 ${bi + 1}/${batches.length} (${batchText.length} 字)...`);

    const [charRaw, timelineRaw, sceneRaw, outfitRaw] = await Promise.all([
      callLLM(CONFIG.pass2Model, PASS2_CHARACTER_PROMPT(batchText, ip, context), CONFIG.pass2MaxTokens).catch(e => { console.error("角色提取失败:", e.message); return "[]"; }),
      callLLM(CONFIG.pass2Model, PASS2_TIMELINE_PROMPT(batchText, ip, context), CONFIG.pass2MaxTokens).catch(e => { console.error("时间线提取失败:", e.message); return "[]"; }),
      callLLM(CONFIG.pass2Model, PASS2_SCENE_PROMPT(batchText, ip, context), CONFIG.pass2MaxTokens).catch(e => { console.error("场景提取失败:", e.message); return "[]"; }),
      callLLM(CONFIG.pass2Model, PASS2_OUTFIT_PROMPT(batchText, ip, context), CONFIG.pass2MaxTokens).catch(e => { console.error("服装提取失败:", e.message); return "[]"; }),
    ]);

    try { const parsed = JSON.parse(cleanJSON(charRaw)); allChars.push(...parsed); console.log(`  角色: +${parsed.length}`); } catch(e) { console.error(`  解析失败: ${e.message}`); }
    try { const parsed = JSON.parse(cleanJSON(timelineRaw)); allTimelines.push(...parsed); console.log(`  剧情: +${parsed.length}`); } catch(e) { console.error(`  解析失败: ${e.message}`); }
    try { const parsed = JSON.parse(cleanJSON(sceneRaw)); allLore.scenes = [...(allLore.scenes||[]), ...parsed]; console.log(`  场景: +${parsed.length}`); } catch(e) { console.error(`  解析失败: ${e.message}`); }
    try { const parsed = JSON.parse(cleanJSON(outfitRaw)); allLore.outfits = [...(allLore.outfits||[]), ...parsed]; console.log(`  服装: +${parsed.length}`); } catch(e) { console.error(`  解析失败: ${e.message}`); }
  }

  // 角色去重
  const seen = new Set();
  const characters = allChars.filter(c => { const key = c.name; if (seen.has(key)) return false; seen.add(key); return true; });
  const timelines = allTimelines.filter(t => t.id && t.title);
  console.log(`[Pass 2] 总计: ${characters.length} 角色, ${timelines.length} 剧情线`);

  return { characters, timelines, lore: allLore };
}

// ── 输出到 data/ ──

function writeOutput(ip, data) {
  const dataDir = path.resolve(process.cwd(), "data");
  const timelineDir = path.join(dataDir, "timelines", ip);

  fs.mkdirSync(timelineDir, { recursive: true });

  // 1. Characters — 合并到已有文件
  const charPath = path.join(dataDir, "characters.json");
  let existingChars = [];
  if (fs.existsSync(charPath)) {
    try { existingChars = JSON.parse(fs.readFileSync(charPath, "utf-8")); } catch {}
  }
  const existingNames = new Set(existingChars.map(c => c.name));
  const newChars = data.characters.filter(c => !existingNames.has(c.name));
  if (newChars.length > 0) {
    const merged = [...existingChars, ...newChars];
    fs.writeFileSync(charPath, JSON.stringify(merged, null, 2), "utf-8");
    console.log(`[输出] characters.json: +${newChars.length} 个 (总计 ${merged.length})`);
  } else {
    console.log("[输出] characters.json: 无新角色");
  }

  // 2. Timelines — 每个事件一个文件
  for (const ev of data.timelines) {
    if (!ev.id) continue;
    const evPath = path.join(timelineDir, `${ev.id}.json`);
    if (!fs.existsSync(evPath)) {
      fs.writeFileSync(evPath, JSON.stringify(ev, null, 2), "utf-8");
    }
  }
  console.log(`[输出] timelines/${ip}/: ${data.timelines.length} 个文件`);

  // 3. Scenes — 合并到已有文件
  const scenePath = path.join(dataDir, "scene_atmosphere.json");
  let existingScenes = [];
  if (fs.existsSync(scenePath)) {
    try { existingScenes = JSON.parse(fs.readFileSync(scenePath, "utf-8")); } catch {}
  }
  const mergedScenes = [...existingScenes, ...(data.lore.scenes || [])];
  if (mergedScenes.length > existingScenes.length) {
    fs.writeFileSync(scenePath, JSON.stringify(mergedScenes, null, 2), "utf-8");
    console.log("[输出] scene_atmosphere.json: +" + data.lore.scenes.length + " 个 (总计 " + mergedScenes.length + ")");
  }

  // 4. Outfits — 合并到已有文件
  const outfitPath = path.join(dataDir, "outfit_descriptions.json");
  let existingOutfits = [];
  if (fs.existsSync(outfitPath)) {
    try { existingOutfits = JSON.parse(fs.readFileSync(outfitPath, "utf-8")); } catch {}
  }
  const mergedOutfits = [...existingOutfits, ...(data.lore.outfits || [])];
  if (mergedOutfits.length > existingOutfits.length) {
    fs.writeFileSync(outfitPath, JSON.stringify(mergedOutfits, null, 2), "utf-8");
    console.log("[输出] outfit_descriptions.json: +" + data.lore.outfits.length + " 个 (总计 " + mergedOutfits.length + ")");
  }
}

// ── 主流程 ──

async function main() {
  const opts = parseArgs();

  if (!CONFIG.apiKey) {
    console.error("错误: 未设置 API key。请设置 DEEPSEEK_API_KEY 或 ANTHROPIC_AUTH_TOKEN 环境变量，或使用 --key 参数");
    process.exit(1);
  }

  console.log(`novel-to-data — ${opts.input} → earth-0 (IP: ${opts.ip})`);
  console.log(`Pass1: ${CONFIG.pass1Model} | Pass2: ${CONFIG.pass2Model}`);
  console.log("");

  const text = fs.readFileSync(opts.input, "utf-8");
  console.log(`加载文本: ${text.length} 字`);

  // Pass 1
  const passages = await pass1CoarseFilter(text);
  if (passages.length === 0) {
    console.log("未提取到有效段落。请检查输入文本或调整 chunk 大小。");
    process.exit(0);
  }

  // Pre-Analysis: 自动分析小说设定，用于定制提取提示词
  const worldContext = await preAnalysis(text, opts.ip);

  // Pass 2
  const data = await pass2FineExtract(passages, opts.ip, worldContext);

  // 输出
  writeOutput(opts.ip, data);

  console.log("\n✅ 完成。");
  console.log(`   npx tsx test.ts  # 确认 125 passed`);
}

main().catch(e => {
  console.error("失败:", e.message);
  process.exit(1);
});
