/**
 * 季节事件与节日/天气系统
 */

import type { GameState } from "./types.ts";

export const WEATHER_TYPES = ["sunny", "cloudy", "rainy", "storm"] as const;
export type WeatherType = typeof WEATHER_TYPES[number];

// 4x4 Markov 转移概率矩阵定义
export const WEATHER_MATRICES: Record<string, Record<WeatherType, Record<WeatherType, number>>> = {
  spring: {
    sunny:  { sunny: 0.50, cloudy: 0.30, rainy: 0.20, storm: 0.00 },
    cloudy: { sunny: 0.30, cloudy: 0.40, rainy: 0.30, storm: 0.00 },
    rainy:  { sunny: 0.20, cloudy: 0.30, rainy: 0.50, storm: 0.00 },
    storm:  { sunny: 0.25, cloudy: 0.25, rainy: 0.50, storm: 0.00 }
  },
  summer: {
    sunny:  { sunny: 0.60, cloudy: 0.30, rainy: 0.08, storm: 0.02 },
    cloudy: { sunny: 0.40, cloudy: 0.40, rainy: 0.15, storm: 0.05 },
    rainy:  { sunny: 0.20, cloudy: 0.30, rainy: 0.40, storm: 0.10 },
    storm:  { sunny: 0.30, cloudy: 0.20, rainy: 0.30, storm: 0.20 }
  },
  autumn: {
    sunny:  { sunny: 0.50, cloudy: 0.30, rainy: 0.15, storm: 0.05 },
    cloudy: { sunny: 0.35, cloudy: 0.40, rainy: 0.20, storm: 0.05 },
    rainy:  { sunny: 0.25, cloudy: 0.30, rainy: 0.35, storm: 0.10 },
    storm:  { sunny: 0.30, cloudy: 0.25, rainy: 0.30, storm: 0.15 }
  },
  winter: {
    sunny:  { sunny: 0.40, cloudy: 0.30, rainy: 0.10, storm: 0.20 }, // 此时 storm 代表下雪
    cloudy: { sunny: 0.30, cloudy: 0.35, rainy: 0.15, storm: 0.20 },
    rainy:  { sunny: 0.20, cloudy: 0.30, rainy: 0.30, storm: 0.20 },
    storm:  { sunny: 0.25, cloudy: 0.25, rainy: 0.20, storm: 0.30 }
  }
};

/**
 * 根据日期判断当前季节
 */
export function getSeason(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length < 2) return "spring";
  const month = parseInt(parts[1], 10);
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/**
 * 映射天气中文描述到天气标识
 */
export function mapChineseWeather(cn: string): WeatherType {
  if (cn.includes("雨")) return "rainy";
  if (cn.includes("阴") || cn.includes("云")) return "cloudy";
  if (cn.includes("雪") || cn.includes("暴")) return "storm";
  return "sunny";
}

/**
 * 映射天气标识到中文描述
 */
export function mapWeatherToChinese(w: WeatherType, season: string): string {
  const map: Record<WeatherType, string> = {
    sunny: "晴",
    cloudy: "多云",
    rainy: "小雨",
    storm: season === "winter" ? "大雪" : "暴雨"
  };
  return map[w];
}

/**
 * 执行天气马尔可夫转移
 */
export function transitionWeather(gameState: GameState): void {
  const season = getSeason(gameState.time.game_date);
  const curWeatherCN = gameState.weather?.type || "晴";
  const curWeather = mapChineseWeather(curWeatherCN);

  const matrix = WEATHER_MATRICES[season] || WEATHER_MATRICES.spring;
  const probabilities = matrix[curWeather] || matrix.sunny;

  // 轮盘赌选择今日天气
  const rand = Math.random();
  let cumulative = 0;
  let selected: WeatherType = "sunny";

  for (const w of WEATHER_TYPES) {
    cumulative += probabilities[w] ?? 0;
    if (rand <= cumulative) {
      selected = w;
      break;
    }
  }

  // 气温基础值
  let baseTemp = 15;
  if (season === "spring") baseTemp = 15;
  else if (season === "summer") baseTemp = 30;
  else if (season === "autumn") baseTemp = 15;
  else if (season === "winter") baseTemp = 2;

  // 天气温差修正
  let weatherDelta = 0;
  if (selected === "sunny") {
    weatherDelta = season === "winter" ? 2 : 4;
  } else if (selected === "rainy" || selected === "storm") {
    weatherDelta = -3;
  }

  // 随机浮动
  const fluctuation = Math.floor(Math.random() * 7) - 3; // -3 到 +3
  const finalTemp = baseTemp + weatherDelta + fluctuation;

  gameState.weather = {
    type: mapWeatherToChinese(selected, season),
    temp: finalTemp
  };
}

/**
 * 计算疲劳修正系数 K_fatigue
 */
export function getFatigueMultiplier(temp: number): number {
  if (temp >= 10 && temp <= 28) {
    return 1.0;
  }
  if (temp > 28) {
    return Math.min(1.4, 1.0 + (temp - 28) / 30);
  }
  // temp < 10
  return Math.min(1.3, 1.0 + (8 - temp) / 40);
}
