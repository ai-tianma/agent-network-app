import { ownerCounts, ownerLabel } from './i18n-task-presentation';
import { t as tr } from './i18n';
import TaskListTable from './TaskListTable';
import TaskListPager from './TaskListPager';
import { taskListPage } from './task-list-pagination';
import TaskGantt from './TaskGantt';
import TaskCalendar from './TaskCalendar';
import TaskDashboard from './TaskDashboard';
import TaskActivity from './TaskActivity';
import { TaskTagFilter } from './TaskTags';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 任务页(需求池):头部一行 + 看板 / 列表 + 新建对话框 + 详情(桌面右侧抽屉,手机推入一页)。
//
// Owner 2026-09-29(0.2.137 截图):「这个任务列表也他妈太难看了…你自己搞搞吧」—— 三个常驻的整行输入框、
// 一行开发者说明、三列白框挤在左边右边一大片空、卡片上一个「查看详情」蓝字链接。现在参照 Linear / TickTick:
//   · 头部:任务 · 列表/看板 · 负责人 / 优先级筛选 · ＋ 新建(新建是对话框 / 手机底部面板,不再常驻)
//   · 看板:三列等分整个内容宽,列头名字 + 数目胶囊,列尾「＋ 添加」直接建在这一列
//   · 卡片:标题(最多两行)+ 优先级点 · 负责人头像 · 期限胶囊(逾期红),整张可点
//   · 换状态:桌面拖动(落点指示线)/ 右键菜单 / Shift+←→;手机长按菜单或详情里的状态,没有拖动
// 数据仍是 Hub 的 requirements(GET / POST / PATCH),负责人只存稳定身份 {kind,id}(#484),assignee 永远空。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import type { HubConfig } from './api';
import { REQ_COLUMN_LABEL, REQ_COLUMNS, REQ_PRIORITIES, titleText, type ChecklistItem, type ReqColumn, type Requirement, type RequirementProject } from './requirements-model';
import { readRequirements, requirementsKey, writeRequirements } from './requirements-store';
import { createProject, createRequirementOnHub, fetchMyUserId, getRequirementOnHub, listArchivedRequirements, listProjects, listRequirementChanges, listRequirementsFull, searchRequirementsOnHub, setChecklistItemOnHub, updateProject, migrateLocalRequirements, moveRequirementOnHub, probeAgentOwnerSupport, RequirementsHubError, setRequirementArchivedOnHub, updateRequirementOnHub } from './requirements-hub';
import { listRequirementPeople, saveRequirementAssignments } from './requirement-people-api';
import { applyCellEdit, cellRequest, rollbackCellEdit, type CellEdit } from './task-list-edit-model';
import { personKey, type RequirementPerson, type RequirementPersonRef } from './requirement-people';
import RequirementPeoplePicker, { measureAnchor } from './RequirementPeoplePicker';
import { assignAccess, bulkOwnerPlan, canAssignPeople, openedParticipants, ownerChange, participantsChange, revertAssign, type AssignChange } from './task-assign';
import { colors, radius, spacing } from './theme';
import { elevated } from './elevation';
import { pointerUi } from './pointer-ui';
import { useModalSafePadding } from './safe-area-runtime';
import { usePoll } from './usePoll';
import { statusChoices, supportsAbandoned, isClosedColumn, statusCapsuleText } from './requirement-columns';
import { abandonedShown, hiddenAbandonedCount, applyFilter, EMPTY_FILTER, applyMove, boardColumns, createInput, DEFAULT_SORT, DRAG_IDLE, dragReduce, dropIndex, emptyDraft, activeProjects, defaultProjectFor, NO_PROJECT, projectCounts, filterActive, hasRoles, ownerFilterSections, roleKinds, localToday, addChecklistItem, moveChecklistItem, removeChecklistItem, setChecklistDone, neighbourColumn, nextSort, revertMove, sortRows, toggleIn, hidesDone, toggleHideDone, UNASSIGNED, quickFilterOn, toggleQuickFilter, type QuickFilter, type CreateDraft, type DragEvent, type DragState, type EditPatch, type SortKey, type SortSpec } from './task-board-model';
import { applyChanges, checklistCounts, cursorAfterList, hasFullText, mergeListRows, needsFullText, planBoardRead, type BoardSyncState } from './board-sync';
import { enterTaskScope, noteTagsUsed, patchTaskBoard, setManagingProjects, setManagingTags, setSideMenu, type ManagerOps, setTaskFilter, setTaskSearch, setTaskSection, taskBoardState, taskScopeKey, updateTaskItems, useTaskBoard, type TaskSection } from './task-board-store';
import { recallBoard, rememberBoard } from './swr-cache';
import { PRIORITY_CODE, priorityChoices, priorityLabel, supportsLowest } from './task-priority';
import { BOARD_RADIUS, CONTROL_H, cardBg, CardActivityLine, CardMeta, ChecklistCompact, ChecklistProgress, Chip, QuickChip, ParticipantStack, ProjectChip, DueChip, OwnerBadge, PriorityDot, Segmented, STATUS_TONE, useTaskStyles, type TaskStyles, a11yState } from './TaskBoardParts';
import TaskCreateDialog from './TaskCreateDialog';
import TaskDetailPanel from './TaskDetailPanel';
import TaskDrawer, { useDrawerWidth } from './TaskDrawer';
import { detailMode } from './task-drawer-model';
import TaskCardMenu, { type TaskMenuTarget } from './TaskCardMenu';
import TaskSwipeRow from './TaskSwipeRow';
import { quickMenuAccess, swipeActions, UNDO_MS, type QuickUndo, type SwipeAction } from './task-quick-status';
import TaskProjectManager from './TaskProjectManager';
import TaskTagManager from './TaskTagManager';
import { applyTagOp, applyTagOpToCatalog, canManageTags, fetchTagCatalog, TagOpError, runTagOp, type TagOp } from './task-tag-catalog';
import TaskSideItemMenu from './TaskSideItemMenu';
import { canEditProject } from './task-side-menu';
import { setDraggingCursor, useTaskCardDom } from './task-board-dom';
import { boardLayout, pageAt } from './task-board-layout';
import { ParentLine, ProjectSelect, projectOptions } from './TaskFieldPickers';
import { SelectMenu } from './TaskSelectMenu';
import { changeConcernsMe, parseTaskChanged } from './task-window-model';
import { currentWindowLabel, emitTaskChanged, listenTaskChanged, openTaskWindow } from './task-window';
import { menuMaxHeight } from './modal-bounds';
import { EMPTY_SEARCH, filterHiddenCount, focusKindOf, isSearchShortcut, needsServerSearch, SEARCH_DEBOUNCE_MS, searchedTasks, searchTerms } from './task-search';
import { ArchivedTag, ReadOnlyTag, highlight, SearchCancel, SearchEmpty, SearchField, SearchIconButton, SearchStatusBar } from './TaskSearch';
import { comboFromEvent, shortcutForCombo } from './shortcuts-model';
import { isMacKeyboard, shortcutBindings, shortcutCaptureActive } from './shortcuts-store';
import { anchorRightAligned, isSelectClick, NO_SELECTION, pruneSelection, runBulk, selectClick, toggleSelected, type BulkProgress, type SelectAnchor, type Selection } from './task-select-model';
import { SEQ_CAPABILITY } from './task-short-id';
import { canEditTaskField, readOnlyLabelKey, type TaskEditField } from './task-access';
import { subscribeOpenTaskRequest, takeOpenTaskRequest } from './task-open-request';

const UNSUPPORTED = 'tasks.copy.14';
/** 桌面多选的批量操作(底部操作条上的按钮)。 */
type BulkKind = 'project' | 'status' | 'agent' | 'owner';
/** 别的设备改了也要看得到;有未完成的写入时跳过这一轮(不拿旧数据盖掉乐观更新)。 */
const POLL_MS = 15_000;
// 内容区窄于 NARROW(task-board-layout)时:看板改成横向一列一屏,详情改成推入页。

/** 筛选键(user:… / node:…)对应的名字:没有卡片的人不在 ownerCounts 里,从成员表取。 */
const keyName = (key: string, people: readonly { kind: string; id: string; name: string }[]) =>
  people.find(p => `${p.kind}:${p.id}` === key)?.name || key.split(':').slice(1).join(':') || tr('tasks.copy.15');

const moveErrorText = (e: unknown) => (e instanceof RequirementsHubError && e.status === 403 ? tr('tasks.copy.16') : tr('tasks.copy.17'));

/** 「在新窗口打开」的任务窗口:只画这一个任务的详情(整窗),关掉 = 关窗口(TaskWindow.tsx)。 */
export type SingleTask = { taskId: string; onClose: () => void; onTitle?: (name: string) => void };

export default function RequirementBoard(props: { cfg: HubConfig; desktop?: boolean; dispatch?: ReactNode; onOpenVoiceSettings?: () => void; single?: SingleTask }) {
  useTranslation();
  const { cfg } = props;
  return <ScopedRequirementBoard key={taskScopeKey(cfg)} {...props} />;
}

