// Hub 级环境密钥页的**纯**展示逻辑（#1479 / #909）。
//
// 与 Hub 技能页同一套四态：不支持(404/501) ≠ 没权限(403) ≠ 空 ≠ 列表。
// 另外多一条只在这里成立的规则：**值不可能出现**。Hub 的 SELECT 里没有
// ciphertext/iv/tag，客户端再按 key 名形状过滤一次，两边都不给对方机会。
import type { HubSecretKey, HubSecretsResult } from './api';

export type SecretsView =
  | { kind: 'loading' }
  | { kind: 'error'; text: string; retryable: boolean }
  | { kind: 'empty'; text: string }
  | { kind: 'list'; rows: HubSecretKey[] };

export const HUB_SECRETS_EMPTY = '这个网络还没有配置任何密钥';

const KEY_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

export function hubSecretsView(result: HubSecretsResult | null): SecretsView {
  if (result === null) return { kind: 'loading' };
  if (!result.ok) return { kind: 'error', text: result.error, retryable: !result.unsupported };
  // 只留下看起来像 key 名的行；上游（Hub）已经保证了这一点，这里是第二道。
  const rows = result.keys
    .filter(k => k && typeof k.key === 'string' && KEY_RE.test(k.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (rows.length === 0) return { kind: 'empty', text: HUB_SECRETS_EMPTY };
  return { kind: 'list', rows };
}

/** 更新时间只用于「这条还在动吗」，显示到分钟即可；缺失不补假值。 */
export function hubSecretUpdatedAt(raw: number | string | null): string {
  if (raw === null || raw === undefined || raw === '') return '';
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(n) && n > 1e12) return new Date(n).toISOString().slice(0, 16).replace('T', ' ');
  const text = String(raw);
  // Hub 的 SQLite 存 epoch ms；PG 可能回 ISO 文本。两种都只截到分钟。
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 16).replace('T', ' ');
  return '';
}
