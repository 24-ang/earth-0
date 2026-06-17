import { allChars } from "./engine/router.ts";
import { getBodyForAge, getNpcCurrentAge, getOrCreateNPC, getNPCOutfitDesc } from "./engine/state.ts";

async function run() {
  const targetName = "雪乃";
  const char = allChars.find((c: any) => c.name === targetName || c.name.includes(targetName));
  const age = getNpcCurrentAge(char.base_age || 16);
  const body = getBodyForAge(char, age);
  const lines = [
    `${char.name} | ${char.gender === "female" ? "女" : "男"} | ${age}岁 (基础:${char.base_age})`,
    `── 外观 ──`
  ];
  const outfitRaw = getNPCOutfitDesc(char.name);
  const outfitParts = outfitRaw.split("。内: ");
  lines.push(`穿着: ${outfitParts[0]}`);
  if (outfitParts[1]) lines.push(`内衣: ${outfitParts[1]}`);
  if (body) {
    lines.push(`── 身体 ──`);
    lines.push(`身材: ${body.height_cm}cm ${body.weight_kg}kg ${body.build}`);
    let meas = `三围: `;
    if (body.measurements) meas += `${body.measurements.bust}-${body.measurements.waist}-${body.measurements.hips}`;
    if (body.cup) meas += ` (${body.cup}cup)`;
    if (body.body_shape) {
        const bs = body.body_shape;
        meas += ` [${bs.chest||""} ${bs.waist||""} ${bs.hips?bs.hips+"臀":""}]`;
    }
    if (meas !== `三围: `) lines.push(meas.replace(/\s+/g, ' '));
    let feats = `特征: `;
    if (body.leg_type) feats += `${body.leg_type}腿 | `;
    if (body.skin) feats += `肤质:${body.skin.texture} | 肤色:${body.skin.base_tone}`;
    if (feats !== `特征: `) lines.push(feats.replace(/ \|\s*$/, ''));
  }
  if (char.attributes) {
    lines.push(`── 属性 ──`);
    const a = char.attributes;
    lines.push(`力${a.力量 ?? 10} 敏${a.敏捷 ?? 10} 体${a.体质 ?? 10} 智${a.智力 ?? 10} 感${a.感知 ?? 10} 魅${a.魅力 ?? 10}`);
  }
  const npcState = getOrCreateNPC(char.name);
  // Add some fake inventory to demonstrate wrapping
  npcState.inventory = [{name: "手机"}, {name: "学生证"}, {name: "文库本小说"}, {name: "防狼喷雾"}, {name: "潘先生布偶"}, {name: "钥匙"}];
  const eq = Object.entries(npcState.equipment).filter(([_, v]) => v);
  if (eq.length > 0) {
    lines.push(`── 装备明细 ──`);
    const SLOT_NAMES: Record<string, string> = {
      top: "外套大衣", shirt: "内搭衬衫", inner_top: "胸罩/裹胸", bottom: "下装/裙子", inner_bot: "内裤/胖次", legs: "丝袜/连裤袜", feet: "脚部鞋子", head: "头部/发饰", acc: "配饰/挂件", left_hand: "副手/左手", right_hand: "主手/右手", back: "背部/背包"
    };
    eq.forEach(([s, it]) => {
      lines.push(`[${SLOT_NAMES[s]||s}] ${(it as any).name}`);
    });
  }
  if (npcState.inventory && npcState.inventory.length > 0) {
    lines.push("────────────────────────────────────────");
    lines.push(`🎒 携带物品:`);
    const items = npcState.inventory.map((i: any) => i.name);
    for (let i = 0; i < items.length; i += 3) {
      lines.push(`  ${items.slice(i, i + 3).join(" | ")}`);
    }
  }
  console.log("============================================================");
  console.log(`                      👁️ 观察: ${targetName}`);
  console.log("============================================================");
  console.log(lines.join("\n"));
  console.log("============================================================");
}
run().catch(console.error);
