#!/usr/bin/env node
/**
 * novel-to-data v2 — fabula 架构 + Story-to-Game 索引思路
 *
 * 核心差异：逐章处理，每章传累积的实体注册表 + 游戏约束。
 * LLM 永远知道前面提取过什么、游戏里有什么，不会瞎编。
 *
 * 用法:
 *   node scripts/novel-to-data-v2.mjs --input ../雪之下同人.txt --ip oregairu
 */

import fs from "node:fs";
import path from "node:path";

// ── 配置 ──
const CONFIG = {
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "",
  baseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com/anthropic/v1/messages",
  model: "deepseek-v4-pro",
  maxTokens: 8192,
};

// ── 游戏约束（从实际游戏数据加载）──
function loadGameContext() {
  const dataDir = path.resolve(process.cwd(), "data");
  const regions = JSON.parse(fs.readFileSync(path.join(dataDir, "regions.json"), "utf-8"));
  const chars = JSON.parse(fs.readFileSync(path.join(dataDir, "characters.json"), "utf-8"));

  // 已有角色名
  const existingChars = new Set(chars.map(c => c.name));

  // 游戏房间（从 school_map.json 提取）
  const sm = JSON.parse(fs.readFileSync(path.join(dataDir, "school_map.json"), "utf-8"));
  const gameRooms = new Set();
  for (const [bname, bld] of Object.entries(sm.buildings || {})) {
    gameRooms.add(bname);
    for (const rlist of Object.values(bld.rooms || {})) {
      for (const r of rlist) gameRooms.add(r);
    }
  }
  // city_map landmarks
  const cm = JSON.parse(fs.readFileSync(path.join(dataDir, "city_map.json"), "utf-8"));
  for (const [k, v] of Object.entries(cm.regions || {})) {
    gameRooms.add(k);
    for (const l of (v.landmarks || [])) gameRooms.add(l);
  }

  // 已有地点（从 regions 的 location_hints 提取）
  const existingLocations = new Set();
  for (const r of regions) {
    for (const h of (r.location_hints || [])) existingLocations.add(h);
  }

  // 一条已有 timeline 样例
  const timelineDir = path.join(dataDir, "timelines", "oregairu");
  let sampleTimeline = null;
  if (fs.existsSync(timelineDir)) {
    const files = fs.readdirSync(timelineDir).filter(f => f.endsWith(".json"));
    if (files.length > 0) {
      sampleTimeline = JSON.parse(fs.readFileSync(path.join(timelineDir, files[0]), "utf-8"));
    }
  }

  return { existingChars, existingLocations, sampleTimeline, gameRooms };
}

// ── 实体注册表（fabula 核心）──
class EntityRegistry {
  constructor() {
    this.characters = {};   // name → { info }
    this.locations = {};    // name → { info }
    this.timelines = [];    // [{ event }]
    this.scenes = [];       // [{ atmosphere }]
    this.outfits = [];      // [{ outfit }]
    this.storySummary = ""; // 累积的故事摘要
  }

  registerCharacter(name, info) {
    const key = name.trim();
    if (!this.characters[key]) {
      this.characters[key] = { name: key, ...info, firstSeen: this.sceneCount() };
    } else {
      // 合并新信息
      Object.assign(this.characters[key], info);
    }
  }

  sceneCount() {
    return this.scenes.length;
  }

