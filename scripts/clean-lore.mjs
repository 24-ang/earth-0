#!/usr/bin/env node
// Strip lore files of structural data already in regions.json
// Keep: character personality/background descriptions, atmosphere, relationships
// Remove: class headers, bare name lists, grade info

import fs from 'node:fs';

const regions = JSON.parse(fs.readFileSync('data/regions.json', 'utf-8'));
const allRegionChars = new Set(regions.flatMap(r => r.characters));

// Patterns to strip
const STRIP_PATTERNS = [
  /^[\*\-]\s*\d+年[A-Z0-9]?[班组]?\s*$/,  // class header: *   2年J班
  /^[\*\-]\s*[一二三四五六七八九]+年[A-Z0-9]?[班组]?\s*$/, // Chinese numeral class header
  /^■\s+.*$/,  // section header
  /^[\*\-]\s*\S{1,3}\s*$/,  // bare name or label (1-3 chars) like 长女, 次男
  /^---\s*$/,   // separator
];

function isClassHeader(line) {
  return /^\*?\s*\d+年[A-Z0-9][班组]?\s*$/.test(line)
    || /^\*?\s*[一二三四五六七八九]+年[A-Z0-9]?[班组]?\s*[:：]?\s*$/.test(line)
    || /^\*?\s*(?:高中|初中)?\s*\d+年[A-Z0-9][班组]?\s*$/.test(line)
    || /^\*?\s*(?:高中|初中)?\s*[一二三四五六七八九]+年[A-Z0-9]?[班组]?\s*$/.test(line);
}

function isYearHeader(line) {
  return /^■\s*(?:\d+|[一二三四五六七八九]+)年级/.test(line)
    || /^■\s*(?:高中|初中)/.test(line)
    || /^■\s*(?:大学|社会)/.test(line);
}

function isClubOrGrade(s) {
  return /^(?:高中|初中|大学)?\s*\d+年[A-Z0-9]?[班组]?\s*$/.test(s)
    || /^[一二三四五六七八九]+年[A-Z0-9]?[班组]?\s*$/.test(s)
    || /^\d+年级$/.test(s);
}

function cleanLoreText(text) {
  const lines = text.split('\n');
  const result = [];
  let keptSomething = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) { result.push(''); continue; }

    // Skip class/year headers
    if (isClassHeader(t) || isYearHeader(t)) continue;

    // Skip separator lines
    if (t === '---' || t === '...') continue;

    // Process lines with |
    const pi = line.indexOf('|');
    if (pi >= 0) {
      let name = line.substring(0, pi).replace(/^[\s\*\-]+/, '').trim();
      // Remove parenthetical readings
      name = name.replace(/\(.*?\)/g, '').replace(/（.*?）/g, '').trim();

      const after = line.substring(pi + 1);
      const parts = after.split('|').map(s => s.trim()).filter(Boolean);

      // Filter out grade/class info from description
      const cleanParts = parts.filter(p => !isClubOrGrade(p.trim()));

      if (cleanParts.length > 0) {
        const desc = cleanParts.join(' | ');
        // If name is in regions, just keep the description (name already known)
        if (allRegionChars.has(name) || name.length > 10) {
          result.push(`*   ${name}: ${desc}`);
        } else {
          result.push(`*   ${name}: ${desc}`);
        }
        keptSomething = true;
      } else {
        // All parts were grade/club info → keep just the name if not in regions
        // Otherwise skip (already known from regions)
        if (!allRegionChars.has(name)) {
          result.push(`*   ${name}`);
          keptSomething = true;
        }
      }
      continue;
    }

    // Lines without | — keep if they have narrative content
    // Skip bare name lines (names already in regions)
    const nm = t.match(/^[\*\-]\s+(.+)$/);
    if (nm) {
      const name = nm[1].trim().replace(/\(.*?\)/g, '').replace(/（.*?）/g, '');
      if (!allRegionChars.has(name) && name.length > 3 && !/^(长女|次女|三女|四女|五女|长男|次男|三男)$/.test(name)) {
        result.push(line);
        keptSomething = true;
      }
      continue;
    }

    // Keep narrative lines (location descriptions, atmosphere, etc.)
    if (t.length > 5) {
      result.push(line);
      keptSomething = true;
    }
  }

  // Remove trailing empty lines
  while (result.length > 0 && !result[result.length - 1]) result.pop();
  while (result.length > 0 && !result[0]) result.shift();

  return keptSomething ? result.join('\n') : '';
}

// Process all lore files
const loreDir = 'data/lore';
const files = fs.readdirSync(loreDir).filter(f => f.endsWith('.json'));
let stripped = 0, removed = 0, kept = 0;

for (const f of files) {
  const lore = JSON.parse(fs.readFileSync(loreDir + '/' + f, 'utf-8'));
  const newLore = {};
  let entryRemoved = 0, entryKept = 0;

  for (const [title, entry] of Object.entries(lore)) {
    const original = entry.text || '';
    const cleaned = cleanLoreText(original);

    if (cleaned && cleaned.length > 10) {
      newLore[title] = {
        text: cleaned,
        tags: entry.tags || []
      };
      entryKept++;
      if (cleaned.length < original.length * 0.5) stripped++;
    } else {
      entryRemoved++;
    }
  }

  if (Object.keys(newLore).length > 0) {
    fs.writeFileSync(loreDir + '/' + f, JSON.stringify(newLore, null, 2), 'utf-8');
    kept += entryKept;
    removed += entryRemoved;
    if (entryRemoved > 0) console.log(f + ': kept=' + entryKept + ' removed=' + entryRemoved);
  } else {
    // Empty file — delete it
    fs.unlinkSync(loreDir + '/' + f);
    console.log(f + ': DELETED (all entries stripped)');
    removed++;
  }
}

console.log('');
console.log('Entries kept: ' + kept + ', removed: ' + removed + ', stripped: ' + stripped);
console.log('Files remaining: ' + fs.readdirSync(loreDir).filter(f => f.endsWith('.json')).length);
