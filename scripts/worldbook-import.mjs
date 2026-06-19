#!/usr/bin/env node
/**
 * ST 世界书 → earth-0 lore 通用转换
 *
 * 用法:
 *   node scripts/worldbook-import.mjs <世界书.json> --ip <世界名> [--dry]
 *
 * 输入: 任意 SillyTavern 世界书 JSON（{ entries: { "0": { key:[], content:"" }, ... } }）
 * 输出: data/lore/{ip}_world.json
 *
 * 与 earth-0 集成:
 *   - 游戏中 GM 通过 lookup_lore 工具按关键词检索
 *   - /lore 命令浏览/搜索 lore 条目
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.resolve(process.cwd(), "data", "lore");

// ── 参数解析 ──
const dryRun = process.argv.includes("--dry");
const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const inputFile = args[0];
let ip = "";

const ipIdx = process.argv.indexOf("--ip");
if (ipIdx >= 0 && process.argv[ipIdx + 1]) ip = process.argv[ipIdx + 1];

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error("用法: node scripts/worldbook-import.mjs <世界书.json> --ip <世界名> [--dry]");
  console.error("示例: node scripts/worldbook-import.mjs 动漫角色.json --ip oregairu");
  process.exit(1);
}
if (!ip) {
  // 从文件名推断
  ip = path.basename(inputFile, ".json").replace(/[^\w一-鿿]/g, "_").slice(0, 30);
  console.log(`未指定 --ip，从文件名推断: ${ip}`);
}

// ── 读取 ──
const wb = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
const entries = wb.entries || wb;
const entryCount = Object.keys(entries).length;
if (entryCount === 0) { console.error("世界书为空"); process.exit(1); }
console.log(`世界书: ${entryCount} 条`);

// ── 统计 ──
let activeCount = 0, disabledCount = 0, emptyKeys = 0;
for (const v of Object.values(entries)) {
  if (v.disable === true) disabledCount++;
  else activeCount++;
  if (!v.key || v.key.length === 0) emptyKeys++;
}
console.log(`  活跃: ${activeCount}  禁用: ${disabledCount}  无触发词: ${emptyKeys}`);

if (dryRun) {
  console.log("\n[预览模式] 未写入。去掉 --dry 执行导入。");
  process.exit(0);
}

// ── 转换 ──
const lore = {};
const skipped = [];

for (const [, v] of Object.entries(entries)) {
  const entry = v;
  const keys = entry.key || [];
  const content = (entry.content || "").trim();
  if (!content) { skipped.push("空内容"); continue; }
  if (entry.disable === true) { skipped.push(entry.comment || "已禁用"); continue; }

  // 用第一个触发词做 key，无触发词则用 hash
  const firstKey = keys[0];
  let entryId;
  if (firstKey) {
    entryId = firstKey.replace(/[^\w一-鿿]/g, "_").slice(0, 60);
  } else {
    entryId = `entry_${crypto.createHash("md5").update(content).digest("hex").slice(0, 8)}`;
  }

  if (lore[entryId]) {
    // 重复：追加内容
    lore[entryId].content += "\n\n" + content;
    lore[entryId].triggers = [...new Set([...lore[entryId].triggers, ...keys])];
  } else {
    lore[entryId] = {
      triggers: keys.slice(0, 10),
      content: content.slice(0, 1000),
      comment: (entry.comment || "").slice(0, 200),
    };
  }
}

// ── 合并已有 ──
const outFile = path.join(DATA_DIR, `${ip}_world.json`);
let existing = {};
if (fs.existsSync(outFile)) {
  try { existing = JSON.parse(fs.readFileSync(outFile, "utf-8")); } catch {}
}
const merged = { ...existing, ...lore };

// ── 输出 ──
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(merged, null, 2), "utf-8");
console.log(`\n写入: ${outFile}`);
console.log(`  条目: ${Object.keys(lore).length} (新增/覆盖)  总计: ${Object.keys(merged).length}`);
console.log(`  跳过: ${skipped.length} 条 (${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "..." : ""})`);
console.log("\n✅ 完成。游戏中 lookup_lore 按关键词检索。");
