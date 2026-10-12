import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isClosedColumn, statusCapsuleText } from './requirement-columns';
import { TaskTagChips } from './TaskTags';
import TaskListRowHover from './TaskListRowHover';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, spacing } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
import './i18n-task-fields';
import { TaskIssueCount } from './TaskIssueBindings';
import { issueCount } from './requirement-issues';
import { personDisplay } from './i18n-task-presentation';
import { cardActivity, previewText } from './task-card-activity';
import { REQ_COLUMN_LABEL, hasVisibleTitle, titleText, type Requirement, type RequirementProject } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import { nextSort, type SortKey, type SortSpec } from './task-board-model';
import { ChecklistCompact, DueChip, OwnerBadge, ParticipantStack, PriorityBadge, ProjectChip, STATUS_TONE, a11yState, type TaskStyles } from './TaskBoardParts';
import TaskListFields from './TaskListFields';
import TaskTimeCell from './TaskTimeCell';
import { fieldWidth, fittedWidths, loadFields, resetFieldWidth, saveFields, setFieldWidth, type FieldId, type FieldPref } from './task-list-fields';
import { ParentLine, ProjectSelect } from './TaskFieldPickers';
import { shortIdLabel } from './task-short-id';
import { ArchivedTag, ReadOnlyTag, highlight } from './TaskSearch';
import { CellEditor, type CellEditorContext, type CellEditorField } from './TaskListCellEditor';
import { cellEditable, cellKey, type CellEdit, type CellPos } from './task-list-edit-model';
import type { SelectAnchor } from './task-select-model';

