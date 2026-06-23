const fs = require('fs');
const path = require('path');

const ref = JSON.parse(fs.readFileSync(
  'C:/Users/Xiang/Documents/WeChat Files/wxid_tg72qh4lnphv12/FileStorage/File/2026-06/ 🤖动漫角色目录.json',
  'utf-8'
));
const regPath = path.resolve('data/regions.json');
const reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));

// Normalize IP name for matching
function normIP(name) {
  return name.replace(/[《》「」]/g, '').replace(/[！!]/g, '')
    .replace(/\(.*?\)/g, '').replace(/（.*?）/g, '')  // strip parenthetical
    .replace(/\*\*/g, '')  // strip bold markers
    .trim().toLowerCase();
}

// Find the best regions.json entry for an IP name
function findRegion(ipName) {
  const n = normIP(ipName);
  // Try exact name match first
  let r = reg.find(x => normIP(x.name) === n);
  if (r) return r;
  // Try key match
  r = reg.find(x => (x.keys || []).some(k => normIP(k) === n));
  if (r) return r;
  // Try partial match
  r = reg.find(x => normIP(x.name).includes(n) || n.includes(normIP(x.name)));
  if (r) return r;
  // Try key partial
  r = reg.find(x => (x.keys || []).some(k => normIP(k).includes(n) || n.includes(normIP(k))));
  return r;
}

