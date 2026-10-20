// 节点详情 → 密钥（#1491 E2）。
//
// 数据来自 Hub 的节点密钥 lane：POST 入队 → 节点 ack → GET 轮询。
// 这一页只做三件事：看名字、写一个 key、删一个 key。
//
// 值只出现在「输入框 → POST 请求体」这一跳：不写状态、不写日志、不回显。
// 每次写操作都要带 revision（节点自己报的版本），拿不到 revision 就不允许改 ——
// 猜一个会覆盖操作者在这期间手改的文件。
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { pollNodeSecretOp, requestNodeSecretOp, runNodeLifecycleAction, type HubConfig, type NodeSecretSnapshot } from './api';
import {
  SECRET_POLL_INTERVAL_MS, keyInputError, mutatingRevision, pollDecision, snapshotView, timeoutHint,
} from './node-secrets-session';
import {
  manualRestartCommand, restartChoiceAfterAttempt, restartChoiceAfterSecret, restartChoiceText,
  type RestartChoice,
} from './node-restart-after-secret';
import { buttonStyle, buttonTextStyle } from './elevation';
import { colors, radius, spacing, type, weight } from './theme';

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'queued'; text: string }
  | { kind: 'error'; text: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// #1511 片二 —— 保存后不能只说「下次启动生效」就把用户晾着。节点跑在
// `anet node start` 监督包装下(上报 config_update_capable)就替他排一次带倒计时的
// 重启;否则给出能照抄的手动命令。在线与否、能力三态都从父级传下来。
export default function NodeSecretsSection({
  cfg, nodeId, alias, configUpdateCapable, online,
}: {
  cfg: HubConfig; nodeId: string; alias?: string;
  /** GET /api/nodes/:id/config 的 config_update_capable;undefined = 读取中,null = 读不到。 */
  configUpdateCapable?: boolean | null | undefined;
  /** 节点会话状态不是 offline。 */
  online?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<NodeSecretSnapshot | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  // #1511 —— 保存后的重启二选一 + 倒计时(倒计时内可取消)。
  const [restartChoice, setRestartChoice] = useState<RestartChoice | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const restartTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimer.current) { clearInterval(restartTimer.current); restartTimer.current = null; }
  }, []);
  useEffect(() => () => clearRestartTimer(), [clearRestartTimer]);

  /** 入队 + 轮询到终态。返回 snapshot 或 null。 */
  const run = useCallback(async (body: { action: 'list' | 'put' | 'delete'; key?: string; value?: string; revision?: number }) => {
    setPhase({ kind: 'loading' });
    const queued = await requestNodeSecretOp(cfg, nodeId, body);
    if (!queued.ok) {
      if (mounted.current) setPhase({ kind: 'error', text: queued.message || queued.error });
      return null;
    }
    if (mounted.current) setPhase({ kind: 'queued', text: '已排队，等节点回应（节点在下次启动时应用）…' });
    const startedAt = Date.now();
    for (;;) {
      await sleep(SECRET_POLL_INTERVAL_MS);
      if (!mounted.current) return null;
      const poll = await pollNodeSecretOp(cfg, nodeId, queued.request_id);
      if (!poll.ok) { setPhase({ kind: 'error', text: poll.error }); return null; }
      const decision = pollDecision(poll.status, Date.now() - startedAt);
      if (decision === 'continue') continue;
      if (decision === 'timeout') { setPhase({ kind: 'error', text: timeoutHint() }); return null; }
      if (decision === 'failed') { setPhase({ kind: 'error', text: poll.error === 'secret_operation_unavailable' ? '节点无法执行这次变更（可能没有写权限或文件不合法）' : '节点回报失败' }); return null; }
      const snap = poll.snapshot ?? null;
      setSnapshot(snap);
      setPhase({ kind: 'idle' });
      return snap;
    }
  }, [cfg, nodeId]);

  useEffect(() => {
    if (nodeId) void run({ action: 'list' });
  }, [nodeId, run]);

  // 保存成功后决定二选一;supervised 就排一次带倒计时的重启,倒计时归零才真下发。
  // 下发拿到 Hub 回执后再细化:片一的在途门(node_busy_in_flight)要退回「只提示」。
  const offerRestartAfterSave = useCallback(() => {
    const planned = restartChoiceAfterSecret({ configUpdateCapable, online: online ?? false, alias });
    setRestartChoice(planned);
    if (planned.kind !== 'scheduled') { setCountdown(null); return; }
    clearRestartTimer();
    setCountdown(planned.countdownSeconds);
    let left = planned.countdownSeconds;
    restartTimer.current = setInterval(() => {
      left -= 1;
      if (left > 0) { if (mounted.current) setCountdown(left); return; }
      clearRestartTimer();
      if (mounted.current) setCountdown(null);
      void (async () => {
        const r = await runNodeLifecycleAction(cfg, 'restart_node', { node_id: nodeId, alias: alias ?? '' });
        if (!mounted.current) return;
        setRestartChoice(prev => restartChoiceAfterAttempt(prev ?? planned, r.ok ? { ok: true } : r, alias));
      })();
    }, 1000);
  }, [alias, cfg, clearRestartTimer, configUpdateCapable, nodeId, online]);

  // 用户在倒计时里点了取消:计划作废,退回「你自己重启」——不谎称已安排。
  const cancelScheduledRestart = useCallback(() => {
    clearRestartTimer();
    if (mounted.current) setCountdown(null);
    setRestartChoice({ kind: 'manual', command: manualRestartCommand(alias) });
  }, [alias, clearRestartTimer]);

  const view = snapshotView(snapshot);
  const revision = mutatingRevision(snapshot);
  const busy = phase.kind === 'loading' || phase.kind === 'queued';

  const onSave = async () => {
    const err = keyInputError(key);
    if (err) { setPhase({ kind: 'error', text: err }); return; }
    if (!revision) { setPhase({ kind: 'error', text: '还没拿到节点当前的版本号，先刷新一次再改。' }); return; }
    if (!value) { setPhase({ kind: 'error', text: '值不能为空。' }); return; }
    const snap = await run({ action: 'put', key: key.trim(), value, revision });
    if (snap) { setKey(''); setValue(''); offerRestartAfterSave(); }
  };

  const onDelete = async (k: string) => {
    if (!revision) { setPhase({ kind: 'error', text: '还没拿到节点当前的版本号，先刷新一次再改。' }); return; }
    const snap = await run({ action: 'delete', key: k, revision });
    if (snap) offerRestartAfterSave();
  };

  return (
    <View testID="node-secrets-section" style={{ gap: spacing.sm }}>
      <Text style={{ color: colors.text, fontSize: type.body, fontWeight: weight.strong }}>密钥（节点 .env）</Text>
      <Text style={{ color: colors.textSecondary, fontSize: type.small, lineHeight: 18 }}>
        这里管理本机的 secrets.env。**值只在你输入时出现一次**，保存后 Hub 与界面都不会再回显；
        改动要在节点**下次启动**时才生效。
      </Text>

      {busy ? <ActivityIndicator testID="node-secrets-busy" /> : null}
      {phase.kind === 'queued' ? <Text testID="node-secrets-queued" style={{ color: colors.textSecondary, fontSize: type.small }}>{phase.text}</Text> : null}
      {phase.kind === 'error' ? <Text testID="node-secrets-error" style={{ color: colors.blocked, fontSize: type.small }}>{phase.text}</Text> : null}

      {/* #1511 片二 —— 保存后的重启二选一。scheduled 时给倒计时 + 取消;busy 是
          Hub 片一在途门的回执(节点正在跑任务),只提示不硬来。 */}
      {restartChoice ? (
        <View testID="node-secrets-restart-choice" style={{ gap: spacing.xs }}>
          <Text
            testID={`node-secrets-restart-${restartChoice.kind}`}
            style={{ color: restartChoice.kind === 'busy' ? colors.blocked : colors.textSecondary, fontSize: type.small, lineHeight: 18 }}
          >
            {restartChoiceText(restartChoice)}
            {countdown !== null ? `（剩余 ${countdown} 秒）` : ''}
          </Text>
          {countdown !== null ? (
            <Pressable testID="node-secrets-restart-cancel" disabled={busy} onPress={cancelScheduledRestart}>
              <Text style={{ color: colors.accent, fontSize: type.small }}>取消重启</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {view.kind === 'ok' ? (
        <View testID="node-secrets-list" style={{ gap: spacing.xs }}>
          <Text style={{ color: colors.textSecondary, fontSize: type.small }}>当前 {view.keys.length} 个 key（版本 {view.revision}）</Text>
          {view.keys.map(k => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text testID={`node-secret-key-${k}`} style={{ color: colors.text, fontSize: type.body }}>{k}</Text>
              <Pressable testID={`node-secret-delete-${k}`} disabled={busy} onPress={() => void onDelete(k)}>
                <Text style={{ color: colors.blocked, fontSize: type.small }}>删除</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <TextInput
          testID="node-secret-key-input"
          value={key}
          onChangeText={setKey}
          placeholder="KEY_NAME"
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy}
          style={{ color: colors.text, backgroundColor: colors.inputBg, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control }}
        />
        <TextInput
          testID="node-secret-value-input"
          value={value}
          onChangeText={setValue}
          placeholder="值（不显示、不回显）"
          secureTextEntry
          autoCorrect={false}
          editable={!busy}
          style={{ color: colors.text, backgroundColor: colors.inputBg, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control }}
        />
        <Pressable testID="node-secret-save" disabled={busy} onPress={() => void onSave()} style={buttonStyle('primary')}>
          <Text style={buttonTextStyle('primary')}>{busy ? '处理中…' : '保存到节点'}</Text>
        </Pressable>
        <Pressable testID="node-secrets-refresh" disabled={busy} onPress={() => void run({ action: 'list' })}>
          <Text style={{ color: colors.accent, fontSize: type.small }}>刷新</Text>
        </Pressable>
      </View>
    </View>
  );
}
