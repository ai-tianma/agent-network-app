import type { HubTask } from './api';

const codes = new Set([
  'terminal', 'runtime_consumed_nonterminal', 'runtime_submitted_waiting_for_signal',
  'target_session_missing', 'target_session_offline', 'target_no_live_sse',
  'lifecycle_progress_without_runtime_evidence', 'runtime_evidence_channel_absent',
  'delivered_waiting_for_agent',
]);

/** Existing Hub GET /api/tasks/:id diagnostic v1. Missing/future shapes stay unknown. */
export interface TaskDiagnostic {
  schema_version: 1;
  code: string;
  evidence: {
    task_status: string;
    runtime_submitted: boolean;
    runtime_consumed: boolean;
    target_ever_reported_runtime_evidence: boolean | null;
    target_session_status: string | null;
    live_sse_connections: number;
  };
}

export function readTaskDiagnostic(value: unknown): TaskDiagnostic | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as TaskDiagnostic;
  const e = d.evidence;
  if (d.schema_version !== 1 || !codes.has(d.code) || !e || typeof e.task_status !== 'string'
    || typeof e.runtime_submitted !== 'boolean' || typeof e.runtime_consumed !== 'boolean'
    || ![true, false, null].includes(e.target_ever_reported_runtime_evidence)
    || !(e.target_session_status === null || typeof e.target_session_status === 'string')
    || !Number.isSafeInteger(e.live_sse_connections) || e.live_sse_connections < 0) return null;
  return d;
}

export type TaskExecutionState = 'finished' | 'failed' | 'ended' | 'consumed' | 'submitted'
  | 'missing' | 'offline' | 'disconnected' | 'evidenceAbsent' | 'received' | 'unconfirmed';
const successful = new Set(['replied', 'completed', 'done']);
const failed = new Set(['failed', 'timeout', 'expired']);
const ended = new Set(['cancelled', 'canceled']);
const open = new Set(['pending', 'created', 'queued', 'restarting', 'delivered', 'acked', 'running', 'in_progress', 'started']);
const stamped = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/** Delivery/started_at and running status alone never prove model consumption. */
export function taskExecutionState(task: HubTask, diagnostic?: TaskDiagnostic | null): TaskExecutionState {
  const status = (task.status ?? '').toLowerCase();
  if (failed.has(status)) return 'failed';
  if (ended.has(status)) return 'ended';
  if (successful.has(status) || task.result || task.reply) return 'finished';
  if (stamped(task.consumed_at)) return 'consumed';
  if (stamped(task.runtime_submitted_at)) return 'submitted';
  // Only a same-task, same-snapshot diagnostic may supply additional evidence.
  const d = readTaskDiagnostic(diagnostic);
  if (d && d.evidence.task_status === task.status) {
    if (d.evidence.runtime_consumed) return 'consumed';
    if (d.evidence.runtime_submitted) return 'submitted';
    if (d.code === 'target_session_missing') return 'missing';
    if (d.code === 'target_session_offline') return 'offline';
    if (d.code === 'target_no_live_sse') return 'disconnected';
    if (d.code === 'runtime_evidence_channel_absent') return 'evidenceAbsent';
  }
  return open.has(status) ? 'received' : 'unconfirmed';
}
