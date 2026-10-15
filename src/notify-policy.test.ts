// 0.2.76 Vincent:「有新消息做个提示 类似飞书这样,再做个消息提示音」—— 通知判据 + 托盘模型 + 免打扰 + 提示音。
import fs from 'node:fs';
import path from 'node:path';
import { bodyOf, decide, fromInboxRows, fromUserMessages, groupByAgent, hubTsToMs, initialSeen, notificationTitle, pickNew, suppressedByPresence, FRESH_WINDOW_MS, SEEN_CAP } from './notify-policy';
import { inQuietHours, parseClock, DEFAULT_QUIET_HOURS } from './quiet-hours';
import { trayModelEqual, trayModelFrom, TRAY_MAX_ITEMS } from './tray-menu-model';
import { parseNotifySettings, DEFAULT_NOTIFY_SETTINGS } from './notify-settings';
import { shouldPlayChime, CHIME_MIN_GAP_MS } from './chime';
import { CHIME_DATA_URI } from './chime-data';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

// ── 行 → Incoming ──
const um = fromUserMessages([
  { message_id: 'm1', from_session: '通信龙', title: '标题', content: '正文', created_at: '2026-09-17 10:00:00' },
  { message_id: '', from_session: 'x' }, { message_id: 'm2', from_session: '  ' } as any,
]);
ck('user_inbox 行:只留有 id 和发件人的,正文 = 标题:正文', um.length === 1 && um[0].id === 'u:m1' && um[0].agent === '通信龙' && um[0].body === '标题:正文');
const ib = fromInboxRows([
  { id: 'r1', from_alias: 'A', to_alias: 'admin', type: 'reply', content: 'hi', created_at: '2026-09-17T10:00:00' },
  { id: 'r2', from_alias: 'B', to_alias: 'someone', type: 'reply' },
  { id: 'r3', from_alias: 'admin', to_alias: 'admin', type: 'task' },
  { id: 'r4', from_alias: 'C', to_alias: 'admin', type: 'status' },
], 'admin');
ck('inbox 行:只算发给我的 reply/task/message,不算自己发的和 status', ib.length === 1 && ib[0].id === 'i:r1' && ib[0].createdAt === '2026-09-17 10:00:00');
ck('没有用户名 → 不算任何 inbox 行', fromInboxRows([{ id: 'r1', from_alias: 'A', to_alias: 'admin' }], '').length === 0);
ck('正文折叠空白并截到 80 字加省略号', bodyOf('a  b\n c') === 'a b c' && bodyOf('x'.repeat(100)) === 'x'.repeat(80) + '…' && bodyOf(undefined) === '');

// ── 首份快照只登记,之后只提醒新鲜的新行 ──
const now = Date.parse('2026-09-17T10:05:00Z');
const fresh = { id: 'a', agent: 'A', body: 'x', createdAt: '2026-09-17 10:04:00' };
const stale = { id: 'b', agent: 'B', body: 'y', createdAt: '2026-09-17 09:00:00' };
const noTs = { id: 'c', agent: 'C', body: 'z', createdAt: null };
const s1 = pickNew(initialSeen(), [fresh, stale], now);
ck('首份快照:登记 2 条,不提醒', s1.toNotify.length === 0 && s1.seen.seeded && s1.seen.ids.size === 2);
const s2 = pickNew(s1.seen, [fresh, stale, { ...fresh, id: 'd' }, { ...stale, id: 'e' }, noTs], now);
ck('第二份:只提醒新的且新鲜的(d 与无时间戳的 c),老的 e 不提醒', s2.toNotify.map(r => r.id).sort().join(',') === 'c,d');
ck('见过的不再提醒', pickNew(s2.seen, [fresh, { ...fresh, id: 'd' }], now).toNotify.length === 0);
ck('新鲜窗口是 10 分钟', FRESH_WINDOW_MS === 600000 && hubTsToMs('2026-09-17 10:04:00') === now - 60000 && hubTsToMs('bad') === null);
const many = Array.from({ length: SEEN_CAP + 50 }, (_, i) => ({ id: `n${i}`, agent: 'A', body: '', createdAt: null }));
ck('seen 集合封顶', pickNew(s2.seen, many, now).seen.ids.size === SEEN_CAP);

