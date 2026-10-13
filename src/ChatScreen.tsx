import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-chat';
import './i18n-tasks';
import TaskExecutionNotice from './TaskExecutionNotice';
import { taskExecutionState } from './task-execution';
import ModalKeyboardAvoider from './ModalKeyboardAvoider';
import { PanResponder, ActivityIndicator, Alert, BackHandler, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layoutOs, useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { Ionicons } from './icons';
import * as Clipboard from 'expo-clipboard';
import AliasAvatar from './AliasAvatar';
import AttachmentFileDesktop from './AttachmentFileDesktop';
import AuthedThumb, { AttachmentFile, AuthedVideo, mimeFromName } from './AuthedThumb';
import AuthedWebThumb from './AuthedWebThumb';
import { sendFailureReason, type SendFailureReason } from './send-failure-reason';
import { ackAgentMessages, ackUserMessages, createDashboardRequestId, dashboardRequestIdForLocalId, fetchNodeStatus, fetchStatus, fetchChatUserMessages, fetchTasks, sendTask, HubConfig, HubTask, Session, TaskAttachment, TaskPriority, type HostSupervisorDaemon } from './api';
import { proactiveItemsForAgent } from './proactive-messages';
import { replyQuoteFor } from './reply-quote';
import { nextFocusStep } from './message-focus';
import { bubbleLayout, desktopBubbleCap } from './bubble-layout';
import { notifyOutboxListeners, outboxAdd, outboxEntry, outboxForAlias, outboxLiveImages, outboxMarkFailed, outboxMarkPending, outboxRemove, outboxRemoveAttachment, subscribeOutbox } from './outbox';
import { imagesForResend, planResend, uploadForSend, type ResendImage } from './resend-plan';
import { beginSend, endSend, orphanedPendingIds, settleEchoes } from './send-lifecycle';
import { recordSendBubble } from './send-timing';
import { mayApplySendResult, shouldExposeSendFailure } from './send-reconciliation';
import { conversationKey, conversationScope, createConversationRequestGate, createConversationStore } from './conversation-store';
import { resolveSender } from './chat-sender';
import { keyboardAvoidEnabled, useKeyboardVisible } from './keyboard-visibility';
import { useScreenKeyboardInset } from './screen-keyboard-inset';
import { nextIdentityRetryDelay } from './identity-retry';
import { COMPOSER_CARD_INSET, COMPOSER_HEIGHT_DEFAULT, composerCardHeight, composerDragHandlers, inputMaxHeight, loadComposerHeight, lockDocumentSelection, saveComposerHeight } from './composer-resize';
import {
  ATTACH_ENABLED,
  attachmentTextHint,
  pickCameraPhoto,
  pickDocument,
  pickFiles,
  pickImages,
  prepareForUpload,
  uploadImage,
  toTaskAttachment,
  PickedImage,
} from './attach';
import { attachmentsFromClipboard, isTauriDesktop, releaseClipboardAttachment } from './clipboard-attachment';
import { conversationDraftKey, stashDraftAttachments, takeDraftAttachments, useComposerDraft } from './composer-drafts';
import { pointerUi } from './pointer-ui';
import { attachmentsFromFiles, filesFromTransfer, plusPressAction, transferHasFiles } from './desktop-file-intake';
import { addToDraft, draftCountLabel, draftImageCount, isDraftImage, MAX_DRAFT_IMAGES, oversizeMessage, remainingImageSlots, removeFromDraft, sendBlocker, willCompressBeforeUpload } from './image-draft';
import { createUploadMemo, removeAttachmentAt, UPLOAD_CONCURRENCY, withUploadState, type UploadState } from './upload-queue';
import type { UploadedFile } from './attach';
import { colors, onThemeChange, radius, spacing } from './theme';
import { bubbleInk, MineBubble } from './bubble-ink';
import { popoutHeaderChrome, type PopoutChrome } from './window-shell';
import { ds, uiScale } from './ui-scale';
import { shouldShowTimeHeader } from './time';
import { localizedChatHeader as formatChatHeader } from './i18n-chat-time';
import { chatInfoCaps, chatInfoGroups, chatInfoPresentation, isChatFindKey, type ChatInfoCaps, type ChatInfoRow } from './chat-info-model';
import ChatInfoPanel from './ChatInfoPanel';
import { useDesktopWindowPin } from './DesktopWindowPin';
import { nodeInfoSectionKey, requestNodeSection } from './node-section-request';
import { chatComposerKind, isHostSupervisorAlias, nodeRolesVersion, subscribeNodeRoles } from './daemon-node';
import DaemonManagementScreen from './DaemonManagementScreen';
import { echoSupersededByFetched } from './chat-echo';
import { messageMenuGroups, selectionBarActions, type MessageMenuKey } from './message-menu-model';
import { agentStatusLabel, buildQuote, compactQuoteText, confirmedOutboxIds, copyTextOf, copiedToastVisible, COPIED_TOAST_MS, parseQuoted, quoteLabel, type QuoteRef, mergeMessagesNewestFirst, msgKey, removeMessage, shouldShowJumpPill, nextUnread, jumpPillLabel, canSend, shouldSendOnEnter, composerShortcutHint } from './chat-actions';
import { isMacKeyboard, sendKeyPref, shortcutBindings, shortcutCaptureActive, subscribeShortcuts } from './shortcuts-store';
import { comboChips, comboFromEvent, shortcutForCombo } from './shortcuts-model';
import { KBD_IDLE, kbdVoiceBlur, kbdVoiceKeyDown, kbdVoiceKeyUp, kbdVoiceSync, type KbdVoiceMode, type KbdVoiceState, type KbdVoiceStep } from './voice-shortcut-model';
import type { GestureResponderEvent, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { usePoll } from './usePoll';
import { onConversationReply } from './reply-wake';
import { fetchAuthMe } from './user-admin-api';
import { recallConversation, rememberConversation } from './swr-cache';
import { chatSearchState, isHighlighted, isStaleSearch, matchCountLabel, searchItems, shouldLoadOlderForSearch, stepHit, type SearchHit } from './chat-search';
import { retryUnreadPersistFromPoll } from './conversation-unread-persist';
import { conversationOpened } from './conversation-flags';
import { dispatchUnread, hubHasAgentUnread, markAgentRepliesSeen, markAgentServerUnreadCleared, unackedIdsForAgent } from './unread-store';
import { ackAgentUnread } from './agent-ack';
import MarkdownMessage from './MarkdownMessage';
import { ChatMetaLine, ChatTimePill } from './ChatTimeText';
import MessageSelectOverlay, { type MessageSelectTarget } from './MessageSelectOverlay';
import { copyValueFor, type SelectionPayload, type SelectMenuKey } from './message-select-model';
import ImageViewer from './ImageViewer';
import { openGallery, viewerImageFor, type ViewerImage, type ViewerState } from './image-viewer-model';
import { conversationGallery, imagePreviewSurface, imageWindowPayload } from './image-window-model';
import { closeImageWindowFor, openImageWindow } from './image-window';
import { selectedTextWithin } from './message-plain-text';
import { cleanAttachmentDebugText, hideGridImageLines, parseAttachmentRefs, parseMetaAttachmentRefs, parseMetaReplyAttachmentRefs } from './attachment-display';
import { attachmentCacheScope } from './attach-download';
import ActualRecipientNotice from './ActualRecipientNotice';
import { sendConfirmationFromResponse, sendNoticeFor, type SendConfirmation } from './actual-recipient';
import { beginForward, confirmForward, markForwardAmbiguous, mayProjectForward, resetForwardWithoutResend } from './forward-controller';
import { parseBtwFirstToken } from './btw-command';
import { SHOW_BOLT_ENTRY, SHOW_BTW_ENTRY } from './chat-entry-flags';
import { layoutGeneration, releaseOnUnmount, takeHandoff } from './layout-handoff';
import SideThreadDrawer, { type SideThreadLaunch } from './SideThreadDrawer';
import { nextPlusPanel, plusPanelHeight, plusPanelItems, type PlusItemKey, type PlusPanelEvent } from './composer-plus-panel';
import { useVoiceInput } from './useVoiceInput';
import { afterRecognized, showVoiceDraftCard, toggleComposerInputMode, type ComposerInputMode, type ComposerModeTransition } from './voice-input-model';
import { ComposerModeToggle, VOICE_DRAFT_CARD_BLOCK_MAX, VoiceDraftCard, VoiceHoldBar, VoiceHoldOverlay, VoiceRecordingOverlay, VoiceSettingsPrompt } from './VoiceInputUI';
import { DesktopMicButton, DesktopVoiceBar } from './DesktopVoiceBar';
import { DESKTOP_CLICK_EVENT, desktopVoiceNotice, micClickAction, showVoiceBar, voiceSurface } from './desktop-voice-bar-model';
import { holdOverlayApplies, holdOverlayLayout, zoneAt as holdZoneAt, type HoldOverlayLayout } from './voice-hold-overlay-model';
import { TOO_SHORT_NOTICE } from './voice-input-model';
import { beginVoicePress, createSelectionCapture, hostSelection, insertAtSelection, previewAtSelection, refocusAfterInsert, selectionAcrossModeSwitch, voiceInsertTarget, withPressStart, type TextSelection, type VoiceSource } from './voice-insert-model';
import { webComposerInputHeight } from './composer-input-height';
import { COMPOSER_INPUT_BORDER, COMPOSER_LINE_HEIGHT, composerControlSize, composerInputPadY, composerLineCount, composerRightSlot, composerRowAlign, nextFullEditor, shouldShowExpand, type FullEditorEvent } from './composer-row-layout';
import { ComposerExpandButton, ComposerFullscreenEditor, ComposerRightSlot } from './ComposerRowParts';
import { loadComposerInputMode, saveComposerInputMode } from './voice-prefs';
import { elevated } from './elevation';
import { CHAT_PAGE, mergeNewestPage, mergeOlderPage, newestPageParams, olderPageHasMore, olderPageParams } from './chat-history-pages';
import { cfgForAgent } from './agent-network';
import { loadChatSources, mergeChatSource, type ChatSource } from './chat-source-load';

// Chat with one agent. Open with the newest PAGE messages; scrolling toward
// older history fetches the next older PAGE by cursor (chat-history-pages.ts, #745).
// The FlatList is `inverted`, so index 0 renders at the BOTTOM (newest) —
// the native chat pattern; onEndReached then fires at the visual TOP,
// which is exactly the load-older trigger.

const PAGE = CHAT_PAGE;
/** 定位滚动大约多久停下(动画 + 未量到布局时的补滚):高亮从这时起计时。 */
const LOCATE_SETTLE_MS = 600;

// Local echo: sent messages appear instantly with a pending mark and
// either get replaced by the server copy on the next reload (delivered)
// or flip to a tappable "未送达 · 点击重试" state (#220 roadmap ②).
type ChatItem = HubTask & {
  _localId?: string;
  _pending?: boolean;
  _failed?: boolean;
  /** #552:Hub 回了明确错误码时的原因(i18n key 后缀,chat.failReason.<key>);超时 / 断网没有。 */
  _failReason?: SendFailureReason;
  _img?: PickedImage;
  /** 回显里的图。从 outbox 重建时可能只剩 hub 上那份(hubFileId,预览带令牌读)——#527。 */
  _imgs?: (PickedImage & { hubFileId?: string })[];
  /** 多图发送:与 _imgs 同序的逐张上传状态(queued/uploading/done/failed)。 */
  _uploads?: UploadState[];
  /** 有附件没传上时的汇总;此时整条不发,等用户重试或移除失败的那几张。 */
  _uploadError?: string;
  /** 发送时的「原图」开关;重试沿用它。 */
  _original?: boolean;
  /** #527:从 outbox 重建时有图拿不回来(旧版本落的盘 / web 重开后既没传上也没有可读的本地 uri)。
   *  此时重试拒发——绝不发出只剩文字的半条。
   *  PR3 review①:说明文案走这个标志单独渲染,
   *  🔴 绝不拼进 content:content 是「要发出去的字」,注解是「给用户看的字」,
   *  共用一个字段迟早串(重试会把注解原样发给对方 agent)。 */
  _restoredNoImage?: boolean;
  _priority?: 'high' | 'normal';
  /** app#160:Agent 主动发给用户的消息(user_inbox),只有回复气泡、没有发送气泡。 */
  _proactive?: boolean;
  _severity?: string;
  /** #499 到期提醒指向的任务(proactive-messages.dueReminderTaskRef)。 */
  _taskNotice?: { requirementId: string; seq: number | null; networkId: string | null };
  /** 2026-09-16:发送成功后本地回显不再立刻撤掉(慢链路上会「吞」几秒),而是记下 hub 返回的
   *  task_id,等轮询把同 id 的服务器行拉回来再让位;没拿到 id 时按内容+时间对账(confirmedOutboxIds)。 */
  _confirmedTaskId?: string;
};

// selectedText:桌面端右键时气泡里已有的鼠标选区(只在这个气泡内才算),菜单据此给「复制选中内容」。
type MessageSelection = { item: ChatItem; text: string; author?: string; selectedText?: string };

// Received tasks carry attachments inside meta_json (#221). Images get
// tappable thumbnails (Vincent tg 748), other files a 📎 line.
interface AttachmentView {
  key: string;
  name: string;
  isImage: boolean;
  isVideo: boolean;
  /** local file uri for fresh echoes, authed API uri otherwise */
  uri?: string;
  /** authed API uris need RN Image headers — unavailable on web <img> */
  needsAuth?: boolean;
  mime?: string;
  size?: number;
  /** Local echo only: index into the item's _imgs (upload state lookup). */
  localIndex?: number;
}

// 重试不重传:已传上去的那几张按 (hub, uri, 原图档) 记住。
const uploadMemo = createUploadMemo<{ img: PickedImage; up: UploadedFile }>();

const isImageLike = (name?: string, mime?: string) =>
  (mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(name ?? '');

const isVideoLike = (_name?: string, mime?: string) => (mime ?? '').startsWith('video/');

const makePusher = (serverUrl: string, out: AttachmentView[]) => {
  const seen = new Set<string>();
  return (fileId: string, name: string, mime?: string, size?: number) => {
    if (seen.has(fileId)) return;
    seen.add(fileId);
    // text refs carry no mime — derive it from the extension so the
    // share sheet can pick a player (Vincent tg 791)
    const resolved = mime ?? mimeFromName(name);
    out.push({
      key: fileId,
      name,
      isImage: isImageLike(name, resolved),
      isVideo: isVideoLike(name, resolved),
      uri: `${serverUrl}/api/files/${fileId}`,
      needsAuth: true,
      mime: resolved,
      size,
    });
  };
};

// Agents reference uploads in plain text, not meta (Vincent tg 765):
// render any /api/files/<id> mention as an openable attachment —
// markdown [name](…/api/files/id) keeps its name, bare refs get a stub.
const pushTextRefs = (text: string, push: (id: string, name: string, mime?: string) => void) => {
  for (const ref of parseAttachmentRefs(text)) push(ref.fileId, ref.name, ref.mime);
};

/** Attachments belonging to the SENT bubble: local echo, meta, content refs. */
const sentAttachmentViews = (item: ChatItem, serverUrl: string): AttachmentView[] => {
  const localAttachments = item._imgs ?? (item._img ? [item._img] : []);
  if (localAttachments.length) {
    return localAttachments.map((img, localIndex) => {
      // #527:重建的回显里本机已没有原件、只剩 hub 那份 —— 预览照常画(走带令牌的 /api/files)。
      const hubFileId = (img as ResendImage).hubFileId;
      return {
        localIndex,
        key: hubFileId ?? img.uri,
        name: img.fileName,
        isImage: isImageLike(img.fileName, img.mimeType),
        isVideo: isVideoLike(img.fileName, img.mimeType),
        uri: hubFileId ? `${serverUrl}/api/files/${hubFileId}` : img.uri,
        needsAuth: hubFileId ? true : undefined,
        mime: img.mimeType,
        size: img.fileSize,
      };
    });
  }
  const out: AttachmentView[] = [];
  const push = makePusher(serverUrl, out);

  for (const a of parseMetaAttachmentRefs((item as any).meta_json)) {
    push(a.fileId, a.name, a.mime, a.size);
  }
  pushTextRefs(item.content ?? '', push);
  return out;
};

/** Attachments the AGENT sent back — rendered inside the reply bubble
 *  (Vincent tg 771: thumbnail was stranded under the sent bubble while the
 *  reply showed raw markdown). */
const replyAttachmentViews = (item: ChatItem, serverUrl: string): AttachmentView[] => {
  const out: AttachmentView[] = [];
  const push = makePusher(serverUrl, out);
  // #1823 —— hub ≥ 0.9.0-preview.50 把回复附件放在 meta_json.reply_attachments;
  // 旧 hub 把它们并进 attachments(会画到提问者气泡),这里不去猜,只认新键。
  for (const a of parseMetaReplyAttachmentRefs((item as any).meta_json)) push(a.fileId, a.name, a.mime, a.size);
  pushTextRefs(item.result ?? (item as any).reply ?? '', push);
  return out;
};

/** Replace markdown file links with just the file name — the attachment
 *  itself renders as a thumbnail/📎 row below the text. */
interface Props {
  cfg: HubConfig;
  alias: string;
  onBack: () => void;
  desktop?: boolean;
  onOpenNodeSettings?: () => void;
  /** app#168(手机端):会话置顶开关;桌面端用窗口置顶 + 列表长按,不传。 */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** 0.2.107(手机端):这个 agent 的「消息免打扰」—— 不弹系统通知,消息照收。 */
  muted?: boolean;
  onToggleMute?: () => void;
  /** Android two-pane: the conversation sits next to the list, so no back chevron. */
  hideBack?: boolean;
  /** 语音输入未配置时「去设置」跳到 设置 → 语音输入。不传(独立聊天窗口)就只提示位置。 */
  onOpenVoiceSettings?: () => void;
  /** 「去会话」带来的那条(task_id):打开后定位并高亮;不在已加载的那页就往前拉(message-focus.ts),拉到头没有就提示。 */
  focusTaskId?: string;
  /** 分离聊天窗:页头兼当标题栏(拖动 / 双击最大化 + 给窗口控件让位,window-shell.ts popoutChatChrome)。主窗 / 手机不传。 */
  windowChrome?: PopoutChrome;
  /** #499 负责 Agent 发的到期提醒:气泡下「查看任务 ›」打开那张任务(同顶部提示)。不传 = 不画(分离聊天窗没有任务页)。 */
  onOpenTask?: (requirementId: string, networkId: string | null) => void;
  /** #908 守护进程管理页的「新建节点」:打开现有向导。不传(分离聊天窗)= 按钮置灰。 */
  onCreateNode?: (daemon: HostSupervisorDaemon) => void;
  /** 守护进程管理页里点托管节点的「对话」。 */
  onOpenManagedChat?: (alias: string) => void;
  /** #769: 点开这个会话的那一行所在网络。发送 / 历史 / 已读 / 附件都打到它,不是账号当前网络。 */
  networkId?: string;
  /** Hub 概览点机器进守护进程管理:角色尚未从 /api/nodes 确认时也显示管理页与设置入口。 */
  daemonMgmt?: boolean;
}

// Module level on purpose: the cache has to outlive a screen unmount, or
// returning to a conversation is a blank list and a fetch all over again.
const conversations = createConversationStore<ChatItem>();

export const clearChatConversationCache = (profileId?: string, serverUrl = ''): void => {
  conversations.clearScope(conversationScope(profileId, serverUrl));
};

export default function ChatScreen({ cfg: accountCfg, alias, networkId, onBack, desktop = false, onOpenNodeSettings, pinned = false, onTogglePin, muted = false, onToggleMute, hideBack = false, onOpenVoiceSettings, focusTaskId, windowChrome = null, onOpenTask, onCreateNode, onOpenManagedChat, daemonMgmt = false }: Props) {
  useTranslation();
  // #769: everything below is agent-scoped — use THIS agent's network, not the account's current one.
  const cfg = useMemo(() => cfgForAgent(accountCfg, alias, networkId), [accountCfg, alias, networkId]);
  // Android edge-to-edge draws the composer under the gesture bar (same
  // class of bug as the tg 802 tab bar) — pad by the real bottom inset.
  const insets = useSafeAreaInsets();
  const composerInset = layoutOs() === 'android' ? insets.bottom : 0;
  // The menus / dialogs below are Modals = their own window (safe-area rule, modal-safe-area.ts):
  // bottom action sheets pad sides + bottom inside the sheet, centred panels pad all four.
  const sheetSafe = useModalSafePadding('overlay');
  const dialogSafe = useModalSafePadding('fullScreen');
  const sheetPad = { paddingBottom: spacing.xl + sheetSafe.paddingBottom, paddingLeft: sheetSafe.paddingLeft, paddingRight: sheetSafe.paddingRight };
  const [messages, setMessages] = useState<ChatItem[]>([]);
  // 回复引用条要按 task_id 找到被回的那条(主动消息的 in_reply_to)
  const byTaskId = useMemo(() => new Map(messages.map(m => [msgKey(m), m] as const)), [messages]);
  // i18n-allow: legacy sender fallback participates in quote/forward identity, not translatable UI.
  const [currentUsername, setCurrentUsername] = useState('我');
  const [loaded, setLoaded] = useState(false);
  const [conversationReady, setConversationReady] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraftState] = useState('');
  // #632 草稿(微信同款):按 账号 + Hub + 网络 + 会话 存在本机,离开 / 切会话 / 退后台 / 重启后放回。
  // 主窗口复用同一个 ChatScreen 切会话 —— key 变就等于离开旧会话、进新会话(composer-drafts.ts)。
  const composerDraftKey = conversationDraftKey(cfg, { kind: 'node', alias });
  const { setDraft } = useComposerDraft(composerDraftKey, draft, setDraftState);
  // 设置 → 快捷键:Enter 发送(默认)还是 Ctrl/⌘+Enter 发送。
  const sendKey = useSyncExternalStore(subscribeShortcuts, sendKeyPref, sendKeyPref);
  // #908 守护节点(host_supervisor):整页换成管理页,不进对话。角色还没到时仍先按普通会话画。
  useSyncExternalStore(subscribeNodeRoles, nodeRolesVersion, nodeRolesVersion);
  const composerKind = chatComposerKind(isHostSupervisorAlias(alias) || daemonMgmt);
  // Fold/unfold remounts this screen (phone stack ⇄ two-pane); carry the unsent
  // draft across that remount only. Ordinary back/leave still drops it, as before.
  const draftHandoffKey = `chatDraft:${cfg.profileId ?? cfg.serverUrl}:${alias}`;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useLayoutEffect(() => {
    const mountedGeneration = layoutGeneration();
    const handed = takeHandoff<string>(draftHandoffKey);
    if (handed) setDraft(handed);
    return () => releaseOnUnmount(draftHandoffKey, draftRef.current, mountedGeneration);
  }, [draftHandoffKey]);
  const [sendPriority, setSendPriority] = useState<'high' | 'normal'>('normal');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [btwLaunch, setBtwLaunch] = useState<SideThreadLaunch>();
  const mainComposerRef = useRef<TextInput>(null);
  // 语音模式的草稿卡片(不弹软键盘的输入框):大条的识别结果插到它的选区。和输入框不会同时挂着。
  const draftCardRef = useRef<TextInput>(null);
  // 语音插到光标处(voice-insert-model.ts):onSelectionChange 一直喂 track();按下大条 / 桌面麦克风
  // 的第一时间 freeze()(安卓按麦克风可能失焦、再报一次选区 —— 之后到的都不算);松手 take()。
  const selectionCaptureRef = useRef(createSelectionCapture());
  const voiceSourceRef = useRef<VoiceSource>('holdBar');
  // 插完把光标放到插入文字之后:先提交新草稿,下一拍用 selection 受控放光标,再放开(undefined)让用户随便挪。
  const [forcedSelection, setForcedSelection] = useState<TextSelection | undefined>(undefined);
  const pendingSelectionRef = useRef<TextSelection | null>(null);
  const [cursorRequest, setCursorRequest] = useState(0);
  const placeSelection = (sel: TextSelection) => { pendingSelectionRef.current = sel; setCursorRequest(n => n + 1); };
  const placeCursor = (cursor: number) => placeSelection({ start: cursor, end: cursor });
  useEffect(() => {
    const sel = pendingSelectionRef.current;
    if (sel === null) return;
    pendingSelectionRef.current = null;
    selectionCaptureRef.current.track(sel);
    setForcedSelection(sel);
  }, [cursorRequest]);
  useEffect(() => {
    if (!forcedSelection) return;
    const id = setTimeout(() => setForcedSelection(undefined), 120);
    return () => clearTimeout(id);
  }, [forcedSelection]);
  const onComposerSelectionChange = (e: { nativeEvent: { selection: TextSelection } }) => selectionCaptureRef.current.track(e.nativeEvent.selection);
  // app#237 —— 桌面端输入区高度可拖拽:根容器高度决定上界(消息区至少留 200px),
  // 值全局持久化(切会话 / 重启保持)。分隔条在输入区上沿,向上拖变高。
  const [rootHeight, setRootHeight] = useState(0);
  const [inputRowTop, setInputRowTop] = useState(0);
  const keyboardVisible = useKeyboardVisible(Keyboard, Platform.OS);
  // iOS: the composer's keyboard inset, measured in window coordinates (#547, screen-keyboard-inset.tsx).
  const iosKeyboard = useScreenKeyboardInset();
  // 「＋」 panel (composer-plus-panel.ts). Mobile: inline panel under the input row,
  // sharing the keyboard's slot. Desktop: the small popover Modal. One level either way.
  const plusOpenRef = useRef(plusMenuOpen);
  plusOpenRef.current = plusMenuOpen;
  const lastKeyboardHeightRef = useRef<number | undefined>(undefined);
  const plusEvent = (event: PlusPanelEvent): boolean => {
    const t = nextPlusPanel(plusOpenRef.current, event);
    plusOpenRef.current = t.open;
    if (t.dismissKeyboard && !desktop) {
      mainComposerRef.current?.blur();
      Keyboard.dismiss();
    }
    setPlusMenuOpen(t.open);
    return t.handled;
  };
  // Keyboard up (tap on the input, IME restore, …) → panel down: they never stack.
  useEffect(() => {
    if (keyboardVisible) plusEvent('keyboardShown');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardVisible]);
  // Remember the real IME height so the panel occupies the same slot (WeChat).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Keyboard.addListener('keyboardDidShow', (e: any) => {
      const h = e?.endCoordinates?.height;
      if (typeof h === 'number' && h > 0) lastKeyboardHeightRef.current = h;
    });
    return () => sub.remove();
  }, []);
  // Android back closes the panel before it leaves the chat.
  useEffect(() => {
    if (!plusMenuOpen || desktop || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => plusEvent('back'));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plusMenuOpen, desktop]);
  // Switching conversation (two-pane sidebar) never carries an open panel over.
  useEffect(() => {
    plusEvent('conversationChanged');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alias]);
  const { height: plusWindowHeight } = useWindowDimensions();
  // 聊天信息(chat-info-model.ts):页头右侧只剩「⋯」,搜索 / 置顶 / 免打扰 / 窗口置顶 / 节点设置都在里面。
  const [infoOpen, setInfoOpen] = useState(false);
  const [paneWidth, setPaneWidth] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const windowPin = useDesktopWindowPin();
  // Switching conversation (two-pane sidebar) never carries the panel over.
  useEffect(() => { setInfoOpen(false); }, [alias]);
  const rootHeightRef = useRef(0);
  const [composerHeightRaw, setComposerHeightRaw] = useState<number>(() => loadComposerHeight() ?? COMPOSER_HEIGHT_DEFAULT);
  // 卡片高度 = 拖出来的高度(下限)与内容高度(自动长高,到窗格 40% 为止)取大 —— composer-resize.ts。
  const [composerContentHeight, setComposerContentHeight] = useState(0);
  const composerHeight = composerCardHeight(composerHeightRaw, composerContentHeight, rootHeight || undefined);
  // 拖拽从**当前看到的**高度起算(自动长高后再拖,不能先跳回拖过的旧值)。
  const composerHeightRawRef = useRef(composerHeight);
  composerHeightRawRef.current = composerHeight;
  // 🔴 只创建一次(空依赖):每次高度变化重建 PanResponder 会让 react-native-web 在拖拽中途
  // 换 responder config,新 gestureState 的 dy 从 0 重新累计 → 拖不动(见 composer-resize.ts)。
  // 会变的值全部经 ref 现读。
  const composerPan = useMemo(() => PanResponder.create(composerDragHandlers({
    getHeight: () => composerHeightRawRef.current,
    getRootHeight: () => rootHeightRef.current || undefined,
    setHeight: setComposerHeightRaw,
    save: saveComposerHeight,
    lockSelection: Platform.OS === 'web' ? lockDocumentSelection : undefined,
  })), []);
  // 桌面气泡最大宽度:窗格的 85%,但不超过 DESKTOP_BUBBLE_MAX(宽窗口里一行字不拉满)。手机不变。
  const bubbleCap = desktopBubbleCap(desktop, paneWidth);
  const sending = false; // optimistic echo frees the input immediately
  const limitRef = useRef(PAGE);
  // #745:当前会话已拉到的 hub 行(newest-first)。轮询刷新最新一页、往上翻按游标接更早的一页,都只改它。
  const hubRowsRef = useRef<HubTask[]>([]);
  const loadSequenceRef = useRef(0);

  // app#166 —— 微信式「聊天记录搜索」:范围永远是当前会话;结果只认开始搜索时的会话 key。
  const SEARCH_MAX_OLDER_PAGES = 5;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchCurrent, setSearchCurrent] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const searchPagesRef = useRef(0);
  const searchInputRef = useRef<TextInput>(null);
  const [highlight, setHighlight] = useState<{ key: string; at: number } | null>(null);
  const [highlightTick, setHighlightTick] = useState(0);
  const lastOffsetRef = useRef(0);
  const savedOffsetRef = useRef<number | null>(null);

  const conversationKeyFor = conversationKey(cfg.profileId, cfg.serverUrl, cfg.networkId, alias);
  // Updated during render, before effects: an async send from the previous
  // sidebar selection must see the new owner immediately.
  const visibleConversationKeyRef = useRef(conversationKeyFor);
  visibleConversationKeyRef.current = conversationKeyFor;
  const requestGateRef = useRef<ReturnType<typeof createConversationRequestGate> | null>(null);
  if (!requestGateRef.current) requestGateRef.current = createConversationRequestGate();
  const requestGate = requestGateRef.current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const token = requestGate.current();
      if (token) requestGate.close(token);
    };
  }, []);

  const load = useCallback(
    async (limit: number) => {
      const token = requestGate.current();
      if (!token) return;
      const sequence = ++loadSequenceRef.current;
      const isCurrent = () => requestGate.isCurrent(token) && mountedRef.current && sequence === loadSequenceRef.current;
      const params = newestPageParams(alias, limit);
      const paint = (source: ChatSource, rows: ChatItem[], fetched: HubTask[] = [], confirmed = new Set<string>()) => {
        if (!isCurrent()) return;
        setMessages(prev => {
          if (!isCurrent()) return prev;
          const kept = prev.filter(t => !t._localId || (!confirmed.has(t._localId) && !echoSupersededByFetched(t, fetched)));
          const merged = settleEchoes<ChatItem>(mergeChatSource(kept, rows, source), outboxEntry);
          conversations.put(token.key, merged);
          // Only server rows enter the bounded disk cache; never echoes or local attachments.
          rememberConversation(cfg.profileId, token.key, merged.filter(t => !t._localId) as unknown as Record<string, unknown>[]);
          return merged;
        });
        setLoaded(true);
      };
      const results = await loadChatSources({
        tasks: () => fetchTasks(cfg, params),
        proactive: () => fetchChatUserMessages(cfg),
        isCurrent,
        onTasks: data => {
          const fetched = data.tasks ?? [];
          if (fetched.length < params.limit) setHasOlder(false);
          const rows = hubRowsRef.current = mergeNewestPage(hubRowsRef.current, fetched, params.limit);
          const confirmed = new Set(confirmedOutboxIds(outboxForAlias(alias), fetched));
          confirmed.forEach(outboxRemove);
          paint('tasks', rows, fetched, confirmed);
        },
        onProactive: data => paint('proactive', proactiveItemsForAgent(data.messages as any, alias, cfg.username)),
      });
      if (isCurrent()) {
        // First paint needn't wait, but unread acknowledgements still wait for both reads.
        if (results.every(Boolean)) setConversationReady(true);
        setLoaded(true);
      }
      void retryUnreadPersistFromPoll();
    },
    [cfg, alias],
  );

  // Reset the lazy window when the chat target changes; usePoll does the
  // initial fetch + polling (fires fn() right after this effect → limit=PAGE).
  // PR3 判据C:同时把该会话的 outbox 未送达条目并回列表(上次 app 被杀时留下的)。
  // 恢复项带 _localId → :188 的 merge 会让它们在轮询重载中存活;_failed → 渲染成
  // 「未送达 · 点击重试」,retry 复用同一 id。#527:恢复项带回它的图(imagesForResend),
  // 否则重试只会发出「[附件] x.png」这行字。
  useEffect(() => {
    limitRef.current = PAGE;
    hubRowsRef.current = [];
    // #518: a 'pending' entry nobody in this process is sending (the app was killed mid-send, or the
    // instance that started it let go) would otherwise paint 「发送中…」 forever. It becomes 「未送达」;
    // the load below still retires it if the hub has its client_request_id.
    orphanedPendingIds(outboxForAlias(alias)).forEach(outboxMarkFailed);
    const restored = outboxForAlias(alias).map<ChatItem>((e) => {
      const { imgs, lost } = imagesForResend(e, outboxLiveImages(e.id), cfg.serverUrl);
      return {
        content: e.content, // 保持原文——重试发的就是它
        created_at: new Date(e.createdAt).toISOString(),
        _localId: e.id,
        _pending: e.state === 'pending',
        _failed: e.state === 'failed',
        ...(imgs.length ? { _imgs: imgs as ChatItem['_imgs'] } : {}),
        _restoredNoImage: lost > 0,
        _original: !!e.original,
        _priority: e.priority ?? 'normal',
      };
    });
    // Opening invalidates anything still in flight for the previous
    // conversation, then hands back this one's cached content.
    const token = requestGate.open(conversationKeyFor);
    const snapshot = conversations.open(conversationKeyFor);
    const restoredNewestFirst = restored.reverse(); // inverted 列表:新的在前
    if (snapshot && snapshot.messages.length > 0) {
      // Cached: show it in the same frame as the title change, then refresh in
      // the background. A spinner over content we already have is a downgrade.
      setMessages(mergeMessagesNewestFirst(restoredNewestFirst, snapshot.messages));
      setLoaded(true);
      setConversationReady(true);
    } else {
      // Nothing cached: an empty list plus loaded=false is the skeleton state.
      // Never carry the previous conversation's messages into this frame.
      setMessages(restoredNewestFirst);
      setLoaded(false);
      setConversationReady(false);
      // Cold start: paint this conversation's last-known hub rows from disk (swr-cache.ts) while
      // the live read is in flight. Only if the live read has not landed yet; not "ready" —
      // unread acks and focus-jumps wait for live data, a disk copy can be days old.
      void recallConversation<ChatItem>(cfg.profileId, conversationKeyFor).then(cached => {
        if (!cached || !requestGate.isCurrent(token) || !mountedRef.current || conversations.peek(conversationKeyFor)) return;
        setMessages(prev => mergeMessagesNewestFirst(prev, cached));
        setLoaded(true);
      });
    }
    setHasOlder(true);
    return () => {
      requestGate.close(token);
    };
  }, [load, alias, conversationKeyFor]);

  // #518: echoes follow the outbox. Another ChatScreen instance (before a remount / a sidebar switch)
  // may finish the send that owns an echo shown here; re-derive 发送中 / 已送达 / 未送达 when it does.
  useEffect(() => subscribeOutbox(() => {
    if (!mountedRef.current) return;
    orphanedPendingIds(outboxForAlias(alias)).forEach(outboxMarkFailed);
    setMessages(prev => settleEchoes(prev, outboxEntry));
  }), [alias]);

  // Foreground-only message polling: 5s while visible, paused in background,
  // instant refresh on resume (shared hook). Reads the live window via limitRef.
  usePoll(() => load(limitRef.current), 5000, [load]);
  // 回复推送(reply-wake.ts):hub 的网络事件流一报「这个 agent 回复了」就立刻读,不等下一次 5 s 轮询。
  // 只是叫醒;内容照旧从同一个 /api/tasks 读。流不在 / 断了 / 漏了,轮询照旧兜底。
  const shownTaskIds = useRef<Set<string>>(new Set());
  shownTaskIds.current = new Set(messages.map(m => m.task_id).filter((id): id is string => !!id));
  useEffect(() => onConversationReply(cfg, alias, () => { void load(limitRef.current); }, { isShownTask: id => shownTaskIds.current.has(id) }), [cfg, alias, load]);

  useEffect(() => {
    // 2026-09-17 Vincent:身份只查一次,走 RELAY 隧道那一次失败,整场会话都不知道
    // 「我是谁」——别人派给这个 agent 的任务全按占位身份显示成「我」。改成退避重试。
    let alive = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const lookup = () => {
      fetchAuthMe(cfg)
        .then(data => {
          const username = data?.user?.username;
          if (!alive) return;
          if (typeof username === 'string' && username.trim()) { setCurrentUsername(username.trim()); return; }
          schedule();
        })
        .catch(() => { if (alive) schedule(); });
    };
    const schedule = () => {
      attempt += 1;
      timer = setTimeout(lookup, nextIdentityRetryDelay(attempt));
    };
    lookup();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [cfg.serverUrl, cfg.token]);

  // #745:往上翻只拉「比已加载最老一条更早的一页」,接在末尾(inverted 列表的视觉顶部 ⇒ 当前可视区不跳)。
  const loadOlder = async () => {
    if (loadingOlder || !hasOlder || !loaded) return;
    const params = olderPageParams(alias, hubRowsRef.current);
    const token = requestGate.current();
    if (!params || !token) return;
    setLoadingOlder(true);
    try {
      const page = (await fetchTasks(cfg, params)).tasks ?? [];
      if (!requestGate.isCurrent(token) || !mountedRef.current) return;
      const { rows, added } = mergeOlderPage(hubRowsRef.current, page);
      hubRowsRef.current = rows;
      // 轮询照旧刷新整个已加载窗口(hub 上限 200 由 newestPageParams 截),更早的行由 mergeNewestPage 留着。
      limitRef.current = Math.max(limitRef.current, rows.length);
      if (!olderPageHasMore(page.length, added)) setHasOlder(false);
      setMessages(prev => {
        const shown = new Set(prev.map(msgKey));
        const merged = mergeMessagesNewestFirst<ChatItem>([], [...prev, ...rows.slice(rows.length - added).filter(r => !shown.has(msgKey(r)))]);
        conversations.put(token.key, merged);
        return merged;
      });
    } finally {
      if (mountedRef.current) setLoadingOlder(false);
    }
  };

  const [attached, setAttached] = useState<PickedImage[]>([]);
  // 「原图」开关(微信式,默认关)。web/桌面在发送前按它压缩;原生端在选图时按它决定 picker quality。
  const [sendOriginal, setSendOriginal] = useState(false);
  // 草稿区的轻提示(超过 9 张、超过 12MB…),2.5s 自动消失。
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!composerNotice) return;
    const timer = setTimeout(() => setComposerNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [composerNotice]);
  // 手机 / 双栏的输入方式(微信式):键盘,或整条「按住 说话」。每台设备记住用户**点切换**选的那个;
  // 点语音草稿卡片切到键盘是临时状态(文字要给人改),不写回偏好 —— 下次进来还是用户选的语音模式。
  const [inputMode, setInputMode] = useState<ComposerInputMode>('keyboard');
  const focusAfterInsertRef = useRef(false);
  useEffect(() => { void loadComposerInputMode().then(setInputMode).catch(() => {}); }, []);
  // 点 ⌨ 切回键盘:切换那一刻拍下的选区,输入框挂上、focus 之后放回去(语音 → 键盘选区不丢)。
  const selectionAfterFocusRef = useRef<TextSelection | null>(null);
  const applyComposerTransition = (tr: ComposerModeTransition) => {
    if (tr.focusInput) focusAfterInsertRef.current = true;
    if (tr.mode) setInputMode(tr.mode);
    if (tr.mode && tr.persist) void saveComposerInputMode(tr.mode);
  };
  // 语音输入(按住说话):识别结果进草稿,不自动发送。🔴 大条松手后留在语音模式、不聚焦输入框
  // (owner:「按住说话之后，别直接把输入法弹出来」):文字插到「按住 说话」上方草稿卡片的选区(没点过卡片 =
  // 末尾),光标落在插入文字之后 → 连着按依次往后接;右格变「发送」。
  // 桌面麦克风:插到按下时冻结的光标处(选中了就替换),光标落在插入文字之后,焦点还给输入框。
  const insertVoiceText = (text: string) => {
    const source = voiceSourceRef.current;
    const frozen = selectionCaptureRef.current.take();
    const r = insertAtSelection(draftRef.current, text, voiceInsertTarget(source, frozen));
    if (!refocusAfterInsert(source)) {
      draftRef.current = r.value;
      setDraft(r.value);
      placeCursor(r.cursor);
      applyComposerTransition(afterRecognized());
      return;
    }
    draftRef.current = r.value;
    setDraft(r.value);
    placeCursor(r.cursor);
    mainComposerRef.current?.focus();
  };
  // 手机「按住 说话」浮层(微信式,VoiceHoldOverlay):铺满聊天页根视图;✕ / 文 两个圈的命中判定用浮层同一份几何。
  // 手指坐标是窗口坐标 → 减去根视图在窗口里的原点(按下时量一次,originProbe 是根视图左上角的 0×0 视图)。
  // (layout 本身在 voiceMode 算出来之后填,见下面 holdLayout。)
  const holdLayoutRef = useRef<HoldOverlayLayout | null>(null);
  const originProbeRef = useRef<View>(null);
  const rootOriginRef = useRef({ x: 0, y: 0 });
  const measureRootOrigin = () => originProbeRef.current?.measureInWindow((x, y) => { rootOriginRef.current = { x, y }; });
  const voice = useVoiceInput({
    onInsert: text => {
      insertVoiceText(text);
    },
    // 手机:「说话时间太短」由浮层在屏幕中间提示(微信式),不再在输入区上方重复一条。
    onNotice: text => { if (holdLayoutRef.current && text === TOO_SHORT_NOTICE) return; setComposerNotice(text); },
    zoneAt: (pageX, pageY, prev) => {
      const l = holdLayoutRef.current;
      if (!l) return null;
      return holdZoneAt({ x: pageX - rootOriginRef.current.x, y: pageY - rootOriginRef.current.y }, l, prev);
    },
  });
  // 每个麦克风包一层:按下第一时间记来源(+ 冻结选区);上一句还在识别时不覆盖。
  const voiceHandlersFor = (source: VoiceSource) => withPressStart(
    voice.micHandlers,
    () => {
      // 网页 / 桌面 webview:直接读 textarea 的当前选区(选区事件是异步的,程序化改的选区可能根本不报);
      // 原生上 ref 不是 DOM 节点 → null → 用 onSelectionChange 跟踪到的值。
      // 语音模式挂着的是草稿卡片(大条插到它的选区),键盘模式 / 桌面是输入框。
      if (source === 'holdBar') measureRootOrigin();
      const host = hostSelection(source === 'holdBar' ? draftCardRef.current : mainComposerRef.current);
      if (host) selectionCaptureRef.current.track(host);
      voiceSourceRef.current = beginVoicePress(source, selectionCaptureRef.current);
    },
    () => voice.state.phase === 'idle',
  );
  // 桌面:点 🎤 开始 / 完成 ✓(Enter)/ 取消 ✕(Esc),走同一套麦克风处理(按下冻结光标处选区 → 插到光标处)。
  const desktopMicClick = () => {
    const a = micClickAction(voice.state.phase);
    if (a === 'start') voiceHandlersFor('desktopMic').onResponderGrant(DESKTOP_CLICK_EVENT as unknown as GestureResponderEvent);
    else if (a === 'done') desktopVoiceDone();
  };
  const desktopVoiceDone = () => voice.micHandlers.onResponderRelease(DESKTOP_CLICK_EVENT as unknown as GestureResponderEvent);
  const desktopVoiceCancel = () => voice.micHandlers.onResponderTerminate();
  const voiceMode = !desktop && voice.available && inputMode === 'voice';
  // 面板盖住输入行 + 草稿卡片能长到的最高处(卡片在按住期间会显示光标处预览,不能从面板上方露出来)。
  const holdCoverTop = inputRowTop > 0 ? inputRowTop - (showVoiceDraftCard(voiceMode, draft) ? VOICE_DRAFT_CARD_BLOCK_MAX : 0) : undefined;
  // 只在手机(安卓 / iOS / 折叠屏双栏)画;桌面(含窄到 phone 布局的桌面窗口)永远不画,见 holdOverlayApplies。
  const holdOverlayOn = holdOverlayApplies({ desktop, os: Platform.OS, userAgent: Platform.OS === 'web' ? String((globalThis as any).navigator?.userAgent ?? '') : '' });
  const holdLayout = holdOverlayOn && paneWidth > 0 && rootHeight > 0 ? holdOverlayLayout(paneWidth, rootHeight, composerInset, holdCoverTop) : null;
  holdLayoutRef.current = holdLayout;
  // 微信式输入行(composer-row-layout.ts):输入超过 3 行 → 左上角 ⤢ 打开全屏编辑(同一份草稿)。
  const [fullEditorOpen, setFullEditorOpen] = useState(false);
  const fullEditorEvent = (event: FullEditorEvent): boolean => {
    const t = nextFullEditor(fullEditorOpen, event);
    // 全屏编辑器里改过的草稿,主输入框的选区已不可信 → 当作光标在末尾。
    if (fullEditorOpen && !t.open) selectionCaptureRef.current.reset();
    setFullEditorOpen(t.open);
    return t.handled;
  };
  const [inputContentHeight, setInputContentHeight] = useState<number | undefined>(undefined);
  // Smallest content height seen = one line (the empty input reports it on mount).
  const oneLineHeightRef = useRef<number | undefined>(undefined);
  const onInputContentSize = (h: number) => {
    if (!(h > 0)) return;
    if (oneLineHeightRef.current === undefined || h < oneLineHeightRef.current) oneLineHeightRef.current = h;
    setInputContentHeight(h);
  };
  const inputLines = composerLineCount(draft, inputContentHeight, oneLineHeightRef.current);
  useEffect(() => {
    fullEditorEvent('conversationChanged');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alias]);
  const voiceBusy = voice.state.phase !== 'idle';
  // 按住大条期间:流式中间结果在草稿卡片的光标处预览(只画,不进草稿;终稿松手后替换它)。
  // 预览期间卡片的选区受控跟着预览走,卡片报上来的选区不记(那是预览文字里的位置,不是草稿里的)。
  const draftCardPreview = voiceMode && voiceBusy && voiceSourceRef.current === 'holdBar'
    ? previewAtSelection(draft, voice.interim, selectionCaptureRef.current.peek().frozen)
    : null;
  // 一句结束(插入 / 取消 / 失败):卡片回到草稿,选区放回跟踪到的那个(插入了 = 插入文字之后,见 placeCursor)。
  const wasVoiceBusyRef = useRef(false);
  useEffect(() => {
    const was = wasVoiceBusyRef.current;
    wasVoiceBusyRef.current = voiceBusy;
    if (!was || voiceBusy || !voiceMode) return;
    placeSelection(selectionAcrossModeSwitch(selectionCaptureRef.current.peek().live, draftRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceBusy]);
  // 点 ⌨ 切回键盘:TextInput 这一帧才重新挂上,挂上之后再 focus,再把切换时的选区放回去。
  useEffect(() => {
    if (voiceMode || !focusAfterInsertRef.current) return;
    focusAfterInsertRef.current = false;
    const keep = selectionAfterFocusRef.current;
    selectionAfterFocusRef.current = null;
    const id = setTimeout(() => {
      mainComposerRef.current?.focus();
      if (keep) placeSelection(keep);
    }, 30);
    return () => clearTimeout(id);
  }, [voiceMode]);
  const toggleInputMode = () => {
    const next = toggleComposerInputMode(inputMode);
    // 切换的那一刻拍下选区:草稿卡片 ↔ 输入框是同一份草稿,选区原样带过去(新挂上的那个先报的默认选区不算)。
    const keep = selectionAcrossModeSwitch(selectionCaptureRef.current.peek().live, draftRef.current);
    setInputMode(next);
    void saveComposerInputMode(next);
    placeSelection(keep);
    if (next === 'voice') {
      if (plusOpenRef.current) plusEvent('toggle'); // ＋ 面板收起
      mainComposerRef.current?.blur();
      Keyboard.dismiss();
    } else {
      selectionAfterFocusRef.current = keep;
      focusAfterInsertRef.current = true;
    }
  };
  const attachedRef = useRef<PickedImage[]>([]);
  attachedRef.current = attached;
  // #632 选了还没发的附件:按会话留在本次运行的内存里(切走再回来还在;重启不保留,见 composer-drafts.ts)。
  useLayoutEffect(() => {
    const restored = takeDraftAttachments(composerDraftKey);
    attachedRef.current = restored;
    setAttached(restored);
    return () => stashDraftAttachments(composerDraftKey, attachedRef.current);
  }, [composerDraftKey]);
  // 选择顺序即发送顺序:addToDraft 只追加、不排序;超出 9 张图 / 20 个附件的部分被拒并提示。
  const appendAttachments = useCallback((incoming: PickedImage[]) => {
    if (!incoming.length) return;
    const result = addToDraft(attachedRef.current, incoming);
    result.rejected.forEach(releaseClipboardAttachment);
    attachedRef.current = result.next;
    setAttached(result.next);
    // 超 12MB 的图不在这里弹:原图开关到发送时才定,缩略图上的「超 12MB」和发送拦截会按当时的开关判断。
    if (result.notice) setComposerNotice(result.notice);
  }, []);
  const appendAttachment = useCallback((next: PickedImage) => appendAttachments([next]), [appendAttachments]);
  const removeAttachment = useCallback((uri: string) => {
    const { next, removed } = removeFromDraft(attachedRef.current, uri);
    releaseClipboardAttachment(removed);
    attachedRef.current = next;
    setAttached(next);
  }, []);
  // 原图关闭的图在上传前才压缩(原生 expo-image-manipulator / web canvas),这里不按原始体积拦它。
  const willCompressLater = useCallback(
    (img: PickedImage) => willCompressBeforeUpload(img, { original: sendOriginal, platform: Platform.OS }),
    [sendOriginal],
  );
  // 原图开关在发送时才生效:选图一律取原字节,所以切换对草稿里已有的图同样有效。
  const toggleSendOriginal = () => setSendOriginal(value => !value);

  // React Native Web does not expose clipboard files through TextInput's
  // onChangeText. Listen at the window while this chat is mounted so Ctrl+V
  // (Windows/Linux) and Cmd+V (macOS) can reuse the normal attachment flow.
  // Text-only pastes are deliberately untouched.
  // 剪贴板里有几个文件就收几个(desktop-file-intake.ts,与「＋」和拖放同一个出口)。
  useEffect(() => {
    if (!(desktop || isTauriDesktop()) || typeof window === 'undefined') return;
    const onPaste = (event: ClipboardEvent) => {
      const pasted = attachmentsFromClipboard(event.clipboardData?.items);
      if (!pasted.length) return;
      event.preventDefault();
      appendAttachments(pasted);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [appendAttachments, desktop]);
  // 桌面:把文件拖进聊天区(整个会话窗格,不只是输入框)= 加进草稿。拖的是文字 / 链接不接。
  // Tauri 窗口要关掉原生拖放(tauri.conf.json / desktop-chat-menu.ts 的 dragDropEnabled: false),
  // 否则系统拖进来的文件被 Tauri 截走,网页里收不到 drop。
  const [dropActive, setDropActive] = useState(false);
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!desktop || !doc?.addEventListener) return;
    let clear: ReturnType<typeof setTimeout> | null = null;
    const inPane = (event: DragEvent) => !!(event.target as Element | null)?.closest?.('[data-testid="chat-pane"]');
    const onOver = (event: DragEvent) => {
      if (!transferHasFiles(event.dataTransfer) || !inPane(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
      if (clear) clearTimeout(clear);
      clear = setTimeout(() => setDropActive(false), 200);
    };
    const onDrop = (event: DragEvent) => {
      if (!inPane(event)) return;
      const files = filesFromTransfer(event.dataTransfer);
      if (!files.length) return;
      event.preventDefault();
      setDropActive(false);
      appendAttachments(attachmentsFromFiles(files));
    };
    doc.addEventListener('dragover', onOver);
    doc.addEventListener('drop', onDrop);
    return () => {
      if (clear) clearTimeout(clear);
      doc.removeEventListener('dragover', onOver);
      doc.removeEventListener('drop', onDrop);
    };
  }, [appendAttachments, desktop]);
  // 图片预览(ImageViewer.tsx):同一条消息的全部图片 + 当前第几张。null = 未打开。
  // 预览层带「下载原图」(多图方格里放不下那一行)。
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const viewerEnv = { os: Platform.OS, tauri: !!(globalThis as any).__TAURI_INTERNALS__ };
  const galleryOf = (views: AttachmentView[]): ViewerImage[] =>
    views.map(a => viewerImageFor(a, viewerEnv)).filter((v): v is ViewerImage => !!v);
  // 2026-09-27 Vincent:桌面端点图不再盖住整个主窗口,开独立的「图片预览」窗口(image-window.ts),
  // ←/→ 走整个会话的图片;手机端和纯网页仍是上面的全屏 ImageViewer。开窗失败 → 退回 ImageViewer。
  const openViewer = (gallery: ViewerImage[], key: string, resolvedUri?: string) => {
    const inApp = openGallery(gallery, key, resolvedUri);
    if (imagePreviewSurface(viewerEnv) !== 'window') { setViewer(inApp); return; }
    const payload = imageWindowPayload({
      // messages 是倒序(最新在前);会话图库按从旧到新、每条先发出的气泡再回复气泡。
      conversation: conversationGallery([...messages].reverse().map(item => galleryOf([
        ...(item._proactive ? [] : sentAttachmentViews(item, cfg.serverUrl)),
        ...replyAttachmentViews(item, cfg.serverUrl),
      ]))),
      message: gallery,
      tappedKey: key,
      profileId: cfg.profileId,
      serverUrl: cfg.serverUrl,
      title: alias,
      now: Date.now(),
    });
    if (!payload) { setViewer(inApp); return; }
    void openImageWindow(payload, { measureUri: resolvedUri }).then(ok => { if (!ok) setViewer(inApp); });
  };
  const attachmentViewerScope = `${conversationKeyFor}::${attachmentCacheScope(cfg.serverUrl, cfg.token)}`;
  // A blob: URL (Tauri web) and a file: URI (native) both identify bytes that
  // were fetched under the previous credentials. Closing the parent modal is
  // part of the auth boundary; resetting only the child thumbnail would leave
  // those already-open bytes visible after a profile/Hub/conversation switch.
  useEffect(() => setViewer(null), [attachmentViewerScope]);
  // 独立的图片预览窗口同理:本窗口的账号/Hub/凭据一变,它拿那个账号取来的图就不能再挂着。
  const credentialScope = attachmentCacheScope(cfg.serverUrl, cfg.token);
  const shownAccount = useRef({ scope: credentialScope, profileId: cfg.profileId, serverUrl: cfg.serverUrl });
  useEffect(() => {
    const previous = shownAccount.current;
    if (previous.scope === credentialScope) return;
    shownAccount.current = { scope: credentialScope, profileId: cfg.profileId, serverUrl: cfg.serverUrl };
    void closeImageWindowFor(previous);
  }, [credentialScope]);
  // 更像微信·round-2: 长按气泡的动作菜单(引用/删除)。null = 未打开。
  const [menuFor, setMenuFor] = useState<MessageSelection | null>(null);
  // 0.2.78 Vincent:「右键的效果和微信对齐」—— 桌面端菜单落在光标处(微信桌面端就是这样),
  // 触摸端仍是底部 action sheet。null = 用底部 sheet。
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  // 鼠标 + 键盘(pointer-ui.ts):Tauri 壳里任何窗口宽度都是。右键 / 悬停「⋯」开锚定菜单,
  // 不挂长按 —— 桌面上按住鼠标是在拖选文字,不该冒出手机的底部 action sheet。
  const pointer = pointerUi(desktop);
  // 分离聊天窗:页头 = 标题栏(整行拖动 + 给红黄绿灯 / – □ × 让位);其余场景是空对象,页头不变。
  const headerChrome = popoutHeaderChrome(windowChrome, spacing.lg);
  // 放大阅读:单条消息的全屏可选中视图(我们的代码块很长,气泡里读不完)。
  const [expandFor, setExpandFor] = useState<MessageSelection | null>(null);
  // #537 手机长按 = 就地选区 + 微信式浮动菜单(MessageSelectOverlay)。null = 没在选。
  const [selectFor, setSelectFor] = useState<(MessageSelectTarget & { selection: MessageSelection }) | null>(null);
  // 长按时要量气泡在窗口里的位置:每个气泡 View 按「消息键:sent|reply」登记。回调按键缓存,滚动重渲染不反复解绑。
  const bubbleViews = useRef(new Map<string, View>());
  const bubbleRefFns = useRef(new Map<string, (el: View | null) => void>());
  const bubbleRef = (key: string) => {
    let fn = bubbleRefFns.current.get(key);
    if (!fn) {
      fn = (el: View | null) => { if (el) bubbleViews.current.set(key, el); else bubbleViews.current.delete(key); };
      bubbleRefFns.current.set(key, fn);
    }
    return fn;
  };
  // 换了会话(双栏里点了别人)选区层不能挂着别人的气泡位置。
  useEffect(() => setSelectFor(null), [conversationKeyFor]);
  const openSelect = (bubbleKey: string, selection: MessageSelection, tone: MessageSelectTarget['tone']) => {
    const el = bubbleViews.current.get(bubbleKey) as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | undefined;
    // 量不到(极少:气泡刚被回收)就退回原来的底部菜单,长按至少有反应。
    if (!el?.measureInWindow) { setMenuFor(selection); return; }
    el.measureInWindow((x, y, width, height) => {
      if (!(width > 0 && height > 0)) { setMenuFor(selection); return; }
      setSelectFor({ rect: { x, y, width, height }, raw: selection.text, tone, selection });
    });
  };
  // 光标定位的菜单要夹在窗口内,否则贴右/贴底时会被切掉。
  const { width: menuWindowWidth, height: menuWindowHeight } = useWindowDimensions();
  // 多选:进入后气泡带复选框,底栏给转发/删除。
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  // 微信式引用:选中「引用」后不往输入框塞文字,而是在输入框上方挂一条引用条(可 ×),发送时拼成
  // 「@作者: 文本」前缀;对方气泡下方渲染成灰色引用条。null = 没在引用。
  const [quote, setQuote] = useState<QuoteRef | null>(null);
  // 复制消息(Vincent 2026-09-16):动作菜单里的「复制」+ 桌面端悬停气泡时右上角的复制按钮。
  // 复制成功后底部居中出一个「已复制」小 pill,1.4s 自动消失。
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  // 悬停只认 DOM 的 mouseenter / mouseleave(移到子元素上不算离开)。RN-web Pressable 的 onHoverOut 不行:
  // 它带 contain,指针一进气泡里的「复制 / ⋯」这两个嵌套 Pressable 就判外层「离开」→ 按钮被卸掉,永远点不到。
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // 悬停「⋯」:菜单落在给定点(和右键同一个锚定菜单)。
  const openMenuAt = (at: { x: number; y: number }, selection: MessageSelection) => { setMenuAt(at); setMenuFor(selection); };
  const copyMessage = (text: string) => copyValue(copyTextOf(text));
  // 原样复制(选中内容 / 选择视图的全文):不再过 copyTextOf,那会把以「」开头的选区当引用行剥掉。
  const copyValue = async (value: string) => {
    if (!value) return;
    try {
      await Clipboard.setStringAsync(value);
    } catch {
      // RN Web / 旧 WebView 没有原生剪贴板时退回浏览器 API
      try { await (globalThis as any).navigator?.clipboard?.writeText?.(value); } catch { return; }
    }
    setCopiedAt(Date.now());
  };
  useEffect(() => {
    if (copiedAt === null) return;
    const timer = setTimeout(() => setCopiedAt(null), COPIED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [copiedAt]);
  const [forwardFor, setForwardFor] = useState<MessageSelection | null>(null);
  // 多选转发:一批消息按时间顺序逐条转发。每条仍走各自的 beginForward(操作键含正文哈希),
  // 所以去重/fail-closed 语义与单条完全一致;**第一条失败即停**,剩下的不发。
  const [forwardBatch, setForwardBatch] = useState<MessageSelection[] | null>(null);
  const [forwardProgress, setForwardProgress] = useState<string | null>(null);
  const [forwardUiOwner, setForwardUiOwner] = useState<string | null>(null);
  const [forwardTargets, setForwardTargets] = useState<Session[]>([]);
  const [forwardQuery, setForwardQuery] = useState('');
  const [forwardingTo, setForwardingTo] = useState<string | null>(null);
  const forwardingRef = useRef(false);
  const forwardOperationKeyRef = useRef<string | null>(null);
  const [forwardAmbiguous, setForwardAmbiguous] = useState(false);
  const [sendConfirmation, setSendConfirmation] = useState<SendConfirmation | null>(null);
  // 成功且送达如你所愿时这里是 null,于是什么都不渲染 —— 气泡角上的「已送达 ✓」
  // 已经说过一次了。
  const sendNotice = sendConfirmation ? sendNoticeFor(sendConfirmation, alias) : null;

  // ChatScreen is reused while navigating between aliases. A confirmation is
  // scoped to the conversation where that write completed, never the next one.
  useEffect(() => {
    setSendConfirmation(null); setForwardFor(null); setForwardUiOwner(null); setForwardingTo(null); setForwardAmbiguous(false);
    // app#166 —— 快速切换会话时,上一个 Agent 的搜索结果一条都不能留下。
    setSearchOpen(false); setSearchQuery(''); setSearchHits([]); setSearchCurrent(-1); setSearchLoading(false); setSearchFailed(false);
    searchPagesRef.current = 0; savedOffsetRef.current = null; setHighlight(null);
  }, [conversationKeyFor]);

  // app#166 —— 搜索:先在已加载历史里找;没命中就向 hub 要更早的页(有上限),结果只认当前会话。
  const searchable = messages.map(m => ({
    key: msgKey(m),
    text: [m.content, m.result ?? m.reply].filter(Boolean).join('\n'),
    sender: resolveSender(m, currentUsername).alias,
    createdAt: m.created_at,
  }));
  useEffect(() => {
    if (!searchOpen) return;
    const startedKey = conversationKeyFor;
    const hits = searchItems(searchable, searchQuery);
    setSearchHits(hits);
    setSearchCurrent(prev => (hits.length === 0 ? -1 : Math.min(Math.max(prev, 0), hits.length - 1)));
    if (!shouldLoadOlderForSearch({ hits: hits.length, hasOlder, pagesLoaded: searchPagesRef.current, maxPages: SEARCH_MAX_OLDER_PAGES })) {
      setSearchLoading(false);
      return;
    }
    if (loadingOlder) return; // 上一页还在路上;它落地后 messages 变化会再进这里
    let cancelled = false;
    setSearchLoading(true);
    setSearchFailed(false);
    (async () => {
      try {
        searchPagesRef.current += 1;
        await loadOlder();
      } catch {
        if (!cancelled && !isStaleSearch(startedKey, visibleConversationKeyRef.current)) setSearchFailed(true);
      } finally {
        if (!cancelled && !isStaleSearch(startedKey, visibleConversationKeyRef.current)) setSearchLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, searchQuery, messages, hasOlder, conversationKeyFor]);

  const openSearch = () => {
    savedOffsetRef.current = lastOffsetRef.current;
    searchPagesRef.current = 0;
    setSearchFailed(false);
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery(''); setSearchHits([]); setSearchCurrent(-1); setSearchLoading(false); setSearchFailed(false);
    // 关闭搜索回到同一会话、同一滚动位置。
    const saved = savedOffsetRef.current;
    if (saved !== null) {
      setTimeout(() => listRef.current?.scrollToOffset({ offset: saved, animated: false }), 0);
      savedOffsetRef.current = null;
    }
  };
  const retrySearchOlder = () => {
    setSearchFailed(false);
    searchPagesRef.current = Math.max(0, searchPagesRef.current - 1);
    setSearchQuery(q => q); // 触发 effect 重跑
    setHighlightTick(t => t + 1);
  };
  // 用 key 找**当前** messages 里的下标(列表可能在结果算出后又长了),滚过去并高亮 2 秒。
  // 搜索定位和回复引用条点击共用。
  // align 'top'(「去会话」落到那一条):消息顶边对齐可视区顶边 —— 定时任务的回复常常比一屏还高,居中会把回复的
  // 开头推到屏幕外面。列表是 inverted 的,viewPosition 1 = 视觉上的顶边。搜索 / 引用条仍居中。
  const locateViewPosRef = useRef(0.5);
  const locateKey = (key: string, align: 'center' | 'top' = 'center') => {
    const index = messages.findIndex(m => msgKey(m) === key);
    if (index < 0) return;
    const viewPosition = locateViewPosRef.current = align === 'top' ? 1 : 0.5;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition });
    setHighlight({ key, at: Date.now() });
    // 远处的目标要先滚过去(还没量到布局时 onScrollToIndexFailed 再补一次):滚完再从头计 2 秒,
    // 不然人看到它的时候高亮已经过了一大半(#463 量到:落地后只亮了 0.5 秒)。
    setTimeout(() => setHighlight(h => (h && h.key === key ? { key, at: Date.now() } : h)), LOCATE_SETTLE_MS);
    setTimeout(() => setHighlightTick(t => t + 1), LOCATE_SETTLE_MS + 2100);
  };
  const locateHit = (i: number) => {
    const hit = searchHits[i];
    if (!hit) return;
    setSearchCurrent(i);
    locateKey(hit.key);
  };
  const stepSearch = (dir: 'older' | 'newer') => {
    const next = stepHit(searchCurrent, searchHits.length, dir);
    if (next >= 0) locateHit(next);
  };
  // Android 返回键:先关搜索,不退出会话。
  useEffect(() => {
    if (!searchOpen || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeSearch(); return true; });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);
  // 桌面 Ctrl/⌘+F:直接打开「查找聊天内容」(已开就把光标放回搜索框)。登记在 设置 → 快捷键
  // (shortcuts-model.ts FIXED_SHORTCUTS 'chatFind')。只在会话页挂着时生效(节点页的规则文件有自己的 Ctrl/⌘+F)。
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!(desktop || isTauriDesktop()) || !doc?.addEventListener) return;
    const mac = isMacKeyboard();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isChatFindKey(e, mac)) return;
      e.preventDefault();
      setInfoOpen(false);
      openSearchRef.current();
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [desktop]);
  // 桌面语音快捷键(设置 → 快捷键 → 输入:按住说话 / 语音输入开关,voice-shortcut-model.ts):走和工具栏麦克风
  // 同一套处理(按下冻结光标处选区、松开识别后插到光标处)。挂在 window 的捕获阶段 —— 先于 DesktopWorkspace 的
  // document 捕获监听:这里接住的它就不再管;这里没挂(没有会话)时它提示「先打开一个会话」。
  const [kbdVoice, setKbdVoice] = useState<{ mode: KbdVoiceMode; combo: string } | null>(null);
  const kbdStateRef = useRef<KbdVoiceState>(KBD_IDLE);
  // 动作就是录音条的三个动作(desktop-voice-bar-model.ts):开始 = 点 🎤,松开 = 完成,Esc = 取消。
  const kbdVoiceRef = useRef({ voice, start: desktopMicClick, done: desktopVoiceDone, cancel: desktopVoiceCancel });
  kbdVoiceRef.current = { voice, start: desktopMicClick, done: desktopVoiceDone, cancel: desktopVoiceCancel };
  useEffect(() => {
    const win = (globalThis as any).window;
    const doc = (globalThis as any).document;
    if (!desktop || !win?.addEventListener) return;
    const mac = isMacKeyboard();
    const run = (r: KbdVoiceStep, event?: Event) => {
      kbdStateRef.current = r.state;
      if (r.consume) { event?.preventDefault(); event?.stopPropagation(); }
      const { voice: v, start, done, cancel } = kbdVoiceRef.current;
      if (r.effect === 'press') {
        if (!v.available) { setComposerNotice(t('chat.voiceUnavailable')); kbdStateRef.current = KBD_IDLE; return; }
        start();
        // 未配置:麦克风那条路弹「去设置」提示、不开录 —— 键盘这边不进入录音态(否则开关模式要多按一次)。
        if (!v.configured) kbdStateRef.current = KBD_IDLE;
        else if (r.state.mode !== 'idle') setKbdVoice({ mode: r.state.mode, combo: r.state.combo });
      } else if (r.effect === 'release') done();
      else if (r.effect === 'cancel') cancel();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || shortcutCaptureActive()) return;
      const combo = comboFromEvent(e, mac);
      const id = shortcutForCombo(shortcutBindings(), combo);
      const shortcut = id === 'input.voiceHold' ? 'hold' : id === 'input.voiceToggle' ? 'toggle' : null;
      const escape = e.key === 'Escape' || e.key === 'Esc';
      if (!shortcut && !escape) return;
      run(kbdVoiceKeyDown(kbdStateRef.current, { shortcut, combo, repeat: e.repeat, escape }, { composer: true, voiceIdle: kbdVoiceRef.current.voice.state.phase === 'idle' }), e);
    };
    const onKeyUp = (e: KeyboardEvent) => run(kbdVoiceKeyUp(kbdStateRef.current, e, mac), e);
    const onBlur = () => run(kbdVoiceBlur(kbdStateRef.current));
    const onVisibility = () => { if (doc?.visibilityState === 'hidden') onBlur(); };
    win.addEventListener('keydown', onKeyDown, true);
    win.addEventListener('keyup', onKeyUp, true);
    win.addEventListener('blur', onBlur);
    doc?.addEventListener?.('visibilitychange', onVisibility);
    return () => {
      win.removeEventListener('keydown', onKeyDown, true);
      win.removeEventListener('keyup', onKeyUp, true);
      win.removeEventListener('blur', onBlur);
      doc?.removeEventListener?.('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);
  // 录音自己结束了(60 s 上限 / 太短 / 开麦失败 / 未配置):键盘这边也回 idle;整句结束后录音条换回普通提示。
  useEffect(() => {
    kbdStateRef.current = kbdVoiceSync(kbdStateRef.current, voice.state.phase);
    if (voice.state.phase === 'idle') setKbdVoice(null);
  }, [voice.state.phase]);
  const searchState =chatSearchState({ query: searchQuery, loading: searchLoading, hits: searchHits.length, failed: searchFailed });
  void highlightTick;
  const highlightExtra = useMemo(() => ({ highlight, highlightTick }), [highlight, highlightTick]);

  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!pointer || !doc?.addEventListener) return;
    const handleMessageContextMenu = (event: any) => {
      const bubble = event.target?.closest?.('[data-message-key]');
      const key = bubble?.getAttribute?.('data-message-key');
      const part = bubble?.getAttribute?.('data-message-part');
      if (!key || !part) return;
      const item = messages.find(message => msgKey(message) === key);
      const text = part === 'reply' ? (item?.result ?? item?.reply ?? '') : (item?.content ?? '');
      if (!item || !text) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      const author = part === 'reply' ? alias : resolveSender(item, currentUsername).alias;
      // 微信桌面端的菜单落在光标处,不是屏幕底部。坐标在这里就有,不用再测一次布局。
      const x = typeof event.clientX === 'number' ? event.clientX : null;
      const y = typeof event.clientY === 'number' ? event.clientY : null;
      setMenuAt(x !== null && y !== null ? { x, y } : null);
      // 我们的右键菜单替掉了浏览器自带的「复制」:拖选完再右键,要能只复制选中的那段。
      const selectedText = selectedTextWithin(bubble, (globalThis as any).getSelection?.());
      setMenuFor({ item, text, author, selectedText });
    };
    doc.addEventListener('contextmenu', handleMessageContextMenu, true);
    return () => doc.removeEventListener('contextmenu', handleMessageContextMenu, true);
  }, [pointer, messages]);

  // 菜单/放大阅读:Esc 关闭(桌面端)。微信桌面端也没有「取消」那一行。
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!pointer || !doc?.addEventListener) return;
    if (!menuFor && !expandFor) return;
    const onKeyDown = (event: any) => {
      if (event.key !== 'Escape') return;
      event.preventDefault?.();
      if (expandFor) setExpandFor(null);
      else setMenuFor(null);
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [pointer, menuFor, expandFor]);

  const openForwardPicker = async (selection: MessageSelection, batch?: MessageSelection[]) => {
    setMenuFor(null);
    setForwardFor(selection);
    setForwardBatch(batch && batch.length > 1 ? batch : null);
    setForwardProgress(null);
    setForwardUiOwner(conversationKeyFor);
    setForwardQuery('');
    setForwardAmbiguous(false);
    try {
      const data = await fetchStatus(cfg);
      setForwardTargets((data.sessions ?? []).filter(session => session.alias));
    } catch {
      setForwardTargets([]);
    }
  };

  const forwardMessage = async (target: string) => {
    if (!forwardFor || forwardingRef.current || forwardAmbiguous) return;
    const startedKey = conversationKeyFor;
    const mayWrite = () => mayProjectForward(startedKey, visibleConversationKeyRef.current, mountedRef.current);
    // 一批消息按时间顺序逐条发。每条各自 beginForward,所以「同一条重复转发」仍然被操作键挡住;
    // 🔴 第一条不确定就停 —— 继续发下去会把「哪一条没确认」埋进一串成功里。
    const queue = forwardBatch ?? [forwardFor];
    forwardingRef.current = true;
    setForwardingTo(target);
    let sent = 0;
    let lastResponse: Awaited<ReturnType<typeof sendTask>> | null = null;
    try {
      for (const selection of queue) {
        const begun = beginForward(startedKey, target, selection.text, createDashboardRequestId);
        forwardOperationKeyRef.current = begun.operation.key;
        if (!begun.started) {
          // 这条已经有一个未完成的转发操作(pending/ambiguous):不重发,停在这里。
          if (mayWrite()) {
            setForwardAmbiguous(true);
            setForwardProgress(queue.length > 1 ? t('chat.forwardPartial', { sent, total: queue.length }) : null);
          }
          return;
        }
        try {
          lastResponse = await sendTask(cfg, target, selection.text, undefined, 'normal', begun.operation.requestId);
          confirmForward(begun.operation.key);
          sent += 1;
        } catch (error) {
          // No public forward reconciliation endpoint currently proves whether an
          // ACK-loss write committed. Fail closed and disable repeat taps.
          markForwardAmbiguous(begun.operation.key);
          if (mayWrite()) {
            setForwardAmbiguous(true);
            setForwardProgress(queue.length > 1 ? t('chat.forwardPartial', { sent, total: queue.length }) : null);
            Alert.alert(
              t('chat.forwardUncertain'),
              queue.length > 1
                ? t('chat.forwardPartialUncertain', { sent, total: queue.length })
                : t('chat.checkDestination'),
            );
          }
          return;
        }
      }
      if (mayWrite()) {
        if (lastResponse) setSendConfirmation(sendConfirmationFromResponse(lastResponse));
        setForwardFor(null);
        setForwardBatch(null);
        setForwardProgress(null);
        exitSelectionMode();
      }
    } finally {
      forwardingRef.current = false;
      if (mayWrite()) setForwardingTo(null);
    }
  };

  // ── 菜单动作(0.2.78) ────────────────────────────────────────────────────
  const menuGroups = useMemo(
    () => messageMenuGroups({ hasText: !!menuFor?.text, selectionMode, canForward: true, touch: !pointer, selectedText: menuFor?.selectedText }),
    [menuFor, selectionMode, pointer],
  );
  const onMenuAction = (key: MessageMenuKey) => {
    const selection = menuFor;
    if (!selection) return;
    if (key === 'copy') { setMenuFor(null); void copyMessage(selection.text); return; }
    if (key === 'copySelection') { setMenuFor(null); void copyValue(selection.selectedText ?? ''); return; }
    if (key === 'quote') {
      setQuote({ author: selection.author, text: compactQuoteText(selection.text) });
      setMenuFor(null);
      mainComposerRef.current?.focus?.();
      return;
    }
    if (key === 'forward') { void openForwardPicker(selection); return; }
    if (key === 'multiSelect') {
      setMenuFor(null);
      setSelectionMode(true);
      setSelectedKeys([msgKey(selection.item)]);
      return;
    }
    if (key === 'expand') { setMenuFor(null); setExpandFor(selection); return; }
    if (key === 'delete') { setMessages(prev => removeMessage(prev, selection.item)); setMenuFor(null); }
  };

  // #537 浮动菜单动作:整条选中 = 与原来长按菜单同一条路(复制走 copyTextOf);只选了一段 = 就那一段。
  const onSelectAction = (key: SelectMenuKey, payload: SelectionPayload) => {
    const target = selectFor;
    if (!target) return;
    const selection = target.selection;
    const part = payload.kind === 'part' ? payload.text : null;
    setSelectFor(null);
    // #650:「复制」直接进剪贴板 + 底部「已复制」,浮层已在上面关掉 —— 不再经过任何选区卡片 / 全屏页。
    if (key === 'copy') { void copyValue(copyValueFor(payload, selection.text, copyTextOf)); return; }
    if (key === 'forward') { void openForwardPicker(part !== null ? { ...selection, text: part } : selection); return; }
    if (key === 'quote') {
      setQuote({ author: selection.author, text: compactQuoteText(part ?? selection.text) });
      mainComposerRef.current?.focus?.();
      return;
    }
    if (key === 'multiSelect') { setSelectionMode(true); setSelectedKeys([msgKey(selection.item)]); return; }
    // 'selectText' 由浮层自己就地切到划选(#650),不会传到这里;不再开全屏「选择文本」页。
    if (key === 'expand') { setExpandFor(selection); return; }
    if (key === 'delete') setMessages(prev => removeMessage(prev, selection.item));
  };

  // ── 多选(0.2.78) ────────────────────────────────────────────────────────
  const exitSelectionMode = () => { setSelectionMode(false); setSelectedKeys([]); };
  const toggleSelected = (key: string) =>
    setSelectedKeys(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  /** 选中的消息按会话顺序(旧→新)排,转发时才不会把上下文发颠倒。 */
  const selectedSelections = (): MessageSelection[] => {
    const chosen = new Set(selectedKeys);
    return messages
      .filter(item => chosen.has(msgKey(item)))
      .slice()
      .reverse() // messages 是 newest-first(inverted 列表)
      .map(item => ({
        item,
        text: item.content ?? '',
        author: resolveSender(item, currentUsername).alias,
      }))
      .filter(selection => selection.text);
  };
  const onSelectionAction = (key: MessageMenuKey) => {
    const chosen = selectedSelections();
    if (key === 'delete') {
      const keys = new Set(selectedKeys);
      setMessages(prev => prev.filter(item => !keys.has(msgKey(item))));
      exitSelectionMode();
      return;
    }
    if (key === 'forward' && chosen.length > 0) void openForwardPicker(chosen[0], chosen);
  };
  // 更像微信·round-3: 滚离底部时的「回到最新」pill + 未读计数。
  const listRef = useRef<FlatList<ChatItem>>(null);
  const [showJump, setShowJump] = useState(false);
  const [unread, setUnread] = useState(0);
  const newestKeyRef = useRef<string | undefined>(undefined);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y; // inverted: 0 = 底部(最新)
    lastOffsetRef.current = y;
    setShowJump(shouldShowJumpPill(y));
    if (y < 40) setUnread(0); // 回到底部 → 清未读
  };
  const jumpToLatest = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setUnread(0);
    setShowJump(false);
  };
  // 滚在上面时来了新消息(最新条 key 变化)→ 未读 +1;停在底部则清零。
  useEffect(() => {
    const k = messages[0] && (messages[0]._localId ?? messages[0].task_id);
    if (newestKeyRef.current !== undefined && k !== newestKeyRef.current) {
      setUnread(u => nextUnread(u, !showJump, 1));
    }
    newestKeyRef.current = k;
  }, [messages, showJump]);

  // 「去会话」落到那一条(message-focus.ts):定时任务执行记录 / 事件流带来的 task_id、回复引用条点的那条。
  // 已加载就滚过去高亮;不在已加载的消息里就往前多拉(每次 FOCUS_PAGE_STEP 条,最多 FOCUS_MAX_LIMIT),
  // 到头还没有就提示一句、停在最新。
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const goToMessage = (key: string) => setFocusTarget(key);
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusTaskId || focusedRef.current === focusTaskId) return;
    focusedRef.current = focusTaskId;
    setFocusTarget(focusTaskId);
  }, [focusTaskId]);
  useEffect(() => {
    if (!focusTarget) return;
    const step = nextFocusStep({ index: messages.findIndex(m => msgKey(m) === focusTarget), ready: conversationReady, hasOlder, loading: loadingOlder, limit: limitRef.current });
    if (step.kind === 'wait') return;
    if (step.kind === 'locate') { setFocusTarget(null); setTimeout(() => locateKey(focusTarget, 'top'), 0); return; }
    if (step.kind === 'missing') { setFocusTarget(null); setComposerNotice(t('chat.focusNotFound')); return; }
    setLoadingOlder(true);
    limitRef.current = step.limit;
    void load(step.limit).finally(() => setLoadingOlder(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget, conversationReady, messages, hasOlder, loadingOlder]);

  // #161 列表徽标：打开会话不清零；只有消息真正展示到最新才清。
  useEffect(() => {
    dispatchUnread({ kind: 'conversation_opened', agent: alias });
    // 列表菜单里手动「标为未读」的红点:点进会话就算读过(微信同款)。
    conversationOpened(cfg, alias);
    return () => {
      dispatchUnread({ kind: 'conversation_left' });
    };
  }, [alias]);
  useEffect(() => {
    if (!conversationReady) return;
    if (showJump) {
      dispatchUnread({ kind: 'conversation_opened', agent: alias });
      return;
    }
    dispatchUnread({ kind: 'rendered_to_latest', agent: alias });
    // 回复未读(inbox 表那一半)也在这一刻清:推进该 agent 的水位线并持久化。
    markAgentRepliesSeen(alias);
    // #1828:hub 给权威数时,同一刻把这个 agent 的未读在 hub 上 ack 掉(两表);失败不影响本地清零,下次渲染再补。
    // 先试 agent 级 ack(hub ≥ .55 一次清该 agent 全部未读;老 hub 400 → 退回按当前页 id)。
    if (hubHasAgentUnread()) {
      void ackAgentUnread(alias, {
        ackAgent: agent => ackAgentMessages(cfg, agent),
        ackIds: ids => ackUserMessages(cfg, ids),
        idsFor: agent => unackedIdsForAgent(agent),
        clearServerUnread: agent => markAgentServerUnreadCleared(agent),
        warn: (message, error) => console.warn(message, error),
      });
    }
  }, [alias, conversationReady, showJump]);

  // shared by the sent bubble and the reply bubble (tg 771)
  // mine:画在「我发出的」实底气泡里(#545)—— 直接画在底色上的「📎 文件名」/ 上传状态改用 onBubbleMine。
  const renderAttachment = (a: AttachmentView, gallery: ViewerImage[] = galleryOf([a]), mine = false) =>
    a.isImage && a.uri && !a.needsAuth ? (
      <Pressable key={a.key} onPress={() => openViewer(gallery, a.key, a.uri)}>
        <Image source={{ uri: a.uri }} style={styles.thumb} resizeMode="contain" />
      </Pressable>
    ) : a.isImage && a.needsAuth && Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__ ? (
      <AuthedWebThumb
        key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`}
        uri={a.uri!}
        name={a.name}
        mime={a.mime}
        token={cfg.token}
        onPress={objectUrl => openViewer(gallery, a.key, objectUrl)}
      />
    ) : a.isImage && a.needsAuth && Platform.OS !== 'web' ? (
      <View key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`} style={styles.attachmentImage}>
        <AuthedThumb
          fileId={a.key}
          name={a.name}
          mime={a.mime}
          serverUrl={cfg.serverUrl}
          token={cfg.token}
          onPress={localUri => openViewer(gallery, a.key, localUri)}
        />
        <AttachmentFile
          fileId={a.key}
          name={a.name}
          mime={a.mime}
          serverUrl={cfg.serverUrl}
          token={cfg.token}
          label={t('chat.downloadOriginal')}
        />
      </View>
    ) : a.isVideo && a.needsAuth && Platform.OS !== 'web' ? (
      <AuthedVideo
        key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`}
        fileId={a.key}
        name={a.name}
        mime={a.mime}
        size={a.size}
        serverUrl={cfg.serverUrl}
        token={cfg.token}
      />
    ) : a.needsAuth && Platform.OS !== 'web' ? (
      <AttachmentFile
        key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`}
        fileId={a.key}
        name={a.name}
        mime={a.mime}
        serverUrl={cfg.serverUrl}
        token={cfg.token}
      />
    ) : a.needsAuth && a.uri && Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__ ? (
      // 桌面端非图片附件(含视频):此前只画一行文字没接点击(Vincent 2026-09-07「点击了没反应」)
      <AttachmentFileDesktop
        key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`}
        uri={a.uri}
        name={a.name}
        token={cfg.token}
        size={a.size}
      />
    ) : (
      <Text key={a.key} style={[styles.attachmentLine, bubbleInk(mine, 'link')]}>
        📎 {a.name}
      </Text>
    );

  // 多图(≥2 张能画缩略图的图)= 微信式 3 列方格;单图/文件/视频仍走 renderAttachment,不改原样子。
  const gridRenderable = (a: AttachmentView) =>
    a.isImage && !!a.uri && (!a.needsAuth || Platform.OS !== 'web' || !!(globalThis as any).__TAURI_INTERNALS__);
  const renderGridCell = (a: AttachmentView, item: ChatItem | undefined, gallery: ViewerImage[]) => {
    const state = a.localIndex !== undefined ? item?._uploads?.[a.localIndex] : undefined;
    const failed = state?.status === 'failed';
    const cellKey = `${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`;
    const inner = !a.needsAuth ? (
      <Pressable onPress={() => openViewer(gallery, a.key, a.uri)} accessibilityLabel={t('chat.previewName', { name: a.name })}>
        <Image source={{ uri: a.uri }} style={styles.gridImage} resizeMode="cover" />
      </Pressable>
    ) : Platform.OS === 'web' ? (
      <AuthedWebThumb uri={a.uri!} name={a.name} mime={a.mime} token={cfg.token} compact onPress={objectUrl => openViewer(gallery, a.key, objectUrl)} />
    ) : (
      <AuthedThumb fileId={a.key} name={a.name} mime={a.mime} serverUrl={cfg.serverUrl} token={cfg.token} compact onPress={localUri => openViewer(gallery, a.key, localUri)} />
    );
    return (
      <View key={cellKey} style={[styles.gridCell, failed && styles.gridCellFailed]} testID="chat-image-grid-cell">
        {inner}
        {state && state.status !== 'done' ? (
          <View style={[styles.gridOverlay, failed && styles.gridOverlayFailed]} pointerEvents={failed ? 'box-none' : 'none'}>
            {state.status === 'uploading' ? <ActivityIndicator size="small" color="#fff" /> : null}
            <Text style={styles.gridOverlayText} numberOfLines={2}>
              {state.status === 'queued' ? t('chat.uploadQueued') : state.status === 'uploading' ? t('chat.uploading') : t('chat.uploadFailed')}
            </Text>
          </View>
        ) : null}
        {failed && item?._failed && a.localIndex !== undefined ? (
          <Pressable
            accessibilityLabel={t('chat.removeName', { name: a.name })}
            hitSlop={8}
            style={styles.gridRemove}
            onPress={() => removeFailedAttachment(item, a.localIndex!)}
          >
            <Text style={styles.gridRemoveText}>✕</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };
  const renderAttachments = (views: AttachmentView[], item?: ChatItem, mine = false) => {
    const gridViews = views.filter(gridRenderable);
    // 预览里左右滑 = 这条消息的全部图片(方格 + 单图同一套)。
    const gallery = galleryOf(views);
    if (gridViews.length < 2) {
      return views.map(a => {
        const state = a.localIndex !== undefined ? item?._uploads?.[a.localIndex] : undefined;
        if (!state || state.status === 'done') return renderAttachment(a, gallery, mine);
        return (
          <View key={`state-${a.key}`}>
            {renderAttachment(a, gallery, mine)}
            <Text style={[styles.attachmentLine, state.status === 'failed' && { color: colors.failed }, bubbleInk(mine)]}>
              {state.status === 'failed' ? t('chat.uploadError', { error: state.error ?? '' }) : state.status === 'uploading' ? t('chat.uploadProgress') : t('chat.uploadQueued')}
            </Text>
          </View>
        );
      });
    }
    const rest = views.filter(a => !gridRenderable(a));
    return (
      <>
        <View style={styles.imageGrid} testID="chat-image-grid">
          {gridViews.map(a => renderGridCell(a, item, gallery))}
        </View>
        {rest.map(a => renderAttachment(a, gallery, mine))}
      </>
    );
  };

  const doSend = async (
    content: string,
    localId: string,
    imgs: PickedImage[] = [],
    priority: TaskPriority = 'normal',
    original = false,
  ) => {
    const startedConversationKey = conversationKeyFor;
    const startedAlias = alias;
    beginSend(localId);
    try {
      await doSendAttempt(content, localId, imgs, priority, original, startedConversationKey, startedAlias);
    } finally {
      endSend(localId);
      // Whatever happened above, any instance still showing this echo re-derives it now.
      notifyOutboxListeners();
    }
  };

  const doSendAttempt = async (
    content: string,
    localId: string,
    imgs: PickedImage[],
    priority: TaskPriority,
    original: boolean,
    startedConversationKey: string,
    startedAlias: string,
  ) => {
    const mayTouchVisibleState = () => mayApplySendResult(
      startedConversationKey,
      visibleConversationKeyRef.current,
      mountedRef.current,
    );
    const reconcileStartedConversation = async () => {
      const data = await fetchTasks(cfg, { to_name: startedAlias, limit: limitRef.current });
      const fetched = data.tasks ?? [];
      const confirmed = new Set(confirmedOutboxIds(outboxForAlias(startedAlias), fetched));
      confirmed.forEach(outboxRemove);
      conversations.put(startedConversationKey, fetched);
    };
    try {
      let attachments: TaskAttachment[] | undefined;
      let outgoing = content;
      if (imgs.length) {
        // 并发 ≤ 3、按选择顺序;逐张状态画在回显气泡的缩略图上。
        const setState = (index: number, state: UploadState) => {
          if (!mayTouchVisibleState()) return;
          setMessages(prev => prev.map(t => (t._localId === localId ? { ...t, _uploads: withUploadState(t._uploads, imgs.length, index, state) } : t)));
        };
        // #527:已传上的那张(记在 outbox,重挂/重开后也认)复用 file_id,不重传;没传上的才传。
        const run = await uploadForSend<PickedImage & ResendImage>({
          localId,
          imgs,
          upload: async img => {
            const prepared = await prepareForUpload(img, original);
            const tooBig = oversizeMessage(prepared);
            if (tooBig) throw new Error(tooBig);
            return { img: prepared, up: await uploadImage(cfg, prepared) };
          },
          memo: {
            get: img => uploadMemo.get(cfg.serverUrl, img.uri, original),
            set: (img, done) => uploadMemo.set(cfg.serverUrl, img.uri, original, done),
          },
          concurrency: UPLOAD_CONCURRENCY,
          onState: setState,
          fallbackError: t('chat.attachmentFailed'),
        });
        if (!run.ok) {
          // 🔴 一张没传上就整条不发:绝不静默发出缺图的半条消息。sendTask 根本没调用,
          // 不存在「hub 其实收到了」的歧义,直接标未送达,让用户重试(已传的不重传)或移除失败的那几张。
          const summary = run.summary;
          outboxMarkFailed(localId);
          if (mayTouchVisibleState()) {
            setMessages(prev => prev.map(t => (t._localId === localId ? { ...t, _pending: false, _failed: true, _uploadError: summary } : t)));
          }
          return;
        }
        const uploaded = run.uploaded;
        attachments = uploaded.map(({ img, up }) => toTaskAttachment(img, up));
        outgoing = `${content}${uploaded.map(({ img, up }) => attachmentTextHint(img, up)).join('')}`;
      }
      const response = await sendTask(cfg, alias, outgoing, attachments, priority, dashboardRequestIdForLocalId(localId));
      imgs.forEach(releaseClipboardAttachment);
      // delivered: drop the echo, the server copy arrives with reload.
      // 🔴 outbox 唯一删除路径=此处(sendTask 确认成功)。
      outboxRemove(localId);
      if (!mayTouchVisibleState()) {
        // The main window reuses ChatScreen while switching aliases. The old
        // send succeeded, but its completion belongs to the old cache only.
        try { await reconcileStartedConversation(); } catch { /* next open refreshes it */ }
        return;
      }
      setSendConfirmation(sendConfirmationFromResponse(response));
      // Keep the echo on screen, marked delivered, until the server row arrives; the merge in
      // load() drops it once a fetched row carries the same task_id (or matches by content/time).
      const confirmedTaskId = typeof (response as any)?.task_id === 'string' ? (response as any).task_id : undefined;
      setMessages(prev => prev.map(t => (t._localId === localId ? { ...t, _pending: false, _confirmedTaskId: confirmedTaskId } : t)));
      recordSendBubble(dashboardRequestIdForLocalId(localId), 'sent');
      await load(limitRef.current);
    } catch (sendError) {
      const failReason = sendFailureReason(sendError) ?? undefined;
      // Timeout is not proof that the write failed. The Hub may have committed
      // the task and lost only the HTTP acknowledgement; reconcile before a
      // red retry action can manufacture duplicate work.
      if (!mayTouchVisibleState()) {
        // A late A failure while B is visible is ambiguous, not a reason to
        // paint a retry under B. Reconcile A directly without borrowing B's
        // request token; leave it pending if the Hub is unreachable.
        try { await reconcileStartedConversation(); } catch { /* the hub is unreachable: unconfirmed */ }
        // #518: still unconfirmed ⇒ 「未送达」, never a 「发送中…」 that nobody will finish. The instance
        // showing this conversation now (or the next one to open it) picks it up from the outbox; retry
        // reuses the same client_request_id, so a send the hub did take is deduplicated, not doubled.
        if (outboxForAlias(startedAlias).some(entry => entry.id === localId)) {
          outboxMarkFailed(localId);
          recordSendBubble(dashboardRequestIdForLocalId(localId), 'failed');
        }
        return;
      }
      const exposeFailure = await shouldExposeSendFailure(
        () => load(limitRef.current),
        () => outboxForAlias(startedAlias).some(entry => entry.id === localId),
      );
      if (!exposeFailure) return;
      outboxMarkFailed(localId); // 盘上也是 failed——杀 app 重开仍可重试
      setMessages(prev =>
        prev.map(t => (t._localId === localId ? { ...t, _pending: false, _failed: true, _failReason: failReason } : t)),
      );
      recordSendBubble(dashboardRequestIdForLocalId(localId), 'failed');
    }
  };

  const submit = async () => {
    const parsed = parseBtwFirstToken(draft);
    if (parsed.kind === 'invalid') {
      Alert.alert(t('chat.btwQuestion'), parsed.message);
      setBtwLaunch(current => ({ id: (current?.id ?? 0) + 1 }));
      return;
    }
    if (parsed.kind === 'btw') {
      // SideThread owns this prompt from here on. Do not add an optimistic
      // main-chat bubble and never call sendTask as a fallback.
      try {
        const uploaded = await Promise.all(attached.map(item => uploadImage(cfg, item)));
        const attachments = uploaded.map(item => ({ fileId: item.file_id }));
        attached.forEach(releaseClipboardAttachment);
        setDraft('');
        setQuote(null);
        setAttached([]);
        setSendPriority('normal');
        setBtwLaunch(current => ({ id: (current?.id ?? 0) + 1, prompt: parsed.prompt, attachments }));
      } catch (error) {
        Alert.alert(t('chat.btwUpload'), error instanceof Error ? error.message : t('chat.draftKept'));
      }
      return;
    }
    // i18n-allow: outgoing attachment fallback is message content, not interface copy.
    const body = parsed.content.trim() || (attached.length ? `[附件] ${attached.map(item => item.fileName).join('、')}` : '');
    if ((!body && !attached.length) || sending) return;
    const blocked = sendBlocker(attached, willCompressLater);
    if (blocked) {
      setComposerNotice(blocked); // 草稿原样保留,用户移除超限的那张再发
      return;
    }
    // 引用条在前、正文在后;agent 端看到的是「@作者: 被引用内容」+ 正文,客户端渲染时再拆开。
    const content = quote ? buildQuote(quote.text, 40, quote.author) + body : body;
    const imgs = attached;
    const priority = sendPriority;
    const original = sendOriginal;
    setDraft('');
    setQuote(null);
    attachedRef.current = [];
    setAttached([]);
    setSendOriginal(false);
    setSendPriority('normal');
    // Optimistic echo: render the message instantly tagged with a
    // client-only _localId (NOT the server task id, which we don't have
    // yet). doSend drops this echo on success — the subsequent reload brings
    // the real server row — or flags _failed so retry() can resend with the
    // same _localId. The dreq id is both the echo key and the stable Hub
    // correlation id, so retrying this bubble cannot create a new logical send.
    // PR3 判据C:id 跨次启动唯一(重开恢复的旧 local-N 不能和新 id 撞车);
    // 🔴 提交即落盘(网络尝试之前)——发送中被杀,重开后它还在。
    const localId = createDashboardRequestId();
    outboxAdd({ id: localId, alias, content, createdAt: Date.now(), state: 'pending', hadImage: imgs.length > 0, priority, original }, imgs);
    setMessages(prev => [
      { content, created_at: new Date().toISOString(), _localId: localId, _pending: true, _imgs: imgs, _priority: priority, _original: original },
      ...prev,
    ]);
    doSend(content, localId, imgs, priority, original);
  };

  const retry = (item: ChatItem) => {
    // #527:重试发的是「这条消息」——字和图一起。图拿不回来就不发,让用户删掉重选(绝不只发文字)。
    const plan = planResend(item);
    if (plan.kind === 'nothing' || !item._localId) return;
    if (plan.kind === 'images_lost') {
      const id = item._localId;
      Alert.alert(t('chat.imagesLostTitle'), t('chat.imagesLostBody'), [
        { text: t('chat.cancel'), style: 'cancel' },
        { text: t('chat.deleteUnsent'), style: 'destructive', onPress: () => {
          outboxRemove(id);
          setMessages(prev => prev.filter(m => m._localId !== id));
        } },
      ]);
      return;
    }
    const retriedAt = Date.now();
    outboxMarkPending(item._localId, retriedAt); // 重试中被杀照样恢复(仍在盘上)
    setMessages(prev =>
      mergeMessagesNewestFirst(
        prev.map(t => (t._localId === item._localId ? { ...t, created_at: new Date(retriedAt).toISOString(), _pending: true, _failed: false, _failReason: undefined, _uploadError: undefined } : t)),
        [],
      ),
    );
    const priority = item._priority ?? outboxForAlias(alias).find(e => e.id === item._localId)?.priority ?? 'normal';
    doSend(plan.content, item._localId, plan.imgs, priority, !!(item._original ?? outboxEntry(item._localId)?.original));
  };

  // 失败消息里移除一张没传上的附件(微信:「重发」或「删掉这张」)。只在 _failed 时可用。
  const removeFailedAttachment = (item: ChatItem, index: number) => {
    if (!item._localId || !item._failed) return;
    outboxRemoveAttachment(item._localId, index); // outbox 与气泡同序,否则下次重试下标错位(#527)
    setMessages(prev => prev.map(t => {
      if (t._localId !== item._localId) return t;
      const current = t._imgs ?? (t._img ? [t._img] : []);
      const { imgs, states } = removeAttachmentAt(current, t._uploads, index);
      const stillFailing = (states ?? []).some(s => s.status === 'failed');
      return { ...t, _img: undefined, _imgs: imgs, _uploads: states, _uploadError: stillFailing ? t._uploadError : undefined };
    }));
  };

  // Header subtitle, Telegram-style (Vincent tg 739-741): show 正在处理…
  // while a recent task has no result yet, otherwise the session status
  // so he can tell whether the agent is even online.
  const [sessionStatus, setSessionStatus] = useState('');
  // 聊天信息里「规则文件」「技能」出不出现,口径同节点信息页(visibleNodeSections)。
  // 能力位只在全量 /api/status 里有(chat-info-model.ts chatInfoCaps 顶部):下面 30s 的 light 轮询
  // 只给得出 agent-node 那一半(lightCaps,兜底);全量行在进聊天和每次打开聊天信息时取一次(fullCaps)。
  const [lightCaps, setLightCaps] = useState<ChatInfoCaps>({ rules: false, skills: false });
  const [fullCaps, setFullCaps] = useState<ChatInfoCaps | null>(null);
  const sessionCaps = fullCaps ?? lightCaps;
  // Deliberately a slower, separate poll than the 5s message poll above:
  // an agent's online/offline state changes far less often than messages
  // do, so 30s keeps the status badge fresh without doubling the chat's
  // request rate. Don't merge the two — they have different freshness needs.
  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const data = await fetchStatus(cfg);
        const s = (data.sessions ?? []).find(x => x.alias === alias);
        if (live) {
          setSessionStatus(s?.status ?? 'offline');
          const next = chatInfoCaps(s);
          setLightCaps(c => (c.rules === next.rules && c.skills === next.skills ? c : next));
        }
      } catch {
        /* keep last */
      }
    };
    poll();
    const t = setInterval(poll, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [cfg, alias]);
  // 全量行:能力位很少变,不跟 30s 轮询(全量投影比 light 大一个量级)。失败就保留上一次 / 退回 light。
  // 换了聊天对象先清掉,别让上一个 agent 的能力位挂在这一个的聊天信息里。
  useEffect(() => { setFullCaps(null); }, [cfg, alias]);
  useEffect(() => {
    let live = true;
    fetchNodeStatus(cfg, alias)
      .then(data => {
        if (!live) return;
        const s = (data.sessions ?? []).find(x => x.alias === alias);
        if (!s) return;
        const next = chatInfoCaps(s);
        setFullCaps(c => (c && c.rules === next.rules && c.skills === next.skills ? c : next));
      })
      .catch(() => { /* keep last / light fallback */ });
    return () => { live = false; };
  }, [cfg, alias, infoOpen]);

  // "正在处理…" only while a real (non-echo) task is still in a pre-result
  // state AND was created within the last 10 min. The 10-min cutoff is a
  // staleness guard: a task that never produced a result (agent crashed,
  // went offline mid-run) would otherwise leave the subtitle spinning
  // forever — after the window we fall back to the plain online/offline
  // status instead. `created_at` is the hub's space-separated UTC string,
  // so swap space→T and append Z before parsing (cf. time.ts).
  const processing = messages.some(
    m =>
      !m._localId &&
      !m.result &&
      taskExecutionState(m) === 'consumed' &&
      m.created_at &&
      Date.now() - new Date(`${m.created_at.replace(' ', 'T')}Z`).getTime() < 10 * 60 * 1000,
  );
  const subtitle = processing ? t('chat.processing') : sessionStatus ? t(sessionStatus === 'working' || sessionStatus === 'running' ? 'chat.statusWorking' : sessionStatus === 'offline' ? 'chat.statusOffline' : 'chat.statusOnline') : '';

  // One tap = one action (no intermediate 「发送附件」 Alert any more). Picked items go
  // to the main composer draft, exactly as the old 图片/文件 Alert buttons did.
  const runPlusItem = (key: PlusItemKey) => {
    plusEvent('itemPicked');
    const pickInto = (pick: () => Promise<PickedImage | null>) =>
      pick()
        .then(item => { if (item) appendAttachment(item); })
        .catch(error => Alert.alert(t('chat.cannotOpen'), error instanceof Error ? error.message : String(error)));
    if (key === 'album') {
      const slots = remainingImageSlots(attachedRef.current);
      if (slots <= 0) {
        setComposerNotice(t('chat.maxImages', { count: MAX_DRAFT_IMAGES }));
        return;
      }
      pickImages(slots)
        .then(appendAttachments)
        .catch(error => Alert.alert(t('chat.cannotOpen'), error instanceof Error ? error.message : String(error)));
    }
    else if (key === 'file') pickInto(pickDocument);
    else if (key === 'camera') pickInto(pickCameraPhoto);
    else setBtwLaunch(current => ({ id: (current?.id ?? 0) + 1 }));
  };
  const plusItems = plusPanelItems({ os: Platform.OS, desktop, attachEnabled: ATTACH_ENABLED });
  // 桌面「＋」= 系统文件选择器(多选、任意类型),没有中间面板;手机 = 微信式 相册 / 文件 面板。
  const onPlusPress = () => {
    if (plusPressAction({ desktop, attachEnabled: ATTACH_ENABLED }) === 'panel') { plusEvent('toggle'); return; }
    pickFiles()
      .then(appendAttachments)
      .catch(error => Alert.alert(t('chat.cannotOpen'), error instanceof Error ? error.message : String(error)));
  };
  // Mobile row, right of the input: ＋ always; 「发送」 next to it once there is something to send.
  const rightSlot = composerRightSlot({ draft, attachmentCount: attached.length, voiceMode });
  const showExpand = !desktop && shouldShowExpand(inputLines, voiceMode);

  const exactSideThreadTask = messages.find(message => message.thread_id && message.turn_id);
  const sideThreadScope = exactSideThreadTask?.thread_id && exactSideThreadTask.turn_id
    ? {
      sourceThreadId: exactSideThreadTask.thread_id,
      boundary: { kind: 'through' as const, turnId: exactSideThreadTask.turn_id },
    }
    : undefined;

  const infoGroups = chatInfoGroups({
    alias,
    canOpenNode: !!onOpenNodeSettings,
    pin: onTogglePin ? { value: pinned } : null,
    mute: onToggleMute ? { value: muted } : null,
    windowPin: desktop && windowPin.available ? { value: windowPin.pinned } : null,
    btw: SHOW_BTW_ENTRY,
    hasRulesTarget: sessionCaps.rules,
    skillsCapable: sessionCaps.skills,
  });
  const onInfoRow = (row: ChatInfoRow) => {
    switch (row.key) {
      case 'pin': onTogglePin?.(); return;
      case 'mute': onToggleMute?.(); return;
      case 'windowPin': windowPin.toggle(); return;
      case 'search': setInfoOpen(false); openSearch(); return;
      case 'btw': setInfoOpen(false); runPlusItem('btw'); return;
      default:
        // 头像行(概览)和各分区行:打开节点信息页的那个分区。
        setInfoOpen(false);
        if (row.section) requestNodeSection(nodeInfoSectionKey(cfg.profileId ?? cfg.serverUrl, alias), row.section);
        onOpenNodeSettings?.();
    }
  };

  if (composerKind === 'daemon') {
    return (
      <DaemonManagementScreen
        cfg={cfg}
        alias={alias}
        desktop={desktop}
        hideBack={hideBack}
        onBack={onBack}
        onOpenNodeSettings={onOpenNodeSettings}
        onOpenLogs={onOpenNodeSettings ? () => { requestNodeSection(nodeInfoSectionKey(cfg.profileId ?? cfg.serverUrl, alias), 'logs'); onOpenNodeSettings(); } : undefined}
        onOpenManagedChat={onOpenManagedChat}
        onCreate={onCreateNode}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, iosKeyboard.style]}
      testID="chat-pane"
      // Edge-to-edge Android ignores adjustResize, so behavior=undefined
      // left the keyboard covering the input (Vincent tg 738). 'padding'
      // works under edge-to-edge. iOS pads itself (iosKeyboard): RN's KAV
      // mixed parent-relative layout with window coordinates and came out one
      // top safe-area inset short once the chat moved under the nav shell, so
      // the IME covered the composer (#547, keyboard-inset.ts).
      behavior={iosKeyboard.handled ? undefined : 'padding'}
      // RN's Android KAV never resets its padding on keyboardDidHide (it
      // recomputes it from the hide event), which left a keyboard-height band
      // under the composer after dismissing (Vincent, 0.2.102 foldable). Only
      // let it pad while the keyboard is actually up. See keyboard-visibility.ts.
      enabled={keyboardAvoidEnabled(Platform.OS, keyboardVisible)}
      onLayout={(event) => { const { height: h, width: w } = event.nativeEvent.layout; rootHeightRef.current = h; setRootHeight(h); setPaneWidth(w); }}
      keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0}
    >
      {iosKeyboard.probe}
      <View
        {...({ dataSet: headerChrome.dataSet } as any)}
        style={[styles.header, headerChrome.style]}
        onLayout={(event) => { const h = Math.round(event.nativeEvent.layout.height); setHeaderHeight(c => (c === h ? c : h)); }}
        testID="chat-header"
      >
        {!desktop && !hideBack ? (
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('chat.back')} testID="chat-header-back">
            <Text style={styles.back}>‹</Text>
          </Pressable>
        ) : null}
        <AliasAvatar alias={alias} size={32} />
        {/* The name column is the only flexible child; the ⋯ is the header's single action. */}
        <View style={styles.headerTitleCol} testID="chat-header-title">
          <Text style={styles.title} numberOfLines={1}>
            {alias}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.subtitle,
                processing && { color: colors.accent },
                sessionStatus === 'offline' && !processing && { color: colors.textMuted },
              ]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.info')}
          accessibilityHint={t('chat.infoHint')}
          onPress={() => setInfoOpen(true)}
          hitSlop={10}
          style={({ pressed }) => [styles.headerMore, pressed && { opacity: 0.6 }]}
          testID="chat-header-more"
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} testID="chat-header-more-icon" />
        </Pressable>
      </View>

      {searchOpen ? (

        <View style={styles.searchPanel}>

          <View style={styles.searchBar}>

            <Ionicons name="search-outline" size={16} color={colors.textMuted} />

            <TextInput

              ref={searchInputRef}

              value={searchQuery}

              onChangeText={setSearchQuery}

              placeholder={t('chat.search')}

              placeholderTextColor={colors.textMuted}

              style={styles.searchInput}

              autoCapitalize="none"

              autoCorrect={false}

              returnKeyType="search"

              onSubmitEditing={() => stepSearch('older')}

              onKeyPress={(e: any) => {

                const k = e?.nativeEvent?.key;

                if (k === 'Escape') closeSearch();

                else if (k === 'Enter' && e?.nativeEvent?.shiftKey) { e.preventDefault?.(); stepSearch('newer'); }

              }}

              accessibilityLabel={t('chat.searchInput')}

            />

            <Text style={styles.searchCount}>{searchHits.length ? matchCountLabel(searchCurrent, searchHits.length) : t('chat.noMatchesCount')}</Text>

            <Pressable onPress={() => stepSearch('newer')} hitSlop={8} accessibilityLabel={t('chat.newer')} disabled={searchHits.length === 0} style={({ pressed }) => [styles.searchNav, pressed && { opacity: 0.6 }]}>

              <Ionicons name="chevron-down-outline" size={18} color={searchHits.length ? colors.text : colors.textMuted} />

            </Pressable>

            <Pressable onPress={() => stepSearch('older')} hitSlop={8} accessibilityLabel={t('chat.older')} disabled={searchHits.length === 0} style={({ pressed }) => [styles.searchNav, pressed && { opacity: 0.6 }]}>

              <Ionicons name="chevron-up-outline" size={18} color={searchHits.length ? colors.text : colors.textMuted} />

            </Pressable>

            <Pressable onPress={closeSearch} hitSlop={8} accessibilityLabel={t('chat.closeSearch')} style={({ pressed }) => [styles.searchNav, pressed && { opacity: 0.6 }]}>

              <Text style={styles.searchClose}>{t('chat.cancel')}</Text>

            </Pressable>

          </View>

          {searchState === 'idle' ? (

            <Text style={styles.searchHint}>{t('chat.searchHint', { alias })}</Text>

          ) : searchState === 'failed' ? (

            <View style={styles.searchStateRow}>

              <Text style={styles.searchHint}>{t('chat.historyFailed')}</Text>

              <Pressable onPress={retrySearchOlder} hitSlop={8}><Text style={styles.searchAction}>{t('chat.retry')}</Text></Pressable>

            </View>

          ) : searchState === 'loading' ? (

            <View style={styles.searchStateRow}>

              <ActivityIndicator color={colors.textMuted} />

              <Text style={styles.searchHint}>{t('chat.searchOlder')}</Text>

            </View>

          ) : searchState === 'empty' ? (

            <Text style={styles.searchHint}>{hasOlder && searchPagesRef.current >= SEARCH_MAX_OLDER_PAGES ? t('chat.searchLimit', { count: limitRef.current, gesture: pointer ? t('chat.scrollUp') : t('chat.swipeUp') }) : t('chat.notFound')}</Text>

          ) : (

            <FlatList

              data={searchHits}

              keyExtractor={h => h.key}

              style={styles.searchResults}

              keyboardShouldPersistTaps="handled"

              renderItem={({ item: h, index: i }) => (

                <Pressable onPress={() => locateHit(i)} style={({ pressed }) => [styles.resultRow, i === searchCurrent && styles.resultRowCurrent, pressed && { opacity: 0.7 }]}>

                  <View style={{ flex: 1 }}>

                    <ChatMetaLine name={h.sender ?? '—'} time={h.createdAt ? formatChatHeader(h.createdAt) : ''} textStyle={styles.resultMeta} style={styles.resultMetaRow} />

                    <Text style={styles.resultSnippet} numberOfLines={2}>{h.snippet}</Text>

                  </View>

                  <Pressable onPress={() => locateHit(i)} hitSlop={8} accessibilityLabel={t('chat.locateChat')}>

                    <Text style={styles.searchAction}>{t('chat.locate')}</Text>

                  </Pressable>

                </Pressable>

              )}

            />

          )}

        </View>

      ) : null}


      {!loaded ? (
        // #745:首屏还没到 —— 画几条气泡轮廓,不留一整块空白。
        <View style={styles.historySkeleton} testID="chat-history-skeleton" accessibilityLabel={t('chat.loadingHistory')}>
          {[0.62, 0.44, 0.7, 0.36, 0.55].map((w, i) => (
            <View key={i} style={[styles.skeletonBubble, { width: bubbleCap ? Math.round(w * bubbleCap.maxWidth) : `${Math.round(w * 100)}%`, alignSelf: i % 2 ? 'flex-end' : 'flex-start' }]} />
          ))}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          inverted
          data={messages}
          // 高亮(定位 / 搜索)只改 state 不改 data:不传 extraData,列表不重画格子,高亮根本画不出来(#463 量到的)。
          extraData={highlightExtra}
          keyExtractor={(m, i) => m._localId ?? m.task_id ?? String(i)}
          contentContainerStyle={{ padding: spacing.lg }}
          onEndReached={loadOlder}
          onScrollToIndexFailed={info => {
            // 目标还没量到布局:先按平均高度滚过去,再补一次精确定位。
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: locateViewPosRef.current }), 120);
          }}
          onEndReachedThreshold={0.2}
          ListFooterComponent={
            loadingOlder ? (
              <ActivityIndicator color={colors.textMuted} style={{ marginVertical: spacing.md, alignSelf: 'center' }} testID="chat-loading-older" />
            ) : !hasOlder && messages.length > 0 ? (
              <Text style={styles.beginning}>{t('chat.historyStart')}</Text>
            ) : null
          }
          renderItem={({ item, index }) => {
            // 更像微信·时间分组:仅在与上一条(更早)间隔 >5min 时显示居中时间头,
            // 不再每条气泡都盖时间。inverted 列表下,更早的邻居在 index+1。
            const showHeader = shouldShowTimeHeader(item.created_at, messages[index + 1]?.created_at);
            // 会话是按收件人拉的(to_name=alias),发件人是谁得读 from_name ——
            // 网络里任何节点都能派单给这个 alias,一律记成本人会把别人的指令
            // 显示成自己说过的话。
            const sender = resolveSender(item, currentUsername);
            // 微信式引用条:开头的「@作者: 文本」不进气泡,渲染成气泡下方的灰条
            const sentQuoted = parseQuoted(item.content);
            const sentGridNames = sentAttachmentViews(item, cfg.serverUrl).filter(gridRenderable).map(a => a.name);
            const replyQuoted = parseQuoted(item.result ?? item.reply ?? '');
            // 2026-09-17 Vincent:「Agent 节点回复人类也要这个引用啊」—— 回复没自带引用行时,
            // 挂一条指向它所回的那条请求的引用条,点击定位原文。
            const replyQuote = replyQuoted.quote ? null : replyQuoteFor(item, currentUsername, byTaskId);
            return (
              <View style={[styles.bubbleWrap, isHighlighted(msgKey(item), highlight, Date.now()) && styles.bubbleHighlight]} testID={`chat-item-${msgKey(item)}`}>
                {showHeader && item.created_at ? (
                  <ChatTimePill time={formatChatHeader(item.created_at)} boxStyle={styles.timePill} textStyle={styles.timePillText} testID="chat-time-pill" />
                ) : null}
                <View style={selectionMode ? styles.selectRow : undefined}>
                {selectionMode ? (
                  <Pressable accessibilityLabel={t('chat.select')} hitSlop={8} onPress={() => toggleSelected(msgKey(item))} style={styles.selectBoxWrap}>
                    <View style={[styles.selectBox, selectedKeys.includes(msgKey(item)) && styles.selectBoxOn]}>
                      {selectedKeys.includes(msgKey(item)) ? <Ionicons name="checkmark" size={12} color={colors.onAccent} /> : null}
                    </View>
                  </Pressable>
                ) : null}
                <View style={selectionMode ? styles.selectBody : undefined} pointerEvents={selectionMode ? 'none' : 'auto'}>
                {!item._proactive ? sender.isCurrentUser ? (
                <View style={[styles.messageRow, styles.sentRow]}>
                  <View style={[styles.messageContent, styles.sentContent, bubbleCap]}>
                    <ChatMetaLine name={sender.alias} time={item.created_at ? formatChatHeader(item.created_at) : ''} textStyle={styles.messageAuthor} style={styles.authorRow} testID="chat-author-sent" />
                    <Pressable
                      {...(pointer ? ({ dataSet: { messageKey: msgKey(item), messagePart: 'sent' }, onMouseEnter: () => setHoverKey(`${msgKey(item)}:sent`), onMouseLeave: () => setHoverKey(null) } as any) : {})}
                      onLongPress={pointer ? undefined : () => openSelect(`${msgKey(item)}:sent`, { item, text: item.content ?? '', author: sender.alias }, 'sent')}
                      delayLongPress={300}
                      style={({ pressed }) => [styles.bubblePressable, pressed && { opacity: 0.7 }]}
                    >
                      <View style={styles.bubble} ref={bubbleRef(`${msgKey(item)}:sent`)}>
                        <MineBubble value>
                        {pointer && hoverKey === `${msgKey(item)}:sent` && item.content ? (
                          <MessageHoverActions side="sent" styles={styles} onCopy={() => void copyMessage(item.content ?? '')} onMore={at => openMenuAt(at, { item, text: item.content ?? '', author: sender.alias })} />
                        ) : null}
                        <MarkdownMessage tone="mine">{hideGridImageLines(cleanAttachmentDebugText(sentQuoted.body || (sentQuoted.quote ? '' : '—')), sentGridNames) || (sentQuoted.quote ? '' : '—')}</MarkdownMessage>
                        {renderAttachments(sentAttachmentViews(item, cfg.serverUrl), item, true)}
                        </MineBubble>
                      </View>
                      {sentQuoted.quote ? (
                        <View style={[styles.quoteChip, styles.quoteChipSent]} accessibilityLabel={t('chat.quote')}>
                          <Text style={styles.quoteChipText} numberOfLines={1}>{quoteLabel(sentQuoted.quote)}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  </View>
                  <AliasAvatar alias={sender.alias} size={36} />
                </View>
                ) : (
                // 0.2.72 Vincent:别的节点派给这个 agent 的任务不是「我」说的 ——
                // 放在收到侧,头像用发送方,作者行写「发送方 → 本 agent」。
                <View style={[styles.messageRow, styles.foreignRow]}>
                  <AliasAvatar alias={sender.alias} size={36} />
                  <View style={[styles.messageContent, bubbleCap]}>
                    <ChatMetaLine name={`${sender.alias} → ${alias}`} time={item.created_at ? formatChatHeader(item.created_at) : ''} textStyle={styles.messageAuthor} style={styles.authorRow} testID="chat-author-foreign" />
                    <Pressable
                      {...(pointer ? ({ dataSet: { messageKey: msgKey(item), messagePart: 'sent' }, onMouseEnter: () => setHoverKey(`${msgKey(item)}:sent`), onMouseLeave: () => setHoverKey(null) } as any) : {})}
                      onLongPress={pointer ? undefined : () => openSelect(`${msgKey(item)}:sent`, { item, text: item.content ?? '', author: sender.alias }, 'reply')}
                      delayLongPress={300}
                      style={styles.replyPressable}
                    >
                      <View style={[styles.bubble, styles.replyBubble, desktop && styles.replyBubbleDesktop]} ref={bubbleRef(`${msgKey(item)}:sent`)}>
                        {pointer && hoverKey === `${msgKey(item)}:sent` && item.content ? (
                          <MessageHoverActions side="reply" styles={styles} onCopy={() => void copyMessage(item.content ?? '')} onMore={at => openMenuAt(at, { item, text: item.content ?? '', author: sender.alias })} />
                        ) : null}
                        <MarkdownMessage>{hideGridImageLines(cleanAttachmentDebugText(sentQuoted.body || (sentQuoted.quote ? '' : '—')), sentGridNames) || (sentQuoted.quote ? '' : '—')}</MarkdownMessage>
                        {renderAttachments(sentAttachmentViews(item, cfg.serverUrl), item)}
                      </View>
                      {sentQuoted.quote ? (
                        <View style={[styles.quoteChip, styles.quoteChipReply]} accessibilityLabel={t('chat.quote')}>
                          <Text style={styles.quoteChipText} numberOfLines={1}>{quoteLabel(sentQuoted.quote)}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  </View>
                </View>
                ) : null}
                {item.result || item.reply ? (
                  <View style={[styles.messageRow, styles.replyRow]}>
                    <AliasAvatar alias={alias} size={36} />
                    <View style={[styles.messageContent, bubbleCap]}>
                      {/* 2026-09-16 Vincent:「每条消息都展示下时间吧」—— 回复用完成时刻,没有就用创建时刻 */}
                      <ChatMetaLine name={`${alias}${item._proactive ? t('chat.proactive') : ''}`} time={(item.completed_at ?? item.created_at) ? formatChatHeader(item.completed_at ?? item.created_at) : ''} textStyle={styles.messageAuthor} style={styles.authorRow} testID="chat-author-reply" />
                      <Pressable
                        {...(pointer ? ({ dataSet: { messageKey: msgKey(item), messagePart: 'reply' }, onMouseEnter: () => setHoverKey(`${msgKey(item)}:reply`), onMouseLeave: () => setHoverKey(null) } as any) : {})}
                        onLongPress={pointer ? undefined : () => openSelect(`${msgKey(item)}:reply`, { item, text: item.result ?? item.reply ?? '', author: alias }, 'reply')}
                        delayLongPress={300}
                        style={styles.replyPressable}
                      >
                        <View style={[styles.bubble, styles.replyBubble, desktop && styles.replyBubbleDesktop]} ref={bubbleRef(`${msgKey(item)}:reply`)}>
                          {pointer && hoverKey === `${msgKey(item)}:reply` ? (
                            <MessageHoverActions side="reply" styles={styles} onCopy={() => void copyMessage(item.result ?? item.reply ?? '')} onMore={at => openMenuAt(at, { item, text: item.result ?? item.reply ?? '', author: alias })} />
                          ) : null}
                          <MarkdownMessage>{cleanAttachmentDebugText(replyQuoted.body)}</MarkdownMessage>
                          {renderAttachments(replyAttachmentViews(item, cfg.serverUrl))}
                          {item._taskNotice && onOpenTask ? (
                            <Pressable
                              accessibilityRole="link"
                              accessibilityLabel={t('tasks.noticeOpenA11y')}
                              onPress={() => onOpenTask(item._taskNotice!.requirementId, item._taskNotice!.networkId)}
                              hitSlop={6}
                              style={styles.taskLink}
                              testID="chat-open-task"
                            >
                              <Text style={styles.taskLinkText}>{t('tasks.noticeOpen')}</Text>
                            </Pressable>
                          ) : null}
                        </View>
                        {replyQuoted.quote ? (
                          <View style={[styles.quoteChip, styles.quoteChipReply]} accessibilityLabel={t('chat.quote')}>
                            <Text style={styles.quoteChipText} numberOfLines={1}>{quoteLabel(replyQuoted.quote)}</Text>
                          </View>
                        ) : replyQuote ? (
                          <Pressable accessibilityLabel={t('chat.quote')} accessibilityRole="button" hitSlop={4} onPress={() => goToMessage(replyQuote.targetKey)} style={({ pressed }) => [styles.quoteChip, styles.quoteChipReply, pressed && { opacity: 0.6 }]}>
                            <Text style={styles.quoteChipText} numberOfLines={1}>{quoteLabel(replyQuote)}</Text>
                          </Pressable>
                        ) : null}
                      </Pressable>
                    </View>
                  </View>
                ) : null}
                </View>
                </View>
                {item._restoredNoImage ? (
                  <Text style={styles.restoredNote}>{t('chat.restoredTextOnly')}</Text>
                ) : null}
                {item._pending ? (
                  <Text style={styles.pendingMark}>{t('chat.sending')}</Text>
                ) : item._failed ? (
                  <Pressable onPress={() => retry(item)} hitSlop={8}>
                    {item._uploadError ? <Text style={styles.uploadErrorText}>{item._uploadError}</Text> : null}
                    <Text style={styles.failedMark}>{t('chat.notDelivered')}</Text>
                    {item._failReason ? <Text style={styles.failReasonText} testID="chat-fail-reason">{t(`chat.failReason.${item._failReason}`)}</Text> : null}
                  </Pressable>
                ) : sender.isCurrentUser && !(item.result ?? item.reply) ? (
                  // PR3 要求2:「送达了但对方没回」≠「未送达」——前者灰勾不可点(不用重试),
                  // 后者红字带重试。服务器行(无 _localId 标志)= hub 已收 = 已送达。
                  // 只对自己发出的消息成立:别人派来的任务标「已送达」等于说这条是你发的。
                  <View>
                    <Text style={styles.deliveredMark}>{t('chat.delivered')}</Text>
                    <TaskExecutionNotice task={item} />
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {selectionMode ? (
        <View style={styles.selectionBar}>
          <Pressable accessibilityLabel={t('chat.exitSelection')} hitSlop={8} onPress={exitSelectionMode} style={({ pressed }) => [styles.selectionCancel, pressed && { opacity: 0.6 }]}>
            <Text style={styles.selectionCancelText}>{t('chat.cancel')}</Text>
          </Pressable>
          <View style={styles.selectionActions}>
            {selectionBarActions(selectedKeys.length, true).map(action => (
              <Pressable
                key={action.key}
                accessibilityLabel={t(`chat.selection.${action.key}`, { count: selectedKeys.length })}
                onPress={() => onSelectionAction(action.key)}
                style={({ pressed }) => [styles.selectionAction, pressed && styles.actionItemPressed]}
              >
                <Text style={[styles.actionText, action.danger && styles.actionDanger]}>{t(`chat.selection.${action.key}`, { count: selectedKeys.length })}</Text>
              </Pressable>
            ))}
            {selectedKeys.length === 0 ? <Text style={styles.selectionHint}>{t('chat.selectMessages')}</Text> : null}
          </View>
        </View>
      ) : null}

      {copiedToastVisible(copiedAt, Date.now()) ? (
        <View style={styles.copiedToast} pointerEvents="none" accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={14} color={colors.accent} />
          <Text style={styles.copiedToastText}>{t('chat.copied')}</Text>
        </View>
      ) : null}
      {/* 更像微信·round-3: 滚离底部时的「回到最新 / N 条新消息」pill */}
      {showJump ? (
        <Pressable style={styles.jumpPill} onPress={jumpToLatest} hitSlop={8}>
          <Text style={styles.jumpPillText}>{unread > 0 ? t('chat.newMessages', { count: unread }) : t('chat.latest')} ↓</Text>
        </Pressable>
      ) : null}

      {attached.length && composerKind === 'chat' ? (
        <View style={styles.draftStrip} testID="composer-draft-strip">
          <View style={styles.draftStripHeader}>
            <Text style={styles.draftCount} testID="composer-draft-count">{draftCountLabel(attached)}</Text>
            {draftImageCount(attached) ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sendOriginal }}
                aria-checked={sendOriginal}
                accessibilityLabel={t('chat.original')}
                hitSlop={8}
                onPress={toggleSendOriginal}
                style={styles.originalToggle}
                testID="composer-original-toggle"
              >
                <View style={[styles.originalBox, sendOriginal && styles.originalBoxOn]}>
                  {sendOriginal ? <Ionicons name="checkmark" size={11} color={colors.onAccent} /> : null}
                </View>
                <Text style={styles.originalLabel}>{t('chat.original')}</Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.draftStripRow}>
            {attached.map((item, index) => {
              const tooBig = !willCompressLater(item) && !!oversizeMessage(item);
              return isDraftImage(item) ? (
                <View key={item.uri} style={[styles.draftThumbWrap, tooBig && styles.draftThumbTooBig]} testID="composer-draft-thumb">
                  <Pressable onPress={() => openViewer(attached.filter(isDraftImage).map(d => ({ key: d.uri, name: d.fileName, uri: d.uri })), item.uri)} accessibilityLabel={t('chat.previewName', { name: item.fileName })}>
                    <Image source={{ uri: item.uri }} style={styles.draftThumb} resizeMode="cover" resizeMethod="resize" />
                  </Pressable>
                  <View style={styles.draftIndex} pointerEvents="none"><Text style={styles.draftIndexText}>{index + 1}</Text></View>
                  {tooBig ? <View style={styles.draftTooBigTag} pointerEvents="none"><Text style={styles.draftTooBigText}>{t('chat.tooLarge')}</Text></View> : null}
                  <Pressable onPress={() => removeAttachment(item.uri)} hitSlop={8} style={styles.draftRemove} accessibilityLabel={t('chat.removeName', { name: item.fileName })}>
                    <Text style={styles.draftRemoveText}>✕</Text>
                  </Pressable>
                </View>
              ) : (
                <View key={item.uri} style={[styles.draftFileChip, tooBig && styles.draftThumbTooBig]} testID="composer-draft-file">
                  <Text style={styles.attachName} numberOfLines={2}>📎 {item.fileName}</Text>
                  <Pressable onPress={() => removeAttachment(item.uri)} hitSlop={8} style={styles.draftRemove} accessibilityLabel={t('chat.removeName', { name: item.fileName })}>
                    <Text style={styles.draftRemoveText}>✕</Text>
                  </Pressable>
                </View>
              );
            })}
            {/* 有附件时右下角是「发送」,不是 ＋:继续加图/文件从草稿条末尾这一格进同一个 ＋ 面板。 */}
            {!desktop && ATTACH_ENABLED && remainingImageSlots(attached) > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chat.addMore')}
                testID="composer-draft-add"
                onPress={() => plusEvent('toggle')}
                style={({ pressed }) => [styles.draftAddTile, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="add" size={26} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
      {composerNotice ? (
        <View style={styles.composerNotice} pointerEvents="none" accessibilityLiveRegion="polite" testID="composer-notice">
          <Text style={styles.composerNoticeText}>{desktop ? desktopVoiceNotice(composerNotice) : composerNotice}</Text>
        </View>
      ) : null}
      <VoiceSettingsPrompt voice={voice} onOpenSettings={onOpenVoiceSettings} />
      {sendNotice ? (
        <ActualRecipientNotice notice={sendNotice} onDismiss={() => setSendConfirmation(null)} />
      ) : null}
      {/* Android 返回手势 / 桌面 Esc 都走 Modal 的 onRequestClose(见 ImageViewer.tsx)。 */}
      <ImageViewer state={viewer} onClose={() => setViewer(null)} serverUrl={cfg.serverUrl} token={cfg.token} />

      {/* 0.2.78 Vincent:和微信对齐 —— 分组 + 分隔线,删除单独一组,没有「取消」行(Esc/点空白关)。
          桌面端落在光标处;触摸端仍是底部 action sheet。 */}
      <Modal visible={!!menuFor} transparent animationType="fade" onRequestClose={() => setMenuFor(null)}>
        <Pressable style={pointer && menuAt ? styles.menuBackdropAnchored : styles.menuBackdrop} onPress={() => setMenuFor(null)}>
          <View
            style={pointer && menuAt
              ? [styles.actionMenuDesktop, { left: Math.max(8, Math.min(menuAt.x, menuWindowWidth - 188)), top: Math.max(8, Math.min(menuAt.y, menuWindowHeight - 300)), maxHeight: menuWindowHeight - 16 }]
              : [styles.actionSheet, sheetPad]}
          >
            {/* 弹窗规则(DialogFrame.tsx):面板有界、会长的内容可收缩地滚。横屏手机 8 行会超出屏幕。 */}
            <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} bounces={false}>
            {menuGroups.map((group, groupIndex) => (
              <View key={`menu-group-${groupIndex}`}>
                {groupIndex > 0 ? <View style={styles.actionGroupGap} /> : null}
                {group.map((item, itemIndex) => (
                  <View key={item.key}>
                    {itemIndex > 0 ? <View style={styles.actionSep} /> : null}
                    <Pressable
                      accessibilityLabel={t(`chat.menu.${item.key}`)}
                      style={({ pressed }) => [
                        pointer && menuAt ? styles.actionItemDesktop : styles.actionItem,
                        pressed && styles.actionItemPressed,
                      ]}
                      onPress={() => onMenuAction(item.key)}
                    >
                      <Text style={[styles.actionText, item.danger && styles.actionDanger]}>{t(`chat.menu.${item.key}`)}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* 放大阅读:单条消息的全屏视图。气泡里读不完的长代码块用这个。 */}
      <Modal visible={!!expandFor} transparent animationType="fade" onRequestClose={() => setExpandFor(null)}>
        <Pressable style={[styles.expandBackdrop, withBasePadding(dialogSafe, spacing.lg)]} onPress={() => setExpandFor(null)}>
          <Pressable style={styles.expandPanel} onPress={() => {}} accessibilityLabel={t('chat.expand')}>
            <View style={styles.expandHeader}>
              <Text style={styles.expandTitle} numberOfLines={1}>{expandFor?.author ?? ''}</Text>
              <Pressable accessibilityLabel={t('chat.closeExpand')} hitSlop={8} onPress={() => setExpandFor(null)}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={styles.expandScroll} contentContainerStyle={styles.expandContent}>
              <MarkdownMessage>{cleanAttachmentDebugText(parseQuoted(expandFor?.text ?? '').body || (expandFor?.text ?? ''))}</MarkdownMessage>
            </ScrollView>
            <Pressable
              accessibilityLabel={t('chat.copy')}
              style={({ pressed }) => [styles.expandCopy, pressed && styles.actionItemPressed]}
              onPress={() => void copyMessage(expandFor?.text ?? '')}
            >
              <Ionicons name="copy-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.expandCopyText}>{t('chat.copyAll')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* #537 触摸端长按:就地选区 + 微信式浮动菜单。桌面是鼠标拖选 + 右键菜单(上面的锚定菜单),不挂这一层。 */}
      {pointer ? null : <MessageSelectOverlay
        target={selectFor}
        selectionMode={selectionMode}
        onAction={onSelectAction}
        onClose={() => setSelectFor(null)}
      />}

      <Modal visible={!!forwardFor && forwardUiOwner === conversationKeyFor} transparent animationType="fade" onRequestClose={() => setForwardFor(null)}>
        <ModalKeyboardAvoider scrim="rgba(0,0,0,0.38)">
        <Pressable style={[styles.forwardBackdrop, withBasePadding(dialogSafe, spacing.xl)]} onPress={() => setForwardFor(null)}>
          <Pressable style={styles.forwardPanel} onPress={() => {}}>
            <Text style={styles.forwardTitle}>{forwardBatch ? t('chat.forwardCount', { count: forwardBatch.length }) : t('chat.forwardTo')}</Text>
            {forwardProgress ? <Text style={styles.forwardEmpty}>{forwardProgress}</Text> : null}
            {forwardAmbiguous ? <Text style={styles.forwardEmpty}>{t('chat.noRepeat')}</Text> : null}
            {forwardAmbiguous && forwardOperationKeyRef.current ? (
              <Pressable onPress={() => Alert.alert(t('chat.clearUncertain'), t('chat.clearHint'), [
                { text: t('chat.cancel'), style: 'cancel' },
                { text: t('chat.clearOnly'), onPress: () => { resetForwardWithoutResend(forwardOperationKeyRef.current!); setForwardAmbiguous(false); } },
              ])}><Text style={styles.forwardEmpty}>{t('chat.clearNoResend')}</Text></Pressable>
            ) : null}
            <TextInput value={forwardQuery} onChangeText={setForwardQuery} placeholder={t('chat.searchAgent')} placeholderTextColor={colors.textMuted} style={styles.forwardSearch} />
            <FlatList
              style={styles.forwardList}
              data={forwardTargets.filter(target => target.alias.toLowerCase().includes(forwardQuery.trim().toLowerCase()))}
              keyExtractor={target => target.alias}
              renderItem={({ item: target }) => (
                <Pressable style={({ pressed }) => [styles.forwardTarget, pressed && styles.actionItemPressed]} onPress={() => forwardMessage(target.alias)} disabled={!!forwardingTo || forwardAmbiguous}>
                  <AliasAvatar alias={target.alias} size={32} />
                  <Text style={styles.forwardAlias} numberOfLines={1}>{target.alias}</Text>
                  {forwardingTo === target.alias ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                </Pressable>
              )}
              ListEmptyComponent={<Text style={styles.forwardEmpty}>{t('chat.noAgent')}</Text>}
            />
          </Pressable>
        </Pressable>
        </ModalKeyboardAvoider>
      </Modal>

      {/* ⤢ 全屏编辑(手机/双栏):同一份草稿;Android 返回 / Esc 走 onRequestClose 收起,草稿保留。 */}
      <ComposerFullscreenEditor
        visible={!desktop && fullEditorOpen}
        alias={alias}
        draft={draft}
        onChangeDraft={setDraft}
        sendDisabled={!canSend(draft, attached.length > 0, sending)}
        onSend={() => { fullEditorEvent('sent'); void submit(); }}
        onClose={() => fullEditorEvent('back')}
      />


      {desktop ? (
        <>
        <View
          {...composerPan.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel={t('chat.resize')}
          style={styles.composerDivider}
        >
          <View style={styles.composerDividerGrip} />
        </View>
{quote ? (
          <View style={styles.quoteStrip} accessibilityLabel={t('chat.quoting')}>
            <View style={styles.quoteStripBar} />
            <Text style={styles.quoteStripText} numberOfLines={1}>{quoteLabel(quote)}</Text>
            <Pressable accessibilityLabel={t('chat.cancelQuote')} onPress={() => setQuote(null)} hitSlop={8} style={styles.quoteStripClose}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.desktopComposerWrap}>
        <View style={[styles.desktopComposer, { height: composerHeight, minHeight: undefined, maxHeight: undefined }]} testID="desktop-composer-card">
          {/* 内容高度量尺:同宽、同字号行高的隐形文字。不用 TextInput 的 onContentSizeChange —— web 上那是
              textarea.scrollHeight,永远 ≥ 自身高度,卡片只会长不会缩(删掉文字后回不去)。 */}
          <Text
            style={styles.desktopInputMeasure}
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onLayout={event => setComposerContentHeight(event.nativeEvent.layout.height)}
          >
            {`${draft}${draft.endsWith('\n') || !draft ? '\u200b' : ''}`}
          </Text>
          <TextInput
            ref={mainComposerRef}
            style={[styles.desktopInput, { maxHeight: inputMaxHeight(composerHeight) }]}
            placeholder={t('chat.messagePlaceholder', { alias })}
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            onSelectionChange={onComposerSelectionChange}
            selection={forcedSelection}
            onKeyPress={(event) => {
              const key = event.nativeEvent as typeof event.nativeEvent & { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; isComposing?: boolean; keyCode?: number; which?: number };
              if (!shouldSendOnEnter(key, sendKey)) return;
              event.preventDefault?.();
              void submit();
            }}
            multiline
          />
          {/* 桌面语音(desktop-voice-bar-model.ts):录音中这一行整行换成录音条,不用手机的按住说话浮层。 */}
          {voiceSurface(desktop) === 'inlineBar' && showVoiceBar(voice.state.phase) ? (
            <DesktopVoiceBar voice={voice} onDone={desktopVoiceDone} onCancel={desktopVoiceCancel} hint={kbdVoice ? t(voice.state.phase === 'transcribing' ? 'voice.transcribing' : voice.state.phase === 'starting' ? 'voice.preparing' : kbdVoice.mode === 'hold' ? 'voice.releaseKeys' : 'voice.pressKeys', { keys: comboChips(kbdVoice.combo, isMacKeyboard()).join(isMacKeyboard() ? '' : '+') }) : undefined} />
          ) : (
          <View style={styles.desktopToolbar}>
            <Pressable accessibilityLabel={t('chat.addFile')} testID="composer-desktop-plus" style={({ pressed }) => [styles.desktopToolButton, pressed && { opacity: 0.6 }]} onPress={onPlusPress} hitSlop={6}>
                <Ionicons name="add-circle-outline" size={24} color={colors.textSecondary} />
            </Pressable>
            <View style={styles.desktopToolbarRight}>
              {/* ⚡ 优先 toggle hidden since 0.2.105 (chat-entry-flags.ts). */}
              {SHOW_BOLT_ENTRY ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={sendPriority === 'high' ? t('chat.cancelPriority') : t('chat.setPriority')}
                  accessibilityState={{ selected: sendPriority === 'high' }}
                  onPress={() => setSendPriority(value => value === 'high' ? 'normal' : 'high')}
                  style={({ pressed }) => [styles.priorityButton, sendPriority === 'high' && styles.priorityButtonActive, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[styles.priorityButtonText, sendPriority === 'high' && styles.priorityButtonTextActive]}>{t('chat.priority')}</Text>
                </Pressable>
              ) : null}
              <Text style={styles.shortcutHint} testID="composer-shortcut-hint">{t(sendKey === 'modEnter' ? 'chat.shortcutMod' : 'chat.shortcutEnter', { modifier: isMacKeyboard() ? '⌘' : 'Ctrl' })}</Text>
              {voice.available ? <DesktopMicButton voice={voice} onPress={desktopMicClick} /> : null}
              <Pressable
                style={({ pressed }) => [styles.desktopSend, !canSend(draft, attached.length > 0, sending) && styles.desktopSendDisabled, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={t('chat.send')}
                onPress={() => void submit()}
                disabled={!canSend(draft, attached.length > 0, sending)}
              >
                <Text style={[styles.desktopSendText, !canSend(draft, attached.length > 0, sending) && styles.sendTextDisabled]}>{t('chat.send')}</Text>
              </Pressable>
            </View>
          </View>
          )}
        </View>
        </View>
        </>
      ) : (
      <>
      {quote ? (
        <View style={styles.quoteStrip} accessibilityLabel={t('chat.quoting')}>
          <View style={styles.quoteStripBar} />
          <Text style={styles.quoteStripText} numberOfLines={1}>{quoteLabel(quote)}</Text>
          <Pressable accessibilityLabel={t('chat.cancelQuote')} onPress={() => setQuote(null)} hitSlop={8} style={styles.quoteStripClose}>
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      {/* 语音模式的草稿卡片:不弹软键盘的输入框 —— 点着放光标、长按 / 拖动选中,「按住 说话」插到这里的选区;
          ✕ 清空草稿;要打字点左边 ⌨(选区带过去)。叠放顺序:图片草稿条(#402)→ 引用条 → 这张卡片 →「按住 说话」行。 */}
      {showVoiceDraftCard(voiceMode, draft) ? (
        <VoiceDraftCard
          inputRef={draftCardRef}
          value={draftCardPreview ? draftCardPreview.value : draft}
          selection={draftCardPreview ? draftCardPreview.selection : forcedSelection}
          onChangeText={text => { if (!voiceBusy) setDraft(text); }}
          onSelectionChange={voiceBusy ? undefined : onComposerSelectionChange}
          busy={voiceBusy}
          onClear={() => { setDraft(''); selectionCaptureRef.current.reset(); }}
        />
      ) : null}
      <View style={[styles.inputRow, { alignItems: composerRowAlign(inputLines, voiceMode), paddingBottom: spacing.md + (plusMenuOpen ? 0 : composerInset) }]} onLayout={event => setInputRowTop(event.nativeEvent.layout.y)}>
        {/* 微信式(composer-row-layout.ts):左 🎤/⌨ 切换 | 中 输入框或「按住 说话」 | 右 ＋ ⇄「发送」。
            ⤢ 在左列顶上,只在输入超过 3 行时出现(左列靠 stretch 撑满整行高度,不压输入框)。 */}
        {voice.available || showExpand ? (
          <View style={styles.inputLeftCol}>
            {showExpand ? <ComposerExpandButton onPress={() => fullEditorEvent('expand')} /> : <View />}
            {voice.available ? <ComposerModeToggle mode={inputMode} onToggle={toggleInputMode} disabled={voiceBusy} /> : null}
          </View>
        ) : null}
        {/* ⚡ toggle hidden since 0.2.105 (chat-entry-flags.ts). */}
        {SHOW_BOLT_ENTRY ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sendPriority === 'high' ? t('chat.cancelPriority') : t('chat.setPriority')}
            accessibilityState={{ selected: sendPriority === 'high' }}
            onPress={() => setSendPriority(value => value === 'high' ? 'normal' : 'high')}
            style={({ pressed }) => [styles.mobilePriorityButton, sendPriority === 'high' && styles.priorityButtonActive, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.mobilePriorityText, sendPriority === 'high' && styles.priorityButtonTextActive]}>⚡</Text>
          </Pressable>
        ) : null}
        {/* 语音模式:整条输入框换成「按住 说话」(插到草稿卡片的光标处);键盘模式:只有输入框 —— 语音的入口
            只有左边的 🔊/⌨ 切换(微信同款;框内小麦克风已去掉,owner:和左边的切换重复)。 */}
        <View style={styles.inputWrap}>
        {voiceMode ? <VoiceHoldBar voice={voice} handlers={voiceHandlersFor('holdBar')} /> : (
        <TextInput
          ref={mainComposerRef}
          style={[styles.input, styles.inputInWrap, Platform.OS === 'web' && { height: webComposerInputHeight(inputLines), flexBasis: 'auto' }]}
          // Web only: a textarea without rows is 2 lines tall, not 1 (native TextInput starts at
          // one line). rows=1 + the explicit height above make the web export lay out like the
          // phone, so the Playwright alignment check measures the real geometry.
          {...(Platform.OS === 'web' ? { rows: 1 } : null)}
          placeholder={t('chat.messagePlaceholder', { alias })}
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          onSelectionChange={onComposerSelectionChange}
          selection={forcedSelection}
          onContentSizeChange={event => onInputContentSize(event.nativeEvent.contentSize.height)}
          onFocus={() => plusEvent('inputFocus')}
          onKeyPress={(event) => {
            if (!desktop) return;
            const key = event.nativeEvent as typeof event.nativeEvent & {
              ctrlKey?: boolean;
              metaKey?: boolean;
              shiftKey?: boolean;
              isComposing?: boolean;
              keyCode?: number;
              which?: number;
            };
            if (!shouldSendOnEnter(key, sendKey)) return;
            event.preventDefault?.();
            void submit();
          }}
          multiline
        />
        )}
        </View>
        <ComposerRightSlot
          slot={rightSlot}
          sendDisabled={!canSend(draft, attached.length > 0, sending)}
          plusOpen={plusMenuOpen}
          onSend={() => void submit()}
          onPlus={() => plusEvent('toggle')}
        />
      </View>
      {plusMenuOpen ? (
        // Inline, in the chat pane only (two-pane: never over the agent list). It is a
        // sibling after the input row inside the root column, so the inverted message
        // list (flex:1) shrinks by the panel height and the newest message stays visible.
        <View
          accessibilityLabel={t('chat.moreSend')}
          style={[styles.plusPanel, { height: plusPanelHeight(plusWindowHeight, lastKeyboardHeightRef.current) + composerInset, paddingBottom: composerInset }]}
        >
          <View style={styles.plusGrid}>
            {plusItems.map(item => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={t(`chat.plusHint.${item.key}`)}
                style={({ pressed }) => [styles.plusCell, pressed && { opacity: 0.6 }]}
                onPress={() => runPlusItem(item.key)}
              >
                <View style={styles.plusCellIcon}>
                  {item.icon ? <Ionicons name={item.icon as any} size={28} color={colors.text} /> : <Text style={styles.plusCellBtw}>BTW</Text>}
                </View>
                <Text style={styles.plusCellLabel} numberOfLines={1}>{t(`chat.plus.${item.key}`)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      </>
      )}
      {voiceSurface(desktop) === 'phoneOverlay' ? <VoiceRecordingOverlay voice={voice} bottom={88 + composerInset} hidden={holdOverlayOn} /> : null}
      {holdOverlayOn ? <VoiceHoldOverlay voice={voice} layout={holdLayout} /> : null}
      <View ref={originProbeRef} collapsable={false} pointerEvents="none" style={styles.originProbe} />
      <SideThreadDrawer
        cfg={cfg}
        alias={alias}
        desktop={desktop}
        launch={btwLaunch}
        scope={sideThreadScope}
        restoreFocusRef={mainComposerRef}
      />
      {desktop && dropActive ? (
        <View pointerEvents="none" style={styles.dropOverlay} testID="chat-drop-overlay">
          <Ionicons name="cloud-upload-outline" size={28} color={colors.accent} />
          <Text style={styles.dropOverlayText}>{t('chat.drop')}</Text>
        </View>
      ) : null}
      <ChatInfoPanel
        visible={infoOpen}
        presentation={chatInfoPresentation({ desktop, hideBack })}
        groups={infoGroups}
        alias={alias}
        subtitle={subtitle}
        paneWidth={paneWidth}
        headerHeight={headerHeight}
        onClose={() => setInfoOpen(false)}
        onRow={onInfoRow}
      />
    </KeyboardAvoidingView>
  );
}

/**
 * 桌面端悬停气泡时的一对小按钮:复制 +「⋯ 更多操作」。「⋯」打开的就是右键那份锚定菜单,落在按钮正下方 ——
 * 右键不是唯一入口(触控板用户、不知道能右键的人都找得到)。`side` 决定贴气泡哪一边(与头像相反的那边)。
 */
function MessageHoverActions({ side, styles, onCopy, onMore }: {
  side: 'sent' | 'reply';
  styles: ReturnType<typeof makeStyles>;
  onCopy: () => void;
  onMore: (at: { x: number; y: number }) => void;
}) {
  const moreRef = useRef<any>(null);
  const more = () => {
    const r = moreRef.current?.getBoundingClientRect?.();
    onMore(r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 });
  };
  return (
    <View style={[styles.hoverActions, side === 'sent' ? styles.copyHoverSent : styles.copyHoverReply]} testID="message-hover-actions">
      <Pressable accessibilityLabel={t('chat.copy')} hitSlop={6} onPress={onCopy} style={({ pressed }) => [styles.copyHover, pressed && { opacity: 0.6 }]}>
        <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
      </Pressable>
      <Pressable ref={moreRef} accessibilityLabel={t('chat.more')} testID="message-hover-more" hitSlop={6} onPress={more} style={({ pressed }) => [styles.copyHover, pressed && { opacity: 0.6 }]}>
        <Ionicons name="ellipsis-horizontal" size={14} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

// Bubble-chain layout comes from bubble-layout.ts (shared with DmChatScreen, run through Yoga by
// bubble-layout.test.ts); this file adds the paint.
const makeStyles = (B = bubbleLayout()) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  historySkeleton: { flex: 1, justifyContent: 'flex-end', padding: spacing.lg, gap: spacing.md },
  skeletonBubble: { height: 36, borderRadius: radius.surface, backgroundColor: colors.subtleFill },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  back: { color: colors.accent, fontSize: 28, lineHeight: 30, paddingRight: spacing.sm },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  subtitle: { color: colors.running, fontSize: 11, marginTop: 1 },
  // The single ⋯: a 36 dp target flush with the right padding. Icon buttons are measured by their box
  // (tests/test-layout-sweep: the box is the symmetric thing), so left and right padding match.
  headerMore: { width: 36, height: ds(34), borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' },
  headerTitleCol: { flex: 1, minWidth: 0 },
  beginning: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  bubbleWrap: { marginBottom: spacing.md, gap: spacing.xs },
  // app#166 —— 搜索定位后的临时高亮(2 s)
  bubbleHighlight: { backgroundColor: colors.accent + '22', borderRadius: radius.bubble, marginHorizontal: -spacing.xs, paddingHorizontal: spacing.xs },
  searchPanel: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.card, maxHeight: 320 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 6, paddingHorizontal: spacing.sm, backgroundColor: colors.bg, borderRadius: radius.control },
  searchCount: { color: colors.textMuted, fontSize: 12, minWidth: 36, textAlign: 'center' },
  searchNav: { paddingHorizontal: 4, paddingVertical: 4 },
  searchClose: { color: colors.accent, fontSize: 14 },
  searchHint: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, flexShrink: 1 },
  searchStateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  searchAction: { color: colors.accent, fontSize: 13, paddingHorizontal: spacing.sm },
  searchResults: { maxHeight: 240 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  resultRowCurrent: { backgroundColor: colors.accent + '14' },
  resultMeta: { color: colors.textMuted, fontSize: 11 },
  resultMetaRow: { marginBottom: 2 },
  resultSnippet: { color: colors.text, fontSize: 13 },
  messageRow: B.messageRow,
  sentRow: B.sentRow,
  foreignRow: B.replyRow,
  replyRow: B.replyRow,
  messageContent: B.messageContent,
  sentContent: B.sentContent,
  // #683: the author line is a row (ChatMetaLine) — name shrinks, time never does; the row carries the margin.
  messageAuthor: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  authorRow: { marginBottom: 3 },
  bubblePressable: B.bubblePressable,
  // 2026-09-29:日期 / 时间分隔做成一枚小胶囊,不再是一行裸字。
  // #683(iOS「09:0」):胶囊是 View,时间 Text 在里面带按自身字符串算出的宽度下限(ChatTimePill)——
  // 不再是「Text 自己的测量宽度 = 盒子宽度」,测量短几个点也裁不掉最后一位。
  timePill: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.subtleFill,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  timePillText: { color: colors.textMuted, fontSize: 11 },
  // 极简:气泡不描边。我发出的用 bubbleMine(#545 晴蓝实底),回复用卡片色——靠底色区分,不靠边框。
  bubble: { ...B.bubble, backgroundColor: colors.bubbleMine, borderRadius: radius.bubble },
  replyBubble: { ...B.replyBubble, backgroundColor: colors.card },
  replyBubbleDesktop: B.replyBubbleDesktop,
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  // 微信式引用:气泡下方一条灰底小字「作者: 内容」(单行省略)
  quoteChip: { ...B.quoteChip, borderLeftColor: colors.border },
  quoteChipSent: B.quoteChipSent,
  quoteChipReply: B.quoteChipReply,
  quoteChipText: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  // 输入框上方的「正在引用」条
  quoteStrip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: colors.border + '55', borderRadius: radius.item },
  quoteStripBar: { width: 3, alignSelf: 'stretch', borderRadius: radius.pill, backgroundColor: colors.accent },
  quoteStripText: { flex: 1, color: colors.textMuted, fontSize: 12 },
  quoteStripClose: { padding: 2 },
  restoredNote: { color: colors.textMuted, fontSize: 10, marginTop: 2, alignSelf: 'flex-end' },
  deliveredMark: { color: colors.textMuted, fontSize: 10, marginTop: 2, alignSelf: 'flex-end' },
  pendingMark: { color: colors.textMuted, fontSize: 10, alignSelf: 'flex-end' },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  typingText: { color: colors.textMuted, fontSize: 12 },
  attachmentLine: { color: colors.accent, fontSize: 12, marginTop: spacing.xs },
  attachmentImage: { alignItems: 'flex-start' },
  thumb: {
    width: 180,
    height: 180,
    borderRadius: radius.thumb, overflow: 'hidden',
    marginTop: spacing.sm,
    backgroundColor: colors.inputBg,
  },
  // round-2 长按动作菜单(底部 action sheet)
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  actionSheet: {
    maxHeight: '85%',
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.surface,
    borderTopRightRadius: radius.surface,
    paddingBottom: spacing.xl,
    overflow: 'hidden',
    ...elevated('floating', 'top'),
  },
  actionItem: { paddingVertical: spacing.lg, alignItems: 'center' },
  actionItemPressed: { backgroundColor: colors.inputBg },
  actionText: { color: colors.text, fontSize: 16 },
  actionDanger: { color: colors.failed },
  // 0.2.78 桌面端:菜单落在光标处(微信桌面端形状),左对齐、行更紧。
  menuBackdropAnchored: { flex: 1, backgroundColor: 'transparent' },
  actionMenuDesktop: {
    position: 'absolute',
    width: 180,
    backgroundColor: colors.card,
    borderRadius: radius.control,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
    ...elevated('floating'),
  },
  actionItemDesktop: { paddingVertical: 9, paddingHorizontal: spacing.md, alignItems: 'flex-start' },
  // 组与组之间是一段留白(不是发丝线),危险动作因此够不着常用动作。
  actionGroupGap: { height: spacing.sm, backgroundColor: colors.bg },
  // 放大阅读
  expandBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  expandPanel: { width: 760, maxWidth: '96%', height: '86%', borderRadius: radius.surface, backgroundColor: colors.card, overflow: 'hidden', ...elevated('floating') },
  expandHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  expandTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, fontWeight: '600' },
  expandScroll: { flex: 1 },
  expandContent: { padding: spacing.lg },
  expandCopy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  expandCopyText: { color: colors.textSecondary, fontSize: 13 },
  // 多选
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectBoxWrap: { paddingLeft: spacing.xs },
  selectBox: { width: 20, height: 20, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  selectBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  selectBody: { flex: 1, minWidth: 0 },
  selectionBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
  selectionCancel: { paddingVertical: spacing.xs, paddingRight: spacing.sm },
  selectionCancelText: { color: colors.textSecondary, fontSize: 14 },
  selectionActions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md },
  selectionAction: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.item },
  selectionHint: { color: colors.textMuted, fontSize: 12 },
  plusPanel: { backgroundColor: colors.inputBg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  plusGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  plusCell: { width: '25%', maxWidth: 104, alignItems: 'center', marginBottom: spacing.lg },
  plusCellIcon: { width: 60, height: 60, borderRadius: radius.surface, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  plusCellBtw: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  plusCellLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  forwardBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  forwardPanel: { width: 360, maxWidth: '92%', maxHeight: '100%', borderRadius: radius.surface, backgroundColor: colors.card, padding: spacing.lg, ...elevated('floating') },
  forwardTitle: { color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: spacing.md },
  forwardSearch: { color: colors.text, backgroundColor: colors.inputBg, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: spacing.sm },
  forwardList: { maxHeight: 400, flexShrink: 1 },
  forwardTarget: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.item },
  forwardAlias: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, fontWeight: '600' },
  forwardEmpty: { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl },
  actionSep: { height: 1, backgroundColor: colors.border },
  // round-3 回到最新 pill
  // 拖文件进聊天区时整格一层虚线框 + 提示(不拦事件,drop 由 document 上的监听处理)。
  dropOverlay: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, bottom: spacing.sm, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: radius.control, backgroundColor: colors.bg + 'E6', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  dropOverlayText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  jumpPill: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 84,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...elevated('floating'),
  },
  jumpPillText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  // 复制消息:桌面端悬停气泡时的右上角小按钮 + 底部「已复制」提示
  replyPressable: B.replyPressable,
  // #499 到期提醒气泡下的「查看任务 ›」,与私信气泡(DmChatScreen.taskLink)同一个样子。
  taskLink: { alignSelf: 'flex-start', marginTop: spacing.xs, minHeight: 24, justifyContent: 'center' },
  taskLinkText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  // 复制 + ⋯ 两个 24px 圆钮排成一行,整行挂在气泡上沿外侧(MessageHoverActions)。
  hoverActions: { position: 'absolute', top: -10, zIndex: 2, flexDirection: 'row', gap: 4 },
  copyHover: { width: 24, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  copyHoverSent: { left: -12 },
  copyHoverReply: { right: -12 },
  copiedToast: { position: 'absolute', alignSelf: 'center', bottom: 96, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.card, ...elevated('floating') },
  copiedToastText: { color: colors.text, fontSize: 12 },
  attachPreviewList: { maxHeight: 112, paddingVertical: spacing.xs },
  // 多图草稿条(微信式):计数 + 原图开关一行,下面横向缩略图,每张右上 ✕、左下序号。
  draftStrip: { paddingTop: spacing.xs, paddingHorizontal: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  draftStripHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  draftCount: { color: colors.textSecondary, fontSize: 12 },
  originalToggle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  originalBox: { width: 15, height: 15, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  originalBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  originalLabel: { color: colors.text, fontSize: 12 },
  draftStripRow: { gap: 8, paddingTop: 6, paddingBottom: spacing.xs, paddingRight: 6 },
  draftThumbWrap: { width: 64, height: 64, borderRadius: radius.thumb, overflow: 'visible' },
  draftThumbTooBig: { borderWidth: 2, borderColor: colors.failed, borderRadius: radius.thumb },
  draftThumb: { width: 64, height: 64, borderRadius: radius.thumb, backgroundColor: colors.inputBg },
  draftIndex: { position: 'absolute', left: 3, bottom: 3, minWidth: 16, height: 16, borderRadius: radius.pill, paddingHorizontal: 3, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  draftIndexText: { color: colors.onAccent, fontSize: 10, fontWeight: '600' },
  draftTooBigTag: { position: 'absolute', left: 0, right: 0, top: 22, alignItems: 'center' },
  draftTooBigText: { color: '#fff', backgroundColor: colors.failed, fontSize: 10, paddingHorizontal: 3, borderRadius: radius.mark, overflow: 'hidden' },
  draftRemove: { position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  draftRemoveText: { color: '#fff', fontSize: 10, lineHeight: 12 },
  draftFileChip: { width: 120, height: 64, borderRadius: radius.thumb, padding: 6, justifyContent: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  originProbe: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
  composerNotice: { alignSelf: 'center', marginVertical: 4, paddingVertical: 5, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.card, maxWidth: '92%', ...elevated('floating') },
  composerNoticeText: { color: colors.text, fontSize: 12 },
  // 多图气泡:3 列方格(微信式),每格 84,间距 4
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: spacing.sm, maxWidth: 3 * 84 + 2 * 4 },
  gridCell: { width: 84, height: 84, borderRadius: radius.thumb, overflow: 'hidden', backgroundColor: colors.inputBg },
  gridCellFailed: { borderWidth: 2, borderColor: colors.failed },
  gridImage: { width: 84, height: 84 },
  gridOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', gap: 2 },
  gridOverlayFailed: { backgroundColor: 'rgba(160,20,20,0.55)' },
  gridOverlayText: { color: '#fff', fontSize: 10, textAlign: 'center' },
  gridRemove: { position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  gridRemoveText: { color: '#fff', fontSize: 10, lineHeight: 12 },
  uploadErrorText: { color: colors.failed, fontSize: 11, textAlign: 'right', marginBottom: 2 },
  attachPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 3,
  },
  attachName: { color: colors.textSecondary, fontSize: 12, flexShrink: 1 },
  attachIndex: { color: colors.textMuted, fontSize: 10, marginLeft: 'auto' },
  attachRemove: { color: colors.textMuted, fontSize: 14 },
  failedMark: { color: colors.failed, fontSize: 11, alignSelf: 'flex-end', fontWeight: '600' },
  failReasonText: { color: colors.failed, fontSize: 11, textAlign: 'right', marginTop: 2 },
  // 左列:⤢(顶)+ 🎤/⌨(底);stretch 到整行高度,⤢ 才能落在左上角。
  inputLeftCol: { alignSelf: 'stretch', justifyContent: 'space-between', alignItems: 'center' },
  draftAddTile: { width: 64, height: 64, borderRadius: radius.thumb, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  // alignItems is set inline from composerRowAlign(): 'center' for one line / voice mode,
  // 'flex-end' (WeChat: buttons stay by the last line) once the input is multi-line.
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composerDivider: {
    height: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    cursor: 'ns-resize',
    // 分隔条本身不可选(拖拽期间整页禁选由 lockDocumentSelection 负责)。
    userSelect: 'none',
  } as any,
  composerDividerGrip: { width: 36, height: 3, borderRadius: radius.pill, backgroundColor: colors.border },
  // 2026-09-29 Vincent 截图(0.2.137 Windows):输入区原是一整块贴边白板。现在是悬浮圆角卡片 ——
  // 左右下三边等距 COMPOSER_CARD_INSET,工具栏在卡片里;高度随内容长(composer-resize.ts)。
  desktopComposerWrap: { paddingHorizontal: COMPOSER_CARD_INSET, paddingBottom: COMPOSER_CARD_INSET, backgroundColor: colors.bg },
  desktopComposer: {
    backgroundColor: colors.card,
    borderRadius: radius.surface,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    overflow: 'hidden',
    ...elevated('raised'),
  },
  desktopInputMeasure: {
    position: 'absolute', left: 14, right: 14, top: 0, opacity: 0, pointerEvents: 'none',
    fontSize: 14, lineHeight: 21,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  } as any,
  desktopInput: {
    flex: 1,
    minHeight: 21,
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    padding: 0,
    textAlignVertical: 'top',
    outlineStyle: 'none',
  } as any,
  desktopToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, height: 38 },
  desktopToolButton: { width: 34, height: 34, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  desktopToolbarRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  priorityButton: { height: 28, borderRadius: radius.item, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  priorityButtonActive: { borderColor: colors.failed, backgroundColor: colors.inputBg },
  priorityButtonText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  priorityButtonTextActive: { color: colors.failed },
  mobilePriorityButton: { width: composerControlSize(uiScale().densityFactor), height: composerControlSize(uiScale().densityFactor), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  mobilePriorityText: { color: colors.textMuted, fontSize: 15 },
  shortcutHint: { color: colors.textMuted, fontSize: 10 },
  desktopSend: { minWidth: ds(64), height: ds(32), borderRadius: radius.control, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  desktopSendDisabled: { backgroundColor: colors.subtleFill },
  desktopSendText: { color: colors.onAccent, fontSize: 13, fontWeight: '600' },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: COMPOSER_INPUT_BORDER,
    borderRadius: radius.control,
    paddingHorizontal: spacing.lg,
    // One line is exactly the row control height (the ⌨ / ＋ buttons): border + pad + line + pad + border.
    paddingVertical: composerInputPadY(composerControlSize(uiScale().densityFactor), COMPOSER_LINE_HEIGHT * uiScale().fontMultiplier),
    minHeight: composerControlSize(uiScale().densityFactor),
    color: colors.text,
    fontSize: 14,
    // composer-row-layout.ts COMPOSER_LINE_HEIGHT — the ⤢ threshold counts lines in this unit.
    lineHeight: 20,
    maxHeight: 120,
  },
  inputWrap: { flex: 1, justifyContent: 'flex-end' },
  // 撤掉 input 的 flex:1:输入框在列方向的 inputWrap 里,flexBasis 0 会被压扁。用 flex:-1 不用 flex:0 ——
  // web 上 flex:0 = `0 1 0%`(flex-zero-rule.test.ts);-1 两个引擎都是 `0 1 auto`。
  inputInWrap: { flex: -1, alignSelf: 'stretch' },
  sendTextDisabled: { color: colors.textMuted },
});

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
