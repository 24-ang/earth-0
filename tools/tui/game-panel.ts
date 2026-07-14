/**
 * game-panel.ts — earth-0 游戏面板 Component
 *
 * 构建 pi-tui Container 组件，被 ctx.ui.setGamePanel() 调用。
 * 输入路由通过 ctx.ui.onTerminalInput() 在 extension.ts 处理。
 *
 * 导航模型：
 *   Tab 1 (周边):
 *     activeNpc=null    → cursor = NPC 列表索引 (0..N-1)
 *     activeNpc=set     → cursor = 操作按钮索引 (0..8)
 *     submenu=talk/touch → cursor = 子菜单选项索引 (0..3/0..4)
 *   Tab 3 (行动):
 *     cursor = 扮演选项索引 (0..N-1)
 *   Tab 0 (自身):
 *     cursor = 装备槽索引 (0..N-1)
 */

import { Container, Text } from "@earendil-works/pi-tui";
import { renderPanel, renderTalkSubmenu, renderTouchSubmenu, renderObserveSubmenu, TAB_NAMES } from "./panel-render";

// ── 面板状态（模块级） ──
export const panelState = {
  tab: 1 as number,
  cursor: 0 as number,
  activeNpc: null as string | null,
  activeItem: null as string | null,
  submenu: null as "talk" | "touch" | "observe" | null,
  combat: false,
  feedback: "" as string,
  modeHint: "标签页导航 (M切换/打字自由)" as string,
};

// ── 操作按钮定义 ──
const NPC_ACTIONS = [
  { key: "talk", label: "搭话" },
  { key: "touch", label: "接触" },
  { key: "observe", label: "观察" },
  { key: "party", label: "组队" },
  { key: "romance", label: "恋爱" },
  { key: "fight", label: "战斗" },
  { key: "steal", label: "窃取" },
  { key: "suggest", label: "暗示" },
  { key: "intimate", label: "亲密" },
];

/** 更新状态并重建面板 */
export function refreshPanel(ctx: any) {
  try {
    if (typeof ctx?.ui?.setGamePanel !== "function") {
      if (!(refreshPanel as any)._warned) {
        console.error("[game-panel] ctx.ui.setGamePanel 不可用 — 请用 .\\start.ps1 启动 fork 版 pi");
        (refreshPanel as any)._warned = true;
      }
      return;
    }
    const { gameState } = require("../../engine/state.ts");
    const isCombat = gameState.mode === "combat" ||
      (gameState.player?.hp?.current ?? 10) < (gameState.player?.hp?.max ?? 15) * 0.3;

    // Clamp cursor
    const max = getMaxCursor(gameState);
    if (panelState.cursor > max) panelState.cursor = max;

    let lines: string[];

    if (panelState.submenu === "talk" && panelState.activeNpc) {
      lines = renderTalkSubmenu(gameState, panelState.activeNpc, panelState.cursor, panelState.feedback);
    } else if (panelState.submenu === "touch" && panelState.activeNpc) {
      lines = renderTouchSubmenu(gameState, panelState.activeNpc, panelState.cursor, panelState.feedback);
    } else if (panelState.submenu === "observe" && panelState.activeNpc) {
      lines = renderObserveSubmenu(gameState, panelState.activeNpc, panelState.feedback);
    } else {
      lines = renderPanel(gameState, {
        tab: panelState.tab,
        cursor: panelState.cursor,
        activeNpc: panelState.activeNpc,
        activeItem: panelState.activeItem,
        submenu: null, // normal tab mode
        combat: isCombat,
        feedback: panelState.feedback,
        modeHint: panelState.modeHint,
      });
    }

    ctx.ui.setGamePanel((_tui: any, _theme: any) => buildComponent(lines));
  } catch (e) {
    console.error("refreshPanel:", e);
  }
}

function buildComponent(lines: string[]): any {
  const container = new Container();
  for (const line of lines) container.addChild(new Text(line, 0, 0));
  return container;
}

