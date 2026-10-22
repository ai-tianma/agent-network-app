// 设置 → 用户管理(多用户账号与 Agent 权限,hub agent-network#2084)。
// 列出当前网络的成员;owner / admin 行恒为「全部 Agent」;点成员可改「可访问范围」(全部 / 仅指定)、
// 逐个分配 Agent 与「可对话」、改角色、移出网络(RFC-038 第 1 步)。「新建用户」走 POST /api/admin/users。
// 成员列表宽屏右栏与手机子页共用;点进成员后两端分开画(成员编辑器在 MemberEditor.tsx,#417 重设计):
//   宽屏 —— 双栏弹窗(左:角色 / 任务权限;右:可访问的 Agent);
//   手机 —— 设置三级页「成员」+ 推入的「选择 Agent」/「授权的项目」,保存在顶栏。
// 分组编辑(新建 / 改名 / 成员 / 删除)仍在本文件。纯判断在 user-admin.ts / member-editor.ts。
import { fetchOrg } from './org-api';
import type { OrgData } from './org-model';
import { OrgDesktopPanel, OrgPhoneModal } from './OrgChart';
import { AgentTeamsSection } from './AgentTeams';
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { fetchHubNodes, type HubConfig } from './api';
import { colors, onThemeChange, radius, spacing } from './theme';
import { useTranslation } from './i18n-react';
import { t as tr } from './i18n';
import './i18n-users';
import { SettingsButton, SettingsChoiceRow, SettingsGroup, SettingsRow, SettingsTextField, SettingsTriStateRow } from './settings-kit';
import DialogFrame, { useDialogReveal } from './DialogFrame';
import RemoveSheet from './RemoveSheet';
import { MemberDialog, MemberPage, roleLabel, type PhoneHeaderHost } from './MemberEditor';
import { useAgentPicker, type AgentPickerState } from './agent-picker-state';
import {
  canAddAdminsIn, canManageUsers, manageableNetworks, currentNetworkRow, filterNetworkChoices, memberAccessSummary, selectionState, memberActions, setCanMessage, toggleAgent, validateNewUser,
  accessSummaryText, groupEditChanged, validGroupName,
  type AgentGroup, type AuthMe, type GroupBy, type HubAgentGroup, type MemberRole, type NetworkChoice, type NetworkMember, type PickableAgent,
} from './user-admin';
import {
  createAgentGroup, createHubUser, deleteAgentGroup, fetchAgentGroups, fetchNetworkMembers, fetchNetworks, renameAgentGroup, saveAgentGroupMembers,
} from './user-admin-api';


/** 手机:点成员 = 推三级页「成员」(SettingsScreen 的 detail 机制,顶栏返回 / 安卓返回键都走它)。 */
export type PhoneMemberNav = {
  memberOpen: boolean; groupOpen?: boolean; openMember: () => void; openGroup?: () => void; closeMember: () => void;
  /** 成员页接管顶栏(右上角「保存」、推入的选择页)与回到顶部;SettingsScreen 给。 */
  setHeader?: PhoneHeaderHost['setHeader']; scrollTop?: () => void;
};