function ScopedRequirementBoard({ cfg, desktop, dispatch, onOpenVoiceSettings, single }: { cfg: HubConfig; desktop?: boolean; dispatch?: ReactNode; onOpenVoiceSettings?: () => void; single?: SingleTask }) {
  const { language } = useTranslation();
  const s = useTaskStyles();
  const scope = taskScopeKey(cfg);
  useLayoutEffect(() => { enterTaskScope(scope); }, [scope]);
  const mine = useTaskBoard(st => st.scope === scope);
  const storeItems = useTaskBoard(st => st.items);
  const storePeople = useTaskBoard(st => st.people);
  const meId = useTaskBoard(st => (st.scope === scope ? st.meId : null));
  const section = useTaskBoard(st => st.section);
  const twoRoles = useTaskBoard(st => (st.scope === scope ? st.twoRoles === true : false));
  const projects = useTaskBoard(st => (st.scope === scope ? st.projects : null));
  const managingProjects = useTaskBoard(st => st.managingProjects);
  const managingTags = useTaskBoard(st => st.managingTags);
  const managerFocus = useTaskBoard(st => st.managerFocus);
  const managerOpsRef = useRef<ManagerOps | null>(null);
  useEffect(() => {
    if (single) return;
    patchTaskBoard(scope, { managerOps: { updateProject: (id, patch) => managerOpsRef.current!.updateProject(id, patch), tagOp: op => managerOpsRef.current!.tagOp(op) } });
    return () => patchTaskBoard(scope, { managerOps: null, sideMenu: null });
  }, [scope, !!single]);
  const tagsCapable = useTaskBoard(st => st.scope === scope && st.capabilities.includes('tags'));
  const tagCatalog = useTaskBoard(st => (st.scope === scope ? st.tagCatalog : null));
  const tagOpsAllowed = useTaskBoard(st => st.scope === scope && canManageTags(st.capabilities, st.tagCatalog));
  const dueDatetime = useTaskBoard(st => st.scope === scope && st.capabilities.includes('due_datetime'));
  const subCaps = useTaskBoard(st => st.scope === scope && st.capabilities.includes('sub_requirements'));
  const startCapable = useTaskBoard(st => st.scope === scope && st.capabilities.includes('start_date'));
  const seqCapable = useTaskBoard(st => st.scope === scope && st.capabilities.includes(SEQ_CAPABILITY));
  const statsCapable = useTaskBoard(st => st.scope === scope && st.capabilities.includes('stats'));
  // 动态(#429):Hub 记改动流水(capability events)才有这个视图。
  const eventsCapable = useTaskBoard(st => st.scope === scope && st.capabilities.includes('events'));
  const lowestPriority = useTaskBoard(st => st.scope === scope && supportsLowest(st.capabilities));
  const priorityOptions = useMemo(() => priorityChoices(lowestPriority), [lowestPriority]);
  const filter = useTaskBoard(st => st.filter);
  // 换网络时整块看板按 scope 重新挂载;第一帧 store 还是上一个网络的,别把它的搜索词带过来。
  const search = useTaskBoard(st => (st.scope === scope ? st.search : EMPTY_SEARCH));
  const archivedCapable = useTaskBoard(st => st.scope === scope && st.capabilities.includes('archived'));
  // 「废弃」(#724):Hub capabilities 含 column_abandoned 才给选;旧 Hub 写它会 400,所以整个藏起来。
  const abandonedOk = useTaskBoard(st => st.scope === scope && supportsAbandoned(st.capabilities));
  const statusOptions = useMemo(() => statusChoices(abandonedOk), [abandonedOk]);
  const items = mine ? storeItems : [];
  /** 这块看板本次启动里从 Hub 读成功过(哪怕是空的)——连不上时照常显示那份,而不是整页报错。 */
  const hasCached = useTaskBoard(st => st.scope === scope && st.loaded);
  // 选着「动态」时换到一个不记改动的 Hub(或降级了):分段里没有这个视图了,回到看板。
  useEffect(() => { if (section === 'activity' && hasCached && !eventsCapable) setTaskSection('board'); }, [section, hasCached, eventsCapable]);
  const people = mine ? storePeople : [];
  const pointer = pointerUi(desktop);
  const localKey = requirementsKey(cfg.profileId || cfg.username || 'local');

  const [measured, setMeasured] = useState(0);
  // 原生第一帧 onLayout 之前量到的是 0:退到窗口宽(旋转 / 折叠屏展开时跟着变),不按 0 去排版。
  const windowWidth = useWindowDimensions().width;
  const layout = boardLayout(measured, windowWidth, spacing.lg);
  const width = layout.width;
  const narrow = layout.mode === 'paged';
  // #701:桌面(有指针)点任务一律右侧抽屉(默认 560、左沿拖宽、本机记住);触屏宽屏抽屉、手机推入整页(task-drawer-model.ts)。
  const drawer = detailMode({ pointer: pointer, boardWidth: width }) === 'drawer';
  const [drawerWidth, setDrawerWidth] = useDrawerWidth(width);
  const pagerRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const [listPaging, setListPaging] = useState({ key: '', page: 0 });
  const listScrollRef = useRef<ScrollView>(null);
  const pageWidth = layout.mode === 'paged' ? layout.pageWidth : 0;
  // 旋转 / 折叠后页宽变了:停在同一列上,而不是停在旧偏移量(两列中间)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (pageWidth) pagerRef.current?.scrollTo({ x: page * pageWidth, animated: false }); }, [pageWidth]);
  const [headerBottom, setHeaderBottom] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [hubError, setHubError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(single?.taskId ?? null);
  const [movingIds, setMovingIds] = useState<string[]>([]);
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [menu, setMenu] = useState<TaskMenuTarget | null>(null);
  // 手机快捷改状态(task-quick-status.ts):开着的那一行左滑、长按菜单弹出的选择器、刚改完的撤销提示。
  const [swipeOpen, setSwipeOpen] = useState<string | null>(null);
  const [quickPick, setQuickPick] = useState<{ id: string; kind: 'status' | 'priority'; anchor: SelectAnchor } | null>(null);
  // 卡片菜单的目标(右键 / 长按 / 列表行 ⋯ 都走这里):桌面菜单直接列优先级档,所以带上当前档和可选档。
  // 归档(Hub capability archived;任务页审计 2026-10-02 H2):旧 Hub / 只读 / 已归档的卡不给入口。
  const archiveAccess = (item: Requirement): 'archive' | 'hidden' => (archivedCapable && !item.readOnly && !item.archived ? 'archive' : 'hidden');
  const menuTarget = (item: Requirement, x: number, y: number): TaskMenuTarget => ({
    id: item.id, title: item.name, column: item.column, x, y, assign: assignAccess(item), quick: quickMenuAccess(item),
    priority: item.priority, priorities: priorityChoices(lowestPriority, item.priority), archive: archiveAccess(item),
  });
  const [undo, setUndo] = useState<QuickUndo | null>(null);
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  const [filterMenu, setFilterMenu] = useState<{ kind: FilterKind; x: number; y: number } | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ column: ReqColumn; name: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  // ── 桌面多选 + 批量改(task-select-model.ts):Ctrl/⌘ 单击、Shift 单击、列表行首勾选框 ──
  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const [bulk, setBulk] = useState<BulkProgress | null>(null);
  const [bulkMenu, setBulkMenu] = useState<{ kind: BulkKind; anchor: SelectAnchor } | null>(null);
  const lastBulk = useRef<{ kind: BulkKind; value: string | null } | null>(null);
  // 从看板直接指派(卡片菜单 / 卡片上的参与人头像):开着哪张卡的哪个选择器。
  // anchor:从卡片头像组点开(桌面)时锚在头像组下面的下拉;卡片菜单 / 手机 = null = 居中面板。
  // opened:打开参与人选择器时的参与人(读-改-写的基准,participantsChange)。
  const [assignFor, setAssignFor] = useState<{ id: string; mode: 'owner' | 'participants'; anchor: SelectAnchor | null; opened: RequirementPersonRef[] } | null>(null);
  const bulkRefs = useRef<Record<string, any>>({});
  const pendingMoves = useRef(new Set<string>());
  const mutations = useRef(0);
  const inFlight = useRef(0);
  /** 上一次整张表读成功的时刻(首屏或轮询)。 */
  const lastListAt = useRef(0);
  // 省流读(board-sync.ts):增量的游标和上次整读的时刻。换账号 / 网络 = 从整读重新开始。
  const sync = useRef<BoardSyncState>({ cursor: null, fullAt: 0 });
  const today = localToday();
  // ── 搜索(task-search.ts):输入框里的字去抖后才进共享状态;归档的卡只在勾了「包含已归档」时另读 ──
  const [searchText, setSearchText] = useState(search.q);
  const [searchOpen, setSearchOpen] = useState(!!search.q);
  const [archivedRows, setArchivedRows] = useState<Requirement[]>([]);
  const searchRef = useRef<any>(null);
  useEffect(() => {
    if (searchText === search.q) return;
    const t = setTimeout(() => setTaskSearch({ ...search, q: searchText }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchText, search]);
  const clearSearch = () => { setSearchText(''); setTaskSearch({ ...search, q: '' }); };
  // Hub 支持服务端搜索(capability search):有搜索词就问服务端(归档的一起,?include_archived=1),一页一页读;
  // 旧 Hub:「包含已归档」照旧读一次归档的整张表,本机搜。
  const serverSearchCap = useTaskBoard(st => st.scope === scope && st.capabilities.includes('search'));
  const truncated = useTaskBoard(st => st.scope === scope && st.truncated);
  const wantArchived = archivedCapable && search.archived && !!searchTerms(search.q).length && !serverSearchCap;
  useEffect(() => {
    if (!wantArchived) return;
    let dead = false;
    listArchivedRequirements(cfg)
      .then(rows => { if (!dead) setArchivedRows(rows); })
      .catch(e => { if (!dead) setBanner(tr('taskSearch.archivedFailed') + (e instanceof Error ? e.message : String(e))); });
    return () => { dead = true; };
  }, [wantArchived, cfg.serverUrl, cfg.token, cfg.networkId]);
  const archived = wantArchived ? archivedRows : [];
  // 服务端的结果按「搜索词 + 含不含归档」记;换了词,旧词晚到的回包丢掉(key 对不上)。next = 下一页的 cursor(「加载更多」)。
  const askServer = needsServerSearch(serverSearchCap ? ['search'] : [], search);
  const includeArchivedOnServer = archivedCapable && search.archived;
  const serverKey = `${search.q}\u0000${includeArchivedOnServer ? 1 : 0}`;
  const [serverHits, setServerHits] = useState<{ key: string; rows: Requirement[]; next: string | null; loading: boolean }>({ key: '', rows: [], next: null, loading: false });
  useEffect(() => {
    if (!askServer) return;
    let dead = false;
    const key = serverKey;
    setServerHits({ key, rows: [], next: null, loading: true });
    searchRequirementsOnHub(cfg, search.q, { includeArchived: includeArchivedOnServer })
      .then(r => { if (!dead) setServerHits({ key, rows: r.rows, next: r.next, loading: false }); })
      .catch(() => { if (!dead) setServerHits({ key, rows: [], next: null, loading: false }); /* 本机的结果照样显示 */ });
    return () => { dead = true; };
  }, [askServer, serverKey, cfg.serverUrl, cfg.token, cfg.networkId]);
  const serverCurrent = askServer && serverHits.key === serverKey;
  const extraHits = serverCurrent ? serverHits.rows : [];
  const loadMoreHits = () => {
    const { key, next, rows } = serverHits;
    if (!serverCurrent || !next || serverHits.loading) return;
    setServerHits(cur => ({ ...cur, loading: true }));
    searchRequirementsOnHub(cfg, search.q, { includeArchived: includeArchivedOnServer, cursor: next })
      .then(r => setServerHits(cur => {
        if (cur.key !== key) return cur;
        const have = new Set(rows.map(row => row.id));
        return { key, rows: [...rows, ...r.rows.filter(row => !have.has(row.id))], next: r.next, loading: false };
      }))
      .catch(e => { setServerHits(cur => (cur.key === key ? { ...cur, loading: false } : cur)); setBanner(e instanceof Error ? e.message : String(e)); });
  };
  // 仪表盘点开的卡可能不在看板里(归档的 / 列表截断之外的):按 id 读一张来开详情。
  const [dashRow, setDashRow] = useState<Requirement | null>(null);
  const selected = items.find(item => item.id === selectedId) || archived.find(item => item.id === selectedId) || extraHits.find(item => item.id === selectedId) || (dashRow?.id === selectedId ? dashRow : null) || null;

  // ── 读 Hub ──
  useEffect(() => {
    let dead = false;
    // 失败后重试时停在错误页(按钮换成「正在重试…」),不要在错误页和转圈之间来回闪。
    setPhase(p => (p === 'error' ? p : 'loading'));
    setRetrying(true);
    // 项目和卡片互不依赖:一起发。串着等是首屏多一个跨太平洋往返(桌面冷连接 ~0.7 s)。
    // 旧 Hub 没有这个路由 → null,界面把项目整个藏起来;读失败也按没有处理,不挡看板。
    const projectsRead = listProjects(cfg).catch(() => null);
    // 冷启动先画上次的看板(swr-cache.ts,按账号 + 网络);Hub 一回来整张替换。只在这块看板本次启动里
    // 还没读到过任何东西时才用,已有的(哪怕是空的)永远不被磁盘上的旧数据盖掉。
    if (!taskBoardState().loaded && !taskBoardState().items.length) {
      void recallBoard(cfg.profileId, cfg.networkId).then(snap => {
        const st = taskBoardState();
        if (dead || !snap || st.scope !== scope || st.loaded || st.items.length) return;
        patchTaskBoard(scope, { items: snap.items as Requirement[], projects: snap.projects as RequirementProject[] | null, twoRoles: snap.twoRoles, capabilities: snap.capabilities });
      });
    }
    (async () => {
      try {
        await migrateLocalRequirements(cfg, () => readRequirements(localKey), rows => writeRequirements(localKey, rows));
        sync.current = { cursor: null, fullAt: 0 };
        // Hub 声明过 list_summary(上次启动存下的能力)就读精简列表;第一次连这个 Hub 读完整的,顺便拿到能力。
        const { rows: fetched, capabilities, truncated: cut } = await listRequirementsFull(cfg, { summary: taskBoardState().capabilities.includes('list_summary') });
        if (dead) return;
        const list = mergeListRows(taskBoardState().items, fetched);
        sync.current = { cursor: cursorAfterList(list), fullAt: Date.now() };
        // 分不分两个角色:有卡片就看行里带没带 agent_owner;一张都没有才去探 Hub。
        const roles = list.length ? list.some(hasRoles) : await probeAgentOwnerSupport(cfg);
        if (dead) return;
        const projectList = await projectsRead;
        if (dead) return;
        lastListAt.current = Date.now();
        patchTaskBoard(scope, { items: list, loaded: true, twoRoles: roles, projects: projectList, capabilities, truncated: cut });
        if (cfg.networkId) rememberBoard(cfg.profileId, { networkId: cfg.networkId, items: list, projects: projectList, twoRoles: roles, capabilities });
        setPhase('ready');
        setHubError('');
      } catch (e) {
        if (dead) return;
        if (e instanceof RequirementsHubError && e.status === 404) { setPhase('unsupported'); return; }
        setPhase('error');
        setHubError(e instanceof Error ? e.message : tr('tasks.copy.18'));
      } finally {
        if (!dead) setRetrying(false);
      }
    })();
    void fetchMyUserId(cfg).then(id => { if (!dead) patchTaskBoard(scope, { meId: id }); });
    // 标签目录(补全、颜色、「管理标签」要不要出现)。读失败 = null:只是不给管理入口,不挡看板。
    void fetchTagCatalog(cfg).then(cat => { if (!dead) patchTaskBoard(scope, { tagCatalog: cat }); }).catch(() => {});
    return () => { dead = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, localKey, reloadKey, scope]);

  // 打开「管理标签」时重读一次目录:用量要是 Hub 上的实数(含归档、含没载入的老卡)。
  useEffect(() => {
    if (!managingTags) return;
    let dead = false;
    void fetchTagCatalog(cfg).then(cat => { if (!dead && cat) patchTaskBoard(scope, { tagCatalog: cat }); }).catch(() => {});
    return () => { dead = true; };
  }, [managingTags, cfg.serverUrl, cfg.token, cfg.networkId, scope]);

  // 有卡片带稳定负责人时读一次成员(卡片上的名字 / 头像、筛选里的人都从这里来)。
  // 仪表盘也要:完成榜 / 最近完成 / 分享图上的完成者名字从这里来,没有负责人的看板上也得有。
  const hasOwners = items.some(item => item.owner || item.agentOwner || item.participants?.length);
  const needPeople = hasOwners || section === 'dashboard' || section === 'activity';
  useEffect(() => {
    if (!needPeople || !cfg.networkId) return;
    let dead = false;
    listRequirementPeople(cfg).then(rows => { if (!dead) patchTaskBoard(scope, { people: rows }); }).catch(() => {});
    return () => { dead = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, needPeople, scope]);

  // 精简列表的卡打开时按 id 补读全文(描述 + 子任务)。读回来之前详情里显示「正在读取…」;卡在这期间又被
  // 轮询换成新的精简行(别人改了它)时,这里跟着 updatedAt 再读一次。
  const openNeedsText = needsFullText(selected);
  const openId = selected?.id ?? null;
  const openAt = selected?.updatedAt ?? null;
  useEffect(() => {
    if (!openNeedsText || !openId) return;
    let dead = false;
    getRequirementOnHub(cfg, openId)
      .then(full => { if (!dead && full) updateTaskItems(scope, rows => rows.map(row => (row.id === openId && !hasFullText(row) ? full : row))); })
      .catch(e => { if (!dead) setBanner(e instanceof Error ? e.message : String(e)); });
    return () => { dead = true; };
  }, [openNeedsText, openId, openAt, cfg.serverUrl, cfg.token, cfg.networkId, scope]);

  const refresh = useCallback(async (force?: boolean) => {
    // 首次加载失败(连不上 / 超时)后不能只靠用户点「重试」:跟着轮询(失败时自动退避)再试一次首次加载。
    if (phase === 'error') { setReloadKey(n => n + 1); return; }
    if (phase !== 'ready' || inFlight.current > 0 || drag.current.phase !== 'idle') return;
    // phase 变成 ready 时 refresh 换了身份,usePoll 会立刻再跑一次 —— 首屏刚拉完的整张表(生产 500 行
    // ≈163 KB gzip)又拉一遍。刚拉过就等下一轮;别的窗口改了任务(task-changed)照常立刻刷。
    if (!force && Date.now() - lastListAt.current < POLL_MS / 2) return;
    const gen = mutations.current;
    try {
      const st0 = taskBoardState();
      const plan = planBoardRead(st0.capabilities, st0.truncated, sync.current, Date.now());
      if (plan.kind === 'changes') {
        const delta = await listRequirementChanges(cfg, plan.since);
        if (!delta.hasMore) {
          lastListAt.current = Date.now();
          // 读的时候本机改过卡:这一拍不并(游标也不动),下一拍从同一个游标再读一次。
          if (gen !== mutations.current || inFlight.current !== 0) return;
          const list = applyChanges(taskBoardState().items, delta.rows, delta.deleted);
          if (delta.serverTime) sync.current = { ...sync.current, cursor: delta.serverTime };
          // 增量响应带了 capabilities(含空数组)就覆盖。Hub 降级后不再声明 column_abandoned,菜单不能还写「废弃」。
          patchTaskBoard(scope, { items: list, ...(delta.capabilitiesKnown ? { capabilities: delta.capabilities } : {}) });
          const st = taskBoardState();
          if (cfg.networkId && st.scope === scope && (delta.rows.length || delta.deleted.length)) rememberBoard(cfg.profileId, { networkId: cfg.networkId, items: list, projects: st.projects, twoRoles: st.twoRoles, capabilities: st.capabilities });
          return;
        }
        // 这段时间改的太多,一页装不下:整读一次。
      }
      const { rows: fetched, capabilities, truncated: cut } = await listRequirementsFull(cfg, { summary: plan.kind === 'list' ? plan.summary : true });
      lastListAt.current = Date.now();
      if (gen === mutations.current && inFlight.current === 0) {
        const list = mergeListRows(taskBoardState().items, fetched);
        sync.current = { cursor: cursorAfterList(list), fullAt: Date.now() };
        // Hub 升级 / 降级后能力会变。空数组也要写回:降级后的 Hub 不带 column_abandoned,再写「废弃」会 400。
        patchTaskBoard(scope, { items: list, capabilities, truncated: cut });
        const st = taskBoardState();
        if (cfg.networkId && st.scope === scope) rememberBoard(cfg.profileId, { networkId: cfg.networkId, items: list, projects: st.projects, twoRoles: st.twoRoles, capabilities: st.capabilities });
      }
    } catch { /* 下一轮再试;看板保留上次的 */ }
  }, [cfg, phase, scope]);
  usePoll(refresh, POLL_MS, [refresh]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void (async () => {
      const label = await currentWindowLabel();
      const u = await listenTaskChanged(raw => {
        const change = parseTaskChanged(raw);
        if (change && changeConcernsMe(change, { label, profileId: cfg.profileId, serverUrl: cfg.serverUrl, networkId: cfg.networkId })) void refreshRef.current(true);
      });
      if (alive) off = u; else u();
    })().catch(() => {});
    return () => { alive = false; off?.(); };
  }, [cfg.profileId, cfg.serverUrl, cfg.networkId]);

  const loadPeople = async (): Promise<boolean> => {
    if (peopleLoading) return false;
    setPeopleLoading(true);
    setPeopleError('');
    try {
      patchTaskBoard(scope, { people: await listRequirementPeople(cfg) });
      return true;
    } catch (e) {
      setPeopleError(e instanceof Error ? e.message : tr('tasks.copy.19'));
      return false;
    } finally {
      setPeopleLoading(false);
    }
  };

  // ── 写 Hub ──
  const track = async <T,>(fn: () => Promise<T>): Promise<T> => {
    mutations.current += 1;
    inFlight.current += 1;
    try {
      const out = await fn();
      // 别的窗口(主窗口的看板 / 「在新窗口打开」的任务窗口)里同一块看板马上重读,不等 15 秒的轮询。
      void emitTaskChanged({ profileId: cfg.profileId, serverUrl: cfg.serverUrl, networkId: cfg.networkId });
      return out;
    } finally { inFlight.current -= 1; }
  };

  // 只读的卡(RFC-038 §9,hub 说我不能改):所有写入口先挡住并说一声,不做乐观更新、不发请求。
  // UI 上本来就点不动(卡片不能拖、详情整块不响应),这里是兜底:键盘移动、批量、甘特图拖动都走这几个函数。
  // 参与人的卡(hub viewer_can.edit_fields):状态和检查项放开,其余照样挡;挡的时候说清楚能改什么。
  const readOnlyBlock = (id: string, field?: TaskEditField): string | null => {
    const it = items.find(row => row.id === id);
    if (!it?.readOnly || (field && canEditTaskField(it, field))) return null;
    return it.editFields?.length ? tr('tasks.partialBlocked', { name: it.name, what: tr(readOnlyLabelKey(it.editFields)) }) : tr('tasks.readOnlyBlocked', { name: it.name });
  };
  const move = async (id: string, to: ReqColumn) => {
    const item = items.find(row => row.id === id);
    if (!item || item.column === to || pendingMoves.current.has(id)) return;
    const blocked = readOnlyBlock(id, 'column');
    if (blocked) { setBanner(blocked); return; }
    const from = item.column;
    pendingMoves.current.add(id);
    setMovingIds(ids => [...ids, id]);
    setMoveErrors(({ [id]: _, ...rest }) => rest);
    updateTaskItems(scope, rows => applyMove(rows, id, to));
    setAnnounce(tr('tasks.copy.20', { v0: item.name, v1: taskText(REQ_COLUMN_LABEL[to]) }));
    try {
      const updated = await track(() => moveRequirementOnHub(cfg, id, to));
      updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
    } catch (e) {
      updateTaskItems(scope, rows => revertMove(rows, id, from, to));
      const message = moveErrorText(e);
      setMoveErrors(prev => ({ ...prev, [id]: message }));
      setBanner(`「${item.name}」${message}`);
    } finally {
      pendingMoves.current.delete(id);
      setMovingIds(ids => ids.filter(x => x !== id));
    }
  };

  const create = async (d: CreateDraft): Promise<string | null> => {
    const input = createInput(d, twoRoles);
    if (!input) return tr('tasks.copy.21');
    try {
      const created = await track(() => createRequirementOnHub(cfg, input));
      updateTaskItems(scope, rows => [created, ...rows.filter(row => row.id !== created.id)]);
      if (created.tags?.length) noteTagsUsed(created.tags);
      setAnnounce(tr('tasks.copy.22', { v0: created.name }));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : tr('tasks.copy.23');
    }
  };

  // ── 子任务:勾选只改那一项(单项接口),增删排序改整张清单;都先乐观更新,失败退回 ──
  const [checklistErrors, setChecklistErrors] = useState<Record<string, string>>({});
  const setChecklistLocal = (id: string, next: ChecklistItem[]) => updateTaskItems(scope, rows => rows.map(row => (row.id === id ? { ...row, checklist: next } : row)));
  const replaceChecklist = async (id: string, next: ChecklistItem[]) => {
    const prev = items.find(row => row.id === id)?.checklist;
    if (!prev) return;
    const blocked = readOnlyBlock(id, 'checklist');
    if (blocked) { setChecklistErrors(errs => ({ ...errs, [id]: blocked })); return; }
    setChecklistErrors(({ [id]: _, ...rest }) => rest);
    setChecklistLocal(id, next);
    try {
      const updated = await track(() => updateRequirementOnHub(cfg, id, { checklist: next }));
      setChecklistLocal(id, updated.checklist ?? next);
    } catch (e) {
      setChecklistLocal(id, prev);
      setChecklistErrors(errs => ({ ...errs, [id]: e instanceof Error ? e.message : tr('tasks.copy.24') }));
    }
  };
  const toggleChecklist = async (id: string, itemId: string, done: boolean) => {
    const list = items.find(row => row.id === id)?.checklist;
    if (!list) return;
    const blocked = readOnlyBlock(id, 'checklist');
    if (blocked) { setChecklistErrors(errs => ({ ...errs, [id]: blocked })); return; }
    setChecklistErrors(({ [id]: _, ...rest }) => rest);
    updateTaskItems(scope, rows => rows.map(row => (row.id === id && row.checklist ? { ...row, checklist: setChecklistDone(row.checklist, itemId, done) } : row)));
    try {
      const updated = await track(() => setChecklistItemOnHub(cfg, id, itemId, done));
      if (updated.checklist) setChecklistLocal(id, updated.checklist);
    } catch (e) {
      updateTaskItems(scope, rows => rows.map(row => (row.id === id && row.checklist ? { ...row, checklist: setChecklistDone(row.checklist, itemId, !done) } : row)));
      setChecklistErrors(errs => ({ ...errs, [id]: e instanceof Error ? e.message : tr('tasks.copy.24') }));
    }
  };

  const saveEdit = async (id: string, patch: EditPatch): Promise<string | null> => {
    const blocked = readOnlyBlock(id);
    if (blocked) return blocked;
    try {
      const updated = await track(() => updateRequirementOnHub(cfg, id, patch));
      updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : tr('tasks.copy.25');
    }
  };

  // 指派人(卡片菜单、卡片上的参与人头像、批量、详情里的负责人 / 负责 Agent):立即保存,只发改的那一个字段;
  // 先乐观更新,失败只退回这个字段。负责人 / 负责 Agent 走同一个 PATCH(updateRequirementOnHub),参与人走人员绑定接口。
  const assign = async (id: string, change: AssignChange): Promise<string | null> => {
    const prev = items.find(row => row.id === id);
    if (!prev) return null;
    const blocked = readOnlyBlock(id);
    if (blocked) return blocked;
    updateTaskItems(scope, rows => rows.map(row => (row.id === id ? { ...row, ...change } : row)));
    try {
      if (change.participants !== undefined) {
        const saved = await track(() => saveRequirementAssignments(cfg, id, { participants: change.participants }));
        updateTaskItems(scope, rows => rows.map(row => (row.id === id ? { ...row, ...saved } : row)));
      } else {
        const patch: EditPatch = change.owner !== undefined ? { owner: change.owner } : { agent_owner: change.agentOwner ?? null };
        const updated = await track(() => updateRequirementOnHub(cfg, id, patch));
        updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
      }
      setAnnounce(tr('assign.saved', { name: prev.name }));
      return null;
    } catch (e) {
      updateTaskItems(scope, rows => rows.map(row => (row.id === id ? revertAssign(row, prev, change) : row)));
      return e instanceof Error ? e.message : tr('tasks.copy.3');
    }
  };
  const openAssign = async (id: string, mode: 'owner' | 'participants', anchorEl?: any) => {
    const item = items.find(row => row.id === id);
    if (!item) return;
    if (!canAssignPeople(item)) { setBanner(readOnlyBlock(id) || tr('tasks.copy.4')); return; }
    if (!(await loadPeople()) && !people.length) return;
    // 桌面(指针)从卡片头像组点开:和详情 / 新建里的字段一样,锚在头像组下面的下拉(右沿对齐头像组,不伸进隔壁列)。
    // 手机、或量不到(元素没了):居中面板。窗口够不够宽由选择器自己判(PEOPLE_DROPDOWN_MIN_WIDTH)。
    const opened = openedParticipants(item);
    if (!pointer || !anchorEl) { setAssignFor({ id, mode, anchor: null, opened }); return; }
    measureAnchor(anchorEl, a => setAssignFor({ id, mode, anchor: a ? anchorRightAligned(a) : null, opened }));
  };
  const assignItem = assignFor ? items.find(row => row.id === assignFor.id) ?? null : null;
  const confirmAssign = (picked: { kind: 'user' | 'node'; id: string }[]) => {
    const target = assignFor;
    setAssignFor(null);
    const item = target && items.find(row => row.id === target.id);
    if (!target || !item) return;
    const change = target.mode === 'owner' ? ownerChange(item, picked) : participantsChange(item, target.opened, picked);
    if (!change) return;
    void assign(item.id, change).then(failed => { if (failed) setBanner(`「${item.name}」${failed}`); });
  };
  // 列表就地编辑(多维表格式):一格一个字段,先乐观改,失败只退回那一个字段;返回原因给表格就地提示。
  const editCell = async (id: string, edit: CellEdit): Promise<string | null> => {
    const before = items.find(row => row.id === id);
    const req = before && cellRequest(before, edit);
    if (!before || !req) return null;
    const blocked = readOnlyBlock(id, edit.field === 'status' ? 'column' : undefined);
    if (blocked) return blocked;
    updateTaskItems(scope, rows => rows.map(row => (row.id === id ? applyCellEdit(row, edit) : row)));
    try {
      if (req.kind === 'assign') {
        const saved = await track(() => saveRequirementAssignments(cfg, id, { participants: req.participants }));
        updateTaskItems(scope, rows => rows.map(row => (row.id === id ? { ...row, ...saved } : row)));
      } else {
        const updated = await track(() => (req.kind === 'move' ? moveRequirementOnHub(cfg, id, req.column) : updateRequirementOnHub(cfg, id, req.patch)));
        updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
      }
      if (edit.field === 'tags') noteTagsUsed(edit.tags);
      return null;
    } catch (e) {
      updateTaskItems(scope, rows => rows.map(row => (row.id === id ? rollbackCellEdit(row, before, edit) : row)));
      return e instanceof Error ? e.message : tr('tasks.copy.25');
    }
  };

  // 甘特图拖动改期限:只发 due(描述等别的字段不动),先乐观更新,失败退回并提示。
  const setDue = async (id: string, due: string) => {
    const prev = items.find(row => row.id === id);
    if (!prev || prev.due === due) return;
    const blocked = readOnlyBlock(id);
    if (blocked) { setBanner(blocked); return; }
    updateTaskItems(scope, rows => rows.map(row => (row.id === id ? { ...row, due } : row)));
    const failed = await saveEdit(id, { due });
    if (failed) {
      updateTaskItems(scope, rows => rows.map(row => (row.id === id ? { ...row, due: prev.due } : row)));
      setBanner(`「${prev.name}」${failed}`);
    }
  };

  // 新建时带上当前筛选:在「我负责的」/ 某个节点下建,负责人默认就是它;只筛了一个优先级也带上。
  const draftFor = (column: ReqColumn): CreateDraft => {
    const d = emptyDraft(column);
    const only = filter.owners.length === 1 ? filter.owners[0] : null;
    if (only && only !== UNASSIGNED) {
      const [kind, ...rest] = only.split(':');
      const ref = { kind, id: rest.join(':') } as const;
      // 在某个 Agent 下建:分两个角色的 Hub 上它是负责 Agent;旧 Hub 上是唯一的负责人。
      if (kind === 'node' && twoRoles) d.agentOwner = { kind: 'node', id: ref.id };
      else if (kind === 'user' || kind === 'node') d.owner = { kind, id: ref.id };
    }
    // 在「我参与的」下建:参与人默认带上我(不然新卡一建好就不在当前视图里)。
    if (filter.participant?.startsWith('user:')) d.participants = [{ kind: 'user', id: filter.participant.slice(5) }];
    // 筛着某一档就用那一档建;旧 Hub 不收 P3,筛着 P3 也按默认 P1 建。
    if (filter.priorities.length === 1 && priorityOptions.includes(filter.priorities[0])) d.priority = filter.priorities[0];
    if (projects) d.projectId = defaultProjectFor(filter, projects);
    return d;
  };

  // ── 拖动(只在桌面)──
  const drag = useRef<DragState>(DRAG_IDLE);
  const [dragView, setDragView] = useState<DragState>(DRAG_IDLE);
  const grab = useRef({ dx: 0, dy: 0, w: 240 });
  const swallow = useRef(false);
  const onDrag = (ev: DragEvent, g?: { dx: number; dy: number; w: number }) => {
    if (g) grab.current = g;
    const before = drag.current;
    const step = dragReduce(before, ev);
    drag.current = step.state;
    if (step.swallowClick) { swallow.current = true; setTimeout(() => { swallow.current = false; }, 0); }
    if (step.state.phase === 'dragging' || before.phase === 'dragging') setDragView(step.state);
    if ((step.state.phase === 'dragging') !== (before.phase === 'dragging')) setDraggingCursor(step.state.phase === 'dragging');
    if (step.commit) void move(step.commit.id, step.commit.to);
  };
  useEffect(() => () => setDraggingCursor(false), []);
  const focusCard = (id: string) => setTimeout(() => {
    const el = (globalThis as { document?: any }).document?.querySelector?.(`[data-task-card="${id}"]`);
    el?.focus?.();
  }, 30);
  useTaskCardDom(pointer && phase === 'ready' && section !== 'dispatch' && !selectedId && !draft && !menu, {
    onDrag,
    dragging: () => drag.current.phase === 'dragging',
    onContextMenu: (id, x, y) => {
      const item = items.find(row => row.id === id);
      if (item) setMenu(menuTarget(item, x, y));
    },
    onKeyMove: (id, dir) => {
      const item = items.find(row => row.id === id);
      const to = item && neighbourColumn(item.column, dir);
      if (item && to) { void move(id, to); focusCard(id); }
    },
  });

  const openDetail = (id: string) => { if (!swallow.current) setSelectedId(id); };
  const openFromDashboard = (id: string) => {
    setSelectedId(id);
    if (items.some(item => item.id === id)) return;
    void getRequirementOnHub(cfg, id).then(row => { if (row) setDashRow(row); }).catch(e => setBanner(e instanceof Error ? e.message : String(e)));
  };
  // 私信 / 顶部提示里的任务通知 → 打开那张任务(task-open-request.ts)。「在新窗口打开」的单卡窗口不接。
  const openFromDashboardRef = useRef(openFromDashboard);
  openFromDashboardRef.current = openFromDashboard;
  useEffect(() => {
    if (single) return;
    const take = () => { const id = takeOpenTaskRequest(cfg.networkId); if (id) openFromDashboardRef.current(id); };
    take();
    return subscribeOpenTaskRequest(take);
  }, [single, cfg.networkId]);
  const openMenuAt = (item: Requirement, x: number, y: number) => { setSwipeOpen(null); setMenu(menuTarget(item, x, y)); };
  // 归档 / 恢复(Hub capability archived;任务页审计 2026-10-02 H2):只发 { archived }。归档可撤销,不再确认 ——
  // 成功后底部一条提示带「撤销」(和手机快捷改状态同一种),撤销 = 反方向再发一次。只读的卡不给入口(Hub 也会拒)。
  const [archUndo, setArchUndo] = useState<{ id: string; name: string; archived: boolean } | null>(null);
  const setArchived = async (id: string, archived: boolean, fromUndo = false): Promise<void> => {
    const it = items.find(row => row.id === id) ?? archivedRows.find(row => row.id === id) ?? serverHits.rows.find(row => row.id === id) ?? (selected?.id === id ? selected : undefined);
    const name = it?.name ?? '';
    const blocked = readOnlyBlock(id);
    if (blocked) { setBanner(blocked); return; }
    try {
      const row = await track(() => setRequirementArchivedOnHub(cfg, id, archived));
      if (archived) {
        updateTaskItems(scope, rows => rows.filter(r => r.id !== id));
        setArchivedRows(rs => [row, ...rs.filter(r => r.id !== id)]);
        // 详情里归档:卡不在看板上了,详情跟着关 —— 只有正在搜、而且搜索包含已归档时它还在结果里,才留着(显示「已归档」横幅)。
        // 不关的话选中的 id 留着,下次一搜到它详情会自己冒出来。
        if (selectedId === id && !(search.archived && searchTerms(search.q).length)) setSelectedId(null);
      } else {
        updateTaskItems(scope, rows => [row, ...rows.filter(r => r.id !== id)]);
        setArchivedRows(rs => rs.filter(r => r.id !== id));
      }
      setServerHits(h => (h.rows.some(r => r.id === id) ? { ...h, rows: h.rows.map(r => (r.id === id ? row : r)) } : h));
      setArchUndo(fromUndo ? null : { id, name: name || row.name, archived });
    } catch (e) {
      setBanner(`「${name}」${e instanceof Error ? e.message : String(e)}`);
    }
  };
  useEffect(() => {
    if (!archUndo) return;
    const timer = setTimeout(() => setArchUndo(u => (u === archUndo ? null : u)), UNDO_MS);
    return () => clearTimeout(timer);
  }, [archUndo]);
  // 手机快捷改状态:只发 {column}(editCell → cellRequest → moveRequirementOnHub),失败退回并提示;成功留 5 秒撤销。
  // 撤销同样只发 {column},改回原来的状态。
  const quickStatus = (id: string, to: ReqColumn) => {
    const item = items.find(row => row.id === id);
    setSwipeOpen(null);
    if (!item || item.column === to) return;
    const from = item.column;
    setUndo({ id, name: item.name, from, to, at: Date.now() });
    void editCell(id, { field: 'status', column: to }).then(failed => {
      if (!failed) return;
      setUndo(u => (u?.id === id && u.to === to ? null : u));
      setBanner(`「${item.name}」${failed}`);
    });
  };
  const undoQuick = () => {
    const u = undo;
    setUndo(null);
    if (u) void editCell(u.id, { field: 'status', column: u.from }).then(failed => { if (failed) setBanner(`「${u.name}」${failed}`); });
  };
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(u => (u === undo ? null : u)), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);
  const onSwipe = (item: Requirement, e: SwipeAction, at: { x: number; y: number }) => {
    if (e === 'more') { openMenuAt(item, at.x, at.y); return; }
    quickStatus(item.id, e);
  };
  // 只有手机(窄屏 + 触屏)能左滑;只读的卡 swipeActions 为空,不挂手势。
  const swipeable = narrow && !pointer;
  const swipeWrap = (item: Requirement, node: ReactNode, style: object | undefined, background: string) => (swipeable ? (
    <TaskSwipeRow key={item.id} id={item.id} actions={swipeActions(item)} open={swipeOpen === item.id} onOpenChange={o => setSwipeOpen(cur => (o ? item.id : cur === item.id ? null : cur))}
      onAction={(a, at) => onSwipe(item, a, at)} background={background} style={style}>{node}</TaskSwipeRow>
  ) : node);
  // 卡片上的参与人头像:能改 = 设置参与人;不能改 = 打开详情(和点卡片一样)。
  const onParticipants = (item: Requirement) => (canAssignPeople(item) ? (stack?: any) => { void openAssign(item.id, 'participants', stack); } : () => openDetail(item.id));

  // ── 视图 ──
  // 搜索先挑、筛选再筛(两个都是逐行判断,顺序不影响结果);列表 / 看板 / 甘特图都只从这两个取。
  const terms = useMemo(() => searchTerms(search.q), [search.q]);
  const searched = useMemo(() => searchedTasks(items, archived, search, { people, projects }, extraHits), [items, archived, search, people, projects, extraHits]);
  const visible = useMemo(() => applyFilter(searched, filter), [searched, filter]);
  const columns = useMemo(() => boardColumns(searched, filter), [searched, filter]);
  // 收起的「废弃」:看板上的折叠列 / 列表底部的「显示」开关都用这个数(与展开后看到的张数同源)。
  const abandonedHidden = useMemo(() => hiddenAbandonedCount(searched, filter), [searched, filter]);
  const showAbandoned = abandonedShown(filter);
  // 搜索只命中了废弃的卡:「全部」默认把它们藏起来,visible 是空的。这时不能画「没找到」(展开入口在列表 / 看板上)。
  const searchBlockedByAbandoned = abandonedOk && terms.length > 0 && visible.length === 0 && abandonedHidden > 0;
  const setShowAbandoned = (on: boolean) => setTaskFilter({ ...filter, showAbandoned: on, statuses: on ? filter.statuses : (filter.statuses ?? []).filter(c => c !== 'abandoned') });
  // 状态筛选把列变少了:手机分页别停在已经不存在的那一页上。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const last = Math.max(0, columns.length - 1); if (page > last) { setPage(last); pagerRef.current?.scrollTo({ x: last * pageWidth, animated: false }); } }, [columns.length]);
  const owners = useMemo(() => ownerCounts(items, people), [items, people, language]);
  const draggingItem = dragView.phase === 'dragging' ? items.find(row => row.id === dragView.id) || null : null;
  const listRows = useMemo(() => sortRows(visible, sort, people, projects ?? []), [visible, sort, people, projects]);
  // Bound mounted rows without changing the existing loaded-data/filter/count contract.
  const listQueryKey = JSON.stringify([scope, filter, sort, search.q, search.archived, narrow]);
  const orderedListRows = useMemo(() => narrow ? columns.flatMap(col => col.items) : listRows, [narrow, columns, listRows]);
  const listWindow = taskListPage(orderedListRows.length, listPaging.key === listQueryKey ? listPaging.page : 0);
  const pageRows = useMemo(() => orderedListRows.slice(listWindow.start, listWindow.end), [orderedListRows, listWindow.start, listWindow.end]);
  const pageColumns = useMemo(() => {
    const ids = new Set(pageRows.map(row => row.id));
    return columns.map(col => ({ ...col, matchedCount: col.items.length, items: col.items.filter(item => ids.has(item.id)) })).filter(col => col.items.length);
  }, [columns, pageRows]);
  useEffect(() => {
    setListPaging(current => current.key !== listQueryKey || current.page !== listWindow.page ? { key: listQueryKey, page: listWindow.page } : current);
    listScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [listQueryKey, listWindow.page]);
  // Shift 单击连选按「当前显示的顺序」:列表按排序后的行,看板按 需求池 → 进行中 → 完成 各列从上到下。
  const order = useMemo(() => (section === 'list' ? pageRows.map(r => r.id) : columns.flatMap(c => c.items.map(i => i.id))), [section, pageRows, columns]);
  useEffect(() => { setSel(cur => pruneSelection(cur, items.map(i => i.id))); }, [items]);
  useEffect(() => { setSel(NO_SELECTION); }, [section, scope]);
  const onCardPress = (id: string, e?: { nativeEvent?: any }) => {
    const n = e?.nativeEvent ?? {};
    const m = { toggle: !!(n.ctrlKey || n.metaKey), range: !!n.shiftKey };
    if (pointer && isSelectClick(m)) { setSel(cur => selectClick(cur, id, m, order)); return; }
    openDetail(id);
  };
  const setProject = async (id: string, projectId: string | null) => {
    const failed = await saveEdit(id, { project_id: projectId });
    if (failed) setBanner(failed);
  };
  const applyBulk = async (kind: BulkKind, value: string | null, ids: readonly string[] = sel.ids) => {
    lastBulk.current = { kind, value };
    // 指派负责人:我不能改的卡(只读 / 旧 Hub)不发请求,直接跳过,数出来显示在条上。
    const plan = kind === 'owner' ? bulkOwnerPlan(items, ids) : { editable: [...ids], skipped: 0 };
    const targets = plan.editable.map(id => items.find(i => i.id === id)).filter((i): i is Requirement => !!i).map(i => ({ id: i.id, name: i.name }));
    const result = await runBulk(targets, async id => {
      const cur = items.find(i => i.id === id);
      const blocked = readOnlyBlock(id, kind === 'status' ? 'column' : undefined);
      if (blocked) throw new Error(blocked);
      if (kind === 'status') {
        if (!cur || cur.column === value) return;
        const updated = await track(() => moveRequirementOnHub(cfg, id, value as ReqColumn));
        updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
        return;
      }
      if (kind === 'owner') {
        const [k, ...rest] = (value ?? '').split(':');
        const change = cur && ownerChange(cur, value ? [{ kind: k as 'user' | 'node', id: rest.join(':') }] : []);
        if (!change) return;
        const failed = await assign(id, change);
        if (failed) throw new Error(failed);
        return;
      }
      if (kind === 'project' && cur && (cur.projectId ?? null) === value) return;
      const patch: EditPatch = kind === 'project' ? { project_id: value } : { agent_owner: value ? { kind: 'node', id: value } : null };
      const updated = await track(() => updateRequirementOnHub(cfg, id, patch));
      updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
    }, p => setBulk({ ...p, skipped: plan.skipped }));
    // 没改成的留在选择里(可以直接「重试」);都成了就清掉选择。
    setSel(result.failed.length ? { ids: result.failed.map(f => f.id), anchor: null } : NO_SELECTION);
    setAnnounce(tr('bulk.done', { n: result.total - result.failed.length }));
  };
  useEffect(() => {
    if (!bulk || bulk.running || bulk.failed.length) return;
    const t = setTimeout(() => setBulk(null), 2500);
    return () => clearTimeout(t);
  }, [bulk]);
  // Esc 取消选择(没有打开详情 / 菜单时)。
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!pointer || !sel.ids.length || !doc?.addEventListener) return;
    const onKey = (e: any) => { if (e.key === 'Escape' && !selectedId && !bulkMenu && !menu && !draft) { setSel(NO_SELECTION); setBulk(b => (b?.running ? b : null)); } };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [pointer, sel.ids.length, selectedId, bulkMenu, menu, draft]);
  // 桌面:「/」或 ⌘/Ctrl+K(设置 → 快捷键里「搜索」那一条的组合)聚焦任务搜索框(派发记录、新建对话框、
  // 「在新窗口打开」的整窗里不接)。window 捕获阶段 + preventDefault:App.tsx 的全局快捷键(document 捕获阶段)
  // 见 defaultPrevented 就不再把 ⌘K 当「搜索会话」切去 Agents —— 在任务页上 ⌘K 搜的是任务。
  const searchKeys = pointer && !single && section !== 'dispatch' && !draft;
  useEffect(() => {
    const win = (globalThis as any).window;
    if (!searchKeys || !win?.addEventListener) return;
    const mac = isMacKeyboard();
    const onKey = (e: any) => {
      if (e.defaultPrevented || e.isComposing || shortcutCaptureActive()) return;
      const nav = shortcutForCombo(shortcutBindings(), comboFromEvent(e, mac)) === 'nav.search';
      if (!isSearchShortcut(e, focusKindOf(e.target), nav)) return;
      e.preventDefault();
      setSearchOpen(true);
      searchRef.current?.focus?.();
    };
    win.addEventListener('keydown', onKey, true);
    return () => win.removeEventListener('keydown', onKey, true);
  }, [searchKeys]);
  const openBulkMenu = async (kind: BulkKind) => {
    if ((kind === 'agent' || kind === 'owner') && !(await loadPeople()) && !people.length) return;
    const el = bulkRefs.current[kind];
    const done = (x: number, y: number, w: number, h: number) => setBulkMenu({ kind, anchor: { x, y, w, h } });
    if (el?.measureInWindow) el.measureInWindow(done);
    else done(spacing.xl, 400, 200, 32);
  };

  const sections: { key: TaskSection; label: string }[] = [
    { key: 'list', label: tr('tasks.copy.26') },
    { key: 'board', label: tr('tasks.copy.27') },
    // 甘特图(只读):桌面 = 时间轴,手机 = 按周列表(TaskGantt.tsx 顶部写了为什么)。
    { key: 'gantt', label: tr('gantt.view') },
    // 日历(只读):桌面 = 月 / 周格子,手机 = 月历 + 选中那天的列表(TaskCalendar.tsx 顶部写了为什么)。
    { key: 'calendar', label: tr('cal.view') },
    // 仪表盘(只读):大数字 + 最近完成 + 图 + 分享图(TaskDashboard.tsx 顶部写了为什么)。
    { key: 'dashboard', label: tr('dash.view') },
    // 动态(只读):谁在什么时候改了哪张卡的什么(TaskActivity.tsx 顶部写了为什么)。旧 Hub 不记改动,不给这个视图。
    ...(eventsCapable ? [{ key: 'activity' as const, label: tr('act.view') }] : []),
    // 桌面的派发记录在左栏(TaskFilterSidebar);手机 / 双栏没有左栏,放在分段里。
    ...(desktop ? [] : [{ key: 'dispatch' as const, label: tr('tasks.copy.28') }]),
  ];
  const ownerChipLabel = filter.owners.length === 0 ? tr('tasks.copy.15')
    : filter.owners.length === 1 ? (owners.find(o => o.key === filter.owners[0])?.name || (filter.owners[0] === UNASSIGNED ? tr('tasks.copy.6') : keyName(filter.owners[0], people)))
      : tr('tasks.copy.29', { v0: filter.owners.length });
  const projectById = new Map((projects ?? []).map(p => [p.id, p]));
  const selectedProject = filter.project && filter.project !== NO_PROJECT ? projectById.get(filter.project) : undefined;
  const projectChipLabel = !filter.project ? tr('tasks.copy.30') : filter.project === NO_PROJECT ? tr('tasks.copy.31') : selectedProject?.name || tr('tasks.copy.30');
  const counts = useMemo(() => projectCounts(items, filter), [items, filter]);
  const priorityChipLabel = filter.priorities.length === 0 ? tr('tasks.copy.32') : REQ_PRIORITIES.filter(p => filter.priorities.includes(p)).map(p => filter.priorities.length === 1 ? priorityLabel(p) : PRIORITY_CODE[p]).join('、');
  const statuses = filter.statuses ?? [];
  const statusChipLabel = statuses.length === 0 ? tr('tasks.filterStatus') : REQ_COLUMNS.filter(c => statuses.includes(c)).map(c => taskText(REQ_COLUMN_LABEL[c])).join('、');
  const chipRefs = useRef<Record<string, any>>({});
  const openFilter = (kind: FilterKind) => {
    const el = chipRefs.current[kind];
    const done = (x: number, y: number, h: number) => setFilterMenu({ kind, x, y: y + h + 4 });
    if (el?.measureInWindow) el.measureInWindow((x: number, y: number, _w: number, h: number) => done(x, y, h));
    else done(spacing.xl, 64, 0);
  };
  // 「我负责 / 我参与」要知道我是谁(meId);「我参与」只在认识参与人的 Hub 上出现(同新建里的参与人一栏)。
  const participantsKnown = twoRoles || items.some(item => item.participants !== undefined);
  const quickFilters: { key: QuickFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    ...(meId ? [{ key: 'mine' as const, label: tr('tasks.quickMine'), icon: 'person-outline' as const }] : []),
    ...(meId && participantsKnown ? [{ key: 'participating' as const, label: tr('tasks.quickParticipating'), icon: 'people-circle-outline' as const }] : []),
    { key: 'overdue', label: tr('tasks.quickOverdue'), icon: 'alert-circle-outline' },
  ];
  // 仪表盘不看筛选(统计的是整个网络里看得见的任务),也不在那里新建。
  // 动态有自己的筛选(项目 / 成员 / 类型,作用在事件上),不用看板这一套。
  const filters = section === 'dispatch' || section === 'dashboard' || section === 'activity' ? null : (
    <>
      {!desktop ? <TaskTagFilter /> : null}
      {/* 快捷筛选(#493):我负责 / 我参与 / 已逾期。开关胶囊,与下面的下拉筛选同高同行;桌面在工具栏、手机在横向滑动的筛选行(同一个 filters)。 */}
      {quickFilters.map(q => (
        <QuickChip
          key={q.key}
          s={s}
          label={q.label}
          icon={q.icon}
          on={quickFilterOn(filter, q.key, meId)}
          onPress={() => setTaskFilter(toggleQuickFilter(filter, q.key, meId))}
          testID={`task-quick-${q.key}`}
          accessibilityLabel={tr('tasks.quickA11y', { v0: q.label })}
        />
      ))}
      <View ref={(r: any) => { chipRefs.current.owner = r; }} collapsable={false}>
        <Chip
          s={s}
          label={ownerChipLabel}
          on={filter.owners.length > 0}
          onPress={() => openFilter('owner')}
          testID="task-filter-owner"
          accessibilityLabel={tr('tasks.copy.33', { v0: filter.owners.length ? ownerChipLabel : tr('tasks.copy.34') })}
          leading={filter.owners.length ? <AvatarStack keys={filter.owners} owners={owners} /> : <Ionicons name="people-outline" size={14} color={colors.textMuted} />}
        />
      </View>
      <View ref={(r: any) => { chipRefs.current.priority = r; }} collapsable={false}>
        <Chip
          s={s}
          label={priorityChipLabel}
          on={filter.priorities.length > 0}
          onPress={() => openFilter('priority')}
          testID="task-filter-priority"
          accessibilityLabel={tr('tasks.copy.35', { v0: filter.priorities.length ? priorityChipLabel : tr('tasks.copy.34') })}
          leading={filter.priorities.length === 1 ? <PriorityDot p={filter.priorities[0]} s={s} /> : <Ionicons name="flag-outline" size={14} color={colors.textMuted} />}
        />
      </View>
      {subCaps ? (
        // 只看顶层 / 全部:列表和看板一起生效。
        <Segmented s={s} items={[{ key: 'all', label: tr('tasks.copy.34') }, { key: 'top', label: tr('tasks.copy.36') }]} value={filter.topLevel ? 'top' : 'all'} onChange={k => setTaskFilter({ ...filter, topLevel: k === 'top' })} testID="task-scope" />
      ) : null}
      {projects ? (
        <View ref={(r: any) => { chipRefs.current.project = r; }} collapsable={false}>
          <Chip
            s={s}
            label={projectChipLabel}
            on={!!filter.project}
            onPress={() => openFilter('project')}
            testID="task-filter-project"
            accessibilityLabel={tr('tasks.copy.37', { v0: filter.project ? projectChipLabel : tr('tasks.copy.34') })}
            leading={selectedProject ? <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: selectedProject.color }} /> : <Ionicons name="folder-outline" size={14} color={colors.textMuted} />}
          />
        </View>
      ) : null}
      <View ref={(r: any) => { chipRefs.current.status = r; }} collapsable={false}>
        <Chip
          s={s}
          label={statusChipLabel}
          on={statuses.length > 0}
          onPress={() => openFilter('status')}
          testID="task-filter-status"
          accessibilityLabel={tr('tasks.filterStatusA11y', { v0: statuses.length ? statusChipLabel : tr('tasks.copy.34') })}
          leading={statuses.length === 1 ? <View style={[s.columnDot, { backgroundColor: STATUS_TONE[statuses[0]]() }]} /> : <Ionicons name="ellipse-outline" size={14} color={colors.textMuted} />}
        />
      </View>
      {filterActive(filter) ? (
        <Pressable accessibilityRole="button" onPress={() => setTaskFilter({ owners: [], priorities: [], project: '', statuses: [], topLevel: filter.topLevel })} style={[s.iconButton, { width: 'auto', flexShrink: 0, paddingHorizontal: spacing.sm }]} testID="task-filter-clear">
          <Text style={s.link} numberOfLines={1}>{tr('tasks.copy.38')}</Text>
        </Pressable>
      ) : null}
    </>
  );
  const newButton = section === 'dispatch' || section === 'dashboard' ? null : narrow ? (
    <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.39')} onPress={() => setDraft(draftFor('pool'))} style={[s.primary, { width: 32, paddingHorizontal: 0, justifyContent: 'center' }]} testID="req-new">
      <Ionicons name="add" size={20} color={colors.onAccent} />
    </Pressable>
  ) : (
    <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.39')} onPress={() => setDraft(draftFor('pool'))} style={s.primary} testID="req-new">
      <Ionicons name="add" size={16} color={colors.onAccent} />
      <Text style={s.primaryText}>{tr('tasks.copy.40')}</Text>
    </Pressable>
  );

  // 搜索:桌面宽窗口 = 工具栏里常驻的搜索框;触屏(手机 / 平板)和桌面窄窗口 = 放大镜,点开成搜索条 + 「取消」。
  const canSearch = section !== 'dispatch' && section !== 'dashboard' && section !== 'activity';
  const inlineSearch = canSearch && pointer && !narrow;
  const closeSearch = () => { clearSearch(); setSearchOpen(false); };
  const searchField = (style: object, autoFocus: boolean) => (
    <SearchField
      ref={searchRef}
      value={searchText}
      onChangeText={setSearchText}
      onClear={clearSearch}
      onEscapeEmpty={() => (inlineSearch ? searchRef.current?.blur?.() : setSearchOpen(false))}
      archivedCapable={archivedCapable}
      includeArchived={search.archived}
      onToggleArchived={() => setTaskSearch({ q: searchText, archived: !search.archived })}
      touch={!pointer}
      autoFocus={autoFocus}
      style={style}
      testID="task-search"
    />
  );
  // 头部一行的筛选放得下吗:筛选条的内容宽(横向 ScrollView 报的)+ 同一行其余控件的宽 ≤ 头部宽。
  // 两种摆法里筛选条都是同一个横向 ScrollView ⇒ 内容宽一直量得到,窗口拉宽后能挪回一行。
  const SEARCH_BOX_W = 200;
  const [filtersW, setFiltersW] = useState(0);
  // 标题 + 分段 + 搜索 + 新建 + 左右留白 + 四个间隙:筛选以外这一行要占的宽(各自 onLayout 量出来,不按字数估)。
  const [fixedParts, setFixedParts] = useState<{ title: number; seg: number; new: number }>({ title: 0, seg: 0, new: 0 });
  const measureFixed = (k: 'title' | 'seg' | 'new', w: number) => setFixedParts(p => (Math.abs(p[k] - w) < 0.5 ? p : { ...p, [k]: w }));
  const fixedW = fixedParts.title && fixedParts.seg ? fixedParts.title + fixedParts.seg + fixedParts.new + (inlineSearch ? SEARCH_BOX_W : canSearch ? CONTROL_H : 0) + spacing.md * 4 + spacing.xl * 2 : 0;
  const filtersInline = !filters || !filtersW || !fixedW || filtersW + fixedW + spacing.md <= width;
  const filterStrip = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={filtersInline ? { flex: 1, minWidth: 0 } : { flexGrow: 0 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }} onContentSizeChange={w => setFiltersW(Math.ceil(w))} testID="task-header-filters">
      {filters}
    </ScrollView>
  );
  const searchButton = canSearch && !inlineSearch ? <SearchIconButton s={s} active={searchOpen || !!terms.length} onPress={() => setSearchOpen(o => !o)} /> : null;

  const header = narrow ? (
    <View onLayout={e => setHeaderBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      {canSearch && searchOpen ? (
        // 手机:搜索条占掉标题这一行(微信);分段和筛选还在下面,搜索和筛选叠加。
        <View style={[s.header, s.headerPhone]} testID="task-header">
          {searchField({ flex: 1 }, !searchText)}
          <SearchCancel onPress={closeSearch} />
        </View>
      ) : (
        <View style={[s.header, s.headerPhone]} testID="task-header">
          <Text style={s.pageTitle} accessibilityRole="header">{tr('tasks.copy.41')}</Text>
          <View style={s.spacer} />
          {searchButton}
          {newButton}
        </View>
      )}
      {/* 视图多到一行放不下(加了「动态」之后手机上 7 个):横向滑,不把页面撑出横向滚动条。 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }} testID="tasks-view-scroll">
        <Segmented s={s} items={sections} value={section} onChange={setTaskSection} testID="tasks-view" />
      </ScrollView>
      {filters ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRowPhone} contentContainerStyle={s.filterRowPhoneContent}>{filters}</ScrollView>
      ) : null}
    </View>
  ) : (
    <View onLayout={e => setHeaderBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      <View style={s.header} testID="task-header">
        <Text style={[s.pageTitle, { flexShrink: 0 }]} numberOfLines={1} accessibilityRole="header" onLayout={e => measureFixed('title', e.nativeEvent.layout.width)}>{tr('tasks.copy.41')}</Text>
        <View style={{ flexShrink: 0 }} onLayout={e => measureFixed('seg', e.nativeEvent.layout.width)}><Segmented s={s} items={sections} value={section} onChange={setTaskSection} testID="tasks-view" /></View>
        {filtersInline ? filterStrip : <View style={s.spacer} />}
        {inlineSearch ? searchField({ width: SEARCH_BOX_W, flexShrink: 0 }, false) : searchButton}
        <View style={{ flexShrink: 0 }} onLayout={e => measureFixed('new', e.nativeEvent.layout.width)}>{newButton}</View>
      </View>
      {/* 筛选和标题 / 分段 / 搜索 / 新建一行放不下(桌面窄窗口、平板横屏 ~1000 宽)就整行挪到标题栏下面,
          而不是在头部那一小格里横向滚动、把「状态」藏到看不见的地方(owner 09-30 平板截图)。 */}
      {filters && !filtersInline ? <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.sm }} testID="task-header-filters-row">{filterStrip}</View> : null}
      {canSearch && !inlineSearch && searchOpen ? (
        // 平板(触屏宽屏):标题栏不动,搜索条展开在它下面一整行,右边「取消」。
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm }} testID="task-search-row">
          {searchField({ flex: 1 }, !searchText)}
          <SearchCancel onPress={closeSearch} />
        </View>
      ) : null}
    </View>
  );

  // 桌面列宽(内容宽 - 两侧 24 - 列间 16 的间隙)/ 列数(按状态筛了会少于三列);窄于 260 时卡片上的负责人只显示头像。
  const compactCards = !narrow && (width - spacing.xl * 2 - spacing.lg * (columns.length - 1)) / Math.max(1, columns.length) < 260;
  const card = (item: Requirement) => {
    const isDragged = draggingItem?.id === item.id;
    return swipeWrap(item, (
      <Pressable
        key={item.id}
        testID={`req-card-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={tr('tasks.copy.42', { v0: item.name, v1: priorityLabel(item.priority), v2: ownerLabel(item, people) })}
        accessibilityHint={pointer ? tr('tasks.copy.43') : tr('tasks.copy.44')}
        {...a11yState({ selected: sel.ids.includes(item.id) })}
        onPress={e => onCardPress(item.id, e)}
        onLongPress={pointer ? undefined : e => openMenuAt(item, e.nativeEvent.pageX, e.nativeEvent.pageY)}
        delayLongPress={350}
        style={state => [s.card, ((state as { hovered?: boolean }).hovered || state.pressed) && s.cardHover, isDragged && s.cardDragging, sel.ids.includes(item.id) && s.cardSelected, pointer && ({ cursor: canEditTaskField(item, 'column') ? 'grab' : 'pointer' } as object)]}
        // 改不了状态的卡不带 taskFrom:task-board-dom 只从带 data-task-from 的卡开始拖(参与人的卡能拖)。
        {...({ dataSet: canEditTaskField(item, 'column') ? { taskCard: item.id, taskFrom: item.column } : { taskCard: item.id } } as object)}
      >
        {projects && item.projectId ? <ProjectChip project={projectById.get(item.projectId)} s={s} small /> : null}
        <Text style={[s.cardTitle, isClosedColumn(item.column) && s.cardDone]} numberOfLines={2}>{highlight(titleText(item), terms)}</Text>
        {item.archived ? <ArchivedTag /> : null}
        {item.readOnly ? <ReadOnlyTag editFields={item.editFields} /> : null}
        <ParentLine item={item} items={items} />
        <CardMeta item={item} people={people} today={today} s={s} compact={compactCards} />
        <CardFooter item={item} people={people} s={s} touch={!pointer} onParticipants={onParticipants(item)} canAssign={canAssignPeople(item)} meId={meId} />
        {/* 最近动静(#506):最下面一行弱化的小字;卡片 gap 10 对它收到 6,只多一行 16 高。 */}
        <View style={{ marginTop: -4 }}><CardActivityLine item={item} people={people} s={s} preview={!!desktop} /></View>
        {moveErrors[item.id] ? <Text style={s.err} numberOfLines={1}>{moveErrors[item.id]}</Text> : null}
      </Pressable>
    ), { borderRadius: BOARD_RADIUS.card }, cardBg());
  };

  const kanban = () => {
    const over = dragView.phase === 'dragging' && dragView.over !== dragView.from ? dragView.over : null;
    const renderColumn = (col: (typeof columns)[number]) => {
      const isOver = over === col.column;
      const at = isOver && draggingItem ? dropIndex(col.items, draggingItem, col.column) : -1;
      const quick = quickAdd?.column === col.column ? quickAdd : null;
      return (
        <View
          key={col.column}
          style={[layout.mode === 'paged' ? s.columnPaged : s.column, isOver && s.columnOver]}
          testID={`req-col-${col.column}`}
          {...({ dataSet: { taskColumn: col.column } } as object)}
        >
          <View style={s.columnHead}>
            <View style={[s.columnDot, { backgroundColor: STATUS_TONE[col.column]() }]} />
            <Text style={[s.columnName, statusCapsuleText(col.column, col.column === 'abandoned' ? colors.textMuted : colors.text)]}>{taskText(REQ_COLUMN_LABEL[col.column])}</Text>
            <View style={s.countPill} testID={`req-count-${col.column}`}><Text style={s.countText}>{col.items.length}</Text></View>
            {col.column === 'abandoned' && filter.showAbandoned && !statuses.includes('abandoned') ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr('abandoned.collapse')}
                onPress={() => setShowAbandoned(false)}
                hitSlop={6}
                style={state => [s.abandonedCollapse, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
                testID="req-abandoned-collapse"
              >
                <Ionicons name={layout.mode === 'paged' ? 'eye-off-outline' : 'chevron-forward'} size={14} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView style={s.columnBody} contentContainerStyle={s.columnBodyContent}>
            {col.items.length === 0 && at < 0 ? (
              <View style={s.columnEmpty} testID={`req-empty-${col.column}`}>
                <Text style={s.columnEmptyText}>{pointer ? tr('tasks.copy.45') : filterActive(filter) ? tr('tasks.copy.46') : tr('tasks.copy.8')}</Text>
              </View>
            ) : null}
            {col.items.map((item, i) => (
              <View key={item.id}>
                {i === at ? <View style={[s.dropLine, { marginBottom: spacing.sm }]} testID="req-drop-indicator" /> : null}
                {card(item)}
              </View>
            ))}
            {at >= 0 && at >= col.items.length ? <View style={s.dropLine} testID="req-drop-indicator" /> : null}
          </ScrollView>
          {col.column === 'abandoned' ? null : quick ? (
            <TextInput
              autoFocus
              value={quick.name}
              onChangeText={name => setQuickAdd({ column: col.column, name })}
              onSubmitEditing={() => {
                const name = quick.name.trim();
                if (!name) { setQuickAdd(null); return; }
                const d = { ...draftFor(col.column), name };
                setQuickAdd({ column: col.column, name: '' });
                void create(d).then(failed => { if (failed) { setBanner(failed); setQuickAdd({ column: col.column, name }); } });
              }}
              onBlur={() => { if (!quick.name.trim()) setQuickAdd(null); }}
              onKeyPress={e => { if ((e.nativeEvent as { key?: string }).key === 'Escape') setQuickAdd(null); }}
              placeholder={tr('tasks.copy.47')}
              placeholderTextColor={colors.textMuted}
              style={s.quickAddInput}
              testID={`req-quick-input-${col.column}`}
              accessibilityLabel={tr('tasks.copy.48', { v0: taskText(REQ_COLUMN_LABEL[col.column]) })}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('tasks.copy.48', { v0: taskText(REQ_COLUMN_LABEL[col.column]) })}
              onPress={() => (pointer && !narrow ? setQuickAdd({ column: col.column, name: '' }) : setDraft(draftFor(col.column)))}
              style={state => [s.quickAdd, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
              testID={`req-quick-add-${col.column}`}
            >
              <Ionicons name="add" size={16} color={colors.textSecondary} />
              <Text style={s.quickAddText}>{tr('tasks.copy.49')}</Text>
            </Pressable>
          )}
        </View>
      );
    };
    if (layout.mode === 'paged') {
      // 手机:一列一屏。页宽 = 看板宽(数值),列宽 = 页宽 − 两侧留白;上面一排胶囊标出当前是哪一列,点了跳过去。
      const { pageWidth: pw, columnWidth, gutter } = layout;
      const goTo = (i: number) => { setPage(i); pagerRef.current?.scrollTo({ x: i * pw, animated: true }); };
      return (
        <View style={{ flex: 1 }}>
          {/* 四格(需求池 / 进行中 / 完成 / 废弃)在 320–390 宽的手机上放不下,横向滚,不把最后一格挤出屏幕。 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={[s.pager, { flexGrow: 1 }]} accessibilityRole="tablist" testID="req-pager">
            {columns.map((col, i) => {
              const on = i === page;
              return (
                <Pressable key={col.column} accessibilityRole="tab" {...a11yState({ selected: on })} onPress={() => goTo(i)} style={[s.pagerTab, on && s.pagerTabOn, { flexShrink: 0 }]} testID={`req-page-tab-${col.column}`}>
                  <View style={[s.columnDot, { backgroundColor: STATUS_TONE[col.column]() }]} />
                  <Text style={[s.pagerText, on && col.column !== 'abandoned' && s.pagerTextOn, statusCapsuleText(col.column, col.column === 'abandoned' ? colors.textMuted : (on ? colors.text : colors.textSecondary))]} numberOfLines={1}>{taskText(REQ_COLUMN_LABEL[col.column])}</Text>
                  <Text style={s.countText}>{col.items.length}</Text>
                </Pressable>
              );
            })}
            {abandonedOk && abandonedHidden > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={tr('abandoned.expandA11y', { n: abandonedHidden })} onPress={() => { setShowAbandoned(true); setTimeout(() => goTo(columns.length), 0); }} style={[s.pagerTab, s.abandonedTab, { flexShrink: 0 }]} testID="req-page-tab-abandoned-collapsed">
                <View style={[s.columnDot, { backgroundColor: STATUS_TONE.abandoned() }]} />
                <Text style={[s.pagerText, statusCapsuleText('abandoned', colors.textMuted)]} numberOfLines={1}>{taskText(REQ_COLUMN_LABEL.abandoned)}</Text>
                <Text style={s.countText}>{abandonedHidden}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
          {/* paged-board:start —— 这段里只用数值宽度(task-board-layout.test.ts 静态检查)。 */}
          <ScrollView
            ref={pagerRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: page * pw, y: 0 }}
            snapToInterval={pw}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            scrollEventThrottle={16}
            onScroll={e => { const i = pageAt(e.nativeEvent.contentOffset.x, pw, columns.length); if (i !== page) setPage(i); }}
            style={{ flex: 1 }}
            contentContainerStyle={s.boardPaged}
            testID="req-board"
          >
            {columns.map(col => (
              <View key={col.column} style={{ width: pw, paddingHorizontal: gutter }} testID={`req-page-${col.column}`}>
                <View style={{ width: columnWidth, flexGrow: 1 }}>{renderColumn(col)}</View>
              </View>
            ))}
          </ScrollView>
          {/* paged-board:end */}
        </View>
      );
    }
    return (
      <View style={s.board} testID="req-board">
        {columns.map(renderColumn)}
        {abandonedOk && abandonedHidden > 0 ? (
          // 收起的「废弃」列(#724):默认收成一条窄栏,点开才铺成一整列。
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('abandoned.expandA11y', { n: abandonedHidden })}
            onPress={() => setShowAbandoned(true)}
            style={state => [s.abandonedRail, over === 'abandoned' && s.columnOver, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
            testID="req-col-abandoned-collapsed"
            {...({ dataSet: { taskColumn: 'abandoned' } } as object)}
          >
            <Ionicons name="chevron-back" size={14} color={colors.textMuted} />
            <View style={[s.columnDot, { backgroundColor: STATUS_TONE.abandoned() }]} />
            <View style={s.countPill}><Text style={s.countText}>{abandonedHidden}</Text></View>
            <Text style={[s.abandonedRailText, statusCapsuleText('abandoned', colors.textMuted)]}>{taskText(REQ_COLUMN_LABEL.abandoned)}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  // 列表底部:「全部」默认不含废弃,这里给一个显示 / 隐藏的开关(带被藏起来的张数)。
  const abandonedToggle = () => (abandonedOk && (abandonedHidden > 0 || (filter.showAbandoned && !statuses.includes('abandoned'))) ? (
    <Pressable
      accessibilityRole="button"
      onPress={() => setShowAbandoned(!filter.showAbandoned)}
      style={state => [s.abandonedToggle, narrow && { paddingHorizontal: spacing.lg + spacing.xs }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
      testID="req-abandoned-toggle"
    >
      <Ionicons name={filter.showAbandoned ? 'eye-off-outline' : 'trash-bin-outline'} size={14} color={colors.textMuted} />
      <Text style={s.metaMuted}>{filter.showAbandoned ? tr('abandoned.hideList') : tr('abandoned.showList', { n: abandonedHidden })}</Text>
    </Pressable>
  ) : null);

  const list = () => {
    const pager = <TaskListPager page={listWindow} onPage={page => setListPaging({ key: listQueryKey, page })} partial={truncated || (serverCurrent && !!serverHits.next)} />;
    if (narrow) {
      // 手机:按状态分组的列表。
      return (
        <View style={{ flex: 1, minHeight: 0 }}><ScrollView ref={listScrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xl }} testID="req-list">
          {!pageRows.length ? <Text style={[s.muted, { padding: spacing.lg }]}>{tr(filterActive(filter) ? 'tasks.copy.46' : 'tasks.copy.55')}</Text> : null}
          {pageColumns.map(col => (
            <View key={col.column} testID={`req-group-${col.column}`}>
              <View style={s.groupHead}>
                <View style={[s.columnDot, { backgroundColor: STATUS_TONE[col.column]() }]} />
                <Text style={[s.columnName, statusCapsuleText(col.column, col.column === 'abandoned' ? colors.textMuted : colors.text)]}>{taskText(REQ_COLUMN_LABEL[col.column])}</Text>
                <View style={s.countPill}><Text style={s.countText}>{col.matchedCount}</Text></View>
              </View>
              {col.items.length ? (
                <View style={s.groupList}>
                  {col.items.map((item, i) => swipeWrap(item, (
                    <Pressable
                      key={item.id}
                      testID={`req-row-${item.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={item.name}
                      onPress={() => openDetail(item.id)}
                      onLongPress={pointer ? undefined : e => openMenuAt(item, e.nativeEvent.pageX, e.nativeEvent.pageY)}
                      style={state => [s.phoneRow, i === col.items.length - 1 && { borderBottomWidth: 0 }, state.pressed && { backgroundColor: colors.rowHover }]}
                    >
                      {projects && item.projectId ? <ProjectChip project={projectById.get(item.projectId)} s={s} small /> : null}
                      <Text style={[s.cardTitle, isClosedColumn(item.column) && s.cardDone]} numberOfLines={2}>{highlight(titleText(item), terms)}</Text>
        {item.archived ? <ArchivedTag /> : null}
                      <ParentLine item={item} items={items} />
                      <CardMeta item={item} people={people} today={today} s={s} />
                      <CardFooter item={item} people={people} s={s} touch={!pointer} onParticipants={onParticipants(item)} canAssign={canAssignPeople(item)} meId={meId} compact />
                      <CardActivityLine item={item} people={people} s={s} />
                    </Pressable>
                  ), undefined, cardBg()))}
                </View>
              ) : <Text style={[s.muted, { paddingHorizontal: spacing.lg + spacing.xs }]}>{tr('tasks.copy.8')}</Text>}
            </View>
          ))}
          {abandonedToggle()}
        </ScrollView>{pager}</View>
      );
    }
    const rows = pageRows;
    return <View style={{ flex: 1, minHeight: 0 }}><TaskListTable rows={rows} pageKey={`${listQueryKey}:${listWindow.page}`} terms={terms} people={people} projects={projects} sort={sort} setSort={setSort} s={s} today={today} selectedId={selectedId} onOpen={openDetail} touch={!pointer} onMenu={openMenuAt} filtered={filterActive(filter)} needsUpdateUpgrade={items.some(item => item.updatedAt === undefined)} items={items}
      selection={pointer ? { ids: sel.ids, onToggle: id => setSel(cur => toggleSelected(cur, id)), onPress: (id, e) => onCardPress(id, e as { nativeEvent?: any }) } : undefined}
      onProject={(id, pid) => { void setProject(id, pid); }} seqCapable={seqCapable}
      edit={{ onEdit: editCell, onLoadPeople: () => { void loadPeople(); }, ctx: { people, peopleLoading, projects, networkId: cfg.networkId || '', twoRoles, lowestPriority, allowTime: dueDatetime, tagChoices: tagCatalog?.tags ?? [...new Set(items.flatMap(it => it.tags ?? []))], tagColors: tagCatalog?.colors } }} />{abandonedToggle()}{pager}</View>;
  };

  // 搜索时结果上方:数量 + 被筛选挡住了几个(一键清掉)+ 服务端的「加载更多」。
  const searchBar = terms.length && section !== 'dispatch' && section !== 'dashboard' && section !== 'activity' && phase !== 'loading' ? (
    <SearchStatusBar
      shown={visible.length}
      hidden={filterHiddenCount(searched, visible)}
      more={serverCurrent && !!serverHits.next}
      loading={serverCurrent && serverHits.loading}
      abandonedHidden={abandonedOk ? abandonedHidden : 0}
      onShowAbandoned={abandonedOk && abandonedHidden > 0 ? () => setShowAbandoned(true) : undefined}
      onClearFilters={() => setTaskFilter({ ...EMPTY_FILTER, project: '', statuses: [] })}
      onLoadMore={loadMoreHits}
      phone={narrow}
    />
  ) : null;
  const body = section === 'dispatch' ? dispatch ?? null
    : phase === 'loading' && !(hasCached || (mine && items.length)) ? <View style={s.center} testID="req-loading"><ActivityIndicator color={colors.accent} /></View>
      : phase === 'unsupported' ? <View style={s.center}><Text style={s.muted} testID="req-unsupported">{tr(UNSUPPORTED)}</Text></View>
        // 连不上但本机已有这块看板的上次数据:照常显示,不用一句错误把整页换掉(顶部横幅已说明是缓存)。
        : phase === 'error' && !(hasCached || (mine && items.length)) ? (
          <View style={s.center} testID="req-error">
            <Text style={s.err}>{hubError}</Text>
            {retrying
              ? <Text style={s.muted} testID="req-retrying">{tr('tasks.copy.56')}</Text>
              : <Pressable onPress={() => setReloadKey(n => n + 1)} testID="req-retry" accessibilityRole="button"><Text style={s.link}>{tr('tasks.copy.57')}</Text></Pressable>}
          </View>
        ) : section !== 'dashboard' && section !== 'activity' && terms.length && !visible.length && !searchBlockedByAbandoned ? <SearchEmpty q={search.q} s={s} filtered={filterActive(filter)} partial={truncated && !serverSearchCap} onClear={closeSearch} />
        : section === 'list' ? list()
          : section === 'calendar' ? <TaskCalendar items={visible} terms={terms} projects={projects} people={people} today={today} s={s} onOpen={openDetail} selectedId={selectedId} phone={narrow} onDue={pointer ? (id, due) => { void setDue(id, due); } : undefined} />
          : section === 'dashboard' ? <TaskDashboard cfg={cfg} items={items} projects={projects} people={people} s={s} phone={narrow} statsCapable={statsCapable} onOpen={openFromDashboard} />
          : section === 'activity' && eventsCapable ? <TaskActivity cfg={cfg} items={items} projects={projects} people={people} meId={meId} s={s} phone={narrow} onOpen={openFromDashboard} />
          : section === 'gantt' ? <TaskGantt items={visible} terms={terms} projects={projects} people={people} today={today} s={s} onOpen={openDetail} selectedId={selectedId} phone={narrow} startCapable={startCapable} onDue={pointer ? (id, due) => { void setDue(id, due); } : undefined} />
            : kanban();

  const ghost = pointer && draggingItem && dragView.phase === 'dragging' ? (
    <View
      pointerEvents="none"
      style={[s.card, s.ghost, { position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as 'absolute', left: dragView.x - grab.current.dx, top: dragView.y - grab.current.dy, width: grab.current.w, transform: [{ rotate: '1.5deg' }] }]}
      testID="req-drag-ghost"
    >
      <Text style={s.cardTitle} numberOfLines={2}>{draggingItem.name}</Text>
      <CardMeta item={draggingItem} people={people} today={today} s={s} />
    </View>
  ) : null;

  const tauriShell = Platform.OS === 'web' && !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  // 详情:抽屉 / 推入页 / 「在新窗口打开」的整窗(single)。
  const detail = (mode: 'drawer' | 'page' | 'window') => (selected ? (
        <TaskDetailPanel
          cfg={cfg}
          item={selected}
          readOnly={!!selected.readOnly}
          editFields={selected.editFields}
          items={items}
          onOpenRequirement={id => { setSelectedId(id); const next = items.find(i => i.id === id); if (single && next) single.onTitle?.(next.name); }}
          onCreateChild={parent => setDraft({ ...draftFor('pool'), parentId: parent.id, projectId: parent.projectId && !projects?.some(p => p.id === parent.projectId && p.canEdit === false) ? parent.projectId : (projects ? defaultProjectFor(filter, projects) : null) })}
          projects={projects}
          dueDatetime={dueDatetime}
          lowestPriority={lowestPriority}
          mode={mode}
          top={headerBottom}
          people={people}
          peopleLoading={peopleLoading}
          peopleError={peopleError}
          onLoadPeople={loadPeople}
          moving={movingIds.includes(selected.id)}
          moveError={moveErrors[selected.id] || ''}
          onMove={to => { void move(selected.id, to); }}
          onSave={patch => saveEdit(selected.id, patch)}
          onAssignmentsSaved={a => updateTaskItems(scope, rows => rows.map(row => (row.id === selected.id ? { ...row, ...a } : row)))}
          onAssign={change => assign(selected.id, change)}
          onClose={() => (single ? single.onClose() : setSelectedId(null))}
          onArchive={archivedCapable && !selected.readOnly && !single ? archived => { void setArchived(selected.id, archived); } : undefined}
          onFlush={(id, patch) => {
            const name = items.find(row => row.id === id)?.name ?? patch.name ?? '';
            void saveEdit(id, patch).then(failed => { if (failed) setBanner(`「${name}」${failed}`); });
          }}
          networkId={cfg.networkId}
          onOpenWindow={tauriShell && pointer && !single ? () => openTaskWindow({ taskId: selected.id, profileId: cfg.profileId, serverUrl: cfg.serverUrl, networkId: cfg.networkId, title: selected.name, at: Date.now() }) : undefined}
          pointer={pointer}
          onOpenVoiceSettings={onOpenVoiceSettings}
          checklistError={checklistErrors[selected.id] || ''}
          onChecklistToggle={(itemId, done) => { void toggleChecklist(selected.id, itemId, done); }}
          onChecklistAdd={text => {
            const next = addChecklistItem(selected.checklist ?? [], text);
            if (!next) return false;
            void replaceChecklist(selected.id, next);
            return true;
          }}
          onChecklistDelete={itemId => { void replaceChecklist(selected.id, removeChecklistItem(selected.checklist ?? [], itemId)); }}
          onChecklistMove={(from, to) => {
            const list = selected.checklist ?? [];
            const next = moveChecklistItem(list, from, to);
            if (next !== list) void replaceChecklist(selected.id, [...next]);
          }}
        />
  ) : null);
  const createDialog = (
      <TaskCreateDialog
        draft={draft}
        tagsCapable={tagsCapable}
        twoRoles={twoRoles}
        participantsCapable={twoRoles || items.some(item => item.participants !== undefined)}
        parentName={draft?.parentId ? items.find(i => i.id === draft.parentId)?.name ?? null : null}
        projects={projects}
        dueDatetime={dueDatetime}
        priorities={priorityOptions}
        pointer={pointer}
        sheet={!pointer && narrow}
        networkId={cfg.networkId || ''}
        people={people}
        peopleLoading={peopleLoading}
        peopleError={peopleError}
        onLoadPeople={loadPeople}
        onChange={setDraft}
        onSubmit={async () => {
          if (!draft) return null;
          const failed = await create(draft);
          if (!failed) setDraft(null);
          return failed;
        }}
        onClose={() => setDraft(null)}
      />
  );

  // 「管理项目 / 管理标签」写 Hub 的那两个处理函数;左栏右键菜单(#760)经 store 走同一对(registerManagerOps)。
  const updateProjectOp = async (id: string, patch: { name?: string; color?: string; archived?: boolean }): Promise<string | null> => {
    try {
      const updated = await updateProject(cfg, id, patch);
      const st = taskBoardState();
      patchTaskBoard(scope, { projects: (st.projects ?? []).map(p => (p.id === id ? updated : p)) });
      // 归档了正在筛的项目:退回「全部项目」
      if (updated.archived && st.filter.project === id) setTaskFilter({ ...st.filter, project: '' });
      return null;
    } catch (e) { return e instanceof Error ? e.message : tr('tasks.copy.59'); }
  };
  const tagOp = async (op: TagOp): Promise<string | null> => {
    try {
      await runTagOp(cfg, op);
      // Hub 已经整网改好了:本地卡片和目录按同一条规则先改,下一轮轮询再对齐。
      mutations.current++;
      updateTaskItems(scope, list => list.map(it => { const next = it.tags ? applyTagOp(it.tags, op) : null; return next ? { ...it, tags: next } : it; }));
      const st = taskBoardState();
      if (st.tagCatalog) patchTaskBoard(scope, { tagCatalog: applyTagOpToCatalog(st.tagCatalog, op) });
      // 正在筛的标签被改名 / 合并 / 删掉:筛选跟过去(删了就回到全部)。
      const cur = st.filter.tag;
      if (cur && op.op !== 'color' && (op.op === 'rename' ? op.from === cur : op.op === 'merge' ? op.from.includes(cur) : op.tag === cur)) setTaskFilter({ ...st.filter, tag: op.op === 'delete' ? '' : op.to });
      void fetchTagCatalog(cfg).then(cat => { if (cat) patchTaskBoard(scope, { tagCatalog: cat }); }).catch(() => {});
      return null;
    } catch (e) {
      if (e instanceof TagOpError && e.status === 404) void fetchTagCatalog(cfg).then(cat => { if (cat) patchTaskBoard(scope, { tagCatalog: cat }); }).catch(() => {});
      return e instanceof TagOpError ? e.key : 'tags.opFailed';
    }
  };
  managerOpsRef.current = { updateProject: updateProjectOp, tagOp };

  if (single) {
    return (
      <View style={{ flex: 1 }} testID="requirement-board-single" onLayout={e => setMeasured(e.nativeEvent.layout.width)}>
        {selected ? detail('window')
          : phase === 'loading' ? <View style={s.center}><ActivityIndicator color={colors.accent} /></View>
            : <View style={s.center}><Text style={s.muted} testID="task-window-missing">{phase === 'error' ? hubError : tr('taskWin.missing')}</Text></View>}
        {createDialog}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} testID="requirement-board" onLayout={e => setMeasured(e.nativeEvent.layout.width)}>
      {header}
      {banner ? (
        <View style={[s.banner, narrow && { marginHorizontal: spacing.lg }]} accessibilityRole="alert" testID="req-banner">
          <Ionicons name="alert-circle-outline" size={14} color={colors.failed} />
          <Text style={[s.err, { flex: 1 }]}>{banner}</Text>
          <Pressable onPress={() => setBanner('')} accessibilityRole="button" accessibilityLabel={tr('tasks.copy.58')}><Ionicons name="close" size={14} color={colors.textMuted} /></Pressable>
        </View>
      ) : null}
      {searchBar}
      {body}
      <Text style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} accessibilityLiveRegion="polite">{announce}</Text>
      {ghost}
      {selected && section !== 'dispatch' ? (drawer ? (
        <TaskDrawer taskId={selected.id} top={headerBottom} width={drawerWidth} boardWidth={width} onWidth={setDrawerWidth}>
          {detail('drawer')}
        </TaskDrawer>
      ) : detail('page')) : null}
      {createDialog}
      {projects ? (
        <TaskProjectManager
          open={managingProjects}
          sheet={!pointer && narrow}
          projects={projects}
          counts={new Map(Array.from(items.reduce((m, it) => (it.projectId ? m.set(it.projectId, (m.get(it.projectId) ?? 0) + 1) : m), new Map<string, number>())))}
          onCreate={async (name, color) => {
            try {
              const created = await createProject(cfg, { name, color });
              patchTaskBoard(scope, { projects: [...(projects ?? []), created] });
              return null;
            } catch (e) { return e instanceof Error ? e.message : tr('tasks.copy.59'); }
          }}
          onUpdate={updateProjectOp}
          focus={managerFocus}
          onClose={() => setManagingProjects(false)}
        />
      ) : null}
      {/* 手机没有左栏:长按筛选里的项目 / 标签出同一份菜单(#760);桌面的菜单挂在左栏。 */}
      {!desktop ? <TaskSideItemMenu /> : null}
      {tagCatalog && tagOpsAllowed ? (
        <TaskTagManager
          open={managingTags}
          sheet={!pointer && narrow}
          catalog={tagCatalog}
          onOp={tagOp}
          focus={managerFocus}
          onClose={() => setManagingTags(false)}
        />
      ) : null}
      {pointer && section !== 'dispatch' && (sel.ids.length || bulk) ? (
        <BulkBar
          count={sel.ids.length}
          bulk={bulk}
          canProject={!!projects}
          canAgent={twoRoles}
          canOwner={sel.ids.some(id => { const it = items.find(i => i.id === id); return !!it && assignAccess(it) !== 'hidden'; })}
          ownerEditable={bulkOwnerPlan(items, sel.ids).editable.length}
          right={selected && drawer ? drawerWidth : 0}
          setRef={(kind, r) => { bulkRefs.current[kind] = r; }}
          onOpen={kind => { void openBulkMenu(kind); }}
          onRetry={() => { const last = lastBulk.current; if (last && bulk) void applyBulk(last.kind, last.value, bulk.failed.map(f => f.id)); }}
          onClear={() => { setSel(NO_SELECTION); setBulk(null); }}
        />
      ) : null}
      <SelectMenu
        anchor={bulkMenu?.anchor ?? null}
        touch={!pointer}
        title={bulkMenu?.kind === 'project' ? tr('bulk.project') : bulkMenu?.kind === 'agent' ? tr('bulk.agent') : bulkMenu?.kind === 'owner' ? tr('bulk.owner') : tr('bulk.status')}
        options={bulkMenu?.kind === 'project' ? projectOptions(projects ?? [], null)
          : bulkMenu?.kind === 'agent' ? people.filter(p => p.kind === 'node').map(p => ({ id: p.id, label: p.name, lead: <AliasAvatar alias={p.name} size={18} /> }))
            // 负责人:分两个角色的 Hub 上只列人类(同详情 / 新建的 roleKinds);id 用 personKey(人类和 Agent 可能同名同 id)。
            : bulkMenu?.kind === 'owner' ? people.filter(p => roleKinds('owner', twoRoles).includes(p.kind) && !p.unavailable).map(p => ({ id: personKey(p), label: p.name, lead: <AliasAvatar alias={p.name} size={18} /> }))
            : statusOptions.map(col => ({ id: col, label: taskText(REQ_COLUMN_LABEL[col]), color: STATUS_TONE[col]() }))}
        noneLabel={bulkMenu?.kind === 'project' ? tr('tasks.copy.31') : bulkMenu?.kind === 'agent' ? tr('bulk.agentNone') : bulkMenu?.kind === 'owner' ? tr('bulk.ownerNone') : undefined}
        selected={null}
        searchable={bulkMenu?.kind === 'agent' || bulkMenu?.kind === 'owner'}
        onPick={value => { const kind = bulkMenu?.kind; setBulkMenu(null); if (kind) void applyBulk(kind, value); }}
        onClose={() => setBulkMenu(null)}
        testID={`task-bulk-menu-${bulkMenu?.kind ?? 'none'}`}
      />
      <TaskCardMenu
        target={menu}
        touch={!pointer}
        busy={!!menu && movingIds.includes(menu.id)}
        onOpen={id => setSelectedId(id)}
        onAssign={(id, mode) => { void openAssign(id, mode); }}
        onMove={(id, to) => { void move(id, to); if (pointer) focusCard(id); }}
        onQuick={(id, kind, at) => setQuickPick({ id, kind, anchor: { x: at.x, y: at.y, w: 1, h: 1 } })}
        onPriority={(id, priority) => {
          // 和列表单元格 / 手机「改优先级…」同一条路:editCell(乐观改,失败只退回这一格并提示)。
          const it = items.find(row => row.id === id);
          if (it && priority !== it.priority) void editCell(id, { field: 'priority', priority }).then(failed => { if (failed) setBanner(`「${it.name}」${failed}`); });
        }}
        onArchive={id => { void setArchived(id, true); }}
        onClose={() => setMenu(null)}
      />
      {(() => {
        const it = quickPick && items.find(row => row.id === quickPick.id);
        if (!quickPick || !it) return null;
        return quickPick.kind === 'status' ? (
          <SelectMenu anchor={quickPick.anchor} touch title={tr('fields.status')} searchable={false} selected={it.column} testID="quick-status" onClose={() => setQuickPick(null)}
            options={statusOptions.map(c => ({ id: c, label: taskText(REQ_COLUMN_LABEL[c]), color: STATUS_TONE[c]() }))}
            onPick={c => { setQuickPick(null); if (c) quickStatus(it.id, c as ReqColumn); }} />
        ) : (
          <SelectMenu anchor={quickPick.anchor} touch title={tr('fields.priority')} searchable={false} selected={it.priority} testID="quick-priority" onClose={() => setQuickPick(null)}
            options={priorityChoices(lowestPriority, it.priority).map(p => ({ id: p, label: priorityLabel(p), lead: <PriorityDot p={p} s={s} /> }))}
            onPick={p => {
              setQuickPick(null);
              if (p && p !== it.priority) void editCell(it.id, { field: 'priority', priority: p as Requirement['priority'] }).then(failed => { if (failed) setBanner(`「${it.name}」${failed}`); });
            }} />
        );
      })()}
      {archUndo && !undo ? (
        <View style={s.undoToast} testID="archive-undo" accessibilityLiveRegion="polite">
          <Text style={s.undoText} numberOfLines={1}>{tr(archUndo.archived ? 'archive.done' : 'archive.restored', { name: archUndo.name })}</Text>
          <Pressable testID="archive-undo-button" accessibilityRole="button" accessibilityLabel={tr('quick.undo')} onPress={() => { const u = archUndo; setArchUndo(null); void setArchived(u.id, !u.archived, true); }} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm }}>
            <Text style={s.undoAction}>{tr('quick.undo')}</Text>
          </Pressable>
        </View>
      ) : null}
      {undo ? (
        <View style={s.undoToast} testID="quick-undo" accessibilityLiveRegion="polite">
          <Text style={s.undoText} numberOfLines={1}>{tr('quick.moved', { v0: taskText(REQ_COLUMN_LABEL[undo.to]) })}</Text>
          <Pressable testID="quick-undo-button" accessibilityRole="button" accessibilityLabel={tr('quick.undo')} onPress={undoQuick} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm }}>
            <Text style={s.undoAction}>{tr('quick.undo')}</Text>
          </Pressable>
        </View>
      ) : null}
      {assignFor && assignItem ? (
        <RequirementPeoplePicker
          networkId={cfg.networkId || ''}
          mode={assignFor.mode}
          // 负责人:分两个角色的 Hub 上只能是人类;参与人:人类 + Agent 两组(同详情 / 新建),不传 kinds。
          kinds={assignFor.mode === 'owner' ? roleKinds('owner', hasRoles(assignItem)) : undefined}
          meId={meId}
          title={assignFor.mode === 'owner' ? tr('tasks.copy.65') : tr('tasks.copy.66')}
          hint={assignFor.mode === 'owner' ? (hasRoles(assignItem) ? tr('tasks.copy.109') : undefined) : (n: number) => tr('tasks.participantsPickHint', { v0: n })}
          people={people}
          selected={assignFor.mode === 'owner' ? (assignItem.owner ? [assignItem.owner] : []) : assignFor.opened}
          anchor={assignFor.anchor}
          onClose={() => setAssignFor(null)}
          onConfirm={confirmAssign}
        />
      ) : null}
      <FilterMenu
        open={filterMenu}
        touch={!pointer}
        owners={owners}
        selectedOwners={filter.owners}
        priorities={priorityChoices(lowestPriority || filter.priorities.includes('lowest'))}
        selectedPriorities={filter.priorities}
        meId={meId}
        onToggleOwner={key => setTaskFilter({ ...filter, owners: toggleIn(filter.owners, key) })}
        onTogglePriority={p => setTaskFilter({ ...filter, priorities: toggleIn(filter.priorities, p) })}
        selectedStatuses={statuses}
        onToggleStatus={c => setTaskFilter({ ...filter, statuses: toggleIn(statuses, c) })}
        onToggleHideDone={() => setTaskFilter({ ...filter, statuses: toggleHideDone(statuses) })}
        statusOptions={statusOptions}
        showAbandoned={abandonedOk ? showAbandoned : null}
        onToggleShowAbandoned={() => setShowAbandoned(!showAbandoned)}
        onClear={kind => setTaskFilter(kind === 'owner' ? { ...filter, owners: [] } : kind === 'project' ? { ...filter, project: '' } : kind === 'status' ? { ...filter, statuses: [] } : { ...filter, priorities: [] })}
        projects={projects ?? []}
        projectCounts={counts}
        selectedProject={filter.project || ''}
        onPickProject={id => setTaskFilter({ ...filter, project: id })}
        onClose={() => setFilterMenu(null)}
      />
    </View>
  );
}

