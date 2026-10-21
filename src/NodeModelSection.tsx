// 节点详情页「模型」区:读 GET /api/nodes/:id/config,选一个建议模型或手输 id,
// 走 update_node_config(RFC-024)下发,然后轮询 config 直到 revision 抬高且
// model 命中,或 90 s 超时。状态机在 node-model-change.ts(纯,可测)。
//
// 样式约定同 NodeDetailScreen:`styles` 用 live binding、不解构;卡片
// colors.card / 12 圆角 / spacing.lg;按钮沿用 retryBtn。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';

import { fetchNodeConfig, pollOpenCodeCatalog, queueOpenCodeCatalog, updateNodeConfig, type HubConfig, type HubNode, type NodeConfigRead } from './api';
import { styles } from './app-styles';
import {
  afterPoll,
  afterSubmit,
  catalogHint,
  modelNotOnMachineNote,
  modelChips,
  modelControlAvailability,
  phaseIsBusy,
  phaseText,
  RESTART_POLL_MS,
  RESTART_TIMEOUT_MS,
  validateModelId,
  type ModelChangePhase,
} from './node-model-change';
import { suggestedModels } from './runtime-catalog';
import { catalogErrorText, isOpenCodeV2Node, modelIdsFromCatalog } from './opencode-v2-model-list';
import { nodeProviderDaemon } from './node-provider-target';
import { colors, spacing, radius } from './theme';

