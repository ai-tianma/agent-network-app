# 发版耗时复跑脚本（release-timeline.mjs）

`scripts/release-timeline.mjs` 从 GitHub API 取最近 N 个 release 的关键时间点，算出各段耗时与分布，输出一张可以直接贴进看板的 markdown 表。**只读**：只用 GET，不建/改 release，不碰 workflow，不发版。

## 用法

```bash
# 需要一个能读公开仓的 token：GITHUB_TOKEN 环境变量，或先 `gh auth login`
export GITHUB_TOKEN=ghp_xxx
node scripts/release-timeline.mjs --repo sleep2agi/agent-network-app --n 20
node scripts/release-timeline.mjs --repo sleep2agi/agent-network --n 10 --json
node scripts/release-timeline.mjs --repo sleep2agi/agent-network-app --n 20 --out /tmp/timeline.md
```

## 口径

| 段 | 怎么算 |
|---|---|
| 等派发 | release workflow run 的 `created_at` − 它之前最后一个已合并 PR 的 `merged_at` |
| 排队 | `run_started_at` − `run.created_at` |
| 构建 | `max(asset.created_at)` − `run.run_started_at` |
| 发布 | `published_at` − `release.created_at` |
| 端到端 | `published_at` − 最后一个已合并 PR 的 `merged_at` |

草稿（`draft`，或没有 `published_at`）的端到端算 **∞**，另报「release 对象 → 产物」延迟 —— 半成品版本不该被算进发布时长里。

同一个 tag 出现多个 release 对象时逐行列出并标 `duplicate`。

## 它**不能**算什么

- run 保留期之外的老 release：只能算「对象 → 产物」这一段，不是端到端；
- `@sleep2agi/agent-network` 的 **npm** release 没有对应的 workflow run，脚本给不出上面四段 —— 那条线要看 npm registry 的 `time`；
- 移动端（安卓 / TestFlight）不在 GitHub release 这条路径上，脚本看不到它们的耗时。

## 为什么有这个脚本

2026-10-21 的发版复盘里，「ANet 迭代发版为什么慢」曾经只有一份 PPT。数字会变（草稿残留、同 tag 重复、僵尸构建都会动），所以把它变成**任何人都能自己复跑**的一段，而不是只存在某个人电脑里的结论。

配套：每周三 09:30（Asia/Shanghai）会自动跑一次旧未合 PR 清单（看板卡 #495），结论落在卡上。
