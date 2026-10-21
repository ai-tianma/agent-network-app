// 弹窗规则守卫(2026-09-30 Vincent「新建用户的确认键呢」:26 个网络平铺成 chip,把「创建」挤出屏幕,弹窗不能滚)。
// ck 风格,自执行。规则写在 DialogFrame.tsx 顶上:
//   1. 面板高度有界;2. 会长的内容在能收缩的 ScrollView 里;3. 按钮行是 ScrollView 后面的兄弟;
//   4. 有输入框的弹窗包 ModalKeyboardAvoider(或直接用 DialogFrame)。
//
// 这里守两层(取集 + 判据分开):
//   取集 —— src 下每个含 <Modal 的组件文件都必须登记在 AUDIT 里,<Modal 个数也要对上。新写的弹窗
//           没登记 ⇒ 红:先按规则过一遍再登记(新的居中弹窗直接用 DialogFrame)。
//   判据 —— DialogFrame 自身的结构;逐文件的关键约束(已修的 BUG 不许回退);键盘规则。
// 几何(真渲染量 boundingBox)在 tests/test-modal-footer-guard/run.mjs:40 个网络、360×640 与 1280×720。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { menuMaxHeight } from './modal-bounds';
import { filterNetworkChoices } from './user-admin';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };
// import.meta.dir, not new URL(...).pathname: on Windows the latter yields '/D:/…', which readdirSync can't open.
const here = import.meta.dir;
const read = (rel: string) => readFileSync(join(here, rel), 'utf8').replace(/\r\n?/g, '\n');
const MODAL_RE = /<Modal[\s>]/g;
// 只数代码里的 <Modal:注释里提到的(modal-safe-area.ts 的说明文字)不算。
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const countModals = (src: string) => (stripComments(src).match(MODAL_RE) ?? []).length;

type Kind = 'dialog' | 'sheet' | 'menu' | 'fullscreen' | 'drawer' | 'frame';
/**
 * 2026-09-30 逐个审过的 40 个 <Modal>(判据见文件头)。input = 弹窗里有文本输入框 ⇒ 必须有键盘避让。
 * note 写「为什么合规」,方便下一个改它的人知道不能动哪一处。
 */
/**
 * keyboard(文件里有 TextInput 时必填):'avoider' = 弹窗有键盘避让;否则写明现状 —— 'followup:' 开头的是
 * 本次审出来、还没修的(iOS 上键盘可能盖住弹窗下半 / 按钮;Android 的 Modal 窗口 adjustResize 未在真机核实)。
 */
