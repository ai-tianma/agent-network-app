// 私聊发不出去（跨网络）——纯状态与纯函数,无 react-native、无 fetch。
//
// 现象（admin 2026-10-21 截图 + hub 拒绝日志）：
//   [15:55:54] tang → /api/task → tang02: REJECTED 404 alias_not_found (net=net_ac567b4ab74e)
// 客户端只显示「没有找到这个 Agent（网络可能已变更）」+「未送达 · 点击重试」。
//
// 根因（不是网络抖、不是 Agent 没了）：
//   * 客户端的 Agent 列表走 `GET /api/status?light=1`,**不带 network_id** —— hub 按
//     「我属于哪些网络」返回,于是列表里同时有默认网络(net_399bdf86f528)的 tang02/03/04
//     和用户自己那个个人网络(net_ac567b4ab74e)的 Agent。
//   * 但发送走 `POST /api/task`,带的是 **cfg.networkId** —— 登录时由
//     pickDefaultNetworkId 选一次并落盘；对 tang 来说两个网络的 agent_access 都是
//     'all'(他是个人网络 owner、默认网络 admin),于是 'granted' 优先规则不生效,
//     networks[0] = owner 优先排序 = **他自己的个人网络**。
//   * 于是「列表跨网络、发送钉死一个网络」：目标 alias 在别的网络 → hub 404。
//   * #552 的重试也救不了：重读 /api/auth/me 后 pickDefaultNetworkId 还是那一个个人网络，
//     `fresh === err.networkId` ⇒ 不重试 ⇒ 每条消息都失败。
//
// 这里做的事只有一件：**发送时用「这个 alias 住在哪个网络」**。
// 列表里每一行都带 network_id(light 投影有),客户端把它记下来,发送时直接用;
// 记不到时(老 hub / 没列表)再问 hub 一句 `?alias=` —— 那条读只返回调用者所属网络的行,
// 不跨租户泄漏。

export interface AliasNetworkRow {
  alias?: string | null;
  network_id?: string | null;
}

/** alias → network_id。同一 alias 在多个网络都有行时,后读到的覆盖先读到的(列表按更新时间倒序,新的更可能对)。 */
export type AliasNetworkMap = Map<string, string>;

/** 记下一次列表读到的 alias → network_id。空 network_id 一律不记(老 hub 没有这一列)。 */
export function rememberAliasNetworks(map: AliasNetworkMap, rows: readonly AliasNetworkRow[] | undefined | null): AliasNetworkMap {
  if (!rows) return map;
  for (const row of rows) {
    const alias = (row.alias ?? '').trim();
    const networkId = (row.network_id ?? '').trim();
    if (!alias || !networkId) continue;
    map.set(alias, networkId);
  }
  return map;
}

/** 这个 alias 住在哪个网络;没有记录 ⇒ undefined(调用方退回原来的 cfg.networkId)。 */
export function aliasNetworkFor(map: AliasNetworkMap, alias: string | null | undefined): string | undefined {
  const key = (alias ?? '').trim();
  if (!key) return undefined;
  const networkId = map.get(key);
  return networkId && networkId.trim() ? networkId : undefined;
}

/**
 * 发送失败(网络选错)后的候选网络顺序:
 *   1) 列表里记下来的那个 alias 所属网络(最准:就是用户点的那个 Agent 所在网络);
 *   2) hub 查出来的那个;
 *   3) /api/auth/me 重新算出来的默认网络(#552 原有的那条路)。
 * 已经失败过的那个网络排除掉,其余按顺序试;重复的只留第一次。
 */
export function networkCandidates(failedNetworkId: string | null | undefined, candidates: readonly (string | null | undefined)[]): string[] {
  const failed = (failedNetworkId ?? '').trim();
  const out: string[] = [];
  for (const raw of candidates) {
    const id = (raw ?? '').trim();
    if (!id || id === failed) continue;
    if (out.includes(id)) continue;
    out.push(id);
  }
  return out;
}
