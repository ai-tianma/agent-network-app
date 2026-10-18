// 节点页的纯模型(2026-09-24 节点页重做,Vincent「每个节点的设置的页面要好好重新设计一下,现在太简陋了」)。
// 结构照抄设置页(settings-model.ts):左栏分区 + 右栏内容;窄窗(< 640)左栏变顶部一排分段标签。
// 这里只放「有哪些分区、什么时候出现、概览里哪些字段是主要的」,渲染在 NodeDetailScreen。
// 纯逻辑,不 import react-native。
import type { NodeInfoFact } from './node-info';

export type NodeSectionKey = 'overview' | 'model' | 'secrets' | 'rules' | 'skills' | 'files' | 'tasks' | 'schedules' | 'logs' | 'permissions' | 'danger';

export interface NodeSection {
  readonly key: NodeSectionKey;
  readonly label: string;
  /** Ionicons 名。 */
  readonly icon: string;
}

export const NODE_SECTIONS: readonly NodeSection[] = [
  { key: 'overview', label: '概览', icon: 'grid-outline' },
  { key: 'model', label: '模型与运行时', icon: 'hardware-chip-outline' },
  { key: 'secrets', label: '密钥', icon: 'key-outline' },
  { key: 'rules', label: '规则文件', icon: 'document-text-outline' },
  { key: 'skills', label: '技能', icon: 'extension-puzzle-outline' },
  // 项目文件夹(只读):始终出现 —— 节点没上报 files_capable 时分区里直接说要升级什么(node-files.ts filesSupport)。
  { key: 'files', label: '项目文件夹', icon: 'folder-open-outline' },
  { key: 'tasks', label: '任务', icon: 'list-outline' },
  // 这个节点要执行的定时任务(Hub 计划 + 节点计划,按 node_id 认):始终出现,只读页也在(开关与定时任务页同权限)。
  { key: 'schedules', label: '定时任务', icon: 'alarm-outline' },
  // 节点自己的 agent-node 运行日志(只读,节点上脱敏):始终出现 —— 节点没上报 logs_capable 时分区里直接说
  // 「节点版本过旧，升级后可查看日志」(node-logs.ts logsSupport)。
  { key: 'logs', label: '运行日志', icon: 'document-text-outline' },
  // 节点自己的权限(正常 / 只读 / 受限,#489):只在 Hub 说你能改它时出现(viewer_can.permission_mode)。
  { key: 'permissions', label: '权限', icon: 'shield-checkmark-outline' },
  { key: 'danger', label: '危险操作', icon: 'warning-outline' },
];

/** 窄于这个宽度:左栏换成顶部分段标签(与设置页同一断点)。 */
export const NODE_PAGE_COMPACT_WIDTH = 640;

/**
 * 内容列的上限(Vincent 09-24「空了」:宽窗下内容被 880 卡成左边一窄条,右边一大片空)。
 * 列随窗口变宽、到这里封顶,在右栏里**居中**:封顶以后多出来的宽度分到两边,
 * 不会全堆在一侧读成「空了」;1080 放得下一行约 70 个汉字 / 130 个等宽字符,
 * 再宽规则文件这类长文就难读了。
 */
export const NODE_PAGE_CONTENT_MAX_WIDTH = 1080;

/**
 * 规则文件阅读区 / 编辑框的最矮高度;窗口更高时吃掉剩下的竖向空间。
 * 以前是 320,而且整页跟着一起滚:手机上(小米折叠屏外屏 + 系统字号)页头 + 工具条 + 320 装不下 ⇒
 * 整页可滚,Android 上嵌套的阅读区又接不到手势(外层 ScrollView 抢走)⇒ 手指一滑,滚走的是整页,
 * 「阅读/编辑」和「保存」一起滚出屏幕(2026-09-26 Vincent「好像编辑不了那个规则文件」)。
 * 现在规则分区整页不滚(nodePageScrolls),这个值只防止压扁;它要小到手机键盘弹起后也放得下。
 */
export const NODE_RULES_EDITOR_MIN_HEIGHT = 120;

/**
 * 这个分区要不要包在整页的 ScrollView 里。规则文件不要:它自己的阅读区 / 编辑框各自滚动,
 * 工具条(阅读/编辑、保存)钉在上面永远看得见;嵌套滚动在 Android 上外层抢手势。
 */
export function nodePageScrolls(section: NodeSectionKey): boolean {
  // 运行日志同理:工具条(筛选 / 搜索 / 跟随)钉住,日志区自己滚。
  return section !== 'rules' && section !== 'logs';
}

/**
 * 页面上方哪些常驻块要显示。规则文件分区正在打字(软键盘弹起)时收起头部卡片和分区标题,
 * 把高度让给编辑框 —— 手机竖屏 + 键盘,不收的话编辑框只剩两三行。
 */
