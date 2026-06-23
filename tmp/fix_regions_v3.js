const fs = require('fs');
const path = require('path');

const ref = JSON.parse(fs.readFileSync(
  'C:/Users/Xiang/Documents/WeChat Files/wxid_tg72qh4lnphv12/FileStorage/File/2026-06/_🤖动漫角色目录  (2).json',
  'utf-8'
));

function norm(s) {
  return (s||'').replace(/[《》「」『』]/g, '').replace(/[！!？?]/g, '')
    .replace(/\(.*?\)/g, '').replace(/（.*?）/g, '')
    .replace(/\*\*/g, '').replace(/#/g, '')
    .trim().toLowerCase();
}

function findRegion(reg, ipName) {
  const n = norm(ipName);
  let r = reg.find(x => norm(x.name) === n);
  if (r) return r;
  r = reg.find(x => (x.keys||[]).some(k => norm(k) === n));
  if (r) return r;
  r = reg.find(x => norm(x.name).includes(n) || n.includes(norm(x.name)));
  if (r) return r;
  r = reg.find(x => (x.keys||[]).some(k => norm(k).includes(n) || n.includes(norm(k))));
  return r;
}

const cnNum = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
function toDigit(s) { return cnNum[s] || s; }

// Parse a single reference entry into IP → roster map
function parseEntry(content) {
  const lines = content.split('\n');
  const result = {}; // { ipName: { chars: [{name, grade, className, club, notes}], clubs: {} } }

  let currentIP = null;
  let currentGrade = null;
  let currentClass = null;
  let currentRole = null; // 'teacher' if in teacher section

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // ===== IP / School heading detection =====
    // ## / ### / #### headings
    const hMatch = trimmed.match(/^#{1,4}\s*\*{0,2}\s*(.+?)\s*\*{0,2}\s*$/);
    if (hMatch) {
      let h = hMatch[1].replace(/\*+/g, '').trim();
      // Try extracting IP name from "学校 | 地点 | IP名" — grab LAST | segment
      const ipFromH = h.match(/^.*[|｜]\s*(.+)$/);
      if (ipFromH) {
        const ipC = ipFromH[1].trim();
        if (!ipC.includes('県') && !ipC.includes('市') && !ipC.includes('区') &&
            !ipC.includes('高中') && !ipC.includes('中学') && !ipC.includes('大学') && ipC.length > 2) {
          currentIP = ipC;
          if (!result[currentIP]) result[currentIP] = { chars: [], clubs: {} };
          currentGrade = null; currentClass = null; currentRole = null;
          continue;
        }
      }
      // Skip school/place names
      if (h.includes('高校') || h.includes('中学') || h.includes('大学') ||
          h.includes('附属') || h.includes('学校') || h.includes('県') ||
          h.includes('地区') || h.includes('所属') || h.includes('未明确') ||
          h.includes('总武高') || h.includes('箱根') || h.includes('学生') ||
          h.includes('教师') || h.includes('其他') || h.includes('社会人士') ||
          h === '' || h.match(/^[■\d]/)) continue;
      currentIP = h;
      if (!result[currentIP]) result[currentIP] = { chars: [], clubs: {} };
      currentGrade = null;
      currentClass = null;
      currentRole = null;
      continue;
    }

    // Bold heading: **作品名** or **学校 | 作品名**
    const bhMatch = trimmed.match(/^\*\*(.+)\*\*\s*$/);
    if (bhMatch) {
      const full = bhMatch[1].trim();
      // Try extracting IP name from last | segment
      const segments = full.split(/[|｜]/).map(s => s.trim());
      const lastSeg = segments[segments.length - 1];
      // If last segment looks like an IP name (not a district/city/prefecture)
      if (segments.length > 1 && lastSeg.length > 2 &&
          !lastSeg.includes('県') && !lastSeg.includes('市') && !lastSeg.includes('区') &&
          !lastSeg.includes('高中') && !lastSeg.includes('中学') && !lastSeg.includes('大学')) {
        currentIP = lastSeg;
        if (!result[currentIP]) result[currentIP] = { chars: [], clubs: {} };
        currentGrade = null; currentClass = null; currentRole = null;
        continue;
      }
      // Otherwise, the heading itself is the IP
      let h = full.replace(/\|.*$/, '').trim();
      if (h.includes('高校') || h.includes('中学') || h.includes('大学') || h.includes('总武高') ||
          h.includes('附属') || h.includes('学校') || h.includes('県')) {
        continue; // Skip pure school/location headings
      }
      currentIP = h;
      if (!result[currentIP]) result[currentIP] = { chars: [], clubs: {} };
      currentGrade = null; currentClass = null; currentRole = null;
      continue;
    }

    // ===== Grade/Class headings =====
    // **■ X年级** → grade only
    const grMatch = trimmed.match(/^\*\*■\s*(\p{Nd}+|[一二三])年级\*\*$/u);
    if (grMatch) {
      currentGrade = toDigit(grMatch[1]);
      currentClass = null;
      currentRole = null;
      continue;
    }
    // **■ X年Y班** → grade + class (combined)
    const grClMatch = trimmed.match(/^\*\*■\s*(\p{Nd}+|[一二三])年([\p{Nd}A-Zａ-ｚＡ-Ｚ]+)班?\*\*$/u);
    if (grClMatch) {
      currentGrade = toDigit(grClMatch[1]);
      currentClass = grClMatch[2];
      currentRole = null;
      continue;
    }
    // **X年Y班** → grade + class
    const clMatch = trimmed.match(/^\*\*(\p{Nd}+|[一二三])年([\p{Nd}A-Zａ-ｚＡ-Ｚ]+)班?\*\*$/u);
    if (clMatch) {
      currentGrade = toDigit(clMatch[1]);
      currentClass = clMatch[2];
      currentRole = null;
      continue;
    }

    // ===== Role section heading =====
    if (trimmed.match(/^\*\*■\s*(教师|其他|社会人士)/) || trimmed.match(/^(教师|其他|社会人士)[：:]/)) {
      currentRole = 'teacher';
      currentGrade = null;
      currentClass = null;
      continue;
    }

    // ===== Teacher/role line without * prefix =====
    // e.g. "教师：羽生真由梨／真由罗|美术教师|漫画研究部指导老师/顾问老师"
    const roleLine = trimmed.match(/^(教师|其他|社会人士)[：:]\s*(.+)$/);
    if (roleLine) {
      const restRole = roleLine[2];
      const rparts = restRole.split('|').map(p => p.trim());
      const rname = rparts[0].replace(/\//g, '／').trim();
      const rclub = rparts.slice(1).filter(p => p).join('; ');
      if (rname && currentIP && rname.length > 1) {
        if (!result[currentIP]) result[currentIP] = { chars: [], clubs: {} };
        result[currentIP].chars.push({
          name: rname,
          grade: null,
          className: null,
          club: rclub || null,
          notes: null,
          role: 'teacher'
        });
      }
      continue;
    }

    // ===== Character line =====
    // Formats:
    //   *   名字 | 备注 | 备注
    //   *   名字 (no pipes)
    //   *   班级| 名字 | 备注  (class-prefixed)
    //   Indented with spaces
    const charMatch = trimmed.match(/^\*\s+(.+)$/);
    if (!charMatch) continue;

    let rest = charMatch[1];

    // Sub-heading within grade: **2年J班** (possibly inside a * line)
    const subClMatch = rest.match(/^\*\*(\p{Nd}+|[一二三])年([\p{Nd}A-Zａ-ｚＡ-Ｚ]+)班?\*\*\s*$/u);
    if (subClMatch) {
      currentClass = subClMatch[2];
      currentGrade = toDigit(subClMatch[1]);
      continue;
    }

    // Split by |
    let parts = rest.split('|').map(p => p.trim());
    let name, extra;

    // Check if first part looks like a class (e.g. "2年J班")
    if (parts.length >= 2 && /^(\p{Nd}+|[一二三])年[\p{Nd}A-Zａ-ｚＡ-Ｚ]+班?$/u.test(parts[0])) {
      // Format: *  2年J班| 名字 | ...
      const classPart = parts.shift();
      const clM = classPart.match(/^(\p{Nd}+|[一二三])年([\p{Nd}A-Zａ-ｚＡ-Ｚ]+)班?$/u);
      if (clM) {
        currentClass = clM[2];
        currentGrade = toDigit(clM[1]);
      }
      name = parts[0] || '';
      extra = parts.slice(1).filter(p => p).join('; ');
    } else {
      name = parts[0] || '';
      extra = parts.slice(1).filter(p => p).join('; ');
    }

    name = name.replace(/\*\*/g, '').replace(/^[-–—•·]\s*/, '').trim();
    if (!name || name.length < 2) continue;
    if (name.includes('■') || name.includes('年级') || name.includes('班')) continue;

    // Extract club/notes from extra
    let club = null;
    let notes = null;
    if (extra && extra.length > 0) {
      // Check if it looks like a club
      if (extra.includes('部') || extra.includes('会') || extra.includes('社') || extra.includes('委员') || extra.includes('教师')) {
        club = extra;
      } else {
        notes = extra;
      }
    }

    // Clean name: remove leading markers
    name = name.replace(/^[-–—•·]\s*/, '').trim();
    if (name.length < 2) continue;

    if (!currentIP) continue;

    if (!result[currentIP]) result[currentIP] = { chars: [], clubs: {} };
    result[currentIP].chars.push({
      name,
      grade: currentGrade,
      className: currentClass,
      club,
      notes,
      role: currentRole
    });

    // Track clubs
    if (club && !result[currentIP].clubs[club]) {
      result[currentIP].clubs[club] = [];
    }
    if (club) {
      result[currentIP].clubs[club].push(name);
    }
  }

  // Clean up: remove IPs with no characters
  for (const [k, v] of Object.entries(result)) {
    if (v.chars.length === 0) delete result[k];
  }

  return result;
}

// Process all reference entries
const allParsed = {};
for (const [rid, entry] of Object.entries(ref.entries)) {
  if (!entry.content) continue;
  const parsed = parseEntry(entry.content);
  Object.assign(allParsed, parsed);
}

console.log('Parsed IPs:', Object.keys(allParsed).length);
let totalChars = 0;
for (const v of Object.values(allParsed)) totalChars += v.chars.length;
console.log('Total characters:', totalChars);

// Apply to BOTH regions.json files
const regFiles = ['data/regions.json', 'worldpacks/oregairu/regions.json'];
let updated = 0;
let rosterFixed = 0;

for (const regFile of regFiles) {
  const regPath = path.resolve(regFile);
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));

  for (const [ipName, data] of Object.entries(allParsed)) {
    const region = findRegion(reg, ipName);
    if (!region) continue;

    // Update characters list
    region.characters = region.characters || [];
    const existingSet = new Set((region.characters||[]).map(c => c.replace(/（[^）]*）/g, '').trim()));
    for (const ch of data.chars) {
      const clean = ch.name.replace(/（[^）]*）/g, '').replace(/\(.*?\)/g, '').trim();
      if (clean.length < 2) continue;
      if (!existingSet.has(clean) && ![...existingSet].some(e => e.includes(clean) || clean.includes(e))) {
        region.characters.push(clean);
        existingSet.add(clean);
      }
    }

    // Update character_roster
    region.character_roster = region.character_roster || {};
    for (const ch of data.chars) {
      const clean = ch.name.replace(/（[^）]*）/g, '').replace(/\(.*?\)/g, '').trim();
      if (clean.length < 2) continue;

      // Find matching name in character list
      let matchedName = clean;
      for (const cn of (region.characters||[])) {
        const c = cn.replace(/（[^）]*）/g, '').trim();
        if (c === clean || c.includes(clean) || clean.includes(c)) { matchedName = cn; break; }
      }

      const rosterEntry = {};
      if (ch.grade) rosterEntry.grade = ch.grade;
      if (ch.className) rosterEntry.class = ch.className;
      if (ch.club) rosterEntry.club = ch.club;
      if (ch.role) rosterEntry.role = ch.role;

      const existing = region.character_roster[matchedName];
      if (!existing || Object.keys(existing).length < Object.keys(rosterEntry).length) {
        region.character_roster[matchedName] = rosterEntry;
        rosterFixed++;
      }
    }

    // Update clubs
    region.clubs = region.clubs || {};
    for (const [clubName, members] of Object.entries(data.clubs)) {
      if (!region.clubs[clubName]) region.clubs[clubName] = [];
      for (const m of members) {
        const clean = m.replace(/（[^）]*）/g, '').trim();
        let matched = clean;
        for (const k of Object.keys(region.character_roster||{})) {
          const ck = k.replace(/（[^）]*）/g, '').trim();
          if (ck === clean || ck.includes(clean) || clean.includes(ck)) { matched = k; break; }
        }
        if (!region.clubs[clubName].includes(matched)) {
          region.clubs[clubName].push(matched);
        }
      }
    }

    updated++;
  }

  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
  console.log('Updated', regFile);
}

console.log('Regions updated:', updated);
console.log('Roster entries fixed:', rosterFixed);
console.log('Done');
