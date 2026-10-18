// 节点密钥「名字」的解析（#1474 / #909）。
//
// 三态必须分清，和 node-files / node-logs 那几处同一个道理：
//   * `undefined` —— 这个 session 的上报里没有这个字段（旧 Hub 或旧节点）⇒ **不要渲染**
//     「没有密钥」，那是在替它下结论；
//   * `'[]'`      —— 节点上报了，并且明确说「一个都没有」⇒ 可以显示空态；
//   * 有内容      —— 显示名字列表。
//
// 值永远不会经过这里：Hub 只存名字，客户端也只渲染名字。任何看起来像值的字符串
// （小写、含 `_` 之外的分隔、超长）都会被丢掉，作为第二道防线。
const SECRET_KEY_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;
export const CLIENT_SECRET_KEYS_MAX = 50;

export type SecretKeysView =
  | { kind: 'unknown' }
  | { kind: 'none' }
  | { kind: 'list'; keys: string[] };

export function parseSecretKeys(raw: string | string[] | null | undefined): SecretKeysView {
  if (raw === undefined || raw === null) return { kind: 'unknown' };
  let arr: unknown;
  if (Array.isArray(raw)) arr = raw;
  else {
    const text = String(raw).trim();
    if (!text) return { kind: 'unknown' };
    try { arr = JSON.parse(text); } catch { return { kind: 'unknown' }; }
  }
  if (!Array.isArray(arr)) return { kind: 'unknown' };
  const keys = [...new Set(
    arr.filter((k): k is string => typeof k === 'string' && SECRET_KEY_RE.test(k)),
  )].sort().slice(0, CLIENT_SECRET_KEYS_MAX);
  return keys.length ? { kind: 'list', keys } : { kind: 'none' };
}
