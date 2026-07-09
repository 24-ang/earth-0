/**
 * 角色卡校验器（只读）——把"靠猜"变成机器可查的清单。
 *
 * 用法：
 *   npx tsx engine/validate-characters.ts          扫 worldpacks/oregairu 三文件，打印 gap 报告
 *   import { validateCharacters } from "./validate-characters.ts"  加载流程内嵌调用
 *
 * 设计：引擎零硬编码——合法 schedule_group 从 schedule_templates.json 动态读，不写死。
 */
import type { StaticCharacter } from "./types.ts";

export type Severity = "error" | "warn" | "info";
export interface CharIssue {
  name: string;
  severity: Severity;
  code: string;
  detail: string;
}
export interface ValidateResult {
  ok: boolean;              // 无 error 即 ok
  issues: CharIssue[];
  summary: Record<string, number>;
}

/** 事实上的必填核心字段（100% 覆盖）。缺任一 → error。 */
export const CORE_REQUIRED: (keyof StaticCharacter)[] = [
  "name", "source", "base_age", "gender", "appearance_brief", "body",
  "attributes", "default_location", "schedule_group", "social_class", "personal_axes",
];

/** 想统计覆盖率的常用可选字段（缺 → info，不是错）。 */
const TRACKED_OPTIONAL = [
  "outfits", "equipment", "body_by_age", "sex_profile",
  "personality_stages", "personality_brief", "speech_style",
] as const;

/**
 * 校验一组角色。
 * @param chars 角色数组
 * @param validGroups 合法 schedule_group 集合（不传则跳过该检查）
 * @param stages   character_stages.json 对象（可选，用于孤儿检测）
 * @param sexProfiles sex_profiles.json 对象（可选，用于孤儿+指针检测）
 */
export function validateCharacters(
  chars: any[],
  validGroups?: Set<string>,
  stages?: Record<string, any>,
  sexProfiles?: Record<string, any>,
): ValidateResult {
  const issues: CharIssue[] = [];
  const names = new Set(chars.map((c) => c.name));
  const add = (name: string, severity: Severity, code: string, detail: string) =>
    issues.push({ name, severity, code, detail });

  for (const c of chars) {
    const nm = c?.name ?? "(无名)";

    // 1. 缺核心必填
    for (const f of CORE_REQUIRED) {
      if (c[f] === undefined || c[f] === null || c[f] === "") {
        add(nm, "error", "missing-core", `缺必填字段 ${String(f)}`);
      }
    }

    // 2. schedule_group 非法枚举
    if (validGroups && validGroups.size) {
      if (c.schedule_group && !validGroups.has(c.schedule_group)) {
        add(nm, "error", "bad-schedule-group", `schedule_group="${c.schedule_group}" 不在模板组名内`);
      }
      if (c.schedule_group_by_age) {
        for (const [age, g] of Object.entries(c.schedule_group_by_age)) {
          if (typeof g === "string" && !validGroups.has(g)) {
            add(nm, "error", "bad-schedule-group", `schedule_group_by_age["${age}"]="${g}" 非法`);
          }
        }
      }
    }

    // 3. base_age 与 body 年龄段矛盾（如小町 15岁却 110cm）
    const ba = c.base_age;
    const h = c.body?.height_cm, w = c.body?.weight_kg;
    if (typeof ba === "number" && ba >= 13 && !c.body_by_age &&
        ((typeof h === "number" && h < 140) || (typeof w === "number" && w < 32))) {
      add(nm, "warn", "body-age-mismatch",
        `base_age=${ba} 但 body=${h}cm/${w}kg（儿童水平）且无 body_by_age`);
    }

    // 4. sex_profile 指针（字符串而非对象）
    if (typeof c.sex_profile === "string") {
      add(nm, "warn", "sexprofile-pointer",
        `sex_profile 是字符串指针 "${c.sex_profile}"，应存完整对象`);
    }

    // 6. 稀疏字段缺失（info）
    for (const f of TRACKED_OPTIONAL) {
      const has = c[f] !== undefined || (f === "sex_profile" && sexProfiles?.[nm]);
      if (!has) add(nm, "info", "missing-optional", `缺 ${f}`);
    }
  }

  // 5. 孤儿键：character_stages / sex_profiles 里有、characters 里没有对应角色
  if (stages) {
    for (const k of Object.keys(stages)) {
      const base = k.replace(/_if$/, "");
      if (!names.has(base)) add(k, "error", "orphan-stage", `character_stages 键 "${k}" 无对应角色`);
    }
  }
  if (sexProfiles) {
    for (const k of Object.keys(sexProfiles)) {
      if (!names.has(k)) add(k, "error", "orphan-sexprofile", `sex_profiles 键 "${k}" 无对应角色`);
    }
  }

  const summary: Record<string, number> = { error: 0, warn: 0, info: 0 };
  for (const i of issues) summary[i.severity] = (summary[i.severity] ?? 0) + 1;
  return { ok: summary.error === 0, issues, summary };
}

// ── CLI ──
async function main() {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const wp = path.resolve(process.cwd(), "worldpacks", "oregairu");
  const readJSON = (f: string) => JSON.parse(fs.readFileSync(path.join(wp, f), "utf-8"));

  // 优先从 characters/ 目录读（每人一文件=真相源，stages/sex_profile 已内联）；无目录回退旧平面文件
  let chars: any[];
  const dir = path.join(wp, "characters");
  if (fs.existsSync(dir)) {
    chars = fs.readdirSync(dir)
      .filter((f: string) => f.endsWith(".json") && !f.startsWith("_"))
      .map((f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
  } else {
    chars = readJSON("characters.json");
  }
  const validGroups = new Set(Object.keys(readJSON("schedule_templates.json")));

  const r = validateCharacters(chars, validGroups);

  const byCode: Record<string, CharIssue[]> = {};
  for (const i of r.issues) (byCode[i.code] ??= []).push(i);

  console.log(`\n=== 角色校验报告（${chars.length} 角色）===`);
  console.log(`error=${r.summary.error}  warn=${r.summary.warn}  info=${r.summary.info}  → ok=${r.ok}\n`);

  const order = ["missing-core", "bad-schedule-group", "orphan-stage", "orphan-sexprofile",
    "body-age-mismatch", "sexprofile-pointer", "missing-optional"];
  for (const code of order) {
    const list = byCode[code];
    if (!list?.length) continue;
    const sev = list[0]!.severity.toUpperCase();
    console.log(`── [${sev}] ${code}（${list.length}）──`);
    if (code === "missing-optional") {
      // 按字段聚合，只报数量 + 名单
      const byField: Record<string, string[]> = {};
      for (const i of list) {
        const f = i.detail.replace("缺 ", "");
        (byField[f] ??= []).push(i.name);
      }
      for (const [f, ns] of Object.entries(byField)) {
        console.log(`   缺 ${f}（${ns.length}）: ${ns.slice(0, 12).join(" ")}${ns.length > 12 ? " …" : ""}`);
      }
    } else {
      for (const i of list.slice(0, 40)) console.log(`   ${i.name}: ${i.detail}`);
      if (list.length > 40) console.log(`   … 还有 ${list.length - 40} 条`);
    }
    console.log("");
  }
}

// tsx 直接运行时执行 CLI（被 import 时不执行）
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("validate-characters.ts")) {
  main().catch((e) => { console.error("validate-characters CLI 失败:", e); process.exit(1); });
}
