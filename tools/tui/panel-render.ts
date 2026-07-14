/**
 * panel-render.ts — 对齐 tui-v5.html Demo 风格
 *
 * 视觉原则:
 *   Tab 栏: ● 标记当前，空格分隔
 *   NPC 卡片: 名·坐标(暖橙) / 状态·好感(多彩) / 独白(灰斜)
 *   操作按钮: 药丸形 2行×4列, 可用=暖橙, 锁定=灰, 战斗=红
 *   自身面板: HP头 → 六维 → [装备] → [背包] → [载具] 分节
 *   分隔线: ──48个
 *   光标: ▶ 左prefix
 */

const C = {
  r:  "\x1b[0m",
  O:  "\x1b[38;5;216m",  // warm orange
  P:  "\x1b[38;5;140m",  // purple
  b:  "\x1b[38;5;117m",  // blue
  G:  "\x1b[38;5;114m",  // green
  d:  "\x1b[38;5;167m",  // red
  Y:  "\x1b[38;5;215m",  // gold
  M:  "\x1b[38;5;243m",  // gray
  W:  "\x1b[38;5;252m",  // white
  B:  "\x1b[1m",
};

const W = 48;
const HR = "─".repeat(W);

export const TAB_NAMES = ["自身","周边","房间","行动"] as const;
const TAB_ICONS = ["🛡","👥","🏠","▼"];

// ── 宽度工具 ──

export function visibleWidth(s: string): number {
  let w = 0, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (esc) { if (ch === "m") esc = false; continue; }
    if (ch === "\x1b") { esc = true; continue; }
    const cp = ch.codePointAt(0)!;
    if ((cp>=0x1100&&cp<=0x115F)||(cp>=0x2E80&&cp<=0xA4CF)||(cp>=0xAC00&&cp<=0xD7A3)||(cp>=0xF900&&cp<=0xFAFF)||(cp>=0xFE10&&cp<=0xFE6F)||(cp>=0xFF01&&cp<=0xFF60)||(cp>=0xFFE0&&cp<=0xFFE6)) { w += 2; continue; }
    w += 1;
  }
  return w;
}

export function fit(s: string, width = W): string {
  let r = "", w = 0, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (esc) { r += ch; if (ch === "m") esc = false; continue; }
    if (ch === "\x1b") { esc = true; r += ch; continue; }
    const cw = ch.codePointAt(0)! > 0x7f ? (ch.codePointAt(0)! >= 0x2E80 ? 2 : 1) : 1;
    if (w + cw > width) break;
    r += ch; w += cw;
  }
  return r + " ".repeat(Math.max(0, width - visibleWidth(r)));
}

function hr(): string { return HR; }
function icn(a: number): string { return a>=60?`${C.G}♥`:a>=30?`${C.b}◆`:`${C.M}·`; }
function ncir(n: number): string { return String.fromCodePoint(0x245F + n); }

// ── 主入口 ──

export interface PanelOpts {
  tab: number;
  cursor: number;
  activeNpc?: string | null;
  submenu?: "talk" | "touch" | "observe" | null;
  combat?: boolean;
  feedback?: string;
  modeHint?: string;
}

export function renderPanel(gs: any, o: PanelOpts): string[] {
  const L: string[] = [];
  L.push(renderTabBar(o.tab));
  L.push(hr());
  let body: string[] = [];
  switch (o.tab) {
    case 0: body = renderSelf(gs, o); break;
    case 1: body = renderNearby(gs, o); break;
    case 2: body = renderRoom(gs, o); break;
    case 3: body = renderActions(gs, o); break;
  }
  L.push(...body);
  L.push(hr());
  L.push(fit(`${C.M}💡 ${o.feedback || "系统就绪"}${C.r}`));
  L.push(fit(`${C.M}● ${o.modeHint || "←→切Tab ↑↓移光标 Enter确认 1-6直选"}${C.r}`));
  return L;
}

// ── Tab 栏 ──

