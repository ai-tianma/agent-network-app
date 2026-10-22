// #725: a visible directory is not a collection of invented runtime sessions.
// Inputs must be fresh Hub-authorized reads for the caller's current scope.
// This pure model does not grant access, fetch, persist, or control any node.
import type { HubNode, Session } from './api';
import { substringMatch, type Matcher } from './agents-list';

export type DirectoryNode = Pick<HubNode, 'node_id' | 'alias' | 'node_name' | 'runtime'> & {
  network_id?: string | null;
};

/** scopeKey is minted by the reader from its account/auth epoch, read scope,
 * and logical read generation shared by both requests.
 * It is not an alias, nor a fallback network identity for legacy rows. */
export type DirectorySnapshot<T> =
  | { scopeKey: string; result: 'ok'; complete: boolean; rows: readonly T[] }
  | { scopeKey: string; result: 'unavailable' };

export type DirectoryUnknownReason =
  | 'sessions_unavailable'
  | 'node_identity_missing'
  | 'session_identity_missing'
  | 'duplicate_node_identity'
  | 'multiple_sessions';

export type RegisteredDirectoryRow = {
  kind: 'registered';
  key: string;
  node: DirectoryNode;
} & (
  | { association: 'matched'; session: Session }
  | { association: 'no_session_record'; session: null }
  | { association: 'unknown'; session: null; reason: DirectoryUnknownReason }
);

export type AgentDirectoryRow = RegisteredDirectoryRow | {
  kind: 'session_only';
  key: string;
  session: Session;
};

type ReadState = 'ok' | 'unavailable' | 'scope_mismatch' | 'incomplete';
export interface AgentDirectory {
  rows: AgentDirectoryRow[];
  nodesRead: ReadState;
  sessionsRead: ReadState;
}

const identityPart = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.trim() === value ? value : null;

function identity(row: { network_id?: string | null; node_id?: string | null }): string | null {
  const network = identityPart(row.network_id);
  const node = identityPart(row.node_id);
  // Tuple encoding avoids delimiter collisions. Never infer either part.
  return network && node ? JSON.stringify([network, node]) : null;
}

function readState<T>(scopeKey: string, snapshot: DirectorySnapshot<T>): ReadState {
  if (!scopeKey || snapshot.scopeKey !== scopeKey) return 'scope_mismatch';
  if (snapshot.result === 'ok' && snapshot.complete !== true) return 'incomplete';
  return snapshot.result;
}

export function buildAgentDirectory(input: {
  scopeKey: string;
  nodes: DirectorySnapshot<DirectoryNode>;
  sessions: DirectorySnapshot<Session>;
}): AgentDirectory {
  const nodesRead = readState(input.scopeKey, input.nodes);
  const sessionsRead = readState(input.scopeKey, input.sessions);
  const nodes = nodesRead === 'ok' && input.nodes.result === 'ok' ? input.nodes.rows : [];
  const sessions = sessionsRead === 'ok' && input.sessions.result === 'ok' ? input.sessions.rows : [];
  const indexedSessions = new Map<string, number[]>();
  const duplicateNodes = new Map<string, number>();
  const incompleteSessionNetworks = new Set<string>();
  let unscopedSession = false;

  sessions.forEach((session, index) => {
    const key = identity(session);
    if (key) {
      const matches = indexedSessions.get(key);
      if (matches) matches.push(index);
      else indexedSessions.set(key, [index]);
    }
    else {
      const network = identityPart(session.network_id);
      if (network) incompleteSessionNetworks.add(network);
      else unscopedSession = true;
    }
  });
  for (const node of nodes) {
    const key = identity(node);
    if (key) duplicateNodes.set(key, (duplicateNodes.get(key) ?? 0) + 1);
  }

  const rows: AgentDirectoryRow[] = [];
  const emittedNodes = new Set<string>();
  const consumedSessions = new Set<number>();
  nodes.forEach((source, index) => {
    const key = identity(source);
    if (key && emittedNodes.has(key)) return;
    if (key) emittedNodes.add(key);
    // Only directory facts survive: do not copy arbitrary config/capabilities.
    const node: DirectoryNode = {
      node_id: source.node_id, network_id: source.network_id, alias: source.alias,
      node_name: source.node_name, runtime: source.runtime,
    };
    const base = { kind: 'registered' as const, key: key ? `node:${key}` : `unbound-node:${index}`, node };
    const unknown = (reason: DirectoryUnknownReason) => {
      rows.push({ ...base, association: 'unknown', session: null, reason });
    };
    if (!key) return unknown('node_identity_missing');
    if ((duplicateNodes.get(key) ?? 0) > 1) return unknown('duplicate_node_identity');
    if (sessionsRead !== 'ok') return unknown('sessions_unavailable');
    const matches = indexedSessions.get(key) ?? [];
    if (matches.length > 1) return unknown('multiple_sessions');
    if (matches.length === 1) {
      consumedSessions.add(matches[0]);
      rows.push({ ...base, association: 'matched', session: sessions[matches[0]] });
      return;
    }
    // A legacy session with no stable identity could belong to this node.
    // Empty/failed/legacy input must not become proof of "never started".
    if (unscopedSession || incompleteSessionNetworks.has(node.network_id!)) {
      return unknown('session_identity_missing');
    }
    rows.push({ ...base, association: 'no_session_record', session: null });
  });
  sessions.forEach((session, index) => {
    if (!consumedSessions.has(index)) rows.push({ kind: 'session_only', key: `session:${index}`, session });
  });
  return { rows, nodesRead, sessionsRead };
}

/** The same injected matcher as the Agent list supports Chinese/pinyin search. */
export function searchAgentDirectory(
  rows: readonly AgentDirectoryRow[], query: string, match: Matcher = substringMatch,
): AgentDirectoryRow[] {
  const q = query.trim();
  return q ? rows.filter(row => match(row.kind === 'registered' ? row.node.alias : row.session.alias, q)) : [...rows];
}

/** UI hints for registered rows without a confirmed session, never Session.status. */
export function directorySessionHint(row: RegisteredDirectoryRow): string | null {
  if (row.association === 'matched') return null;
  return row.association === 'no_session_record' ? '未启动（Hub无会话记录）' : '会话关联未确认';
}