/** 计算光标最大值 */
function getMaxCursor(gs: any): number {
  // Submenu mode
  if (panelState.submenu === "talk") return 3;
  if (panelState.submenu === "touch") return 4;
  if (panelState.submenu === "observe") return 0; // read-only, no cursor

  // NPC action buttons mode
  if (panelState.activeNpc && panelState.tab === 1) {
    const rel = gs.player?.relationships?.[panelState.activeNpc];
    const isLover = rel?.stage === "恋人" || rel?.stage === "亲密";
    return isLover ? 8 : 7;
  }

  // Normal tab mode
  if (panelState.tab === 1) {
    // NPC list
    const p = gs.player;
    const loc = p?.location;
    let count = 0;
    if (gs.npcs && loc) {
      try {
        const { isSameLocation } = require("../../engine/state.ts");
        for (const [_name, npc] of Object.entries(gs.npcs) as [string, any][]) {
          if (npc.alive !== false && isSameLocation(npc.currentRoom, loc)) count++;
        }
      } catch {}
    }
    return Math.max(0, count - 1);
  }
  if (panelState.tab === 3) {
    // Choices
    try {
      const { lastRenderedProse } = require("../../tools/helpers.ts");
      const { parseRoleOptions } = require("../../engine/parse-options.ts");
      if (lastRenderedProse) {
        const result = parseRoleOptions(lastRenderedProse);
        const choices = result.options || [];
        return Math.max(0, Math.min(choices.length, 5) - 1);
      }
    } catch {}
    return 0;
  }
  if (panelState.tab === 0) {
    // Equipment: 6 slots + HP line(0) + attrs line(1) = cursor 0-7
    return 7;
  }
  if (panelState.tab === 2) {
    // Room: dimension + furniture + exits
    return 5;
  }
  return 0;
}

/**
 * 处理面板键盘输入。返回 true=面板消费，false=穿透给 editor。
 */
export function handlePanelInput(data: string, ctx: any): boolean {
  // Left/Right — 切 Tab
  if (data === "\x1b[D") {
    panelState.tab = (panelState.tab + 3) % 4;
    panelState.cursor = 0;
    panelState.submenu = null;
    panelState.activeNpc = null;
    panelState.feedback = `切换到 ${TAB_NAMES[panelState.tab]} 面板`;
    refreshPanel(ctx);
    return true;
  }
  if (data === "\x1b[C") {
    panelState.tab = (panelState.tab + 1) % 4;
    panelState.cursor = 0;
    panelState.submenu = null;
    panelState.activeNpc = null;
    panelState.feedback = `切换到 ${TAB_NAMES[panelState.tab]} 面板`;
    refreshPanel(ctx);
    return true;
  }

  // Up/Down — 移动光标
  if (data === "\x1b[A") {
    panelState.cursor = Math.max(0, panelState.cursor - 1);
    panelState.feedback = "↑";
    refreshPanel(ctx);
    return true;
  }
  if (data === "\x1b[B") {
    panelState.cursor += 1;
    // getMaxCursor clamps in refreshPanel
    panelState.feedback = "↓";
    refreshPanel(ctx);
    return true;
  }

  // Enter
  if (data === "\r" || data === "\n") {
    return handleEnter(ctx);
  }

  // Esc
  if (data === "\x1b") {
    if (panelState.submenu) {
      // Submenu → back to NPC actions
      panelState.submenu = null;
      panelState.cursor = 0;
      panelState.feedback = `返回 ${panelState.activeNpc} 操作`;
      refreshPanel(ctx);
      return true;
    }
    if (panelState.activeNpc) {
      // NPC actions → deselect
      panelState.activeNpc = null;
      panelState.cursor = 0;
      panelState.feedback = "";
      refreshPanel(ctx);
      return true;
    }
    // Nothing to dismiss, let it pass through
    panelState.feedback = "";
    refreshPanel(ctx);
    return false;
  }

  // 数字直选
  if (data >= "1" && data <= "9") {
    panelState.cursor = parseInt(data) - 1;
    panelState.feedback = `直选 ${data}`;
    refreshPanel(ctx);
    return handleEnter(ctx);
  }

  // 其他 → editor
  return false;
}

