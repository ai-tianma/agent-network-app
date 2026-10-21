import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text } from './ui-text';
import { colors, spacing, type as typeScale } from './theme';
import type { HubConfig } from './api';
import { loadAgentOrg, moveAgentDepartment } from './agent-org-api';
import { agentCount, agentsDirectlyIn, orgTree, placeAgents, type AgentOrgData, type DemoMove, type PlacedAgent } from './agent-org-model';
import { childrenOf, flattenTree } from './org-model';
import { SettingsButton, SettingsChoiceRow, SettingsGroup, SettingsRow } from './settings-kit';
import { useTranslation } from './i18n-react';
import './i18n-agent-org';

type Props = { cfg: HubConfig; networkId?: string; phone: boolean };

export default function AgentOrgScreen(p: Props) {
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
      setFocus(p.phone ? undefined : (data?.departments[0]?.id ?? null));
    }, () => { if (live) setPhase({ kind: 'error' }); });
    return () => { live = false; };
  }, [p.cfg.serverUrl, p.cfg.token, p.networkId, p.phone, attempt]);

  const data = phase.kind === 'ready' ? phase.data : null;
  const placed = useMemo(() => (data ? placeAgents(data, moves) : []), [data, moves]);
  const showTree = !p.phone || focus === undefined;
  const showDetail = !!data && (p.phone ? focus !== undefined : true);

  return (
    <View>
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
      {data && (showTree || showDetail) ? (
        <View testID="agent-org-tree" style={!p.phone ? { flexDirection: 'row', alignItems: 'flex-start', minHeight: 440 } : undefined}>
          {showTree ? (
            <View style={!p.phone ? { width: 240 } : undefined}>
              <DepartmentTree data={data} placed={placed} onFocus={setFocus} />
            </View>
          ) : null}
          {showDetail ? (
            <View style={!p.phone ? { flex: 1, minWidth: 0 } : undefined} testID="agent-org-detail">
              <DepartmentDetail data={data} placed={placed} focus={focus ?? null} phone={p.phone} onFocus={setFocus} onBack={() => setFocus(undefined)} />
            </View>
          ) : null}
        </View>
      ) : null}
      {phase.kind === 'ready' ? (
        <DemoAdjust
          data={data}
          placed={placed}
          moves={moves}
          pickAgent={pickAgent}
          pickDept={pickDept}
          note={adjustNote}
          saving={saving}
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
    </View>
  );
}

function DepartmentTree(p: { data: AgentOrgData; placed: PlacedAgent[]; onFocus: (id: string | null) => void }) {
  const { t } = useTranslation();
  const rows = flattenTree(orgTree(p.data));
  const footer = !p.data.directory ? t('agentOrg.directoryMissing') : !p.data.departmentsApi ? t('agentOrg.noTree') : t('agentOrg.readOnly');
  // #1976 —— 人类部门树与 Agent 归属是两件事:Agent 只认显式归属,不按负责人部门推断。
  const independent = p.data.agentDepartmentSupported ? t('agentOrg.independent') : '';
  return (
    <SettingsGroup footer={footer} testID="agent-org-departments">
      {rows.length ? rows.map(row => (
        <SettingsRow
          key={row.dept.id}
          testID={`agent-org-dept-${row.dept.id}`}
          label={`${'\u2003'.repeat(row.depth)}${row.dept.name}`}
          value={t('agentOrg.agentsCount', { count: agentCount(p.placed, p.data, row.dept.id) })}
          onPress={() => p.onFocus(row.dept.id)}
        />
      )) : <SettingsRow label={t('agentOrg.empty')} testID="agent-org-empty" />}
      {p.data.directory || agentCount(p.placed, p.data, null) > 0 ? (
        <SettingsRow
          testID="agent-org-dept-unassigned"
          label={t('agentOrg.unowned')}
          value={t('agentOrg.agentsCount', { count: agentCount(p.placed, p.data, null) })}
          onPress={() => p.onFocus(null)}
        />
      ) : null}
      {independent ? (
        <Text testID="agent-org-independent-note" style={{ color: colors.textMuted, fontSize: typeScale.small, marginTop: spacing.sm }}>{independent}</Text>
      ) : null}
    </SettingsGroup>
  );
}

function DepartmentDetail(p: { data: AgentOrgData; placed: PlacedAgent[]; focus: string | null; phone: boolean; onFocus: (id: string) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const dept = p.focus ? p.data.departments.find(d => d.id === p.focus) : undefined;
  const title = p.focus === null ? t('agentOrg.unowned') : (dept?.name ?? t('agentOrg.unowned'));
  const agents = agentsDirectlyIn(p.placed, p.focus);
  const children = p.focus ? childrenOf(orgTree(p.data), p.focus) : [];
  return (
    <SettingsGroup title={title} testID="agent-org-detail-card">
      {p.phone ? <SettingsRow label={t('agentOrg.back')} onPress={p.onBack} testID="agent-org-back" /> : null}
      {p.phone ? children.map(child => (
        <SettingsRow
          key={child.id}
          testID={`agent-org-child-${child.id}`}
          label={child.name}
          value={t('agentOrg.agentsCount', { count: agentCount(p.placed, p.data, child.id) })}
          onPress={() => p.onFocus(child.id)}
        />
      )) : null}
      {agents.length ? agents.map(agent => <AgentLine key={agent.nodeId} agent={agent} />) : <SettingsRow label={t('agentOrg.noAgents')} testID="agent-org-no-agents" />}
    </SettingsGroup>
  );
}

function AgentLine(p: { agent: PlacedAgent }) {
  const { t } = useTranslation();
  const agent = p.agent;
  const subtitle = agent.ownerName ? t('agentOrg.owner', { name: agent.ownerName }) : t('agentOrg.noOwner');
  return <SettingsRow testID={`agent-org-agent-${agent.nodeId}`} label={agent.alias} subtitle={subtitle} />;
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
  const departments = p.data?.departments ?? [];
  return (
    <View testID="agent-org-demo">
      <SettingsGroup title={t('agentOrg.demoTitle')} footer={t('agentOrg.demoHint')}>
        {p.placed.length === 0 ? <SettingsRow label={t('agentOrg.demoNoAgents')} testID="agent-org-demo-empty" /> : null}
      </SettingsGroup>
      {p.placed.length ? (
        <SettingsGroup title={t('agentOrg.demoPickAgent')}>
          {p.placed.map(agent => (
            <SettingsChoiceRow
              key={agent.nodeId}
              testID={`agent-org-demo-agent-${agent.nodeId}`}
              label={agent.alias}
              subtitle={agent.ownerName ? agent.ownerName : t('agentOrg.noOwner')}
              selected={p.pickAgent === agent.nodeId}
              onPress={() => p.onPickAgent(agent.nodeId)}
            />
          ))}
        </SettingsGroup>
      ) : null}
      {p.placed.length ? (
        <SettingsGroup title={t('agentOrg.demoPickDept')}>
          <SettingsChoiceRow testID="agent-org-demo-dept-unassigned" label={t('agentOrg.unowned')} selected={p.pickDept === null} onPress={() => p.onPickDept(null)} />
          {departments.map(dept => (
            <SettingsChoiceRow key={dept.id} testID={`agent-org-demo-dept-${dept.id}`} label={dept.name} selected={p.pickDept === dept.id} onPress={() => p.onPickDept(dept.id)} />
          ))}
        </SettingsGroup>
      ) : null}
      {p.placed.length ? <SettingsButton label={p.saving ? t('agentOrg.saving') : t('agentOrg.demoApply')} onPress={p.onApply} disabled={p.saving} testID="agent-org-demo-apply" /> : null}
      {p.note ? <SettingsGroup><SettingsRow label={p.note} testID="agent-org-demo-result" /></SettingsGroup> : null}
    </View>
  );
}
