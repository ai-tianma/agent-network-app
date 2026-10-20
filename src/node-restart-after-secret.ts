// #1511 片二 —— 密钥保存后的「重启二选一」纯逻辑。
//
// 场景:用户在 app 里改了节点密钥。Hub 的密钥 lane 只保证「存进节点本机文件」,
// 真正生效要节点下次启动。所以保存成功后必须把二选一讲清楚,而不是含糊一句
// 「下次启动生效」就把用户晾在那儿:
//   * supervised —— 节点跑在 `anet node start` 的监督包装下,会在 config_snapshot
//     里上报 config_update_capable=true。这种节点自己 exit 75 之后包装会原地拉起,
//     app 可以替用户安排一次重启(带倒计时,倒计时内随时可取消);
//   * manual —— 裸起的节点,或者老 Hub 没有 GET /api/nodes/:id/config(读不到能力)。
//     这种只能提示用户自己去那台机器上重启,并把命令写出来。
//
// 第三种是安排之后 Hub 拒了:node_busy_in_flight —— #1511 片一在 Hub 加的在途门
// (正在跑任务时不自动重启,只提示)。这时绝不能硬来,退回「只提示」。
//
// 三条判据:
//   * 三态照搬 configUpdateCapable:undefined = 还没读到,不替用户猜 —— 猜「能」会在
//     真需要手动重启的节点上排一次注定失败的重启,猜「不能」又把能自动的推给用户;
//   * 密钥值不进任何文案(连错误里也不该有);
//   * 「安排重启」只是排程:倒计时内可取消,app 不做无提示的副作用。
import type { NodeLifecycleResult } from './api';

/** 倒计时秒数。给用户一个明确的取消窗口,又不至于长到让人以为卡住。 */
export const RESTART_COUNTDOWN_SECONDS = 5;

export type RestartChoice =
  /** 已安排重启,倒计时内可取消。 */
  | { kind: 'scheduled'; countdownSeconds: number }
  /** 倒计时走完,Hub 已接受重启指令(节点 exit 75 → 启动器原地拉起)。 */
  | { kind: 'restarted' }
  /** 需要用户自己去节点那台机器上重启;command 是可直接照抄的命令。 */
  | { kind: 'manual'; command: string }
  /** 安排了但 Hub 拒了(节点正在跑任务)—— 只提示,不重启。 */
  | { kind: 'busy'; inFlightCount: number }
  /** config_update_capable 还没读到,不能替用户下判断。 */
  | { kind: 'unknown' };

/** 手动重启要给用户一句能直接照抄的话。拿不到 alias 就只说在哪重启。 */
export function manualRestartCommand(alias?: string): string {
  const a = (alias ?? '').trim();
  return a ? `anet node start ${a}` : '到节点所在的机器上重启该节点';
}

/**
 * 保存成功后该走哪条路。
 *
 * `configUpdateCapable` 三态(与 node-danger-actions 同一套语义):
 *   undefined = 还没读到 → unknown;
 *   true + 在线 → 可以安排(Hub 的 restart_node 不需要 daemon,节点自己 exit 75);
 *   true 但离线 → 也不行:节点没在跑就没有 SSE 收重启事件,安排了也不会发生 → manual;
 *   false / null(Hub 没有 config 接口) → manual。
 */
export function restartChoiceAfterSecret(input: {
  configUpdateCapable: boolean | null | undefined;
  online: boolean;
  alias?: string;
}): RestartChoice {
  if (input.configUpdateCapable === undefined) return { kind: 'unknown' };
  if (input.configUpdateCapable === true && input.online) {
    return { kind: 'scheduled', countdownSeconds: RESTART_COUNTDOWN_SECONDS };
  }
  return { kind: 'manual', command: manualRestartCommand(input.alias) };
}

/**
 * 安排的重启真跑过一次之后,把计划细化成最终该显示的那条。
 *
 * 只有 planned 是 scheduled 才会被改写 —— manual / busy / unknown 不该被一次
 * 没发生的调用抬高成「已安排」。attempt 为 null 表示还没到点(倒计时中 / 已取消),
 * 计划维持原样。
 */
export function restartChoiceAfterAttempt(
  planned: RestartChoice,
  attempt: NodeLifecycleResult | null,
  alias?: string,
): RestartChoice {
  if (planned.kind !== 'scheduled') return planned;
  if (!attempt) return planned;
  // 已经下发成功就落到终态 —— 继续挂「已安排(N 秒后,可取消)」会误导:
  // 倒计时早已走完,既没得取消也没再安排一次。
  if (attempt.ok) return { kind: 'restarted' };
  // #1511 Hub 在途门:节点正在跑任务。绝不能重试硬闯,明确告诉用户等它完成。
  if (attempt.error === 'node_busy_in_flight') {
    return { kind: 'busy', inFlightCount: attempt.in_flight_count ?? 0 };
  }
  // 其它失败一律退回手动 —— 不谎称已安排。用户至少拿到能照抄的命令。
  return { kind: 'manual', command: manualRestartCommand(alias) };
}

/**
 * 用户可见文案。
 *
 * 每条都要自解释「现在是什么状态 + 下一步做什么」;busy 那条必须点明
 * 「节点正在执行任务」,否则用户会以为是自己操作错了。
 */
export function restartChoiceText(choice: RestartChoice): string {
  switch (choice.kind) {
    case 'scheduled':
      return `密钥已保存。已安排重启（${choice.countdownSeconds} 秒后生效），倒计时内可取消。`;
    case 'restarted':
      return '密钥已保存。重启指令已下发，节点会自己退出再拉起，稍后会回来。';
    case 'manual':
      return `密钥已保存。此节点需要你自己重启后生效：${choice.command}`;
    case 'busy':
      return '密钥已保存，但节点正在执行任务，本次未安排重启；等它完成后再试，或到节点所在机器手动重启。';
    case 'unknown':
      return '密钥已保存。正在确认这个节点能否远程重启…';
  }
}
