import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, onThemeChange, spacing, type as typeScale, radius } from './theme';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import DialogFrame from './DialogFrame';
import { listenEscapeClose } from './escape-close';
import type { HubConfig } from './api';
import { loadAgentOrg, moveAgentDepartment } from './agent-org-api';
import { agentCount, agentsDirectlyIn, orgTree, parentCandidates, placeAgents, type AgentOrgData, type DemoMove, type PlacedAgent } from './agent-org-model';
import { childrenOf, deptPathLabel, flattenTree, subtreeIds, type Department } from './org-model';
import { createDepartment, updateDepartment, OrgRequestError } from './org-api';
import { SettingsButton, SettingsChoiceRow, SettingsGroup, SettingsRow } from './settings-kit';
import { useTranslation } from './i18n-react';
import './i18n-agent-org';

type Props = { cfg: HubConfig; networkId?: string; phone: boolean };

export default function AgentOrgScreen(p: Props) {
  const [, refreshTheme] = useState(0);
  useEffect(() => onThemeChange(() => refreshTheme(n => n + 1)), []);
  return (
    <View testID="agent-org-page">
      {p.networkId
        ? <OrgBody key={JSON.stringify([p.cfg.serverUrl, p.cfg.token, p.networkId])} cfg={p.cfg} networkId={p.networkId} phone={p.phone} />
        : <NoNetwork />}
    </View>
  );
}

function NoNetwork() {
  const { t } = useTranslation();
  return <SettingsGroup testID="agent-org-no-network"><SettingsRow label={t('agentOrg.noNetwork')} /></SettingsGroup>;
}