type Keyboard = 'avoider' | `followup: ${string}` | `n/a: ${string}`;
const AUDIT: Record<string, { count: number; kinds: Kind[]; input?: boolean; keyboard?: Keyboard; note: string }> = {
  'DialogFrame.tsx': { count: 1, kinds: ['frame'], keyboard: 'avoider', input: true, note: '规则本体' },
  'RemoveSheet.tsx': { count: 1, kinds: ['sheet'], note: '手机「移出网络」「删除分组」确认:固定内容的底部 sheet(说明 + 两个按钮),不需要滚动(#417 从 UserManagementPanel 挪出来)' },
  'TaskCreateDialog.tsx': { count: 1, kinds: ['dialog', 'sheet'], keyboard: 'avoider', input: true, note: '面板 maxHeight 100% / 92%,表单 ScrollView 可收缩(本次 BUG 修复)' },
  'AccountRowActions.tsx': { count: 2, kinds: ['menu', 'sheet'], keyboard: 'n/a: 两个 <Modal 都没有输入框(桌面 ⋯ 锚定菜单 / 手机账号 ⋯ 底部动作面板,固定几行);文件里的 TextInput 在编辑弹窗里,编辑弹窗是 DialogFrame(自带键盘避让)', note: '⋯ 菜单高度按条目数算、夹进窗口(#427);动作面板高度由固定行数决定,取消在最底;编辑走 DialogFrame' },
  'AccountSwitcher.tsx': { count: 1, kinds: ['dialog', 'sheet'], note: '80% / 85% 有界,列表 flexGrow:0 直接子节点,取消在外' },
  'AgentRowMenu.tsx': { count: 1, kinds: ['menu'], note: 'anchorRowMenu 算好高度,固定条目' },
  'AndroidUpdatePrompt.tsx': { count: 1, kinds: ['fullscreen'], note: '全屏页(2026-09-30):ScrollView flex:1 装头部 + 完整说明,主按钮 / 进度条在 footer 里、在外' },
  'ChatInfoPanel.tsx': { count: 1, kinds: ['fullscreen'], note: '页面 flex:1 + ScrollView flex:1' },
  'AgentTeams.tsx': { count: 1, kinds: ['fullscreen'], keyboard: 'avoider', input: true, note: '#766 手机 Agent 组织:全屏页 flex:1,正文 ScrollView flex:1,底部「管理团队 / 新建团队」在 ScrollView 外;名称输入包 ModalKeyboardAvoider;桌面弹窗走 DialogFrame' },
  'OrgChart.tsx': { count: 1, kinds: ['fullscreen'], keyboard: 'avoider', input: true, note: '全屏页 flex:1,正文 ScrollView flex:1,底部按钮条 / 完成按钮在 ScrollView 外;桌面弹窗走 DialogFrame' },
  'ChatScreen.tsx': { count: 3, kinds: ['menu', 'sheet', 'dialog'], keyboard: 'avoider', input: true, note: '长按菜单 85% + 可滚(本次);放大阅读 86%;转发 maxHeight 100% + 键盘避让(本次)' },
  'ComposerRowParts.tsx': { count: 1, kinds: ['fullscreen'], keyboard: 'n/a: 全屏编辑器,输入框 flex:1、发送在顶栏,键盘只盖正文下沿', note: '全屏编辑,发送在顶栏' },
  'DesktopUpdatePrompt.tsx': { count: 1, kinds: ['dialog'], note: '卡片 88%,说明 ScrollView flexGrow 0 + flexShrink 1,按钮行在外' },
  'ImageViewer.tsx': { count: 1, kinds: ['fullscreen'], note: '绝对定位的顶 / 底栏' },
  'NodeDetailScreen.tsx': { count: 2, kinds: ['dialog'], keyboard: 'avoider', input: true, note: '两个固定内容小卡片;删除确认有输入框 ⇒ 键盘避让(本次)' },
  'NodeFilesTree.tsx': { count: 1, kinds: ['drawer'], note: '全高面板,ScrollView flex:1' },
  'NodePicker.tsx': { count: 1, kinds: ['dialog', 'sheet'], keyboard: 'followup: 节点选择器搜索框;没有底部按钮,键盘只盖列表下半', note: 'pickerDialogSize 显式高度,SectionList 可收缩' },
  'NodeRulesSection.tsx': { count: 1, kinds: ['fullscreen'], keyboard: 'n/a: 全屏规则编辑,工具栏在顶,正文 flex:1', note: '工具栏在顶,正文 flex:1' },
  'RequirementBoard.tsx': { count: 1, kinds: ['menu'], keyboard: 'n/a: 输入框在看板上,不在筛选菜单这个 Modal 里', note: '筛选菜单 maxHeight = menuMaxHeight(锚点到窗口底)(本次)' },
  'RequirementPeoplePicker.tsx': { count: 2, kinds: ['dialog', 'menu'], keyboard: 'avoider', input: true, note: '面板 85%,ScrollView 直接子节点;搜索框 ⇒ 键盘避让;桌面锚定下拉(审计 L12)= anchorSelectMenu 的 pos.maxHeight + ScrollView flexShrink,确定 / 取消在外,只在有鼠标的宽窗口(无软键盘)' },
  'ScheduleEditor.tsx': { count: 4, kinds: ['dialog', 'sheet'], input: true, keyboard: 'followup: 表单对话框 / 手机底部 sheet 无键盘避让;iOS 上键盘可能盖住表单下半(保存在顶栏,不被盖)', note: '2026-10-07 从 ScheduledTasksScreen 搬来(两个页面共用):桌面对话框 min(720,h-48),表单是顶层 ScrollView,按钮在外;手机全高底部 sheet / pageSheet 保存在顶栏;放弃修改 / 取消计划确认是固定内容小卡片' },
  'MessageSelectOverlay.tsx': { count: 1, kinds: ['menu'], keyboard: 'n/a: 输入框只用来承载原生选区(安卓 showSoftInputOnFocus=false、iOS/web 只读),不弹键盘;打开时先 Keyboard.dismiss(),菜单位置按键盘高度避让(placeSelectMenu)', note: '#537 手机长按就地选区:菜单两行固定条目,placeSelectMenu 夹进可见区;选区卡片 maxHeight = 可见区底 - 卡片顶,超出在 TextInput 里滚' },
  'SettingsScreen.tsx': { count: 4, kinds: ['dialog'], keyboard: 'avoider', input: true, note: '固定内容小确认框;本地删除有输入框 ⇒ 键盘避让(本次)' },
  'SideThreadDrawer.tsx': { count: 1, kinds: ['drawer'], keyboard: 'avoider', input: true, note: '86% / 100% 面板,FlatList 可收缩,自带 KAV(同一套 keyboardAvoidEnabled)' },
  'TaskActivity.tsx': { count: 2, kinds: ['menu', 'sheet'], keyboard: 'n/a: 筛选只有勾选 / chip,没有输入框', note: '桌面下拉 maxHeight = menuMaxHeight(锚点到窗口底),选项 ScrollView flexShrink:1;手机面板 85%,chip 组 ScrollView 可收缩,「重置 / 查看 N 条」是 ScrollView 后面的兄弟(#429)' },
  'TaskCardMenu.tsx': { count: 1, kinds: ['menu'], note: 'anchorRowMenu' },
  'TaskSideItemMenu.tsx': { count: 1, kinds: ['menu'], note: 'anchorRowMenu(#760 项目 / 标签行菜单)' },
  'TaskSearch.tsx': { count: 1, kinds: ['menu'], keyboard: 'n/a: 搜索输入框在头部,不在「包含已归档」这个选项菜单 Modal 里;菜单只有一行开关', note: '锚在搜索框右端的小菜单,固定一行,不需要滚动' },
  'TaskDescriptionFullscreen.tsx': { count: 2, kinds: ['fullscreen'], keyboard: 'followup: 全屏描述编辑,手机按住说话条在底部,无键盘避让', note: '正文 flex:1' },
  'TaskDetailPanel.tsx': { count: 1, kinds: ['fullscreen'], keyboard: 'followup: 全屏详情,编辑时 iOS 键盘可能盖住底部按钮行', note: 'ScrollView flex:1,footer 在外' },
  'TaskDuePicker.tsx': { count: 1, kinds: ['menu', 'sheet'], keyboard: 'followup: 日期弹层里的时间输入;固定尺寸弹层,手机上键盘可能盖住下半', note: 'duePanelPlacement 固定尺寸日历' },
  'ScheduleClockPicker.tsx': { count: 1, kinds: ['sheet'], keyboard: 'n/a: 只有小时/分钟网格,没有文本输入,手机上不弹软键盘', note: '每天/每周的时间选择器:小时 24 格 + 分钟 60 格(可滚动) + 常用时刻' },
  'TaskListCellEditor.tsx': { count: 1, kinds: ['menu'], keyboard: 'n/a: 列表格子编辑器只在桌面鼠标表格上打开(TaskListTable live = !touch),没有软键盘', input: true, note: '锚在格子下面,anchorSelectMenu 算 maxHeight ≤ 320,选项 ScrollView flexGrow:0' },
  'TaskListFields.tsx': { count: 1, kinds: ['menu'], keyboard: 'followup: 字段设置弹层的搜索框;弹层 maxHeight 按锚点到窗口底算,没扣键盘', note: 'maxHeight = h - y - 12,ScrollView flexShrink:1' },
  'TaskProjectManager.tsx': { count: 1, kinds: ['dialog', 'sheet'], keyboard: 'avoider', input: true, note: '面板 85%,列表可收缩,新增行在外;输入框 ⇒ 键盘避让(本次)' },
  'TaskTagManager.tsx': { count: 1, kinds: ['dialog', 'sheet'], keyboard: 'avoider', input: true, note: '面板 85%,列表 ScrollView 可收缩,合并栏 / 操作面板在外;改名、合并输入 ⇒ 键盘避让' },
  'TaskSelectMenu.tsx': { count: 2, kinds: ['sheet', 'menu'], keyboard: 'followup: 选择菜单的搜索框;没有底部按钮', note: '70% / pos.maxHeight,ScrollView 直接子节点' },
  'TaskTimeCell.tsx': { count: 1, kinds: ['menu'], note: '一行提示' },
  'AppSelect.tsx': { count: 2, kinds: ['menu', 'sheet'], note: '设置的下拉选择(无输入框):桌面浮层 pos.maxHeight ≤ 320 + ScrollView flexGrow:0;手机动作面板 70%,选项 ScrollView 可收缩,「取消」是它后面的兄弟' },
  'ChangelogScreen.tsx': { count: 1, kinds: ['fullscreen'], note: '手机复制预览整屏页:预览 ScrollView flex:1,复制 / 分享按钮条是它后面的兄弟;桌面预览走 DialogFrame' },
  'XiaomiGuideModal.tsx': { count: 1, kinds: ['dialog'], note: '卡片 90%,正文 flexGrow:0 直接子节点,按钮在外' },
};

