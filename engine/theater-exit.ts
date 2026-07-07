import { gameState, loadActiveWorld, saveState, STATE_FILE, STATE_DIR } from "./state.ts";
import path from "node:path";
import fs from "node:fs";

/**
 * 结算并退出广播观影模式，将记忆与好感穿透渗入主世界
 */
export async function settleTheaterExit(): Promise<string> {
  if (!gameState._theaterActive || !gameState._theaterBackup) {
    throw new Error("当前未在观影模式中，无法执行退场");
  }

  // 1. 解析主世界备份
  const backupState = JSON.parse(gameState._theaterBackup);

  // 2. 统计并换算好感度微偏移 (±1 ~ 3)
  const affectionShifts: Record<string, number> = {};
  for (const [npcName, rel] of Object.entries(gameState.player.relationships)) {
    const baseRel = backupState.player?.relationships?.[npcName];
    if (baseRel) {
      const delta = rel.affection - baseRel.affection;
      if (delta !== 0) {
        const shift = Math.sign(delta) * Math.min(3, Math.ceil(Math.abs(delta) / 10));
        affectionShifts[npcName] = shift;
      }
    }
  }

  // 3. 提取观影行动摘要
  const actionsSummary = gameState._theaterActions && gameState._theaterActions.length > 0
    ? gameState._theaterActions.slice(0, 5).join("、")
    : "平行宇宙的异常观测";

  // 4. 清理所有临时观影持久化文件
  const filesToClean = [
    path.join(STATE_DIR, "theater_session.json"),
    path.join(STATE_DIR, "theater_rooms_delta.json"),
    path.join(STATE_DIR, "theater_locations_delta.json"),
    path.join(STATE_DIR, "theater_dynamic_characters.json"),
    path.join(STATE_DIR, "theater_furniture_containers.json")
  ];
  for (const f of filesToClean) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
      }
    } catch (e) {
      console.error(`settleTheaterExit: 清理临时文件失败 ${f}:`, e);
    }
  }

  // 5. 原地恢复主世界 GameState 引用
  for (const key of Object.keys(gameState)) {
    delete (gameState as any)[key];
  }
  Object.assign(gameState, backupState);

  // 6. 重置观影状态标志，切回主世界指针
  gameState._theaterActive = false;
  gameState._theaterBackup = undefined;
  gameState._theaterScriptId = undefined;
  gameState._theaterPhase = undefined;
  gameState._danmakuCooldown = undefined;
  gameState._commentaryCooldown = undefined;
  gameState._theaterActions = undefined;

  loadActiveWorld(gameState.activeWorld || "oregairu");

  // 7. 应用好感度穿透微偏移与记忆渗透
  const appliedLogs: string[] = [];
  for (const [npcName, shift] of Object.entries(affectionShifts)) {
    const rel = gameState.player.relationships[npcName];
    if (rel) {
      const oldAff = rel.affection;
      rel.affection = Math.max(0, Math.min(100, rel.affection + shift));
      appliedLogs.push(`${npcName}好感: ${oldAff} → ${rel.affection} (${shift >= 0 ? "+" : ""}${shift})`);
    }
  }

  // 写入记忆渗透
  const involvedNPCs = new Set([...Object.keys(affectionShifts), "雪之下雪乃"]);
  for (const npcName of involvedNPCs) {
    const npc = gameState.npcs[npcName];
    if (npc) {
      npc.memoryTags ??= [];
      npc.memoryTags.push({
        tag: `平行视界感触：在虚构的观测中，经历了【${actionsSummary}】，这让你留下了一丝异样的直觉。`,
        time: gameState.time.game_date
      });
    }
  }

  // 8. 强制落盘保存主存
  saveState();

  let details = `观影已结束，屏幕徐徐关闭。记忆已渗入对话缝隙。\n`;
  if (appliedLogs.length > 0) {
    details += `好感度微偏变化：\n` + appliedLogs.map(l => `  • ${l}`).join("\n");
  }
  return details;
}