// ── 抑制 ──
const quietOff = { soundEnabled: true, quiet: DEFAULT_QUIET_HOURS };
ck('窗口前台且正开着这个会话 → 不提醒', suppressedByPresence('A', { windowFocused: true, openConversation: 'A' }) && decide('A', { windowFocused: true, openConversation: 'A' }, quietOff, 600).notify === false);
ck('开着会话但窗口不在前台 → 提醒', decide('A', { windowFocused: false, openConversation: 'A' }, quietOff, 600).notify === true);
ck('前台但开的是别的会话 → 提醒 + 响铃', (() => { const d = decide('A', { windowFocused: true, openConversation: 'B' }, quietOff, 600); return d.notify && d.sound; })());
ck('提示音关 → 提醒不响铃', (() => { const d = decide('A', { windowFocused: false, openConversation: null }, { soundEnabled: false, quiet: DEFAULT_QUIET_HOURS }, 600); return d.notify && !d.sound; })());
ck('免打扰时段 → 不提醒也不响', decide('A', { windowFocused: false, openConversation: null }, { soundEnabled: true, quiet: { enabled: true, start: '22:00', end: '08:00' } }, 23 * 60).notify === false);

// ── 合并 ──
const g = groupByAgent([{ id: '1', agent: 'A', body: 'x', createdAt: null }, { id: '2', agent: 'A', body: 'y', createdAt: null }, { id: '3', agent: 'B', body: '', createdAt: null }]);
ck('按 agent 合并:A 两条取最后正文,B 一条', g.length === 2 && g[0].count === 2 && g[0].body === 'y' && g[1].count === 1);
ck('标题:多条带条数', notificationTitle('A', 1) === 'A' && notificationTitle('A', 3) === 'A(3 条新消息)');

// ── 免打扰 ──
ck('parseClock', parseClock('22:00') === 1320 && parseClock('8:05') === 485 && parseClock('24:00') === null && parseClock('abc') === null);
ck('跨午夜 22:00→08:00', inQuietHours({ enabled: true, start: '22:00', end: '08:00' }, 23 * 60) && inQuietHours({ enabled: true, start: '22:00', end: '08:00' }, 7 * 60) && !inQuietHours({ enabled: true, start: '22:00', end: '08:00' }, 12 * 60));
ck('同日 12:00→14:00,边界:起点含终点不含', inQuietHours({ enabled: true, start: '12:00', end: '14:00' }, 12 * 60) && !inQuietHours({ enabled: true, start: '12:00', end: '14:00' }, 14 * 60));
ck('关闭永不静音;起止相同全天静音', !inQuietHours({ enabled: false, start: '00:00', end: '00:00' }, 0) && inQuietHours({ enabled: true, start: '09:00', end: '09:00' }, 500));

// ── 托盘模型 ──
const model = trayModelFrom({ A: 3, B: 0, C: 7.9, ' ': 5, D: -1, E: 3 });
ck('托盘:去 0/负/空名,向下取整,按数降序同数按名', model.total === 13 && model.items.map(i => `${i.alias}:${i.count}`).join(',') === 'C:7,A:3,E:3');
const big = trayModelFrom(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`a${i}`, i + 1])));
ck('托盘模型不截断(0.2.92):30 个会话都在,总数 = 各行之和', big.items.length === 30 && big.items.length > TRAY_MAX_ITEMS && big.total === 465 && big.items[0].count === 30 && big.items.reduce((a, i) => a + i.count, 0) === big.total);
ck('模型相等判断', trayModelEqual(model, trayModelFrom({ A: 3, C: 7, E: 3 })) && !trayModelEqual(model, trayModelFrom({ A: 4, C: 7, E: 3 })) && !trayModelEqual(null, model));

// ── 设置解析 ──
ck('设置:空/坏 JSON → 默认(提示音开,免打扰关)', parseNotifySettings(null) === DEFAULT_NOTIFY_SETTINGS && parseNotifySettings('{') === DEFAULT_NOTIFY_SETTINGS && DEFAULT_NOTIFY_SETTINGS.soundEnabled && !DEFAULT_NOTIFY_SETTINGS.quiet.enabled);
const parsed = parseNotifySettings(JSON.stringify({ soundEnabled: false, quiet: { enabled: true, start: '23:30', end: '99:00' } }));
ck('设置:坏时间回默认,其余照读', parsed.soundEnabled === false && parsed.quiet.enabled && parsed.quiet.start === '23:30' && parsed.quiet.end === '08:00');

// ── 提示音 ──
ck('提示音是内置 WAV data URI 且 ≤ 20 KB', CHIME_DATA_URI.startsWith('data:audio/wav;base64,') && CHIME_DATA_URI.length < 20 * 1024);
ck('同一轮内不重复响', !shouldPlayChime(1000, 1000 - 1) && shouldPlayChime(1000 + CHIME_MIN_GAP_MS, 1000));