// —— 取集:src 下每个含 <Modal 的组件文件都登记了,个数对得上 ——
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}
{
  const files = walk(here).map(f => ({ rel: f.slice(here.length).replace(/\\/g, '/').replace(/^\//, ''), src: readFileSync(f, 'utf8') }));
  const withModals = files.filter(f => countModals(f.src) > 0);
  ck(`取集:扫到了一批含 <Modal 的文件(不是 0 —— 分母为 0 和全合规长得一样)`, withModals.length >= 25);
  ck('取集:递归扫到了子目录(src 的全部 .ts/.tsx)', files.length > 100);
  for (const f of withModals) {
    const entry = AUDIT[f.rel];
    ck(`登记:${f.rel} 有 ${countModals(f.src)} 个 <Modal,已按弹窗规则审过并登记`, !!entry && entry.count === countModals(f.src));
  }
  for (const [rel, entry] of Object.entries(AUDIT)) {
    const f = files.find(x => x.rel === rel);
    ck(`登记没过期:${rel} 还在、个数一致`, !!f && countModals(f.src) === entry.count);
  }
  // 键盘:登记了有输入框的,要么用 DialogFrame,要么包 ModalKeyboardAvoider / KeyboardAvoidingView
  // 反过来:有 TextInput 又有 <Modal 的文件必须写明键盘现状(没写 = 漏审了键盘)
  for (const f of withModals) {
    if (!/<TextInput\b/.test(f.src)) continue;
    ck(`键盘:${f.rel} 有 <Modal 也有 <TextInput ⇒ 登记了 keyboard 现状`, !!AUDIT[f.rel]?.keyboard);
  }
  for (const [rel, entry] of Object.entries(AUDIT)) {
    if (entry.keyboard !== 'avoider') continue;
    const src = files.find(x => x.rel === rel)?.src ?? '';
    ck(`键盘:${rel} 登记为 avoider,源码里真有`, /DialogFrame|ModalKeyboardAvoider|KeyboardAvoidingView/.test(src));
  }
}

// —— 判据:DialogFrame 的结构 ——
const frame = read('DialogFrame.tsx');
function frameShapeOk(src: string): { bounded: boolean; shrinkBody: boolean; footerAfterBody: boolean; keyboard: boolean } {
  const bounded = /card:\s*\{[^}]*maxHeight:\s*'100%'/.test(src);
  const shrinkBody = /body:\s*\{[^}]*flexGrow:\s*0[^}]*flexShrink:\s*1/.test(src);
  const bodyAt = src.indexOf('<ScrollView');
  const footerAt = src.indexOf('{footer ?');
  const footerAfterBody = bodyAt > 0 && footerAt > bodyAt && src.indexOf('</ScrollView>') < footerAt;
  const keyboard = /<ModalKeyboardAvoider\b/.test(src);
  return { bounded, shrinkBody, footerAfterBody, keyboard };
}
{
  const shape = frameShapeOk(frame);
  ck('DialogFrame:卡片 maxHeight 100%', shape.bounded);
  ck('DialogFrame:正文 flexGrow 0 + flexShrink 1(能收缩)', shape.shrinkBody);
  ck('DialogFrame:按钮行在 ScrollView 之后、之外', shape.footerAfterBody);
  ck('DialogFrame:包了 ModalKeyboardAvoider', shape.keyboard);
  // 正控:判据得认得出坏形状(被修掉的那个 DialogShell:卡片 maxHeight 100%,但孩子是平铺的 View、按钮在里面)
  const broken = `card: { width: '100%', maxWidth: 460, maxHeight: '100%', padding: 16 },\n<View style={styles.card}>{children}</View>`;
  const b = frameShapeOk(broken);
  ck('正控:旧 DialogShell 的形状被判为不合规(没有可收缩正文、按钮不在外面)', b.bounded && !b.shrinkBody && !b.footerAfterBody);
}

// —— 逐文件:已修的 BUG 不许回退 ——
{
  const um = read('UserManagementPanel.tsx');
  const me = read('MemberEditor.tsx');
  ck('用户管理:三个居中弹窗(新建用户 / 分组 在面板里,成员 在 MemberEditor)都走 DialogFrame,自己不画 <Modal(手机确认单是 RemoveSheet)', countModals(um) === 0 && countModals(me) === 0 && (um.match(/<DialogFrame\b/g) ?? []).length === 2 && (me.match(/<DialogFrame\b/g) ?? []).length === 1 && um.includes('<RemoveSheet ') && me.includes('<RemoveSheet '));
  ck('成员弹窗:正文不交给骨架滚(清单自己滚),卡片高度有界', /<DialogFrame[\s\S]{0,400}scroll=\{false\}[\s\S]{0,200}height=\{/.test(me) && /card: \{[^}]*maxHeight: '100%'/.test(frame));
  ck('用户管理:新建用户的按钮行在 DialogFrame 的 footer 里', /footer=\{<Actions onCancel=\{onClose\} onConfirm=\{submit\}/.test(um));
  ck('用户管理:网络不再平铺 chip(NetworkPicker,可搜索)', um.includes('<NetworkPicker') && !um.includes('netChips') && um.includes('new-user-network-search'));
  ck('用户管理:网络清单内部滚动且有高度上限', /pickerList:\s*\{\s*maxHeight:\s*\d+/.test(um));
  const tc = read('TaskCreateDialog.tsx');
  ck('新建任务:对话框与 sheet 的面板都有 maxHeight', /maxHeight: '92%'/.test(tc) && /maxHeight: '100%'/.test(tc));
  ck('新建任务:表单 ScrollView 能收缩', /style=\{\{ flexGrow: 0, flexShrink: 1 \}\}/.test(tc));
  const chat = read('ChatScreen.tsx');
  ck('聊天:转发面板高度按窗口有界(不是固定 520px)', /forwardPanel:\s*\{[^}]*maxHeight:\s*'100%'/.test(chat));
  ck('聊天:长按 action sheet 有上限且可滚', /actionSheet:\s*\{\s*maxHeight:\s*'85%'/.test(chat));
  const board = read('RequirementBoard.tsx');
  ck('任务筛选菜单:maxHeight 走 menuMaxHeight(不超出窗口底)', board.includes('maxHeight: menuMaxHeight(open.y, viewport.height'));
}

// —— menuMaxHeight ——
{
  ck('锚点靠上:封顶 360', menuMaxHeight(100, 900, 0, 0) === 360);
  ck('锚点靠下:只到窗口底 - 8', menuMaxHeight(600, 800, 0, 0) === 192);
  ck('扣掉底部安全区', menuMaxHeight(600, 800, 0, 24) === 168);
  ck('锚点贴底:下限 120', menuMaxHeight(780, 800, 0, 0) === 120);
  ck('锚点在安全区里:按安全区下沿算', menuMaxHeight(0, 400, 40, 0) === 344);
}

// —— 网络搜索 ——
{
  const nets = [{ network_id: 'net_cur', name: '当前' }, { network_id: 'net_a', name: 'default' }, { network_id: 'net_b', name: 'upload_admin_1781154949660_784' }];
  ck('空搜索:原样(当前网络仍第一)', filterNetworkChoices(nets, '').map(x => x.network_id).join() === 'net_cur,net_a,net_b');
  ck('按名字搜,不分大小写', filterNetworkChoices(nets, 'DEFAULT').map(x => x.network_id).join() === 'net_a');
  ck('按 id 搜', filterNetworkChoices(nets, 'net_b').length === 1);
  ck('没有匹配 → 空', filterNetworkChoices(nets, 'zzz').length === 0);
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
