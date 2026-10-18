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
import { pollNodeSecretOp, requestNodeSecretOp, type HubConfig, type NodeSecretSnapshot } from './api';
import {
  SECRET_POLL_INTERVAL_MS, keyInputError, mutatingRevision, pollDecision, snapshotView, timeoutHint,
} from './node-secrets-session';
import { buttonStyle, buttonTextStyle } from './elevation';
import { colors, radius, spacing, type, weight } from './theme';

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'queued'; text: string }
  | { kind: 'error'; text: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function NodeSecretsSection({ cfg, nodeId, alias }: { cfg: HubConfig; nodeId: string; alias?: string }) {
  const [snapshot, setSnapshot] = useState<NodeSecretSnapshot | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

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

  const view = snapshotView(snapshot);
  const revision = mutatingRevision(snapshot);
  const busy = phase.kind === 'loading' || phase.kind === 'queued';

  const onSave = async () => {
    const err = keyInputError(key);
    if (err) { setPhase({ kind: 'error', text: err }); return; }
    if (!revision) { setPhase({ kind: 'error', text: '还没拿到节点当前的版本号，先刷新一次再改。' }); return; }
    if (!value) { setPhase({ kind: 'error', text: '值不能为空。' }); return; }
    const snap = await run({ action: 'put', key: key.trim(), value, revision });
    if (snap) { setKey(''); setValue(''); }
  };

  const onDelete = async (k: string) => {
    if (!revision) { setPhase({ kind: 'error', text: '还没拿到节点当前的版本号，先刷新一次再改。' }); return; }
    await run({ action: 'delete', key: k, revision });
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
