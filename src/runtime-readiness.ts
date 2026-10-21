// 看板 #623 —— 新建节点:每台机器 × 每个 runtime 的真实可用性。
//
// 数据:hub `GET /api/host-supervisors` 每个 daemon 上可选的 `runtime_readiness`
// (agent-network PR #2429 / 看板 #622),按 runtime id 给出:
//   { ok, state: 'ready'|'missing_cli'|'not_logged_in'|'no_network'|'unknown',
//     reason(中文、面向用户、带修法), checked_at(daemon 本机钟), version?, cli?, auth?, network?,
//     shared_login_count? }
//
// 本模块只做「读数 → 怎么画」的映射,纯函数,不碰 react-native(src/runtime-readiness.test.ts 直接跑)。
//
// 🔴 三条规矩(和 daemon-capability.ts 同一族):
//   ① `runtime_readiness` 整个缺席(旧 daemon / 第一轮自检还没跑完)⇒ 和今天一模一样:不灰任何东西。
//      缺席 ≠ 不可用。把一台没升级的 daemon 画成「全不能用」会让人去修一台好好的机器。
//   ② `state` 说了算,`reason` 原样显示 —— 不在客户端重算判据、不复制一份修法表。
//      hub 认不出的 state 已被它映射成 unknown;这里再兜一层:认不出 ⇒ unknown(可选,标「未检测」)。
//   ③ `shared_login_count` 只是提醒,state 仍是 ready、仍可选。
// 机器级的闸门仍是 `can_create_nodes`(daemon-capability.ts),本模块不动它。

export type ReadinessState = 'ready' | 'missing_cli' | 'not_logged_in' | 'no_network' | 'unknown';

export interface RuntimeReadinessEntry {
  ok?: boolean;
  state?: string;
  reason?: string;
  checked_at?: string;
  version?: string;
  cli?: 'found' | 'missing' | 'bundled' | 'unknown';
  auth?: 'present' | 'absent' | 'not_required' | 'unknown';
  network?: 'reachable' | 'unreachable' | 'skipped';
  shared_login_count?: number;
}

export type RuntimeReadinessMap = Record<string, RuntimeReadinessEntry>;

export interface ReadinessInput {
  runtimes_supported?: string[];
  runtime_readiness?: RuntimeReadinessMap | null;
}

/** 选服务器页的小胶囊:ready = ✓ 绿 / blocked = ✗ 红 / unknown = ? 灰。 */
export type ReadinessChipKind = 'ready' | 'blocked' | 'unknown';

export interface RuntimeReadinessView {
  /** false = 这台 daemon 根本没报 runtime_readiness ⇒ 按今天的样子画,不灰、不加注。 */
  measured: boolean;
  /** 归一后的 state;没测(measured=false)时为 null。 */
  state: ReadinessState | null;
  chip: ReadinessChipKind | null;
  icon: '✓' | '✗' | '?' | '';
  /** 向导里能不能选。只有 blocked(缺 CLI / 没登录 / 不通网)是 false。 */
  selectable: boolean;
  /** 原因(原样);blocked 必有 —— hub 没给时用按 state 的兜底句。 */
  reason: string | null;
  /** 向导里名字下面那一行:blocked = 原因;unknown = 「未检测」(+ 原因);ready = null。 */
  note: string | null;
  /** shared_login_count > 1 时的提醒:「与 N 个节点共用登录」。 */
  sharedLoginWarning: string | null;
  version: string | null;
  /** unknown 且 CLI 其实找到了 ⇒ 「检测到了,但没探完」,不是「没找到」。 */
  cliDetected?: boolean;
}

export const UNCHECKED_LABEL = '未检测';

/**
 * 「检测到了,但没探完」的标签。
 *
 * admin 2026-10-21 截图:新建节点的 Runtime 步里,OpenCode 那行写「**未检测**:检测到 OpenCode V2;…」——
 * 同一句话里既说「未检测」又说「检测到」,读起来自相矛盾(admin 原话:「怎么 OpenCode 还检测不到」)。
 *
 * 实际数据(daemon-dev 上报):`cli:'found'`、`version:'2.0.22'`、`auth:'unknown'`、`network:'skipped'`。
 * 也就是说 **CLI 是找到了的**,只是 OpenCode 的 provider/登录没法从这台机器探(daemon 故意跳过),
 * 所以 hub 把它归成 unknown。unknown 说的是「没探完」,不是「没找到」——
 * 这两件事必须分开说,否则用户会去装一个已经装好的东西。
 */
export const DETECTED_LABEL = '已检测到';

const BLOCKED_STATES: ReadonlySet<string> = new Set(['missing_cli', 'not_logged_in', 'no_network']);