export default function UserManagementPanel({ cfg, me, networkId, phone }: { cfg: HubConfig; me: AuthMe | null; networkId: string | undefined; phone?: PhoneMemberNav }) {
  useTranslation();
  const [members, setMembers] = useState<NetworkMember[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<NetworkMember | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberRole, setMemberRole] = useState<MemberRole | 'all'>('all');
  const [panelWidth, setPanelWidth] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const compactMembers = !!phone || (panelWidth > 0 && panelWidth < 600);
  const query = memberQuery.trim().toLowerCase();
  const shownMembers = (members ?? []).filter(m =>
    (memberRole === 'all' || m.role === memberRole) &&
    (!query || m.username.toLowerCase().includes(query) || (m.display_name ?? '').toLowerCase().includes(query)));
  // Agent 分组(RFC-038 §8):undefined = 读取中,null = 这个 Hub 没有分组接口(旧 Hub,整块不显示)。
  const [agentGroups, setAgentGroups] = useState<HubAgentGroup[] | null | undefined>(undefined);
  const [editingGroup, setEditingGroup] = useState<HubAgentGroup | 'new' | null>(null);
  // 组织架构(board #419):undefined = 读取中,null = 这个 Hub 没有部门接口(旧 Hub,整块不显示)。
  const [org, setOrg] = useState<OrgData | null | undefined>(undefined);
  const [orgOpen, setOrgOpen] = useState(false);
  const allowed = canManageUsers(me, networkId);
  const myId = me?.user?.user_id;
  // 新建用户能选的网络:Hub 管理员 = 全部网络;否则 = 我管的(owner / admin)。当前网络排第一、默认选中。
  const [allNetworks, setAllNetworks] = useState<Array<{ network_id: string; network_name?: string | null; name?: string | null }> | null>(null);
  useEffect(() => {
    if (!allowed || me?.user?.role !== 'admin') return;
    void fetchNetworks(cfg).then(setAllNetworks).catch(() => setAllNetworks(null));
  }, [cfg, allowed, me?.user?.role]);
  const networkChoices = useMemo(() => manageableNetworks(me, networkId, allNetworks), [me, networkId, allNetworks]);

  const load = useCallback(() => {
    if (!networkId || !allowed) return;
    setLoadError('');
    void fetchNetworkMembers(cfg, networkId).then(setMembers).catch(e => { setMembers(null); setLoadError(String((e as Error)?.message ?? e)); });
    void fetchAgentGroups(cfg, networkId).then(setAgentGroups).catch(() => setAgentGroups(null));
    void fetchOrg(cfg, networkId).then(setOrg).catch(() => setOrg(null));
  }, [cfg, networkId, allowed]);
  const reloadOrg = useCallback(() => {
    if (!networkId) return;
    void fetchOrg(cfg, networkId).then(setOrg).catch(() => { /* 留着上一份;界面上的错误由操作本身说 */ });
  }, [cfg, networkId]);
  const networkName = currentNetworkRow(me, networkId)?.network_name || networkId || '';
  useEffect(load, [load]);
  // 三级页被返回键关掉了 → 丢掉编辑中的成员;三级页开着却没有成员(状态丢了)→ 退回列表。
  const memberOpen = !!phone?.memberOpen;
  useEffect(() => { if (phone && !memberOpen && editing) setEditing(null); }, [phone, memberOpen, editing]);
  useEffect(() => { if (phone && memberOpen && !editing) phone.closeMember(); }, [phone, memberOpen, editing]);
  const openMember = (m: NetworkMember) => { setNotice(''); setEditing(m); phone?.openMember(); };
  const doneMember = (message: string) => { setEditing(null); if (phone?.memberOpen) phone.closeMember(); setNotice(message); load(); };
  const groupOpen = !!phone?.groupOpen;
  useEffect(() => { if (phone && !groupOpen && editingGroup) setEditingGroup(null); }, [phone, groupOpen, editingGroup]);
  useEffect(() => { if (phone && groupOpen && !editingGroup) phone.closeMember(); }, [phone, groupOpen, editingGroup]);
  const openGroup = (g: HubAgentGroup | 'new') => { setNotice(''); setEditingGroup(g); phone?.openGroup?.(); };
  const doneGroup = (message: string) => { setEditingGroup(null); if (phone?.groupOpen) phone.closeMember(); setNotice(message); load(); };

  if (!allowed || !networkId) return null;
  if (phone && memberOpen && editing) {
    return <MemberPage cfg={cfg} me={me} networkId={networkId} member={editing} agentGroups={agentGroups ?? null} onDone={doneMember} host={{ setHeader: phone.setHeader, scrollTop: phone.scrollTop }} />;
  }
  if (phone && groupOpen && editingGroup) {
    return <GroupPage cfg={cfg} networkId={networkId} group={editingGroup === 'new' ? null : editingGroup} onDone={doneGroup} />;
  }
  return (
    <View testID="user-management" onLayout={e => setPanelWidth(e.nativeEvent.layout.width)}>
      <SettingsGroup
        footer={loadError ? `${tr('users.loadFailed')}: ${loadError}` : notice || tr('users.footer')}
        footerTone={loadError ? 'danger' : notice ? 'accent' : 'muted'}
        testID="user-management-members"
        separators={false}
      >
        <View style={styles.membersHeader}>
          <View style={styles.membersHeading}>
            <Text accessibilityRole="header" style={styles.membersTitle} testID="settings-kit-group-title">{tr('users.members')}</Text>
            {members !== null ? <Text style={styles.membersCount} testID="user-management-count">{members.length}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" onPress={() => { setNotice(''); setCreating(true); }} style={({ pressed }) => [styles.membersNew, pressed && styles.pressed]} testID="user-management-new">
            <Ionicons name="add" size={18} color={colors.onAccent} />
            <Text style={styles.btnPrimaryText}>{tr('users.newUser')}</Text>
          </Pressable>
        </View>
        <View style={styles.membersTools}>
          <View style={[styles.memberSearch, searchFocused && styles.memberSearchFocused]}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput value={memberQuery} onChangeText={setMemberQuery} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder={tr('users.searchMembers')} accessibilityLabel={tr('users.searchMembers')} placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.memberSearchInput} testID="user-management-search" />
            {memberQuery ? <Pressable accessibilityRole="button" accessibilityLabel={tr('users.clearSearch')} onPress={() => setMemberQuery('')} style={styles.memberClear} testID="user-management-search-clear"><Ionicons name="close" size={18} color={colors.textMuted} /></Pressable> : null}
          </View>
          <View style={styles.memberFilters} accessibilityLabel={tr('users.role')} testID="user-management-role-filters">
            {(['all', 'owner', 'admin', 'member', 'viewer'] as const).map(r => (
              <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: memberRole === r }} aria-pressed={memberRole === r} onPress={() => setMemberRole(r)} style={({ pressed }) => [styles.memberFilter, memberRole === r && styles.memberFilterOn, pressed && styles.pressed]} testID={`user-management-filter-${r}`}>
                <Text style={[styles.memberFilterText, memberRole === r && styles.memberFilterTextOn]}>{r === 'all' ? tr('users.allRoles') : roleLabel(r)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {!compactMembers ? <View style={styles.memberColumns} testID="user-management-columns">
          <Text style={[styles.memberColumnText, styles.memberIdentity]}>{tr('users.member')}</Text>
          <Text style={[styles.memberColumnText, styles.memberRoleColumn]}>{tr('users.role')}</Text>
          <Text style={[styles.memberColumnText, styles.memberAccessColumn]}>{tr('users.agents')}</Text>
          <View style={styles.memberAccessory} />
        </View> : null}
        {members === null && !loadError ? (
          <SettingsRow label={tr('users.loading')} busy testID="user-management-loading" />
        ) : null}
        {loadError ? <SettingsRow label={tr('users.retry')} tone="accent" onPress={load} testID="user-management-retry" /> : null}
        {members !== null && !loadError && !shownMembers.length ? <Text style={styles.membersEmpty} testID="user-management-empty">{members.length ? tr('users.noMemberMatch') : tr('users.noMembers')}</Text> : null}
        {shownMembers.map(m => {
          const summary = accessSummaryText(memberAccessSummary(m));
          const value = tr(summary.key, summary.params);
          const acts = memberActions(me, networkId, m);
          const editable = acts.editAccess || acts.editRole || acts.remove;
          const label = `${m.display_name || m.username}${m.user_id === myId ? tr('users.you') : ''}`;
          const badge = <View style={[styles.memberBadge, (m.role === 'owner' || m.role === 'admin') && styles.memberBadgeElevated]}><Text style={[styles.memberBadgeText, (m.role === 'owner' || m.role === 'admin') && styles.memberBadgeTextElevated]}>{roleLabel(m.role)}</Text></View>;
          const access = <Text style={[styles.memberAccessText, summary.empty && styles.memberAccessEmpty]} numberOfLines={compactMembers ? 2 : undefined} testID={`user-row-${m.username}-value`}>{value}</Text>;
          return (
            <Pressable
              key={m.user_id}
              testID={`user-row-${m.username}`}
              accessibilityRole={editable ? 'button' : undefined}
              accessibilityLabel={`${label}, ${roleLabel(m.role)}, ${tr('users.agents')}: ${value}`}
              accessibilityHint={editable ? tr('users.editMember', { name: m.display_name || m.username }) : undefined}
              disabled={!editable}
              onPress={editable ? () => openMember(m) : undefined}
              style={({ pressed }) => [styles.memberRow, compactMembers && styles.memberRowCompact, pressed && styles.memberRowActive]}
            >
              <View style={styles.memberIdentity}>
                <AliasAvatar alias={m.username} size={36} />
                <View style={styles.memberIdentityText}>
                  <Text style={styles.memberName} numberOfLines={1} testID={`user-row-${m.username}-label`}>{label}</Text>
                  {m.display_name && m.display_name !== m.username ? <Text style={styles.memberUsername} numberOfLines={1}>{m.username}</Text> : null}
                  {compactMembers ? <View style={styles.memberMetadata}>{badge}{access}</View> : null}
                </View>
              </View>
              {!compactMembers ? <><View style={styles.memberRoleColumn}>{badge}</View><View style={styles.memberAccessColumn}>{access}</View></> : null}
              <View style={styles.memberAccessory} testID={`user-row-${m.username}-accessory`}>
                {editable ? <Ionicons name={compactMembers ? 'chevron-forward' : 'create-outline'} size={18} color={colors.textMuted} /> : null}
              </View>
            </Pressable>
          );
        })}
      </SettingsGroup>
      {Array.isArray(agentGroups) ? (
        <>
          <SettingsGroup title={tr('users.agentGroups')} footer={tr('users.agentGroupsFooter')} testID="agent-groups">
            {agentGroups.map(g => (
              <SettingsRow key={g.group_id} label={g.name} value={tr('users.groupMembers', { count: g.member_count })} onPress={() => openGroup(g)} testID={`agent-group-row-${g.name}`} />
            ))}
          </SettingsGroup>
          <SettingsButton label={tr('users.newGroup')} variant="plain" onPress={() => openGroup('new')} testID="agent-group-new" />
        </>
      ) : null}
      {org && members ? (
        phone ? (
          <SettingsGroup title={tr('users.org')} footer={tr('users.orgFooter')} testID="org-group">
            <SettingsRow label={tr('users.orgMembersDepts')} value={tr('users.orgCount', { count: org.departments.length })} onPress={() => setOrgOpen(true)} testID="org-open" />
          </SettingsGroup>
        ) : (
          // 和上面几组同一个设置卡片(同宽、同左右边、同标题样式);面板自己不再画外框。
          <SettingsGroup title={tr('users.org')} footer={tr('users.orgFooter')} separators={false} testID="org-group">
            <OrgDesktopPanel cfg={cfg} networkId={networkId} networkName={networkName} org={org} people={members} onChanged={reloadOrg} />
          </SettingsGroup>
        )
      ) : null}
      {/* Agent 组织(#766):Agent 自己的团队树,紧跟人的组织架构;旧 Hub 只一行版本提示。 */}
      {members ? <AgentTeamsSection cfg={cfg} networkId={networkId} me={me} people={members} phone={!!phone} /> : null}
      {orgOpen && org && members ? (
        <OrgPhoneModal cfg={cfg} networkId={networkId} networkName={networkName} org={org} people={members} onChanged={reloadOrg} onClose={() => setOrgOpen(false)} />
      ) : null}
      {creating ? (
        <NewUserDialog
          cfg={cfg}
          me={me}
          networkId={networkId}
          networks={networkChoices.length ? networkChoices : [{ network_id: networkId, name: currentNetworkRow(me, networkId)?.network_name ?? networkId }]}
          onClose={() => setCreating(false)}
          onCreated={(name, net) => { setCreating(false); setNotice(net === networkId ? tr('users.created', { name }) : tr('users.createdElsewhere', { name, network: networkChoices.find(n => n.network_id === net)?.name ?? net })); load(); }}
        />
      ) : null}
      {editing && !phone ? (
        <MemberDialog
          cfg={cfg}
          me={me}
          networkId={networkId}
          member={editing}
          agentGroups={agentGroups ?? null}
          onClose={() => setEditing(null)}
          onDone={doneMember}
        />
      ) : null}
      {editingGroup && !phone ? (
        <GroupDialog cfg={cfg} networkId={networkId} group={editingGroup === 'new' ? null : editingGroup} onClose={() => setEditingGroup(null)} onDone={doneGroup} />
      ) : null}
    </View>
  );
}

function Field({ label, hint, testID, ...input }: ComponentProps<typeof TextInput> & { label: string; hint?: string; testID: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}{hint ? <Text style={styles.fieldHint}>{`  ${hint}`}</Text> : null}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        {...input}
      />
    </View>
  );
}

function Actions({ onCancel, onConfirm, confirmLabel, disabled, busy, danger, left, testID }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string; disabled?: boolean; busy?: boolean; danger?: boolean; left?: ReactNode; testID: string }) {
  return (
    <View style={styles.actions}>
      {left ? <View style={styles.actionsLeft}>{left}</View> : null}
      <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]} testID={`${testID}-cancel`}>
        <Text style={styles.btnPlainText}>{tr('users.cancel')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!(disabled || busy) }} disabled={disabled || busy} onPress={onConfirm} style={({ pressed }) => [styles.btn, danger ? styles.btnDanger : styles.btnPrimary, (disabled || busy) && styles.disabled, pressed && styles.pressed]} testID={`${testID}-confirm`}>
        {busy ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
        <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
      </Pressable>
    </View>
  );
}

