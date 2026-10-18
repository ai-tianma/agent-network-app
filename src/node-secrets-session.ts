// 节点密钥会话的**纯**逻辑（#1491 E2）。
//
// Hub 那条 lane 是异步的：POST 入队 → 节点下次启动时应用 → ack 回来。所以客户端
// 必须把「排队/等待/成功/失败/超时」讲清楚，而不是转圈到用户放弃。
//
// 三条判据：
//   * 没有 revision 就不能改 —— revision 是节点自己报的版本，猜一个就会覆盖别人
//     在这期间手改的文件；
//   * 值永远不进入任何展示状态（连错误信息里也不该有）；
//   * 「超时」不是「失败」：请求可能还在队列里，重试前应先刷新，否则会一直撞
//     secret_store_busy（同节点只允许一个 pending）。
import type { NodeSecretSnapshot } from './api';

export const SECRET_POLL_TIMEOUT_MS = 30_000;
export const SECRET_POLL_INTERVAL_MS = 1_000;
const KEY_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

export type SnapshotView =
  | { kind: 'none' }
  | { kind: 'ok'; revision: number; keys: string[] };

export function snapshotView(snapshot: NodeSecretSnapshot | null | undefined): SnapshotView {
  if (!snapshot || !Number.isSafeInteger(snapshot.revision) || !Array.isArray(snapshot.keys)) return { kind: 'none' };
  const keys = [...new Set(
    snapshot.keys
      .filter(k => k && typeof k.key === 'string' && KEY_RE.test(k.key))
      .map(k => k.key),
  )].sort();
  return { kind: 'ok', revision: snapshot.revision, keys };
}

/** put/delete 需要的 revision；拿不到就不允许改。 */
export function mutatingRevision(snapshot: NodeSecretSnapshot | null | undefined): number | null {
  const v = snapshotView(snapshot);
  return v.kind === 'ok' ? v.revision : null;
}

export type PollDecision = 'continue' | 'done' | 'failed' | 'timeout';

export function pollDecision(status: 'pending' | 'succeeded' | 'failed' | undefined, elapsedMs: number): PollDecision {
  if (status === 'succeeded') return 'done';
  if (status === 'failed') return 'failed';
  return elapsedMs >= SECRET_POLL_TIMEOUT_MS ? 'timeout' : 'continue';
}

/** 用户可见的排队/超时说明。超时时要说清「可能还在队列里」，否则用户会一直重试。 */
export function timeoutHint(): string {
  return '节点还没回应。请求可能仍在队列里（同一节点同时只允许一个），请先刷新再试。';
}

export function keyInputError(key: string): string | null {
  const k = key.trim();
  if (!k) return 'Key 不能为空';
  if (!KEY_RE.test(k)) return 'Key 只能是 A-Z / 0-9 / 下划线，且以字母或下划线开头（最长 64）';
  return null;
}
