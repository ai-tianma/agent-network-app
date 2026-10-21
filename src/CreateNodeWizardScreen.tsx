import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { createNode, CreateNodeRequest, fetchNodeStatus, HostSupervisorDaemon, HubConfig, Session, fetchCreateRequestStatus } from './api';
import { creationConfirmed, createRequestVerdict, timeoutMessage, type CreateRequestVerdict } from './create-request-status';
import { colors, onThemeChange, spacing, radius, type as typeScale } from './theme';
import { advancedExpanded, advancedRuntimesOf, primaryRuntimes, runtimeDisplayLabel, showsAdvancedToggle, type WizardRuntime } from './wizard-runtime-groups';
import { PANE_BACK_TEST_ID, paneShowsBack } from './pane-header';
import { buildCreateNodeSpec, describeCopresenceError, wizardParamsFor } from './create-node-request';
import { STEP_DESCRIPTIONS, STEP_TITLES, skippedStepsLine, stepAfter, stepBefore, stepState, visibleStep, wizardSteps, type WizardStepKey } from './create-node-steps';
import { defaultWorkdir, describeWorkdirError, randomHex6, workdirError, workdirForRequest, workdirRootOf, workdirSlug } from './create-node-workdir';
import { checkNodeName, describeNodeNameRejection, folderError, normalizeNodeName, NODE_NAME_HINT } from './node-name';
import { buttonStyle, buttonTextStyle, elevated } from './elevation';
import { readinessFor, readinessSelectable } from './runtime-readiness';
import { describeOpenCodeCreateError, opencodeCreateError, OPENCODE_GENERATION_LABELS, OPENCODE_V1_NOTE, OPENCODE_V2_WARNING, type OpenCodeGeneration } from './opencode-create-options';
import CodexProviderFields from './CodexProviderFields';
import { ProviderConfigDemo } from './BackendPendingDemo';
import DaemonRuntimeProviders from './DaemonRuntimeProviders';
import DaemonCreateProvider from './DaemonCreateProvider';
import type { CreateProviderReference } from './daemon-provider-create';
import OpenCodeProviderNote from './OpenCodeProviderNote';
import { readListProviders } from './daemon-provider-read';
import { displayDaemonProviders, type TaggedProvider } from './daemon-runtime-providers';
import { useTranslation } from './i18n-react';
import './i18n-provider';
import {
  EMPTY_PROVIDER_FORM,
  codexSubmitGate,
  describeProviderCreateError,
  hubTransportAllowsSecrets,
  presetLabelKey,
  providerIssueI18nKey,
  providerLocalIssues,
  providerSummary,
  providerSurface,
  reconcileProviderForm,
  scrubSecret,
  type ProviderFormValue,
} from './provider-create-options';

// #338 RFC-026 §3.1 — mobile create-node wizard rest (Plan B).
// Up to 5 post-picker steps: ① name ② runtime ③ model ④ flags ⑤ confirm.
// #614: a step with nothing to choose (model / flags for the co-presence runtimes) is not shown —
// its info is one line on the confirm page. The step table lives in create-node-steps.ts.
// On submit POST /mcp create_node, then poll identity-bearing node status until the
// child alias shows up in the session list. A `ok:true` from the RPC
// means "hub accepted the call", not "the child is running". Success needs
// the exact request/node identity; V2 additionally needs daemon launch proof.
//
// React rules of hooks compliance: ALL useState/useEffect/useRef
// declared BEFORE any conditional early return — guards against the
// v0.1.29 launch-crash class (Vincent tg 1098). Conditionally
// declaring hooks after an early-return branches the hook order and
// crashes the JS engine when React tries to match hook indices
// across renders.
//
// Runtime step filters by daemon.runtimes_supported when published;
// permissive fallback when absent. Mirrors PR4-A dashboard behavior.

// Hub-side validator enums (server/src/create-node-validate.ts:20,57).
// MUST match exactly — a stale id here ships invalid combos to the hub
// and surfaces only at submit failure. Caught via local curl probe
// during wizard build, not as a regression.
// Hub-side name validator: checkNodeName in ./node-name (a verbatim copy of the Hub/daemon
// shared module server/src/shared/node-name.ts, #652). The wizard MUST surface the same
// rule at step 1 — otherwise a name walks all 5 steps and fails with node_name_invalid only
// after submit (通信龙 #3 B2 catch). Before #652 the rule was /^[a-z][a-z0-9_-]{0,63}$/ and
// refused 「测试」; now the name may be Chinese and the folder (working directory) stays ASCII.

const RUNTIMES: WizardRuntime[] = [
  { id: 'claude-agent-sdk', label: 'Claude Agent SDK', models: ['deepseek-v4-pro', 'MiniMax-M3', 'claude-sonnet-4-6', 'claude-opus-4-x'] },
  { id: 'codex-sdk', label: 'Codex SDK', models: ['gpt-5.5'] },
  // Grok 只显示一行,建出来是 headless ACP(owner 2026-09-25 定为默认/推荐)。
  { id: 'grok-build-acp', label: 'Grok', models: ['grok-build'] },
  // 共存 runtime：复用宿主 TUI 的会员登录态，不选模型、不输 key。
  // models 为空数组 ⇒ 第 3 步显示「跟随宿主登录」，提交时省略 model
  // 字段（hub 侧自 da84f34d 起 model optional/nullable）。
  { id: 'claude-code-cli', label: 'Claude Code（TUI 共存）', models: [] },
  { id: 'codex-app-server', label: 'Codex（TUI 共存）', models: [] },
  // grok TUI 共存降为「实验性」(owner 2026-09-25):不进主列表,收在 Grok 行的「高级」折叠里,
  // 展开即显示限制。id 不变 ⇒ 已有的 grok-build-cli 节点不受影响。
  { id: 'grok-build-cli', label: '共存模式（实验性）', models: [], advancedOf: 'grok-build-acp', note: '实验性：人在 TUI 输入框打字时网络任务会排队直到超时；grok 须钉在已验证版本（新版会拒绝启动）；macOS 需特殊处理；不加载 .agents/skills 技能。要稳定接活用上面的 Grok（ACP，默认）。' },
  // #199 —— hub / daemon / CLI 三处的 runtime 全集都是 7 个,只有这里是 6 个。
  // `opencode-cli` 出现在 agent-network/src/codex-copresence-profile.ts:223 的共存
  // profile 里。(目录名叫 opencode-**acp**,但 runtime id 只有 opencode-**cli** ——
  //  normalize-runtime.ts:108 把两者归一。)
  // 🔴 与上面三个不同:OpenCode 共存 runtime **要求显式 provider/model**
  //  (agent-node opencode-copresence/runtime.ts requireOpenCodeCopresenceModel),
  //  models 留空 ⇒ 提交省略 model ⇒ daemon 起子节点时「OpenCode copresence requires an explicit
  //  provider/model」(2026-09-07 Mac mini 真跑抓到)。这里给 OpenCode 自带的免费模型(不需要任何 key,
  //  DEV 上 opencode-指挥狗 / opencode测试1号 就用它们);要用别的 provider 走 anet opencode auth-login。
  { id: 'opencode-cli', label: 'OpenCode', models: ['opencode/mimo-v2.6-flash-free', 'opencode/north-mini-code-free'] },
];
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