// Parse roster: returns array of { name, grade, className, club }
function parseRosterLine(line) {
  // Match lines like: *   角色名 | 年级/班级 | 社团
  // Also handle indented:     *   角色名 | 年级/班级 | 社团
  const m = line.match(/^\s*\*\s+(.+?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/);
  if (!m) return null;
  const name = m[1].replace(/\*\*/g, '').trim();
  const info = m[2].trim();
  const club = m[3].trim();

  if (!name || name.length < 2) return null;

  let grade = null, className = null, role = null;
  if (info.includes('教师') || info.includes('老师')) { role = 'teacher'; }
  if (info.includes('大学生')) { grade = '大学'; }
  if (info.includes('小学生')) { grade = '小学'; }
  if (info.includes('初中生')) { grade = '中学'; }
  if (info.includes('高中生')) { grade = '高中'; }

  // Chinese numeral → digit
  const cnNum = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
  function toDigit(s) { return cnNum[s] || s; }

  // "高中二年级" → grade 2
  const hsMatch = info.match(/高中([\p{Nd}一二三四五六七八九]+)/u);
  if (hsMatch) { grade = toDigit(hsMatch[1]); }
  // "初中1年级" → grade 中1
  const msMatch = info.match(/初中([\p{Nd}一二三四五六七八九]+)/u);
  if (msMatch) { grade = '中' + toDigit(msMatch[1]); }

  // "2年级" → grade 2
  const gMatch = info.match(/^(\p{Nd}+)年级$/u);
  if (gMatch && !grade) { grade = gMatch[1]; }
  // "1年5班" → grade 1, class 5
  const gc1 = info.match(/^(\p{Nd}+)年(\p{Nd}+|[A-Zａ-ｚＡ-Ｚ])/u);
  if (gc1) { grade = gc1[1]; className = gc1[2]; }
  // "2-C" or "2年C组" → grade 2, class C
  const gc2 = info.match(/^(\p{Nd}+)[-—–](\p{Nd}+|[A-Zａ-ｚＡ-Ｚ])/u);
  if (gc2 && !grade) { grade = gc2[1]; className = gc2[2]; }
  // "1-C → 2-C" (progression, take latest)
  const gc3 = info.match(/→\s*(\p{Nd}+)[-—–](\p{Nd}+|[A-Zａ-ｚＡ-Ｚ])/u);
  if (gc3) { grade = gc3[1]; className = gc3[2]; }

  return { name, grade, className, club: club || null, role };
}

let updated = 0;
let fixedRoster = 0;

for (const [rid, entry] of Object.entries(ref.entries)) {
  const content = entry.content || '';
  if (!content.includes('|')) continue;

  // Split content by IP boundaries
  const lines = content.split('\n');
  let currentIP = null;
  const ipRosters = {}; // IP name → roster array

  for (const line of lines) {
    // Detect IP heading lines (allow leading whitespace)
    const headingM = line.match(/^\s*#{2,4}\s*\*{0,2}\s*(.+?)\s*\*{0,2}\s*(?:\|.*)?$/);
    if (headingM) {
      let heading = headingM[1].replace(/\*+/g, '').trim();
      // Skip school/place headings
      if (heading.includes('高校') || heading.includes('中学') || heading.includes('大学') ||
          heading.includes('附属') || heading.includes('学校') || heading.includes('県') ||
          heading.includes('地区') || heading.includes('所属') || heading.includes('未明确') ||
          heading.includes('总武高') || heading === '') {
        // But still set as context (don't skip, just don't change currentIP for these)
        // Skip: these are school names, not IP names
        continue;
      }
      currentIP = heading;
      if (!ipRosters[currentIP]) ipRosters[currentIP] = [];
      continue;
    }

    // Detect IP markers like **作品名** (possibly inside a roster-looking line)
    const ipM = line.match(/^\s*\*\s*\*\*\s*(.+?)\s*\*\*\s*\|/);
    if (ipM) {
      currentIP = ipM[1].trim();
      if (!ipRosters[currentIP]) ipRosters[currentIP] = [];
      continue;
    }
    // Simpler: **作品名** on its own
    const ipM2 = line.match(/^\s*\*\s*\*\*\s*(.+?)\s*\*\*\s*$/);
    if (ipM2) {
      currentIP = ipM2[1].trim();
      if (!ipRosters[currentIP]) ipRosters[currentIP] = [];
      continue;
    }

    // Parse roster line
    if (currentIP && line.includes('|')) {
      const roster = parseRosterLine(line);
      if (roster) {
        ipRosters[currentIP].push(roster);
      }
    }
  }

  // Apply each IP's roster to matching regions.json entry
  for (const [ipName, roster] of Object.entries(ipRosters)) {
    if (roster.length === 0) continue;
    const region = findRegion(ipName);
    if (!region) continue;

    let changed = false;

    // Add missing characters
    region.characters = region.characters || [];
    for (const rEntry of roster) {
      const cleanName = rEntry.name.replace(/（[^）]*）/g, '').replace(/\(.*?\)/g, '').trim();
      if (cleanName.length < 2) continue;
      if (cleanName.includes('高校') || cleanName.includes('中学') || cleanName.includes('班')) continue;

      const exists = (region.characters || []).some(c =>
        c.replace(/（[^）]*）/g, '').trim() === cleanName ||
        c.includes(cleanName) || cleanName.includes(c.replace(/（[^）]*）/g, '').trim())
      );
      if (!exists) {
        region.characters.push(cleanName);
        changed = true;
      }
    }

    // Update character_roster
    region.character_roster = region.character_roster || {};
    for (const rEntry of roster) {
      const cleanName = rEntry.name.replace(/（[^）]*）/g, '').replace(/\(.*?\)/g, '').trim();
      if (cleanName.length < 2) continue;

      // Find matching character in region.characters
      let matchedName = null;
      for (const cn of (region.characters || [])) {
        const clean = cn.replace(/（[^）]*）/g, '').trim();
        if (clean === cleanName || clean.includes(cleanName) || cleanName.includes(clean)) {
          matchedName = cn;
          break;
        }
      }
      if (!matchedName) matchedName = cleanName;

      const rosterEntry = {};
      if (rEntry.grade) rosterEntry.grade = isNaN(Number(rEntry.grade)) ? rEntry.grade : Number(rEntry.grade);
      if (rEntry.className) rosterEntry.class = rEntry.className;
      if (rEntry.role) rosterEntry.role = rEntry.role;
      if (rEntry.club) rosterEntry.club = rEntry.club;

      const existing = region.character_roster[matchedName];
      if (!existing || Object.keys(existing).length < Object.keys(rosterEntry).length) {
        region.character_roster[matchedName] = rosterEntry;
        fixedRoster++;
        changed = true;
      }
    }

    // Update clubs
    region.clubs = region.clubs || {};
    for (const rEntry of roster) {
      if (!rEntry.club) continue;
      const cn = rEntry.name.replace(/（[^）]*）/g, '').trim();
      let matched = cn;
      for (const k of Object.keys(region.character_roster || {})) {
        const ck = k.replace(/（[^）]*）/g, '').trim();
        if (ck === cn || ck.includes(cn) || cn.includes(ck)) { matched = k; break; }
      }
      if (!region.clubs[rEntry.club]) region.clubs[rEntry.club] = [];
      if (!region.clubs[rEntry.club].includes(matched)) {
        region.clubs[rEntry.club].push(matched);
        changed = true;
      }
    }

    if (changed) updated++;
  }
}

fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
console.log('Updated', updated, 'regions with roster data');
console.log('Fixed', fixedRoster, 'character roster entries');
