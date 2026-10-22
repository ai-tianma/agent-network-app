// #725: the only sanctioned way to obtain directory inputs from the Hub.
//
// Both reads are Hub-authorized already; this module never widens visibility.
// It also never invents identity: a session row without network_id/node_id stays
// identity-less and the model treats it as unknown, not as "no session".
import type { HubConfig, Session } from './api';
import { appFetch } from './app-fetch';
import type { DirectoryNode, DirectorySnapshot } from './agent-directory';

/** What the caller must own: account/auth epoch + requested scope + read generation.
 * Reusing a scopeKey across generations would let an older response answer a newer
 * question, so callers mint a fresh one per logical read and drop stale results. */
export type DirectoryReadOptions = {
  scopeKey: string;
  /** Test seam only. Production must use the app transport (Tauri pool / web). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type StatusBody = { ok?: boolean; sessions?: unknown };
type NodesBody = { ok?: boolean; nodes?: unknown };

const DEFAULT_TIMEOUT_MS = 20_000;

export interface DirectoryReadResult {
  scopeKey: string;
  nodes: DirectorySnapshot<DirectoryNode>;
  sessions: DirectorySnapshot<Session>;
}

function authHeaders(cfg: HubConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' };
}

async function readJson<T>(
  url: string,
  cfg: HubConfig,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ status: number; body: T | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: authHeaders(cfg), signal: ctrl.signal });
    if (!res.ok) return { status: res.status, body: null };
    // Body must be fully consumed before this counts as a complete read.
    const body = (await res.json()) as T;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

const identityOk = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value;

const hasIdentity = (row: Record<string, unknown>): boolean =>
  identityOk(row.node_id) && identityOk(row.network_id);

/** Keep only directory facts. Capability flags, telemetry and secrets stay out. */
function toDirectoryNode(row: unknown): DirectoryNode | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (!identityOk(r.node_id) && !identityOk(r.network_id)) {
    // Still surface the alias if present: the model marks it unknown, and the
    // user can at least see that a registered row exists.
    if (!identityOk(r.alias)) return null;
  }
  return {
    node_id: (r.node_id as string | null | undefined) ?? null,
    network_id: (r.network_id as string | null | undefined) ?? null,
    alias: typeof r.alias === 'string' ? r.alias : '',
    node_name: typeof r.node_name === 'string' ? r.node_name : null,
    runtime: typeof r.runtime === 'string' ? r.runtime : null,
  } as DirectoryNode;
}

function toSession(row: unknown): Session | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  // A row that carries an identity but no usable alias is NOT ignorable: dropping
  // it would let the model conclude "no session" for that node. The caller marks
  // such a snapshot incomplete instead (see the `*.filter` call sites).
  if (!identityOk(r.alias)) return null;
  return {
    alias: r.alias as string,
    status: typeof r.status === 'string' ? r.status : '',
    network_id: (r.network_id as string | null | undefined) ?? null,
    node_id: (r.node_id as string | null | undefined) ?? null,
    updated_at: (r.updated_at as string | null | undefined) ?? null,
    runtime: (r.runtime as string | null | undefined) ?? null,
  } as Session;
}

/**
 * Read the authorized directory inputs for one logical read.
 *
 * - `/api/nodes` is read WITHOUT a network filter: filtering by the caller's
 *   default network would hide nodes from other networks they may see.
 * - `/api/status` is read WITHOUT `light=1`: the light projection omits
 *   `node_id` unless a single node is filtered, so it cannot establish identity.
 *   That is heavier; callers should not poll it every 10 s without caching.
 */
export async function fetchAgentDirectory(
  cfg: HubConfig,
  opts: DirectoryReadOptions,
): Promise<DirectoryReadResult> {
  // 🔴 Default is appFetch, not global fetch: on desktop the Tauri transport is
  // what bypasses WebView CORS (app-fetch.ts). Global fetch is NOT replaced there,
  // so using it would break exactly the Hubs that work today.
  const fetchImpl = opts.fetchImpl ?? (appFetch as unknown as typeof fetch);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scopeKey = opts.scopeKey;
  const base = cfg.serverUrl.replace(/\/+$/, '');

  const [nodesRead, statusRead] = await Promise.all([
    readJson<NodesBody>(`${base}/api/nodes`, cfg, fetchImpl, timeoutMs),
    readJson<StatusBody>(`${base}/api/status`, cfg, fetchImpl, timeoutMs),
  ]);

  const nodesOk = nodesRead.status === 200 && nodesRead.body?.ok !== false && Array.isArray(nodesRead.body?.nodes);
  const sessionsOk = statusRead.status === 200 && statusRead.body?.ok !== false && Array.isArray(statusRead.body?.sessions);

  // Dropping an unexplainable row is not evidence of absence: if a row could not be
  // represented, the snapshot is marked incomplete so the model never concludes
  // "no session" from a set it cannot fully explain.
  const rawNodes = nodesOk ? (nodesRead.body!.nodes as unknown[]) : [];
  const nodeRows = rawNodes.map(toDirectoryNode).filter((row): row is DirectoryNode => row !== null);
  // A registered row we cannot name is still evidence that a node exists.
  const unrepresentableNodes = rawNodes.some(raw => {
    if (!raw || typeof raw !== 'object') return true;
    const r = raw as Record<string, unknown>;
    return hasIdentity(r) && typeof r.alias !== 'string';
  });
  const nodesComplete = nodeRows.length === rawNodes.length && !unrepresentableNodes;

  const rawSessions = sessionsOk ? (statusRead.body!.sessions as unknown[]) : [];
  const sessionRows = rawSessions.map(toSession).filter((row): row is Session => row !== null);
  // A session row that carries an identity but no alias still proves something
  // exists for that node, so its snapshot cannot be treated as complete.
  const unrepresentableSessions = rawSessions.some(raw => {
    if (!raw || typeof raw !== 'object') return true;
    const r = raw as Record<string, unknown>;
    return hasIdentity(r) && !identityOk(r.alias);
  });

  const nodes: DirectorySnapshot<DirectoryNode> = nodesOk
    ? { scopeKey, result: 'ok', complete: nodesComplete, rows: nodeRows }
    : { scopeKey, result: 'unavailable' };

  const sessions: DirectorySnapshot<Session> = sessionsOk
    ? { scopeKey, result: 'ok', complete: sessionRows.length === rawSessions.length && !unrepresentableSessions, rows: sessionRows }
    : { scopeKey, result: 'unavailable' };

  return { scopeKey, nodes, sessions };
}
