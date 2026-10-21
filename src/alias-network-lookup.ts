// 「这个 alias 住在哪个网络」的一次读。独立文件,不放在 api.ts 里:
// api-network-scope.test.ts 会扫 api.ts 里所有 `get<…>(cfg, …)` 读点并要求每个
// 都在 ENDPOINTS 里声明作用域;这条读**故意跨网络**(目标 Agent 可能在调用者的另一个网络),
// 放进 api.ts 会被误当成某个导出函数的读。独立成文件,它的跨网络性质写在代码里。
//
// 读的范围:hub 的 `GET /api/status?light=1&alias=` 不带 network_id ⇒ hub 按
// 「调用者属于哪些网络」返回 ⇒ 不会看到别人的网络的 Agent。
import { appFetch } from './app-fetch';
import { aliasNetworkFor, rememberAliasNetworks, type AliasNetworkMap } from './send-target-network';

/** alias → 它的网络。列表读到的,发送时用。 */
export const aliasNetworkCache: AliasNetworkMap = new Map();

/** 这次读的上限:短。它只是发送前的锦上添花,读不到就退回原逻辑。 */
const LOOKUP_MS = 3_000;

/**
 * 这个 alias 住在哪个网络?
 * 列表里记过就用记过的;没记过(老 hub / 还没拉过列表)问 hub 一句 `?alias=`。
 * 读不到 / 没有 network_id ⇒ undefined(调用方退回原来的 cfg.networkId)。
 */
export async function resolveAliasNetwork(
  serverUrl: string,
  token: string,
  alias: string,
): Promise<string | undefined> {
  const cached = aliasNetworkFor(aliasNetworkCache, alias);
  if (cached) return cached;
  const key = (alias ?? '').trim();
  if (!key) return undefined;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOOKUP_MS);
  try {
    const res = await appFetch(`${serverUrl}/api/status?light=1&alias=${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    const data: any = await res.json().catch(() => null);
    const rows = Array.isArray(data?.sessions) ? data.sessions : [];
    const hit = rows.find((row: any) => row?.alias === key && String(row?.network_id ?? '').trim());
    if (!hit) return undefined;
    rememberAliasNetworks(aliasNetworkCache, [hit]);
    return String(hit.network_id).trim();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
