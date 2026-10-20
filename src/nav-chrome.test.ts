// Navigation chrome for the non-desktop app: left rail on the Android wide layout, bottom
// tabs on the phone, nothing on desktop (it has its own rail). ck-style, self-executing.
import { readFileSync } from 'node:fs';
import { chooseAppLayout } from './wide-layout';
import {
  MOBILE_RAIL_ITEM, MOBILE_RAIL_WIDTH, PHONE_IN_PAGE_LEAF_SCREENS, PHONE_LEAF_SCREENS, RAIL_BRAND_MIN_HEIGHT,
  contentWidthBesideRail, navActiveKey, navChromeFor, phoneInPageLeaf, railShowsBrand, railUnreadTotal, screenForNavPress,
} from './nav-chrome';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; 2308CPXD0C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

// The decision end to end, as a pure function over platform × width (fold state = width:
// folded cover ≈ 392 dp, unfolded inner ≈ 800–950 dp) × screen.
const chrome = (os: string, width: number, screen = 'agents', opts: { tauri?: boolean; ua?: string } = {}) =>
  navChromeFor(chooseAppLayout({ os, tauri: !!opts.tauri, userAgent: opts.ua ?? '', width }), screen);

// 'server' is no longer a phone tab (Vincent 2026-09-29 「服务器 换成 任务」): it is pushed from 设置.
const TAB_SCREENS = ['agents', 'scheduled', 'settings', 'tasks', 'messages'];
const ALL_SCREENS = [...TAB_SCREENS, 'server', 'serverDaemon', 'chat', 'nodeInfo', 'nodeDetail', 'picker', 'wizard', 'taskDetail', 'logs', 'serverNodes', 'serverNodeDetail'];

// ── Android wide (unfolded / tablet / landscape): rail everywhere once signed in ──
for (const w of [700, 800, 850, 880, 1200, 1280]) {
  for (const s of ALL_SCREENS) ck(`android @${w} ${s} → rail`, chrome('android', w, s) === 'rail');
}
ck('web export with an Android UA @1200 → rail (screenshot harness path)', chrome('web', 1200, 'agents', { ua: ANDROID_UA }) === 'rail');
ck('web export with an Android UA @850 (unfolded portrait) → rail', chrome('web', 850, 'chat', { ua: ANDROID_UA }) === 'rail');

// ── Android narrow (folded cover / phone portrait): bottom tabs, leaves bare, exactly as before ──
for (const w of [360, 390, 392, 480, 600, 699]) {
  for (const s of TAB_SCREENS) ck(`android @${w} ${s} → bottomTabs`, chrome('android', w, s) === 'bottomTabs');
  for (const s of ['chat', 'nodeInfo', 'nodeDetail', 'picker', 'wizard', 'taskDetail', 'logs']) {
    ck(`android @${w} leaf ${s} → none`, chrome('android', w, s) === 'none');
  }
  ck(`android @${w} server (pushed from 设置) → none`, chrome('android', w, 'server') === 'none');
}
ck('threshold edge: 699.9 → bottomTabs, 700 → rail', chrome('android', 699.9) === 'bottomTabs' && chrome('android', 700) === 'rail');

// ── never a rail on login ──
for (const w of [390, 900]) ck(`login @${w} → none`, chrome('android', w, 'login') === 'none');

// ── iPad landscape: the same rail as the Android wide layout; portrait keeps bottom tabs ──
for (const [w, h] of [[1024, 768], [1180, 820], [1366, 1024]]) {
  const l = chooseAppLayout({ os: 'ios', tauri: false, width: w, height: h, isPad: true });
  ck(`iPad landscape ${w}×${h} agents → rail`, navChromeFor(l, 'agents') === 'rail');
  const pt = chooseAppLayout({ os: 'ios', tauri: false, width: h, height: w, isPad: true });
  ck(`iPad portrait ${h}×${w} agents → bottomTabs`, navChromeFor(pt, 'agents') === 'bottomTabs');
}

// ── iPhone (no isPad) and plain web: phone behaviour at every width ──
for (const w of [390, 834, 1024, 1366]) {
  ck(`ios @${w} agents → bottomTabs`, chrome('ios', w) === 'bottomTabs');
  ck(`plain web @${w} agents → bottomTabs`, chrome('web', w, 'agents', { ua: MAC_UA }) === 'bottomTabs');
}