function renderTabBar(active: number): string {
  const p: string[] = [];
  for (let i = 0; i < 4; i++) {
    const dot = i === active ? `${C.O}●${C.r}` : "·";
    const color = i === active ? `${C.O}${C.B}` : C.M;
    p.push(`${dot}${color}${TAB_ICONS[i]} ${TAB_NAMES[i]}${C.r}`);
  }
  return fit(p.join("  "), W);
}

// ── Tab 0: 自身 ──

function renderSelf(gs: any, o: PanelOpts): string[] {
  const L: string[] = [];
  const p = gs.player; if (!p) return [fit(`${C.M}（无数据）${C.r}`)];
  const hp=p.hp?.current??10, hpM=p.hp?.max??15, ac=p.ac??10;
  const rw=p.equipment?.right_hand, lw=p.equipment?.left_hand;
  const wp=rw?.type==="weapon"?rw:(lw?.type==="weapon"?lw:null);
  const ws=wp?`${C.Y}🗡${wp.name} ${wp.damage?.dice??"1d2"}${C.r}`:`${C.Y}🗡空手 1d2${C.r}`;

  L.push(fit(` ${C.d}❤${hp}/${hpM}${C.r} · AC${ac} · ${ws}`, W));

  const a = (k:string)=>p.attributes?.[k]??0;
  L.push(fit(` 力${a("力量")} 敏${a("敏捷")} 体${a("体质")} 智${a("智力")} 感${a("感知")} 魅${a("魅力")}`, W));

  // [装备]
  L.push(fit(` ${C.M}── 装备 ──${C.r}`, W));
  const slots=[{k:"top",n:"上衣"},{k:"outer",n:"外套"},{k:"bottom",n:"下装"},{k:"shoes",n:"鞋子"},{k:"right_hand",n:"右手"},{k:"left_hand",n:"左手"}];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    const it = p.equipment?.[s.k];
    const mk = (2 + i) === o.cursor ? `${C.O}▶${C.r}` : " ";
    const clr = s.k==="right_hand"||s.k==="left_hand"?C.Y:C.W;
    if (it) L.push(fit(`${mk} ${C.M}${s.n}${C.r}  ${clr}${it.name}${C.r}`, W));
    else L.push(fit(`${mk} ${C.M}${s.n}${C.r}  ${C.M}—${C.r}`, W));
  }

  // [背包]
  const inv = p.inventory||[];
  L.push(fit(` ${C.M}── 背包 ${inv.length}件/${a("力量")*2}L ──${C.r}`, W));
  if (inv.length) {
    const tags = inv.slice(0,5).map((it:any,i:number)=>`${C.O}${ncir(i+1)}${C.r}${it.name}`);
    L.push(fit(`  ${tags.join("  ")}`, W));
  }

  // [载具]
  if (p.vehicle) {
    L.push(fit(` ${C.M}── 驾驶 ──${C.r}`, W));
    L.push(fit(`  ${C.Y}🚲${p.vehicle.name}${C.r} ×${p.vehicle.speedMul??1.5} · ${p.vehicle.parkedAt??""}`, W));
  }

  // 资金
  const vol = (p.inventory||[]).reduce((s:number,it:any)=>s+(it.volume??0.5),0);
  L.push(fit(` ${C.Y}¥${p.funds??0}${C.r}  ${C.M}💤${p.fatigue??0}${C.r}  ${vol.toFixed(1)}/${a("力量")*2}L`, W));

  return L;
}

// ── Tab 1: 周边 ──

