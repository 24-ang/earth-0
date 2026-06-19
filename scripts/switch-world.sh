#!/usr/bin/env bash
# switch-world — 切换 earth-0 世界观
# 用法: ./scripts/switch-world.sh oregairu
#       ./scripts/switch-world.sh list

set -euo pipefail
cd "$(dirname "$0")/.."

WORLDPACKS_DIR="worldpacks"
DATA_DIR="data"

list_worlds() {
  echo "可用世界观:"
  for d in "$WORLDPACKS_DIR"/*/; do
    name=$(basename "$d")
    if [ -f "$d/README.md" ]; then
      echo "  $name"
    fi
  done
}

case "${1:-list}" in
  list)
    list_worlds
    echo ""
    echo "当前活跃: $(cat "$DATA_DIR/.active_world" 2>/dev/null || echo "未知")"
    ;;

  *)
    WORLD="$1"
    WORLD_DIR="$WORLDPACKS_DIR/$WORLD"
    if [ ! -d "$WORLD_DIR" ]; then
      echo "错误: 世界观 '$WORLD' 不存在"
      list_worlds
      exit 1
    fi

    echo "$WORLD" > "$DATA_DIR/.active_world"
    echo "✅ 已切换到: $WORLD"
    echo ""
    echo "data/ 目录结构:"
    echo "  data/characters.json   — 角色数据"
    echo "  data/timelines/$WORLD/ — 剧情时间线"
    echo "  data/calendar/$WORLD.json — 日历事件"
    echo "  data/lore/${WORLD}_world.json — 世界观设定"
    echo ""
    echo "提示: 引擎自动按 IP 名加载对应目录。无需手动迁移文件。"
    ;;
esac
