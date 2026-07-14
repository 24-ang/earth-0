/**
 * engine/conditional-options.ts — Phase 1.5: 条件选项扫描器（引擎侧，不调 LLM）
 *
 * 根据玩家属性/技能/物品/关系/身份/环境，纯引擎计算出当前可用的条件选项。
 * 结果注入 Phase 3 的 directorNote，LLM 追加到标准 ①-④ 选项之后。
 *
 * 参考：酒馆原型 "选项DLC2.09 — 全局条件选项机制"
 */

export interface ConditionalOption {
  text: string;
  tag: string;     // 显示条件，如 "力量≥8" "观察 Lv2" "持有:手帕"
  category: "属性" | "技能" | "道具" | "关系" | "身份" | "环境";
  priority: number; // 越低越靠前
}

/** 扫描 gameState，返回当前场景可用的条件选项（最多 4 个） */
export function scanConditionalOptions(gs: any): ConditionalOption[] {
  const results: ConditionalOption[] = [];
  const p = gs?.player; if (!p) return [];
  const loc = p.location || "";
  const attrs = p.attributes || {};
  const skills = p.skills || {};
  const inv: any[] = p.inventory || [];
  const rels = p.relationships || {};
  const party: string[] = p.party || [];

  // ── 1. 属性门槛 ──
  const str = attrs.力量 ?? attrs.strength ?? 10;
  const dex = attrs.敏捷 ?? attrs.dexterity ?? 10;
  const con = attrs.体质 ?? attrs.constitution ?? 10;
  const int = attrs.智力 ?? attrs.intelligence ?? 10;
  const wis = attrs.感知 ?? attrs.perception ?? 10;
  const cha = attrs.魅力 ?? attrs.charisma ?? 10;

  if (str >= 7)   results.push({ text: "用蛮力强行打开", tag: `力量≥7`, category: "属性", priority: 10 });
  if (str >= 9)   results.push({ text: "直接撞开障碍物", tag: `力量≥9`, category: "属性", priority: 11 });
  if (dex >= 8)   results.push({ text: "悄无声息地靠近目标", tag: `敏捷≥8`, category: "属性", priority: 12 });
  if (int >= 8)   results.push({ text: "尝试推理/分析当前状况", tag: `智力≥8`, category: "属性", priority: 13 });
  if (cha >= 7)   results.push({ text: "用言语安抚/说服对方", tag: `魅力≥7`, category: "属性", priority: 14 });
  if (wis >= 8)   results.push({ text: "注意到环境的细微异常", tag: `感知≥8`, category: "属性", priority: 15 });

  // ── 2. 技能门槛 ──
  const skLv = (name: string): number => {
    for (const [k, v] of Object.entries(skills)) {
      if (k.includes(name)) return (v as any)?.level ?? 0;
    }
    return 0;
  };
  const obs = skLv("观");  // 观察/洞察
  const stealth = skLv("潜");
  const talk = skLv("话") || skLv("说") || skLv("口");
  const medic = skLv("医") || skLv("急") || skLv("救");
  const psych = skLv("心") || skLv("催") || skLv("暗");

  if (obs >= 1)    results.push({ text: "仔细观察对方的反应", tag: `观察 Lv${obs}`, category: "技能", priority: 20 });
  if (obs >= 2)    results.push({ text: "发现对方隐藏的情绪/意图", tag: `观察 Lv${obs}`, category: "技能", priority: 21 });
  if (stealth >= 1) results.push({ text: "趁对方不注意悄悄行动", tag: `潜行 Lv${stealth}`, category: "技能", priority: 22 });
  if (talk >= 1)   results.push({ text: "运用话术获取信息", tag: `话术 Lv${talk}`, category: "技能", priority: 23 });
  if (medic >= 1)  results.push({ text: "检查伤口/提供急救", tag: `医疗 Lv${medic}`, category: "技能", priority: 24 });
  if (psych >= 1)  results.push({ text: "用心理暗示引导对话", tag: `暗示 Lv${psych}`, category: "技能", priority: 25 });

  // ── 3. 道具 ──
  const hasItem = (name: string): boolean => inv.some((i: any) => (i.name || i).includes(name));
  if (hasItem("手帕") || hasItem("纸巾"))   results.push({ text: "递上手帕/纸巾", tag: "持有:手帕", category: "道具", priority: 30 });
  if (hasItem("手机"))                      results.push({ text: "拿出手机查看/拍照", tag: "持有:手机", category: "道具", priority: 31 });
  if (hasItem("钱包") || hasItem("钱"))     results.push({ text: "掏出钱包/现金", tag: "持有:现金", category: "道具", priority: 32 });
  if (hasItem("笔") || hasItem("纸") || hasItem("记事本")) results.push({ text: "拿出纸笔记下信息", tag: "持有:文具", category: "道具", priority: 33 });
  if (p.funds >= 100)                       results.push({ text: "用钱解决问题", tag: `¥${p.funds}`, category: "道具", priority: 34 });
  // 武器
  if (hasItem("刀") || hasItem("剑") || hasItem("铁管") || hasItem("棍")) results.push({ text: "握住武器威慑对方", tag: "持有:武器", category: "道具", priority: 35 });
  // 载具
  if (p.vehicle?.name) results.push({ text: `骑上${p.vehicle.name}移动`, tag: "载具可用", category: "道具", priority: 36 });

  // ── 4. 关系 ──
  const nearbyNpcs: string[] = [];
  if (gs.npcs && loc) {
    const { isSameLocation } = require("./state.ts");
    for (const [name, npc] of Object.entries(gs.npcs) as [string, any][]) {
      if (npc.alive !== false && isSameLocation(npc.currentRoom, loc)) nearbyNpcs.push(name);
    }
  }

  for (const nm of nearbyNpcs) {
    const rel = rels[nm];
    if (!rel) continue;
    const aff = rel.affection ?? 0;
    const stage = rel.stage || "";
    const rom = rel.romance || "";

    if (rom === "恋人" && aff >= 80)
      results.push({ text: `亲密地靠近${nm}`, tag: `恋人:${nm}`, category: "关系", priority: 40 });
    if (rom === "恋人" || aff >= 60)
      results.push({ text: `温柔地碰碰${nm}`, tag: `♥${aff}:${nm}`, category: "关系", priority: 41 });
    if (aff >= 40)
      results.push({ text: `向${nm}求助/搭话`, tag: `友好:${nm}`, category: "关系", priority: 42 });
    // 队伍成员
    if (party.includes(nm))
      results.push({ text: `和${nm}商量对策`, tag: `队友:${nm}`, category: "关系", priority: 43 });
  }

  // ── 5. 身份/声望 ──
  if (p.social_class === "上流階級" || p.social_class === "资产阶级")
    results.push({ text: "以高贵身份施压", tag: `身份:${p.social_class}`, category: "身份", priority: 50 });
  if (p.reputation && Object.keys(p.reputation).length > 0) {
    for (const [k, v] of Object.entries(p.reputation)) {
      if ((v as number) >= 5) results.push({ text: `利用${k}声望行事`, tag: `${k}声望${v}`, category: "身份", priority: 51 });
      break; // 只取第一个
    }
  }
  if (p.titles?.length > 0)
    results.push({ text: `以"${p.titles[0]}"的身份介入`, tag: `称号:${p.titles[0]}`, category: "身份", priority: 52 });

  // ── 6. 环境 ──
  if (loc.includes("校")) {
    results.push({ text: "去社团活动室看看", tag: "校园", category: "环境", priority: 60 });
    if (loc.includes("部室") || loc.includes("教室"))
      results.push({ text: "在教室里找线索", tag: "室内", category: "环境", priority: 61 });
  }
  if (loc.includes("街") || loc.includes("駅") || loc.includes("店")) {
    results.push({ text: "环顾四周的店铺", tag: "街区", category: "环境", priority: 62 });
    results.push({ text: "向路人打听消息", tag: "路人", category: "环境", priority: 63 });
  }
  if (loc.includes("家") || loc.includes("自宅") || loc.includes("居室")) {
    results.push({ text: "在家中翻找有用物品", tag: "居家", category: "环境", priority: 64 });
    results.push({ text: "坐下来休息整理思路", tag: "休息", category: "环境", priority: 65 });
  }

  // 检查房间家具
  try {
    const { getRoom } = require("./state.ts");
    const rm = getRoom(loc);
    if (rm?.cells) {
      for (let y = 0; y < rm.height; y++) for (let x = 0; x < rm.width; x++) {
        const c = rm.cells[y]?.[x];
        if (!c?.furniture) continue;
        const f = c.furniture as string;
        if (f.includes("书桌") || f.includes("桌子")) results.push({ text: `使用${f}`, tag: "家具", category: "环境", priority: 70 });
        if (f.includes("床")) results.push({ text: "在床上休息片刻", tag: "休息", category: "环境", priority: 71 });
        if (f.includes("椅") || f.includes("沙发") || f.includes("凳")) results.push({ text: "坐下来思考", tag: "坐下", category: "环境", priority: 72 });
        if (f.includes("贩卖机")) results.push({ text: "在自动贩卖机买饮料", tag: "设施", category: "环境", priority: 73 });
        break; // 只检查前几个家具
      }
    }
  } catch {}

  // ── 排序 + 去重 + 截断 ──
  const seen = new Set<string>();
  const deduped: ConditionalOption[] = [];
  for (const o of results.sort((a, b) => a.priority - b.priority)) {
    const key = o.tag;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(o);
    if (deduped.length >= 4) break;
  }

  return deduped;
}

/** 将条件选项格式化为 Phase 3 输出格式的文本行 */
export function formatConditionalOptions(opts: ConditionalOption[]): string {
  if (!opts.length) return "";
  const start = 4; // 标准选项是 ①-④，条件选项从 ⑤ 开始
  return "\n" + opts.map((o, i) => {
    const idx = String.fromCodePoint(0x2460 + start + i);
    return `> ${idx} [${o.tag}]: ${o.text}`;
  }).join("\n");
}
