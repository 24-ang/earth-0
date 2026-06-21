/**
 * 买房与房产系统
 */

import fs from "node:fs";
import path from "node:path";
import type { GameState } from "./types.ts";
import { lookupRegion } from "./router.ts";
import { itemsCatalog } from "./state.ts";

function getRestoredItem(name: string, fallbackWeight: number, fallbackVolume?: number): any {
  let itemData: any = null;
  for (const cat of Object.values(itemsCatalog || {})) {
    if ((cat as any)[name]) {
      itemData = (cat as any)[name];
      break;
    }
  }
  if (itemData) {
    return structuredClone(itemData);
  }
  return {
    name,
    type: "consumable",
    slot: "left_hand",
    weight: fallbackWeight,
    state: "intact",
    effects: [],
    flavor: "房产清理退回的物品",
    volume: fallbackVolume ?? 0.05,
  };
}

/**
 * 辅助函数：根据当前日期推算新的日期字符串（加 N 天）
 */
export function advanceDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 获取房产静态名录
 */
export function getHousingCatalog(gameState: GameState): Record<string, any> {
  const world = gameState.activeWorld || "oregairu";
  const worldpackPath = path.resolve(process.cwd(), "worldpacks", world, "housing.json");
  if (fs.existsSync(worldpackPath)) {
    try {
      return JSON.parse(fs.readFileSync(worldpackPath, "utf-8"));
    } catch (_) {}
  }
  const defaultPath = path.resolve(process.cwd(), "data", "housing.json");
  try {
    return JSON.parse(fs.readFileSync(defaultPath, "utf-8"));
  } catch (_) {
    return {};
  }
}

/**
 * 购买或租赁房产
 */
export function purchaseOrRentProperty(
  propertyId: string,
  action: "buy" | "rent" | "terminate",
  gameState: GameState
): string {
  const catalog = getHousingCatalog(gameState);
  const propConfig = catalog[propertyId];
  if (!propConfig && action !== "terminate") {
    throw new Error(`未在房产名录中找到 ID 为 [${propertyId}] 的房产`);
  }

  if (action === "buy") {
    if (gameState.player.properties[propertyId]) {
      throw new Error(`你已拥有或租赁了该房产: ${gameState.player.properties[propertyId].name}`);
    }
    const price = propConfig.purchase_price ?? 100000;
    if (gameState.player.funds < price) {
      throw new Error(`资金不足，购买此房产需要 ${price}，当前仅有 ${gameState.player.funds}`);
    }
    gameState.player.funds -= price;
    gameState.player.properties[propertyId] = {
      propertyId,
      name: propConfig.name,
      regionId: propConfig.regionId,
      type: "own",
      storage: [],
      max_volume: propConfig.max_volume ?? 100.0,
      max_weight: propConfig.max_weight ?? 200.0,
      arrears_days: 0,
    };
    return `购买成功！你已成为 [${propConfig.name}] 的永久所有人。区域确权已完成。`;
  }

  if (action === "rent") {
    if (gameState.player.properties[propertyId]) {
      throw new Error(`你已拥有或租赁了该房产: ${gameState.player.properties[propertyId].name}`);
    }
    const rentPrice = propConfig.rent_price ?? 1000;
    if (gameState.player.funds < rentPrice) {
      throw new Error(`资金不足，起租需要支付首月租金 ${rentPrice}，当前仅有 ${gameState.player.funds}`);
    }
    gameState.player.funds -= rentPrice;
    gameState.player.properties[propertyId] = {
      propertyId,
      name: propConfig.name,
      regionId: propConfig.regionId,
      type: "rent",
      rent_fee: rentPrice,
      rent_due_date: advanceDateString(gameState.time.game_date, 30),
      storage: [],
      max_volume: propConfig.max_volume ?? 100.0,
      max_weight: propConfig.max_weight ?? 200.0,
      arrears_days: 0,
    };
    return `租房成功！你已租下 [${propConfig.name}]，首月租金已扣除，下次扣款日为 ${gameState.player.properties[propertyId].rent_due_date}。`;
  }

  if (action === "terminate") {
    const existing = gameState.player.properties[propertyId];
    if (!existing) {
      throw new Error(`你没有租赁或拥有该房产: ${propertyId}`);
    }
    // 强制将储物箱内所有物品倒回背包
    for (const sItem of existing.storage) {
      for (let q = 0; q < sItem.quantity; q++) {
        gameState.player.inventory.push(getRestoredItem(sItem.name, sItem.weight, sItem.volume));
      }
    }
    delete gameState.player.properties[propertyId];
    return `租约/所有权已解除。[${existing.name}] 的区域控制权已归还公有，箱内物品已退回背包。`;
  }

  return "";
}

/**
 * 在房产内存储或取出物品
 */
