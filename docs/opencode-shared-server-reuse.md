# 客户端与主机共享 OpenCode Server（现状）

> **范围（限定）**：本文描述的是 **`agent-network` main 源码层已实现的事实**（本文写作时 main = `41950777c064357448d990b1fea39ee09cb80bf4`，即 PR #2789 的合入提交）。它**不**代表这些能力已 npm 发布，也**不**代表现役节点已生效。请把四件事分开读：
>
> | | 状态 |
> |---|---|
> | daemon 创建路径的**源码接线** | **已合入** `agent-network` main（`41950777`，PR #2789） |
> | **完整原生启动验收**（`#1327` / PR #2790）与父需求 `#1302` | **已通过 / 已完成**（收据见下） |
> | **npm 发布 / 部署** | 不声称（本文件只描述源码层） |
> | **CLI 直连 / 显式连接入口** | 需要**它自己的**验收，不由本文覆盖 |
>
> 原生验收收据（**绑定到 exact head**）：PR #2790 head `506902c4` 的 Actions run `38809788212` / job `116679815373`，产物里 `source=506902c43494…`，**54 条 PASS** —— 含「B/C 真借用 A」「close B 不杀 A、C 仍回话」「B/C 身份互异」「explicit new-server 换监听者」「dead candidate 回退」；该 PR 合并提交 `079daa31`。

面向客户端开发者：这份说明回答「app 要不要处理主机共享 OpenCode Server」。结论是 **不用，也不应该**——客户端不发送任何共享 Server 参数，复用完全发生在 daemon 侧。本文只描述**当前事实**，不代替运行时的验收。

## 客户端实际发送什么

OpenCode 节点的创建选项只有两项与代际/授权有关（`src/opencode-create-options.ts`）：

- `opencodeGeneration`：显式 `v1` / `v2`，省略即 V1；
- `opencodeUnsafeTools`：V2 必须显式同意（高风险预览），否则拒绝创建。

`opencodeCreateFlags()` 只会产出 `{ opencodeGeneration: 'v2', opencodeUnsafeTools: true }`（V2）或 `{}`（V1）。**没有任何共享 Server 字段**：既不发送共享 Server 的 URL/密码文件，也不发送 `opencodeNewServer` 之类的开关。因此客户端 UI 不会、也不该提供「复用哪台共享 Server」的选择。

## 复用是 daemon 侧行为

同一台受信主机上的 V2 节点默认复用该主机已登记的、仅监听 `127.0.0.1` 的 OpenCode Server：daemon 读取主机用户的私有登记 `~/.anet/opencode-shared-server.json`，并把共享 Server 的 URL / 密码文件写进**子节点配置**。客户端在这条路径上只出现「代际 + 授权」，不参与 Server 选择。运行时的权威描述见 `agent-network` 仓的运行手册 [opencode-tui-copresence](https://github.com/sleep2agi/agent-network/blob/main/docs/runbooks/opencode-tui-copresence.md)（跨仓引用，指向运行时仓 main）。

## 当前状态（必须知道的边界）

截至 2026-10-16（`agent-network` main `41950777c064357448d990b1fea39ee09cb80bf4`，PR #2789 的接线合入提交）：

- **登记是操作者维护的连接候选**（不提供进程身份或代际证明），daemon 创建 V2 节点时按「**观察 → 代际绑定 → 准入通过**」判定，**三步都过才复用**；任何拒绝（登记陈旧、进程已死、他人 uid、无法完整观察、代际不可证）都**回退为节点自有 Server**，不写共享 URL/密码文件；
- **客户端仍然不参与这件事**：不发共享 Server 字段、不提供「选哪台共享 Server」的输入；daemon 拒绝时**原样展示其错误**（不自动重试、不静默降级 V1）。

## 客户端需要做什么

- **不要**在 app 里新增「共享 Server」输入项或复用开关（daemon 侧已决定；客户端加一套会分散真相来源）；
- 若 daemon 因共享 Server 自动建节点而失败/拒绝，客户端只需**原样展示 daemon 返回的错误**，不要改写为「请重试」或自动降级为 V1；
- 代际/授权校验保持在 `opencodeCreateError()`：这条是客户端唯一的 OpenCode 创建判据，不要因为共享 Server 的存在放宽它；
- **保留现有的「错误升级提示」行为**：当 Hub/daemon 返回 `flag_key_unknown`（`opencodeGeneration` / `opencodeUnsafeTools`）时，`describeOpenCodeCreateError()` 给出的「目标 Hub 或 daemon 不支持 V2 创建协议，请先升级到已验收的兼容版本」**必须原样保留** —— 不要因为共享 Server 的引入把它改成自动重试或自动降级为 V1。

## 不声称

**源码层**：daemon 创建路径的接线已合入 `agent-network` main（`41950777`，PR #2789）；**完整原生启动验收已通过**（`#1327` / PR #2790，合并提交 `079daa31`；exact-head 收据 run `38809788212` / job `116679815373`），父需求 `#1302` 已完成。本文仍**不**声称该能力已 npm 发布或在现役节点生效，且 **CLI 的直连 / 显式连接入口需要它自己的验收**（与本文描述的 daemon 默认复用路径是两件事）。范围见文首限定（main 源码层）。
