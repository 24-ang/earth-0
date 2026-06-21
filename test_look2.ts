import fs from "node:fs";

const code = fs.readFileSync("extension.ts", "utf-8");

function findMatchingClosing(code: string, startIndex: number) {
  let depth = 0;
  let inString: string | null = null;
  let inComment: string | null = null;
  let escape = false;

  for (let i = startIndex; i < code.length; i++) {
    const char = code[i];
    const next = code[i + 1];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (char === '\\') {
        escape = true;
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (inComment === 'line') {
      if (char === '\n') {
        inComment = null;
      }
      continue;
    }

    if (inComment === 'block') {
      if (char === '*' && next === '/') {
        inComment = null;
        i++;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inComment = 'line';
      i++;
      continue;
    }

    if (char === '/' && next === '*') {
      inComment = 'block';
      i++;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = char;
      continue;
    }

    if (char === '(' || char === '{' || char === '[') {
      depth++;
      continue;
    }

    if (char === ')' || char === '}' || char === ']') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
      continue;
    }
  }
  return -1;
}

// Find all tools
const tools: { name: string, start: number, end: number }[] = [];
let toolIdx = 0;
while (true) {
  toolIdx = code.indexOf("pi.registerTool(", toolIdx);
  if (toolIdx === -1) break;
  const startBrace = code.indexOf("{", toolIdx);
  const endBrace = findMatchingClosing(code, startBrace);
  const block = code.slice(startBrace, endBrace);
  
  // Extract name
  const nameMatch = block.match(/name:\s*["']([^"']+)["']/);
  const name = nameMatch ? nameMatch[1] : "unknown";
  tools.push({ name, start: startBrace, end: endBrace });
  toolIdx = endBrace;
}

// Find all commands
const commands: { name: string, start: number, end: number }[] = [];
let cmdIdx = 0;
while (true) {
  cmdIdx = code.indexOf("pi.registerCommand(", cmdIdx);
  if (cmdIdx === -1) break;
  
  const firstQuote = code.indexOf('"', cmdIdx);
  const secondQuote = code.indexOf('"', firstQuote + 1);
  const name = code.slice(firstQuote + 1, secondQuote);
  
  const startBrace = code.indexOf("{", secondQuote);
  const endBrace = findMatchingClosing(code, startBrace);
  commands.push({ name, start: startBrace, end: endBrace });
  cmdIdx = endBrace;
}

console.log("Tools count:", tools.length);
console.log("Tools names:", tools.map(t => t.name));
console.log("\nCommands count:", commands.length);
console.log("Commands names:", commands.map(c => c.name));
