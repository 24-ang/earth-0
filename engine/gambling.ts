/**
 * 赌博与灰色交易系统
 */

import type { GameState } from "./types.ts";
import { economyConfig } from "./state.ts";

export interface GambleResult {
  success: boolean;
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  payout: number;
  message: string;
  critical?: "success" | "fail";
}

/**
 * 执行一次概率博弈下注
 */
export function executeGamble(
  gameKey: string,
  amount: number,
  strategy: string,
  gameState: GameState
): GambleResult {
  // 1. 扣减本金
  if (gameState.player.funds < amount) {
    throw new Error("余额不足以支付下注金额");
  }

  // 2. 获取游戏配置
  const config = economyConfig.gambling?.games?.[gameKey] || {
    label: "未知游戏",
    payout_multiplier: 2.0,
    primary_attribute: "dexterity",
    difficulty_class: 12,
  };

  const label = config.label || gameKey;
  const payoutMultiplier = config.payout_multiplier ?? 2.0;
  const dc = config.difficulty_class ?? 12;

  // 3. 扣除下注本金
  gameState.player.funds -= amount;

  // 4. 投掷 D20
  const roll = Math.floor(Math.random() * 20) + 1;

  // 5. 判定自然大成功/大失败
  if (roll === 1) {
    // 强制失败且被抓包
    gameState.player.flags.exposed = true;
    gameState.player.flags.wanted = true;
    return {
      success: false,
      roll,
      modifier: 0,
      total: 1,
      dc,
      payout: 0,
      critical: "fail",
      message: `在进行 [${label}] 时，你掷出了自然大失败 (Nat 1)！你出老千的手艺当场穿帮，引起了赌场打手的警觉，开始遭到通缉！`,
    };
  }

  if (roll === 20) {
    const doublePayout = Math.floor(amount * payoutMultiplier * 2);
    gameState.player.funds += doublePayout;
    return {
      success: true,
      roll,
      modifier: 0,
      total: 20,
      dc,
      payout: doublePayout,
      critical: "success",
      message: `你掷出了自然大成功 (Nat 20)！你以惊人的好运碾压全场，赢得双倍暴击奖金共计 ${doublePayout} 资金！`,
    };
  }

  // 6. 计算属性修正
  let modifier = 0;
  if (strategy === "cheat") {
    // 敏捷检定修正
    const dex = gameState.player.attributes.敏捷 ?? 10;
    modifier = Math.floor((dex - 10) / 2);
  } else if (strategy === "calc") {
    // 智力检定修正
    const int = gameState.player.attributes.智力 ?? 10;
    modifier = Math.floor((int - 10) / 2);
  }

  // 幸运星称号/特质修正
  if (gameState.player.titles?.includes("幸运星") || gameState.player.flags.lucky) {
    modifier += 2;
  }

  const total = roll + modifier;
  const success = total >= dc;

  let payout = 0;
  let message = "";

  if (success) {
    payout = Math.floor(amount * payoutMultiplier);
    gameState.player.funds += payout;
    message = `在 [${label}] 中，你掷出 ${roll} + 修正 ${modifier} = ${total} (DC ${dc})，判定成功！你赢得了 ${payout} 资金。`;
  } else {
    message = `在 [${label}] 中，你掷出 ${roll} + 修正 ${modifier} = ${total} (DC ${dc})，判定失败。你输掉了这笔下注。`;
  }

  return {
    success,
    roll,
    modifier,
    total,
    dc,
    payout,
    message,
  };
}

/**
 * 计算黑市物品的折价/溢价交易金额
 */
export function getBlackMarketPrice(
  action: "buy" | "sell",
  basePrice: number,
  reputation: number,  // 地下声望
  affection: number   // 对应黑市商人好感
): number {
  const pricing = economyConfig.black_market?.pricing || {
    base_markup: 1.5,
    base_discount: 0.4,
    item_price_cap: 5000,
  };

  const markup = pricing.base_markup ?? 1.5;
  const discount = pricing.base_discount ?? 0.4;
  const priceCap = pricing.item_price_cap ?? 5000;

  if (action === "buy") {
    const finalPrice = basePrice * markup * (1 - reputation / 20) * (1 - affection / 200);
    return Math.round(Math.min(finalPrice, priceCap));
  } else {
    const finalPrice = basePrice * discount * (1 + reputation / 40) * (1 + affection / 400);
    return Math.round(finalPrice);
  }
}
