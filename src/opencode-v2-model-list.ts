// OpenCode V2 节点的模型列表来自那台机器上的 OpenCode Server（GET /api/model），
// 经 Hub 的 read_opencode_catalog / get_opencode_catalog 取回。这里不编内置清单。
import type { HubNode } from './api';

export type OpenCodeCatalogModel = { providerId: string; id: string };
export type OpenCodeCatalogSnapshot = {
  providers?: Array<{ id: string; activation?: string }>;
  models?: OpenCodeCatalogModel[];
};

const OPENCODE_RUNTIMES = new Set(['opencode-cli', 'opencode-sdk', 'opencode']);

/** V1 明确排除。代际未知时，OpenCode runtime 仍走服务器目录，Hub 会拒绝非 V2。 */
export function isOpenCodeV2Node(node: Pick<HubNode, 'runtime' | 'config_snapshot'>): boolean {
  const gen = node.config_snapshot?.flags?.opencodeGeneration;
  if (gen === 'v1') return false;
  if (gen === 'v2') return true;
  return OPENCODE_RUNTIMES.has(node.runtime ?? '');
}

/** provider/model，跳过已停用的 provider。顺序保持服务器返回的顺序。 */
export function modelIdsFromCatalog(snapshot: OpenCodeCatalogSnapshot | null | undefined): string[] {
  const disabled = new Set((snapshot?.providers ?? []).filter(p => p.activation === 'disabled').map(p => p.id));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of snapshot?.models ?? []) {
    if (!row?.providerId || !row.id || disabled.has(row.providerId)) continue;
    const id = `${row.providerId}/${row.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function catalogErrorText(error: string | undefined): string {
  switch (error) {
    case 'not_opencode_v2': return '这个节点不是 OpenCode V2，不能从它的服务器拉模型列表。';
    case 'daemon_not_found':
    case 'daemon_not_supervisor': return '找不到这个节点所属的 daemon，读不到 OpenCode 服务器。';
    case 'node_not_found': return 'Hub 没有这条节点的 OpenCode V2 创建记录，读不到模型列表。';
    case 'user_token_required': return '读取模型列表需要登录人类账号，节点令牌不行。';
    case 'unavailable': return '节点上的 OpenCode 服务器没有返回模型列表。';
    case 'unauthorized': return '节点上的 OpenCode 服务器拒绝了这次读取。';
    default: return error ? `读取 OpenCode 模型列表失败：${error}` : '读取 OpenCode 模型列表失败。';
  }
}
