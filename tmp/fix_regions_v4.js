const fs = require('fs');
const path = require('path');

const ref = JSON.parse(fs.readFileSync(
  'C:/Users/Xiang/Documents/WeChat Files/wxid_tg72qh4lnphv12/FileStorage/File/2026-06/_🤖动漫角色目录  (2).json',
  'utf-8'
));

function norm(s) {
  return (s||'').replace(/[《》「」『』]/g, '').replace(/[！!？?]/g, '')
    .replace(/\(.*?\)/g, '').replace(/（.*?）/g, '').replace(/\*\*/g, '')
    .replace(/#/g, '').trim().toLowerCase();
}

const cnNum = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
function toDigit(s) { return cnNum[s] || Number(s) || s; }

// Parse grade from info string like "2年J班", "高中二年级", "2年级", "大学二年级", "初中1年级"
function parseGradeClass(info) {
  let grade = null, cls = null, role = null;
  if (!info) return { grade, cls, role };

  if (info.includes('教师') || info.includes('老师')) role = 'teacher';
  if (info.includes('大学生')) { grade = '大学'; }
  if (info.includes('小学生')) { grade = '小学'; }

  // "高中二年级" → 2
  let m = info.match(/高中([\d一二三四五六七八九]+)/);
  if (m) grade = toDigit(m[1]);
  // "大学二年级" → 大2
  m = info.match(/大学([\d一二三四五六七八九]+)/);
  if (m) grade = '大' + toDigit(m[1]);
  // "初中1年级" → 中1
  m = info.match(/初中([\d一二三四五六七八九]+)/);
  if (m) grade = '中' + toDigit(m[1]);
  // "高中生" → 高中
  if (info === '高中生') grade = '高中';

  // "2年J班" → grade 2, class J
  m = info.match(/^([\d一二三四五六七八九]+)年([\dA-Z]+)/);
  if (m) { grade = toDigit(m[1]); cls = m[2]; }

  return { grade, cls, role };
}

// Find the regions.json entry matching a reference entry
function findRegion(reg, refEntry) {
  const comment = refEntry.comment || '';
  const keys = refEntry.key || [];

  // Try comment first (most reliable)
  let n = norm(comment);
  let r = reg.find(x => norm(x.name) === n);
  if (r) return r;
  r = reg.find(x => (x.keys||[]).some(k => norm(k) === n));
  if (r) return r;

  // Try keys
  for (const k of keys) {
    n = norm(k);
    r = reg.find(x => norm(x.name) === n);
    if (r) return r;
    r = reg.find(x => (x.keys||[]).some(k2 => norm(k2) === n));
    if (r) return r;
  }

  // Fuzzy: comment contains or contained by region name
  n = norm(comment);
  r = reg.find(x => norm(x.name).includes(n) || n.includes(norm(x.name)));
  if (r) return r;
  for (const k of keys) {
    n = norm(k);
    r = reg.find(x => norm(x.name).includes(n) || n.includes(norm(x.name)));
    if (r) return r;
    r = reg.find(x => (x.keys||[]).some(k2 => norm(k2).includes(n) || n.includes(norm(k2))));
    if (r) return r;
  }
  return null;
}

// Parse one reference entry into roster entries
function parseRoster(content) {
  const lines = content.split('\n');
  const roster = []; // { name, grade, class, club, notes, role }
  let currentGrade = null, currentClass = null, currentRole = null;

  for (const line of lines) {
    const t = line.trim();
    if (!t) { currentRole = null; continue; }

    // === Grade headings ===
    // **■ 2年级**
    let m = t.match(/^\*\*■\s*(\d+)年级\*\*$/);
    if (m) { currentGrade = Number(m[1]); currentClass = null; currentRole = null; continue; }
    // **■ 2年J班** or **■ 一年C班** (grade + class combined)
    m = t.match(/^\*\*■\s*([\d一二三四五六七八九]+)年([\dA-Z]+)班?\*\*$/);
    if (m) { currentGrade = toDigit(m[1]); currentClass = m[2]; currentRole = null; continue; }
    // **2年J班** or **一年C班** (class heading)
    m = t.match(/^\*\*([\d一二三四五六七八九]+)年([\dA-Z]+)班?\*\*$/);
    if (m) { currentGrade = toDigit(m[1]); currentClass = m[2]; currentRole = null; continue; }
    // **■ 2年级**
    m = t.match(/^\*\*■\s*([\d一二三四五六七八九]+)年级\*\*$/);
    if (m) { currentGrade = toDigit(m[1]); currentClass = null; currentRole = null; continue; }

    // === Section headings ===
    if (t.match(/^#{1,4}\s*\*{0,2}.+?\*{0,2}\s*$/)) continue; // skip headings
    if (t.match(/^\*\*.+?\*\*\s*$/)) continue; // skip bold headings
    if (t.match(/^\*\*■\s*(教师|其他|社会人士|教职员)/)) { currentRole = 'teacher'; currentGrade = null; currentClass = null; continue; }
    if (t.match(/^(教师|其他|社会人士|教职员)[：:]/)) { currentRole = 'teacher'; currentGrade = null; currentClass = null; continue; }

    // === "教师：名字|..." lines ===
    m = t.match(/^(教师|其他|社会人士)[：:]\s*(.+)$/);
    if (m) {
      const rparts = m[2].split('|').map(p => p.trim());
      const rname = cleanName(rparts[0]);
      if (rname && rname.length > 1) {
        roster.push({ name: rname, grade: null, class: null, club: rparts.slice(1).join('; ') || null, notes: null, role: 'teacher' });
      }
      continue;
    }

    // === Roster lines: *  name | info... ===
    // Also handle class-prefixed: *  2年J班| name | info
    m = t.match(/^\*\s+(.+)$/);
    if (!m) continue;

    const rest = m[1];

    // Skip sub-headings inside * lines (with Chinese numeral support)
    let sm = rest.match(/^\*\*([\d一二三四五六七八九]+)年([\dA-Z]+)班?\*\*$/);
    if (sm) { currentGrade = toDigit(sm[1]); currentClass = sm[2]; currentRole = null; continue; }
    sm = rest.match(/^\*\*■\s*([\d一二三四五六七八九]+)年([\dA-Z]+)班?\*\*$/);
    if (sm) { currentGrade = toDigit(sm[1]); currentClass = sm[2]; currentRole = null; continue; }

    // Split by |
    const parts = rest.split('|').map(p => p.trim());

    // Check if first part is a class like "2年J班"
    let name, info = '', club = null;
    let lineGrade = currentGrade, lineClass = currentClass;
    if (/^\d+年[\dA-Z]+班?$/.test(parts[0])) {
      const cm = parts[0].match(/^(\d+)年([\dA-Z]+)班?$/);
      lineGrade = Number(cm[1]); lineClass = cm[2];
      name = cleanName(parts[1] || '');
      if (parts.length > 2) info = parts.slice(2).join('; ');
    } else {
      name = cleanName(parts[0]);
      if (parts.length > 1) info = parts.slice(1).join('; ');
    }

    if (!name || name.length < 2) continue;
    if (name.includes('■') || name.match(/^\d+年/)) continue;

    // Parse info for grade/class/club
    const gc = parseGradeClass(info);
    if (gc.grade) lineGrade = gc.grade;
    if (gc.cls) lineClass = gc.cls;
    if (gc.role) currentRole = gc.role;

    // Info that isn't grade/class is club or notes
    if (info.includes('部') || info.includes('会') || info.includes('社') || info.includes('委员')) {
      club = info;
    }

    roster.push({
      name,
      grade: currentRole ? null : lineGrade,
      class: currentRole ? null : lineClass,
      club,
      notes: (!club && info && info.length > 0) ? info : null,
      role: currentRole
    });
  }
  return roster;
}

function cleanName(s) {
  return (s||'').replace(/\*\*/g, '').replace(/^[-–—•·]\s*/, '')
    .replace(/（[^）]*）/g, '').replace(/\(.*?\)/g, '').trim();
}

// === Main ===
const regFiles = ['data/regions.json', 'worldpacks/oregairu/regions.json'];
let totalUpdated = 0, totalRoster = 0;

for (const regFile of regFiles) {
  const regPath = path.resolve(regFile);
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));

  for (const [rid, refEntry] of Object.entries(ref.entries)) {
    if (!refEntry.content) continue;
    if (refEntry.content.length < 20) continue;

    const region = findRegion(reg, refEntry);
    if (!region) continue;

    const roster = parseRoster(refEntry.content);
    if (roster.length === 0) continue;

    // Add new characters
    region.characters = region.characters || [];
    const existingNames = new Set((region.characters||[]).map(c => norm(c)));
    for (const ch of roster) {
      const cn = norm(ch.name);
      if (cn.length < 2) continue;
      if (!existingNames.has(cn)) {
        // Find closest match
        let best = null;
        for (const ec of (region.characters||[])) {
          if (norm(ec).includes(cn) || cn.includes(norm(ec))) { best = ec; break; }
        }
        if (!best) {
          region.characters.push(ch.name);
          existingNames.add(cn);
        }
      }
    }

    // Update roster
    region.character_roster = region.character_roster || {};
    for (const ch of roster) {
      const cn = norm(ch.name);
      // Find matching character name in region.characters
      let matchedName = ch.name;
      for (const ec of (region.characters||[])) {
        if (norm(ec) === cn || norm(ec).includes(cn) || cn.includes(norm(ec))) {
          matchedName = ec; break;
        }
      }

      const re = {};
      if (ch.grade !== null && ch.grade !== undefined) re.grade = ch.grade;
      if (ch.class !== null && ch.class !== undefined) re.class = ch.class;
      if (ch.club) re.club = ch.club;
      if (ch.role) re.role = ch.role;

      const existing = region.character_roster[matchedName];
      if (!existing || Object.keys(existing).length < Object.keys(re).length) {
        region.character_roster[matchedName] = re;
        totalRoster++;
      }
    }

    totalUpdated++;
  }

  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
  console.log('Updated', regFile);
}

console.log('Regions updated:', totalUpdated);
console.log('Roster entries:', totalRoster);
