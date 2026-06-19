#!/usr/bin/env python3
"""ST 世界书 → earth-0 data/ 转换脚本
用法: python scripts/worldbook-to-data.py <世界书.json> --ip oregairu --out /tmp/earth-output
"""

import json, sys, os, re, argparse

# ── 参数 ──
parser = argparse.ArgumentParser(description="ST worldbook → earth-0 data/")
parser.add_argument("input", help="ST 世界书 JSON 文件")
parser.add_argument("--ip", default="oregairu", help="目标 IP 标识")
parser.add_argument("--out", default="/tmp/earth-output", help="输出目录")
args = parser.parse_args()

os.makedirs(args.out, exist_ok=True)

with open(args.input, "r", encoding="utf-8") as f:
    wb = json.load(f)

entries = wb.get("entries", {})
print(f"加载世界书: {len(entries)} 条")

# ── 识别目标 IP ──
IP_PATTERNS = {
    "oregairu": ["春物", "やはり俺の青春", "总武高", "雪之下", "雪乃", "由比滨", "结衣", "比企谷", "八幡", "平冢静", "一色彩羽", "材木座", "户冢", "叶山", "三浦", "海老名", "城廻巡", "川崎", "相模"],
}

target_kw = [x.lower() for x in IP_PATTERNS.get(args.ip, [])]

def is_target(entry):
    keys = [x.lower() for x in entry.get("key", [])]
    content = entry.get("content", "")[:300].lower()
    combined = " ".join(keys) + " " + content
    return any(kw in combined for kw in target_kw)

target_entries = {k: v for k, v in entries.items() if is_target(v)}
print(f"匹配 {args.ip}: {len(target_entries)} 条")

# ── 提取角色 ──
characters = []
char_names_seen = set()

# 匹配模式: *   角色名 | 信息
CHAR_PATTERN = re.compile(r'^\*?\s*[\*■]*\s*(.+?)\s*(?:\||\s*—\s*|\s*$|\s*\|)', re.MULTILINE)

for k, v in target_entries.items():
    content = v.get("content", "")
    lines = content.split("\n")
    for line in lines:
        line = line.strip()
        if not line or len(line) < 3:
            continue
        # 跳过标题行
        if line.startswith("#") or line.startswith("**") and line.endswith("**"):
            continue
        # 尝试匹配角色行: * 角色名 | 班级|备注
        m = CHAR_PATTERN.match(line)
        if m:
            name = m.group(1).strip()
            # 过滤明显不是角色名的
            if len(name) > 20 or len(name) < 1:
                continue
            if any(kw in name for kw in ["教室", "■", "**", "##"]):
                continue
            if re.match(r'^\d+年[A-Z]班', name):
                continue
            if "班" in name and len(name) <= 5:
                continue
            if name in char_names_seen:
                continue
            # 提取班级信息
            grade_info = ""
            rest = line[m.end():].strip()
            if rest:
                grade_info = rest[:40]

            char_names_seen.add(name)
            characters.append({
                "name": name,
                "source": args.ip,
                "gender": "未知",
                "appearance_brief": "",
                "tags": [],
                "grade_info": grade_info,
            })

print(f"提取角色: {len(characters)} 个")

# ── 提取世界观/lore ──
lore = {}
lore_count = 0
for k, v in target_entries.items():
    content = v.get("content", "").strip()
    keys = v.get("key", [])
    if not content:
        continue

    # 跳过纯角色列表（行数多但无描述）
    lines = [l for l in content.split("\n") if l.strip()]
    descriptive_lines = [l for l in lines if not CHAR_PATTERN.match(l.strip()) and not l.strip().startswith("#") and not l.strip().startswith("*")]

    if len(descriptive_lines) >= 2:
        key_name = keys[0] if keys else f"entry_{k}"
        # 清理 key
        key_id = re.sub(r'[^\w]', '_', key_name)[:40].lower().strip("_")
        if key_id and key_id not in lore:
            lore[key_id] = content[:500]
            lore_count += 1

print(f"提取 lore: {lore_count} 条")

# ── 输出 ──
# characters.json (仅输出新角色，不覆盖现有)
char_out = os.path.join(args.out, "characters_extracted.json")
with open(char_out, "w", encoding="utf-8") as f:
    json.dump(characters, f, ensure_ascii=False, indent=2)
print(f"→ {char_out}")

# lore.json
lore_out = os.path.join(args.out, f"{args.ip}_lore.json")
with open(lore_out, "w", encoding="utf-8") as f:
    json.dump(lore, f, ensure_ascii=False, indent=2)
print(f"→ {lore_out}")

print(f"\nDone. Check {args.out}/ for output files. Merge into data/ manually after review.")
