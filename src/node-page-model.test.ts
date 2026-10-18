// 节点页重做(2026-09-24):分组与分区的纯逻辑。ck 风格自执行脚本(不是 bun:test)。
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样报这一条);运行时由 node/bun 提供。
import { readFileSync } from 'node:fs';
import { groupNodeTasks, isSelfTask } from './node-task-groups';
import { partitionNodeTasks } from './node-tasks';
import { NODE_PAGE_CONTENT_MAX_WIDTH, NODE_RULES_EDITOR_MIN_HEIGHT, NODE_SECTIONS, leaveNeedsConfirm, modelSectionFacts, nodePageChrome, nodePageContentWidth, nodePageScrolls, overviewFactColumns, factText, headerChips, resolveActiveSection, splitOverviewFacts, visibleNodeSections } from './node-page-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) p++; else console.log(`  ✗ ${n}`); };

// ── 任务分组 ─────────────────────────────────────────
const A = '通信牛';
const tasks = [
  { task_id: 'r1', from_name: 'admin', to_name: A, status: 'acked', created_at: '2026-09-24 01:00:00', content: '真在跑的活' },
  { task_id: 'q1', from_name: '通信龙', to_name: A, status: 'pending', created_at: '2026-09-24 01:05:00', content: '排队的活' },
  ...Array.from({ length: 30 }, (_, i) => ({ task_id: `s${i}`, from_name: A, to_name: A, status: 'acked', created_at: `2026-09-24 00:${String(i).padStart(2, '0')}:00`, content: `自投提醒 ${i}` })),
  { task_id: 'd1', from_name: 'admin', to_name: A, status: 'replied', created_at: '2026-09-23 10:00:00', completed_at: '2026-09-23 10:05:00', content: '旧的完成' },
  { task_id: 'd2', from_name: 'admin', to_name: A, status: 'failed', created_at: '2026-09-24 00:10:00', completed_at: '2026-09-24 00:20:00', content: '新的失败' },
  { task_id: 'sd', from_name: A, to_name: A, status: 'replied', created_at: '2026-09-24 00:30:00', completed_at: '2026-09-24 00:31:00', content: '自投但回了' },
];
const g = groupNodeTasks(tasks, A);
ck('真在跑的活仍在运行中', g.running.length === 1 && g.running[0].taskId === 'r1');
ck('自己发给自己的 acked 不算运行中(30 条全部移出)', !g.running.some(r => r.taskId.startsWith('s')));
ck('自投提醒单独成组,30 条都在', g.selfOpen.length === 30);
ck('自投提醒最新的在前', g.selfOpen[0]?.taskId === 's29');
ck('排队的活仍在队列', g.queue.length === 1 && g.queue[0].taskId === 'q1');
ck('最近完成按结束时间倒序(新的失败在前)', g.recent[0].taskId === 'sd' && g.recent.map(r => r.taskId).indexOf('d2') < g.recent.map(r => r.taskId).indexOf('d1'));
ck('最近完成受上限控制', groupNodeTasks(tasks, A, 2).recent.length === 2);
ck('旧的 partitionNodeTasks 会把自投提醒算进运行中(这正是要修的)', partitionNodeTasks(tasks).running.length === 31);
ck('isSelfTask:发件人是别人 → 否', !isSelfTask({ from_name: 'admin', to_name: A }, A));
ck('isSelfTask:首尾空白不影响', isSelfTask({ from_name: ` ${A} `, to_name: A }, A));
ck('isSelfTask:空别名永远不是自投', !isSelfTask({ from_name: '', to_name: '' }, ''));
ck('空输入不炸', JSON.stringify(groupNodeTasks(null, A)) === JSON.stringify({ running: [], queue: [], selfOpen: [], recent: [] }));