const CHECK_W = 20;
const HANDLE = 8, KEY_STEP = 16;
type PointerLike = { nativeEvent: { clientX: number; pointerId: number }; currentTarget: unknown };
type CellEditorState = { pos: CellPos; anchor: SelectAnchor | null };
const TOAST_MS = 5000;
export default function TaskListTable({ rows, pageKey, terms, people, projects, sort, setSort, s, today, selectedId, onOpen, filtered, needsUpdateUpgrade, touch, onMenu, items, selection, onProject, seqCapable = false, edit }: {
  rows: Requirement[]; people: RequirementPerson[];
  pageKey?: string;
  /** 搜索词(task-search.ts searchTerms):标题里命中的字高亮。 */
  terms?: readonly string[]; projects: RequirementProject[] | null;
  sort: SortSpec; setSort: (next: SortSpec) => void; s: TaskStyles; today: string;
  selectedId: string | null; onOpen: (id: string) => void; filtered: boolean; needsUpdateUpgrade: boolean;
  touch: boolean; onMenu: (item: Requirement, x: number, y: number) => void;
  /** 全部任务(标题下的「↳ 母任务」找母任务用)。 */
  items?: readonly Requirement[];
  /** 桌面多选:行首悬停勾选框 + Ctrl/⌘ / Shift 单击(RequirementBoard 管状态,task-select-model.ts)。 */
  selection?: { ids: readonly string[]; onToggle: (id: string) => void; onPress: (id: string, e: unknown) => void };
  /** 项目格就地改(owner 09-29:13 个没项目的任务一张张开详情太慢)。 */
  onProject?: (id: string, projectId: string | null) => void;
  /** Hub 有任务短号(capabilities.requirement_seq):才有「ID」列。旧 Hub 上这一列不出现,字段配置里也没有。 */
  seqCapable?: boolean;
  /**
   * 多维表格式就地编辑(owner 10-01):单击选中格(蓝框),再单击 / 双击 / 回车打开编辑器,方向键换格,Esc 取消;
   * 改一格存一格(onEdit 只带那一个字段,乐观更新,失败退回并返回原因)。只在鼠标 + 宽屏表格上(touch=false);
   * 手机 / 平板手指照旧点行进详情。不给 = 与原来一样。
   */
  edit?: { onEdit: (id: string, edit: CellEdit) => Promise<string | null>; ctx: CellEditorContext; onLoadPeople: () => void };
}) {
  useTranslation();
  const live = !!edit && !touch;
  const [cell, setCell] = useState<CellPos | null>(null);
  const [editor, setEditor] = useState<CellEditorState | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const titleDone = useRef(false);
  const [toast, setToast] = useState<{ text: string; anchor: SelectAnchor | null } | null>(null);
  const cellRefs = useRef(new Map<string, any>());
  const bodyScroll = useRef<ScrollView>(null);
  useEffect(() => { bodyScroll.current?.scrollTo({ y: 0, animated: false }); }, [pageKey]);
  const posKey = (p: CellPos) => `${p.row}|${p.field}`;
  const at = (p: CellPos | null, id: string, field: FieldId) => !!p && p.row === id && p.field === field;
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), TOAST_MS); return () => clearTimeout(timer); }, [toast]);
  const [fields, setFields] = useState(loadFields);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const [hover, setHover] = useState<FieldId | null>(null);
  const [resizing, setResizing] = useState<FieldId | null>(null);
  const latest = useRef(fields); latest.current = fields;
  const drag = useRef<{ id: FieldId; x: number; start: number; moved: boolean } | null>(null);
  const commit = (next: FieldPref[]) => { saveFields(next); setFields(next); };
  const visible = fields.filter(f => f.visible && (projects || f.id !== 'project') && (seqCapable || f.id !== 'seq'));
  // ── 就地编辑:选中格、打开编辑器、存 ──
  const canEdit = (item: Requirement, field: FieldId) => live && cellEditable(item, field, { projects: !!projects });
  const rowIds = rows.map(r => r.id), fieldIds = visible.map(f => f.id);
  // 选中的那一行被筛掉 / 那一列被隐藏了:取消选中。
  useEffect(() => { if (cell && (!rowIds.includes(cell.row) || !fieldIds.includes(cell.field))) { setCell(null); setEditor(null); } });
  const save = (item: Requirement, change: CellEdit) => {
    void edit?.onEdit(item.id, change).then(failed => {
      if (!failed) return;
      const el = cellRefs.current.get(posKey({ row: item.id, field: change.field === 'agent' ? 'owner' : change.field as FieldId }));
      const show = (anchor: SelectAnchor | null) => setToast({ text: t('listEdit.failed', { name: item.name, reason: failed }), anchor });
      if (el?.measureInWindow) el.measureInWindow((x: number, y: number, w: number, h: number) => show({ x, y, w, h })); else show(null);
    });
  };
  const openEditor = (pos: CellPos) => {
    const item = rows.find(r => r.id === pos.row);
    if (!item) return;
    setCell(pos);
    // 不能就地改的格(ID / 时间 / 只读的卡):回车 = 展开详情(多维表格的「展开」)。
    if (!canEdit(item, pos.field)) { onOpen(item.id); return; }
    if (editor && at(editor.pos, pos.row, pos.field)) return;
    setToast(null);
    if (pos.field === 'title') { titleDone.current = false; setTitleDraft(item.name); setEditor({ pos, anchor: null }); return; }
    if ((pos.field === 'owner' || pos.field === 'participants') && !people.length) edit?.onLoadPeople();
    const el = cellRefs.current.get(posKey(pos));
    if (el?.measureInWindow) el.measureInWindow((x: number, y: number, w: number, h: number) => setEditor({ pos, anchor: { x, y, w, h } }));
  };
  const finishTitle = (item: Requirement, keep: boolean) => {
    if (titleDone.current) return;
    titleDone.current = true;
    if (keep) save(item, { field: 'title', name: titleDraft });
    setEditor(null);
  };
  const pressCell = (item: Requirement, field: FieldId, e: { nativeEvent?: any }) => {
    const n = e?.nativeEvent ?? {};
    // Ctrl/⌘ / Shift 单击 = 多选行(同原来),不选格。
    if (n.ctrlKey || n.metaKey || n.shiftKey) { if (selection) selection.onPress(item.id, e); else onOpen(item.id); return; }
    if (at(cell, item.id, field)) openEditor({ row: item.id, field });
    else { setCell({ row: item.id, field }); setEditor(null); }
  };
  // 键盘(选中了一格、没在编辑、详情没开):方向键 / Tab 换格,回车 / F2 编辑,Esc 取消选中。
  // 输入框里的键不管;Shift+←→ 留给看板的「换状态」(task-board-dom)。
  const keyState = useRef({ cell, rowIds, fieldIds, openEditor });
  keyState.current = { cell, rowIds, fieldIds, openEditor };
  useEffect(() => {
    const doc = (globalThis as { document?: any }).document;
    if (!live || !cell || editor || selectedId || !doc?.addEventListener) return;
    const onKey = (e: any) => {
      const k = keyState.current;
      if (!k.cell || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || (e.shiftKey && e.key !== 'Tab')) return;
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      const r = cellKey(k.cell, e.key, e.shiftKey, k.rowIds, k.fieldIds);
      if (!r) return;
      e.preventDefault();
      if ('move' in r) { setCell(r.move); cellRefs.current.get(posKey(r.move))?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
      else if ('open' in r) k.openEditor(k.cell);
      else setCell(null);
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [live, cell, editor, selectedId]);
  const editorItem = editor && editor.anchor ? rows.find(r => r.id === editor.pos.row) : undefined;
  // Title fills spare card width until the user drags it; after that every column is
  // exactly its stored width and the table scrolls sideways inside its card (Feishu/Notion).
  // 表格给列用的宽(去掉左右留白、列间隙、勾选格):放不下时没拖过的列先往紧凑宽收(task-list-fields fittedWidths),
  // 平板横屏 ~1000 宽时「状态」不再被挤出右边。
  const [tableW, setTableW] = useState(0);
  const available = tableW - spacing.lg * 2 - spacing.md * (visible.length - 1) - (selection ? CHECK_W + spacing.md : 0);
  const widths = fittedWidths(visible, available);
  const colW = (f: FieldPref) => widths[f.id] ?? fieldWidth(f);
  const cellStyle = (f: FieldPref) => ({ width: colW(f), minWidth: colW(f), flexShrink: 0, ...(f.id === 'title' && f.width === undefined ? { flexGrow: 1 } : {}) });
  const cursor = (value: string) => { const body = globalThis.document?.body; if (body) { body.style.cursor = value; body.style.userSelect = value ? 'none' : ''; } };
  // Resize from the rendered width: a stretched title is wider than its stored width.
  const rendered = (handleEl: unknown, id: FieldId) => (handleEl as HTMLElement).parentElement?.getBoundingClientRect().width ?? colW(latest.current.find(f => f.id === id)!);
  const handle = (id: FieldId) => ({
    onPointerDown: (e: PointerLike) => {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.nativeEvent.pointerId);
      drag.current = { id, x: e.nativeEvent.clientX, start: rendered(e.currentTarget, id), moved: false };
      setResizing(id); cursor('col-resize');
    },
    onPointerMove: (e: PointerLike) => {
      const d = drag.current; if (!d) return;
      const dx = e.nativeEvent.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 1) return;
      d.moved = true; setFields(setFieldWidth(latest.current, id, d.start + dx));
    },
    onPointerUp: () => { const d = drag.current; drag.current = null; setResizing(null); cursor(''); if (d?.moved) commit(latest.current); },
    onPointerCancel: () => { drag.current = null; setResizing(null); cursor(''); },
    onPointerEnter: () => setHover(id),
    onPointerLeave: () => setHover(h => h === id ? null : h),
    // RN Web View forwards onClick but not onDoubleClick; detail===2 is the second click.
    onClick: (e: { detail?: number; nativeEvent?: { detail?: number } }) => { if ((e.detail ?? e.nativeEvent?.detail) === 2) commit(resetFieldWidth(latest.current, id)); },
    onKeyDown: (e: { nativeEvent: { key: string }; preventDefault: () => void; currentTarget: unknown }) => {
      const step = e.nativeEvent.key === 'ArrowRight' ? KEY_STEP : e.nativeEvent.key === 'ArrowLeft' ? -KEY_STEP : 0;
      if (!step) return;
      e.preventDefault();
      commit(setFieldWidth(latest.current, id, rendered(e.currentTarget, id) + step));
    },
  });
  const tagsColumn = visible.some(f => f.id === 'tags');
  // 标题格在编辑:就地一个输入框(回车 / 点别处 = 存,Esc = 不存)。
  const titleInput = (item: Requirement): ReactNode => !(editor && at(editor.pos, item.id, 'title')) ? null : <View style={{ flex: 1, minWidth: 0 }} {...({ dataSet: { noDrag: '1' } } as object)}>
    <TextInput autoFocus selectTextOnFocus value={titleDraft} onChangeText={setTitleDraft}
      onSubmitEditing={() => finishTitle(item, true)} onBlur={() => finishTitle(item, true)}
      onKeyPress={(e: { nativeEvent: { key: string }; preventDefault?: () => void }) => { if (e.nativeEvent.key === 'Escape') { e.preventDefault?.(); finishTitle(item, false); } }}
      accessibilityLabel={t('listEdit.title')} testID="list-edit-title-input"
      style={[s.tdTitle, { height: 30, paddingHorizontal: 6, borderRadius: radius.item, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.inputBg }, { outlineStyle: 'none' } as object]} />
  </View>;
  const content = (item: Requirement, id: FieldId, rowHovered = false): ReactNode => {
    switch (id) {
      case 'created': case 'updated': {
        // 「更新时间」列把更新者直接写在时间后面(#506),不用悬停。Hub 给 last_event(含评论)时写最新那条动态:
        // 时间取它的(评论比 updated_at 新;排序用同一个时刻,见 task-board-model activityTime),后面跟「谁干了什么」+ 评论预览。
        const ev = id === 'updated' ? cardActivity(item, people, now) : null;
        if (ev?.source === 'event') {
          return <TaskTimeCell id={`task-time-${item.id}-${id}`} raw={new Date(ev.at).toISOString()} now={now} by={ev.actor?.name} byInline={{ name: ev.actor?.name ?? null, agent: !!ev.actor?.agent, verb: ev.verbText, preview: ev.preview ? previewText(ev.preview) : null }} />;
        }
        const by = id === 'updated' && item.updatedBy ? personDisplay(item.updatedBy, people).name : undefined;
        return <TaskTimeCell id={`task-time-${item.id}-${id}`} raw={id === 'created' ? item.createdAt : item.updatedAt} now={now} by={by} byInline={by && item.updatedBy ? { name: by, agent: item.updatedBy.kind === 'node' } : undefined} />;
      }
      // 标题格:内容自己的高、在行里垂直居中(标题文字不用 flex:1 —— 在竖排的格里它是「占满剩余高度」,
      // 会把标题顶到行的最上沿);没有标签就不放标签那一层(空的也会多一个 gap)。标题看不见字时显示「(无标题)」+ 短 id。
      // 是 flex:-1 不是 flex:0:react-native-web 把 flex:0 原样写成 CSS `flex: 0` = `0 1 0%`,基准宽 0 + overflow:hidden
      // → 字宽 0,整列标题空白(0.2.159–0.2.162 桌面端)。-1 在 web 上是 `0 1 auto`,原生上是「按内容宽、放不下再缩」。
      case 'title': return titleInput(item) ?? <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center' }}><View style={{ flex: 1, minWidth: 0, gap: 4, alignSelf: 'center' }} testID={`task-title-${item.id}`}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}><Text style={[s.tdTitle, { flex: -1 }, isClosedColumn(item.column) && s.cardDone, !hasVisibleTitle(item.name) && { color: colors.textMuted }]} numberOfLines={1}>{highlight(titleText(item), terms)}</Text>{item.archived ? <ArchivedTag /> : null}{item.readOnly ? <ReadOnlyTag testID={`task-read-only-${item.id}`} editFields={item.editFields} /> : null}<ChecklistCompact item={item} s={s} testID={`task-row-checklist-${item.id}`} /></View>{items ? <ParentLine item={item} items={items} /> : null}{item.tags?.length && !tagsColumn ? <TaskTagChips tags={item.tags} /> : null}</View>{live && rowHovered ? <Pressable testID={`req-row-open-${item.id}`} accessibilityRole="button" accessibilityLabel={t('listEdit.open', { name: item.name })} onPress={() => onOpen(item.id)} hitSlop={4} style={state => [{ width: 24, height: 24, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowActive }]}><Ionicons name="expand-outline" size={14} color={colors.textMuted} /></Pressable> : null}</View>;
      case 'owner': return <OwnerBadge item={item} people={people} s={s} />;
      case 'priority': return <View style={s.owner}><PriorityBadge p={item.priority} s={s} /></View>;
      case 'due': return item.due ? <DueChip item={item} today={today} s={s} /> : <Text style={s.metaMuted}>—</Text>;
      case 'participants': return <ParticipantStack item={item} people={people} s={s} touch={touch} size={18} />;
      case 'project':
        if (!live && onProject && projects && item.projectId !== undefined) return <ProjectSelect compact label={false} value={item.projectId ?? null} projects={projects} onChange={pid => onProject(item.id, pid)} touch={touch} idBase={`req-row-project-${item.id}`} />;
        return item.projectId ? <ProjectChip project={projects?.find(p => p.id === item.projectId)} s={s} small /> : <Text style={s.metaMuted}>—</Text>;
      case 'issues': return issueCount(item) ? <TaskIssueCount item={item} /> : <Text style={s.metaMuted}>—</Text>;
      case 'tags': return item.tags?.length ? <TaskTagChips tags={item.tags} /> : <Text style={s.metaMuted}>—</Text>;
      case 'seq': return <Text testID={`task-seq-${item.id}`} style={[s.metaMuted, { fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{shortIdLabel(item) ?? '—'}</Text>;
      case 'status': return <View style={[s.statusPill, { backgroundColor: STATUS_TONE[item.column]() + '1f' }]} testID={`task-status-${item.id}`}><View style={[s.prioDot, { width: 6, height: 6, backgroundColor: STATUS_TONE[item.column]() }]} /><Text style={[s.statusPillText, statusCapsuleText(item.column, STATUS_TONE[item.column]())]}>{taskText(REQ_COLUMN_LABEL[item.column])}</Text></View>;
    }
  };
  return <View style={{ flex: 1 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.xl, paddingBottom: 10 }}><TaskListFields fields={fields} touch={touch} projects={projects !== null} seqCapable={seqCapable} needsUpdateUpgrade={needsUpdateUpgrade} onChange={commit} /></View>
    <View style={s.table} testID="req-list" onLayout={e => setTableW(e.nativeEvent.layout.width)}>
      <ScrollView horizontal contentContainerStyle={{ minWidth: '100%', flexGrow: 1 }}>
        <View style={{ flex: 1, minWidth: visible.reduce((n, f) => n + colW(f), 0) + spacing.md * (visible.length - 1) + spacing.lg * 2 + (selection ? CHECK_W + spacing.md : 0) }}>
          <View style={s.tableHead}>
            {selection ? <View style={{ width: CHECK_W }} /> : null}
            {visible.map(f => {
              const { id } = f;
              const sortable = id !== 'participants' && id !== 'issues' && id !== 'tags';
              const on = sort.key === id;
              const line = resizing === id ? colors.accent : hover === id ? colors.border : 'transparent';
              return <View key={id} testID={`task-column-${id}`} style={cellStyle(f)}>
                <View style={{ overflow: 'hidden' }}>{sortable ? <Pressable testID={`req-sort-${id}`} accessibilityRole="button" accessibilityLabel={t('tasks.copy.50', { v0: t(`fields.${id}`) })} {...a11yState({ selected: on })} style={s.th} onPress={() => setSort(nextSort(sort, id as SortKey))}><Text style={[s.thText, on && s.thTextOn]} numberOfLines={1}>{t(`fields.${id}`)}</Text>{on ? <Ionicons name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={11} color={colors.text} /> : null}</Pressable> : <Text style={s.thText} numberOfLines={1}>{t(`fields.${id}`)}</Text>}</View>
                {!touch ? <View testID={`task-col-resize-${id}`} focusable accessibilityRole="adjustable" accessibilityLabel={t('fields.resize', { name: t(`fields.${id}`) })} {...(handle(id) as object)} style={[{ position: 'absolute', top: 0, bottom: 0, right: -(spacing.md + HANDLE) / 2, width: HANDLE, zIndex: 2, alignItems: 'center' }, { cursor: 'col-resize', touchAction: 'none', userSelect: 'none' } as object]}><View style={{ width: 2, height: '100%', backgroundColor: line }} /></View> : null}
              </View>;
            })}
          </View>
          <ScrollView ref={bodyScroll} style={{ flex: 1 }}>
            {!rows.length ? <View style={[s.center, { paddingVertical: spacing.xl * 2 }]}><Text style={s.muted}>{t(filtered ? 'tasks.copy.46' : 'tasks.copy.55')}</Text></View> : null}
            {rows.map(item => {
              const picked = !!selection?.ids.includes(item.id);
              return <TaskListRowHover key={item.id} enabled={live} resetKey={pageKey}>{(rowHovered, rowHoverRef) => <Pressable ref={rowHoverRef as never} testID={`req-row-${item.id}`} accessibilityRole="button" accessibilityLabel={item.name} {...a11yState({ selected: picked })} onPress={e => (selection ? selection.onPress(item.id, e) : onOpen(item.id))} onLongPress={touch ? e => onMenu(item, e.nativeEvent.pageX, e.nativeEvent.pageY) : undefined} style={state => [s.tr, ((state as { hovered?: boolean }).hovered || rowHovered || state.pressed || item.id === selectedId) && s.trHover, picked && { backgroundColor: colors.accent + '14' }]} {...({ dataSet: { taskCard: item.id, taskFrom: item.column } } as object)}>
                {(state: any) => <>
                  {selection ? (
                    // 行首勾选框:悬停 / 已选 / 正在多选时出现;一直留出这一格宽,标题不跳。
                    <View style={{ width: CHECK_W, alignItems: 'center' }}>
                      {state.hovered || picked || selection.ids.length ? (
                        <Pressable accessibilityRole="checkbox" accessibilityLabel={t('taskSel.selectRow', { name: item.name })} {...a11yState({ checked: picked })} onPress={() => selection.onToggle(item.id)} hitSlop={6} testID={`req-row-check-${item.id}`}>
                          <Ionicons name={picked ? 'checkbox' : 'square-outline'} size={16} color={picked ? colors.accent : colors.textMuted} />
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {visible.map(f => {
                    const key = posKey({ row: item.id, field: f.id });
                    const ref = (el: unknown) => { if (el) cellRefs.current.set(key, el); else cellRefs.current.delete(key); };
                    const box = [cellStyle(f), { flexDirection: 'row' as const, alignItems: 'center' as const, overflow: 'hidden' as const }, live && { alignSelf: 'stretch' as const, paddingHorizontal: 4 }];
                    const picked = at(cell, item.id, f.id);
                    // 选中 = 强调色实线框;能改的格悬停 = 浅框(只读的格没有悬停样子,点它照旧进详情)。
                    // 格子撑满行高(框才有行那么高);内容另包一层竖直居中(胶囊类自带 alignSelf:flex-start,不包会贴到格子顶上)。
                    const body = live ? <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', alignSelf: 'center' }}>{content(item, f.id, rowHovered)}</View> : content(item, f.id, rowHovered);
                    const frame = (hovered: boolean) => picked || hovered ? <View pointerEvents="none" testID={picked ? 'task-cell-selected' : undefined} style={{ position: 'absolute', left: 0, right: 0, top: 4, bottom: 4, borderRadius: radius.item, borderWidth: picked ? 2 : 1, borderColor: picked ? colors.accent : colors.border }} /> : null;
                    if (!canEdit(item, f.id)) return <View key={f.id} ref={ref as never} testID={`task-cell-${item.id}-${f.id}`} style={box}>{body}{live ? frame(false) : null}</View>;
                    return <Pressable key={f.id} ref={ref as never} testID={`task-cell-${item.id}-${f.id}`} accessibilityRole="button" accessibilityLabel={t('listEdit.cell', { field: t(`fields.${f.id}`) })} {...a11yState({ selected: picked })} onPress={e => pressCell(item, f.id, e as { nativeEvent?: any })} style={box} {...({ dataSet: { listCell: f.id, editable: '1' } } as object)}>
                      {(cs: any) => <>{body}{frame(!!cs.hovered)}</>}
                    </Pressable>;
                  })}
                </>}
              </Pressable>}</TaskListRowHover>;
            })}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
    {edit && editor && editorItem && editor.anchor && editor.pos.field !== 'title' ? <CellEditor key={posKey(editor.pos)} item={editorItem} field={editor.pos.field as CellEditorField} anchor={editor.anchor} ctx={{ ...edit.ctx, people }}
      onEdit={change => save(editorItem, change)} onClose={() => setEditor(null)} /> : null}
    {toast ? <View testID="list-edit-error" accessibilityRole="alert" style={[{ position: 'absolute', left: spacing.xl, bottom: spacing.xl + 8, maxWidth: 420, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingLeft: 12, paddingRight: 6, borderRadius: radius.control, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.failed, zIndex: 20 }, toast.anchor && ({ position: 'fixed', left: Math.max(8, toast.anchor.x), top: toast.anchor.y + toast.anchor.h + 4, bottom: undefined } as object)]}>
      <Ionicons name="alert-circle" size={14} color={colors.failed} />
      <Text style={{ color: colors.text, fontSize: 12, flexShrink: 1 }} numberOfLines={2}>{toast.text}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('listEdit.dismiss')} onPress={() => setToast(null)} hitSlop={6} style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={12} color={colors.textMuted} /></Pressable>
    </View> : null}
  </View>;
}