function OrgBody(p: { cfg: HubConfig; networkId: string; phone: boolean }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<{ kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: AgentOrgData | null }>({ kind: 'loading' });
  const [focus, setFocus] = useState<string | null | undefined>(undefined);
  const [moves, setMoves] = useState<DemoMove[]>([]);
  const [pickAgent, setPickAgent] = useState<string | null>(null);
  const [pickDept, setPickDept] = useState<string | null | undefined>(undefined);
  const [adjustNote, setAdjustNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [deptEditor, setDeptEditor] = useState<{ dept?: Department; parent: string | null; mode: 'create' | 'rename' | 'reparent' } | null>(null);
  const [deptNote, setDeptNote] = useState('');

  useEffect(() => {
    let live = true;
    setPhase({ kind: 'loading' });
    setMoves([]);
    setPickAgent(null);
    setPickDept(undefined);
    setAdjustNote('');
    void loadAgentOrg(p.cfg, p.networkId).then(data => {
      if (!live) return;
      setPhase({ kind: 'ready', data });
      const initialAgents = data ? placeAgents(data, []) : [];
      // #2025：有未归属 Agent 时右栏直接落在「未归属」，不再先落在某个部门上。
      const unowned = data ? agentCount(initialAgents, data, null) : 0;
      const populated = data ? flattenTree(orgTree(data)).find(row => agentsDirectlyIn(initialAgents, row.dept.id).length > 0) : undefined;
      const fallback = data?.directory || unowned > 0 ? null : (data?.departments[0]?.id ?? null);
      setFocus(p.phone ? undefined : (unowned > 0 ? null : (populated?.dept.id ?? fallback)));
    }, () => { if (live) setPhase({ kind: 'error' }); });
    return () => { live = false; };
  }, [p.cfg.serverUrl, p.cfg.token, p.networkId, p.phone, attempt]);

  const data = phase.kind === 'ready' ? phase.data : null;
  const placed = useMemo(() => (data ? placeAgents(data, moves) : []), [data, moves]);
  const showTree = !p.phone || focus === undefined;
  const showDetail = !!data && (p.phone ? focus !== undefined : true);

  return (
    <View>
      {data ? <View style={styles.actions} testID="agent-org-department-actions">
        <SettingsButton label={t('agentOrg.newDepartment')} disabled={!data.departmentsApi || saving} testID="agent-org-new-department" onPress={() => { setDeptNote(''); setDeptEditor({ mode: 'create', parent: null }); }} />
        {focus && data.departments.find(d => d.id === focus)?.viewer_can?.create_child !== false ? <SettingsButton label={t('agentOrg.newChild')} disabled={!data.departmentsApi || saving} testID="agent-org-new-child" onPress={() => { setDeptNote(''); setDeptEditor({ mode: 'create', parent: focus }); }} /> : null}
        {focus && data.departments.find(d => d.id === focus)?.viewer_can?.manage !== false ? <>
          <SettingsButton label={t('agentOrg.renameDepartment')} disabled={!data.departmentsApi || saving} testID="agent-org-rename-department" onPress={() => { const dept = data.departments.find(d => d.id === focus); if (dept) { setDeptNote(''); setDeptEditor({ mode: 'rename', dept, parent: dept.parent_id }); } }} />
          <SettingsButton label={t('agentOrg.reparentDepartment')} disabled={!data.departmentsApi || saving} testID="agent-org-reparent-department" onPress={() => { const dept = data.departments.find(d => d.id === focus); if (dept) { setDeptNote(''); setDeptEditor({ mode: 'reparent', dept, parent: dept.parent_id }); } }} />
        </> : null}
      </View> : null}
      {deptNote ? <Text accessibilityLiveRegion="polite" testID="agent-org-department-result" style={[styles.note, { padding: spacing.md }]}>{deptNote}</Text> : null}
      {phase.kind === 'loading' ? (
        <SettingsGroup testID="agent-org-loading"><SettingsRow label={t('agentOrg.loading')} /></SettingsGroup>
      ) : null}
      {phase.kind === 'error' ? (
        <SettingsGroup testID="agent-org-error">
          <SettingsRow label={t('agentOrg.loadFailed')} value={t('agentOrg.retry')} onPress={() => setAttempt(n => n + 1)} testID="agent-org-retry" />
        </SettingsGroup>
      ) : null}
      {phase.kind === 'ready' && data === null ? (
        <SettingsGroup testID="agent-org-empty-hub"><SettingsRow label={t('agentOrg.oldHub')} /></SettingsGroup>
      ) : null}
      {data ? (
        <View testID="agent-org-summary" style={styles.summary}>
          <Text style={styles.note}>{t('agentOrg.summary', { departments: data.departments.length, unowned: agentCount(placed, data, null) })}</Text>
        </View>
      ) : null}
      {data && (showTree || showDetail) ? (
        <View testID="agent-org-tree" style={[styles.workspace, !p.phone && { flexDirection: 'row', minHeight: 440 }]}>
          {showTree ? (
            <View style={!p.phone ? { width: 300, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: colors.listBg } : undefined}>
              <DepartmentTree data={data} placed={placed} focus={focus} onFocus={setFocus} />
            </View>
          ) : null}
          {showDetail ? (
            <View style={!p.phone ? { flex: 1, minWidth: 0 } : undefined} testID="agent-org-detail">
              <DepartmentDetail key={focus ?? 'unassigned'} data={data} placed={placed} focus={focus ?? null} phone={p.phone} onFocus={setFocus} onBack={() => setFocus(undefined)} />
            </View>
          ) : null}
        </View>
      ) : null}
      {data ? <View testID="agent-org-info" style={styles.info}>
        <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          {data.agentDepartmentSupported ? <Text testID="agent-org-independent-note" style={styles.note}>{t('agentOrg.independent')}</Text> : null}
          <Text style={styles.note}>{!data.directory ? t('agentOrg.directoryMissing') : !data.departmentsApi ? t('agentOrg.noTree') : t('agentOrg.readOnly')}</Text>
        </View>
      </View> : null}
      {phase.kind === 'ready' ? (
        <DemoAdjust
          data={data}
          placed={placed}
          moves={moves}
          pickAgent={pickAgent}
          pickDept={pickDept}
          note={adjustNote}
          saving={saving || !!deptEditor}
          onPickAgent={setPickAgent}
          onPickDept={setPickDept}
          onApply={() => {
            if (saving) return;
            if (!pickAgent || pickDept === undefined) { setAdjustNote(t('agentOrg.demoNeedPick')); return; }
            const nodeId = pickAgent;
            const previous = moves.find(m => m.nodeId === nodeId);
            setMoves(prev => [...prev.filter(m => m.nodeId !== nodeId), { nodeId, departmentId: pickDept }]);
            setAdjustNote('');
            setSaving(true);
            void moveAgentDepartment(p.cfg, p.networkId, nodeId, pickDept).then(result => {
              setSaving(false);
              if (result.ok) { setAdjustNote(t('agentOrg.saved')); return; }
              // 失败回滚到这次操作前的状态(没有旧覆盖就不留乐观项)。
              setMoves(prev => {
                const rest = prev.filter(m => m.nodeId !== nodeId);
                return previous ? [...rest, previous] : rest;
              });
              setAdjustNote(t(result.reason === 'forbidden' ? 'agentOrg.saveForbidden'
                : result.reason === 'department' ? 'agentOrg.saveNoDepartment'
                : result.reason === 'node' ? 'agentOrg.saveNoNode'
                : result.reason === 'unsupported' ? 'agentOrg.saveUnsupported'
                : 'agentOrg.saveFailed'));
            });
          }}
        />
      ) : null}
      {data && deptEditor ? <DepartmentEditor cfg={p.cfg} networkId={p.networkId} data={data} editor={deptEditor} onClose={() => setDeptEditor(null)} onSaved={async department => {
        const refreshed = await loadAgentOrg(p.cfg, p.networkId);
        if (!refreshed?.departmentsApi || !refreshed.departments.some(d => d.id === department.id)) throw new Error('refresh');
        setPhase({ kind: 'ready', data: refreshed });
        setMoves([]);
        setFocus(department.id);
        setDeptNote(t('agentOrg.saved'));
        setDeptEditor(null);
      }} /> : null}
    </View>
  );
}

function DepartmentEditor(p: { cfg: HubConfig; networkId: string; data: AgentOrgData; editor: { dept?: Department; parent: string | null; mode: 'create' | 'rename' | 'reparent' }; onClose: () => void; onSaved: (dept: Department) => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState(p.editor.dept?.name ?? '');
  const [parent, setParent] = useState(p.editor.parent);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Department | null>(null);
  const pending = useRef(false);
  const close = () => { if (!pending.current) p.onClose(); };
  useEffect(() => listenEscapeClose(close), [p.onClose]);
  const tree = orgTree(p.data);
  const excluded = p.editor.dept ? subtreeIds(tree, p.editor.dept.id) : new Set<string>();
  // Codex P2: the picker must not offer parents the caller cannot create under (RFC-040 viewer_can);
  // the network root is owner/admin-only, so a department head cannot select it.
  const allowedParents = parentCandidates(p.data, p.editor.dept);
  const validName = !!name.trim() && [...name.trim()].length <= 40;
  const validParent = parent === null ? allowedParents.root : allowedParents.departmentIds.has(parent);
  const save = async () => {
    if (pending.current || !validName || !validParent) return;
    pending.current = true;
    setBusy(true); setError('');
    let confirmed = saved;
    try {
      if (!confirmed) {
        // Omitted leader/sort fields are preserved by the Hub, including concurrent changes.
        const result = p.editor.dept
          ? await updateDepartment(p.cfg, p.networkId, p.editor.dept.id, p.editor.mode === 'rename' ? { name: name.trim() } : { parent_id: parent })
          : await createDepartment(p.cfg, p.networkId, { name: name.trim(), parent_id: parent });
        if (!result || typeof result.id !== 'string' || !result.id.trim() || typeof result.name !== 'string' || !result.name.trim() || (p.editor.dept && result.id !== p.editor.dept.id)) throw new Error('invalid response');
        confirmed = result;
        setSaved(result);
      }
      await p.onSaved(confirmed);
    } catch (e) {
      setError(t(confirmed ? 'agentOrg.departmentRefreshFailed'
        : e instanceof OrgRequestError && (e.status === 401 || e.status === 403) ? 'agentOrg.departmentForbidden'
        : e instanceof OrgRequestError && (e.status === 405 || e.status === 501 || (e.status === 404 && e.code !== 'department_not_found')) ? 'agentOrg.departmentUnsupported'
        : e instanceof OrgRequestError && e.status === 409 ? 'agentOrg.departmentConflict'
        : e instanceof OrgRequestError && (e.code === 'department_cycle' || e.code === 'department_too_deep') ? 'agentOrg.departmentHierarchyInvalid'
        : e instanceof OrgRequestError && (e.code === 'parent_not_found' || e.code === 'department_not_found') ? 'agentOrg.saveNoDepartment'
        : 'agentOrg.saveFailed'));
    } finally { pending.current = false; setBusy(false); }
  };
  const rows = flattenTree(tree).filter(row => !excluded.has(row.dept.id));
  return <DialogFrame title={t(p.editor.mode === 'create' ? (p.editor.parent ? 'agentOrg.newChild' : 'agentOrg.newDepartment') : p.editor.mode === 'rename' ? 'agentOrg.renameDepartment' : 'agentOrg.reparentDepartment')} closeLabel={t('agentOrg.close')} onClose={close} height={p.editor.mode === 'rename' ? undefined : 640} testID="agent-org-department-editor"
    footer={<SettingsButton label={t(busy ? 'agentOrg.saving' : saved ? 'agentOrg.retryRefresh' : 'agentOrg.demoApply')} disabled={busy || !validName || !validParent} onPress={() => void save()} testID="agent-org-department-save" />}>
    <Text testID="agent-org-shared-tree-note" style={styles.note}>{t('agentOrg.sharedTree')}</Text>
    {p.editor.mode !== 'reparent' ? <>
      <Text style={styles.note}>{t('agentOrg.departmentName')}</Text>
      <View style={styles.search}><TextInput autoFocus editable={!busy && !saved} testID="agent-org-department-name" value={name} onChangeText={setName} accessibilityLabel={t('agentOrg.departmentName')} placeholder={t('agentOrg.departmentName')} placeholderTextColor={colors.textMuted} style={styles.searchInput} /></View>
      {!validName ? <Text style={styles.note} testID="agent-org-department-validation">{t('agentOrg.departmentNameInvalid')}</Text> : null}
    </> : <Text style={styles.title}>{name}</Text>}
    {p.editor.mode !== 'rename' ? <>
      <Text style={styles.note}>{t('agentOrg.parentDepartment')}</Text>
      <Text testID="agent-org-department-parent-value" style={styles.note}>{parent ? deptPathLabel(tree, parent) : t('agentOrg.networkRoot')}</Text>
      <View style={styles.search}><TextInput value={query} onChangeText={setQuery} accessibilityLabel={t('agentOrg.searchOptions')} placeholder={t('agentOrg.searchOptions')} placeholderTextColor={colors.textMuted} style={styles.searchInput} testID="agent-org-department-parent-search" /></View>
      {allowedParents.root ? <SettingsChoiceRow label={t('agentOrg.networkRoot')} selected={parent === null} disabled={busy || !!saved} onPress={() => setParent(null)} testID="agent-org-parent-root" /> : null}
      {rows.filter(row => allowedParents.departmentIds.has(row.dept.id)).filter(row => deptPathLabel(tree, row.dept.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(row => <SettingsChoiceRow key={row.dept.id} label={deptPathLabel(tree, row.dept.id)} selected={parent === row.dept.id} disabled={busy || !!saved} onPress={() => setParent(row.dept.id)} testID={`agent-org-parent-${row.dept.id}`} />)}
    </> : null}
    {error ? <Text accessibilityRole="alert" testID="agent-org-department-error" style={[styles.note, { color: colors.failed }]}>{error}</Text> : null}
  </DialogFrame>;
}

function DepartmentTree(p: { data: AgentOrgData; placed: PlacedAgent[]; focus: string | null | undefined; onFocus: (id: string | null) => void }) {
  const { t } = useTranslation();
  const rows = flattenTree(orgTree(p.data));
  return (
    <View testID="agent-org-departments" style={{ padding: spacing.sm }}>
      <Text style={styles.sectionLabel}>{t('agentOrg.departments')}</Text>
      <ScrollView style={{ maxHeight: 560 }}>
      {rows.length ? rows.map(row => (
        <DepartmentRow
          key={row.dept.id}
          testID={`agent-org-dept-${row.dept.id}`}
          label={row.dept.name}
          depth={row.depth}
          selected={p.focus === row.dept.id}
          count={agentCount(p.placed, p.data, row.dept.id)}
          onPress={() => p.onFocus(row.dept.id)}
        />
      )) : <SettingsRow label={t('agentOrg.empty')} testID="agent-org-empty" />}
      {p.data.directory || agentCount(p.placed, p.data, null) > 0 ? (
        <DepartmentRow
          testID="agent-org-dept-unassigned"
          label={t('agentOrg.unowned')}
          selected={p.focus === null}
          count={agentCount(p.placed, p.data, null)}
          onPress={() => p.onFocus(null)}
        />
      ) : null}
      </ScrollView>
    </View>
  );
}

function DepartmentRow(p: { testID: string; label: string; depth?: number; selected: boolean; count: number; onPress: () => void }) {
  const { t } = useTranslation();
  return <Pressable testID={p.testID} accessibilityRole="button" accessibilityLabel={`${p.label}, ${t('agentOrg.agentsCount', { count: p.count })}`} accessibilityState={{ selected: p.selected }} aria-selected={p.selected} onPress={p.onPress}
    style={({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [styles.departmentRow, { paddingLeft: spacing.sm + (p.depth ?? 0) * 16 }, (pressed || hovered) && { backgroundColor: colors.rowHover }, p.selected && { backgroundColor: colors.railActiveBg }]}>
    <Ionicons name={p.testID === 'agent-org-dept-unassigned' ? 'file-tray-outline' : 'folder-outline'} size={17} color={p.selected ? colors.accent : colors.textMuted} />
    <Text testID={`${p.testID}-label`} numberOfLines={1} style={{ flex: 1, minWidth: 0, color: p.selected ? colors.accent : colors.text, fontSize: typeScale.small, fontWeight: p.selected ? '600' : '400' }}>{p.label}</Text>
    <Text testID={`${p.testID}-value`} style={[styles.count, { flexShrink: 0 }]}>{p.count}</Text>
  </Pressable>;
}

function DepartmentDetail(p: { data: AgentOrgData; placed: PlacedAgent[]; focus: string | null; phone: boolean; onFocus: (id: string) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const dept = p.focus ? p.data.departments.find(d => d.id === p.focus) : undefined;
  const title = p.focus === null ? t('agentOrg.unowned') : (dept?.name ?? t('agentOrg.unowned'));
  const agents = agentsDirectlyIn(p.placed, p.focus);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = agents.filter(agent => `${agent.alias} ${agent.ownerName ?? ''} ${agent.nodeId}`.toLocaleLowerCase().includes(needle));
  // Codex P2：一个部门可能有几百个 Agent，整组一次性铺出来会拖慢首屏；只先渲染前 60 行，
  // 其余靠上面的搜索缩小范围（不是隐藏数据：搜索范围仍是全部 filtered）。
  const ROW_CAP = 60;
  const shown = filtered.slice(0, ROW_CAP);
  const hidden = filtered.length - shown.length;
  const children = p.focus ? childrenOf(orgTree(p.data), p.focus) : [];
  return (
    <View testID="agent-org-detail-card" style={styles.detail}>
      {p.phone ? <SettingsRow label={t('agentOrg.back')} onPress={p.onBack} testID="agent-org-back" /> : null}
      <View style={styles.detailHeading}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={styles.title}>{title}</Text>
          <Text style={styles.note}>{t('agentOrg.directMembers')}</Text>
        </View>
        <Text style={styles.count}>{t('agentOrg.agentsCount', { count: agents.length })}</Text>
      </View>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={17} color={colors.textMuted} />
        <TextInput testID="agent-org-member-search" value={query} onChangeText={setQuery} placeholder={t('agentOrg.searchAgents')} accessibilityLabel={t('agentOrg.searchAgents')} placeholderTextColor={colors.textMuted} style={styles.searchInput} />
      </View>
      {children.map(child => (
        <SettingsRow
          key={child.id}
          testID={`agent-org-child-${child.id}`}
          label={child.name}
          value={t('agentOrg.agentsCount', { count: agentCount(p.placed, p.data, child.id) })}
          onPress={() => p.onFocus(child.id)}
        />
      ))}
      <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
        {filtered.length ? shown.map(agent => <AgentLine key={agent.nodeId} agent={agent} />) : <View testID={agents.length ? 'agent-org-no-results' : 'agent-org-no-agents'} style={styles.empty}>
          <Ionicons name={agents.length ? 'search-outline' : 'people-outline'} size={30} color={colors.textMuted} />
          <Text style={styles.note}>{t(agents.length ? 'agentOrg.noResults' : 'agentOrg.noAgents')}</Text>
        </View>}
        {hidden > 0 ? <Text testID="agent-org-more" style={[styles.note, { paddingVertical: spacing.md }]}>{t('agentOrg.moreAgents', { count: hidden })}</Text> : null}
      </ScrollView>
    </View>
  );
}

function AgentLine(p: { agent: PlacedAgent }) {
  const { t } = useTranslation();
  const agent = p.agent;
  const subtitle = agent.ownerName ? t('agentOrg.owner', { name: agent.ownerName }) : t('agentOrg.noOwner');
  return <View testID={`agent-org-agent-${agent.nodeId}`} style={styles.agentRow}>
    <AliasAvatar alias={agent.alias} size={36} />
    <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
      <Text testID={`agent-org-agent-${agent.nodeId}-label`} numberOfLines={1} style={{ color: colors.text, fontSize: typeScale.body, fontWeight: '500' }}>{agent.alias}</Text>
      <Text numberOfLines={1} style={styles.note}>{subtitle}</Text>
    </View>
  </View>;
}

function DemoAdjust(p: {
  data: AgentOrgData | null;
  placed: PlacedAgent[];
  moves: DemoMove[];
  pickAgent: string | null;
  pickDept: string | null | undefined;
  note: string;
  saving: boolean;
  onPickAgent: (id: string) => void;
  onPickDept: (id: string | null) => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [selector, setSelector] = useState<'agent' | 'department' | null>(null);
  const departments = p.data?.departments ?? [];
  return (
    <View testID="agent-org-demo" style={styles.adjust}>
      <Pressable testID="agent-org-adjust-toggle" accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(v => !v)} style={styles.adjustToggle}>
        <Ionicons name="options-outline" size={18} color={colors.textSecondary} />
        <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body, fontWeight: '500' }}>{t('agentOrg.demoTitle')}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>
      {expanded ? <View style={{ padding: spacing.md, paddingTop: 0, gap: spacing.md }}>
      <Text style={styles.note}>{t('agentOrg.demoHint')}</Text>
        {p.placed.length === 0 ? <SettingsRow label={t('agentOrg.demoNoAgents')} testID="agent-org-demo-empty" /> : null}
      {p.placed.length ? (
        <View style={styles.selectField}>
          <SettingsRow testID="agent-org-pick-agent" label={t('agentOrg.demoPickAgent')} subtitle={p.placed.find(a => a.nodeId === p.pickAgent)?.alias} disabled={p.saving} onPress={() => setSelector('agent')} />
        </View>
      ) : null}
      {p.placed.length ? (
        <View style={styles.selectField}>
          <SettingsRow testID="agent-org-pick-department" label={t('agentOrg.demoPickDept')} subtitle={p.pickDept === null ? t('agentOrg.unowned') : departments.find(d => d.id === p.pickDept)?.name} disabled={p.saving} onPress={() => setSelector('department')} />
        </View>
      ) : null}
      {p.placed.length ? <SettingsButton label={p.saving ? t('agentOrg.saving') : t('agentOrg.demoApply')} onPress={p.onApply} disabled={p.saving} testID="agent-org-demo-apply" /> : null}
      {p.note ? <Text accessibilityLiveRegion="polite" testID="agent-org-demo-result" style={styles.note}>{p.note}</Text> : null}
      </View> : null}
      {selector ? <StructureSelector key={selector} title={t(selector === 'agent' ? 'agentOrg.demoPickAgent' : 'agentOrg.demoPickDept')} onClose={() => setSelector(null)}
        options={selector === 'agent' ? p.placed.map(agent => ({ id: agent.nodeId, label: agent.alias, subtitle: agent.ownerName ?? t('agentOrg.noOwner'), testID: `agent-org-demo-agent-${agent.nodeId}` }))
          : [{ id: null, label: t('agentOrg.unowned'), testID: 'agent-org-demo-dept-unassigned' }, ...flattenTree(orgTree({ departments })).map(row => ({ id: row.dept.id, label: row.dept.name, testID: `agent-org-demo-dept-${row.dept.id}` }))]}
        selected={selector === 'agent' ? p.pickAgent : p.pickDept}
        onPick={id => { if (selector === 'agent' && id !== null) p.onPickAgent(id); else if (selector === 'department') p.onPickDept(id); setSelector(null); }} /> : null}
    </View>
  );
}

function StructureSelector(p: { title: string; options: { id: string | null; label: string; subtitle?: string; testID: string }[]; selected: string | null | undefined; onPick: (id: string | null) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  useEffect(() => listenEscapeClose(p.onClose), [p.onClose]);
  const needle = query.trim().toLocaleLowerCase();
  const options = p.options.filter(o => `${o.label} ${o.subtitle ?? ''} ${o.id ?? ''}`.toLocaleLowerCase().includes(needle));
  return <DialogFrame title={p.title} closeLabel={t('agentOrg.close')} onClose={p.onClose} scroll={false} maxWidth={480} testID="agent-org-selector">
        <View style={styles.search}>
          <Ionicons name="search-outline" size={17} color={colors.textMuted} />
          <TextInput autoFocus value={query} onChangeText={setQuery} testID="agent-org-selector-search" placeholder={t('agentOrg.searchOptions')} accessibilityLabel={t('agentOrg.searchOptions')} placeholderTextColor={colors.textMuted} style={styles.searchInput} />
        </View>
        <FlatList data={options} keyExtractor={item => item.testID} style={{ flexGrow: 0, flexShrink: 1, maxHeight: 360 }} keyboardShouldPersistTaps="handled" initialNumToRender={12}
          renderItem={({ item }) => <SettingsChoiceRow testID={item.testID} label={item.label} subtitle={item.subtitle} selected={p.selected === item.id} onPress={() => p.onPick(item.id)} />}
          ListEmptyComponent={<Text style={[styles.note, { padding: spacing.lg }]}>{t('agentOrg.noResults')}</Text>} />
  </DialogFrame>;
}

const makeStyles = () => StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md },
  workspace: { marginHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.surface, backgroundColor: colors.card, overflow: 'hidden' },
  sectionLabel: { color: colors.textMuted, fontSize: typeScale.small, fontWeight: '600', padding: spacing.sm, marginBottom: spacing.xs },
  departmentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingRight: spacing.sm, marginBottom: 2, borderRadius: radius.item },
  count: { color: colors.textMuted, fontSize: typeScale.small, fontVariant: ['tabular-nums'], backgroundColor: colors.subtleFill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.item },
  detail: { padding: spacing.lg, gap: spacing.md },
  detailHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: typeScale.heading, fontWeight: '600' },
  note: { color: colors.textMuted, fontSize: typeScale.small, lineHeight: 20 },
  summary: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.subtleFill, borderRadius: radius.control },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.inputBg, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minWidth: 0, minHeight: 42, color: colors.text, fontSize: typeScale.small, paddingVertical: spacing.sm },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  empty: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  adjust: { margin: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.card, overflow: 'hidden' },
  adjustToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md },
  selectField: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, overflow: 'hidden' },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