// ── 分区可见性 ───────────────────────────────────────
const keys = NODE_SECTIONS.map(s => s.key).join(',');
ck('分区顺序固定:概览/模型/密钥/规则/技能/项目文件夹/任务/定时任务/运行日志/权限/危险', keys === 'overview,model,secrets,rules,skills,files,tasks,schedules,logs,permissions,danger');
ck('权限:Hub 说能改才出现,紧挨危险操作之前', visibleNodeSections({ readOnly: false, hasRulesTarget: true, skillsCapable: true, permissionsAllowed: true }).join(',') === 'overview,model,secrets,rules,skills,files,tasks,schedules,logs,permissions,danger');
ck('权限:Hub 没说(旧 Hub)/ 说不能 → 不出现', !visibleNodeSections({ readOnly: false, hasRulesTarget: true, skillsCapable: true }).includes('permissions') && !visibleNodeSections({ readOnly: false, hasRulesTarget: true, skillsCapable: true, permissionsAllowed: false }).includes('permissions'));
ck('权限:只读页不出现(只读页不放编辑控件)', !visibleNodeSections({ readOnly: true, hasRulesTarget: true, skillsCapable: true, permissionsAllowed: true }).includes('permissions'));
ck('运行日志紧跟定时任务,图标 document-text-outline', NODE_SECTIONS.find(s => s.key === 'logs')?.label === '运行日志' && NODE_SECTIONS.find(s => s.key === 'logs')?.icon === 'document-text-outline');
ck('运行日志分区整页不滚(工具条钉住,日志区自己滚)', !nodePageScrolls('logs') && nodePageScrolls('files'));
ck('定时任务紧跟任务,图标 alarm-outline', NODE_SECTIONS.find(s => s.key === 'schedules')?.label === '定时任务' && NODE_SECTIONS.find(s => s.key === 'schedules')?.icon === 'alarm-outline');
ck('可编辑 + 有规则目标 + 无技能:技能不出现,危险操作出现', visibleNodeSections({ readOnly: false, hasRulesTarget: true, skillsCapable: false }).join(',') === 'overview,model,secrets,rules,files,tasks,schedules,logs,danger');
ck('只读页不出现危险操作,但其它有数据的分区都在', visibleNodeSections({ readOnly: true, hasRulesTarget: true, skillsCapable: true }).join(',') === 'overview,model,secrets,rules,skills,files,tasks,schedules,logs');
ck('没有规则目标 → 规则分区不出现', !visibleNodeSections({ readOnly: true, hasRulesTarget: false, skillsCapable: false }).includes('rules'));
ck('选中的分区被隐藏 → 回到概览', resolveActiveSection('rules', ['overview', 'model', 'tasks']) === 'overview');
ck('选中的分区还在 → 不变', resolveActiveSection('tasks', ['overview', 'tasks']) === 'tasks');

// ── 概览字段与头部标签 ───────────────────────────────
const facts = [
  { label: '节点名称', value: A }, { label: '节点 ID', value: 'n_1' }, { label: '服务器', value: 'https://hub.example.com' },
  { label: 'Hostname', value: 'devbox' }, { label: 'IP', value: '127.0.0.1' }, { label: '工作路径', value: '/srv/work' },
  { label: 'Runtime', value: 'codex-sdk' }, { label: '模型', value: 'gpt-5.5' }, { label: '版本', value: '2.5.0-preview.83' },
  { label: '所属 team', value: '通信' }, { label: '最后更新', value: '刚刚' },
];
const split = splitOverviewFacts(facts);
ck('主要字段按固定顺序', split.primary.map(f => f.label).join(',') === '节点 ID,服务器,Hostname,工作路径,所属 team,最后更新');
const withCodexHome = splitOverviewFacts([...facts, { label: 'codex_home', value: '/srv/codex-home' }]);
ck('codex_home 紧跟工作路径，没有这条时不占位', withCodexHome.primary.map(f => f.label).join(',') === '节点 ID,服务器,Hostname,工作路径,codex_home,所属 team,最后更新');
ck('其余字段进「更多信息」且不重复', split.secondary.length === facts.length - split.primary.length && !split.secondary.some(f => split.primary.includes(f)));
ck('头部标签:运行时 · 模型 · 版本 · 主机', JSON.stringify(headerChips(facts)) === JSON.stringify(['codex-sdk', 'gpt-5.5', 'v2.5.0-preview.83', 'devbox']));
ck('头部标签:缺的不显示,版本不重复加 v', JSON.stringify(headerChips([{ label: '版本', value: 'v1.2' }])) === JSON.stringify(['v1.2']));
ck('空值显示「—」', factText('') === '—' && factText(null) === '—' && factText('  ') === '—' && factText('x') === 'x');
const runtime = modelSectionFacts([
  { label: 'session-id', value: 'sess_01' },
  { label: '状态', value: 'working' },
  { label: '版本', value: '2.5.0-preview.126' },
  { label: '模型', value: 'gpt-6-astra' },
  { label: 'Agent', value: 'agent-node:codex-app-server' },
  { label: 'Runtime', value: 'codex-app-server' },
  { label: '节点类型', value: undefined },
]);
ck('模型与运行时:session-id 紧挨在版本后面(两列时落在版本右边)', runtime.map(f => f.label).join(',') === '节点类型,Runtime,Agent,模型,版本,session-id');
ck('模型与运行时不带状态等其它字段', !runtime.some(f => f.label === '状态'));
ck('没有 session-id 行时不补造', modelSectionFacts([{ label: '版本', value: '1' }]).map(f => f.label).join(',') === '版本');

