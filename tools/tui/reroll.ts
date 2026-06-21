import { Type } from "typebox";
import { showPanel, generateCompletion, lastRenderParams, pi } from "../helpers.ts";

export default {
    description: "保持游戏状态不变，重新渲染最后一轮叙事",
    handler: async (_args, ctx) => {
      if (!lastRenderParams) {
        await showPanel(ctx, "🔄 重渲染", ["没有可重渲染的回合（尚未调用 render_scene）。"]);
        return;
      }

      try {
        const { gameState, getRecentTurnLogContext } = await import("../../engine/state.ts");
        const recentContext = getRecentTurnLogContext(3);
        const p = lastRenderParams;

        // 加载模型配置
        const fs = await import("node:fs");
        const path = await import("node:path");
        let modelMappings: Record<string, string> = {
          logic_engine_model: "model_pro_default",
          narrative_render_model: "model_flash_default"
        };
        try {
          const renderJsonPath = path.resolve(process.cwd(), "data", "rendering.json");
          if (fs.existsSync(renderJsonPath)) {
            const config = JSON.parse(fs.readFileSync(renderJsonPath, "utf-8"));
            if (config.model_mappings) {
              modelMappings = { ...modelMappings, ...config.model_mappings };
            }
          }
        } catch (_) {}

        const flagModel = pi.getFlag("render-model") as string | undefined;
        const narrativeModel = flagModel || modelMappings.narrative_render_model;

        const directorsNote = `
<directors_note>
  <engine_events>
    <event desc="${p.resolvedChanges}"/>
  </engine_events>
  <scene_directives>
    <atmosphere>常规（重渲染）</atmosphere>
    <action_outcome>${p.sceneResult}</action_outcome>
  </scene_directives>
  ${p.npcResponses ? `<subtext>${p.npcResponses}</subtext>` : ""}
</directors_note>
`;

        const renderPrompt = [
          "你是一位顶级文学主笔。请根据【导演单】重写一段不同表达方式的叙事正文。",
          "",
          `当前环境: ${gameState.player.location} | 天气: ${gameState.weather.type} ${gameState.weather.temp}°C`,
          "",
          "【导演单内容】:",
          directorsNote,
          "",
          recentContext ? `前情摘要: ${recentContext}\n` : "",
          "规则：≤2段叙事+≤5句对白。融入身体触觉。对话用「」或『』。结尾输出4个扮演选项（---分割线+> blockquote+[风格]+圈号）。",
          "注意：本次是重渲染，请采用不同的句式、不同的描写角度、不同的环境切入点。",
          "",
          "现在输出纯叙事正文："
        ].join("\n");

        let prose = await generateCompletion(renderPrompt, 4096, ctx, narrativeModel);
        if (!prose) {
          await showPanel(ctx, "🔄 重渲染", ["重渲染失败：模型返回为空。"]);
          return;
        }
        // 过 lint
        const { lintProse: rerollLint } = await import("../../engine/audit/lint-rules.ts");
        const lintRes = rerollLint(prose, gameState);
        if (lintRes.findings.length > 0) {
          prose = lintRes.prose;
        }
        await showPanel(ctx, "🔄 重渲染", prose.split("\n"));
      } catch (e) {
        await showPanel(ctx, "🔄 重渲染", [`重渲染失败：${e instanceof Error ? e.message : e}`]);
      }
    },
  };
