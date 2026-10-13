import { ownerCounts } from './i18n-task-presentation';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
import './i18n-task-tags';
// 桌面工作区在「任务」页时的左栏:原来这里是会话 / Agent 列表(跟任务页无关)。现在是筛选:
// 标签(可折叠,全部 / 各标签 + 管理标签)、
// 项目(全部 / 各项目 + 管理项目)、全部 / 我负责的(负责人 = 我)/ 我参与的(参与人里有我)/ 未分配 / 按 Agent(负责 Agent,头像 + 数目),
// 最下面是「派发记录」(Hub 派给节点的任务)。按 Agent / 按节点只列有任务的,其余收进「更多节点」(可搜)——
// owner 0.2.141 截图里这一栏是 ~300 个 0。
// 左栏的每一项只是头部「负责人」筛选的快捷方式 —— 同一份状态(task-board-store),两边永远一致。
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { personKey } from './requirement-people';
import { abandonedShown, activeProjects, applyFilter, filterForScope, NO_PROJECT, projectCounts, scopeOf, splitByCount, type SidebarScope } from './task-board-model';
import { setManagingProjects, setManagingTags, setSideMenu, setTaskFilter, setTaskSection, taskBoardState, useTaskBoard } from './task-board-store';
import { commitSideRename, renameKey } from './task-side-menu';
import TaskSideItemMenu from './TaskSideItemMenu';
import { canManageTags, localTagCounts, sidebarTagNames } from './task-tag-catalog';
import { readTagsCollapsed, writeTagsCollapsed } from './task-sidebar-prefs';
import { CONTROL_H, a11yState } from './TaskBoardParts';

