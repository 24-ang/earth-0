#!/usr/bin/env node
// Build regions.json from lore files — strict IP name matching
import fs from 'node:fs';

const CN_NUM = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
function toArabic(s) { return s.replace(/[一二三四五六七八九]+/g, m => CN_NUM[m]||m); }
const SEC_BREAKS = ['教职员','教师','社会人士','其他','亲属','补习班','大学生','其他学校','---','社会人'];
const TEACHER_KW = ['教师','讲师','校医','顾问','班主任','管理员'];
const CLUB_SUFFIX = /(?:部|社|会|团|队|同好会|委员会|同盟|連|連合|軍)$/;

function isTeacher(d) { return TEACHER_KW.some(k => d.includes(k)); }
function isRealClub(s) {
  const clean = s.replace(/\(.*?\)/g, '').replace(/（.*?）/g, '').trim();
  if (clean.length > 10 || clean.length < 2) return false;
  if (/[。，、！？：\.\,\!\?\:]/.test(clean)) return false;
  if (/^\d+年/.test(clean) || /^[一二三四五六七八九]+年/.test(clean)) return false;
  if (!CLUB_SUFFIX.test(clean)) return false;
  if (/^(千叶|东京|神奈川|大阪|京都|北海道|埼玉|横滨|名古屋|福冈|长野|镰仓|江之岛|箱根|藤泽|武藏野|杉并|世田谷)/.test(clean)) return false;
  return true;
}

const FAMILY_LABELS = /^(长女|次女|三女|四女|五女|长男|次男|三男|四男|五男)$/;
const NAME_FILTER = /^(学生|教职员|■|身份|特征|关系|喜欢|其他|教师|社会人士|亲属|补习班|社会人|长女|次女|三女|四女|五女|长男|次男|三男)$/;

function extractAll(text) {
  const roster = {}, clubs = {};
  let curGrade = null, curLetter = null;
  for (let line of text.split('\n')) {
    const t = line.trim();
    if (!t) { curGrade = curLetter = null; continue; }

    // ■ 高中 3年级 (17岁) or ■ 大学生 (18岁) — extract grade, only if school year
    const ym2 = t.match(/^■\s*(?:高中|初中)?\s*(\d+)年级/);
    if (ym2) { curGrade = parseInt(ym2[1]); curLetter = null; continue; }
    const ycm2 = t.match(/^■\s*(?:高中|初中)?\s*([一二三四五六七八九]+)年级/);
    if (ycm2) { curGrade = parseInt(toArabic(ycm2[1])); curLetter = null; continue; }
    // ■ 大学生 / ■ 社会人 — not school grade, reset
    if (/^■\s*(大学|社会)/.test(t)) { curGrade = curLetter = null; continue; }
    if (SEC_BREAKS.some(s => t.startsWith(s) || t === s)) { curGrade = curLetter = null; continue; }

    // Class header: 高中2年A班, 2年A班, 2年A组, 一年B班
    let ch = line.match(/^\*?\s*(?:高中|初中)?\s*(\d+)年([A-Z0-9])[班组]?\s*$/);
    if (!ch) ch = line.match(/^\*?\s*(?:高中|初中)?\s*([一二三四五六七八九]+)年([A-Z0-9]?)[班组]?\s*[:：]?\s*$/);
    if (ch && !line.includes('|')) {
      curGrade = parseInt(toArabic(ch[1]));
      curLetter = ch[2] || null;
      continue;
    }

    const pi = line.indexOf('|');
    let name = null, desc = '';
    if (pi >= 0) {
      // Strip * or - prefix, keep only the name before parenthetical
      name = line.substring(0, pi).replace(/^[\s\*\-]+/, '').trim();
      // If name has /, take the part before / (Chinese name)
      const slashIdx = name.indexOf('/');
      if (slashIdx > 0) name = name.substring(0, slashIdx).trim();
      // Remove parenthetical
      name = name.replace(/\(.*?\)/g, '').replace(/（.*?）/g, '').trim();
      desc = line.substring(pi + 1);
    } else {
      // Bare name without pipe
      const nm = line.match(/^[\s\*\-\+]+(.+)$/);
      if (nm && curGrade && nm[1].length < 18 && !FAMILY_LABELS.test(nm[1].trim())) {
        name = nm[1].trim();
      }
    }
    if (!name || name === '学长' || name.length > 22) continue;
    if (NAME_FILTER.test(name)) continue;
    if (FAMILY_LABELS.test(name)) continue;

    if (isTeacher(desc)) { roster[name] = { role: 'teacher' }; continue; }
    if (curGrade && !roster[name]) roster[name] = { grade: curGrade, class: curLetter || '?' };

    if (pi >= 0) {
      const parts = desc.split('|').map(s => s.trim()).filter(Boolean);
      // Inline class: 1年C班, 2年A, 高中3年级
      for (const p of parts) {
        const im1 = p.match(/^(?:高中|初中)?\s*(\d+)年([A-Z0-9])[班组]?$/);
        const im2 = p.match(/^(?:高中|初中)?\s*(\d+)年级$/);
        if (im1) roster[name] = { grade: parseInt(im1[1]), class: im1[2] };
        else if (im2 && !roster[name]) roster[name] = { grade: parseInt(im2[1]), class: '?' };
      }
      // Club detection
      let club = null;
      for (const p of parts) {
        if (isRealClub(p)) { club = p.replace(/\(.*?\)/g, '').replace(/（.*?）/g, '').trim(); break; }
        for (const sp of p.split(/[\s\/]/)) {
          if (isRealClub(sp)) { club = sp.replace(/\(.*?\)/g, '').replace(/（.*?）/g, '').trim(); break; }
        }
        if (club) break;
      }
      if (club) { if (!clubs[club]) clubs[club] = []; if (!clubs[club].includes(name)) clubs[club].push(name); }
    }
  }
  return { roster, clubs };
}