/**
 * 新建用户的「网络」:默认当前网络,收起时是一行(和输入框同高),点开是可搜索的单选清单(内部滚动,最多约 5 行高)。
 * Hub 管理员能往任何网络建人(26 个网络 = 一墙 chip 把「创建」挤出屏幕,Vincent 2026-09-30)—— 所以不再平铺。
 */
function NetworkPicker({ networks, value, onChange, fallbackName }: { networks: NetworkChoice[]; value: string; onChange: (id: string) => void; fallbackName: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const reveal = useDialogReveal();
  const current = networks.find(n => n.network_id === value);
  const shown = useMemo(() => filterNetworkChoices(networks, query), [networks, query]);
  if (networks.length <= 1) {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{tr('users.network')}</Text>
        <Text style={styles.readonly} numberOfLines={1} testID="new-user-network">{networks[0]?.name ?? fallbackName}</Text>
      </View>
    );
  }
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{tr('users.network')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${tr('users.network')} ${current?.name ?? value}`} accessibilityState={{ expanded: open }} onPress={() => { if (!open) reveal(); setOpen(o => !o); }} style={styles.picker} testID="new-user-network">
        <Text style={styles.pickerValue} numberOfLines={1} testID="new-user-network-value">{current?.name ?? value}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>
      {open ? (
        <View style={styles.pickerPanel} testID="new-user-network-panel">
          <View style={styles.pickerSearch}>
            <Ionicons name="search-outline" size={15} color={colors.textMuted} />
            <TextInput value={query} onChangeText={setQuery} placeholder={tr('users.searchNetwork')} placeholderTextColor={colors.textMuted} accessibilityLabel={tr('users.searchNetwork')} autoCapitalize="none" autoCorrect={false} style={styles.searchInput} testID="new-user-network-search" />
          </View>
          <ScrollView style={styles.pickerList} nestedScrollEnabled keyboardShouldPersistTaps="handled" testID="new-user-network-list">
            {shown.length ? shown.map(n => {
              const on = n.network_id === value;
              return (
                <Pressable key={n.network_id} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} aria-checked={on} onPress={() => { onChange(n.network_id); setOpen(false); setQuery(''); }} style={({ pressed }) => [styles.pickerRow, on && styles.pickerRowOn, pressed && styles.pressed]} testID={`new-user-network-${n.network_id}`}>
                  <Text style={styles.pickerRowText} numberOfLines={1}>{n.name}</Text>
                  {on ? <Ionicons name="checkmark" size={16} color={colors.accent} /> : null}
                </Pressable>
              );
            }) : <Text style={styles.empty}>{tr('users.noNetworkMatch')}</Text>}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function NewUserDialog({ cfg, me, networkId, networks, onClose, onCreated }: {
  cfg: HubConfig; me: AuthMe | null; networkId: string; networks: NetworkChoice[]; onClose: () => void; onCreated: (name: string, networkId: string) => void;
}) {
  const [targetNet, setTargetNet] = useState(networkId);
  const canAddAdmins = canAddAdminsIn(me, targetNet);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problem = validateNewUser({ username, password });
  const touched = username.length > 0 || password.length > 0;
  const roles: MemberRole[] = canAddAdmins ? ['member', 'viewer', 'admin'] : ['member', 'viewer'];
  useEffect(() => { if (!canAddAdmins && role === 'admin') setRole('member'); }, [canAddAdmins, role]);
  const submit = () => {
    if (problem) return;
    setBusy(true); setError('');
    void createHubUser(cfg, { username: username.trim(), password, ...(displayName.trim() ? { display_name: displayName.trim() } : {}), network_id: targetNet, role })
      .then(() => onCreated(username.trim(), targetNet))
      .catch(e => setError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false));
  };
  return (
    <DialogFrame
      title={tr('users.newUser')}
      closeLabel={tr('users.close')}
      onClose={onClose}
      testID="new-user-dialog"
      footer={<Actions onCancel={onClose} onConfirm={submit} confirmLabel={tr('users.create')} disabled={!!problem} busy={busy} testID="new-user" />}
    >
      <Field label={tr('users.username')} value={username} onChangeText={setUsername} testID="new-user-username" />
      <Field label={tr('users.password')} hint={tr('users.passwordHint')} value={password} onChangeText={setPassword} secureTextEntry testID="new-user-password" />
      <Field label={tr('users.displayName')} hint={tr('users.optional')} value={displayName} onChangeText={setDisplayName} testID="new-user-display-name" />
      <NetworkPicker networks={networks} value={targetNet} onChange={setTargetNet} fallbackName={networkId} />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{tr('users.role')}</Text>
        <View style={styles.segmented} accessibilityRole="radiogroup">
          {roles.map(r => (
            <Pressable key={r} accessibilityRole="radio" accessibilityState={{ selected: role === r, checked: role === r }} onPress={() => setRole(r)} style={[styles.segment, role === r && styles.segmentOn]} testID={`new-user-role-${r}`}>
              <Text style={[styles.segmentText, role === r && styles.segmentTextOn]} numberOfLines={1}>{roleLabel(r)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {error ? <Text style={styles.error} testID="new-user-error">{error}</Text> : touched && problem ? <Text style={styles.hint} testID="new-user-problem">{tr(`users.err.${problem}`)}</Text> : null}
    </DialogFrame>
  );
}

const GROUP_BYS: readonly GroupBy[] = ['none', 'host', 'runtime'];

/** 分组标题:机器名 / 类型名;空值是「未知机器 / 未知类型」。 */
function groupLabel(g: AgentGroup, by: string): string {
  if (g.label) return g.label;
  return by === 'host' ? tr('users.unknownHost') : tr('users.unknownRuntime');
}

function triChecked(sel: ReadonlyMap<string, boolean>, agents: readonly PickableAgent[]): boolean | 'mixed' {
  const st = selectionState(sel, agents);
  return st === 'all' ? true : st === 'some' ? 'mixed' : false;
}

/** 宽屏分组标题前的三态复选框:■✓ 全选 / ■— 部分 / □ 没选(和 Agent 行的复选框同尺寸同色)。 */
function TriCheck({ state }: { state: 'all' | 'some' | 'none' }) {
  if (state === 'none') return <Ionicons name="square-outline" size={20} color={colors.textMuted} />;
  return (
    <View style={styles.triOn}>
      <Ionicons name={state === 'all' ? 'checkmark' : 'remove'} size={14} color={colors.onAccent} />
    </View>
  );
}

/** 宽屏的 Agent 清单:搜索 + 分组 / 全选 / 清空 工具条 + 可勾选清单。chat = 已选行带「可对话」开关;否则按 readOnlyTag 显示「只读」。 */
function DesktopAgentPicker({ p, enabled, chat, readOnlyTag = true, note }: { p: AgentPickerState; enabled: boolean; chat: boolean; readOnlyTag?: boolean; note: string }) {
  return (
    <View style={[styles.field, styles.pickerArea, !enabled && styles.inactive]} pointerEvents={enabled ? 'auto' : 'none'} testID="grants-picker">
      <View style={styles.search}>
        <Ionicons name="search-outline" size={15} color={colors.textMuted} />
        <TextInput value={p.query} onChangeText={p.setQuery} editable={enabled} placeholder={tr('users.search')} placeholderTextColor={colors.textMuted} accessibilityLabel={tr('users.search')} autoCapitalize="none" autoCorrect={false} style={styles.searchInput} testID="grants-search" />
      </View>
      <View style={styles.toolbar} testID="grants-toolbar">
        <View style={[styles.segmented, styles.segmentedSmall]} accessibilityRole="radiogroup" testID="grants-group-by">
          {GROUP_BYS.map(g => (
            <Pressable key={g} accessibilityRole="radio" accessibilityState={{ selected: p.groupBy === g, checked: p.groupBy === g }} aria-checked={p.groupBy === g} onPress={() => p.setGroupBy(g)} style={[styles.segmentSmall, p.groupBy === g && styles.segmentOn]} testID={`grants-group-by-${g}`}>
              <Text style={[styles.segmentTextSmall, p.groupBy === g && styles.segmentTextOn]} numberOfLines={1} testID={`grants-group-by-${g}-text`}>{tr(`users.groupBy.${g}`)}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.toolbarLinks}>
          <Pressable accessibilityRole="button" onPress={p.selectVisible} hitSlop={6} style={({ pressed }) => [styles.linkBtnSmall, pressed && styles.pressed]} testID="grants-select-visible">
            <Text style={styles.link} numberOfLines={1}>{p.query.trim() ? tr('users.selectResults') : tr('users.selectAll')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={p.clearAll} hitSlop={6} style={({ pressed }) => [styles.linkBtnSmall, pressed && styles.pressed]} testID="grants-clear">
            <Text style={styles.link} numberOfLines={1}>{tr('users.clearAll')}</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} testID="grants-list">
        {p.agents === null ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.textMuted} /> : null}
        {p.agents && !p.visible.length ? <Text style={styles.empty}>{p.agents.length ? tr('users.noMatch') : tr('users.noAgents')}</Text> : null}
        {(p.groups ?? [{ key: '', label: null, agents: p.visible }]).map(g => (
          <View key={`g-${g.key}`}>
            {p.groups ? (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: triChecked(p.selection, g.agents) }} aria-checked={triChecked(p.selection, g.agents)} accessibilityLabel={groupLabel(g, p.groupBy)} disabled={!enabled} onPress={() => p.toggleGroup(g.agents)} style={({ pressed }) => [styles.groupHeader, pressed && styles.pressed]} testID={`grant-group-${g.key || 'unknown'}`}>
                <TriCheck state={selectionState(p.selection, g.agents)} />
                <Text style={styles.groupName} numberOfLines={1}>{groupLabel(g, p.groupBy)}</Text>
                <Text style={styles.groupCount} testID={`grant-group-${g.key || 'unknown'}-count`}>{tr('users.groupCount', { on: g.agents.filter(a => p.selection.has(a.node_id)).length, total: g.agents.length })}</Text>
              </Pressable>
            ) : null}
        {g.agents.map(a => {
          const on = p.selection.has(a.node_id);
          return (
            <View key={a.node_id} style={[styles.agentRow, p.groups && styles.agentRowGrouped]} testID={`grant-row-${a.alias}`}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !enabled }} aria-checked={on} disabled={!enabled} accessibilityLabel={a.alias} onPress={() => p.setSelection(s => toggleAgent(s, a.node_id))} style={styles.agentPick} testID={`grant-toggle-${a.alias}`}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.accent : colors.textMuted} />
                <AliasAvatar alias={a.alias} size={28} />
                <Text style={styles.agentName} numberOfLines={1}>{a.display_name || a.alias}</Text>
              </Pressable>
              {on && chat ? (
                <View style={styles.canMessage}>
                  <Text style={styles.canMessageText}>{tr('users.canMessage')}</Text>
                  <Switch
                    accessibilityLabel={`${tr('users.canMessage')} ${a.alias}`}
                    value={p.selection.get(a.node_id) === true}
                    disabled={!enabled}
                    onValueChange={v => p.setSelection(s => setCanMessage(s, a.node_id, v))}
                    trackColor={{ true: colors.accent, false: colors.border }}
                    thumbColor={colors.card}
                    testID={`grant-can-message-${a.alias}`}
                  />
                </View>
              ) : on && readOnlyTag ? (
                <Text style={styles.readOnlyTag} testID={`grant-read-only-${a.alias}`}>{tr('users.readOnly')}</Text>
              ) : null}
            </View>
          );
        })}
          </View>
        ))}
      </ScrollView>
      <Text style={styles.hint} testID="grants-count">{tr('users.selected', { count: p.selection.size })}</Text>
      <Text style={styles.hint} testID="grants-one-time">{note}</Text>
    </View>
  );
}

/** 手机的 Agent 清单:分组方式(单选行)+ 搜索 / 全选 / 清空 卡片 + 按组的卡片(三态行 + ✓ 行)。 */
function PhoneAgentPicker({ p, note }: { p: AgentPickerState; note: string }) {
  return (
    <>
      <SettingsGroup title={tr('users.groupBy')} testID="member-page-group-by">
        {GROUP_BYS.map(g => (
          <SettingsChoiceRow key={g} label={tr(`users.groupBy.${g}`)} selected={p.groupBy === g} onPress={() => p.setGroupBy(g)} testID={`grants-group-by-${g}`} />
        ))}
      </SettingsGroup>
      <SettingsGroup title={tr('users.agents')} footer={note} testID="member-page-agents">
        <SettingsTextField value={p.query} onChangeText={p.setQuery} placeholder={tr('users.search')} accessibilityLabel={tr('users.search')} testID="grants-search" />
        <SettingsRow label={p.query.trim() ? tr('users.selectResults') : tr('users.selectAll')} tone="accent" chevron={false} onPress={p.selectVisible} testID="grants-select-visible" />
        <SettingsRow label={tr('users.clearAll')} value={tr('users.selected', { count: p.selection.size })} tone="accent" chevron={false} onPress={p.clearAll} testID="grants-clear" />
        {p.agents === null ? <SettingsRow label={tr('users.loading')} busy testID="member-page-loading" /> : null}
        {p.agents && !p.visible.length ? <SettingsRow label={p.agents.length ? tr('users.noMatch') : tr('users.noAgents')} tone="muted" testID="member-page-empty" /> : null}
        {!p.groups ? p.visible.map(a => (
          <SettingsChoiceRow
            key={a.node_id}
            label={a.display_name || a.alias}
            subtitle={a.display_name ? a.alias : undefined}
            selected={p.selection.has(a.node_id)}
            onPress={() => p.setSelection(s => toggleAgent(s, a.node_id))}
            testID={`grant-toggle-${a.alias}`}
          />
        )) : null}
      </SettingsGroup>
      {(p.groups ?? []).map(g => (
        <SettingsGroup key={`g-${g.key}`} title={groupLabel(g, p.groupBy)} testID={`member-page-group-${g.key || 'unknown'}`}>
          <SettingsTriStateRow
            label={p.groupBy === 'host' ? tr('users.selectHost') : tr('users.selectRuntime')}
            subtitle={tr('users.groupSelected', { on: g.agents.filter(a => p.selection.has(a.node_id)).length, total: g.agents.length })}
            state={selectionState(p.selection, g.agents)}
            onPress={() => p.toggleGroup(g.agents)}
            testID={`grant-group-${g.key || 'unknown'}`}
          />
          {g.agents.map(a => (
            <SettingsChoiceRow
              key={a.node_id}
              label={a.display_name || a.alias}
              subtitle={a.display_name ? a.alias : undefined}
              selected={p.selection.has(a.node_id)}
              onPress={() => p.setSelection(s => toggleAgent(s, a.node_id))}
              testID={`grant-toggle-${a.alias}`}
            />
          ))}
        </SettingsGroup>
      ))}
    </>
  );
}

/** 分组编辑的状态与保存 / 删除(宽屏弹窗与手机三级页共用)。group=null ⇒ 新建。 */
function useGroupEditor(cfg: HubConfig, networkId: string, group: HubAgentGroup | null, onDone: (message: string) => void) {
  const [agents, setAgents] = useState<PickableAgent[] | null>(null);
  const [name, setName] = useState(group?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const picker = useAgentPicker(agents, undefined);
  const { setSelection } = picker;
  useEffect(() => {
    let live = true;
    void fetchHubNodes({ ...cfg, networkId })
      .then(nodes => {
        if (!live) return;
        setAgents((nodes.nodes ?? []).map(n => ({ node_id: n.node_id, alias: n.alias, display_name: (n as any).display_name ?? null, role: n.role ?? null, hostname: n.hostname ?? null, runtime: n.runtime ?? null })));
        setSelection(new Map((group?.node_ids ?? []).map(id => [id, true] as [string, boolean])));
      })
      .catch(e => { if (live) { setAgents([]); setError(String((e as Error)?.message ?? e)); } });
    return () => { live = false; };
  }, [cfg, networkId, group?.group_id]);
  const nodeIds = useMemo(() => [...picker.selection.keys()].sort(), [picker.selection]);
  const nameOk = validGroupName(name);
  const changed = !group || groupEditChanged({ name: group.name, nodeIds: group.node_ids }, { name, nodeIds });
  const save = () => {
    if (!nameOk) { setError(tr('users.err.groupName')); return; }
    setBusy(true); setError('');
    void (async () => {
      if (!group) { await createAgentGroup(cfg, networkId, { name: name.trim(), node_ids: nodeIds }); return; }
      if (name.trim() !== group.name) await renameAgentGroup(cfg, networkId, group.group_id, name.trim());
      if (groupEditChanged({ name: '', nodeIds: group.node_ids }, { name: '', nodeIds })) await saveAgentGroupMembers(cfg, networkId, group.group_id, nodeIds);
    })()
      .then(() => onDone(tr('users.groupSaved', { name: name.trim() })))
      .catch(e => setError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false));
  };
  const remove = () => {
    if (!group) return;
    setBusy(true); setError('');
    void deleteAgentGroup(cfg, networkId, group.group_id)
      .then(() => onDone(tr('users.groupDeleted', { name: group.name })))
      .catch(e => { setConfirmDelete(false); setError(String((e as Error)?.message ?? e)); })
      .finally(() => setBusy(false));
  };
  const deleteMessage = group ? tr('users.deleteGroupConfirm', { name: group.name, count: group.granted_user_count }) : '';
  return { group, name, setName, nameOk, picker, busy, error, confirmDelete, setConfirmDelete, changed, save, remove, deleteMessage };
}

/** 宽屏:分组编辑弹窗。名称 + 与成员授权同一套 Agent 清单(不带可对话);已有分组左下角「删除分组」,点了换成确认条。 */
function GroupDialog({ cfg, networkId, group, onClose, onDone }: { cfg: HubConfig; networkId: string; group: HubAgentGroup | null; onClose: () => void; onDone: (message: string) => void }) {
  const g = useGroupEditor(cfg, networkId, group, onDone);
  return (
    <DialogFrame
      title={group ? `${tr('users.groupTag')} · ${group.name}` : tr('users.newGroup')}
      closeLabel={tr('users.close')}
      onClose={onClose}
      scroll={false}
      testID="group-dialog"
      footer={g.confirmDelete ? (
        <View style={styles.confirmBox} testID="group-delete-box">
          <Text style={styles.confirmText}>{g.deleteMessage}</Text>
          <Actions onCancel={() => g.setConfirmDelete(false)} onConfirm={g.remove} confirmLabel={tr('users.deleteGroupYes')} danger busy={g.busy} testID="group-delete" />
        </View>
      ) : (
        <Actions
          onCancel={onClose}
          onConfirm={g.save}
          confirmLabel={group ? tr('users.save') : tr('users.create')}
          disabled={!g.changed || !g.nameOk}
          busy={g.busy}
          testID="group"
          left={group ? (
            <Pressable accessibilityRole="button" onPress={() => g.setConfirmDelete(true)} hitSlop={6} style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]} testID="group-delete-open">
              <Text style={styles.linkDanger}>{tr('users.deleteGroup')}</Text>
            </Pressable>
          ) : undefined}
        />
      )}
    >
      <Field label={tr('users.groupName')} value={g.name} onChangeText={g.setName} maxLength={64} testID="group-name" />
      <DesktopAgentPicker p={g.picker} enabled chat={false} readOnlyTag={false} note={tr('users.groupNote')} />
      {g.error ? <Text style={styles.error} testID="group-error">{g.error}</Text> : null}
    </DialogFrame>
  );
}

/** 手机:设置三级页「分组」。名称卡片 + 同一套微信式 Agent 清单 + 保存 / 删除(底部确认单)。 */
function GroupPage({ cfg, networkId, group, onDone }: { cfg: HubConfig; networkId: string; group: HubAgentGroup | null; onDone: (message: string) => void }) {
  const g = useGroupEditor(cfg, networkId, group, onDone);
  return (
    <View testID="group-page">
      <SettingsGroup title={tr('users.groupName')} testID="group-page-name">
        <SettingsTextField value={g.name} onChangeText={g.setName} placeholder={tr('users.groupName')} maxLength={64} accessibilityLabel={tr('users.groupName')} testID="group-name" />
      </SettingsGroup>
      <PhoneAgentPicker p={g.picker} note={tr('users.groupNote')} />
      {g.error ? <SettingsGroup footer={g.error} footerTone="danger" testID="group-error" /> : null}
      <SettingsButton label={group ? tr('users.save') : tr('users.create')} onPress={g.save} disabled={!g.changed || !g.nameOk} busy={g.busy && !g.confirmDelete} testID="group-confirm" />
      {group ? <SettingsButton label={tr('users.deleteGroup')} variant="destructive" onPress={() => g.setConfirmDelete(true)} testID="group-delete-open" /> : null}
      {g.confirmDelete && group ? <RemoveSheet name={group.name} message={g.deleteMessage} confirmLabel={tr('users.deleteGroupYes')} busy={g.busy} onCancel={() => g.setConfirmDelete(false)} onConfirm={g.remove} /> : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  membersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.md },
  membersHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  membersTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  membersCount: { color: colors.textSecondary, backgroundColor: colors.subtleFill, borderRadius: radius.control, paddingHorizontal: spacing.sm, paddingVertical: 3, fontSize: 12, fontWeight: '600' },
  membersNew: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.accent },
  membersTools: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  memberSearch: { width: '100%', maxWidth: 360, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.inputBg },
  memberSearchFocused: { borderColor: colors.accent },
  memberSearchInput: { flex: 1, minWidth: 0, minHeight: 44, paddingVertical: spacing.sm, paddingRight: spacing.sm, color: colors.text, fontSize: 14 },
  memberClear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  memberFilters: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  memberFilter: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.control },
  memberFilterOn: { backgroundColor: colors.tonalBg },
  memberFilterText: { color: colors.textSecondary, fontSize: 13 },
  memberFilterTextOn: { color: colors.accent, fontWeight: '600' },
  memberColumns: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.subtleFill },
  memberColumnText: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 72, paddingLeft: spacing.lg, paddingRight: spacing.lg, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  memberRowCompact: { gap: spacing.sm, paddingRight: spacing.sm },
  memberRowActive: { backgroundColor: colors.rowActive },
  memberIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  memberIdentityText: { flex: 1, minWidth: 0, gap: 3 },
  memberName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  memberUsername: { color: colors.textMuted, fontSize: 12 },
  memberRoleColumn: { width: 100, alignItems: 'flex-start' },
  memberAccessColumn: { flex: 0.8, minWidth: 0 },
  memberBadge: { alignSelf: 'flex-start', borderRadius: radius.control, backgroundColor: colors.subtleFill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  memberBadgeElevated: { backgroundColor: colors.tonalBg },
  memberBadgeText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  memberBadgeTextElevated: { color: colors.accent },
  memberAccessText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  memberAccessEmpty: { color: colors.failed },
  memberAccessory: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  memberMetadata: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 },
  membersEmpty: { color: colors.textMuted, fontSize: 13, lineHeight: 20, padding: spacing.lg, textAlign: 'center' },
  field: { gap: 6 },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  fieldHint: { color: colors.textMuted, fontSize: 12, fontWeight: '400' },
  input: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 14, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  picker: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  pickerValue: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  pickerPanel: { borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  pickerSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickerList: { maxHeight: 216, flexGrow: 0 },
  pickerRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  pickerRowOn: { backgroundColor: colors.subtleFill },
  pickerRowText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  pickerArea: { flexShrink: 1, minHeight: 0 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toolbarLinks: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginLeft: 'auto' },
  segmentedSmall: { flexShrink: 0 },
  // 按内容宽的小分段:自己一套底样式,不叠在 segment(flex: 1)上。原生 Yoga 里 flex > 0 时 flexBasis: 'auto' 等于没写,
  // 基准取 0 → 每段只剩左右内边距、字宽 0(0.2.161 平板「半截青色药丸」)。flex-basis-auto-rule.test.ts 守着。
  segmentSmall: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: 6 },
  segmentTextSmall: { color: colors.textSecondary, fontSize: 12 },
  linkBtnSmall: { minHeight: 30, justifyContent: 'center' },
  link: { color: colors.accent, fontSize: 13 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36, paddingTop: spacing.sm },
  groupName: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13, fontWeight: '600' },
  groupCount: { color: colors.textMuted, fontSize: 12 },
  agentRowGrouped: { paddingLeft: 28 },
  triOn: { width: 17, height: 17, marginHorizontal: 1.5, borderRadius: radius.mark, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  readonly: { color: colors.text, fontSize: 14, paddingVertical: 4 },
  segmented: { flexDirection: 'row', borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9 },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: 13 },
  segmentTextOn: { color: colors.onAccent, fontWeight: '600' },
  error: { color: colors.failed, fontSize: 12, lineHeight: 18 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  actionsLeft: { marginRight: 'auto' },
  linkBtn: { minHeight: 38, justifyContent: 'center' },
  linkDanger: { color: colors.failed, fontSize: 14 },
  btnDanger: { backgroundColor: colors.failed },
  inactive: { opacity: 0.45 },
  readOnlyTag: { color: colors.textMuted, fontSize: 12 },
  confirmBox: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  confirmText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: spacing.lg, borderRadius: radius.control, justifyContent: 'center' },
  btnPlain: { borderWidth: 1, borderColor: colors.border },
  btnPlainText: { color: colors.text, fontSize: 14 },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, paddingVertical: 8, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  list: { maxHeight: 360, flexGrow: 0, flexShrink: 1 },
  listContent: { gap: 2 },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  agentPick: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  agentName: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  canMessage: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  canMessageText: { color: colors.textSecondary, fontSize: 12 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