// ── desktop (Tauri ≥ 860): none here, DesktopWorkspace has its own rail ──
for (const w of [860, 1280, 1920]) for (const s of ALL_SCREENS) ck(`tauri @${w} ${s} → none`, chrome('web', w, s, { tauri: true, ua: MAC_UA }) === 'none');
// narrow Tauri window falls back to the phone stack, as before
ck('tauri @800 agents → bottomTabs (narrow desktop window = phone stack, unchanged)', chrome('web', 800, 'agents', { tauri: true, ua: MAC_UA }) === 'bottomTabs');

// ── in-page second-level pages (设置 → 语音输入 …): no tab bar on the phone, like WeChat ──
{
  const phone = chooseAppLayout({ os: 'android', tauri: false, userAgent: '', width: 390 });
  const wide = chooseAppLayout({ os: 'android', tauri: false, userAgent: '', width: 900 });
  ck('phone settings list → bottomTabs', navChromeFor(phone, 'settings', phoneInPageLeaf('settings', false)) === 'bottomTabs');
  ck('phone settings sub-page → none (tab bar hidden)', navChromeFor(phone, 'settings', phoneInPageLeaf('settings', true)) === 'none');
  ck('two-pane settings sub-page keeps the rail', navChromeFor(wide, 'settings', phoneInPageLeaf('settings', true)) === 'rail');
  ck('a stale sub-page flag never hides tabs on another tab screen', navChromeFor(phone, 'agents', phoneInPageLeaf('agents', true)) === 'bottomTabs');
  ck('in-page leaf screens = settings', JSON.stringify(PHONE_IN_PAGE_LEAF_SCREENS) === JSON.stringify(['settings']));
}

// ── phone leaves = exactly the screens App rendered without mobileTabBar before ──
ck('phone leaf set', JSON.stringify([...PHONE_LEAF_SCREENS].sort()) === JSON.stringify(['chat', 'dm', 'group', 'login', 'logs', 'nodeDetail', 'nodeInfo', 'picker', 'serverDaemon', 'taskDetail', 'wizard']));

// ── active destination ──
for (const s of ['agents', 'chat', 'nodeInfo', 'nodeDetail', 'picker', 'wizard']) ck(`${s} lights Agent`, navActiveKey(s) === 'agents');
for (const s of ['server', 'serverPending', 'serverDaemon', 'serverNodes', 'serverNodeDetail', 'logs', 'hubSkills', 'hubTokens', 'hubEnv', 'hubProviders']) ck(`${s} lights 服务器`, navActiveKey(s) === 'server');
ck('scheduled lights 定时任务', navActiveKey('scheduled') === 'scheduled');
ck('settings lights 设置', navActiveKey('settings') === 'settings');
ck('taskDetail lights the left rail 任务', navActiveKey('taskDetail') === 'tasks');
ck('phone tab-level screens light themselves (same as the old mobileTabBar(screen.name))', TAB_SCREENS.every(s => navActiveKey(s) === s));

// ── pressing a destination ──
ck('Agent while a chat is open in the pane → no-op (chat stays)', screenForNavPress('agents', 'chat') === null);
ck('Agent while on node details → no-op', screenForNavPress('agents', 'nodeDetail') === null);
ck('Agent from settings → agents', screenForNavPress('agents', 'settings')?.name === 'agents');
ck('服务器 from chat → server', screenForNavPress('server', 'chat')?.name === 'server');
ck('服务器 while on logs → no-op', screenForNavPress('server', 'logs') === null);
ck('设置 from scheduled → settings', screenForNavPress('settings', 'scheduled')?.name === 'settings');

// ── touch sizing ──
ck('rail item hit box ≥ 44 × 44 (both sides)', MOBILE_RAIL_ITEM.width >= 44 && MOBILE_RAIL_ITEM.height >= 44);
ck('rail item hit box ≥ 48 tall (Material)', MOBILE_RAIL_ITEM.height >= 48);
ck('rail wide enough for its items', MOBILE_RAIL_WIDTH >= MOBILE_RAIL_ITEM.width);
ck('rail no wider than Material rail (80)', MOBILE_RAIL_WIDTH <= 80);