export default function NodeModelSection({ cfg, node }: { cfg: HubConfig; node: HubNode }) {
  // undefined = 还没读到;null = hub 没有这个接口
  const [view, setView] = useState<NodeConfigRead | null | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [picked, setPicked] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [phase, setPhase] = useState<ModelChangePhase>({ kind: 'idle' });
  const v2 = isOpenCodeV2Node(node);
  const [v2Models, setV2Models] = useState<string[] | null>(null);
  const [v2Note, setV2Note] = useState('');

  const reload = useCallback(async () => {
    try {
      const v = await fetchNodeConfig(cfg, node.node_id);
      setView(v);
      setReadFailed(false);
      return v;
    } catch {
      setReadFailed(true);
      return null;
    }
  }, [cfg, node.node_id]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!v2) return;
    let live = true;
    const daemonId = nodeProviderDaemon(node);
    if (!daemonId) {
      setV2Models([]);
      setV2Note('这个节点没有所属 daemon，读不到 OpenCode 服务器上的模型列表。仍可手输 provider/model。');
      return;
    }
    setV2Note('正在从 OpenCode V2 服务器读取模型列表…');
    void (async () => {
      const queued = await queueOpenCodeCatalog(cfg, { nodeId: node.node_id, daemonNodeId: daemonId });
      if (!live) return;
      if (!queued.ok) { setV2Models([]); setV2Note(catalogErrorText(queued.error)); return; }
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!live) return;
        const polled = await pollOpenCodeCatalog(cfg, queued.request_id);
        if (!live) return;
        if (!polled.ok) { setV2Models([]); setV2Note(catalogErrorText(polled.error)); return; }
        if (polled.status === 'ready') {
          const ids = modelIdsFromCatalog(polled.snapshot);
          setV2Models(ids);
          setV2Note(ids.length ? '列表来自这台机器上的 OpenCode V2 服务器，不是内置清单。' : 'OpenCode 服务器返回了空列表。仍可手输 provider/model。');
          return;
        }
      }
      if (live) { setV2Models([]); setV2Note('OpenCode 服务器还没返回模型列表。仍可手输 provider/model。'); }
    })();
    return () => { live = false; };
  }, [v2, cfg, node.node_id, node.lifecycle_daemon_node_id, node.adoption?.daemon_node_id, node.adoption?.status]);

  const requested = phase.kind === 'restarting' ? phase.requested : null;
  const baseRevision = phase.kind === 'restarting' ? phase.baseRevision : null;
  // One observation window per accepted change, independent of read latency.
  // Expiry/cleanup invalidates in-flight reads; it never cancels or resubmits
  // the server-side change. Poll counts must not reset the deadline.
  useEffect(() => {
    if (requested === null || baseRevision === null) return;
    let active = true;
    let current: Extract<ModelChangePhase, { kind: 'restarting' }> = { kind: 'restarting', requested, baseRevision, polls: 0 };
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    const expire = () => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      setPhase({ kind: 'timeout', requested });
    };
    const deadlineTimer = setTimeout(expire, RESTART_TIMEOUT_MS);
    const tick = async () => {
      if (!active) return;
      if (Date.now() >= deadline) { expire(); return; }
      let v: NodeConfigRead | null = null;
      let failed = false;
      try { v = await fetchNodeConfig(cfg, node.node_id); } catch { failed = true; }
      if (!active) return;
      if (Date.now() >= deadline) { expire(); return; }
      if (!failed) setView(v);
      setReadFailed(failed);
      const next = afterPoll(current, v);
      setPhase(next);
      if (next.kind === 'restarting') {
        current = next;
        timer = setTimeout(tick, RESTART_POLL_MS);
      } else {
        active = false;
        clearTimeout(deadlineTimer);
      }
    };
    timer = setTimeout(tick, RESTART_POLL_MS);
    return () => { active = false; clearTimeout(timer); clearTimeout(deadlineTimer); };
  }, [requested, baseRevision, cfg, node.node_id]);

  const availability = modelControlAvailability(view === undefined ? null : view);
  const busy = phaseIsBusy(phase);
  const suggestions = v2 ? (v2Models ?? []) : suggestedModels(node.runtime);
  const currentModel = view?.model ?? node.model ?? node.config_snapshot?.model ?? null;
  const candidate = custom.trim() ? custom : picked;
  const chips = modelChips(suggestions, currentModel);
  const hint = v2 ? v2Note : catalogHint(node.runtime);
  // 只在 V2 目录**读到了**的时候才谈「不在列表里」:目录为空/读不到 ⇒ 不知道,不乱报。
  const notOnMachine = v2 && (v2Models?.length ?? 0) > 0 ? modelNotOnMachineNote(currentModel, v2Models ?? []) : null;

  const submit = async () => {
    if (!view || busy) return;
    const v = validateModelId(candidate);
    if (!v.ok) { setPhase({ kind: 'error', message: v.reason }); return; }
    if (v.model === currentModel) { setPhase({ kind: 'error', message: '和当前模型相同,无需修改' }); return; }
    setPhase({ kind: 'submitting', requested: v.model });
    const res = await updateNodeConfig(cfg, { nodeId: node.node_id, baseRevision: view.config_revision, patch: { model: v.model } });
    const next = afterSubmit(v.model, view.config_revision, res);
    if (next.kind === 'conflict') void reload();
    setPhase(next);
  };

  return (
    <View style={{ paddingTop: spacing.xl }}>
      <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm }}>模型</Text>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: colors.textMuted, width: 96, fontSize: 13 }}>当前模型</Text>
          <Text style={{ color: colors.text, flex: 1, fontSize: 14 }} selectable>
            {currentModel || (view === undefined && !readFailed ? '读取中…' : '—')}
          </Text>
        </View>
        {readFailed && view === undefined ? (
          <Text style={{ color: colors.failed, fontSize: 12 }}>读取节点配置失败。<Text style={{ color: colors.accent }} onPress={() => void reload()}>重试</Text></Text>
        ) : null}
        {view !== undefined && !availability.enabled ? (
          <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{availability.hint}</Text>
        ) : null}
        {availability.enabled ? (
          <>
            <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
              改模型不经过任何大模型:Hub 下发后节点自己写配置并重启一次(约 5–45 秒),期间它不接任务。
            </Text>
            {v2 && hint ? <Text testID="opencode-v2-models-note" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{hint}</Text> : null}
            {notOnMachine ? (
              <Text testID="model-not-on-machine" style={{ color: colors.blocked, fontSize: 12, lineHeight: 18 }}>{notOnMachine}</Text>
            ) : null}
            {chips.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>建议</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {chips.map(m => {
                  const active = !custom.trim() && (picked ? picked === m : m === currentModel);
                  return (
                    <Pressable
                      key={m}
                      disabled={busy}
                      onPress={() => { setPicked(m); setCustom(''); }}
                      style={({ pressed }) => [
                        { borderWidth: 1, borderRadius: radius.control, paddingHorizontal: spacing.md, height: 34, justifyContent: 'center', borderColor: active ? colors.accent : colors.border, backgroundColor: colors.card },
                        pressed && { opacity: 0.7 },
                        busy && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={{ color: active ? colors.accent : colors.text, fontSize: 13 }}>{m}{m === currentModel ? '(当前)' : ''}</Text>
                    </Pressable>
                  );
                })}
                </View>
                {!v2 && hint ? <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{hint}</Text> : null}
              </View>
            ) : null}
            <TextInput
              value={custom}
              onChangeText={setCustom}
              editable={!busy}
              placeholder={suggestions.length > 0 ? '或手输模型 id(provider/model)' : '模型 id(provider/model)'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.md, height: 36, color: colors.text, fontSize: 13 }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Pressable
                disabled={busy || !candidate}
                onPress={() => void submit()}
                style={({ pressed }) => [styles.retryBtn, (busy || !candidate) && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.retryBtnText}>{busy ? '处理中…' : '切换模型'}</Text>
              </Pressable>
              {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            </View>
          </>
        ) : null}
        {phase.kind !== 'idle' ? (
          <Text style={{ color: phase.kind === 'applied' ? colors.running : phase.kind === 'error' || phase.kind === 'timeout' || phase.kind === 'conflict' ? colors.failed : colors.textMuted, fontSize: 12, lineHeight: 18 }}>
            {phaseText(phase)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
