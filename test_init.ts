import initGame from "./tools/state/init_game.ts";
import initProfile from "./tools/state/init_profile.ts";
import { gameState } from "./engine/state.ts";

await initGame.default.execute("t", { name: "校医", gender: "女", age: 35, year: 2018 }, null, null, null);
const r = await initProfile.default.execute("t", { profileId: "千叶市上班族" }, null, null, null);
console.log(r.content[0].text);
console.log("\n── 快照 ──");
console.log("体型:", gameState.player.body.height_cm + "cm/" + gameState.player.body.weight_kg + "kg/" + gameState.player.body.build);
console.log("技能:", Object.entries(gameState.player.skills || {}).map(([k, v]: [string, any]) => k + " Lv" + v.level).join(", "));
console.log("flags:", Object.keys(gameState.flags || {}).join(", "));
console.log("内衣:", gameState.player.equipment.inner_top?.name, "/", gameState.player.equipment.inner_bot?.name);
console.log("住宅:", Object.keys(gameState.player.properties || {}).join(", ") || "无");
console.log("身份:", gameState.player.public_identity || "无");
console.log("生殖器:", gameState.sexStates?.["校医"] ? "✅ 已生成" : "❌");
console.log("角色DB匹配:", (() => { try { const { findCharacter } = require("./engine/state.ts"); return findCharacter("校医") ? "✅" : "❌ 无数据"; } catch { return "❌"; } })());
