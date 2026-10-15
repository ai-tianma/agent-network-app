# 客户端与主机共享 OpenCode Server（现状）

面向客户端开发者：这份说明回答「app 要不要处理主机共享 OpenCode Server」。结论是 **不用，也不应该**——客户端不发送任何共享 Server 参数，复用完全发生在 daemon 侧。本文只描述**当前事实**，不代替运行时的验收。

## 客户端实际发送什么

OpenCode 节点的创建选项只有两项与代际/授权有关（`src/opencode-create-options.ts`）：

- `opencodeGeneration`：显式 `v1` / `v2`，省略即 V1；
- `opencodeUnsafeTools`：V2 必须显式同意（高风险预览），否则拒绝创建。

`opencodeCreateFlags()` 只会产出 `{ opencodeGeneration: 'v2', opencodeUnsafeTools: true }`（V2）或 `{}`（V1）。**没有任何共享 Server 字段**：既不发送共享 Server 的 URL/密码文件，也不发送 `opencodeNewServer` 之类的开关。因此客户端 UI 不会、也不该提供「复用哪台共享 Server」的选择。

## 复用是 daemon 侧行为

同一台受信主机上的 V2 节点默认复用该主机已登记的、仅监听 `127.0.0.1` 的 OpenCode Server：daemon 读取主机用户的私有登记 `~/.anet/opencode-shared-server.json`，并把共享 Server 的 URL / 密码文件写进**子节点配置**。客户端在这条路径上只出现「代际 + 授权」，不参与 Server 选择。运行时的权威描述见 `agent-network` 仓的 `docs/runbooks/opencode-tui-copresence.md`。

## 当前状态（必须知道的边界）

截至 2026-10-15（`agent-network` main `5d316e19`）：

- **登记默认复用已生效**；
- 运行时的**准入守卫**（`opencode-server-reuse.ts`）与**进程观察提供者**（`opencode-host-shared-observer.ts`）**已入库**，但**创建路径尚未消费它们**（`#1302`），另有一片**代际绑定适配器**（`#1324`，Draft）待接线；
- ⇒ **当前必须把那份登记当作受信输入**：登记指向陈旧、已死或他人 uid 的 Server 时，子节点配置里仍会写入该 URL/密码文件。接线完成后才会变成「证得到才复用、证不到回退自建」。

## 客户端需要做什么

- **不要**在 app 里新增「共享 Server」输入项或复用开关（daemon 侧已决定；客户端加一套会分散真相来源）；
- 若 daemon 因共享 Server 自动建节点而失败/拒绝，客户端只需**原样展示 daemon 返回的错误**，不要改写为「请重试」或自动降级为 V1；
- 代际/授权校验保持在 `opencodeCreateError()`：这条是客户端唯一的 OpenCode 创建判据，不要因为共享 Server 的存在放宽它。

## 不声称

本文件不声称该能力已 npm 发布或在现役节点生效，也不声称创建路径已接好（`#1302` 未完成）。
