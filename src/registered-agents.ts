// #725: which registered nodes the list may show as "no session record".
//
// The list itself is Session-shaped, so a registered node without a session must
// never be squeezed into Session.status (chat-actions.ts treats any non-offline
// string as online, and agent-row-model.ts paints a green dot by default).
// Instead these rows are a separate, read-only block: no chat, no lifecycle.
import type { AgentDirectoryRow, DirectoryNode } from './agent-directory';
import { substringMatch, type Matcher } from './agents-list';

export type RegisteredAgentRow = {
  key: string;
  alias: string;
  node_id: string | null;
  network_id: string;
  runtime: string | null;
  /** Shown verbatim; never "never ran", never "must log in". */
  hint: '未启动（Hub无会话记录）' | '会话关联未确认';
  /** Always false: nothing here can open a chat or a lifecycle action. */
  actionable: false;
};

export function registeredAgentRows(
  rows: readonly AgentDirectoryRow[],
  opts: { query?: string; match?: Matcher } = {},
): RegisteredAgentRow[] {
  const match = opts.match ?? substringMatch;
  const q = (opts.query ?? '').trim();
  const out: RegisteredAgentRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.kind !== 'registered') continue;
    if (row.association === 'matched') continue; // a real session already renders it
    const node: DirectoryNode = row.node;
    const alias = (node.alias || '').trim();
    if (!alias) continue; // an unnamed row is not something a human can recognise
    // Only exact identities are stable enough to dedupe on; identity-less rows
    // cannot prove they are distinct, so they are skipped rather than listed twice.
    if (!node.node_id || !node.network_id) continue;
    const key = `node:${JSON.stringify([node.network_id, node.node_id])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (q && !match(alias, q)) continue;
    out.push({
      key,
      alias,
      node_id: node.node_id,
      network_id: node.network_id,
      runtime: node.runtime ?? null,
      hint: row.association === 'no_session_record' ? '未启动（Hub无会话记录）' : '会话关联未确认',
      actionable: false,
    });
  }
  return out;
}

/** The block is only worth a header when it has something certain to say. */
export function registeredAgentSummary(rows: readonly RegisteredAgentRow[]): {
  total: number;
  notStarted: number;
  unknown: number;
} {
  let notStarted = 0;
  let unknown = 0;
  for (const row of rows) {
    if (row.hint === '未启动（Hub无会话记录）') notStarted++;
    else unknown++;
  }
  return { total: rows.length, notStarted, unknown };
}