// ── 接线契约 ──
const norm = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n?/g, '\n');
const app = norm('../App.tsx'), settings = norm('SettingsScreen.tsx'), notifier = norm('DesktopNotifier.tsx'), tray = norm('desktop-tray.ts');
// 0.2.82:托盘下拉换成自绘面板,bindDesktopTray 多了「忽略全部」回调 ⇒ 调用形状变了,契约跟着变。
ck('App:只有主窗口接托盘,点行打开会话', app.includes('const trayWindow = tauriDesktop && !initialChat && !initialWorkspaceProfile && !settingsWindow;') && app.includes("alias => setScreen({ name: 'chat', alias }),"));
// 0.2.81:通知要能点进会话 ⇒ 通知组件接上和托盘同一条 onOpenChat 路。
ck('App:通知组件只在主窗口挂', app.includes("{trayWindow ? <DesktopNotifier onOpenChat={alias => setScreen({ name: 'chat', alias })} onOpenTask={(id, net) => openTaskRef(id, net, cfg, setScreen)} profileKey={notifyProfileKey(cfg)} /> : null}"));
ck('通知组件订阅 unread-store,合并后一轮只响一次', notifier.includes('subscribeUnread(onSnapshot)') && notifier.includes('if (ring) playChime();'));
ck('通知组件等 user_inbox 拉到后才登记首份快照(登录不弹历史)', notifier.includes('if (!seen.current.seeded && !snap.serverBody) return;'));
// 0.2.95:函数体搬到 agent-unread-counts.ts(节点列表「新消息」组也用它),托盘只委托 ⇒ 契约跟着搬。
const unreadCounts = norm('agent-unread-counts.ts');
ck('托盘数用列表同一函数算', unreadCounts.includes('unreadCountForAgentRow(snap.serverBody, snap.ledger, alias, reply)') && tray.includes('return agentUnreadCounts(snap);') && tray.includes("invoke('tray_update'"));
ck('设置页有翻译的「消息提示音」和「免打扰时段」', /<SettingsSwitchRow\s+label=\{tr\('settings\.copy\.49'\)\}/.test(settings) && /<SettingsSwitchRow\s+label=\{tr\('settings\.copy\.51'\)\}/.test(settings));
const rust = norm('../src-tauri/src/tray.rs'), lib = norm('../src-tauri/src/lib.rs'), cargo = norm('../src-tauri/Cargo.toml'), cap = norm('../src-tauri/capabilities/default.json');
// 0.2.79 起嵌的是 @2x:tray-icon 把状态栏图像强制成 18pt 高,22px 那份在 Retina 上
// 是放大后显示。图标本身的形状判据在 src/tray-icon-assets.test.ts(它才是 0.2.76
// 那块「灰方片」的回归测试),这里只钉「macOS 走 template + 嵌的是哪一份」。
ck('Rust:托盘 macOS 用 template 图标(@2x),菜单点行 emit tray-open-chat', rust.includes('icon_as_template(true)') && rust.includes('app.emit("tray-open-chat"') && rust.includes('include_image!("./tray/trayTemplate@2x.png")'));
ck('Rust:tray_update 已注册,notification 插件已挂', lib.includes('tray::tray_update,') && lib.includes('.plugin(tauri_plugin_notification::init())'));
ck('Cargo:tray-icon + image-png 特性,notification 插件', cargo.includes('"tray-icon", "image-png"') && cargo.includes('tauri-plugin-notification = "2"'));
ck('capability:notification:default + 聚焦窗口权限', cap.includes('"notification:default"') && cap.includes('"core:window:allow-set-focus"'));
const chatNotify = norm('../src-tauri/src/chat_notify.rs');
ck('点通知走命令,macOS 无点击回调时回退焦点推断', notifier.includes("invoke<boolean>('show_chat_notification'") && notifier.includes('if (!routed) target.current = recordNotified'));
ck('Rust:点正文打开托盘那条会话', chatNotify.includes('notification.action("default", "打开")') && chatNotify.includes('app.emit("tray-open-chat", alias)') && lib.includes('chat_notify::show_chat_notification'));
ck('Rust:macOS 不在主线程轮询已送达通知', chatNotify.includes('#[cfg(target_os = "macos")]\n        drop(handle);') && chatNotify.includes('!cfg!(target_os = "macos")') && chatNotify.includes('#[cfg(not(target_os = "macos"))]\n        {\n            // 回调'));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
