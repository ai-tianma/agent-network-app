# 文档索引

按用途分组，每份一句话说明。截图与验收证据放在 `screens/`、`screenshots/`、`ui-eval-2026-06-29/` 与 `tests/` 目录。

## 发布与验收

- [desktop-release-sop.md](desktop-release-sop.md) —— Tauri 桌面端（macOS / Windows / Ubuntu 24.04 amd64）的构建、验收、签名与发布门；签名发布只走 CI。
- [ios-release-runbook.md](ios-release-runbook.md) —— 不用 Xcode GUI 的 iOS 发布流程，区分 GitHub-hosted 与自建/SSH Mac 两条钥匙串路径。
- [release-0.2.136.md](release-0.2.136.md) —— 0.2.136 版本更新说明。
- [prelogin-update.md](prelogin-update.md) —— 登录前可用的软件更新入口（#1018）：首启与登录页都能检查更新，无需 Hub 地址或账号。

## Hub 与 Daemon 对接

- [local-workspace.md](local-workspace.md) —— 内置 CommHub「本地工作区」的生命周期与数据：绑定 127.0.0.1、凭据写入系统凭据库、数据目录与备份。
- [hub-provider-client.md](hub-provider-client.md) —— Hub 级 Provider 配置页（`HubProviderManagementScreen`）的真实数据接入，按 Hub 地址 / 网络 / 登录用户隔离。
- [hub-token-management.md](hub-token-management.md) —— 当前网络的 API 密钥库管理（不是 Hub 登录态 / 节点身份令牌）。
- [daemon-provider-collection-client.md](daemon-provider-collection-client.md) —— 收编机器上已有的 Codex API-key 配置（#906）的客户端流程。
- [daemon-provider-create-client.md](daemon-provider-create-client.md) —— 用 Daemon 托管 Provider 新建 Codex 节点（#906）的向导两种模式。
- [node-provider-switch.md](node-provider-switch.md) —— 节点详情页切换 Provider（#906），复用 daemon Provider 目录与回执。
- [daemon-cli-download-fallback.md](daemon-cli-download-fallback.md) —— npm 拉不到钉住的 CLI 版本时的公共副本兜底下载（#906）。
- [opencode-shared-server-reuse.md](opencode-shared-server-reuse.md) —— 客户端与「主机共享 OpenCode Server」的边界：客户端不发任何共享 Server 字段，复用是 daemon 侧行为（#1293）。

## 客户端设计与规范

- [客户端技术方案.md](客户端技术方案.md) —— 一份 TypeScript 代码覆盖 Android / iOS / Mac / Windows / Web 的总体技术方案。
- [RFC-026-mobile-picker-design.md](RFC-026-mobile-picker-design.md) —— 移动端 host supervisor 三态选择器设计稿（RFC-026 §9.4）。
- [app-vs-web-parity-checklist.md](app-vs-web-parity-checklist.md) —— 移动端与 Web Dashboard 的功能对齐清单。
- [i18n.md](i18n.md) —— 界面多语言约定：`useTranslation()` 的订阅与不重挂载规则。
- [android-notifications.md](android-notifications.md) —— Android 本地通知（phase 1，无厂商推送）的实现与设备前提。
