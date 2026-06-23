const fs = require('fs');
const path = require('path');

// Load reference and regions
const refRaw = fs.readFileSync(
  'C:/Users/Xiang/Documents/WeChat Files/wxid_tg72qh4lnphv12/FileStorage/File/2026-06/ 🤖动漫角色目录.json',
  'utf-8'
);
const ref = JSON.parse(refRaw);
const regPath = path.resolve('data/regions.json');
const reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));

// Parse roster lines from reference content
// Format: *   角色名 | 年级/班级 | 社团/备注
function parseRoster(content) {
  const lines = content.split('\n');
  const roster = [];
  for (const line of lines) {
    const match = line.match(/^\*\s+(.+?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/);
    if (!match) continue;
    const name = match[1].trim();
    const gradeClass = match[2].trim();
    const club = match[3].trim();

    // Parse grade/class
    let grade = null, className = null, role = null;
    if (gradeClass.includes('教师') || gradeClass.includes('老师')) {
      role = 'teacher';
    } else if (gradeClass.includes('大学生')) {
      grade = '大学';
    } else if (gradeClass.includes('小学生')) {
      grade = '小学';
    } else if (gradeClass.includes('初中')) {
      const m = gradeClass.match(/初中(\d)/);
      grade = m ? '中' + m[1] : '中学';
    } else if (gradeClass.includes('高中')) {
      const m = gradeClass.match(/高中(\d)/);
      grade = m ? m[1] : null;
    } else if (gradeClass.match(/(\d)年/)) {
      const m = gradeClass.match(/(\d)年/);
      grade = m[1];
    }

    // Parse class
    const classM = gradeClass.match(/(\d)年(\d|[A-Z])/);
    if (classM && classM[2] !== '级') {
      className = classM[2];
    }
    // Also try formats like "2年F组", "2年A班", "1年5班"
    const groupM = gradeClass.match(/(\d)年([A-Zａ-ｚＡ-Ｚ]|[0-9]+)(?:组|班)/);
    if (groupM) {
      grade = groupM[1];
      className = groupM[2];
    }

    roster.push({ name, grade, className, club: club || null, role: role || null });
  }
  return roster;
}

// Match reference entries to regions.json entries by IP name
let updated = 0;
let newChars = 0;

for (const [rid, refEntry] of Object.entries(ref.entries)) {
  const content = refEntry.content || '';
  const keys = refEntry.key || [];
  if (keys.length === 0) continue;
  if (!content.includes('|')) continue; // skip non-roster entries

  // Find matching region(s)
  const matchedRegions = reg.filter(r => {
    const rkeys = (r.keys || []).map(k => k.toLowerCase());
    return keys.some(k => rkeys.includes(k.toLowerCase()));
  });

  if (matchedRegions.length === 0) continue;

  const roster = parseRoster(content);
  if (roster.length === 0) continue;

  for (const region of matchedRegions) {
    // Build character_roster
    region.character_roster = region.character_roster || {};
    const existingChars = new Set((region.characters || []).map(c => c.replace(/（[^）]*）/g, '').trim()));
    let rosterChanged = false;

    for (const entry of roster) {
      // Find matching character name (fuzzy)
      let matchedName = null;
      const cleanName = entry.name.replace(/\(.*?\)/g, '').trim();

      // Try exact match first
      if (existingChars.has(cleanName) || existingChars.has(entry.name)) {
        matchedName = entry.name;
      } else {
        // Try partial match
        for (const cn of existingChars) {
          if (cn.includes(cleanName) || cleanName.includes(cn)) {
            matchedName = cn;
            break;
          }
        }
      }

      // If character is not in regions.json at all, add them
      if (!matchedName) {
        // Skip if it looks like a non-character entry
        if (cleanName.includes('高校') || cleanName.includes('中学') ||
            cleanName.includes('班') || cleanName.includes('年级') || cleanName.length < 2) continue;

        region.characters = region.characters || [];
        if (!region.characters.includes(cleanName)) {
          region.characters.push(cleanName);
          newChars++;
          matchedName = cleanName;
        }
      }

      if (matchedName) {
        const rosterEntry = {};
        if (entry.grade) rosterEntry.grade = Number(entry.grade) || entry.grade;
        if (entry.className) rosterEntry.class = entry.className;
        if (entry.role) rosterEntry.role = entry.role;
        if (entry.club) rosterEntry.club = entry.club;

        // Only update if we have new info
        const existing = region.character_roster[matchedName];
        if (!existing || Object.keys(existing).length < Object.keys(rosterEntry).length) {
          region.character_roster[matchedName] = rosterEntry;
          rosterChanged = true;
        }
      }
    }

    // Update clubs from roster
    if (rosterChanged) {
      region.clubs = region.clubs || {};
      for (const entry of roster) {
        if (entry.club) {
          const clubName = entry.club;
          if (!region.clubs[clubName]) region.clubs[clubName] = [];
          const cleanName = entry.name.replace(/\(.*?\)/g, '').trim();
          // Find the matched character name in roster
          let cn = cleanName;
          for (const k of Object.keys(region.character_roster || {})) {
            if (k.includes(cleanName) || cleanName.includes(k)) { cn = k; break; }
          }
          if (!region.clubs[clubName].includes(cn)) {
            region.clubs[clubName].push(cn);
          }
        }
      }
      updated++;
    }
  }
}

fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
console.log('Updated', updated, 'regions with roster data');
console.log('Added', newChars, 'new characters to regions');
console.log('Done');
