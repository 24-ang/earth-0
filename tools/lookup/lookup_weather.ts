import { Type } from "typebox";

export default {
    name: "lookup_weather",
    label: "查询天气",
    description: "查当前或预报天气。day: today|tomorrow|+N。无限制条件。",
    parameters: Type.Object({
      day: Type.String({ description: "today|tomorrow|+N" })
    }),
    async execute(_id, params, _s, _o, _ctx) {
      const { gameState } = await import("../../engine/state.ts");
      const { getSeason, mapChineseWeather, mapWeatherToChinese, WEATHER_MATRICES } = await import("../../engine/weather.ts");
      if (params.day === "today" || params.day === "0") {
        return { content: [{ type: "text", text: `今日天气：${gameState.weather.type}，气温 ${gameState.weather.temp}°C。` }], details: { weather: gameState.weather } };
      }
      
      const season = getSeason(gameState.time.game_date);
      const curW = mapChineseWeather(gameState.weather.type);
      const matrix = WEATHER_MATRICES[season] || WEATHER_MATRICES.spring;
      const probabilities = matrix[curW] || matrix.sunny;
      
      const probStr = Object.entries(probabilities)
        .filter(([_, p]) => p > 0)
        .map(([w, p]) => `${mapWeatherToChinese(w as any, season)} (${(p*100).toFixed(0)}%)`)
        .join("、");
        
      return { content: [{ type: "text", text: `明日天气预测（基于当前季节 [${season}]）：${probStr}。` }], details: { probabilities } };
    }
  };