function renderNearby(gs: any, o: PanelOpts): string[] {
  const L: string[] = [];
  const p=gs.player; const loc=p?.location; if(!loc)return[fit(`${C.M}（未知位置）${C.r}`)];

  const named: any[]=[], crowd: any[]=[];
  if(gs.npcs){try{const{isSameLocation}=require("../../engine/state.ts");for(const[n,npc]of Object.entries(gs.npcs)as[string,any][]){if(!npc.alive)continue;if(isSameLocation(npc.currentRoom,loc))named.push({name:n,npc,rel:p?.relationships?.[n]});}}catch{}}
  try{const{getNamelessNPCs}=require("../../engine/state.ts");crowd.push(...getNamelessNPCs(loc,gs.turn)as any[]);}catch{}

  if(!named.length&&!crowd.length)return[fit(`  ${C.M}（周边无人）${C.r}`)];

  // NPC 列表 — 每个 3-4 行
  const activeIdx = o.activeNpc!=null ? named.findIndex(n=>n.name===o.activeNpc) : o.cursor;

  for (let i = 0; i < named.length; i++) {
    const {name,npc,rel} = named[i];
    const isActive = i === activeIdx;
    const aff = rel?.affection??0, stage=rel?.stage??"陌生";
    const mk = isActive ? `${C.O}▶${C.r}` : " ";
    const grid = npc.gridPos||npc.grid_pos;
    const pos = grid ? `(${grid[0]},${grid[1]})` : "";
    const h = npc.height_cm||npc.body?.height_cm||npc.height||"?";
    const dist = npc.distance??npc.dist??"?";
    const lh = npc.equipment?.left_hand?.name||npc.left_hand||"—";
    const rh = npc.equipment?.right_hand?.name||npc.right_hand||"—";

    // 行1: 名+坐标
    L.push(fit(` ${mk}${C.O}${C.B}${name}${C.r}  ${h}cm · ${pos} · 隔${dist}m`, W));
    // 行2: 状态+好感
    const act = npc.action||"";
    L.push(fit(`   ${act} · ${icn(aff)}${C.r}${aff}/100 ${C.P}${stage}${C.r} · ${C.M}${rh}|${lh}${C.r}`, W));
    // 行3: 独白
    if (npc.lastWords) {
      const w = String(npc.lastWords).replace(/^\[.*?\]\s*/,"").slice(0,38);
      if (w) L.push(fit(`  ${C.M}"${w}"${C.r}`, W));
    }

    // 操作按钮（仅选中时）
    if (isActive) {
      const btns = buildNpcButtons(npc, rel, gs, o.cursor);
      for (const l of btns) L.push(fit(l, W));
    }

    if (i < named.length - 1) L.push(fit(""));
  }

  // 路人
  for (const c of crowd) {
    const nm = c.name||"???"; const cnt = c.count||c.clusterSize||1;
    L.push(fit(`  ${C.O}${nm}${C.r}${cnt>1?` x${cnt}`:""}  ${C.M}${c.act||c.action||""}${C.r}`, W));
  }

  return L;
}

/** NPC 操作按钮: 2行×4列，带光标 */
function buildNpcButtons(npc: any, rel: any, gs: any, cur: number): string[] {
  const aff=rel?.affection??0, stage=rel?.stage??"陌生", isLover=stage==="恋人"||stage==="亲密";
  const stealth=gs.player?.skills?.潜行?.level>=1, psych=gs.player?.skills?.心理?.level>=1||gs.player?.skills?.催眠?.level>=1;

  const btns: {label:string;avail:boolean;hint:string;danger:boolean}[] = [
    {label:"①搭话",avail:true,hint:"",danger:false},
    {label:"②接触",avail:aff>=10,hint:"≥10",danger:false},
    {label:"③观察",avail:true,hint:"·洞察",danger:false},
    {label:"④组队",avail:aff>=40||isLover,hint:"≥40",danger:false},
    {label:"⑤恋爱",avail:aff>=50,hint:"≥50",danger:false},
    {label:"⑥战斗",avail:true,hint:"",danger:true},
    {label:"⑦窃取",avail:stealth,hint:"·潜行",danger:false},
    {label:"⑧暗示",avail:psych,hint:"·心理",danger:false},
  ];
  if (isLover) btns.push({label:"⑨亲密",avail:aff>=80,hint:"",danger:true});

  const parts: string[] = [];
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i]!;
    const m = i === cur ? `${C.O}▶${C.r}` : "  ";
    let t: string;
    if (!b.avail) { t = `${C.M}${b.label}${b.hint||""}${C.r}`; }
    else if (b.danger) { t = `${C.d}${b.label}${C.r}`; }
    else { t = `${C.O}${b.label}${C.r}`; }
    parts.push(`${m}${t}`);
  }

  const lines: string[] = [];
  lines.push(`  ${parts.slice(0,4).join("  ")}`);
  lines.push(`  ${parts.slice(4).join("  ")}`);
  return lines;
}

