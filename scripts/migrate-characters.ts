/**
 * Phase 1 迁移（一次性脚本，可重复运行）：
 * characters.json + character_stages.json(含 _if) + sex_profiles.json
 *   → worldpacks/oregairu/characters/{name}.json（每人一文件）
 *
 * 消除：sex_profile 字符串指针（→ 完整对象）、三文件漂移、双源。
 * 顺手修：3 个非法 schedule_group。
 * 安全：只写新目录，不删旧文件、不动加载器；写完立刻用校验器验。
 */
import fs from "node:fs";
import path from "node:path";
import { validateCharacters } from "../engine/validate-characters.ts";

const wp = path.resolve(process.cwd(), "worldpacks", "oregairu");
const readJSON = (f: string) => JSON.parse(fs.readFileSync(path.join(wp, f), "utf-8"));

const chars: any[] = readJSON("characters.json");
const stages: Record<string, any> = readJSON("character_stages.json");
const sexProfiles: Record<string, any> = readJSON("sex_profiles.json");
const validGroups = new Set(Object.keys(readJSON("schedule_templates.json")));

/** 非法 schedule_group → 合法组名 */
const GROUP_FIX: Record<string, string> = { "社会人": "上班族", "海外": "海外留学", "研究生": "大学生" };
const fixGroup = (g: string) => GROUP_FIX[g] ?? g;

const ILLEGAL = /[\\/:*?"<>|]/;
const outDir = path.join(wp, "characters");
fs.mkdirSync(outDir, { recursive: true });

// collision / illegal 检测
const seen = new Set<string>();
const problems: string[] = [];
for (const c of chars) {
  if (!c.name) { problems.push("有角色无 name"); continue; }
  if (ILLEGAL.test(c.name)) problems.push(`角色名含非法文件字符: ${c.name}`);
  if (seen.has(c.name)) problems.push(`重名: ${c.name}`);
  seen.add(c.name);
}
if (problems.length) { console.error("迁移中止:\n" + problems.join("\n")); process.exit(1); }

let injStages = 0, injIf = 0, injSex = 0, fixedGroup = 0;
const merged: any[] = [];

for (const c of chars) {
  const m = structuredClone(c);

  // 注入 stages / stages_if
  if (stages[c.name]) { m.stages = structuredClone(stages[c.name]); injStages++; }
  if (stages[c.name + "_if"]) { m.stages_if = structuredClone(stages[c.name + "_if"]); injIf++; }

  // sex_profile 指针 → 完整对象
  if (sexProfiles[c.name]) { m.sex_profile = structuredClone(sexProfiles[c.name]); injSex++; }
  else if (typeof m.sex_profile === "string") {
    console.warn(`  ⚠ ${c.name}: 有指针但 sex_profiles.json 无条目，删除悬空指针`);
    delete m.sex_profile;
  }

  // 修非法 schedule_group
  if (typeof m.schedule_group === "string" && GROUP_FIX[m.schedule_group]) {
    m.schedule_group = fixGroup(m.schedule_group); fixedGroup++;
  }
  if (m.schedule_group_by_age) {
    for (const [age, g] of Object.entries(m.schedule_group_by_age)) {
      if (typeof g === "string" && GROUP_FIX[g]) { m.schedule_group_by_age[age] = fixGroup(g); fixedGroup++; }
    }
  }

  merged.push(m);
  fs.writeFileSync(path.join(outDir, `${c.name}.json`), JSON.stringify(m, null, 2), "utf-8");
}

console.log(`\n写入 ${merged.length} 个文件 → ${path.relative(process.cwd(), outDir)}`);
console.log(`注入: stages=${injStages}  stages_if=${injIf}  sex_profile=${injSex}  schedule_group修正=${fixedGroup}`);

// 未被任何角色吸收的 stages/_if/sex 孤儿?
const names = new Set(chars.map((c) => c.name));
const stageOrphans = Object.keys(stages).filter((k) => !names.has(k.replace(/_if$/, "")));
const sexOrphans = Object.keys(sexProfiles).filter((k) => !names.has(k));
if (stageOrphans.length) console.log(`⚠ character_stages 孤儿(未吸收): ${stageOrphans.join(", ")}`);
if (sexOrphans.length) console.log(`⚠ sex_profiles 孤儿(未吸收): ${sexOrphans.join(", ")}`);

// 自校验：合并后应 0 error、0 指针
console.log("\n=== 迁移后自校验 ===");
const r = validateCharacters(merged, validGroups);
console.log(`error=${r.summary.error}  warn=${r.summary.warn}  info=${r.summary.info}  → ok=${r.ok}`);
const pointers = r.issues.filter((i) => i.code === "sexprofile-pointer").length;
const badGroups = r.issues.filter((i) => i.code === "bad-schedule-group").length;
const missCore = r.issues.filter((i) => i.code === "missing-core").length;
console.log(`残留: sex_profile指针=${pointers}  非法组=${badGroups}  缺必填=${missCore}`);
if (pointers || badGroups || missCore) { console.error("❌ 迁移后仍有硬错误"); process.exit(1); }
console.log("✅ 迁移产物无硬错误（剩余 warn/info 为数据缺件 backlog，Phase 3 处理）");