function norm(s) { return s.replace(/[❗❕!！❤💕✨⭐💗🔥★♡♥]/g, '').trim().toLowerCase(); }

// Load existing regions
const regions = JSON.parse(fs.readFileSync('data/regions.json', 'utf-8'));
let maxId = Math.max(...regions.map(r => r.id));
const regionByName = new Map();
for (const r of regions) regionByName.set(norm(r.name), r);

// Process all lore files
const loreDir = 'data/lore';
const files = fs.readdirSync(loreDir).filter(f => f.endsWith('.json'));

for (const f of files) {
  const lore = JSON.parse(fs.readFileSync(loreDir + '/' + f, 'utf-8'));
  for (const [title, entry] of Object.entries(lore)) {
    const { roster, clubs } = extractAll(entry.text);
    if (Object.keys(roster).length === 0 && Object.keys(clubs).length === 0) continue;
    const tags = entry.tags || [];
    const titleParts = title.split('_');
    const ipName = titleParts.length > 1 ? titleParts.slice(1).join('_') : tags[0];

    // Find matching region: tag == region name (normalized)
    let region = null;
    for (const tag of tags) {
      region = regionByName.get(norm(tag));
      if (region) break;
    }
    if (!region) region = regionByName.get(norm(ipName));

    if (region) {
      if (!region.character_roster) region.character_roster = {};
      if (!region.clubs) region.clubs = {};
      for (const [n, info] of Object.entries(roster)) {
        if (!region.character_roster[n]) region.character_roster[n] = info;
        if (!region.characters.includes(n)) region.characters.push(n);
      }
      for (const [gname, chars] of Object.entries(clubs)) {
        if (!region.clubs[gname]) region.clubs[gname] = [];
        for (const ch of chars) {
          if (!region.clubs[gname].includes(ch)) region.clubs[gname].push(ch);
          if (!region.characters.includes(ch)) region.characters.push(ch);
        }
      }
      region.character_count = region.characters.length;
    } else {
      // Create new region
      let displayName = ipName.length > 3 ? ipName : tags[0];
      // If displayName looks like a location, try next tag
      const LOC_PREFIX = /^(世田谷|千叶|东京|神奈川|大阪|京都|北海道|长野|镰仓|江之岛|箱根|藤泽|武藏野|杉并|横滨|埼玉|名古屋|福冈)/;
      if (LOC_PREFIX.test(displayName) && tags.length > 1) {
        displayName = tags.find(t => !LOC_PREFIX.test(t)) || displayName;
      }
      if (displayName.length > 20 && tags.length > 1) {
        displayName = tags.find(t => t.length < 15 && !LOC_PREFIX.test(t)) || displayName;
      }
      if (regionByName.has(norm(displayName))) {
        region = regionByName.get(norm(displayName));
        continue;
      }

      const schools = tags.filter(t => /学园|学校|高校|中学/.test(t));
      const cities = tags.filter(t => t !== displayName && !/学园|学校|高校|中学/.test(t) && t.length < 10).slice(0,3);
      const newR = {
        id: ++maxId, name: displayName, keys: tags.slice(0, 8),
        location_hints: [...schools, ...cities].slice(0, 6),
        character_count: Object.keys(roster).length,
        characters: Object.keys(roster),
        character_roster: roster,
        fallback_room: '1F南走廊'
      };
      if (Object.keys(clubs).length > 0) newR.clubs = clubs;
      regions.push(newR);
      regionByName.set(norm(displayName), newR);
    }
  }
}

// Cleanup
for (const r of regions) delete r.classrooms;
regions.sort((a,b) => a.id - b.id);

// Write
fs.writeFileSync('data/regions.json', JSON.stringify(regions, null, 2), 'utf-8');
if (fs.existsSync('worldpacks/oregairu/regions.json')) {
  fs.writeFileSync('worldpacks/oregairu/regions.json', JSON.stringify(regions, null, 2), 'utf-8');
}

// Report
const checkNames = ['辉夜大小姐想让我告白','我的青春恋爱物语果然有问题。','日在校园','出包王女','紫云寺家的兄弟姐妹','学园默示录','新世纪福音战士','SSSS.GRIDMAN'];
for (const name of checkNames) {
  const r = regions.find(r => r.name === name);
  if (r) console.log(name + ': ' + r.characters.length + ' chars, roster=' + Object.keys(r.character_roster||{}).length);
  else console.log(name + ': MISSING');
}
console.log('Total regions: ' + regions.length);
const newR = regions.filter(r => r.id > 147);
console.log('New: ' + newR.map(r => r.id + ':' + r.name + '(' + r.character_count + ')').join(', '));