/** onNavigate:在「任务详情」(派发记录的一条)上点左栏时回到任务页。 */
export default function TaskFilterSidebar({ onNavigate }: { onNavigate?: () => void }) {
  useTranslation();
  const styles = makeSidebarStyles();
  const items = useTaskBoard(s => s.items);
  const people = useTaskBoard(s => s.people);
  const meId = useTaskBoard(s => s.meId);
  const filter = useTaskBoard(s => s.filter);
  const section = useTaskBoard(s => s.section);
  const twoRoles = useTaskBoard(s => s.twoRoles === true);
  const projects = useTaskBoard(s => s.projects);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreQuery, setMoreQuery] = useState('');
  const tagCatalog = useTaskBoard(s => s.tagCatalog);
  const manageTags = useTaskBoard(s => canManageTags(s.capabilities, s.tagCatalog));
  const [tagsCollapsed, setTagsCollapsed] = useState(readTagsCollapsed);
  // #760:右键项目 / 标签行 → 菜单(TaskSideItemMenu);「改名」把那一行变成输入框:回车存、Esc / 失焦取消。
  const [editing, setEditing] = useState<{ kind: 'project' | 'tag'; key: string; draft: string; error: string; busy: boolean } | null>(null);
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (Platform.OS !== 'web' || !doc?.addEventListener) return;
    // 捕获阶段拦(同会话行):WKWebView 在冒泡到 RN 之前就会弹自己的「重新载入」菜单。
    const onContext = (e: any) => {
      const v: string | null | undefined = e.target?.closest?.('[data-side-item]')?.getAttribute?.('data-side-item');
      if (!v) return;
      e.preventDefault?.();
      e.stopPropagation?.();
      setSideMenu({ kind: v[0] === 'p' ? 'project' : 'tag', key: v.slice(2), x: e.clientX ?? 0, y: e.clientY ?? 0, touch: false });
    };
    doc.addEventListener('contextmenu', onContext, true);
    return () => doc.removeEventListener('contextmenu', onContext, true);
  }, []);
  const saving = useRef(false); // 存的时候失焦不算取消
  // 不用 autoFocus:菜单(Modal)卸载时把焦点还给打开前的元素(passive effect),会先抢走焦点 = 失焦 = 取消。
  // passive effect 里再聚焦,排在 Modal 的还焦点之后。
  const renameInput = useRef<{ focus?: () => void } | null>(null);
  useEffect(() => { if (editing) renameInput.current?.focus?.(); }, [editing?.kind, editing?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveRename = async () => {
    const ops = taskBoardState().managerOps;
    if (!editing || saving.current || !ops) return;
    saving.current = true;
    setEditing({ ...editing, busy: true, error: '' });
    const failed = await commitSideRename(editing.kind, editing.key, editing.draft, ops, projects ?? []);
    saving.current = false;
    setEditing(failed ? { ...editing, busy: false, error: failed.i18n ? tr(failed.error) : failed.error } : null);
  };
  /** 改名中:标签文字换成输入框(同一行、同一字号,左缘对齐原文字)。 */
  const labelOrInput = (kind: 'project' | 'tag', key: string, label: ReactNode) => (editing?.kind === kind && editing.key === key ? (
    <TextInput ref={renameInput as never} selectTextOnFocus blurOnSubmit={false} value={editing.draft} maxLength={kind === 'tag' ? 20 : 40} editable={!editing.busy}
      onChangeText={draft => setEditing({ ...editing, draft, error: '' })}
      onSubmitEditing={() => { void saveRename(); }}
      onKeyPress={e => { if (renameKey(e.nativeEvent.key) === 'cancel') setEditing(null); }}
      onBlur={() => { if (!saving.current) setEditing(null); }}
      style={[styles.itemText, styles.rename, { color: colors.text, borderColor: editing.error ? colors.failed : colors.accent, backgroundColor: colors.inputBg }, { outlineStyle: 'none' } as object]}
      testID={`task-side-rename-${key}`} accessibilityLabel={tr('tags.rename')} />
  ) : label);
  const renameError = (kind: 'project' | 'tag', key: string) => (editing?.kind === kind && editing.key === key && editing.error
    ? <Text style={[styles.section, { color: colors.failed, paddingTop: 0 }]} accessibilityRole="alert" testID="task-side-rename-error">{editing.error}</Text> : null);
  const active = section === 'dispatch' ? null : scopeOf(filter.owners, meId, filter.participant);
  // 人 / 节点的数字按当前项目算(选了 TMAI,「我负责的」就是我在 TMAI 里的)。
  // 废弃(#724)跟着看板 / 列表:收起时不计,展开时计 —— 左栏数字和右边看到的张数一致。
  const inProject = applyFilter(items, { owners: [], priorities: [], project: filter.project, showAbandoned: abandonedShown(filter) });
  const counts = ownerCounts(inProject, people);
  const meKey = meId ? personKey({ kind: 'user', id: meId }) : '';
  const countOf = (key: string) => counts.find(c => c.key === key)?.count ?? 0;
  // 按节点:有任务的节点按数目排在前;Hub 成员表里没任务的节点跟在后面(可以先点进去再建)。
  const nodes = [
    ...counts.filter(c => c.ref?.kind === 'node'),
    ...people.filter(p => p.kind === 'node' && !counts.some(c => c.key === personKey(p))).map(p => ({ key: personKey(p), ref: { kind: p.kind, id: p.id }, name: p.name || p.id, count: 0 })),
  ];
  const others = counts.filter(c => c.ref?.kind === 'user' && c.key !== meKey);
  const split = splitByCount(nodes, moreQuery);
  // 选中的节点即使 0 个任务也留在上面(不然点了就「消失」进折叠区)
  const selectedNode = filter.owners.length === 1 && filter.owners[0].startsWith('node:') ? filter.owners[0] : '';
  const shownNodes = selectedNode && !split.shown.some(n => n.key === selectedNode) ? [...split.shown, ...nodes.filter(n => n.key === selectedNode)] : split.shown;
  const moreNodes = split.more.filter(n => n.key !== selectedNode);
  const moreTotal = nodes.filter(n => n.count === 0 && n.key !== selectedNode).length;
  const pCounts = projectCounts(items, filter);
  const pickProject = (id: string) => {
    setTaskSection(section === 'dispatch' ? 'board' : section);
    setTaskFilter({ ...filter, project: id });
    onNavigate?.();
  };
  const projectRow = (id: string, label: string, lead: ReactNode, count: number, menu = false) => {
    const on = section !== 'dispatch' && (filter.project || '') === id;
    return (
      <Fragment key={`p:${id || 'all'}`}><Pressable
        {...(menu ? { dataSet: { sideItem: `p:${id}` } } as object : {})}
        testID={`task-side-project-${id || 'all'}`}
        accessibilityRole="tab"
        accessibilityLabel={tr('tasks.copy.86', { v0: label })}
        {...a11yState({ selected: on })}
        onPress={() => pickProject(id)}
        style={state => [styles.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }, on && { backgroundColor: colors.rowActive }]}
      >
        <View style={styles.icon}>{lead}</View>
        {labelOrInput('project', id, <Text style={[styles.itemText, { color: on ? colors.text : colors.textSecondary }, on && { fontWeight: weight.strong }]} numberOfLines={1}>{label}</Text>)}
        <Text style={[styles.count, { color: colors.textMuted }]}>{count}</Text>
      </Pressable>
      {menu ? renameError('project', id) : null}</Fragment>
    );
  };
  const dot = (color: string) => <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: color }} />;
  // 标签:数字按当前列表算(同项目);筛着的标签即使这页没有卡也留在列表里(好取消)。
  const tagCounts = localTagCounts(items);
  const tagNames = sidebarTagNames(tagCounts, filter.tag);
  const tagDot = (tag: string) => {
    const c = tagCatalog?.colors[tag];
    return <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: c ?? 'transparent', borderWidth: c ? 0 : 1.5, borderColor: colors.textMuted }} />;
  };
  const tagRow = (tag: string, label: string, lead: ReactNode, count: number | null) => {
    const on = section !== 'dispatch' && (filter.tag || '') === tag;
    return (
      <Fragment key={`tag:${tag || 'all'}`}><Pressable
        {...(tag && manageTags ? { dataSet: { sideItem: `t:${tag}` } } as object : {})}
        testID={`task-filter-tag-${tag || 'all'}`}
        accessibilityRole="tab"
        accessibilityLabel={label}
        {...a11yState({ selected: on })}
        onPress={() => { setTaskSection(section === 'dispatch' ? 'board' : section); setTaskFilter({ ...filter, tag, untagged: false }); onNavigate?.(); }}
        style={state => [styles.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }, on && { backgroundColor: colors.rowActive }]}
      >
        <View style={styles.icon}>{lead}</View>
        {labelOrInput('tag', tag, <Text style={[styles.itemText, { color: on ? colors.text : colors.textSecondary }, on && { fontWeight: weight.strong }]} numberOfLines={1}>{label}</Text>)}
        {count !== null ? <Text style={[styles.count, { color: colors.textMuted }]}>{count}</Text> : null}
      </Pressable>
      {tag ? renameError('tag', tag) : null}</Fragment>
    );
  };
  const pick = (scope: SidebarScope) => {
    setTaskSection(section === 'dispatch' ? 'board' : section);
    // 只换负责人 / 参与人,优先级筛选保留(负责人那格与头部「负责人」筛选同一个动作)。
    setTaskFilter(filterForScope(filter, scope, meId));
  };
  const row = (scope: SidebarScope | 'dispatch', label: string, lead: ReactNode, count: number | null, disabled = false) => {
    const on = scope === 'dispatch' ? section === 'dispatch' : active === scope;
    return (
      <Pressable
        key={scope}
        testID={`task-side-${scope}`}
        accessibilityRole="tab"
        accessibilityLabel={label}
        {...a11yState({ selected: on, disabled })}
        disabled={disabled}
        onPress={() => { if (scope === 'dispatch') setTaskSection('dispatch'); else pick(scope); onNavigate?.(); }}
        style={state => [styles.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }, on && { backgroundColor: colors.rowActive }, disabled && { opacity: 0.5 }]}
      >
        <View style={styles.icon}>{lead}</View>
        <Text style={[styles.itemText, { color: on ? colors.text : colors.textSecondary }, on && { fontWeight: weight.strong }]} numberOfLines={1}>{label}</Text>
        {count !== null ? <Text style={[styles.count, { color: colors.textMuted }]}>{count}</Text> : null}
      </Pressable>
    );
  };
  const icon = (name: string, on = false) => <Ionicons name={name as never} size={17} color={on ? colors.accent : colors.textSecondary} />;
  return (
    <View style={[styles.root, { backgroundColor: colors.listBg }]} testID="task-sidebar">
      <View style={styles.head}><Text style={[styles.title, { color: colors.text }]} testID="task-sidebar-title">{tr('tasks.copy.190')}</Text></View>
      <ScrollView contentContainerStyle={styles.body}>
        {/* 标签组(可折叠)与项目组:同一种组头、同样的上下间距,中间一条分隔线(owner 0.2.162 截图里两组挤在一起)。 */}
        <SectionHeader
          label={tr('tags.title')}
          first
          collapsed={tagsCollapsed}
          onToggle={() => { const next = !tagsCollapsed; setTagsCollapsed(next); writeTagsCollapsed(next); }}
          testID="task-side-tags-header"
        />
        {!tagsCollapsed ? (
          <>
            {tagRow('', tr('tags.all'), icon('pricetags-outline', !filter.tag), null)}
            {tagNames.map(tag => tagRow(tag, tag, tagDot(tag), tagCounts.get(tag) ?? 0))}
            {manageTags ? (
              <Pressable accessibilityRole="button" onPress={() => setManagingTags(true)} style={state => [styles.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="task-side-manage-tags">
                <View style={styles.icon}>{icon('settings-outline')}</View>
                <Text style={[styles.itemText, { color: colors.accent }]}>{tr('tags.manage')}</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
        {projects ? (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <SectionHeader label={tr('tasks.copy.30')} testID="task-side-projects-header" />
            {projectRow('', tr('tasks.copy.191'), icon('folder-open-outline'), Array.from(pCounts.values()).reduce((a, b) => a + b, 0))}
            {activeProjects(projects).map(p => projectRow(p.id, p.name, dot(p.color), pCounts.get(p.id) ?? 0, p.canEdit !== false))}
            {(pCounts.get(NO_PROJECT) ?? 0) > 0 && activeProjects(projects).length ? projectRow(NO_PROJECT, tr('tasks.copy.31'), icon('remove-circle-outline'), pCounts.get(NO_PROJECT) ?? 0) : null}
            <Pressable accessibilityRole="button" onPress={() => setManagingProjects(true)} style={state => [styles.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="task-side-manage-projects">
              <View style={styles.icon}>{icon('settings-outline')}</View>
              <Text style={[styles.itemText, { color: colors.accent }]}>{tr('tasks.copy.64')}</Text>
            </Pressable>
          </>
        ) : null}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        {row('all', tr('tasks.copy.192'), icon('albums-outline'), inProject.length)}
        {row('mine', tr('tasks.copy.193'), icon('person-outline'), meKey ? applyFilter(inProject, { owners: [meKey], priorities: [] }).length : null, !meId)}
        {row('participating', tr('tasks.participating'), icon('people-outline'), meKey ? applyFilter(inProject, { owners: [], priorities: [], participant: meKey }).length : null, !meId)}
        {row('unassigned', tr('tasks.copy.6'), icon('help-circle-outline'), countOf('none'))}
        {/* 分两个角色的 Hub:这里按「负责 Agent」筛;旧 Hub 上节点就是唯一的负责人。 */}
        {nodes.length ? <Text style={[styles.section, { color: colors.textMuted }]}>{twoRoles ? tr('tasks.copy.194') : tr('tasks.copy.195')}</Text> : null}
        {shownNodes.map(n => row(n.key as SidebarScope, n.name, <AliasAvatar alias={n.name} size={22} />, n.count))}
        {moreTotal ? (
          <Pressable accessibilityRole="button" {...a11yState({ expanded: moreOpen })} onPress={() => setMoreOpen(o => !o)} style={state => [styles.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="task-side-more-nodes">
            <View style={styles.icon}>{icon(moreOpen ? 'chevron-down' : 'chevron-forward')}</View>
            <Text style={[styles.itemText, { color: colors.textSecondary }]}>{twoRoles ? tr('tasks.copy.196') : tr('tasks.copy.197')}</Text>
            <Text style={[styles.count, { color: colors.textMuted }]}>{moreTotal}</Text>
          </Pressable>
        ) : null}
        {moreOpen && moreTotal ? (
          <>
            <TextInput value={moreQuery} onChangeText={setMoreQuery} placeholder={tr('tasks.copy.198')} placeholderTextColor={colors.textMuted} style={[styles.search, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]} testID="task-side-more-search" accessibilityLabel={tr('tasks.copy.198')} />
            {moreNodes.slice(0, 50).map(n => row(n.key as SidebarScope, n.name, <AliasAvatar alias={n.name} size={22} />, n.count))}
            {moreNodes.length > 50 ? <Text style={[styles.section, { color: colors.textMuted, paddingTop: spacing.xs }]}>{tr('tasks.copy.199')}{moreNodes.length - 50} {tr('tasks.copy.200')}</Text> : null}
            {!moreNodes.length ? <Text style={[styles.section, { color: colors.textMuted, paddingTop: spacing.xs }]}>{tr('tasks.copy.201')}</Text> : null}
          </>
        ) : null}
        {others.length ? <Text style={[styles.section, { color: colors.textMuted }]}>{twoRoles ? tr('tasks.copy.202') : tr('tasks.copy.203')}</Text> : null}
        {others.map(n => row(n.key as SidebarScope, n.name, <AliasAvatar alias={n.name} size={22} />, n.count))}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        {row('dispatch', tr('tasks.copy.28'), icon('paper-plane-outline'), null)}
      </ScrollView>
      <TaskSideItemMenu onInlineRename={(kind, key) => setEditing({ kind, key, draft: kind === 'project' ? projects?.find(p => p.id === key)?.name ?? '' : key, error: '', busy: false })} />
    </View>
  );
}

/** 左栏的组头:标签 / 项目 / 按 Agent 用同一种样式与间距;collapsed 给了就是可折叠的(带箭头)。 */
function SectionHeader({ label, first, collapsed, onToggle, testID }: { label: string; first?: boolean; collapsed?: boolean; onToggle?: () => void; testID: string }) {
  const styles = makeSidebarStyles();
  const text = <Text style={[styles.sectionText, { color: colors.textMuted }]} numberOfLines={1}>{label}</Text>;
  const box = [styles.sectionHead, first && { paddingTop: spacing.xs }];
  if (!onToggle) return <View style={box} testID={testID}>{text}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? tr('tags.expand') : tr('tags.collapse')} {...a11yState({ expanded: !collapsed })} onPress={onToggle}
      style={state => [box, ((state as { hovered?: boolean }).hovered || state.pressed) && { opacity: 0.8 }]} testID={testID}>
      {text}
      <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={13} color={colors.textMuted} />
    </Pressable>
  );
}

const makeSidebarStyles = () => StyleSheet.create({
  root: { flex: 1 },
  // 与右侧任务页头部同高(控件 32 + 上下 12):两边标题落在同一条中线上。
  head: { height: CONTROL_H + 24, justifyContent: 'center', paddingHorizontal: spacing.lg },
  title: { fontSize: typeScale.title, fontWeight: weight.strong },
  body: { paddingHorizontal: spacing.sm, paddingBottom: spacing.lg, gap: 2 },
  item: { height: 38, borderRadius: radius.item, paddingHorizontal: spacing.sm + 2, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  icon: { width: 22, alignItems: 'center' },
  itemText: { flex: 1, fontSize: 13 },
  // 改名框:去掉内边距 / 行高差,文字左缘、基线与原来的标签文字重合(drive 量 ±1)。
  rename: { minWidth: 0, height: 26, paddingHorizontal: 0, paddingVertical: 0, borderWidth: 0, borderBottomWidth: 1 },
  count: { fontSize: typeScale.caption },
  section: { fontSize: typeScale.caption, paddingHorizontal: spacing.sm + 2, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  // 组头:标签 / 项目同一个高度与内边距;第一组上边距更小(紧贴「视图」标题下)。
  sectionHead: { minHeight: 28, paddingTop: spacing.md, paddingBottom: spacing.xs, paddingHorizontal: spacing.sm + 2, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sectionText: { flexShrink: 1, fontSize: typeScale.caption, fontWeight: weight.medium },
  search: { height: 32, marginHorizontal: spacing.xs, marginVertical: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderRadius: radius.control, fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md, marginHorizontal: spacing.sm },
});
