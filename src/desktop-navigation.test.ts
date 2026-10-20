import fs from 'node:fs';
import path from 'node:path';

// Windows checkouts convert line endings, so multi-line assertions below read a
// normalised copy rather than whatever the clone produced.
const source = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8').replace(/\r\n?/g, '\n');
const agents = fs.readFileSync(path.join(process.cwd(), 'src/AgentsScreen.tsx'), 'utf8').replace(/\r\n?/g, '\n');
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
};

check('server module uses translated server label', source.includes("key: 'server', label: 'nav.server'"));
check('desktop main navigation excludes Settings', source.includes("TABS.filter(tab => tab.key !== 'settings')"));
check('desktop Settings has a dedicated bottom control', source.includes('desktopStyles.railSettings'));
check('Settings control is rendered after the main tabs', source.indexOf('{DESKTOP_MAIN_TABS.map') < source.indexOf('tab={DESKTOP_SETTINGS_TAB}'));
check('desktop Settings opens its own window instead of replacing the main workspace', source.includes('void openSettingsWindow().then(opened => { if (!opened) setScreen({ name: \'settings\' }); })'));
// The rail brand slot must stay the theme mark, not the plated app icon.
// Scheme 16's stroke has no safe-zone padding, so a 54px box overflowed the
// 36px rail and covered the header text. It now matches the 22px nav icons.
check(
  'desktop rail renders the theme mark, not the plated app icon',
  source.includes('<BrandMark size={22} style={desktopStyles.railBrandMark} />') &&
    !/railBrand[\s\S]{0,400}assets\/icon\.png/.test(source),
);
check(
  'rail brand mark matches the 22px nav icons inside the 36px slot',
  /railBrandMark:\s*\{[^}]*width:\s*ds\(22\)[^}]*height:\s*ds\(22\)/.test(source) &&
    /railBrand:\s*\{[^}]*width:\s*ds\(36\)[^}]*height:\s*ds\(36\)/.test(source),
);
check('chat header settings opens read-only info for the current node', source.includes('onOpenNodeSettings={() => setScreen(nodeInfoFromChat(screen))}'));
const detachedStart = source.indexOf('if (dedicatedChatWindow && cfg');
const workspaceStart = source.indexOf("if (desktop && cfg && screen.name !== 'login')");
const detachedBlock = source.slice(detachedStart, workspaceStart);
check('detached chat is selected before the full desktop workspace', detachedStart > 0 && detachedStart < workspaceStart);
check('detached window never mounts the full workspace', detachedBlock.includes('<ChatScreen') && !detachedBlock.includes('<DesktopWorkspace'));
check('detached chat exposes settings for its exact alias', detachedBlock.includes("onOpenNodeSettings={() => setScreen({ name: 'nodeInfo', alias: detachedAlias, daemonMgmt: screen.daemonMgmt })}"));
check('detached settings reuses the node detail screen', detachedBlock.includes('<NodeDetailScreen') && detachedBlock.includes('alias={detachedAlias}'));
check('detached settings returns to the same chat', detachedBlock.includes('onBack={() => setScreen(chatBackFromNodeInfo(screen))}'));
// 0.2.75 rail 重做(Vincent「这边还是偏丑」):激活态是淡 accent 圆角底,不是灰方块;悬停出提示条;角标是小圆标。
const src = source.replace(/\r\n?/g, '\n');
check('rail active state is an accent-tinted pill token', src.includes('railButtonActive: { backgroundColor: colors.railActiveBg }'));
check('rail hover/focus state has its own surface', src.includes('railButtonHover: { backgroundColor: colors.railHover }') && src.includes("surface === 'hover' && styles.railButtonHover"));
check('rail buttons go through the shared RailButton with hover tooltip', src.includes('function RailButton(') && src.includes('railTooltipVisible(hovered ? tab.key : null, tab.key, true)'));
check('rail is 64 wide (× 界面密度) with a hairline divider', src.includes('rail: { width: ds(64), backgroundColor: colors.railBg, borderRightWidth: StyleSheet.hairlineWidth'));
check('rail badge is a pill not inline text', src.includes("railBadge: { position: 'absolute'"));
check('server workspace has a dedicated sidebar', source.includes('<ServerSidebar cfg={cfg}') && source.includes('serverSectionForScreen(screen)'));
check('server workspace exposes node inventory', source.includes("screen.name === 'serverNodes'") && source.includes("name: 'serverNodeDetail'"));
check('server workspace reuses the create-node flow', source.includes("section === 'create'") && source.includes("setScreen({ name: 'picker' })"));
check('desktop agent rows prevent browser text selection', agents.includes("userSelect: 'none'") && agents.includes('selectable={false}'));
check('desktop agent rows reserve long press for mobile', agents.includes('onLongPress={pointer ? undefined : () => onOpenNodeDetail(item.alias)}'));
check('desktop agent rows retain left click and captured right-click menu', agents.includes('onPress={() => openChat(item.alias, item.network_id)}') && agents.includes("addEventListener('contextmenu', handleContextMenu, true)"));
check('desktop agent hover highlights the row with the neutral rowHover token (no drop shadow)', agents.includes('onHoverIn={compact ?') && agents.includes('hoveredAlias === item.alias && { backgroundColor: colors.rowHover }') && !/hoveredAlias === item\.alias && \(?\{[^}]*boxShadow/.test(agents));

// 0.2.76 系统栏托盘 + 新消息通知(Vincent 2026-09-17):只有主窗口接托盘/通知;托盘菜单点 agent 打开那个会话
const src076 = source.replace(/\r\n?/g, '\n');
check('desktop tray is bound only in the main window and opens the picked chat', src076.includes('const trayWindow = tauriDesktop && !initialChat && !initialWorkspaceProfile && !settingsWindow;') && src076.includes("alias => setScreen({ name: 'chat', alias }),"));
// 0.2.82:托盘下拉换成自绘面板 ⇒ bindDesktopTray 多了「忽略全部」回调(签名变了,契约跟着变)。
check('desktop tray wires the panel dismiss-all back to the main window', src076.includes('dismissAllForConfig(cfg)'));
// 0.2.81:通知要能点进会话 ⇒ DesktopNotifier 接上和托盘同一条 onOpenChat 路(props 变了,契约跟着变)。
// 0.2.107:再带上账号键(按 agent 的「消息免打扰」按账号存)。
check('desktop notifier mounts only in the main window', src076.includes("{trayWindow ? <DesktopNotifier onOpenChat={alias => setScreen({ name: 'chat', alias })} onOpenTask={(id, net) => openTaskRef(id, net, cfg, setScreen)} profileKey={notifyProfileKey(cfg)} /> : null}"));
