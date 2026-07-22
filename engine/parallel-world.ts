import { gameState, loadActiveWorld, initPlayerGrid, saveState, characters, getOrCreateNPC } from "./state.ts";

/**
 * 启动平行时空广播世界（观影替换模式）
 * @param scriptWorld 目标广播世界包的ID（如 "test_broadcast"）
 */
export async function startParallelWorld(scriptWorld: string): Promise<void> {
  if (gameState._theaterActive) {
    throw new Error("当前已在广播观影模式中，不可重复启动");
  }

  // 1. 深拷贝备份主世界状态
  gameState._theaterBackup = JSON.stringify(gameState);
  gameState._theaterActive = true;
  gameState._theaterScriptId = scriptWorld;
  gameState._theaterPhase = "adaptation";
  gameState._danmakuCooldown = 2; // 3回合后第一次匿名弹幕
  gameState._commentaryCooldown = 3; // 4回合后第一次NPC吐槽
  gameState._theaterActions = [];

  // 2. 加载广播世界包数据
  loadActiveWorld(scriptWorld);

  // 3. 角色卡增量覆写 (extends & override)
  const backupState = JSON.parse(gameState._theaterBackup);
  const newNPCs: Record<string, any> = {};

  for (const c of characters) {
    const charName = c.name;
    const baseNpc = backupState.npcs?.[charName];

    if (baseNpc) {
      // 继承主世界NPC的心智（好感、关系、已知秘密等），但属性与出勤地点被覆盖
      const cloned = JSON.parse(JSON.stringify(baseNpc));
      cloned.attributes = { ...cloned.attributes, ...(c.attributes || {}) };
      if (c.appearance_brief) cloned.appearance_brief = c.appearance_brief;
      cloned.currentRoom = c.default_location || cloned.currentRoom;
      cloned.gridPos = null;
      if (c.inventory) cloned.inventory = JSON.parse(JSON.stringify(c.inventory));
      if (c.equipment) cloned.equipment = JSON.parse(JSON.stringify(c.equipment));
      newNPCs[charName] = cloned;
    } else {
      // 新NPC（非主世界角色）直接初始化
      const newNpc = getOrCreateNPC(charName);
      newNpc.currentRoom = c.default_location || "平行荒野";
      newNpc.gridPos = null;
      newNPCs[charName] = newNpc;
    }
  }

  // 覆写当前 npcs 集合
  gameState.npcs = newNPCs;

  // 4. 重置玩家的平行世界状态与位置
  const { rooms } = await import("./state.ts");
  const startRoom = Object.keys(rooms)[0] || "平行荒野";
  gameState.player.location = startRoom;
  gameState.player.gridPos = null;
  gameState.player.party = [];
  gameState.player.following = [];

  // 初始化网格位置
  initPlayerGrid();

  // 5. 保存临时观影进度档
  saveState();
}