// ── Tab 2: 房间 ──

function renderRoom(gs: any, _o: PanelOpts): string[] {
  const L: string[]=[];
  const p=gs.player; const loc=p?.location; if(!loc)return[fit(`${C.M}（未知位置）${C.r}`)];
  let room:any=null; try{room=require("../../engine/state.ts").getRoom(loc)}catch{}
  if(!room){L.push(fit(`  ${C.M}📍${loc}${C.r}`));return L;}

  const w=room.width||"?", h=room.height||"?"; const gx=p.gridPos?.[0]??"?", gy=p.gridPos?.[1]??"?";
  L.push(fit(`  📏 ${w}m×${h}m · 你在(${gx},${gy}) · ${C.P}✨${room.atmosphere||""}${C.r}`, W));

  const furn: string[]=[], exits: string[]=[];
  for (const row of room.cells||[]) {
    if(!Array.isArray(row))continue;
    for (const c of row) {
      if(!c)continue;
      if(c.furniture){const acts=c.actions?c.actions.slice(0,2).join("/"):"";furn.push(`${C.Y}📦${c.furniture}${C.r} ${C.M}(${c.x},${c.y}) ${acts}${C.r}`);}
      if(c.type==="exit"||c.type==="door"){exits.push(`${C.G}🚪→${c.exitTo||"出口"}${C.r} ${C.M}(${c.x},${c.y})${C.r}`);}
    }
  }

  if(furn.length){L.push(fit(` ${C.M}── 家具 ──${C.r}`,W)); for(const f of furn.slice(0,4))L.push(fit(f,W));}
  if(exits.length){L.push(fit(` ${C.M}── 出口 ──${C.r}`,W)); for(const e of exits)L.push(fit(e,W));}

  return L;
}

// ── Tab 3: 行动 ──

function renderActions(_gs: any, o: PanelOpts): string[] {
  const L: string[]=[];
  let choices:any[]=[];
  try{const{lastRenderedProse}=require("../../tools/helpers.ts");const{parseRoleOptions}=require("../../engine/parse-options.ts");if(lastRenderedProse){const r=parseRoleOptions(lastRenderedProse);choices=r.options||[];}}catch{}

  if(!choices.length)return[fit(`  ${C.M}（等待叙事推进）${C.r}`)];

  for(let i=0;i<Math.min(choices.length,5);i++){
    const c=choices[i], num=ncir(i+1);
    const label=c.text||"";
    const tag=c.tag||""; const tc=tag==="挑衅"?C.d:tag==="温柔"?C.G:tag==="真诚"?C.O:C.P;
    const mk=i===o.cursor?`${C.O}▶${C.r}`:" ";
    L.push(fit(`${mk} ${C.O}${num}${C.r} ${C.W}${label}${C.r}  ${tc}[${tag}]${C.r}`,W));
  }
  return L;
}

// ── 子菜单 ──