  /** 生成传给 LLM 的注册表摘要 */
  toContextString(gameCtx) {
    const parts = [];

    // 故事摘要
    if (this.storySummary) {
      parts.push(`## 累积故事摘要\n${this.storySummary}`);
    }

    // 已知角色
    const charNames = Object.keys(this.characters);
    if (charNames.length > 0) {
      parts.push(`## 已知角色 (${charNames.length}人)`);
      for (const [name, info] of Object.entries(this.characters)) {
        const grade = info.grade ? ` ${info.grade}年级` : "";
        const club = info.club ? ` ${info.club}` : "";
        parts.push(`- ${name}:${grade}${club} ${info.appearance || ""} ${info.personality || ""}`);
      }
    }

    // 已知地点
    const locNames = Object.keys(this.locations);
    if (locNames.length > 0) {
      parts.push(`\n## 已发现地点`);
      for (const [name, info] of Object.entries(this.locations)) {
        parts.push(`- ${name}: ${info.atmosphere || ""}`);
      }
    }

    // 已提取事件
    if (this.timelines.length > 0) {
      parts.push(`\n## 已提取事件 (${this.timelines.length}条)`);
      for (const t of this.timelines.slice(-5)) {
        parts.push(`- ${t.title}: ${t.hook?.hook_text || ""}`);
      }
    }

    // 游戏约束
    parts.push(`\n## 游戏约束`);
    parts.push(`- 已有角色（不要重复创建）: ${[...gameCtx.existingChars].join("、")}`);
    parts.push(`- 可用游戏房间（event.location 必须从这里选，或写成"千叶市立总武高等学校XXX"格式）:`);
    const roomList = [...gameCtx.gameRooms].filter(r => r.length > 1 && r.length < 30).slice(0, 40);
    parts.push(`  ${roomList.join("、")}`);
    parts.push(`- 地点映射: 小说中的"侍奉部"="侍奉部部室", "教室"="2年J班", "走廊"="1F南走廊", "网球场"="网球场", "图书馆"="图书馆"`);
    parts.push(`- 不要用"千叶县""千叶""神奈川"这种大区域名作为event.location`);
    if (gameCtx.sampleTimeline) {
      parts.push(`- Timeline 格式参考:\n\`\`\`json\n${JSON.stringify(gameCtx.sampleTimeline, null, 2).substring(0, 500)}\n\`\`\``);
    }

    return parts.join("\n");
  }
}

