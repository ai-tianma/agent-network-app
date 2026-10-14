// 0.2.76 新消息系统通知 + 提示音(Vincent 2026-09-17:「有新消息做个提示 类似飞书这样,再做个消息提示音」)。
// 数据源 = unread-store 的快照(user_inbox 行 + 发给我的 inbox 回复行),不另开轮询;
// 首份快照只登记不提醒(登录时的历史不该弹一屏)。人正开着那个会话且窗口在前台 → 不提醒;
// 免打扰时段 → 不提醒;提示音可关。系统通知走 @tauri-apps/plugin-notification(桌面),
// 网页端退回 Web Notification;手机端不挂这个组件。

import { useEffect, useRef } from 'react';
import { playChime } from './chime';
import { loadNotifySettings, mutedAgents } from './notify-settings';
import {
  decide,
  groupByAgent,
  incomingFromSnapshot,
  initialSeen,
  notificationTitle,
  pickNew,
  type Presence,
  type SeenState,
} from './notify-policy';
import { localMinutes } from './quiet-hours';
import { plainTextForNotification } from './notify-text';
import { initialNotifyTarget, recordNotified, targetOnFocus, type NotifyTargetState } from './notify-target';
import { getUnreadSnapshot, subscribeUnread, type UnreadStoreSnapshot } from './unread-store';
import { subscribeSystemNotice } from './notifier-bus';
import { dueLogLine, dueReminderFromNotice, parseTaskOpenAlias, planDueReminder, taskOpenAlias } from './due-reminder-notify';

const isTauri = () => !!(globalThis as any).__TAURI_INTERNALS__;

export function presenceOf(snap: UnreadStoreSnapshot): Presence {
  const focused = typeof document !== 'undefined' && typeof (document as any).hasFocus === 'function'
    ? (document as any).hasFocus() as boolean
    : snap.ledger.foreground;
  return { windowFocused: focused, openConversation: snap.ledger.open };
}

async function sendSystemNotification(alias: string, title: string, body: string, onClick?: (alias: string) => void): Promise<boolean> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<boolean>('show_chat_notification', { alias, title, body });
    } catch {
      // 旧壳没有这条命令,退回插件。插件点了不会回报,只能靠下面的焦点推断。
    }
    const n = await import('@tauri-apps/plugin-notification');
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === 'granted';
    if (!granted) return false;
    n.sendNotification({ title, body });
    return false;
  }
  const N = (globalThis as any).Notification as (new (t: string, o?: { body?: string }) => unknown) & { permission?: string; requestPermission?: () => Promise<string> } | undefined;
  if (typeof N !== 'function') return false;
  let permission = N.permission;
  if (permission === 'default' && N.requestPermission) permission = await N.requestPermission();
  if (permission !== 'granted') return false;
  const shown = new N(title, { body }) as { onclick?: () => void };
  shown.onclick = () => onClick?.(alias);
  return true;
}

export default function DesktopNotifier({ onOpenChat, onOpenTask, profileKey = '' }: {
  onOpenChat?: (alias: string) => void;
  /** #499 点「任务提醒」的系统通知(网页端 Notification.onclick)→ 打开任务。桌面壳走 tray-open-chat,见 App。 */
  onOpenTask?: (requirementId: string, networkId: string | null) => void;
  profileKey?: string;
} = {}) {
  const notifyProfileKeyRef = useRef(profileKey);
  notifyProfileKeyRef.current = profileKey;
  const seen = useRef<SeenState>(initialSeen());
  const target = useRef<NotifyTargetState>(initialNotifyTarget());
  const openChat = useRef(onOpenChat);
  openChat.current = onOpenChat;
  const openTask = useRef(onOpenTask);
  openTask.current = onOpenTask;

  // #499「任务提醒」的到期提醒:窗口在前台时顶部提示已经弹了;窗口没焦点(最小化 / 在别的应用里)时
  // 与 agent 消息一样发一条系统通知,点它打开那张任务。总开关 / 免打扰时段与 agent 消息同一份判据。
  useEffect(() => subscribeSystemNotice(n => {
    const rem = dueReminderFromNotice(n);
    if (!rem || !rem.requirementId) return;
    const plan = planDueReminder(rem, {
      profileKey: notifyProfileKeyRef.current,
      foreground: presenceOf(getUnreadSnapshot()).windowFocused,
      source: 'stream',
      settings: loadNotifySettings(),
      minutes: localMinutes(),
    });
    const outcome = 'skip' in plan ? plan.skip : 'notified';
    try { console.info(dueLogLine({ source: 'stream', outcome, messageId: rem.messageId, requirementId: rem.requirementId, platform: 'desktop' })); } catch { /* 没有 console */ }
    if ('skip' in plan) return;
    const ref = { requirementId: rem.requirementId, networkId: rem.networkId };
    void sendSystemNotification(taskOpenAlias(ref), plan.post.title, plan.post.body, alias => {
      const target = parseTaskOpenAlias(alias);
      if (target) openTask.current?.(target.requirementId, target.networkId);
    }).catch(() => { /* 权限被拒/平台不支持 */ });
    if (plan.post.alert) playChime();
  }), []);

  // 0.2.83:两条激活信号都接——点 toast 时 Windows 会把应用带到前台(focus);若窗口本来就在
  // 前台、只是被 toast 短暂遮过,能观测到的可能只是 visibilitychange。目标是不是「正在看的
  // 那个会话」在激活当刻判,不在通知当刻判(见 notify-target.ts 文件头)。
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onActivate = () => {
      const picked = targetOnFocus(target.current, Date.now(), getUnreadSnapshot().ledger.open);
      target.current = picked.next;
      if (picked.agent) openChat.current?.(picked.agent);
    };
    const onVisible = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') onActivate(); };
    window.addEventListener('focus', onActivate);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onActivate);
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    const onSnapshot = () => {
      const snap = getUnreadSnapshot();
      // 登录后第一份快照可能还没拉到 user_inbox(serverBody 为空)——那时登记会把随后到达的
      // 历史行当成「新消息」弹一屏;等 serverBody 有了再登记首份。
      if (!seen.current.seeded && !snap.serverBody) return;
      const incoming = incomingFromSnapshot(snap);
      const picked = pickNew(seen.current, incoming, Date.now());
      seen.current = picked.seen;
      if (!picked.toNotify.length) return;
      const stored = loadNotifySettings();
      // 0.2.107:总开关 + 本账号的「消息免打扰」和手机端同一份判据(decide)。
      const settings = { ...stored, muted: mutedAgents(stored, notifyProfileKeyRef.current) };
      const presence = presenceOf(snap);
      const minutes = localMinutes();
      let ring = false;
      for (const group of groupByAgent(picked.toNotify)) {
        const d = decide(group.agent, presence, settings, minutes);
        if (!d.notify) continue;
        ring = ring || d.sound;
        // 正文里可能是 Markdown(链接语法 + 绝对路径),toast 只读得下一两行 → 压成纯文本。
        void sendSystemNotification(
          group.agent,
          notificationTitle(group.agent, group.count),
          plainTextForNotification(group.body),
          openChat.current,
        ).then(routed => {
          if (!routed) target.current = recordNotified(target.current, group.agent, Date.now());
        }).catch(() => { /* 权限被拒/平台不支持 */ });
      }
      if (ring) playChime();
    };
    onSnapshot();
    return subscribeUnread(onSnapshot);
  }, []);
  return null;
}
