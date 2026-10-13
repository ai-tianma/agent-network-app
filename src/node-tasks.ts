// app#157 —— 节点详情里的「任务」区:这个节点正在跑什么、前面还排着几条。
// 纯函数,hub 的 /api/tasks?to_name=<alias> 行进来,分成「正在运行」与「等待队列」两组;
// 终态(replied/failed/cancelled/timeout…)不显示 —— 那是聊天时间线的事。
import type { HubTask } from './api';

/** hub 侧 tasks.status 里表示「已经到节点手上、还没结束」的值(server/src 实测词汇)。 */
export const RUNNING_STATUSES = new Set(['delivered', 'acked', 'running', 'in_progress', 'started']);
/** 还没送到节点手上、按创建顺序排队的值。 */
export const QUEUED_STATUSES = new Set(['pending', 'created', 'queued', 'restarting']);

export interface NodeTaskRow {
  taskId: string;
  status: string;
  from: string;
  /** 第一行、最多 140 字的摘要;完整内容看 detail。 */
  summary: string;
  content: string;
  createdAt?: string;
  /** 运行中:started_at ?? delivered_at ?? created_at;排队:created_at。 */
  since?: string;
  /** 节点侧最后一次动静(送达/开始/提交运行时/消费/创建里最晚的),判「可能卡住」用。 */
  lastActivity?: string;
  priority?: string;
  runtimeSubmittedAt?: string;
  consumedAt?: string;
}

export interface NodeTaskPartition {
  running: NodeTaskRow[];
  queue: NodeTaskRow[];
}

/** 排序键;拿不到时间的排最后(而不是最前),免得一条没时间戳的行把编号顶乱。 */
const tsKey = (v?: string): string => (typeof v === 'string' && v ? v.replace('T', ' ').slice(0, 19) : '9999-99-99 99:99:99');

export function summarizeTask(content?: string, max = 140): string {
  const first = (content ?? '').split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? '';
  return first.length > max ? `${first.slice(0, max - 1)}…` : first || '(空任务)';
}

/** 这条任务在节点侧最后一次有动静的时间;hub 各时间戳同格式,按字符串比即可。 */
export function latestActivity(t: HubTask): string | undefined {
  const all = [t.created_at, t.delivered_at, t.started_at, t.runtime_submitted_at, t.consumed_at]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(v => v.replace('T', ' ').slice(0, 19));
  return all.length ? all.sort()[all.length - 1] : undefined;
}

function toRow(t: HubTask, since?: string): NodeTaskRow | null {
  if (!t?.task_id) return null;
  return {
    taskId: t.task_id,
    status: t.status ?? '',
    from: t.from_name ?? 'hub',
    summary: summarizeTask(t.content),
    content: t.content ?? '',
    createdAt: t.created_at,
    since,
    lastActivity: latestActivity(t),
    priority: t.priority,
    runtimeSubmittedAt: t.runtime_submitted_at,
    consumedAt: t.consumed_at,
  };
}

/** Delivery groups retain legacy ordering; creation order is not runtime execution rank. */
export function partitionNodeTasks(tasks: readonly HubTask[] | undefined | null): NodeTaskPartition {
  const running: NodeTaskRow[] = [];
  const queue: NodeTaskRow[] = [];
  for (const t of tasks ?? []) {
    const status = (t?.status ?? '').toLowerCase();
    if (RUNNING_STATUSES.has(status)) {
      const row = toRow(t, t.started_at ?? t.delivered_at ?? t.created_at);
      if (row) running.push(row);
    } else if (QUEUED_STATUSES.has(status)) {
      const row = toRow(t, t.created_at);
      if (row) queue.push(row);
    }
  }
  running.sort((a, b) => tsKey(a.since).localeCompare(tsKey(b.since)));
  queue.sort((a, b) => tsKey(a.createdAt).localeCompare(tsKey(b.createdAt)));
  return { running, queue };
}

/** 「3 分钟」「1 小时 12 分钟」;hub 的 UTC `YYYY-MM-DD HH:MM:SS`。拿不到或在未来 → ''。 */
export function elapsedLabel(since?: string, now: Date = new Date()): string {
  if (!since) return '';
  const iso = since.includes('T') ? since : `${since.replace(' ', 'T')}Z`;
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时${m % 60 ? ` ${m % 60} 分钟` : ''}`;
  return `${Math.floor(h / 24)} 天${h % 24 ? ` ${h % 24} 小时` : ''}`;
}
