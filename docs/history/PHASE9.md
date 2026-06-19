# Phase 9: 双重渲染（双模型分离）

## 一句话说清楚

让 LLM 专心当 GM 写文字。数学（扣钱/骰子/好感）交给引擎算，这个 earth-0 **已经做到了**。

Phase 9 只做一件事：**用两个不同的 AI 模型**：
- 一个算账（便宜、准确、冷血）
- 一个写文字（贵、好看、文采好）

## fate-sandbox 怎么做的

它就是 pi 项目，跟 earth-0 同平台。它的 `start.sh` 里有这行：

```bash
FATE_RENDER_MODEL=provider/model-id ./start.sh
```

pi 支持 `--model` 参数指定主模型。如果 pi 也支持**渲染专用模型**，那 start.sh 改成：

```bash
pi \
  --model deepseek-v4-pro \        # 结算用 DS（便宜，算账准）
  --render-model claude-opus-4-8 \ # 渲染用 Claude（贵，文笔好）
  --no-skills \
  --skill ./skills/ \
  -e ./extension.ts \
  --session-dir ./sessions \
  "$@"
```

结算轮：DS 跑工具、改状态、出"结果包"。
渲染轮：Claude 读结果包、写叙事文字。
玩家只看到 Claude 的文字，看不到 DS 在里面算账。

## 问手机的 pi 这些问题

直接复制发给 pi：

> 1. pi 支持 `--render-model` 参数吗？或者类似的双模型分离机制？
> 2. fate-sandbox 用的 `FATE_RENDER_MODEL` 环境变量在任意 pi 项目都能用，还是需要 fate-sandbox 的代码支持？
> 3. 如果 pi 不支持双模型，有没有计划做？或者在 extension.ts 里能不能自己实现"一个工具调用同时启动第二个 agent loop"？
> 4. 最低要求：主模型负责一切（现在就是这样），如果能多传一个模型名给 pi 做渲染就更好。

## 预期结果

如果 pi 支持，改 earth-0 的 `start.sh` 加一行参数即可，不用改代码。
如果不支持，那就等 pi 升级，这事不急——现在单模型完全能玩。
