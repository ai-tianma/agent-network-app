// daemon 的密钥授权展示（#1475 / #909）。
//
// `list_host_supervisors` 早就带着 `allowed_secret_keys`，但客户端从来没显示过它 ——
// 现网 7 个 daemon 全是 `[]`，也就是「一条授权都没有」，而界面上完全看不出来。
//
// 三态必须分清（和 node-files / node-logs / secret_keys 同一套）：
//   * `undefined` —— 这个 Hub/daemon 还没上报该字段 ⇒ **不显示**，不替它下结论；
//   * `[]`       —— 明确「未授权任何密钥」；
//   * 有内容      —— 显示数量 + 名字（名字不是值，可以展示）。
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

export type AllowedSecretKeysView =
  | { kind: 'unknown' }
  | { kind: 'none'; text: string }
  | { kind: 'some'; text: string; keys: string[] };

export const DAEMON_KEYS_NONE = '密钥授权：未授权任何密钥';

export function describeAllowedSecretKeys(raw: string[] | null | undefined): AllowedSecretKeysView {
  if (!Array.isArray(raw)) return { kind: 'unknown' };
  // ⚠️ 这条过滤**不是**值检测：daemon 的密钥名允许小写与混合大小写（如
  // openai_api_key），所以无法靠形状区分「名字」和「值」。它只挡住明显不是
  // 名字的东西（空格、斜杠、超长），避免把拼错的行原样画到界面上。
  // 真正的保证在服务端：daemon 上报的是 key 名，值从不经过这条链路。
  const keys = [...new Set(raw.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)))].sort();
  if (keys.length === 0) return { kind: 'none', text: DAEMON_KEYS_NONE };
  const shown = keys.slice(0, 6).join(' · ');
  const more = keys.length > 6 ? ` 等 ${keys.length} 个` : '';
  return { kind: 'some', text: `密钥授权：${shown}${more}`, keys };
}