// 初始 runtime:daemon 声明支持、且(#623)没被 runtime_readiness 判为建不了的第一个 ——
// 先主列表,再「高级」折叠项(不把实验性 runtime 当默认)。一个都没有时退回原来的取法
// (第一个声明支持的),由 Runtime 步把原因摆出来。daemon 没报 readiness 时结果与以前完全相同。
function initialRuntime(daemon: HostSupervisorDaemon): WizardRuntime {
  const supported = daemon.runtimes_supported;
  const declared = Array.isArray(supported) && supported.length > 0;
  const usable = (r: WizardRuntime) => (!declared || supported!.includes(r.id)) && readinessSelectable(daemon, r.id);
  const pick = primaryRuntimes(RUNTIMES).find(usable) ?? RUNTIMES.find(usable);
  if (pick) return pick;
  if (declared) return primaryRuntimes(RUNTIMES).find(r => supported!.includes(r.id)) ?? RUNTIMES.find(r => supported!.includes(r.id)) ?? RUNTIMES[0];
  return RUNTIMES[0];
}

type Phase = 'form' | 'creating' | 'awaiting_register' | 'done' | 'error';

export interface CreateNodeWizardScreenProps {
  cfg: HubConfig;
  daemon: HostSupervisorDaemon;
  onBack: () => void;       // back to picker
  onExit: () => void;       // close wizard entirely (after done or cancel)
  /** Tauri desktop workspace: the server sidebar selects this page — no phone back in the header
   *  (pane-header.ts). The footer's 「返回服务器」 step button stays: it is part of the flow. */
  desktop?: boolean;
}