/** 桌面多选的底部操作条:已选几个 · 移到项目… · 改状态… · 负责 Agent… · 取消选择;改的过程中显示进度,失败的列出来可以重试。 */
function BulkBar({ count, bulk, canProject, canAgent, canOwner, ownerEditable, right, setRef, onOpen, onRetry, onClear }: {
  count: number;
  bulk: BulkProgress | null;
  canProject: boolean;
  canAgent: boolean;
  /** 选中的卡里有带稳定负责人的(新 Hub):给「指派负责人…」。 */
  canOwner: boolean;
  /** 选中的卡里我能改负责人的张数;0 = 按钮灰掉。 */
  ownerEditable: number;
  /** 右边被详情抽屉占掉的宽度(条在剩下的区域里居中)。 */
  right: number;
  setRef: (kind: BulkKind, r: any) => void;
  onOpen: (kind: BulkKind) => void;
  onRetry: () => void;
  onClear: () => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  const running = !!bulk?.running;
  const btn = (kind: BulkKind, label: string, icon: string, off = false, hint?: string) => (
    <View key={kind} ref={r => setRef(kind, r)} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        {...a11yState({ disabled: running || off })}
        disabled={running || off}
        onPress={() => onOpen(kind)}
        {...(hint ? { accessibilityHint: hint, title: hint } as object : {})}
        style={state => [{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: spacing.md, borderRadius: radius.control, flexShrink: 0 }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }, (running || off) && { opacity: 0.45 }]}
        testID={`task-bulk-${kind}`}
      >
        <Ionicons name={icon as never} size={15} color={colors.textSecondary} />
        <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>{label}</Text>
      </Pressable>
    </View>
  );
  const skipped = bulk?.skipped ? ` · ${tr('bulk.skipped', { n: bulk.skipped })}` : '';
  const status = running ? tr('bulk.running', { done: bulk!.done, total: bulk!.total }) + skipped
    : count ? tr('bulk.selected', { n: count })
      : bulk && !bulk.failed.length ? tr('bulk.done', { n: bulk.total }) + skipped : '';
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right, bottom: spacing.xl, alignItems: 'center', gap: spacing.sm, zIndex: 15 }}>
      {bulk && !bulk.running && bulk.failed.length ? (
        <View style={{ maxWidth: 520, padding: spacing.md, gap: 4, borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') }} testID="task-bulk-failed" accessibilityRole="alert">
          <Text style={s.err}>{tr('bulk.failed', { n: bulk.failed.length })}</Text>
          {bulk.failed.slice(0, 5).map(f => <Text key={f.id} style={s.muted} numberOfLines={1}>「{f.name}」{f.message}</Text>)}
          <Pressable accessibilityRole="button" onPress={onRetry} testID="task-bulk-retry"><Text style={s.link}>{tr('bulk.retry')}</Text></Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingLeft: spacing.lg, paddingRight: 6, borderRadius: radius.pill, backgroundColor: colors.card, ...elevated('floating') }} testID="task-bulk-bar">
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginRight: spacing.sm, flexShrink: 0 }} numberOfLines={1} testID="task-bulk-count" accessibilityLiveRegion="polite">{status}</Text>
        {running ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        {count ? (
          <>
            {canProject ? btn('project', tr('bulk.project'), 'folder-outline') : null}
            {btn('status', tr('bulk.status'), 'swap-horizontal-outline')}
            {canAgent ? btn('agent', tr('bulk.agent'), 'hardware-chip-outline') : null}
            {canOwner ? btn('owner', tr('bulk.owner'), 'person-outline', ownerEditable === 0, ownerEditable === 0 ? tr('bulk.ownerNoneEditable') : count > ownerEditable ? tr('bulk.skipped', { n: count - ownerEditable }) : undefined) : null}
          </>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={tr('bulk.clear')} onPress={onClear} disabled={running} style={state => [{ width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="task-bulk-clear">
          <Ionicons name="close" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

/** 卡片最下一行:子任务进度(左,可没有)+ 参与人头像(右,可没有)。都没有就不占位置。 */
/** compact(手机列表行,#506):子任务进度只画「☑ 3/5」小胶囊,不画进度条 —— 列表行比卡片矮,一眼看数就够。 */
function CardFooter({ item, people, s, touch, onParticipants, canAssign, meId, compact = false }: { item: Requirement; people: readonly RequirementPerson[]; s: TaskStyles; touch: boolean; onParticipants: (stack?: any) => void; canAssign: boolean; meId: string | null; compact?: boolean }) {
  useTranslation();
  const hasList = checklistCounts(item).total > 0;
  const hasPeople = !!item.participants?.length;
  const subs = item.children?.total ? item.children : null;
  if (!hasList && !hasPeople && !subs) return null;
  return (
    // 窄列放不下三样(子需求 · 子任务进度 · 参与人)时换行,不把「4/7」挤成「4/」。
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', rowGap: 6 }} testID="task-card-footer">
      {/* 子需求进度(分支图标 + 「2/5」)和子任务进度(勾选框 + 细条)是两件事,样子也分开。 */}
      {subs ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: radius.pill, backgroundColor: colors.subtleFill }} testID="task-subreq-progress" accessibilityLabel={tr('tasks.copy.60', { v0: subs.done, v1: subs.total })}>
          <Ionicons name="git-branch-outline" size={11} color={subs.done === subs.total ? colors.running : colors.textSecondary} />
          <Text style={[s.metaMuted, { fontSize: 11 }]}>{subs.done}/{subs.total}</Text>
        </View>
      ) : null}
      {compact ? <>{hasList ? <ChecklistCompact item={item} s={s} /> : null}<View style={{ flex: 1 }} /></>
        : <View style={{ flex: 1, minWidth: hasList ? 96 : 0 }}>{hasList ? <ChecklistProgress item={item} s={s} /> : null}</View>}
      {hasPeople ? <ParticipantStack item={item} people={people} s={s} touch={touch} onPress={onParticipants} pressLabel={canAssign ? 'assign' : 'open'} meKey={meId ? personKey({ kind: 'user', id: meId }) : null} /> : null}
    </View>
  );
}

function AvatarStack({ keys, owners }: { keys: readonly string[]; owners: ReturnType<typeof ownerCounts> }) {
  useTranslation();
  const shown = keys.slice(0, 3);
  return (
    <View style={{ flexDirection: 'row' }}>
      {shown.map((key, i) => {
        const o = owners.find(row => row.key === key);
        return (
          <View key={key} style={{ marginLeft: i ? -6 : 0, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.card }}>
            {key === UNASSIGNED ? <Ionicons name="person-circle-outline" size={18} color={colors.textMuted} /> : <AliasAvatar alias={o?.name || key.split(':').slice(1).join(':')} size={18} />}
          </View>
        );
      })}
    </View>
  );
}

type FilterKind = 'owner' | 'priority' | 'project' | 'status';

/** 头部筛选的弹层:负责人(头像 + 名字 + 数目,多选)、优先级 / 状态(多选)或项目(单选)。 */
function FilterMenu({ open, touch, owners, selectedOwners, priorities, selectedPriorities, selectedStatuses, meId, onToggleOwner, onTogglePriority, onToggleStatus, onToggleHideDone, statusOptions, showAbandoned, onToggleShowAbandoned, onClear, onClose, projects, projectCounts, selectedProject, onPickProject }: {
  open: { kind: FilterKind; x: number; y: number } | null;
  touch: boolean;
  owners: ReturnType<typeof ownerCounts>;
  selectedOwners: readonly string[];
  selectedPriorities: readonly string[];
  meId: string | null;
  onToggleOwner: (key: string) => void;
  onTogglePriority: (p: (typeof REQ_PRIORITIES)[number]) => void;
  /** 给哪几档(旧 Hub 没有 P3;已勾上的 P3 仍列出来,好取消)。 */
  priorities: readonly (typeof REQ_PRIORITIES)[number][];
  selectedStatuses: readonly ReqColumn[];
  onToggleStatus: (c: ReqColumn) => void;
  onToggleHideDone: () => void;
  /** 状态筛选里列出的状态(旧 Hub 没有「废弃」)。 */
  statusOptions: readonly ReqColumn[];
  /** 「显示已废弃」开关;null = 这个 Hub 没有废弃,不画。 */
  showAbandoned: boolean | null;
  onToggleShowAbandoned: () => void;
  onClear: (kind: FilterKind) => void;
  onClose: () => void;
  projects: readonly RequirementProject[];
  projectCounts: ReadonlyMap<string, number>;
  selectedProject: string;
  onPickProject: (id: string) => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  // 锚定的浮层:遮罩铺满窗口,安全区只用来夹住弹层的位置(同 TaskCardMenu / AgentRowMenu)。
  const safe = useModalSafePadding('fullScreen');
  const viewport = useWindowDimensions();
  const menuWidth = Math.min(260, viewport.width - safe.paddingLeft - safe.paddingRight - 16);
  const rowH = touch ? 44 : 36;
  const row = (key: string, on: boolean, onPress: () => void, lead: ReactNode, label: string, count?: number, onLongPress?: (e: GestureResponderEvent) => void, strike = false) => (
    <Pressable key={key} testID={`task-filter-opt-${key}`} accessibilityRole="checkbox" {...a11yState({ checked: on })} onPress={onPress} onLongPress={touch ? onLongPress : undefined}
      style={state => ({ height: rowH, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, borderRadius: radius.item, backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed ? colors.rowHover : 'transparent' })}>
      {lead}
      <Text style={[{ flex: 1, fontSize: 13 }, statusCapsuleText(strike ? 'abandoned' : 'pool', strike ? colors.textMuted : colors.text)]} numberOfLines={1}>{label}</Text>
      {count !== undefined ? <Text style={s.metaMuted}>{count}</Text> : null}
      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={16} color={on ? colors.accent : colors.textMuted} />
    </Pressable>
  );
  const meKey = meId ? personKey({ kind: 'user', id: meId }) : '';
  return (
    <Modal visible={!!open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: touch ? 'rgba(0,0,0,0.18)' : 'transparent' }} onPress={onClose} testID="task-filter-scrim" accessibilityLabel={tr('tasks.copy.61')} />
      {open ? (
        <View style={{ position: 'absolute', left: Math.max(8 + safe.paddingLeft, Math.min(open.x, viewport.width - safe.paddingRight - menuWidth - 8)), top: Math.max(open.y, safe.paddingTop + 8), width: menuWidth, maxHeight: menuMaxHeight(open.y, viewport.height, safe.paddingTop, safe.paddingBottom), padding: 6, borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') }} testID={`task-filter-menu-${open.kind}`} accessibilityRole="menu">
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }}>
            {open.kind === 'project'
              ? [...activeProjects(projects).map(p => ({ id: p.id, name: p.name, color: p.color as string | null })), { id: NO_PROJECT, name: tr('tasks.copy.31'), color: null }].map(p => row(
                p.id, selectedProject === p.id, () => { onPickProject(selectedProject === p.id ? '' : p.id); onClose(); },
                p.color ? <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: p.color }} /> : <Ionicons name="remove-circle-outline" size={14} color={colors.textMuted} />,
                p.name, projectCounts.get(p.id) ?? 0,
                // 手机长按项目 → 项目菜单(#760);有没有菜单项由菜单自己按权限定。
                touch && canEditProject(projects.find(x => x.id === p.id)) ? e => { onClose(); setSideMenu({ kind: 'project', key: p.id, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, touch: true }); } : undefined,
              ))
              : open.kind === 'owner'
              // 分段:「人」(我第一)/「Agent」/ 未分配(任务页审计 M8:人和节点混排、「我」沉底)。
              ? ownerFilterSections(owners.filter(o => o.count > 0 || selectedOwners.includes(o.key)), meKey).flatMap((sec, i) => [
                ...(sec.kind === 'none'
                  ? [<View key="owner-sep-none" style={{ height: 1, marginVertical: 4, backgroundColor: colors.border }} />]
                  : [<Text key={`owner-sec-${sec.kind}`} testID={`task-filter-sec-${sec.kind}`} style={[s.metaMuted, { paddingHorizontal: spacing.md, paddingTop: i ? spacing.sm : 2, paddingBottom: 2, fontSize: 12 }]}>{sec.kind === 'people' ? tr('tasks.filterSectionPeople') : tr('tasks.filterSectionAgents')}</Text>]),
                ...sec.rows.map(o => row(
                  o.key, selectedOwners.includes(o.key), () => onToggleOwner(o.key),
                  o.ref ? <AliasAvatar alias={o.name} size={22} /> : <Ionicons name="person-circle-outline" size={22} color={colors.textMuted} />,
                  o.key === meKey ? tr('tasks.copy.62', { v0: o.name }) : o.name, o.count,
                )),
              ])
              : open.kind === 'status'
              ? [
                ...statusOptions.map(c => row(`status-${c}`, selectedStatuses.includes(c), () => onToggleStatus(c), <View style={[s.columnDot, { backgroundColor: STATUS_TONE[c]() }]} />, taskText(REQ_COLUMN_LABEL[c]), undefined, undefined, c === 'abandoned')),
                <View key="status-sep" style={{ height: 1, marginVertical: 4, backgroundColor: colors.border }} />,
                row('status-hide-done', hidesDone(selectedStatuses), onToggleHideDone, <Ionicons name="eye-off-outline" size={14} color={colors.textMuted} />, tr('tasks.hideDone')),
                ...(showAbandoned !== null ? [row('status-show-abandoned', showAbandoned || selectedStatuses.includes('abandoned'), onToggleShowAbandoned, <Ionicons name="trash-bin-outline" size={14} color={colors.textMuted} />, tr('abandoned.show'))] : []),
              ]
              : priorities.map(p => row(p, selectedPriorities.includes(p), () => onTogglePriority(p), <PriorityDot p={p} s={s} />, priorityLabel(p)))}
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Pressable onPress={() => { onClear(open.kind); onClose(); }} style={{ height: 36, justifyContent: 'center', paddingHorizontal: spacing.md }} testID="task-filter-reset" accessibilityRole="button">
              <Text style={s.link}>{tr('tasks.copy.63')}</Text>
            </Pressable>
            {/* 手机 / 双栏没有左栏:「管理项目」放在项目筛选弹层里。 */}
            {open.kind === 'project' ? (
              <Pressable onPress={() => { onClose(); setManagingProjects(true); }} style={{ height: 36, justifyContent: 'center', paddingHorizontal: spacing.md }} testID="task-filter-manage-projects" accessibilityRole="button">
                <Text style={s.link}>{tr('tasks.copy.64')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
