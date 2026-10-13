// 任务页的共享状态:桌面左栏(TaskFilterSidebar)和右侧看板(RequirementBoard)是两棵树,
// 筛选、当前视图、看板读到的卡片要是同一份。按账号 + 网络分开:换网络就回到「全部」。
import { useSyncExternalStore } from 'react';
import type { Requirement, RequirementProject } from './requirements-model';
import type { TagCatalog, TagOp } from './task-tag-catalog';
import type { RequirementPerson } from './requirement-people';
import { EMPTY_FILTER, type BoardFilter } from './task-board-model';
import { EMPTY_SEARCH, type TaskSearch } from './task-search';

/** 列表 / 看板是需求池的两种看法;派发记录是 Hub 上派给节点的任务(原来的「列表」)。 */
export type TaskSection = 'list' | 'board' | 'gantt' | 'calendar' | 'dashboard' | 'activity' | 'dispatch';

export interface ManagerOps {
  updateProject: (id: string, patch: { name?: string; color?: string; archived?: boolean }) => Promise<string | null>;
  tagOp: (op: TagOp) => Promise<string | null>;
}
export interface SideMenuTarget { kind: 'project' | 'tag'; key: string; x: number; y: number; touch: boolean }

export interface TaskBoardState {
  scope: string;
  section: TaskSection;
  filter: BoardFilter;
  /** 搜索(已去抖)。和 filter 一起决定各视图画哪些卡:task-search.ts visibleTasks。换网络清空。 */
  search: TaskSearch;
  items: Requirement[];
  people: RequirementPerson[];
  meId: string | null;
  /** Hub 分不分「负责人(人类)/ 负责 Agent」。null = 还不知道(按旧的单一负责人画)。 */
  twoRoles: boolean | null;
  /** 项目列表(含归档);null = 这个 Hub 没有项目(或还没读到),界面把项目整个藏起来。 */
  projects: RequirementProject[] | null;
  /** Hub 的 capabilities(GET /api/requirements 带回);due_datetime = 预计完成能存到秒。 */
  capabilities: string[];
  /** 管理项目的对话框开着没有(左栏的「管理项目」和看板共用)。 */
  managingProjects: boolean;
  /** 管理标签的对话框 / 底部面板开着没有(左栏、手机标签筛选共用)。 */
  managingTags: boolean;
  /** GET /api/requirements/tags 的结果(用量、颜色、能不能管);null = 还没读到或读失败。 */
  tagCatalog: TagCatalog | null;
  /** 「管理项目 / 管理标签」用的那两个写 Hub 的处理函数(看板登记);左栏右键菜单走同一条路(#760)。 */
  managerOps: ManagerOps | null;
  /** 左栏 / 筛选行上打开的项目或标签菜单(#760)。 */
  sideMenu: SideMenuTarget | null;
  /** 从菜单「改名」打开管理对话框时,直接进那一项的改名(手机)。 */
  managerFocus: string | null;
  loaded: boolean;
  /** Hub 给的列表不是整张表(有更老的没读回来):搜索要问服务端(capability search)。 */
  truncated: boolean;
}

const fresh = (scope: string, section: TaskSection = 'board'): TaskBoardState => ({
  scope, section, filter: EMPTY_FILTER, search: EMPTY_SEARCH, items: [], people: [], meId: null, twoRoles: null, projects: null, capabilities: [], managingProjects: false, managingTags: false, tagCatalog: null, managerOps: null, sideMenu: null, managerFocus: null, loaded: false, truncated: false,
});

let state: TaskBoardState = fresh('');
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(l => l());

export const taskBoardState = (): TaskBoardState => state;

export function subscribeTaskBoard(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** 进入某个账号 / 网络。换了就清空卡片和筛选,视图保留(用户刚选的看法不该因为换网络跳走)。 */
export function enterTaskScope(scope: string): void {
  if (state.scope === scope) return;
  state = fresh(scope, state.section);
  emit();
}

/** 只接受当前 scope 的写入:旧网络晚到的响应不会写进新网络的看板。 */
export function patchTaskBoard(scope: string, patch: Partial<Omit<TaskBoardState, 'scope'>>): void {
  if (state.scope !== scope) return;
  if (Object.keys(patch).every(key => Object.is(state[key as keyof TaskBoardState], patch[key as keyof typeof patch]))) return;
  state = { ...state, ...patch };
  emit();
}

export function updateTaskItems(scope: string, fn: (items: Requirement[]) => Requirement[]): void {
  if (state.scope !== scope) return;
  const items = fn(state.items);
  if (items === state.items) return;
  state = { ...state, items };
  emit();
}

export const setTaskSection = (section: TaskSection) => { if (state.section !== section) { state = { ...state, section }; emit(); } };
export const setManagingProjects = (on: boolean, focus: string | null = null) => { if (state.managingProjects !== on || state.managerFocus !== focus) { state = { ...state, managingProjects: on, managerFocus: focus }; emit(); } };
export const setManagingTags = (on: boolean, focus: string | null = null) => { if (state.managingTags !== on || state.managerFocus !== focus) { state = { ...state, managingTags: on, managerFocus: focus }; emit(); } };
export const setSideMenu = (sideMenu: SideMenuTarget | null) => { if (state.sideMenu !== sideMenu) { state = { ...state, sideMenu }; emit(); } };
/** 刚存上的标签记进目录(补全马上能选到;用量等下次读目录再对齐)。 */
export const noteTagsUsed = (tags: readonly string[]) => {
  const cat = state.tagCatalog;
  if (!cat || tags.every(t => cat.tags.includes(t))) return;
  state = { ...state, tagCatalog: { ...cat, tags: [...new Set([...cat.tags, ...tags])].sort() } };
  emit();
};
export const setTaskFilter = (filter: BoardFilter) => { state = { ...state, filter }; emit(); };
export const setTaskSearch = (search: TaskSearch) => { if (state.search.q !== search.q || state.search.archived !== search.archived) { state = { ...state, search }; emit(); } };

export function useTaskBoard<T>(pick: (s: TaskBoardState) => T): T {
  return useSyncExternalStore(subscribeTaskBoard, () => pick(state), () => pick(state));
}

export const taskScopeKey = (cfg: { serverUrl: string; token: string; networkId?: string; profileId?: string; username?: string }) =>
  JSON.stringify([cfg.serverUrl, cfg.token, cfg.networkId, cfg.profileId, cfg.username]);
