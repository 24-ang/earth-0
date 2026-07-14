/**
 * web-hud.ts — Web HUD HTTP 服务器
 * 为浏览器提供 /api/state + /api/action，驱动 tui-v5.html。
 *
 * 关键修复：引擎引用在初始化时缓存，不在请求路径中做动态 import（避 CJS 双实例）。
 * Prose 由 extension.ts 通过 setLatestProse() 直接推送。
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

// ── 运行时引用 ──
let _pi: any = null;
let _ctx: any = null;

// ── 引擎引用缓存 ──
let _gameState: any = null;
let _isSameLocation: any = null;
let _getRoom: any = null;
let _getNamelessNPCs: any = null;
let _parseRoleOptions: any = null;

// ── Prose 缓存（extension.ts 渲染完直接推送） ──
let _latestProse = "";
export function setLatestProse(text: string) { _latestProse = text; }

// ── 面板状态 ──
export const tuiState = {
  tab: 1 as number,
  cursor: 0 as number,
  activeNpc: null as string | null,
  activeItem: null as string | null,
  activeItemType: null as string | null,
  activeSubmenu: null as string | null,
};

let _server: http.Server | null = null;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function startWebHud(pi: any, ctx: any, port: number = 3000) {
  if (_server) return;
  _pi = pi;
  _ctx = ctx;

  const htmlPath = path.resolve(process.cwd(), "tmp", "tui-v5.html");

  _server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const url = new URL(req.url || "/", `http://localhost:${port}`);

      if (req.method === "GET" && url.pathname === "/") {
        if (!fs.existsSync(htmlPath)) { res.writeHead(404); res.end("tui-v5.html not found"); return; }
        const html = fs.readFileSync(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        const data = await buildStateResponse();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/action") {
        const body = await readBody(req);
        let parsed: any;
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
        const text = (parsed.text || "").trim();
        if (text) {
          await triggerTurn(text);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, text }));
        } else {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: "text required" }));
        }
        return;
      }

      res.writeHead(404); res.end("Not Found");
    } catch (e: any) {
      console.error("web-hud:", e.message || e);
      res.writeHead(500); res.end("Internal Error");
    }
  });

  _server.listen(port, () => {
    console.log(`[web-hud] http://localhost:${port}`);
  });
}

/** 初始化引擎引用（由 extension.ts 在 session_start 后调用一次） */
export function initEngineRefs() {
  Promise.all([
    import("../../engine/state.ts"),
    import("../helpers.ts"),
    import("../../engine/parse-options.ts"),
  ]).then(([stateMod, _helpersMod, parseMod]) => {
    _gameState = stateMod.gameState;
    _isSameLocation = stateMod.isSameLocation;
    _getRoom = stateMod.getRoom;
    _getNamelessNPCs = stateMod.getNamelessNPCs as any;
    _parseRoleOptions = parseMod.parseRoleOptions;
    console.log("[web-hud] engine refs cached");
  }).catch((e) => console.error("[web-hud] engine ref init failed:", e));
}

// ── /api/state ──

async function buildStateResponse(): Promise<any> {
  // 二次确认：如果缓存未初始化，做一次懒加载
  if (!_gameState) {
    try {
      const m = await import("../../engine/state.ts");
      _gameState = m.gameState;
      _isSameLocation = m.isSameLocation;
      _getRoom = m.getRoom;
      _getNamelessNPCs = m.getNamelessNPCs as any;
      const pm = await import("../../engine/parse-options.ts");
      _parseRoleOptions = pm.parseRoleOptions;
    } catch {}
  }

  const gs = _gameState || {};
  const p = gs.player || {};
  const loc = p?.location || "???";
  const turn = gs.turn || 0;
  const prose = _latestProse || (gs as any)._renderedProse || "";

  // NPCs
  const people: any[] = [];
  if (gs.npcs && _isSameLocation) {
    for (const [name, npc] of Object.entries(gs.npcs) as [string, any][]) {
      if (!npc.alive) continue;
      if (!_isSameLocation(npc.currentRoom, loc)) continue;
      const rel = p?.relationships?.[name];
      const body = npc.body || npc.body_by_age || {};
      people.push({
        name, type: "named",
        height: body.height_cm || npc.height_cm || npc.height || 160,
        gridPos: npc.gridPos || npc.grid_pos || [0, 0],
        dist: npc.distance || npc.dist || 2,
        affection: rel?.affection ?? 0,
        romance: rel?.stage || "陌生",
        action: npc.action || "",
        lastWords: npc.lastWords || "",
        sex: npc.sex || { fire: 0, heart: 0, nudity: "" },
        lh: npc.equipment?.left_hand?.name || npc.left_hand || "—",
        rh: npc.equipment?.right_hand?.name || npc.right_hand || "—",
      });
    }
  }
  // Crowds
  try {
    if (_getNamelessNPCs) {
      const crowd = _getNamelessNPCs(loc, gs.turn) as any[];
      for (const c of crowd) people.push({
        name: c.name || "???", type: "crowd", height: c.height || "?",
        gridPos: c.gridPos || [0, 0], clusterSize: c.count || c.clusterSize || 1,
        action: c.act || c.action || "",
      });
    }
  } catch {}

  // Room
  let room: any = null;
  try { if (_getRoom) room = _getRoom(loc); } catch {}

  // Choices
  let choices: any[] = [];
  try {
    if (_parseRoleOptions && prose) {
      const result = _parseRoleOptions(prose);
      choices = (result.options || []).map((c, i: number) => ({
        index: String.fromCodePoint(0x2460 + i),
        text: c.text,
        tag: c.tag || "",
      }));
    }
  } catch {}

  // Thinking
  let thinking: any = null;
  const summary = (gs as any)._phase1Summary || "";
  const directorNote = (gs as any)._phase1DirectorNote || "";
  const toolsCalled = (gs as any)._lastTurnToolsCalled || [];
  if (summary || directorNote || toolsCalled.length > 0) {
    thinking = { summary, directorNote, toolsCalled };
  }

  return {
    gameState: { player: p, time: gs.time, mode: gs.mode || "rpg", turn },
    TuiState: { ...tuiState },
    prose, thinking, people, room, choices,
  };
}

// ── triggerTurn ──

async function triggerTurn(message: string) {
  try {
    // 写入 _lastUserInput，让终端下一次按 Enter 时 consumed（不阻塞终端主输入框）
    if (_gameState) {
      _gameState._lastUserInput = message;
    }
    // 排队系统消息，终端 at 回复模式会自动消费
    if (_ctx?.chat?.addSystemMessage) {
      _ctx.chat.addSystemMessage(message);
    }
    console.log("[web-hud] queued:", message.slice(0, 60));
  } catch (e: any) {
    console.error("[web-hud] triggerTurn failed:", e.message || e);
  }
}