export function nodePageChrome(input: { section: NodeSectionKey; keyboardVisible: boolean }): { headerCard: boolean; sectionTitle: boolean } {
  const typing = input.section === 'rules' && input.keyboardVisible;
  return { headerCard: !typing, sectionTitle: !typing };
}

/** 离开当前分区 / 返回上一页之前要不要先问「放弃未保存的修改?」。 */
export function leaveNeedsConfirm(input: { section: NodeSectionKey; rulesDirty: boolean }): boolean {
  return input.section === 'rules' && input.rulesDirty;
}

/** 右栏宽 paneWidth、左右内边距 padding 时,内容列实际多宽。 */
export function nodePageContentWidth(paneWidth: number, padding: number): number {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) return 0;
  return Math.max(0, Math.min(paneWidth - 2 * padding, NODE_PAGE_CONTENT_MAX_WIDTH));
}

/** 概览字段网格几列:窄一列,常规两列,内容列够宽(≥ 900)三列。 */
export function overviewFactColumns(contentWidth: number): 1 | 2 | 3 {
  if (contentWidth >= 900) return 3;
  if (contentWidth >= 480) return 2;
  return 1;
}

export interface NodeSectionVisibility {
  readOnly: boolean;
  /** 规则文件区有可发请求的目标(node-rules.ts rulesFileTarget 非空)。 */
  hasRulesTarget: boolean;
  /** 会话上报了 skills_capable === true。 */
  skillsCapable: boolean;
  /** Hub 说调用者能改这个节点的权限模式(GET /api/nodes 的 viewer_can.permission_mode,Hub ≥ .93)。 */
  permissionsAllowed?: boolean;
}

/**
 * 哪些分区出现。原则:只读页**隐藏的是编辑控件,不是分区** —— 有数据的分区都在;
 * 只有「危险操作」本身就是一组变更动作,只读页整区不出现。
 */
export function visibleNodeSections(v: NodeSectionVisibility): NodeSectionKey[] {
  return NODE_SECTIONS.map(s => s.key).filter(key => {
    if (key === 'rules') return v.hasRulesTarget;
    if (key === 'skills') return v.skillsCapable;
    if (key === 'permissions') return !v.readOnly && v.permissionsAllowed === true;
    if (key === 'danger') return !v.readOnly;
    return true;
  });
}

/** 当前选中的分区被隐藏了(比如能力还没上报)→ 回到第一个可见分区。 */
export function resolveActiveSection(active: NodeSectionKey, visible: readonly NodeSectionKey[]): NodeSectionKey {
  return visible.includes(active) ? active : visible[0] ?? 'overview';
}

/** 概览网格里默认露出的字段;其余放进「更多信息」折叠区。 */
export const PRIMARY_FACT_LABELS: readonly string[] = ['节点 ID', '服务器', 'Hostname', '工作路径', 'codex_home', '所属 team', '最后更新'];

/**
 * 「模型与运行时」摘要卡的字段,按两列网格的阅读顺序。
 * session-id 紧挨在 版本 后面,所以常规两列时它落在版本右边那一格。
 */
export const RUNTIME_FACT_LABELS: readonly string[] = ['节点类型', 'Runtime', 'Agent', '模型', '版本', 'session-id'];

/** 模型与运行时摘要:按 RUNTIME_FACT_LABELS 的顺序取,缺的标签不补行。 */
export function modelSectionFacts(facts: readonly NodeInfoFact[]): NodeInfoFact[] {
  const out: NodeInfoFact[] = [];
  for (const label of RUNTIME_FACT_LABELS) {
    const fact = facts.find(f => f.label === label);
    if (fact) out.push(fact);
  }
  return out;
}

export function splitOverviewFacts(facts: readonly NodeInfoFact[]): { primary: NodeInfoFact[]; secondary: NodeInfoFact[] } {
  const primary: NodeInfoFact[] = [];
  const secondary: NodeInfoFact[] = [];
  for (const label of PRIMARY_FACT_LABELS) {
    const fact = facts.find(f => f.label === label);
    if (fact) primary.push(fact);
  }
  for (const fact of facts) if (!PRIMARY_FACT_LABELS.includes(fact.label)) secondary.push(fact);
  return { primary, secondary };
}

/** 空值统一显示「—」,让人分得清「字段没上报」和「界面坏了」。 */
export function factText(value?: string | null): string {
  return value && value.trim().length > 0 ? value : '—';
}

/** 头部卡片名字下面那一排小标签:运行时 · 模型 · 版本 · 主机,缺的不显示。 */
export function headerChips(facts: readonly NodeInfoFact[]): string[] {
  const get = (label: string) => facts.find(f => f.label === label)?.value?.trim() || '';
  const version = get('版本');
  return [get('Runtime'), get('模型'), version ? `v${version.replace(/^v/, '')}` : '', get('Hostname') || get('服务器')].filter(Boolean);
}