export default function CreateNodeWizardScreen({ cfg, daemon, onBack, onExit, desktop = false }: CreateNodeWizardScreenProps) {
  // ── All hooks FIRST (no conditional-hook regressions) ──────────────
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStepKey>('name');
  const [name, setName] = useState('');
  // Initial runtime: first supported (and, #623, not reported unusable) by the daemon; else default.
  const [runtimeId, setRuntimeId] = useState(() => initialRuntime(daemon).id);
  // Initialize model to the runtime's first model (NEVER ''). Hub
  // schema requires model.min(1) (tools.ts:1977); a 默认/empty pick
  // makes the create_node call zod-reject which then surfaces as a
  // misleading "需升级 hub" message — caught by 通信龙 #3 CHANGE_REQ.
  // No "默认" option in step 2 anymore; we pick first explicitly.
  const [model, setModel] = useState(() => initialRuntime(daemon).models[0] || '');
  // 「高级」折叠(目前只有 Grok 行有:共存模式·实验性)。默认收起。
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState('default');
  const [maxTurns, setMaxTurns] = useState('');
  const [budget, setBudget] = useState('');
  const [opencodeGeneration, setOpenCodeGeneration] = useState<OpenCodeGeneration>('v1');
  const [opencodeUnsafeTools, setOpenCodeUnsafeTools] = useState(false);
  const [codexAutoExecute, setCodexAutoExecute] = useState(true);
  const [providerForm, setProviderForm] = useState<ProviderFormValue>(EMPTY_PROVIDER_FORM);
  const [providerResetHint, setProviderResetHint] = useState('');
  const [daemonProviderRows, setDaemonProviderRows] = useState<TaggedProvider[]>([]);
  const [daemonProviderRead, setDaemonProviderRead] = useState<'pending' | 'ok' | 'unsupported' | 'error'>('pending');
  const managedIdentity = JSON.stringify([cfg.serverUrl, cfg.token, cfg.networkId, daemon.daemon_node_id, runtimeId]);
  const [managedModeState, setManagedModeState] = useState('');
  const [managedSelectionState, setManagedSelectionState] = useState<{ identity: string; value: CreateProviderReference } | null>(null);
  const managedMode = runtimeId === 'codex-app-server' && managedModeState === managedIdentity;
  const managedSelection = managedMode && managedSelectionState?.identity === managedIdentity ? managedSelectionState.value : null;
  // 工作目录:null = 没改过,跟着名字走(<root>/<name>);改过之后固定为用户填的值。
  const [workdirEdited, setWorkdirEdited] = useState<string | null>(null);
  const [workdirOpen, setWorkdirOpen] = useState(false);
  // 名字转不出 ASCII 时的兜底目录名;整个向导里固定一个,不随重渲染变。
  const [workdirFallback] = useState(() => `node-${randomHex6()}`);
  // #652 —— 第 1 步名字下面的「文件夹」:null = 没改过,跟着名字走(workdirSlug);改过之后固定为用户填的值。
  const [folderEdited, setFolderEdited] = useState<string | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [msg, setMsg] = useState('');

  // childUp = this request's node and completion evidence are confirmed.
  // We poll up to ~45s before giving up
  // and showing an "unconfirmed" message — matches dashboard wizard.
  const [childUp, setChildUp] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const submittedSpec = useRef<CreateNodeRequest['node_spec'] | null>(null);
  const pollAlive = useRef(true);

  // #906 —— list_providers 只补 daemon 没带上的、且标了 runtime 的行。响应体不进日志。
  useEffect(() => {
    let alive = true;
    readListProviders({ serverUrl: cfg.serverUrl, token: cfg.token, networkId: cfg.networkId }).then(result => {
      if (!alive) return;
      setDaemonProviderRead(result.kind);
      if (result.kind === 'ok') setDaemonProviderRows(result.rows);
    });
    return () => { alive = false; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId]);

  // Stop polling on unmount + on screen exit
  useEffect(() => {
    pollAlive.current = true;
    return () => { pollAlive.current = false; };
  }, []);

  // Request failure takes precedence over roster visibility. Never reuse a
  // previous tick's row after a transient read failure.
  useEffect(() => {
    if (phase !== 'awaiting_register' || childUp) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const alive = () => active && pollAlive.current;
    const want = normalizeNodeName(name);
    let lastVerdict: CreateRequestVerdict = { kind: 'unknown' };
    // Bound elapsed waiting independently of slow reads (including response
    // bodies). Expiry invalidates in-flight results; it does not cancel the
    // accepted server-side creation or automatically submit another request.
    const deadlineTimer = setTimeout(() => {
      if (!alive()) return;
      active = false;
      clearTimeout(timer);
      setPhase('done');
      setMsg(timeoutMessage(lastVerdict));
    }, 45_000);
    const tick = async () => {
      if (!alive()) return;
      if (requestId) {
        try {
          const row = await fetchCreateRequestStatus(cfg, requestId);
          if (!alive()) return;
          lastVerdict = createRequestVerdict(row, want);
          if (lastVerdict.kind === 'failed') {
            setPhase('error');
            setMsg(`创建失败:${lastVerdict.text}`);
            return;
          }
          if (lastVerdict.kind === 'waiting') setMsg(lastVerdict.text);
          // Unfiltered light status intentionally omits node_id. Use the
          // existing scoped details read, then still verify exact child ID.
          const data = await fetchNodeStatus(cfg, want);
          if (!alive()) return;
          const list: Session[] = Array.isArray(data?.sessions) ? data.sessions : [];
          // Re-read after the roster fetch: a late daemon failure during that
          // await must override early registration in the same tick.
          const latest = await fetchCreateRequestStatus(cfg, requestId);
          if (!alive()) return;
          lastVerdict = createRequestVerdict(latest, want);
          if (lastVerdict.kind === 'failed') {
            setPhase('error');
            setMsg(`创建失败:${lastVerdict.text}`);
            return;
          }
          if (creationConfirmed(latest, {
            requestId, name: want, runtime: runtimeId,
            // Use the submitted request, not current UI selection or a field
            // an older Hub might silently omit. V1 has no V2 launch proof.
            requireLaunchVerification: submittedSpec.current?.flags?.opencodeGeneration === 'v2',
          }, list)) {
            setChildUp(true);
            setPhase('done');
            return;
          }
          if (lastVerdict.kind === 'waiting') setMsg(lastVerdict.text);
        } catch { /* Transient: do not infer success from the roster alone. */ }
      }
      if (alive()) {
        timer = setTimeout(tick, 1500);
      }
    };
    timer = setTimeout(tick, 1200);
    return () => { active = false; clearTimeout(timer); clearTimeout(deadlineTimer); };
  }, [phase, childUp, cfg, name, requestId, runtimeId]);

  // Derived: runtime details + nav gates
  const runtime = RUNTIMES.find(r => r.id === runtimeId) || RUNTIMES[0];
  // #591 —— 第 4 步「参数」只摆这个 runtime 真会读的设置。
  const params = wizardParamsFor(runtimeId);
  // #614 —— 实际显示的步骤:没有可选项的「模型」「参数」不出现(create-node-steps.ts)。
  // 编号、上一步/下一步都只在这张表里走;`cur` 永远是表里的一步(切了 runtime 也不会落进被跳过的页)。
  const steps = wizardSteps(runtimeId, runtime.models);
  const cur = visibleStep(steps, step);
  const nextStep = stepAfter(steps, cur);
  const prevStep = stepBefore(steps, cur);
  const skippedLine = skippedStepsLine(runtimeId, runtime.models);
  // Mirror the hub rule — the UX must surface exactly what the hub will
  // accept, not a looser local rule. A looser client-side check would
  // let the user submit names that the server then rejects, turning
  // "validation" into a delayed failure the user has to guess at.
  const nameCheck = checkNodeName(name);
  const nameValid = nameCheck.ok;
  const isRuntimeSupported = useCallback((id: string) => {
    const supported = daemon.runtimes_supported;
    if (!Array.isArray(supported) || supported.length === 0) return true;
    return supported.includes(id);
  }, [daemon.runtimes_supported]);
  // #623 —— 能选 = daemon 声明支持 且 runtime_readiness 没判它建不了(缺 CLI / 没登录 / 不通网)。
  // 没报 readiness ⇒ readinessSelectable 恒 true,与以前一致。
  const isRuntimeAllowed = useCallback(
    (id: string) => isRuntimeSupported(id) && readinessSelectable(daemon, id),
    [isRuntimeSupported, daemon],
  );
  // (#3 nit ②) If the daemon's declared runtimes all sit outside our
  // known RUNTIMES list (e.g. App is older than the daemon, or the
  // daemon advertises a future-only runtime), the wizard would init
  // runtimeId to RUNTIMES[0] which is then disabled by isRuntimeAllowed
  // — canNext gates at step 1 forever, user trapped. Detect and surface
  // an empty-state instead of pretending to be functional.
  const hasUsableRuntime =
    !Array.isArray(daemon.runtimes_supported) ||
    daemon.runtimes_supported.length === 0 ||
    RUNTIMES.some(r => daemon.runtimes_supported!.includes(r.id));
  // 老 daemon/hub 不带 default_workdir_root → null → 文件夹 / 工作目录两行都隐藏、请求不带 workdir。
  const workdirRoot = workdirRootOf(daemon);
  // #652 —— 文件夹(工作目录最后一段):默认 = 名字的 ASCII slug(中文转拼音);在第 1 步可改,规则 ^[a-z][a-z0-9-]{0,63}$。
  const folder = folderEdited ?? workdirSlug(name, workdirFallback);
  const folderErr = workdirRoot && folderEdited !== null ? folderError(folderEdited) : null;
  const openCodeError = opencodeCreateError({ runtimeId, opencodeGeneration, opencodeUnsafeTools, model });
  const daemonModelChoices = (() => {
    const shown = displayDaemonProviders({ daemon, rows: daemonProviderRows, read: daemonProviderRead, runtimeId, opencodeGeneration });
    if (shown.kind === 'opencode') return shown.models;
    if (shown.kind === 'codex' || shown.kind === 'listed') return shown.providers.flatMap(p => p.models);
    return [];
  })();
  const surface = providerSurface(runtimeId, opencodeGeneration);
  const transportOk = hubTransportAllowsSecrets(cfg.serverUrl);
  const providerIssues = providerLocalIssues({ runtimeId, ...providerForm }, transportOk);
  const canNext =
    hasUsableRuntime &&
    (
      (cur === 'name' && nameValid && !folderErr) ||
      (cur === 'runtime' && isRuntimeAllowed(runtimeId) && (runtimeId !== 'opencode-cli' || opencodeGeneration !== 'v2' || opencodeUnsafeTools) && providerIssues.length === 0 && (!managedMode || !!managedSelection)) ||
      (cur === 'model' && !openCodeError) || cur === 'params'
    );
  const busy = phase === 'creating' || phase === 'awaiting_register';
  // 确认页上显式改过完整路径(workdirEdited)优先;否则 <root>/<文件夹>。
  const workdir = workdirEdited ?? (workdirRoot ? defaultWorkdir(workdirRoot, folder) : '');
  const workdirErr = workdirRoot ? workdirError(workdir, workdirRoot) : null;
  const canSubmit = !workdirErr && !openCodeError && nameValid && isRuntimeAllowed(runtimeId) && (!managedMode || !!managedSelection);

  // ── handlers (no hooks below this line) ────────────────────────────
  // One runtime choice row. `nested` = it lives inside a 「高级」 disclosure:
  // indented, and its note (the experimental warning) shows as soon as the
  // disclosure is open — the cost is visible BEFORE it is picked.
  const renderRuntimeRow = (r: WizardRuntime, nested: boolean) => {
    const supported = isRuntimeSupported(r.id);
    // #623 —— 这台机器上这个 runtime 的实测状态(没报 = 不灰、不加注)。
    const ready = readinessFor(daemon, r.id);
    const allowed = supported && ready.selectable;
    const blockedByReadiness = supported && !ready.selectable;
    const selected = runtimeId === r.id;
    const showNote = !!r.note && allowed && (selected || nested);
    return (
      <Fragment key={r.id}>
        <Pressable
          testID={`runtime-row-${r.id}`}
          accessibilityRole="radio"
          accessibilityState={{ disabled: !allowed, checked: selected && allowed }}
          aria-checked={selected && allowed}
          disabled={!allowed}
          onPress={() => {
            if (allowed) {
              const nextForm = reconcileProviderForm(runtimeId, r.id, providerForm);
              setRuntimeId(r.id);
              setManagedModeState(''); setManagedSelectionState(null);
              setOpenCodeGeneration('v1');
              setOpenCodeUnsafeTools(false);
              // Reset model to the FIRST of the new runtime
              // (never ''). Same reasoning as initial state
              // — hub schema requires non-empty model.
              setModel(r.models[0] || '');
              setProviderForm(nextForm.form);
              setProviderResetHint(nextForm.cleared ? t('provider.cleared') : '');
            }
          }}
          style={({ pressed }) => [
            styles.choiceRow,
            nested && styles.choiceRowNested,
            selected && allowed && styles.choiceRowSelected,
            !supported && styles.choiceRowDisabled,
            blockedByReadiness && styles.choiceRowBlocked,
            pressed && allowed && { opacity: 0.85 },
          ]}
        >
          <View style={styles.choiceMain}>
            <Text style={[
              styles.choiceText,
              selected && allowed && styles.choiceTextSelected,
              !allowed && styles.choiceTextDisabled,
            ]}>
              {r.label}
              {!supported && (
                <Text style={styles.choiceUnsupported}>  · 该 daemon 不支持</Text>
              )}
            </Text>
            {/* #623 —— 名字下面:建不了的原因(带修法,hub 原样给)/ 未检测 / 共用登录提醒 */}
            {supported && ready.note ? (
              <Text
                testID={blockedByReadiness ? `runtime-reason-${r.id}` : `runtime-unchecked-${r.id}`}
                style={[styles.readinessLine, blockedByReadiness ? styles.readinessBlocked : styles.readinessUnchecked]}
              >
                {blockedByReadiness ? `✗ ${ready.note}` : ready.note}
              </Text>
            ) : null}
            {allowed && ready.sharedLoginWarning ? (
              <Text testID={`runtime-shared-${r.id}`} style={[styles.readinessLine, styles.readinessShared]}>
                {`⚠ ${ready.sharedLoginWarning}`}
              </Text>
            ) : null}
          </View>
          {selected && allowed ? (
            <Ionicons name="checkmark" size={18} color={colors.accent} />
          ) : null}
        </Pressable>
        {showNote ? (
          <Text style={[styles.hint, nested && styles.hintNested]}>{r.note}</Text>
        ) : null}
      </Fragment>
    );
  };
  const handleSubmit = async () => {
    if (!canSubmit || busy) return;
    const gate = codexSubmitGate({
      runtimeId,
      choice: providerForm.choice,
      baseUrl: providerForm.baseUrl,
      model: providerForm.model,
      apiKey: providerForm.apiKey,
    }, cfg.serverUrl);
    if (gate.action === 'block') {
      setPhase('error');
      setMsg(scrubSecret(t(providerIssueI18nKey(gate.issue)), providerForm.apiKey));
      return;
    }
    setPhase('creating');
    setMsg('');
    // flags.copresence:true 只给「Codex（TUI 共存）」(codex-app-server),见 create-node-request.ts。
    const node_spec: CreateNodeRequest['node_spec'] = buildCreateNodeSpec({
      name, runtimeId, model, runtimeModels: runtime.models,
      permissionMode, maxTurns, budget,
      opencodeGeneration, opencodeUnsafeTools,
      codexAutoExecute,
      ...(managedSelection ? { daemonProvider: managedSelection } : {}),
      workdirField: workdirForRequest(workdirRoot, workdir),
    });
    submittedSpec.current = node_spec;
    const res = await createNode(cfg, {
      daemon_node_id: daemon.daemon_node_id,
      node_spec,
    });
    if (res.ok) {
      // Hub accepted dispatch. Now POLL to confirm child registered.
      setRequestId(res.request_id ?? null);
      setPhase('awaiting_register');
      setMsg('创建请求已下发，正在监测子节点注册…');
    } else if (res.unconfirmed) {
      setPhase('error');
      setMsg(scrubSecret(`服务器未就绪：${res.error}`, providerForm.apiKey));
    } else {
      setPhase('error');
      setMsg(scrubSecret(`创建失败：${describeProviderCreateError(res) ?? describeOpenCodeCreateError(res) ?? describeNodeNameRejection(res.error, name, 'hub') ?? describeCopresenceError({ error: res.error, field: res.field, runtime: runtimeId }) ?? describeWorkdirError(res.error) ?? res.error}`, providerForm.apiKey));
    }
  };

  // ── render ─────────────────────────────────────────────────────────
  // #614 —— 主机 chip:节点会建在哪台机器上(图标 + daemon 名 + 主机名 + 在线点)。
  const hostChip = (
    <View
      style={styles.hostChip}
      testID="create-host-chip"
      accessibilityLabel={`将创建在 ${daemon.alias}${daemon.hostname ? ` (${daemon.hostname})` : ''}${daemon.online === true ? '，在线' : daemon.online === false ? '，离线' : ''}`}
    >
      <Ionicons name="server-outline" size={14} color={colors.accent} />
      <Text style={styles.hostChipName} numberOfLines={1}>{daemon.alias}</Text>
      {daemon.hostname ? <Text style={styles.hostChipHost} numberOfLines={1}>{daemon.hostname}</Text> : null}
      {typeof daemon.online === 'boolean' ? (
        <View testID="create-host-online" style={[styles.hostDot, { backgroundColor: daemon.online ? colors.running : colors.textMuted }]} />
      ) : null}
    </View>
  );

  // #614 —— 步骤条:编号圆 + 标题,三态(完成 = 勾 / 当前 = 实心强调色 / 未到 = 弱化)。
  // 只画 `steps` 里的步(被跳过的不占号),所以编号永远是连续的 1..n。
  const stepper = phase === 'form' && hasUsableRuntime ? (
    <View style={[styles.stepper, desktop && styles.stepperWide]} testID="create-stepper">
      {steps.map((k, i) => {
        const st = stepState(steps, cur, k);
        return (
          <Fragment key={k}>
            {i > 0 ? <View style={[styles.stepLine, desktop && styles.stepLineWide, st !== 'upcoming' && styles.stepLineDone]} /> : null}
            <View
              style={[styles.stepItem, desktop && styles.stepItemWide]}
              testID={`create-step-${k}`}
              accessibilityLabel={`第 ${i + 1} 步 ${STEP_TITLES[k]}${st === 'done' ? '，已完成' : st === 'current' ? '，当前' : ''}`}
            >
              <View
                testID={`create-step-dot-${st}`}
                style={[styles.stepDot, st === 'done' && styles.stepDotDone, st === 'current' && styles.stepDotCurrent]}
              >
                {st === 'done'
                  ? <Ionicons name="checkmark" size={14} color={colors.accent} />
                  : <Text style={[styles.stepNum, st === 'current' && styles.stepNumCurrent]}>{i + 1}</Text>}
              </View>
              <Text style={[styles.stepTitle, st === 'current' && styles.stepTitleCurrent, st === 'upcoming' && styles.stepTitleUpcoming]} numberOfLines={1}>
                {STEP_TITLES[k]}
              </Text>
            </View>
          </Fragment>
        );
      })}
    </View>
  ) : null;

  // 每一步的标题 + 一行说明。
  const stepHead = phase === 'form' && hasUsableRuntime ? (
    <View style={styles.stepHead} testID="create-step-head">
      <Text style={styles.stepHeadTitle}>{STEP_TITLES[cur]}</Text>
      <Text style={styles.stepHeadDesc}>
        {cur === 'model' ? `${runtimeDisplayLabel(RUNTIMES, runtime)} 使用的模型。` : STEP_DESCRIPTIONS[cur]}
      </Text>
    </View>
  ) : null;

  const body = !hasUsableRuntime ? (
      // (#3 nit ②) Daemon advertises only runtimes this App build doesn't
      // know about — refuse to ship a wizard that can't complete.
      <View style={styles.warnCard}>
        <Text style={styles.warnTitle}>⚠  App 太旧</Text>
        <Text style={styles.warnBody}>
          {daemon.alias} 声明支持 {daemon.runtimes_supported?.join(', ') || '—'}，App 当前认识的 runtime（{RUNTIMES.map(r => r.id).join(', ')}）都不在其中。
        </Text>
        <Text style={styles.warnHint}>
          升级 App 到带这些 runtime 的版本后再来；或选另一台 host_supervisor。
        </Text>
      </View>
    ) : phase !== 'form' ? (
      <View style={styles.statusBlock}>
        {busy ? <ActivityIndicator color={colors.accent} /> : null}
        <Text style={[
          styles.statusText,
          phase === 'done' && childUp && styles.statusOk,
          phase === 'error' && styles.statusErr,
        ]}>
          {phase === 'creating'
            ? '正在下发创建请求…'
            : phase === 'awaiting_register'
              ? `正在确认 ${normalizeNodeName(name)} 启动…（约 45s）${msg ? `\n${msg}` : ''}`
              : phase === 'done' && childUp
                ? `✓ ${normalizeNodeName(name)} 已上线`
                : msg}
        </Text>
      </View>
    ) : (
      <>
        {cur === 'name' && (
          <View style={styles.section}>
            <Text style={styles.label}>节点名字</Text>
            <TextInput
              autoFocus
              value={name}
              onChangeText={setName}
              placeholder="例如 my-agent-1"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              testID="create-name-input"
            />
            <Text testID="create-name-hint" style={[styles.hint, !nameCheck.ok && nameCheck.error !== 'empty' && styles.hintErr]}>
              {!nameCheck.ok && nameCheck.error !== 'empty' ? nameCheck.message : NODE_NAME_HINT}
            </Text>
            {/* #652 —— 名字可以是中文,文件夹(工作目录)必须是英文:单独一行显示、可改。
                与确认页「工作目录」同一个开关:daemon 不报 default_workdir_root 就不显示(它不认 workdir)。 */}
            {workdirRoot ? (
              <View style={styles.folderBlock}>
                <View style={styles.folderLine} testID="create-folder-row">
                  <Text style={styles.folderText} numberOfLines={1} testID="create-folder-value">
                    {`文件夹：${folder}`}
                  </Text>
                  <Pressable
                    testID="create-folder-edit"
                    onPress={() => setFolderOpen(o => !o)}
                    hitSlop={8}
                    accessibilityLabel={folderOpen ? '收起文件夹编辑' : '修改文件夹名'}
                    style={({ pressed }) => [styles.summaryEdit, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.summaryEditText}>{folderOpen ? '收起' : '改'}</Text>
                  </Pressable>
                </View>
                {folderOpen ? (
                  <TextInput
                    testID="create-folder-input"
                    autoFocus
                    value={folder}
                    onChangeText={setFolderEdited}
                    placeholder="例如 my-agent-1"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                ) : null}
                {folderOpen || folderErr ? (
                  <Text testID="create-folder-hint" style={[styles.hint, !!folderErr && styles.hintErr]}>
                    {folderErr ?? '文件夹名只能用小写英文字母、数字和 -，以字母开头；节点建在这个目录里。'}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        )}

        {cur === 'runtime' && (
          <View style={styles.section}>
            {primaryRuntimes(RUNTIMES).map(r => {
              // 「高级」折叠:只挂在有折叠项的行下面(目前是 Grok → 共存模式·实验性),
              // 且只在该行(或其折叠项)被选中时出现,不给其他 runtime 添噪音。
              const kids = advancedRuntimesOf(RUNTIMES, r.id);
              const toggle = showsAdvancedToggle(RUNTIMES, r.id, runtimeId);
              const open = advancedExpanded(RUNTIMES, r.id, runtimeId, advancedOpen);
              return (
                <Fragment key={r.id}>
                  {renderRuntimeRow(r, false)}
                  {toggle ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="高级"
                      accessibilityState={{ expanded: open }}
                      onPress={() => setAdvancedOpen(!open)}
                      hitSlop={6}
                      style={({ pressed }) => [styles.advancedToggle, pressed && { opacity: 0.6 }]}
                    >
                      <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.textMuted} />
                      <Text style={styles.advancedToggleText}>高级</Text>
                    </Pressable>
                  ) : null}
                  {open ? kids.map(k => renderRuntimeRow(k, true)) : null}
                </Fragment>
              );
            })}
            {runtimeId === 'opencode-cli' ? (
              <View testID="opencode-generation-options" style={styles.section}>
                <Text style={styles.label}>OpenCode 代际</Text>
                {(['v1', 'v2'] as const).map(g => (
                  <Pressable key={g} testID={`opencode-generation-${g}`} accessibilityRole="radio"
                    accessibilityState={{ checked: opencodeGeneration === g }}
                    aria-checked={opencodeGeneration === g}
                    onPress={() => { setOpenCodeGeneration(g); setOpenCodeUnsafeTools(false); }}
                    style={[styles.choiceRow, opencodeGeneration === g && styles.choiceRowSelected]}>
                    <Text style={styles.choiceText}>{OPENCODE_GENERATION_LABELS[g]}</Text>
                  </Pressable>
                ))}
                {opencodeGeneration === 'v2' ? (
                  <>
                    <Text testID="opencode-v2-warning" style={styles.hint}>{OPENCODE_V2_WARNING}</Text>
                    <Text style={styles.hint}>runtime 可用性标记不代表 V2 就绪；目标 daemon 仍会校验准确版本、授权和启动结果。</Text>
                    <Pressable testID="opencode-v2-consent" accessibilityRole="checkbox"
                      accessibilityState={{ checked: opencodeUnsafeTools }}
                      aria-checked={opencodeUnsafeTools}
                      onPress={() => setOpenCodeUnsafeTools(v => !v)} style={styles.choiceRow}>
                      <Ionicons name={opencodeUnsafeTools ? 'checkbox' : 'square-outline'} size={20} color={colors.accent} />
                      <Text style={[styles.choiceText, { flex: 1 }]}>我了解风险，仅用于可信任务，允许所有本地工具</Text>
                    </Pressable>
                  </>
                ) : <Text testID="opencode-v1-mode-note" style={styles.hint}>{OPENCODE_V1_NOTE}</Text>}
              </View>
            ) : null}
            {providerResetHint ? <Text testID="provider-reset-hint" style={styles.hint}>{providerResetHint}</Text> : null}
            {surface.kind === 'codex' ? (
              <>
                <View testID="codex-auto-execute-options" style={styles.section}>
                  <Pressable
                    testID="codex-auto-execute-consent"
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: codexAutoExecute }}
                    aria-checked={codexAutoExecute}
                    onPress={() => setCodexAutoExecute(v => !v)}
                    style={styles.choiceRow}
                  >
                    <Ionicons name={codexAutoExecute ? 'checkbox' : 'square-outline'} size={20} color={colors.accent} />
                    <Text style={[styles.choiceText, { flex: 1 }]}>
                      自动执行（不弹确认）— 与本地 Codex 默认最高权限一致
                    </Text>
                  </Pressable>
                  {!codexAutoExecute ? (
                    <Text style={styles.hint}>关闭后创建节点不会下发 approvalPolicy / sandboxMode;行为接近 `anet node create --no-yolo`。</Text>
                  ) : null}
                </View>
                {runtimeId === 'codex-app-server' ? <DaemonCreateProvider key={managedIdentity} cfg={cfg}
                  daemonId={daemon.daemon_node_id} identity={managedIdentity} enabled={managedMode}
                  onMode={enabled => { setManagedModeState(enabled ? managedIdentity : ''); setManagedSelectionState(null); setProviderForm(EMPTY_PROVIDER_FORM); }}
                  onSelection={value => setManagedSelectionState(value ? { identity: managedIdentity, value } : null)} /> : null}
                {!managedMode ? <CodexProviderFields
                  runtimeId={runtimeId}
                  value={providerForm}
                  issues={providerIssues}
                  transportOk={transportOk}
                  hubBlocked={providerForm.choice !== 'none' && providerIssues.length === 0}
                  onChange={next => { setProviderForm(next); setProviderResetHint(''); }}
                /> : null}
              </>
            ) : null}
            <DaemonRuntimeProviders
              daemon={daemon}
              rows={daemonProviderRows}
              read={daemonProviderRead}
              runtimeId={runtimeId}
              opencodeGeneration={opencodeGeneration}
              onSelectModel={setModel}
            />
          </View>
        )}

        {cur === 'model' && (
          <View style={styles.section}>
            {/* #614 —— 只有 ≥ 2 个可选模型时才有这一步;0 个(跟随宿主登录)/ 1 个写在确认页那一行里。 */}
            <View style={styles.choiceList}>
              {runtime.models.map(m => (
                <Pressable
                  key={m}
                  onPress={() => setModel(m)}
                  style={({ pressed }) => [
                    styles.choiceRow,
                    model === m && styles.choiceRowSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.choiceText, model === m && styles.choiceTextSelected]}>
                    {m}
                  </Text>
                  {model === m ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                </Pressable>
              ))}
            </View>
            {surface.kind === 'opencode-native' ? <OpenCodeProviderNote /> : null}
            {runtimeId === 'opencode-cli' && opencodeGeneration === 'v2' ? (
              <View style={styles.section}>
                <Text style={styles.label}>目标机器已配置的 provider/model</Text>
                <View testID="opencode-v2-model-choices" style={styles.choiceList}>
                  {daemonModelChoices.map(m => (
                    <Pressable key={m} testID={`opencode-v2-model-choice-${m}`} accessibilityRole="button" accessibilityLabel={`选择模型 ${m}`} onPress={() => setModel(m)} style={[styles.choiceRow, model === m && styles.choiceRowSelected]}>
                      <Text style={[styles.choiceText, model === m && styles.choiceTextSelected]}>{m}</Text>
                      {model === m ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                    </Pressable>
                  ))}
                </View>
                <TextInput testID="opencode-v2-model" value={model} onChangeText={setModel}
                  autoCapitalize="none" autoCorrect={false} placeholder="provider/model" style={styles.input} />
                <Text testID="opencode-v2-model-hint" style={[styles.hint, !!openCodeError && styles.hintErr]}>
                  {openCodeError ?? '点选这台机器已上报的模型。没有列表时再手填 provider/model。这里不收集密钥。'}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {cur === 'params' && (
          <View style={styles.section} testID="create-params-step">
            {/* #591 —— 只显示这个 runtime 真会读的设置(矩阵与依据见 create-node-request.ts)。
                #614 —— 一项都没有的 runtime 不进这一步(create-node-steps.ts),确认页一行说明。 */}
            {params.includes('permissionMode') ? (
              <>
                <Text style={styles.label}>permissionMode</Text>
                <View style={styles.choiceList} testID="create-param-permissionMode">
                  {PERMISSION_MODES.map(m => (
                    <Pressable
                      key={m}
                      onPress={() => setPermissionMode(m)}
                      style={({ pressed }) => [
                        styles.choiceRow,
                        permissionMode === m && styles.choiceRowSelected,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[styles.choiceText, permissionMode === m && styles.choiceTextSelected]}>
                        {m}
                      </Text>
                      {permissionMode === m ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {params.includes('maxTurns') || params.includes('budget') ? (
              <>
                <Text style={[styles.label, params.includes('permissionMode') && { marginTop: spacing.lg }]}>限制（可空）</Text>
                <View style={styles.row3}>
                  {params.includes('maxTurns') ? (
                    <View style={styles.row3Cell} testID="create-param-maxTurns">
                      <Text style={styles.subLabel}>maxTurns</Text>
                      <TextInput
                        value={maxTurns}
                        onChangeText={setMaxTurns}
                        placeholder="—"
                        placeholderTextColor={colors.textMuted}
                        style={styles.input}
                        keyboardType="numeric"
                      />
                    </View>
                  ) : null}
                  {params.includes('budget') ? (
                    <View style={styles.row3Cell} testID="create-param-budget">
                      <Text style={styles.subLabel}>budget（美元）</Text>
                      <TextInput
                        value={budget}
                        onChangeText={setBudget}
                        placeholder="—"
                        placeholderTextColor={colors.textMuted}
                        style={styles.input}
                        keyboardType="numeric"
                      />
                    </View>
                  ) : null}
                </View>
              </>
            ) : null}
          </View>
        )}

        {cur === 'confirm' && (
          <View style={styles.section}>
            {skippedLine ? (
              // #614 —— 被跳过的步骤(没有可选项)的信息,集中成确认页上的一行。
              <View style={styles.skippedNote} testID="create-skipped-note">
                <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
                <Text style={styles.skippedNoteText}>{skippedLine}</Text>
              </View>
            ) : null}
            <View style={styles.summaryCard}>
              <SummaryRow k="服务器" v={`${daemon.alias} (${daemon.hostname || '—'})`} />
              <Divider />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryKey}>名字</Text>
                <View style={styles.summaryValWithAction}>
                  <Text style={styles.summaryVal} numberOfLines={2} testID="create-name-summary">{normalizeNodeName(name) || '—'}</Text>
                  <Pressable testID="create-name-edit" accessibilityRole="button" accessibilityLabel="修改节点名字"
                    hitSlop={8} onPress={() => setStep('name')}
                    style={({ pressed }) => [styles.summaryEdit, pressed && { opacity: 0.6 }]}>
                    <Text style={styles.summaryEditText}>修改</Text>
                  </Pressable>
                </View>
              </View>
              <Divider />
              <SummaryRow k="Runtime" v={runtimeDisplayLabel(RUNTIMES, runtime)} />
              {runtimeId === 'opencode-cli' ? (
                <><Divider /><SummaryRow k="代际 / 模式" v={OPENCODE_GENERATION_LABELS[opencodeGeneration]} /></>
              ) : null}
              <Divider />
              <SummaryRow k="模型" v={managedSelection?.model || model || runtime.models[0] || '跟随宿主登录'} />
              {managedSelection ? <><Divider /><SummaryRow k={t('providerManagement.create.summary')}
                v={`${managedSelection.provider_id} · ${managedSelection.auth_id} · r${managedSelection.revision}`} /></> : null}
              {surface.kind === 'codex' && providerForm.choice !== 'none' ? (
                <>
                  <Divider />
                  <SummaryRow
                    k={t('provider.summaryLabel')}
                    v={`${t(presetLabelKey(providerSummary(providerForm).preset))} · ${providerSummary(providerForm).model || '—'} · ${t('provider.credential.entered')}`}
                  />
                </>
              ) : null}
              {params.includes('permissionMode') ? (
                <>
                  <Divider />
                  <SummaryRow k="permissionMode" v={permissionMode} />
                </>
              ) : null}
              {params.includes('maxTurns') || params.includes('budget') ? (
                <>
                  <Divider />
                  <SummaryRow k="maxTurns / budget" v={`${maxTurns || '—'} / ${budget || '—'}`} />
                </>
              ) : null}
              {workdirRoot ? (
                <>
                  <Divider />
                  <View style={styles.summaryRow} testID="create-workdir-row">
                    <Text style={styles.summaryKey}>工作目录</Text>
                    <View style={styles.summaryValWithAction}>
                    <Text style={styles.summaryVal} numberOfLines={2} testID="create-workdir-value">{workdir}</Text>
                    <Pressable
                      testID="create-workdir-edit"
                      onPress={() => setWorkdirOpen(o => !o)}
                      hitSlop={8}
                      accessibilityLabel={workdirOpen ? '收起工作目录编辑' : '修改工作目录'}
                      style={({ pressed }) => [styles.summaryEdit, pressed && { opacity: 0.6 }]}
                    >
                      <Text style={styles.summaryEditText}>{workdirOpen ? '收起' : '改'}</Text>
                    </Pressable>
                    </View>
                  </View>
                  {workdirOpen ? (
                    <View style={styles.summaryEditor}>
                      <TextInput
                        testID="create-workdir-input"
                        autoFocus
                        value={workdir}
                        onChangeText={setWorkdirEdited}
                        placeholder={defaultWorkdir(workdirRoot, folder)}
                        placeholderTextColor={colors.textMuted}
                        style={styles.input}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Text style={[styles.hint, !!workdirErr && styles.hintErr]}>
                        {workdirErr ?? '每个节点一个独立目录；不存在会自动创建。'}
                      </Text>
                    </View>
                  ) : workdirErr ? (
                    <Text style={[styles.hint, styles.hintErr, styles.summaryEditor]}>{workdirErr}</Text>
                  ) : null}
                </>
              ) : null}
            </View>
            {runtimeId === 'opencode-cli' && opencodeGeneration === 'v2' ? (
              <Text testID="opencode-v2-confirm-warning" style={styles.hint}>{OPENCODE_V2_WARNING} 已显式允许所有本地工具。</Text>
            ) : null}
            {surface.kind === 'codex' && providerForm.choice !== 'none' && providerIssues.length === 0 ? (
              <Text testID="codex-provider-confirm-banner" style={styles.hint}>{t('provider.err.hub_not_ready')}</Text>
            ) : null}
            {surface.kind === 'codex' && providerForm.choice !== 'none' ? (
              <ProviderConfigDemo
                key={providerForm.choice}
                runtimeId={runtimeId}
                value={providerForm}
                transportOk={transportOk}
                onClearKey={() => setProviderForm(form => ({ ...form, apiKey: '' }))}
              />
            ) : null}
          </View>
        )}
      </>
    );

  const footerButtons = (
    <>
      {phase === 'form' ? (
        <>
          <Pressable
            onPress={prevStep === null ? onBack : () => setStep(prevStep)}
            style={({ pressed }) => [styles.secondaryBtn, desktop && styles.btnWide, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.secondaryBtnText}>{prevStep === null ? '返回服务器' : '上一步'}</Text>
          </Pressable>
          {nextStep !== null ? (
            <Pressable
              testID="create-node-next"
              accessibilityRole="button"
              aria-disabled={!canNext}
              disabled={!canNext}
              onPress={() => { if (canNext) setStep(nextStep); }}
              style={({ pressed }) => [
                styles.primaryBtn,
              desktop && styles.btnWide,
                !canNext && styles.primaryBtnDisabled,
                pressed && canNext && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.primaryBtnText, !canNext && styles.primaryBtnTextDisabled]}>
                下一步
              </Text>
            </Pressable>
          ) : (
            <Pressable
              testID="create-node-submit"
              accessibilityRole="button"
              aria-disabled={!canSubmit}
              disabled={!canSubmit}
              onPress={handleSubmit}
              style={({ pressed }) => [
                styles.primaryBtn,
              desktop && styles.btnWide,
                !canSubmit && styles.primaryBtnDisabled,
                pressed && canSubmit && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.primaryBtnText, !canSubmit && styles.primaryBtnTextDisabled]}>创建节点</Text>
            </Pressable>
          )}
        </>
      ) : (
        <Pressable
          onPress={phase === 'error' ? () => setPhase('form') : onExit}
          disabled={busy}
          style={({ pressed }) => [
            styles.primaryBtn,
              desktop && styles.btnWide,
            busy && styles.primaryBtnDisabled,
            pressed && !busy && { opacity: 0.8 },
          ]}
        >
          <Text style={[styles.primaryBtnText, busy && styles.primaryBtnTextDisabled]}>
            {busy
              ? '请稍候…'
              : phase === 'error'
                ? '返回修改'
                : phase === 'done' && childUp
                  ? '完成'
                  : phase === 'done'
                    ? '去 Agents 查看'
                    : '完成'}
          </Text>
        </Pressable>
      )}
    </>
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      {paneShowsBack(desktop) ? (
        <View style={styles.header} testID="screen-header">
          <Pressable
            testID={PANE_BACK_TEST_ID}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
            onPress={busy ? () => { /* ignore back mid-create */ } : onBack}
            hitSlop={8}
            accessibilityLabel="返回服务器选择"
          >
            <Ionicons name="chevron-back" size={26} color={busy ? colors.textMuted : colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>新建节点</Text>
          <View style={styles.headerBtn} />
        </View>
      ) : (
        <View style={[styles.header, styles.headerWide]} testID="screen-header">
          <Text style={[styles.headerTitle, styles.headerTitleWide]}>新建节点</Text>
        </View>
      )}

      {desktop ? (
        // 桌面:内容放进居中的卡片(最宽 720),按钮在卡片底部,而不是钉在窗口最底下。
        <ScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.desktopScroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card} testID="create-wizard-card">
            <View style={styles.cardHeader}>
              {hostChip}
              {stepper}
            </View>
            <View style={styles.cardBody} testID="create-step-body">
              {stepHead}
              {body}
            </View>
            <View style={[styles.footer, styles.footerWide]} testID="create-wizard-footer">
              {footerButtons}
            </View>
          </View>
        </ScrollView>
      ) : (
        // 手机:主机 chip + 步骤条在上,内容滚动,按钮固定在底部(原有手机布局)。
        <>
          <View style={styles.phoneTop}>
            {hostChip}
            {stepper}
          </View>
          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <View testID="create-step-body">
              {stepHead}
              {body}
            </View>
          </ScrollView>
          <View style={styles.footer} testID="create-wizard-footer">
            {footerButtons}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

// ── small bits ───────────────────────────────────────────────────────

function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryKey}>{k}</Text>
      <Text style={styles.summaryVal} numberOfLines={2}>{v}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ── styles ───────────────────────────────────────────────────────────

const makeStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center' },
  // Desktop: title on the content's left edge, same header height as the phone one (40 + 2×8 + 1).
  headerWide: { paddingHorizontal: spacing.lg, minHeight: 57 },
  headerTitleWide: { textAlign: 'left' },

  // ── #614 主机 chip ──
  hostChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.tonalBg,
  },
  hostChipName: { color: colors.text, fontSize: typeScale.small, fontWeight: '600', flexShrink: 1 },
  hostChipHost: { color: colors.textSecondary, fontSize: typeScale.small, flexShrink: 1 },
  hostDot: { width: 8, height: 8, borderRadius: radius.pill },

  // ── #614 步骤条:编号圆 + 标题,三态 ──
  // 手机:圆在上、标题在下,连线对齐圆心;桌面:圆与标题并排。
  stepper: { flexDirection: 'row', alignItems: 'flex-start' },
  stepperWide: { alignItems: 'center' },
  stepItem: { alignItems: 'center', gap: spacing.xs, minWidth: 44 },
  stepItemWide: { flexDirection: 'row', gap: spacing.sm, minWidth: 0 },
  stepLine: { flex: 1, height: 2, marginTop: 11, marginHorizontal: -spacing.xs, borderRadius: radius.pill, backgroundColor: colors.border },
  stepLineWide: { marginTop: 0, marginHorizontal: spacing.md },
  stepLineDone: { backgroundColor: colors.accent },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  stepDotDone: { borderColor: colors.tonalBg, backgroundColor: colors.tonalBg },
  stepDotCurrent: { borderColor: colors.accent, backgroundColor: colors.accent },
  stepNum: { color: colors.textMuted, fontSize: typeScale.small, fontWeight: '600' },
  stepNumCurrent: { color: colors.onAccent },
  stepTitle: { color: colors.textSecondary, fontSize: typeScale.small },
  stepTitleCurrent: { color: colors.accent, fontWeight: '600' },
  stepTitleUpcoming: { color: colors.textMuted },

  // ── #614 每步标题 + 一行说明 ──
  stepHead: { gap: spacing.xs, marginBottom: spacing.lg },
  stepHeadTitle: { color: colors.text, fontSize: typeScale.title, fontWeight: '600' },
  stepHeadDesc: { color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18 },

  // 手机顶部:chip + 步骤条
  phoneTop: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },

  bodyScroll: { flex: 1 },
  bodyContent: { padding: spacing.lg },

  // ── #614 桌面:居中卡片(最宽 720),按钮在卡片底部 ──
  desktopScroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 720,
    backgroundColor: colors.card,
    borderRadius: radius.surface,
    ...elevated('raised'),
  },
  cardHeader: {
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  cardBody: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.lg },

  section: { gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: 12 },
  subLabel: { color: colors.textMuted, fontSize: 11 },
  hint: { color: colors.textMuted, fontSize: 11 },
  hintErr: { color: colors.failed },

  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    fontSize: 14,
  },

  choiceList: { gap: spacing.sm },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  choiceRowSelected: { borderColor: colors.accent, backgroundColor: colors.card },
  choiceRowDisabled: { opacity: 0.55, backgroundColor: colors.bg },
  choiceText: { color: colors.text, fontSize: 14 },
  choiceTextSelected: { color: colors.accent, fontWeight: '600' },
  choiceTextDisabled: { color: colors.textMuted },
  choiceUnsupported: { color: colors.textMuted, fontSize: 11 },
  // #623 —— 被 runtime_readiness 判为建不了:灰底、名字弱化,但原因那行用语义红、不跟着变淡(要看得清修法)。
  choiceRowBlocked: { backgroundColor: colors.bg, borderStyle: 'dashed' },
  choiceMain: { flex: 1, minWidth: 0, gap: 2 },
  readinessLine: { fontSize: 12, lineHeight: 17 },
  readinessBlocked: { color: colors.failed },
  readinessUnchecked: { color: colors.textMuted },
  readinessShared: { color: colors.blocked },
  // 「高级」折叠开关 + 折叠里的行:紧凑,缩进一级,不抢主列表的视觉权重。
  advancedToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: spacing.xs },
  advancedToggleText: { color: colors.textMuted, fontSize: 12 },
  choiceRowNested: { marginLeft: spacing.lg },
  hintNested: { marginLeft: spacing.lg, color: colors.blocked },

  row3: { flexDirection: 'row', gap: spacing.sm },
  row3Cell: { flex: 1, gap: spacing.xs },

  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radius.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // #614 —— 确认页上「被跳过的步骤」那一行
  skippedNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.control,
    backgroundColor: colors.tonalBg,
  },
  skippedNoteText: { color: colors.text, fontSize: typeScale.small, lineHeight: 18, flex: 1 },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  summaryKey: { color: colors.textMuted, fontSize: 12, flexShrink: 0 },
  summaryVal: { color: colors.text, fontSize: 13, textAlign: 'right', flex: 1 },
  // 「改」:值列右侧一个紧凑的文字按钮;行的左右内边距与其他确认行一致(同一个 summaryRow)。
  // 值 +「改」共一条中线(「改」是 CJK 字形,行盒比 ASCII 路径高,顶对齐会差 1–2px)。
  summaryValWithAction: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryEdit: { flexShrink: 0 },
  // #652 —— 第 1 步「文件夹：…」一行:左边与名字输入框对齐(同一 section,无额外缩进)。
  folderBlock: { gap: spacing.xs },
  folderLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  folderText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13 },
  summaryEditText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  summaryEditor: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: spacing.lg },

  statusBlock: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  statusText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  statusOk: { color: colors.running, fontWeight: '600' },
  statusErr: { color: colors.failed },

  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  // 桌面:按钮靠右、定宽,在卡片底部;手机保持两颗等宽按钮钉在底部。
  footerWide: { justifyContent: 'flex-end', paddingHorizontal: spacing.xl },
  primaryBtn: { ...buttonStyle('primary'), flex: 1 },
  btnWide: { flex: -1, minWidth: 120 },
  primaryBtnDisabled: { backgroundColor: colors.border },
  primaryBtnText: { ...buttonTextStyle('primary') },
  primaryBtnTextDisabled: { color: colors.textMuted },
  secondaryBtn: { ...buttonStyle('secondary'), flex: 1 },
  secondaryBtnText: { ...buttonTextStyle('secondary') },

  // (#3 nit ②) Empty-state warning card for App-doesn't-know-these-runtimes case.
  warnCard: {
    backgroundColor: colors.card,
    borderColor: colors.blocked,
    borderWidth: 1,
    borderRadius: radius.surface,
    padding: spacing.lg,
  },
  warnTitle: { color: colors.blocked, fontSize: 15, fontWeight: '600', marginBottom: spacing.sm },
  warnBody: { color: colors.text, fontSize: 13, lineHeight: 20, marginBottom: spacing.md },
  warnHint: { color: colors.textMuted, fontSize: 12 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
