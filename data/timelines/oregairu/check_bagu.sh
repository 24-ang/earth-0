#!/usr/bin/env bash
# 八股文检测脚本 — 基于 De-AI-Prompt-Enhancer 24项AI痕迹检测体系
# 用法: bash check_bagu.sh [目录路径]

DIR="${1:-.}"
cd "$DIR" || exit 1

RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

total_hits=0

check() {
  local label="$1"
  local pattern="$2"
  local severity="$3"  # HIGH / MED
  echo ""
  echo "━━━ [$severity] $label ━━━"
  while IFS= read -r line; do
    file=$(echo "$line" | cut -d: -f1)
    lineno=$(echo "$line" | cut -d: -f2)
    text=$(echo "$line" | cut -d: -f3-)
    # Skip non-JSON, skip .bak
    [[ "$file" != *.json ]] && continue
    [[ "$file" == *.bak ]] && continue
    # Extract matched portion
    matched=$(echo "$text" | grep -oE "$pattern" | head -3 | tr '\n' '|')
    if [ "$severity" = "HIGH" ]; then
      printf "${RED}  %s:%s${NC} → %s\n" "$file" "$lineno" "${matched:0:100}"
    else
      printf "${YELLOW}  %s:%s${NC} → %s\n" "$file" "$lineno" "${matched:0:100}"
    fi
    ((total_hits++))
  done < <(grep -En "$pattern" *.json 2>/dev/null)
}

echo "=========================================="
echo " 八股文检测 — earth-0 timeline 文件"
echo " $(date)"
echo "=========================================="

# ═══ HIGH: 二分对照壳 ═══
check "9.1 否后肯「不是X而是Y」" '(不是|并非|不在于|不是因为)[^。]{0,40}(而是|是|在于|而是因为)' "HIGH"

# ═══ HIGH: 后置解释「就像/仿佛/如同」 ═══
check "9.3.3 后置解释「就像/仿佛/好像/如同」" '(就像|仿佛|如同|一如|好像)[^。]{0,40}(一样|似的|般)' "HIGH"

# ═══ HIGH: 戏剧化揭露 ═══
check "7.4 戏剧化揭露「遮羞布/面具/画皮/伪装/外衣」" '(遮羞布|面具|画皮|伪装|外衣|皇帝的新衣|幌子|烟幕弹|扯下|撕下|剥开|戳穿)' "HIGH"

# ═══ HIGH: 后置解释「——」+ 解释性后缀 ═══
check "DS后置解释「——然后/这个/就像/不是/因为」" '(——(然后|这个|就像|不是|因为|这是|那|你|她|它|这正|这也|这才|这一|这么|这说明))' "HIGH"

# ═══ HIGH: DS式数量夸张「上百次/无数次/数不清/重复了/这个流程」 ═══
check "DS夸张「上百次/无数次/数不清/这个流程/重复了X次」" '(上百次|无数次|数不清|这个流程.{0,10}重复|重复了.{0,10}(次|遍))' "HIGH"

# ═══ HIGH: 鸡汤收尾 ═══
check "24 鸡汤收尾「未来可期/拭目以待/光明前景」" '(未来可期|拭目以待|光明前景|我们有理由相信|这只是开始|新的篇章)' "HIGH"

# ═══ MED: 关联句式堆叠 ═══
check "7.3 关联句堆叠「一旦…就/只要…就/随着…/通过…来」" '(一旦.{0,20}就|只要.{0,20}就|只有.{0,20}才|无论.{0,20}都|随着.{0,15}的.{0,10}(发展|深入|推进)|通过.{0,15}来)' "MED"

# ═══ MED: 填充短语 ═══
check "22 填充短语「总的来说/换句话说/简而言之」" '(总的来说|换句话说|简而言之|需要指出的是|值得注意的是|不可否认|毋庸置疑|在此背景下|与此同时)' "MED"

# ═══ MED: AI伪口语 ═══
check "7.1 AI伪口语「说白了/本质上/归根结底/拆解/梳理/剖析」" '(说白了|本质上|归根结底|简单来说|换个角度看|拆解|梳理|剖析|解构|聚焦|洞察|深耕|赋能|助力|践行|驱动|构建|打造)' "MED"

# ═══ MED: 协作交流痕迹 ═══
check "19 协作痕迹「让我们/接下来我们将/本文将」" '(让我们|接下来我们将|本文将|希望这能帮助你|下面我会|接下来我)' "MED"

# ═══ MED: 过度限定词堆叠 ═══
check "23 过度限定「某种程度上/可能/或许/似乎」" '(某种程度上|相对而言|在一定程度上|从某种意义)' "MED"

# ═══ MED: 极值判断 ═══
check "7.5 极值判断「最X的地方在于/真正可怕的是」" '(最.{0,5}的地方在于|真正.{0,5}的是|更.{0,5}的是|残酷.{0,5}在于)' "MED"

# ═══ LOW: 破折号机械使用 ═══
dash_count=$(grep -c '——' *.json 2>/dev/null | grep -v '.bak' | awk -F: '{s+=$2} END {print s}')
echo ""
echo "━━━ [INFO] 破折号(——)总数: $dash_count ━━━"

echo ""
echo "=========================================="
echo " 总计命中: $total_hits"
if [ $total_hits -eq 0 ]; then
  echo " ✅ 未检测到八股文模式"
elif [ $total_hits -le 5 ]; then
  echo " ⚠️ 少量命中，建议复查"
else
  echo " 🔴 命中较多，需要清理"
fi
echo "=========================================="