// 宽窗布局(Vincent 09-24「空了」)
ck('内容列随窗口变宽', nodePageContentWidth(900, 24) === 852 && nodePageContentWidth(1100, 24) === 1052);
ck('内容列到上限封顶,不再是 880 的窄条', nodePageContentWidth(1426, 24) === NODE_PAGE_CONTENT_MAX_WIDTH && NODE_PAGE_CONTENT_MAX_WIDTH >= 960 && NODE_PAGE_CONTENT_MAX_WIDTH <= 1100);
ck('封顶边界:恰好等于上限 + 两侧内边距', nodePageContentWidth(NODE_PAGE_CONTENT_MAX_WIDTH + 48, 24) === NODE_PAGE_CONTENT_MAX_WIDTH && nodePageContentWidth(NODE_PAGE_CONTENT_MAX_WIDTH + 47, 24) === NODE_PAGE_CONTENT_MAX_WIDTH - 1);
ck('窄屏:内容列 = 窗宽减内边距', nodePageContentWidth(600, 16) === 568);
ck('未测到宽度 / 比内边距还窄 → 0,不出负数', nodePageContentWidth(0, 24) === 0 && nodePageContentWidth(NaN, 24) === 0 && nodePageContentWidth(30, 24) === 0);
ck('概览网格列数:1/2/3 与边界', overviewFactColumns(479) === 1 && overviewFactColumns(480) === 2 && overviewFactColumns(899) === 2 && overviewFactColumns(900) === 3 && overviewFactColumns(NODE_PAGE_CONTENT_MAX_WIDTH) === 3);
// 手机上规则文件编辑不了(2026-09-26 Vincent 小米折叠屏 0.2.99):工具条跟着整页滚出屏幕。
ck('规则分区整页不滚(工具条钉住,阅读区/编辑框自己滚)', nodePageScrolls('rules') === false);
ck('其余分区照旧整页滚', (['overview', 'model', 'skills', 'files', 'tasks', 'schedules', 'danger'] as const).every(k => nodePageScrolls(k) === true));
// 最矮高度:整页不滚了,这个值只防压扁;要小到手机竖屏 + 键盘(可用 ~440dp,顶部占 ~200)后仍放得下,又不至于只剩一行。
ck('编辑框最矮高度在 [96, 200]:防压扁且放得进键盘上方', NODE_RULES_EDITOR_MIN_HEIGHT >= 96 && NODE_RULES_EDITOR_MIN_HEIGHT <= 200);
ck('规则分区 + 键盘弹起:收起头部卡片和分区标题', JSON.stringify(nodePageChrome({ section: 'rules', keyboardVisible: true })) === JSON.stringify({ headerCard: false, sectionTitle: false }));
ck('规则分区无键盘:都显示', JSON.stringify(nodePageChrome({ section: 'rules', keyboardVisible: false })) === JSON.stringify({ headerCard: true, sectionTitle: true }));
ck('别的分区有键盘(改头像 URL 等):不收', nodePageChrome({ section: 'overview', keyboardVisible: true }).headerCard === true && nodePageChrome({ section: 'model', keyboardVisible: true }).sectionTitle === true);
ck('规则有草稿:离开要确认', leaveNeedsConfirm({ section: 'rules', rulesDirty: true }) === true);
ck('规则没草稿:直接走', leaveNeedsConfirm({ section: 'rules', rulesDirty: false }) === false);
ck('不在规则分区(残留的 dirty 不拦别的分区)', leaveNeedsConfirm({ section: 'skills', rulesDirty: true }) === false);

// 渲染侧契约:节点页确实按这些 helper 渲染。
const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
ck('节点页按 nodePageScrolls 决定包不包 ScrollView', /const pageScrolls = nodePageScrolls\(section\)/.test(screen) && /\{pageScrolls \? \(\s*<ScrollView/.test(screen));
ck('头部卡片 / 规则标题按 nodePageChrome 显示', /chrome\.headerCard \? headerCard : null/.test(screen) && /chrome\.sectionTitle \? <SectionTitle title="规则文件" \/> : null/.test(screen));
ck('切分区 / 页头返回都走 guard', /guardLeave\(\(\) => setActiveSection\(item\.key\)\)/.test(screen) && /<Pressable onPress=\{guardedBack\}/.test(screen));
ck('Android 返回键在有草稿时拦下', /BackHandler\.addEventListener\('hardwareBackPress'/.test(screen) && /\}, \[rulesDirty\]\);/.test(screen));
ck('键盘避让只在原生规则分区启用', /enabled=\{keyboardAvoidEnabled\(Platform\.OS, keyboardVisible, Platform\.OS !== 'web' && section === 'rules'\)\}/.test(screen));

console.log(`node page model: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