// ── LLM 调用 ──
async function callLLM(prompt, maxTokens = CONFIG.maxTokens) {
  const res = await fetch(CONFIG.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CONFIG.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      thinking: { type: "disabled" },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText.substring(0, 200)}`);
  }
  const data = await res.json();
  for (const block of data?.content || []) {
    if (block.type === "text" && block.text) return block.text;
  }
  return "";
}

// ── 分章 ──
function splitChapters(text) {
  const chapters = [];
  // 匹配 "第X章" 或 "第XX章" 或 "Chapter X"
  const chapterRegex = /^(第.+章.*)$/gm;
  const matches = [...text.matchAll(chapterRegex)];

  if (matches.length === 0) {
    // 没找到章节标记，按固定长度切
    const chunkSize = 30000;
    for (let i = 0; i < text.length; i += chunkSize) {
      chapters.push({
        title: `片段 ${Math.floor(i / chunkSize) + 1}`,
        content: text.substring(i, i + chunkSize),
      });
    }
    return chapters;
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i + 1].index : text.length;
    chapters.push({
      title: matches[i][0].trim(),
      content: text.substring(start, end).trim(),
    });
  }
  return chapters;
}

// ── 单章提取 ──
const EXTRACT_PROMPT = (chapterTitle, chapterText, registryContext) => `你是游戏数据提取专家。你正在处理小说的一章。下面是你已累积的知识和游戏约束。

${registryContext}

---
## 当前章节: ${chapterTitle}
## 章节文本 (节选前 8000 字):
${chapterText.substring(0, 8000)}

---
## 提取任务

从本章文本中提取以下信息。注意：不要重复提取已知角色和地点。如有新的信息补充已知角色，可以更新。

### 1. 角色 (characters)
新出现的角色。格式:
[CHAR]
name: 角色名
gender: 男/女
base_age: 估计年龄
appearance: 外貌描述 ≤30字
personality: 性格 ≤30字
grade: 年级数字(1/2/3，学生填，教师不填)
club: 社团名(有就填)
role: teacher(教师)/student(学生)/other(其他)
[/CHAR]

### 2. 剧情事件 (timeline)
本章中可以转化为游戏任务的关键事件。格式:
[EVENT]
id: 英文snake_case
title: 事件名 ≤15字
location: 发生地点（必须使用游戏已有地点或本章描述的真实地名）
min_day: 相对第几天
affection: 需要的好感度(0-100，无则0)
hook_text: 触发文本 ≤60字
urgency: low/medium/high
[/EVENT]

### 3. 场景氛围 (scene)
本章中描写的场景氛围。格式:
[SCENE]
location: 地点名
atmosphere: 氛围描述 ≤80字
sensory: 五感细节 ≤40字
[/SCENE]

### 4. 服装 (outfit)
本章中描写的角色服装。格式:
[OUTFIT]
character: 角色名
type: 制服/私服/泳装/内衣/女仆装/其他
description: 服装细节 ≤60字
occasion: 穿着场景
[/OUTFIT]

只输出以上格式的内容。每个提取项之间空一行。`;

// ── 解析 LLM 输出 ──
function parseExtraction(raw) {
  const result = { characters: [], timelines: [], scenes: [], outfits: [] };

  // 按 [TAG]...[/TAG] 解析
  const sections = raw.split(/\n(?=\[)/);
  let currentType = null;
  let currentData = {};

  for (const section of sections) {
    if (section.startsWith("[CHAR]") || section.includes("[CHAR]")) {
      currentType = "char";
      currentData = {};
      parseKV(section, currentData);
    } else if (section.startsWith("[EVENT]") || section.includes("[EVENT]")) {
      currentType = "event";
      currentData = {};
      parseKV(section, currentData);
    } else if (section.startsWith("[SCENE]") || section.includes("[SCENE]")) {
      currentType = "scene";
      currentData = {};
      parseKV(section, currentData);
    } else if (section.startsWith("[OUTFIT]") || section.includes("[OUTFIT]")) {
      currentType = "outfit";
      currentData = {};
      parseKV(section, currentData);
    }

    if (Object.keys(currentData).length > 0) {
      if (currentType === "char" && currentData.name) result.characters.push(currentData);
      else if (currentType === "event" && currentData.id) result.timelines.push(currentData);
      else if (currentType === "scene" && currentData.location) result.scenes.push(currentData);
      else if (currentType === "outfit" && currentData.character) result.outfits.push(currentData);
    }
  }

  return result;
}

function parseKV(text, obj) {
  for (const line of text.split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) {
      const key = m[1].trim();
      let val = m[2].trim();
      // 数字转换
      if (key === "base_age" || key === "grade" || key === "min_day" || key === "affection") {
        val = parseInt(val) || 0;
      }
      obj[key] = val;
    }
  }
}

// ── 输出 ──
function writeOutput(ip, registry, gameCtx) {
  const dataDir = path.resolve(process.cwd(), "data");
  const timelineDir = path.join(dataDir, "timelines", ip);
  fs.mkdirSync(timelineDir, { recursive: true });

  // Characters — 合并到已有
  const charPath = path.join(dataDir, "characters.json");
  let existingChars = [];
  if (fs.existsSync(charPath)) {
    try { existingChars = JSON.parse(fs.readFileSync(charPath, "utf-8")); } catch {}
  }
  const existingNames = new Set(existingChars.map(c => c.name));
  let addedChars = 0;
  for (const [name, info] of Object.entries(registry.characters)) {
    if (existingNames.has(name) || gameCtx.existingChars.has(name)) continue;
    existingChars.push({
      name,
      source: ip,
      gender: info.gender || "女",
      base_age: info.base_age || 16,
      personality_text: info.personality || "",
      appearance_brief: info.appearance || "",
      tags: info.club ? [info.club] : (info.role === "teacher" ? ["教师"] : []),
    });
    existingNames.add(name);
    addedChars++;
  }
  if (addedChars > 0) {
    fs.writeFileSync(charPath, JSON.stringify(existingChars, null, 2), "utf-8");
    console.log(`[输出] characters.json: +${addedChars} (总计 ${existingChars.length})`);
  }

  // Timelines
  let addedTL = 0;
  for (const t of registry.timelines) {
    const evPath = path.join(timelineDir, `${t.id}.json`);
    if (fs.existsSync(evPath)) continue;
    // 补全格式
    const event = {
      id: t.id,
      title: t.title,
      source: ip,
      trigger: {
        min_day: t.min_day || 1,
        location: t.location || "",
        affection: t.affection || 0,
      },
      expires_days: 0,
      repeatable: false,
      hook: {
        source_npc: "",
        hook_text: t.hook_text || "",
        urgency: t.urgency || "medium",
      },
      beats: [{
        id: "start",
        label: "开始",
        prompt: t.hook_text || "",
        outcomes: [{ pick: "接受", effects: { flags: { [`quest_${t.id}`]: true } } }],
      }],
    };
    fs.writeFileSync(evPath, JSON.stringify(event, null, 2), "utf-8");
    addedTL++;
  }
  console.log(`[输出] timelines/${ip}/: +${addedTL} 个事件`);

  // Scenes
  const scenePath = path.join(dataDir, "scene_atmosphere.json");
  let existingScenes = [];
  if (fs.existsSync(scenePath)) {
    try { existingScenes = JSON.parse(fs.readFileSync(scenePath, "utf-8")); } catch {}
  }
  const mergedScenes = [...existingScenes, ...registry.scenes];
  if (registry.scenes.length > 0) {
    fs.writeFileSync(scenePath, JSON.stringify(mergedScenes, null, 2), "utf-8");
    console.log(`[输出] scene_atmosphere.json: +${registry.scenes.length} (总计 ${mergedScenes.length})`);
  }

  // Outfits
  const outfitPath = path.join(dataDir, "outfit_descriptions.json");
  let existingOutfits = [];
  if (fs.existsSync(outfitPath)) {
    try { existingOutfits = JSON.parse(fs.readFileSync(outfitPath, "utf-8")); } catch {}
  }
  const mergedOutfits = [...existingOutfits, ...registry.outfits];
  if (registry.outfits.length > 0) {
    fs.writeFileSync(outfitPath, JSON.stringify(mergedOutfits, null, 2), "utf-8");
    console.log(`[输出] outfit_descriptions.json: +${registry.outfits.length} (总计 ${mergedOutfits.length})`);
  }
}

// ── 主流程 ──
async function main() {
  const args = process.argv.slice(2);
  let inputFile = "", ip = "oregairu";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) inputFile = args[++i];
    else if (args[i] === "--ip" && args[i + 1]) ip = args[++i];
  }
  if (!inputFile) { console.error("用法: node novel-to-data-v2.mjs --input <文件> [--ip <IP名>]"); process.exit(1); }
  if (!CONFIG.apiKey) { console.error("请设置 DEEPSEEK_API_KEY"); process.exit(1); }

  const text = fs.readFileSync(inputFile, "utf-8");
  console.log(`加载文本: ${text.length} 字`);

  const gameCtx = loadGameContext();
  console.log(`游戏约束: ${gameCtx.existingChars.size} 已有角色, ${gameCtx.existingLocations.size} 已有地点`);

  const chapters = splitChapters(text);
  console.log(`章节: ${chapters.length} 章`);

  const registry = new EntityRegistry();

  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci];
    console.log(`\n[第 ${ci + 1}/${chapters.length} 章] ${ch.title} (${ch.content.length} 字)`);

    const ctx = registry.toContextString(gameCtx);
    const prompt = EXTRACT_PROMPT(ch.title, ch.content, ctx);

    try {
      const raw = await callLLM(prompt);
      const extracted = parseExtraction(raw);

      // 注册
      for (const c of extracted.characters) {
        registry.registerCharacter(c.name, c);
      }
      for (const t of extracted.timelines) {
        registry.timelines.push(t);
      }
      for (const s of extracted.scenes) {
        registry.scenes.push(s);
      }
      for (const o of extracted.outfits) {
        registry.outfits.push(o);
      }

      // 更新故事摘要
      if (extracted.timelines.length > 0) {
        registry.storySummary += `第${ci+1}章 ${ch.title}: ${extracted.timelines.map(t=>t.title).join("、")}。`;
      }

      console.log(`  角色: +${extracted.characters.length} | 事件: +${extracted.timelines.length} | 场景: +${extracted.scenes.length} | 服装: +${extracted.outfits.length}`);
    } catch (e) {
      console.error(`  失败: ${e.message}`);
    }
  }

  // 输出
  console.log(`\n总计: ${Object.keys(registry.characters).length} 角色, ${registry.timelines.length} 事件, ${registry.scenes.length} 场景, ${registry.outfits.length} 服装`);
  writeOutput(ip, registry, gameCtx);
  console.log("\n✅ 完成。");
}

main().catch(e => { console.error(e); process.exit(1); });