/** hub 没给 reason 时的兜底(只为不留空白;正常情况下 hub 的 reason 原样显示)。 */
const FALLBACK_REASON: Record<Exclude<ReadinessState, 'ready'>, string> = {
  missing_cli: '这台机器上没找到这个 runtime 的命令行',
  not_logged_in: '这台机器上这个 runtime 还没登录',
  no_network: '这台机器连不上这个 runtime 的服务',
  unknown: '',
};

/** daemon 有没有报 runtime_readiness(是个对象才算;null / 数组 / 字符串都按「没报」)。 */
export function hasReadiness(d: ReadinessInput): boolean {
  const r = d.runtime_readiness;
  return !!r && typeof r === 'object' && !Array.isArray(r);
}

function normState(s: unknown): ReadinessState {
  if (s === 'ready' || s === 'unknown') return s;
  if (typeof s === 'string' && BLOCKED_STATES.has(s)) return s as ReadinessState;
  return 'unknown';
}

const UNMEASURED: RuntimeReadinessView = {
  measured: false, state: null, chip: null, icon: '', selectable: true,
  reason: null, note: null, sharedLoginWarning: null, version: null,
};

export function sharedLoginWarning(count: unknown): string | null {
  return typeof count === 'number' && Number.isFinite(count) && count > 1
    ? `与 ${Math.floor(count)} 个节点共用登录`
    : null;
}

/** 一台 daemon 上一个 runtime 的可用性 → 怎么画。 */
export function readinessFor(d: ReadinessInput, runtimeId: string): RuntimeReadinessView {
  if (!hasReadiness(d)) return UNMEASURED;
  const raw = (d.runtime_readiness as RuntimeReadinessMap)[runtimeId];
  // daemon 报了 readiness,但这个 runtime 没有条目(没测到 / 新 runtime)⇒ 未检测,仍可选。
  if (!raw || typeof raw !== 'object') {
    return { ...UNMEASURED, measured: true, state: 'unknown', chip: 'unknown', icon: '?', note: UNCHECKED_LABEL };
  }
  const state = normState(raw.state);
  const reasonText = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : null;
  const version = typeof raw.version === 'string' && raw.version ? raw.version : null;
  const warn = sharedLoginWarning(raw.shared_login_count);
  if (state === 'ready') {
    return { measured: true, state, chip: 'ready', icon: '✓', selectable: true, reason: null, note: null, sharedLoginWarning: warn, version };
  }
  if (state === 'unknown') {
    // CLI 找到了(cli:'found'/'bundled' 或报出了版本)⇒ 是「没探完」,不是「没找到」。
    const cliDetected = raw.cli === 'found' || raw.cli === 'bundled' || !!version;
    const label = cliDetected ? `${DETECTED_LABEL} CLI${version ? ` ${version}` : ''}` : UNCHECKED_LABEL;
    // 已检测到时用分号连原因:「已检测到 CLI 2.0.22；检测到 OpenCode V2;…」读起来不重复。
    const note = reasonText ? `${label}${cliDetected ? '；' : '：'}${reasonText}` : label;
    return { measured: true, state, chip: 'unknown', icon: '?', selectable: true, reason: reasonText, note, sharedLoginWarning: warn, version, cliDetected };
  }
  const reason = reasonText ?? FALLBACK_REASON[state];
  return { measured: true, state, chip: 'blocked', icon: '✗', selectable: false, reason, note: reason, sharedLoginWarning: null, version };
}

/** 向导里这个 runtime 能不能选(只看 readiness;daemon 声明支持与否另算)。 */
export function readinessSelectable(d: ReadinessInput, runtimeId: string): boolean {
  return readinessFor(d, runtimeId).selectable;
}

export interface ReadinessChip { runtime: string; view: RuntimeReadinessView }

/** 选服务器卡片上那一排胶囊。daemon 没报 readiness ⇒ null(调用方按今天的样子画)。
 *  顺序:先 runtimes_supported 的顺序,再补上 readiness 里有、声明里没有的。 */
export function readinessChips(d: ReadinessInput): ReadinessChip[] | null {
  if (!hasReadiness(d)) return null;
  const ids: string[] = [];
  for (const id of Array.isArray(d.runtimes_supported) ? d.runtimes_supported : []) if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
  for (const id of Object.keys(d.runtime_readiness as RuntimeReadinessMap)) if (!ids.includes(id)) ids.push(id);
  return ids.map(runtime => ({ runtime, view: readinessFor(d, runtime) }));
}

/** 胶囊的提示条 / 读屏文字:「grok-build-acp:✗ 这台机器没装 grok」。 */
export function chipTitle(c: ReadinessChip): string {
  const v = c.view;
  if (v.chip === 'ready') return `${c.runtime}：可以创建${v.version ? `（${v.version}）` : ''}${v.sharedLoginWarning ? `；${v.sharedLoginWarning}` : ''}`;
  if (v.chip === 'blocked') return `${c.runtime}：${v.reason}`;
  return `${c.runtime}：${v.note ?? UNCHECKED_LABEL}`;
}
