import type { HubNode, Session } from './api';
import { maskedHubHost } from './mask-hub-address';

export interface NodeInfoFact {
  label: string;
  value?: string | null;
  /** Long opaque values wrap in full (no 2-line ellipsis) so they stay readable and selectable. */
  wrap?: boolean;
  testID?: string;
}

/** Full-status resume id. Non-strings and blank values are absent (the cell shows 「—」). */
export function resumeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const TOKEN_SHAPE = /^(?:[aun]tok(?:[_\-.\s]|[A-Za-z0-9]{8})|bearer(?:\s|[_\-.])|sk[-_])\S*/i;
const CODEX_HOME_TOKEN = /(?:ntok_|atok_|sk-|bearer\s)/i;

export function isCodexNode(session: { agent?: string | null; runtime?: string | null }, node: { runtime?: string | null } | null): boolean {
  return [session.runtime, session.agent, node?.runtime].some(value => typeof value === "string" && value.toLowerCase().includes("codex"));
}

/** 只展示节点上报的绝对路径。推不出来就不编一个。 */
export function visibleCodexHome(raw?: string | null): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 1024) return null;
  if (/[\u0000-\u001f\u007f]/.test(value) || CODEX_HOME_TOKEN.test(value)) return null;
  if (!(value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value))) return null;
  return value;
}
const SAFE_HOSTNAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/;
const SAFE_IP_LITERAL = /^\[[0-9A-Fa-f:]+\]$/;

export function safeServerLabel(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 200 || /[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  if (!trimmed.includes('://')) {
    // Plain labels are deliberately ASCII-only. Unicode hostnames must arrive
    // as a parsed URL (URL normalizes them to punycode); never accept free-form
    // strings containing credentials, paths, query text, fragments or spaces.
    if (TOKEN_SHAPE.test(trimmed)) return undefined;
    const match = trimmed.match(/^(\[[0-9A-Fa-f:]+\]|[^:]+)(?::([0-9]{1,5}))?$/);
    if (!match || (!SAFE_HOSTNAME.test(match[1]) && !SAFE_IP_LITERAL.test(match[1]))) return undefined;
    const port = match[2];
    if (port && Number(port) > 65535) return undefined;
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    // origin intentionally strips userinfo, path, query, and fragment.
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function safeServerUrl(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.includes('://')) return undefined;
  return safeServerLabel(trimmed);
}

/** URL 形态一律打码(本端 Hub 地址、或节点把 Hub 地址当 server 报上来);不带协议但就是本端 Hub 主机
 *  (`hub.example.com` / `hub.example.com:9300`)也打码;其他普通主机名标签原样。 */
const serverFact = (label: string | undefined, hubOrigin: string | undefined): string | undefined => {
  if (label === undefined) return undefined;
  if (label.includes('://')) return maskedHubHost(label);
  const hubHostPort = hubOrigin?.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').toLowerCase();
  const hubHostname = hubHostPort?.replace(/:\d+$/, '');
  const l = label.toLowerCase();
  return hubHostPort && (l === hubHostPort || l === hubHostname || l.replace(/:\d+$/, '') === hubHostname) ? maskedHubHost(label) : label;
};

/** Build the safe, read-only node facts shown from a chat header.
 * Deliberately allowlists public fields: tokens, config contents and arbitrary
 * session keys can never become rows by accident. */
export function nodeInfoFacts(session: Session, node: HubNode | null, serverUrl: string): NodeInfoFact[] {
  const hubOrigin = safeServerUrl(serverUrl);
  return [
    { label: '节点名称', value: node?.node_name ?? session.alias },
    { label: '节点 ID', value: node?.node_id ?? session.node_id },
    // #649:URL 形态的「服务器」(节点报上来的是 Hub 地址,或兜底用本端 Hub 地址)只出打码值;普通主机名标签原样。
    { label: '服务器', value: serverFact(safeServerLabel(node?.server ?? session.server), hubOrigin) ?? serverFact(hubOrigin, hubOrigin) },
    { label: 'Hostname', value: node?.hostname ?? session.hostname },
    { label: 'IP', value: session.ip },
    // Only explicit runtime-reported identities are accepted. In particular,
    // never parse `/home/alice/...` or `C:\\Users\\alice` from project_dir.
    { label: '系统用户', value: session.os_user ?? session.system_user ?? '未上报' },
    { label: '工作路径', value: session.project_dir },
    // Codex 节点才有这一行。值只来自会话上报的 codex_home，没有就写「未上报」。
    ...(isCodexNode(session, node) ? [{ label: 'codex_home', value: visibleCodexHome(session.codex_home) ?? '未上报' }] : []),
    { label: '节点类型', value: node?.role ?? node?.config_snapshot?.role },
    { label: 'Runtime', value: session.runtime ?? node?.runtime ?? session.agent },
    { label: 'Agent', value: session.agent },
    { label: '模型', value: session.model ?? node?.model ?? node?.config_snapshot?.model },
    { label: '版本', value: session.version },
    // Resume id sits in the cell beside 版本 on 「模型与运行时」. Always emit the row:
    // a missing / blank / non-string session_id is an empty value, and FactCell shows 「—」.
    { label: 'session-id', value: resumeSessionId(session.session_id), wrap: true, testID: 'node-runtime-session-id' },
    { label: '状态', value: session.status },
  ];
}
