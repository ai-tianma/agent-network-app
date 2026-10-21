// 节点详情页「模型」行的纯状态机(RFC-024 update_node_config 路径)。
//
// 不经过任何 LLM:app → hub update_node_config{model} → 节点收 SSE config_update
// → 写配置、exit 75 → 启动器原地拉起。改模型属于 apply_mode=restart,所以
// 提交后要**轮询** GET /api/nodes/:id/config,等 config_revision 抬高且 model
// 等于我们要的那个,才算 applied;hub 表里的 applied 是内容匹配快照定的,
// 不等价于「节点活着」,所以这里只信读回来的 config。
//
// 纯模块:没有 fetch、没有 React,方便 ck 测试逐个状态转移断言。

export interface NodeConfigView {
  config_revision: number;
  model: string | null;
  flags?: Record<string, unknown>;
  config_update_capable: boolean;
}

export type ModelChangePhase =
  | { kind: 'idle' }
  | { kind: 'submitting'; requested: string }
  | { kind: 'restarting'; requested: string; baseRevision: number; polls: number }
  | { kind: 'applied'; model: string }
  | { kind: 'timeout'; requested: string }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string };

/** 3 s × 30 = 90 s:共存节点重启(serve + attach + 注册)实测 5–45 s。 */
export const RESTART_POLL_MS = 3000;
export const RESTART_MAX_POLLS = 30;
export const RESTART_TIMEOUT_MS = RESTART_POLL_MS * RESTART_MAX_POLLS;

/** 和向导同一条校验(非空、无空白);opencode 是 provider/model 形态,不再限字符集。 */
export function validateModelId(raw: string): { ok: true; model: string } | { ok: false; reason: string } {
  const model = (raw ?? '').trim();
  if (!model) return { ok: false, reason: '模型 id 不能为空' };
  if (/\s/.test(model)) return { ok: false, reason: '模型 id 不能含空白字符' };
  if (model.length > 200) return { ok: false, reason: '模型 id 过长(≤200)' };
  return { ok: true, model };
}

/** 三态:null = hub 没有这个接口(旧 hub);false = 节点不是在能重启它的启动器下跑的;true = 可改。 */
export function modelControlAvailability(view: NodeConfigView | null | undefined): { enabled: boolean; hint: string } {
  if (!view) return { enabled: false, hint: '当前 Hub 未提供节点配置接口(需升级 commhub-server)' };
  if (!view.config_update_capable) {
    return { enabled: false, hint: '此节点不是由 anet 启动器托管的,无法远程改模型。请在它所在机器上执行 anet node edit <name> --model <id> 后重启。' };
  }
  return { enabled: true, hint: '' };
}

export type SubmitOutcome =
  | { ok: true }
  | { ok: false; conflict: true; error: string }
  | { ok: false; conflict?: false; error: string };

export function afterSubmit(requested: string, baseRevision: number, outcome: SubmitOutcome): ModelChangePhase {
  if (outcome.ok) return { kind: 'restarting', requested, baseRevision, polls: 0 };
  if (outcome.conflict) return { kind: 'conflict' };
  return { kind: 'error', message: outcome.error };
}

/** 一次轮询读回配置后的转移。view=null(读失败)算一次轮询但不改判。 */
export function afterPoll(
  phase: Extract<ModelChangePhase, { kind: 'restarting' }>,
  view: NodeConfigView | null,
  maxPolls: number = RESTART_MAX_POLLS,
): ModelChangePhase {
  if (view && view.config_revision > phase.baseRevision && view.model === phase.requested) {
    return { kind: 'applied', model: phase.requested };
  }
  const polls = phase.polls + 1;
  if (polls >= maxPolls) return { kind: 'timeout', requested: phase.requested };
  return { ...phase, polls };
}

export function phaseText(phase: ModelChangePhase): string {
  switch (phase.kind) {
    case 'idle': return '';
    case 'submitting': return `正在提交模型 ${phase.requested}…`;
    case 'restarting': return `已下发,节点正在以新模型重启…(已检查 ${phase.polls} 次)`;
    case 'applied': return `已切换到 ${phase.model}`;
    case 'timeout': return `已下发 ${phase.requested},但 ${RESTART_MAX_POLLS * RESTART_POLL_MS / 1000}s 内节点没有以新模型回来。请到它所在机器看日志(anet node logs)。`;
    case 'conflict': return '配置在别处被改过了,已重新加载,请再选一次。';
    case 'error': return `失败:${phase.message}`;
  }
}

/** Chips to render: the catalog's suggestions, plus the node's current model
 * prepended when the catalog does not list it. The catalog is a built-in
 * snapshot that lags the provider (mimo-v2.5-free was withdrawn while still
 * listed), so a node on an unlisted model must still see itself selected
 * rather than have its model silently disappear. Order and duplicates of
 * the catalog are preserved; `current` is never duplicated. */
export function modelChips(suggestions: readonly string[], current: string | null | undefined): string[] {
  const cur = (current ?? '').trim();
  if (!cur || suggestions.includes(cur)) return [...suggestions];
  return [cur, ...suggestions];
}

/**
 * 「当前模型不在这台机器上报的列表里」的提醒。
 *
 * 看板 #1941 / admin 2026-10-21:agent 节点拒跑最常见的原因就是配置里的模型
 * 这台机器根本没有(TMAI狗 配 grok-4.7,ACP 只有 4.6/4.5)。列表来自机器本身,
 * 所以「不在列表里」是一句可靠的提醒;但它**不是判据**——列表可能先于
 * 服务器更新,不拦提交,只把话说清楚。
 * 目录为空(读不到/没上报)或没配模型 ⇒ null,不凭空报警。
 */
export function modelNotOnMachineNote(current: string | null | undefined, catalog: readonly string[]): string | null {
  const cur = (current ?? '').trim();
  if (!cur || catalog.length === 0) return null;
  if (catalog.includes(cur)) return null;
  return `当前模型 ${cur} 不在这台机器上报的模型列表里;节点可能拒绝运行。点一个它上报的模型再保存。`;
}

/** One-line caveat under the chips for runtimes whose catalog is known to lag
 * the provider; null for runtimes with no such caveat. */
export function catalogHint(runtime: string | null | undefined): string | null {
  if (runtime === 'opencode-cli') return '候选来自内置列表,可能滞后于 OpenCode Zen 实际可用模型;选错会在重启后回件报错。';
  return null;
}

export function phaseIsBusy(phase: ModelChangePhase): boolean {
  return phase.kind === 'submitting' || phase.kind === 'restarting';
}
