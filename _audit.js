const fs = require('fs');
const path = require('path');

function getAllFiles(dir) {
  const results = [];
  const list = fs.readdirSync(dir);
  for (const f of list) {
    const fp = path.join(dir, f);
    const stat = fs.statSync(fp);
    if (stat.isDirectory()) results.push(...getAllFiles(fp));
    else if (f.endsWith('.ts') && !fp.includes('registry.ts') && !fp.includes('helpers.ts')) results.push(fp);
  }
  return results;
}

function countChinese(s) {
  const matches = s.match(/[一-鿿㐀-䶿豈-﫿]/g);
  return matches ? matches.length : 0;
}

const files = getAllFiles('tools');
const toolOver25 = [];
const paramOver25 = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const hasExportDefault = content.includes('export default');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/description:\s*"([^"]*)"/);
    if (m) {
      const cn = countChinese(m[1]);
      if (cn > 25) {
        const rel = path.relative('tools', file).replace(/\\/g, '/');
        const isTool = hasExportDefault && i < 10;
        const entry = rel + ':' + (i + 1) + ' (' + cn + ' cn): ' + m[1];
        if (isTool) toolOver25.push(entry);
        else paramOver25.push('  [param] ' + entry);
      }
    }
  }
}

console.log('=== TOOL-level descriptions > 25 cn ===');
console.log('(' + toolOver25.length + ' found)');
toolOver25.forEach(l => console.log(l));
console.log('');
console.log('=== PARAMETER-level descriptions > 25 cn ===');
console.log('(' + paramOver25.length + ' found)');
paramOver25.forEach(l => console.log(l));
