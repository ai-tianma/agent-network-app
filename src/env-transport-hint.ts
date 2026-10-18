// 节点到 Hub 的链路形态展示（#1510）。
//
// Hub 看不到最后一跳，只有节点自己知道；这一层只负责**把它讲成人话**。
// 这里只做提示，不做拦截 —— 打开闸门要一次明确的决定（见 #1510 的下一片）。
export type EnvTransportHint =
  | { kind: 'unknown' }
  | { kind: 'ok'; text: string }
  | { kind: 'warn'; text: string };

export function envTransportHint(raw: string | undefined | null): EnvTransportHint {
  const v = (raw ?? '').trim();
  if (!v) return { kind: 'unknown' };
  if (v === 'loopback') return { kind: 'ok', text: 'Hub 链路：本机（不出这台机器）' };
  if (v === 'https') return { kind: 'ok', text: 'Hub 链路：TLS' };
  if (v === 'plain') {
    return {
      kind: 'warn',
      text: 'Hub 链路：明文。密钥经这条链路传输时没有任何加密保护 —— 建议改成 https 或把 Hub 放到本机。',
    };
  }
  // 未知取值不猜安全的，也不报错：只说「不认识」，让人去查版本。
  return { kind: 'warn', text: `Hub 链路：未知取值「${v.slice(0, 20)}」（节点/Hub 版本不一致？）` };
}