// ── brand/version only when there is height for them ──
ck('brand threshold is 480', RAIL_BRAND_MIN_HEIGHT === 480);
ck('phone landscape (390 tall) hides brand', !railShowsBrand(390));
ck('479 hides, 480 shows', !railShowsBrand(479) && railShowsBrand(480));
ck('unfolded landscape (850 tall) shows brand', railShowsBrand(850));
// Worst case that must fit without the brand: 390 tall − ~30 status − ~48 gesture − 12 top − 8 bottom
// ≈ 292 dp for 4 items of 56 plus 3 gaps of 6 = 242.
ck('4 destinations fit a 390-tall landscape phone without scrolling', 4 * MOBILE_RAIL_ITEM.height + 3 * 6 <= 390 - 30 - 48 - 12 - 8);
ck('5 destinations do not fit that phone, so the rail main column must scroll', 5 * MOBILE_RAIL_ITEM.height + 4 * 6 > 390 - 30 - 48 - 12 - 8);

// ── width beside the rail ──
ck('content width = window − rail', contentWidthBesideRail(1200) === 1200 - MOBILE_RAIL_WIDTH);
ck('content width subtracts both insets', contentWidthBesideRail(1200, 40, 24) === 1200 - MOBILE_RAIL_WIDTH - 64);
ck('content width never negative', contentWidthBesideRail(10, 100, 100) === 0);

// ── badge total ──
ck('unread total sums positive counts', railUnreadTotal({ a: 2, b: 3 }) === 5);
ck('unread total ignores 0 / negative / NaN', railUnreadTotal({ a: 0, b: -4, c: Number.NaN, d: 1 }) === 1);
ck('unread total of nothing is 0', railUnreadTotal({}) === 0);

// ── component wiring (react-native import → checked on source text) ──
const rail = readFileSync(new URL('./MobileNavRail.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
ck('rail settings item is rendered after the main destinations (pinned to bottom, like desktop)',
  rail.indexOf("{main.map(item)}") > 0 && rail.indexOf("{main.map(item)}") < rail.indexOf('{settings ? item(settings) : null}'));
ck('rail main destinations scroll so a fifth item cannot cover 设置', rail.includes('<ScrollView') && rail.includes('showsVerticalScrollIndicator={false}') && rail.indexOf('<ScrollView') < rail.indexOf('{settings ? item(settings) : null}'));
ck('rail excludes settings from the main list', rail.includes("tabs.filter(tab => tab.key !== 'settings')"));
ck('rail items are density-scaled hit boxes from mobileRailItem (64×56 at 标准)', rail.includes('width: mobileRailItem(uiScale().densityFactor).width,') && rail.includes('height: mobileRailItem(uiScale().densityFactor).height,'));
ck('rail items expose tab role + selected state', rail.includes('accessibilityRole="tab"') && rail.includes('accessibilityState={{ selected }}'));
ck('rail shows translated labels (touch has no hover tooltip)', rail.includes('{t(tab.label)}</Text>'));
ck('rail badge on Agent uses the same unread counts as the list/tray', rail.includes('railUnreadTotal(agentUnreadCounts(snap))') && rail.includes("tab.key === 'agents' ? railBadgeText(unread) :"));
// #429: 任务 carries the task-activity badge (task-unread-store.ts), not the chat unread count.
ck('rail badge on 任务 is the task-activity count', rail.includes('useTaskUnreadCount()') && rail.includes("tab.key === 'tasks' ? railBadgeText(taskUnread) : null"));
ck('rail badge updates live from the unread store', rail.includes('subscribeUnread(() => setSnap(getUnreadSnapshot()))'));
ck('rail pads the left + bottom insets and grows by the left one', rail.includes('width: mobileRailWidth(uiScale().densityFactor) + insetLeft, paddingLeft: insetLeft, paddingBottom: 8 + insetBottom'));
ck('rail uses the desktop rail palette', rail.includes('backgroundColor: colors.railBg') && rail.includes('backgroundColor: colors.railActiveBg'));
ck('rail uses the theme brand mark (not the plated app icon)', rail.includes('<BrandMark size={58}') && !rail.includes('assets/icon.png') && !rail.includes('android-icon-foreground.png'));
ck('rail styles are built per mount (theme switch remounts)', rail.includes('const s = useMemo(makeStyles, []);'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
