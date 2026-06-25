import { Type } from "typebox";
import { generateCompletion, setLastRenderParams, setLastRenderedProse, pi } from "../helpers.ts";

export default {
    name: "render_scene", label: "渲染场景",
    description: "结算轮完成后调用。引擎拼接导演单，调用叙事模型产出纯叙事正文（可通过rendering.json配置不同于主GM的模型）。调用后禁止再调工具。",
    parameters: Type.Object({
      playerAction: Type.String({ description: "玩家实际做了什么" }),
      resolvedChanges: Type.String({ description: "本轮工具落地的变化，无则写'无'" }),
      sceneResult: Type.String({ description: "场景结果，一句话" }),
      openHooks: Type.String({ description: "未收口的钩子，无则写'无'" }),
      nextPressure: Type.String({ description: "下轮推动方向，无则写'无'" }),
      npcResponses: Type.Optional(Type.String({ description: "NPC Agent 的回应（spawn_npc_agents 的返回值）。渲染轮将其织入叙事，让每个NPC用自己的话说话。" })),
    }),
    async execute(_id, params, _s, _o, _ctx) {
      // 缓存参数供 /reroll 使用
      setLastRenderParams({
        playerAction: params.playerAction,
        resolvedChanges: params.resolvedChanges,
        sceneResult: params.sceneResult,
        openHooks: params.openHooks || "无",
        nextPressure: params.nextPressure || "无",
        npcResponses: params.npcResponses,
      });

      const { gameState, getRecentTurnLogContext } = await import("../../engine/state.ts");
      const fs = await import("node:fs");
      const path = await import("node:path");

      const recentContext = getRecentTurnLogContext(3);

      // 1. 加载模型配置
      let modelMappings: Record<string, string> = {
        logic_engine_model: "deepseek/deepseek-v4-pro",
        narrative_render_model: "deepseek/deepseek-v4-pro"
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

      // 获取 flag 覆盖
      const flagModel = pi.getFlag("render-model") as string | undefined;
      const narrativeModel = flagModel || modelMappings.narrative_render_model;
      // logicModel 预留用于未来可能的多模型分离——当前未使用
      const _logicModel = modelMappings.logic_engine_model;

      // 传统单步回退 Prompt（以备不时之需）
      const fallbackPrompt = [
        "你是 earth-0 的渲染 GM。结算已完成。",
        "",
        "导演单：",
        `玩家行动: ${params.playerAction}`,
        `状态变化: ${params.resolvedChanges}`,
        `场景结果: ${params.sceneResult}`,
        `开放钩子: ${params.openHooks || "无"}`,
        `推动方向: ${params.nextPressure || "无"}`,
        "",
        params.npcResponses ? `NPC 独立回应：\n${params.npcResponses}\n` : "",
        recentContext ? `前情摘要: ${recentContext}\n` : "",
        "规则：≤2段叙事+≤5句对白。融入身体触觉（支撑点）。微观空间定位准确。对话用「」或『』。结尾输出4个扮演选项（按gm-contract格式: ---分割线+> blockquote+[风格]+圈号）。绝对不分析心理。不替玩家说话。",
        "",
        "现在输出纯叙事正文：",
      ].join("\n");

      try {
        // 纯代码拼接 <directors_note>（零 Token 成本）。多模型分离基建已预留（rendering.json + _logicModel），当前未使用。
        const directorsNote = `
<directors_note>
  <engine_events>
    <event desc="${params.resolvedChanges}"/>
  </engine_events>
  <scene_directives>
    <atmosphere>常规</atmosphere>
    <npc_emotion>${params.npcResponses ? "有回应" : "常规"}</npc_emotion>
    <action_outcome>${params.sceneResult}</action_outcome>
  </scene_directives>
  ${params.npcResponses ? `<subtext>${params.npcResponses}</subtext>` : ""}
</directors_note>
`;

        // 第二阶段：文学渲染模型润色并产生最终正文
        const renderPrompt = [
          "你是一位顶级文学主笔。你的任务是根据提供的【导演单】，将物理结算事件转化为高文学素养的文字 RPG 叙事正文。",
          "",
          `当前环境: ${gameState.player.location} | 天气: ${gameState.weather.type} ${gameState.weather.temp}°C`,
          "",
          "【导演单内容】:",
          directorsNote,
          "",
          recentContext ? `前情摘要: ${recentContext}\n` : "",
          "规则：≤2段叙事+≤5句对白。融入身体触觉（支撑点）。微观空间定位准确。对话用「」或『』。结尾输出4个扮演选项（按gm-contract格式: ---分割线+> blockquote+[风格]+圈号）。绝对不分析心理。不替玩家说话。",
          "",
          "现在输出纯叙事正文："
        ].join("\n");

        let prose = await generateCompletion(renderPrompt, 4096, _ctx, narrativeModel);
        if (!prose) {
          throw new Error("Render model returned empty prose.");
        }

        // 渲染后 Lint 扫描 → block 命中自动 retry（最多 3 次）
        const { lintProse } = await import("../../engine/audit/lint-rules.ts");
        let retries = 0;
        const maxRetries = 3;
        let retryExhausted = false;
        let allFindings: any[] = [];

        while (retries <= maxRetries) {
          const lintResult = lintProse(prose, gameState);
          allFindings = lintResult.findings;
          const blocks = lintResult.findings.filter(f => f.severity === "block");
          const warns = lintResult.findings.filter(f => f.severity === "warn");

          if (blocks.length > 0) {
            console.error(`[lint] render_scene: ${blocks.length} block(s) — ${blocks.map(b => b.ruleId).join(", ")}`);
          }
          if (warns.length > 0) {
            console.warn(`[lint] render_scene: ${warns.length} warn(s) — ${warns.map(w => w.ruleId).join(", ")}`);
          }
          prose = lintResult.prose;

          if (!lintResult.needsRetry) break;
          if (retries >= maxRetries) {
            retryExhausted = true;
            console.warn(`[lint] render_scene: retry exhausted after ${maxRetries} attempts`);
            break;
          }

          // 构建纠正 prompt：把违规片段 + 规则喂给模型
          const blockFindings = allFindings.filter(f => f.severity === "block");
          const violations = blockFindings.map(f => `• [${f.ruleId}] 违规片段: "${f.excerpt}"`).join("\n");
          const retryPrompt = [
            "你的上一版正文触发了以下质量规则，请避免这些问题后重写全文：",
            violations,
            "",
            "重写要求：保持原意和场景不变，≤2段叙事+≤5句对白，融入身体触觉，对话用「」或『』，结尾输出4个扮演选项。",
            "现在重新输出完整叙事正文：",
          ].join("\n");
          retries++;
          console.warn(`[lint] render_scene: retry ${retries}/${maxRetries}`);
          prose = await generateCompletion(retryPrompt, 4096, _ctx, narrativeModel);
          if (!prose) break; // 模型返回空就不重试了
        }

        setLastRenderedProse(prose);
        return { content: [{ type: "text", text: prose }], details: { directorsNote, lintFindings: allFindings, retries, retryExhausted } };

      } catch (e) {
        console.warn("Two-stage rendering pipeline failed, falling back to single-stage rendering:", e);
        try {
          let prose = await generateCompletion(fallbackPrompt, 4096, _ctx, flagModel);
          if (!prose) {
            return { content: [{ type: "text", text: fallbackPrompt + "\n(渲染模型返回为空，请GM自行输出叙事)" }], details: {} };
          }
          // fallback 路径也过 lint
          const { lintProse } = await import("../../engine/audit/lint-rules.ts");
          const lintResult = lintProse(prose, gameState);
          if (lintResult.findings.length > 0) {
            prose = lintResult.prose;
          }
          setLastRenderedProse(prose);
          return { content: [{ type: "text", text: prose }], details: { lintFindings: lintResult?.findings ?? [] } };
        } catch (fallbackError) {
          return { content: [{ type: "text", text: fallbackPrompt + `\n(渲染模型调用失败: ${fallbackError instanceof Error ? fallbackError.message : fallbackError}，请GM自行输出叙事)` }], details: {} };
        }
      }
    },
  };
