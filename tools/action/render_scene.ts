import { Type } from "typebox";
import { generateCompletion, setLastRenderParams, setLastRenderedProse, pi } from "../helpers.ts";

export default {
    name: "render_scene", label: "渲染场景",
    description: "结算后渲染叙事正文。调用后禁调其他工具。",
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

      const { gameState, getRecentTurnLogContext, saveState } = await import("../../engine/state.ts");
      const fs = await import("node:fs");
      const path = await import("node:path");

      // 立即读取、校验并清除 _pending_viewpoint_text
      let localViewpointText = "";
      if (gameState._pending_viewpoint_text) {
        if (gameState._pending_viewpoint_text.turn === gameState.turn) {
          localViewpointText = gameState._pending_viewpoint_text.text;
        }
        delete gameState._pending_viewpoint_text;
        saveState();
      }

      // 获取并清理 viewpoint 异步 Promise
      const { getPendingViewpointPromise, clearPendingViewpointPromise } = await import("../../engine/viewpoint.ts");
      const promise = getPendingViewpointPromise();
      if (promise) {
        try {
          const vpText = await promise;
          if (vpText) {
            localViewpointText = (localViewpointText ? localViewpointText + "\n" : "") + vpText;
          }
        } catch (err) {
          console.error("render_scene: error awaiting viewpoint promise:", err);
        } finally {
          clearPendingViewpointPromise();
        }
      }

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
      } catch (e) { console.error("render_scene: rendering.json model mappings error", e); }

      // 获取 flag 覆盖
      const flagModel = pi.getFlag("render-model") as string | undefined;
      const narrativeModel = flagModel || modelMappings.narrative_render_model;
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
        "规则：融入身体触觉（支撑点）。如果本轮包含身体动作，用 1-2 句写清楚力的方向、重心转移、身体接触点的具体感觉。微观空间定位准确。对话用「」或『』。绝对不分析心理。不替玩家说话。人称、字数及格式结尾请完全遵守系统提示词末尾的Voice和Mode层规则。",
        "",
        "现在输出纯叙事正文：",
      ].join("\n");

      try {
        const interactionMode = gameState.interactionMode || "turn_based";
        const wordBudget = interactionMode === "novel" ? "400-800" : "200-400";
        const directorsNote = `
<directors_note>
  <engine_events>
    <event desc="${params.resolvedChanges}"/>
  </engine_events>
  <scene_directives>
    <atmosphere>常规</atmosphere>
    <npc_emotion>${params.npcResponses ? "有回应" : "常规"}</npc_emotion>
    <action_outcome>${params.sceneResult}</action_outcome>
    <interaction_mode>${interactionMode}</interaction_mode>
    <word_budget>${wordBudget}</word_budget>
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
          "规则：融入身体触觉（支撑点）。如果本轮包含身体动作，用 1-2 句写清楚力的方向、重心转移、身体接触点的具体感觉。微观空间定位准确。对话用「」或『』。绝对不分析心理。不替玩家说话。人称、字数及格式结尾请完全遵守系统提示词末尾的Voice和Mode层规则。",
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
        let allFindings: any[] = [];
        let retryExhausted = false;

        while (true) {
          const lintResult = lintProse(prose, gameState);
          if (lintResult.findings.length > 0) {
            allFindings.push(...lintResult.findings);
          }

          if (!lintResult.needsRetry) {
            prose = lintResult.prose;
            break;
          }

          if (retries >= maxRetries) {
            console.error(`[lint] render_scene: retries exhausted (${maxRetries} times)`);
            retryExhausted = true;
            prose = lintResult.prose;
            break;
          }

          // Build retry prompt
          const violations = lintResult.findings.map(f => `[${f.severity.toUpperCase()}] 规则: ${f.ruleId} | 原因: ${f.message}`).join("\n");
          const retryPrompt = [
            renderPrompt,
            "",
            "---",
            "",
            "【上一轮输出未通过安全及格式审计，被拦截并要求重写。以下为违规列表】:",
            violations,
            "",
            "重写要求：保持原意和场景不变，融入身体触觉，对话用「」或『』，人称、字数与格式结尾必须严格遵守Voice和Mode层规则。",
            "现在重新输出完整叙事正文：",
          ].join("\n");
          retries++;
          console.warn(`[lint] render_scene: retry ${retries}/${maxRetries}`);
          prose = await generateCompletion(retryPrompt, 4096, _ctx, narrativeModel);
          if (!prose) break;
        }

        // Lint 自补丁：记录 block 失败，追踪 NPC→规则关联
        const { recordLintFailure, extractNpcNamesFromFindings, clearLintFailures } = await import("../../engine/audit/lint-rules.ts");
        const blockFindings = allFindings.filter((f: any) => f.severity === "block");
        if (blockFindings.length > 0) {
          const npcNames = extractNpcNamesFromFindings(blockFindings, gameState);
          if (npcNames.length > 0) {
            for (const name of npcNames) {
              for (const f of blockFindings) {
                recordLintFailure(name, f.ruleId);
              }
            }
          }
        } else {
          for (const npcName of Object.keys(gameState.npcs)) {
            clearLintFailures(npcName);
          }
        }

        if (localViewpointText) {
          prose = prose.trim() + "\n" + localViewpointText.trim();
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
          if (localViewpointText) {
            prose = prose.trim() + "\n" + localViewpointText.trim();
          }
          setLastRenderedProse(prose);
          return { content: [{ type: "text", text: prose }], details: { lintFindings: lintResult?.findings ?? [] } };
        } catch (fallbackError) {
          return { content: [{ type: "text", text: fallbackPrompt + `\n(渲染模型调用失败: ${fallbackError instanceof Error ? fallbackError.message : fallbackError}，请GM自行输出叙事)` }], details: {} };
        }
      }
    },
  };