/** Enter 处理：基于上下文的执行逻辑 */
function handleEnter(ctx: any): boolean {
  try {
    const { gameState } = require("../../engine/state.ts");

    // ── 子菜单执行 ──
    if (panelState.submenu === "talk" && panelState.activeNpc) {
      const opts = ["日常", "自己", "对方", "八卦"];
      const choice = opts[panelState.cursor] || opts[0]!;
      const npc = panelState.activeNpc;
      panelState.submenu = null;
      panelState.activeNpc = null;
      panelState.cursor = 0;
      panelState.feedback = `搭话 ${npc} — 聊聊${choice}`;
      refreshPanel(ctx);
      triggerAction(ctx, `我找 ${npc} 搭话，聊聊${choice}。`);
      return true;
    }

    if (panelState.submenu === "touch" && panelState.activeNpc) {
      const opts = ["握手", "摸头", "拥抱", "按摩", "亲吻"];
      const choice = opts[panelState.cursor] || opts[0]!;
      const npc = panelState.activeNpc;
      panelState.submenu = null;
      panelState.activeNpc = null;
      panelState.cursor = 0;
      panelState.feedback = `接触 ${npc} — ${choice}`;
      refreshPanel(ctx);
      triggerAction(ctx, `我尝试与 ${npc} 进行肢体接触：${choice}。`);
      return true;
    }

    if (panelState.submenu === "observe" && panelState.activeNpc) {
      // Observe is read-only — just close
      const npc = panelState.activeNpc;
      panelState.submenu = null;
      panelState.activeNpc = null;
      panelState.cursor = 0;
      panelState.feedback = `观察完毕 — ${npc}`;
      refreshPanel(ctx);
      return true;
    }

    // ── Tab 1: NPC 选择 / 操作按钮执行 ──
    if (panelState.tab === 1) {
      if (!panelState.activeNpc) {
        // 选中 NPC
        const p = gameState.player;
        const loc = p?.location;
        const nearby = getNearbyNPCs(gameState, loc);
        if (panelState.cursor >= 0 && panelState.cursor < nearby.length) {
          panelState.activeNpc = nearby[panelState.cursor]!;
          panelState.cursor = 0;
          panelState.feedback = `选中 ${panelState.activeNpc} · ↑↓选操作 Enter执行`;
          refreshPanel(ctx);
          return true;
        }
      } else {
        // 执行操作按钮
        const act = NPC_ACTIONS[panelState.cursor];
        if (!act) return true;

        if (act.key === "talk") {
          panelState.submenu = "talk";
          panelState.cursor = 0;
          panelState.feedback = `搭话 ${panelState.activeNpc} — 选择聊天风格`;
          refreshPanel(ctx);
          return true;
        }
        if (act.key === "touch") {
          panelState.submenu = "touch";
          panelState.cursor = 0;
          panelState.feedback = `接触 ${panelState.activeNpc} — 选择接触方式`;
          refreshPanel(ctx);
          return true;
        }
        if (act.key === "observe") {
          panelState.submenu = "observe";
          panelState.cursor = 0;
          panelState.feedback = `观察 ${panelState.activeNpc}`;
          refreshPanel(ctx);
          return true;
        }

        // 其他操作直接执行
        const messages: Record<string, string> = {
          party: `我邀请 ${panelState.activeNpc} 加入队伍。`,
          romance: `我想与 ${panelState.activeNpc} 进一步发展关系。`,
          fight: `我向 ${panelState.activeNpc} 发起战斗。`,
          steal: `我尝试从 ${panelState.activeNpc} 身上偷东西。`,
          suggest: `我对 ${panelState.activeNpc} 使用心理暗示。`,
          intimate: `我与 ${panelState.activeNpc} 亲密接触。`,
        };
        const msg = messages[act.key] || `${act.label} ${panelState.activeNpc}`;
        const npc = panelState.activeNpc;
        panelState.activeNpc = null;
        panelState.cursor = 0;
        panelState.feedback = `执行: ${act.label} — ${npc}`;
        refreshPanel(ctx);
        triggerAction(ctx, msg);
        return true;
      }
    }

    // ── Tab 3: 扮演选项执行 ──
    if (panelState.tab === 3) {
      try {
        const { lastRenderedProse } = require("../../tools/helpers.ts");
        const { parseRoleOptions } = require("../../engine/parse-options.ts");
        if (lastRenderedProse) {
          const result = parseRoleOptions(lastRenderedProse);
          const choices = result.options || [];
          if (panelState.cursor >= 0 && panelState.cursor < choices.length) {
            const choice = choices[panelState.cursor];
            const label = choice.text || "";
            panelState.feedback = `主线决策: ${label}`;
            refreshPanel(ctx);
            triggerAction(ctx, `玩家选择了: ${label}`);
            return true;
          }
        }
      } catch {}
      panelState.feedback = "没有可执行选项";
      refreshPanel(ctx);
      return true;
    }

    // Tab 0/2 — Enter 不触发引擎
    panelState.feedback = `第${panelState.cursor + 1}项 · 输入自然语言操作`;
    refreshPanel(ctx);
    return true;
  } catch (e) {
    console.error("handleEnter:", e);
    return true;
  }
}

// ── 辅助 ──

function getNearbyNPCs(gs: any, loc: string): string[] {
  const names: string[] = [];
  try {
    const { isSameLocation } = require("../../engine/state.ts");
    for (const [name, npc] of Object.entries(gs.npcs || {}) as [string, any][]) {
      if (npc.alive === false) continue;
      if (isSameLocation(npc.currentRoom, loc)) names.push(name);
    }
  } catch {}
  return names;
}

async function triggerAction(ctx: any, message: string) {
  try {
    const { gameState, saveState } = require("../../engine/state.ts");
    gameState._lastUserInput = message;
    saveState();
    if (ctx.chat) ctx.chat.addSystemMessage(message);
    const pi = (globalThis as any).__pi;
    if (pi?.sendMessage) {
      await pi.sendMessage(ctx, message);
    } else if (ctx.sendMessage) {
      await ctx.sendMessage(message);
    }
  } catch (e) {
    console.error("triggerAction:", e);
  }
}