export function transferHousingStorage(
  propertyId: string,
  action: "store" | "retrieve",
  itemName: string,
  quantity: number,
  gameState: GameState
): string {
  const property = gameState.player.properties[propertyId];
  if (!property) {
    throw new Error(`你未租赁或拥有该房产: ${propertyId}`);
  }

  // 校验物理位置：玩家必须在房产的 region 范围内
  const matched = lookupRegion(gameState.player.location).matched_regions;
  const inRegion = matched.some(r => r.name === property.regionId);
  if (!inRegion && gameState.player.location !== property.regionId) {
    throw new Error(`你当前不在此房产安全屋内（房产位于 [${property.regionId}]，你位于 [${gameState.player.location}]）`);
  }

  if (action === "store") {
    // 在玩家背包中查找匹配的物品
    const matchingItems = gameState.player.inventory.filter(i => i.name === itemName);
    if (matchingItems.length < quantity) {
      throw new Error(`背包中没有足够的 [${itemName}]（需要 ${quantity}，当前仅有 ${matchingItems.length}）`);
    }

    const testItem = matchingItems[0];
    const itemWeight = testItem.weight ?? 0.1;
    const itemVolume = (testItem as any).volume ?? 0.05;

    // 校验储物箱限制
    const curVol = property.storage.reduce((sum, i) => sum + i.volume * i.quantity, 0);
    const curWgt = property.storage.reduce((sum, i) => sum + i.weight * i.quantity, 0);

    const extraVol = itemVolume * quantity;
    const extraWgt = itemWeight * quantity;

    if (curVol + extraVol > property.max_volume) {
      throw new Error(`储物箱体积已满（剩余空间 ${Math.max(0, property.max_volume - curVol).toFixed(2)}，需要 ${extraVol.toFixed(2)}）`);
    }
    if (curWgt + extraWgt > property.max_weight) {
      throw new Error(`储物箱承重超限（剩余承重 ${Math.max(0, property.max_weight - curWgt).toFixed(2)}，需要 ${extraWgt.toFixed(2)}）`);
    }

    // 执行转移
    // 1. 从玩家背包移除对应数量
    let removed = 0;
    gameState.player.inventory = gameState.player.inventory.filter(item => {
      if (item.name === itemName && removed < quantity) {
        removed++;
        return false;
      }
      return true;
    });

    // 2. 存入储物箱
    const storageItem = property.storage.find(i => i.name === itemName);
    if (storageItem) {
      storageItem.quantity += quantity;
    } else {
      property.storage.push({
        name: itemName,
        quantity,
        volume: itemVolume,
        weight: itemWeight,
      });
    }

    return `存入成功！已将背包中的 ${quantity} 件 [${itemName}] 放入储物柜。`;
  }

  if (action === "retrieve") {
    const storageItem = property.storage.find(i => i.name === itemName);
    if (!storageItem || storageItem.quantity < quantity) {
      throw new Error(`储物柜中没有足够的 [${itemName}]（需要 ${quantity}，当前仅有 ${storageItem ? storageItem.quantity : 0}）`);
    }

    // 执行转移
    // 1. 从储物柜扣除数量
    storageItem.quantity -= quantity;
    if (storageItem.quantity <= 0) {
      property.storage = property.storage.filter(i => i.name !== itemName);
    }

    // 2. 放入玩家背包
    for (let q = 0; q < quantity; q++) {
      gameState.player.inventory.push(getRestoredItem(itemName, storageItem.weight, storageItem.volume));
    }

    return `取出成功！已将 ${quantity} 件 [${itemName}] 从储物柜取出并放入背包。`;
  }

  return "";
}

/**
 * 每日租金自动结算与欠费强制清退
 */
export function settleHousingContracts(gameState: GameState) {
  const currentDate = gameState.time.game_date;
  const properties = gameState.player.properties;
  if (!properties) return;

  for (const [propId, prop] of Object.entries(properties)) {
    if (prop.type === "rent" && prop.rent_due_date === currentDate) {
      const fee = prop.rent_fee ?? 1000;
      if (gameState.player.funds >= fee) {
        // 自动扣减租金并续期
        gameState.player.funds -= fee;
        prop.rent_due_date = advanceDateString(currentDate, 30);
        prop.arrears_days = 0;
        // 清除任何欠费警告
        delete gameState.player.flags[`arrears_warning_${propId}`];
      } else {
        // 欠租天数累加
        prop.arrears_days = (prop.arrears_days ?? 0) + 1;
        if (prop.arrears_days >= 3) {
          // 欠费 3 天，执行强制驱逐清退
          for (const sItem of prop.storage) {
            for (let q = 0; q < sItem.quantity; q++) {
              gameState.player.inventory.push(getRestoredItem(sItem.name, sItem.weight, sItem.volume));
            }
          }
          delete gameState.player.properties[propId];
          gameState.player.flags[`evicted_${propId}`] = true;
          delete gameState.player.flags[`arrears_warning_${propId}`];
        } else {
          // 触发警告
          gameState.player.flags[`arrears_warning_${propId}`] = true;
        }
      }
    }
  }
}