export function renderTalkSubmenu(gs:any,npcName:string,cursor:number,fb?:string):string[]{
  const opts=["聊聊日常 — 随意闲聊生活琐事","聊聊自己 — 分享最近的经历和看法","聊聊对方 — 问她的喜好和近况","聊聊八卦 — 分享学校的传闻"];
  const out=renderPanel(gs,{tab:3,cursor:0,submenu:"talk",activeNpc:npcName,feedback:fb});
  const nc=[fit(`  ${C.O}${C.B}💬 搭话: ${npcName}${C.r}  ${C.M}←Esc返回${C.r}`,W)];
  for(let i=0;i<opts.length;i++){const m=i===cursor?`${C.O}▶${ncir(i+1)}${C.r}`:`  ${ncir(i+1)}`;nc.push(fit(` ${m} ${C.W}${opts[i]}${C.r}`,W));}
  out.splice(2,out.length-6,...nc); return out;
}

export function renderTouchSubmenu(gs:any,npcName:string,cursor:number,fb?:string):string[]{
  const aff=gs.player?.relationships?.[npcName]?.affection??0;
  const items=[{l:"🤝 友好握手",n:0},{l:"👋 亲切摸头",n:30},{l:"🤗 温暖拥抱",n:50},{l:"💆 肢体按摩",n:60},{l:"💋 深情亲吻",n:70}];
  const out=renderPanel(gs,{tab:3,cursor:0,submenu:"touch",activeNpc:npcName,feedback:fb});
  const nc=[fit(`  ${C.O}${C.B}🖐️ 接触: ${npcName} (${C.d}💕${aff}${C.O})${C.r}  ${C.M}←Esc返回${C.r}`,W)];
  for(let i=0;i<items.length;i++){const it=items[i]!,av=aff>=it.n,m=i===cursor?`${C.O}▶${ncir(i+1)}${C.r}`:`  ${ncir(i+1)}`;nc.push(fit(` ${m} ${av?C.W:C.M}${it.l}${C.r}  ${av?"":`${C.M}≥${it.n}${C.r}`}`,W));}
  out.splice(2,out.length-6,...nc); return out;
}

export function renderObserveSubmenu(gs:any,npcName:string,fb?:string):string[]{
  const lv=gs.player?.skills?.洞察?.level??0; let npc:any=null;
  try{npc=require("../../engine/state.ts").findCharacter(npcName)||gs.npcs?.[npcName];}catch{}
  const out=renderPanel(gs,{tab:3,cursor:0,submenu:"observe",activeNpc:npcName,feedback:fb});
  const nc=[fit(`  ${C.O}${C.B}🔍 观察: ${npcName}${C.r}  ${C.M}←Esc返回${C.r}`,W)];
  nc.push(fit(`  ${C.O}${npcName}${C.r}  ${C.M}${npc?.gender||"?"}·${npc?.base_age||npc?.age||"?"}岁${C.r}`,W));
  nc.push(fit(`  ${C.M}外观:${C.r} ${C.W}${npc?.appearance||npc?.looks||"?"}${C.r}`,W));
  const b=npc?.body||npc?.body_by_age||{};
  nc.push(fit(`  ${C.M}身体:${C.r} ${b.height_cm||"?"}cm·${b.weight_kg||"?"}kg·${b.cup||"?"}cup`,W));
  const aff=gs.player?.relationships?.[npcName]?.affection??0;
  nc.push(fit(`  ${C.M}关系:${C.r} ${C.G}♥${aff}/100${C.r} · ${C.P}${gs.player?.relationships?.[npcName]?.stage||"陌生"}${C.r}`,W));
  if(lv>=2){nc.push(fit(`  ${C.M}──洞察Lv2+──${C.r}`,W)); nc.push(fit(`  ${C.M}携带:${C.r} ${C.Y}¥${npc?.funds??0}${C.r}`));}
  if(lv>=3){nc.push(fit(`  ${C.M}──洞察Lv3+──${C.r}`,W)); const at=npc?.attributes||{}; nc.push(fit(`  ${C.M}属性:${C.r} 力${at.力量||"?"}敏${at.敏捷||"?"}体${at.体质||"?"}智${at.智力||"?"}感${at.感知||"?"}魅${at.魅力||"?"}`,W));}
  out.splice(2,out.length-6,...nc); return out;
}
