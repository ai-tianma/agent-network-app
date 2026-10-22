// 人与人私信会话(hub agent-network#2086)。
// 画法照抄 agent 会话(ChatScreen)的同一套:顶栏(返回 · 头像 · 名字)、倒序气泡列表(发出靠右 rowActive 底,
// 收到靠左卡片底)、输入区(手机:输入框 +「＋ ⇄ 发送」一行;桌面:悬浮圆角卡片 + 工具栏)。样式数值与
// ChatScreen 同源(composer-row-layout / composer-resize 的常量),两个会话的输入区量出来一样高、一样齐。
// 私信没有 agent 会话的任务状态、引用、语音、⋯ 面板 —— 只有文字和附件。
// 附件与 agent 会话同一套(owner 2026-09-30「给人好像发不了图片」):手机「＋」微信式面板(相册 / 文件 / 拍照),
// 桌面「＋」系统文件选择器 + 拖进会话区 + ⌘/Ctrl+V;草稿缩略图、原图开关、并发上传队列、点图预览。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, BackHandler, FlatList, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layoutOs } from './safe-area-runtime';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import HumanAvatar from './HumanAvatar';
import GroupAvatar from './GroupAvatar';
import AuthedThumb, { AttachmentFile } from './AuthedThumb';
import AuthedWebThumb from './AuthedWebThumb';
import AttachmentFileDesktop from './AttachmentFileDesktop';
import ImageViewer from './ImageViewer';
import { ackUserMessages, type HubConfig } from './api';
import { ATTACH_ENABLED, pickCameraPhoto, pickDocument, pickFiles, pickImages, prepareForUpload, uploadImage, type PickedImage } from './attach';
import { attachmentCacheScope } from './attach-download';
import { attachmentsFromClipboard, isTauriDesktop, releaseClipboardAttachment } from './clipboard-attachment';
import { conversationDraftKey, stashDraftAttachments, takeDraftAttachments, useComposerDraft } from './composer-drafts';
import { attachmentsFromFiles, filesFromTransfer, plusPressAction, transferHasFiles } from './desktop-file-intake';
import { addToDraft, draftCountLabel, draftImageCount, isDraftImage, MAX_DRAFT_IMAGES, oversizeMessage, remainingImageSlots, removeFromDraft, sendBlocker, willCompressBeforeUpload } from './image-draft';
import { createUploadMemo, runUploadQueue, UPLOAD_CONCURRENCY, uploadFailureSummary, withUploadState, type UploadState } from './upload-queue';
import { nextPlusPanel, plusPanelHeight, plusPanelItems, type PlusItemKey, type PlusPanelEvent } from './composer-plus-panel';
import { openGallery, viewerImageFor, type ViewerImage, type ViewerState } from './image-viewer-model';
import { conversationGallery, imagePreviewSurface, imageWindowPayload } from './image-window-model';
import { openImageWindow } from './image-window';
import { dmAttachmentViews, localAttachmentViews, type DmAttachmentView } from './dm-attachment-model';
import { usePoll } from './usePoll';
import { colors, onThemeChange, radius, spacing } from './theme';
import { bubbleInk, MineBubble, useBubbleInk } from './bubble-ink';
import { ds, uiScale } from './ui-scale';
import { elevated } from './elevation';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-chat';
import './i18n-tasks';
import './i18n-users';
import { localizedChatHeader as formatChatHeader } from './i18n-chat-time';
import { ChatMetaLine, ChatTimePill } from './ChatTimeText';
import { shouldShowTimeHeader } from './time';
import { canSend, shouldSendOnEnter } from './chat-actions';
import { sendKeyPref, subscribeShortcuts } from './shortcuts-store';
import { ComposerRightSlot } from './ComposerRowParts';
import { COMPOSER_INPUT_BORDER, COMPOSER_LINE_HEIGHT, composerControlSize, composerInputPadY, composerLineCount, composerRightSlot, composerRowAlign } from './composer-row-layout';
import { webComposerInputHeight } from './composer-input-height';
import { COMPOSER_CARD_INSET, COMPOSER_DIVIDER_HEIGHT, COMPOSER_HEIGHT_DEFAULT } from './composer-resize';
import { dmSendBody, mergeDm, newClientRequestId, taskNoticeOf, unackedIncomingIds, type DmAttachment, type DmMessage, type Human } from './human-dm';
import { fetchDmMessages, fetchHumans, sendDm } from './human-dm-api';
import { canPostInGroup, groupSendBody, readTarget, senderOf, type GroupMessage } from './group-chat';
import { fetchGroup, fetchGroupMessages, markGroupRead, sendGroupMessage } from './group-chat-api';
import { emitGroupChat, setActiveGroup, subscribeGroupChat } from './group-chat-bus';
import { emitHumanDm, setActiveDmPeer, subscribeHumanDm } from './human-dm-bus';
import { keyboardAvoidEnabled, useKeyboardVisible } from './keyboard-visibility';
import { useScreenKeyboardInset } from './screen-keyboard-inset';
import { bubbleLayout, desktopBubbleCap } from './bubble-layout';

/** 本地那条(还在发 / 没发出去):记住草稿里的文件和原图档,「点击重试」原样再发一次。 */
type LocalDm = GroupMessage & { _files?: PickedImage[]; _original?: boolean; _uploads?: UploadState[]; _uploadError?: string };

// 重试不重传:已传上去的那几张按 (hub, 本地 uri, 原图档) 记住(与 agent 会话同一个 memo 形状)。
const uploadMemo = createUploadMemo<DmAttachment>();
// 多图方格:微信式每行最多 3 格。气泡按内容收缩,方格不给定宽就会一格一行地折下去 —— 按列数算出宽度。
const GRID_CELL = 84;
const GRID_GAP = 4;
const gridWidth = (count: number) => { const cols = Math.min(3, count); return cols * GRID_CELL + (cols - 1) * GRID_GAP; };

/** 群聊(RFC-042,Hub ≥ .93):同一个会话页,换成群的取数 / 发送 / 已读。 */
export type GroupChatRef = { group_id: string; name: string };

// 私信和群聊共用这一页(输入区、附件、乐观发送 + client_request_id 重试、看图都一样);不同的只有取数 / 发送 / 已读,
// 以及群里收到的消息按各自的发信人画头像和名字。peer 与 group 二选一。
export default function DmChatScreen({ cfg, networkId, peer: peerProp, group, onBack, desktop = false, hideBack = false, onOpenTask }: {
  cfg: HubConfig;
  networkId: string;
  peer?: Human;
  group?: GroupChatRef;
  onBack: () => void;
  desktop?: boolean;
  hideBack?: boolean;
  /** 任务通知私信(meta.task_notice):气泡下「查看任务 ›」打开那张任务。不传 = 不画。 */
  onOpenTask?: (requirementId: string) => void;
}) {
  useTranslation();
  const peer: Human = peerProp ?? { user_id: '', username: group?.name ?? '' };
  const isGroup = !!group;
  const groupId = group?.group_id ?? '';
  const name = isGroup ? group!.name : (peer.display_name ?? '').trim() || peer.username;
  // 群:发信人的显示名(人员表)和群人数(群资料)。读不到就用消息里的用户名、不写人数。
  const [groupPeople, setGroupPeople] = useState<Human[]>([]);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  // viewer_can.post === false(§10:已不是群成员)→ 不画输入栏;旧 Hub 没给 → 照常能发。
  const [canPost, setCanPost] = useState(true);
  useEffect(() => {
    if (!isGroup) return;
    let live = true;
    void fetchHumans(cfg, networkId).then(h => { if (live) setGroupPeople(h); }).catch(() => {});
    void fetchGroup(cfg, networkId, groupId).then(d => { if (live) { setMemberCount(d.members.length || d.group.member_count || null); setCanPost(canPostInGroup(d.group)); } }).catch(() => {});
    return () => { live = false; };
  }, [cfg.serverUrl, cfg.token, networkId, groupId, isGroup]);
  const readMarked = useRef(0);
  const [messages, setMessages] = useState<LocalDm[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraftState] = useState('');
  // #632 草稿(微信同款):按 账号 + Hub + 网络 + 会话(私信对方 / 群)存在本机;发成功才删,发失败留着(composer-drafts.ts)。
  const composerDraftKey = conversationDraftKey({ ...cfg, networkId }, isGroup ? { kind: 'group', groupId } : { kind: 'dm', userId: peer.user_id || peer.username });
  const { setDraft, holdForSend } = useComposerDraft(composerDraftKey, draft, setDraftState);
  const [attached, setAttached] = useState<PickedImage[]>([]);
  const [sending, setSending] = useState(false);
  const [paneWidth, setPaneWidth] = useState(0);
  const insets = useSafeAreaInsets();
  const composerInset = layoutOs() === 'android' ? insets.bottom : 0;
  const keyboardVisible = useKeyboardVisible(Keyboard, Platform.OS);
  // iOS: composer keyboard inset measured in window coordinates (#547, same as ChatScreen).
  const iosKeyboard = useScreenKeyboardInset();
  const acked = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (isGroup) {
      try {
        const page = await fetchGroupMessages(cfg, networkId, groupId);
        const rows = page.messages;
        setMessages(prev => mergeDm(prev.filter(m => !m.pending || !rows.some(r => r.message_id === m.message_id)), rows));
        setError('');
        // 打开即读:读到这一页最新的那条(只前进);Hub 推 group_read 给我的其他设备,列表角标一起清。
        const target = readTarget(rows, readMarked.current);
        if (target !== null) {
          readMarked.current = target;
          await markGroupRead(cfg, networkId, groupId, target).then(r => emitGroupChat({ type: 'group_read', group_id: groupId, last_read_seq: r.last_read_seq, unread: r.unread }))
            .catch(() => { readMarked.current = 0; });
        }
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setLoaded(true);
      }
      return;
    }
    try {
      const rows = await fetchDmMessages(cfg, networkId, peer.user_id);
      setMessages(prev => mergeDm(prev.filter(m => !m.pending || !rows.some(r => r.message_id === m.message_id)), rows));
      setError('');
      // 打开即读:对方发来、还没 ack 的这一批标已读(hub 只改自己的行),人员列表的角标随之清掉。
      const ids = unackedIncomingIds(rows).filter(id => !acked.current.has(id));
      if (ids.length) {
        ids.forEach(id => acked.current.add(id));
        await ackUserMessages(cfg, ids).catch(() => ids.forEach(id => acked.current.delete(id)));
        emitHumanDm(null);
      }
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoaded(true);
    }
  }, [cfg, networkId, peer.user_id, isGroup, groupId]);
  usePoll(load, 8000, [load]);
  useEffect(() => (isGroup
    ? subscribeGroupChat(ev => { if (ev?.type === 'group_message' && ev.group_id === groupId) void load(); })
    : subscribeHumanDm(from => { if (!from || from === peer.username) void load(); })), [load, peer.username, isGroup, groupId]);
  useEffect(() => {
    if (isGroup) {
      setActiveGroup(groupId);
      return () => setActiveGroup(null);
    }
    setActiveDmPeer(peer.username);
    return () => setActiveDmPeer(null);
  }, [peer.username, isGroup, groupId]);

  // ── 草稿里的附件(与 ChatScreen 同一套 image-draft 规则:最多 9 张图 / 20 个附件,选择顺序即发送顺序)──
  const attachedRef = useRef<PickedImage[]>([]);
  attachedRef.current = attached;
  // #632 选了还没发的附件:按会话留在本次运行的内存里(重启不保留)。
  useLayoutEffect(() => {
    const restored = takeDraftAttachments(composerDraftKey);
    attachedRef.current = restored;
    setAttached(restored);
    return () => stashDraftAttachments(composerDraftKey, attachedRef.current);
  }, [composerDraftKey]);
  const [sendOriginal, setSendOriginal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);
  const appendAttachments = useCallback((incoming: PickedImage[]) => {
    if (!incoming.length) return;
    const result = addToDraft(attachedRef.current, incoming);
    result.rejected.forEach(releaseClipboardAttachment);
    attachedRef.current = result.next;
    setAttached(result.next);
    if (result.notice) setNotice(result.notice);
  }, []);
  const removeAttachment = (uri: string) => {
    const { next, removed } = removeFromDraft(attachedRef.current, uri);
    releaseClipboardAttachment(removed);
    attachedRef.current = next;
    setAttached(next);
  };
  const willCompressLater = useCallback(
    (img: PickedImage) => willCompressBeforeUpload(img, { original: sendOriginal, platform: Platform.OS }),
    [sendOriginal],
  );

  // 桌面 ⌘/Ctrl+V:剪贴板里的截图 / 文件进草稿(纯文字照常粘贴)。agent 会话的这个监听只在 ChatScreen 挂着时有,
  // 私信开着时 ChatScreen 不在 —— 此前在私信里粘截图什么都不发生。
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
  // 桌面:文件拖进私信会话区 = 加进草稿(拖文字 / 链接不接)。
  const [dropActive, setDropActive] = useState(false);
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!desktop || !doc?.addEventListener) return;
    let clear: ReturnType<typeof setTimeout> | null = null;
    const inPane = (event: DragEvent) => !!(event.target as Element | null)?.closest?.('[data-testid="dm-pane"]');
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

  // ── 手机「＋」:微信式一层面板(相册 / 文件 / 拍照),与 agent 会话同一个状态机 ──
  const [plusOpen, setPlusOpen] = useState(false);
  const plusOpenRef = useRef(plusOpen);
  plusOpenRef.current = plusOpen;
  const plusEvent = (event: PlusPanelEvent): boolean => {
    const next = nextPlusPanel(plusOpenRef.current, event);
    plusOpenRef.current = next.open;
    setPlusOpen(next.open);
    if (next.dismissKeyboard) Keyboard.dismiss();
    return next.handled;
  };
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => { if (plusOpenRef.current) plusEvent('keyboardShown'); });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!plusOpen || desktop || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => plusEvent('back'));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plusOpen, desktop]);
  const { height: windowHeight } = useWindowDimensions();
  const plusItems = plusPanelItems({ os: Platform.OS, desktop, attachEnabled: ATTACH_ENABLED, btwEntry: false });
  const cannotOpen = (error: unknown) => Alert.alert(t('chat.cannotOpen'), error instanceof Error ? error.message : String(error));
  const runPlusItem = (key: PlusItemKey) => {
    plusEvent('itemPicked');
    if (key === 'album') {
      const slots = remainingImageSlots(attachedRef.current);
      if (slots <= 0) { setNotice(t('chat.maxImages', { count: MAX_DRAFT_IMAGES })); return; }
      pickImages(slots).then(appendAttachments).catch(cannotOpen);
    } else if (key === 'file') {
      pickDocument().then(item => { if (item) appendAttachments([item]); }).catch(cannotOpen);
    } else if (key === 'camera') {
      pickCameraPhoto().then(item => { if (item) appendAttachments([item]); }).catch(cannotOpen);
    }
  };
  // 桌面「＋」= 系统文件选择器(多选、任意类型);手机 = 上面的面板。
  const onPlus = () => {
    if (plusPressAction({ desktop, attachEnabled: ATTACH_ENABLED }) === 'panel') { plusEvent('toggle'); return; }
    pickFiles().then(appendAttachments).catch(cannotOpen);
  };

  // ── 发送:先按选择顺序并发上传(≤3),全部传上才发私信;一张失败整条不发,标「未送达」可重试 ──
  const patch = (id: string, fn: (m: LocalDm) => LocalDm) => setMessages(prev => prev.map(m => (m.message_id === id ? fn(m) : m)));
  const deliver = async (clientId: string, text: string, files: PickedImage[], original: boolean): Promise<boolean> => {
    patch(clientId, m => ({ ...m, pending: true, failed: false, _uploadError: undefined }));
    try {
      const run = await runUploadQueue(files, async img => {
        const hit = uploadMemo.get(cfg.serverUrl, img.uri, original);
        if (hit) return hit;
        const prepared = await prepareForUpload(img, original);
        const tooBig = oversizeMessage(prepared);
        if (tooBig) throw new Error(tooBig);
        const up = await uploadImage(cfg, prepared, { networkId, purpose: 'dm' });
        const done: DmAttachment = { type: 'file', file_id: up.file_id, name: prepared.fileName, mime: up.mime, size: up.size };
        uploadMemo.set(cfg.serverUrl, img.uri, original, done);
        return done;
      }, {
        concurrency: UPLOAD_CONCURRENCY,
        onState: (index, state) => patch(clientId, m => ({ ...m, _uploads: withUploadState(m._uploads, files.length, index, state) })),
      });
      if (run.failed.length) {
        const summary = uploadFailureSummary(files.map(f => f.fileName), run.errors) ?? t('chat.attachmentFailed');
        patch(clientId, m => ({ ...m, pending: false, failed: true, _uploadError: summary }));
        return false;
      }
      const uploaded = run.results as DmAttachment[];
      // 群:同一个 client_request_id 重投,Hub 按 (群, 发信人, client_request_id) 定出同一个 message_id,不会多出一条。
      const res = isGroup
        ? await sendGroupMessage(cfg, networkId, groupId, groupSendBody({ message: text, attachments: uploaded, clientRequestId: clientId }))
        : await sendDm(cfg, dmSendBody({ networkId, toUserId: peer.user_id, message: text, attachments: uploaded, clientRequestId: clientId }));
      setMessages(prev => mergeDm<LocalDm>(prev.filter(m => m.message_id !== clientId), [{ ...res.message, direction: 'out' }]));
      // 群:会话列表的预览 / 排序跟上我刚发的这条(SSE 也会推,这里不等它 —— 推送断了时列表不该停在旧预览上)。
      if (isGroup) emitGroupChat(null);
      files.forEach(releaseClipboardAttachment);
      setError('');
      return true;
    } catch (e) {
      patch(clientId, m => ({ ...m, pending: false, failed: true }));
      setError(String((e as Error)?.message ?? e));
      return false;
    }
  };
  const submit = async () => {
    if (!canSend(draft, attached.length > 0, sending)) return;
    const blocked = sendBlocker(attached, willCompressLater);
    if (blocked) { setNotice(blocked); return; }
    const text = draft.trim();
    const files = attached;
    const original = sendOriginal;
    const clientId = newClientRequestId();
    setSending(true);
    // #632:先把草稿「押」住再清空输入框 —— 发成功才删草稿,发失败离开再回来字还在。
    const draftSettled = holdForSend(draft);
    setDraft('');
    attachedRef.current = [];
    setAttached([]);
    const optimistic: LocalDm = { message_id: clientId, content: text, direction: 'out', created_at: new Date().toISOString(), pending: true, _files: files, _original: original };
    setMessages(prev => mergeDm(prev, [optimistic]));
    try {
      draftSettled(await deliver(clientId, text, files, original));
    } finally {
      setSending(false);
    }
  };
  // 同一个 client_request_id 重投:hub 按它定出同一个 message_id,不会多出一条;已传上的附件不重传。
  const retry = (m: LocalDm) => {
    const draftSettled = holdForSend(m.content ?? '');
    void deliver(m.message_id, m.content ?? '', m._files ?? [], m._original ?? false).then(draftSettled);
  };
  // 手机输入框随内容长高(与 agent 会话同一套:最小的内容高度 = 一行;web 上按行数给 textarea 定高,封顶 120)。
  const [inputContentHeight, setInputContentHeight] = useState<number | undefined>(undefined);
  const oneLineHeightRef = useRef<number | undefined>(undefined);
  const onInputContentSize = (h: number) => {
    if (!(h > 0)) return;
    if (oneLineHeightRef.current === undefined || h < oneLineHeightRef.current) oneLineHeightRef.current = h;
    setInputContentHeight(h);
  };
  const inputLines = composerLineCount(draft, inputContentHeight, oneLineHeightRef.current);
  // 订阅:设置窗口改了发送键,这里要跟着变(和 ChatScreen 一样),不是只在下次重渲染时碰巧读到。
  const sendKey = useSyncExternalStore(subscribeShortcuts, sendKeyPref, sendKeyPref);
  const rightSlot = composerRightSlot({ draft, attachmentCount: attached.length, voiceMode: false });
  const bubbleCap = desktopBubbleCap(desktop, paneWidth);
  const me = cfg.username ?? '';

  // ── 看图:手机 / 纯网页 = 全屏 ImageViewer;桌面 = 独立「图片预览」窗口,←/→ 走整个私信的图 ──
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const viewerEnv = { os: Platform.OS, tauri: isTauriDesktop() };
  const viewsOf = (m: LocalDm): DmAttachmentView[] =>
    m._files?.length && (m.pending || m.failed) ? localAttachmentViews(m._files) : dmAttachmentViews(m, cfg.serverUrl);
  const galleryOf = (views: DmAttachmentView[]): ViewerImage[] =>
    views.map(a => viewerImageFor(a, viewerEnv)).filter((v): v is ViewerImage => !!v);
  const openViewer = (gallery: ViewerImage[], key: string, resolvedUri?: string) => {
    const inApp = openGallery(gallery, key, resolvedUri);
    if (imagePreviewSurface(viewerEnv) !== 'window') { setViewer(inApp); return; }
    const payload = imageWindowPayload({
      conversation: conversationGallery([...messages].reverse().map(m => galleryOf(viewsOf(m)))),
      message: gallery,
      tappedKey: key,
      profileId: cfg.profileId,
      serverUrl: cfg.serverUrl,
      title: name,
      now: Date.now(),
    });
    if (!payload) { setViewer(inApp); return; }
    void openImageWindow(payload, { measureUri: resolvedUri }).then(ok => { if (!ok) setViewer(inApp); });
  };

  // 画法与 agent 会话的 renderAttachment 同分支:Tauri 桌面必须走 AuthedWebThumb / AttachmentFileDesktop ——
  // AuthedThumb / AttachmentFile 靠 expo-file-system 的缓存目录,只在手机上有;此前私信在桌面上图一直转圈 / 加载失败。
  const tauriWeb = Platform.OS === 'web' && isTauriDesktop();
  const renderImage = (a: DmAttachmentView, gallery: ViewerImage[], compact: boolean) => {
    const scope = `${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`;
    if (!a.needsAuth) {
      return (
        <Pressable key={a.key} onPress={() => openViewer(gallery, a.key, a.uri)} accessibilityLabel={t('chat.previewName', { name: a.name })}>
          <Image source={{ uri: a.uri }} style={compact ? styles.gridImage : styles.thumb} resizeMode={compact ? 'cover' : 'contain'} />
        </Pressable>
      );
    }
    if (tauriWeb) return <AuthedWebThumb key={scope} uri={a.uri} name={a.name} mime={a.mime} token={cfg.token} compact={compact} onPress={objectUrl => openViewer(gallery, a.key, objectUrl)} />;
    if (Platform.OS !== 'web') return <AuthedThumb key={scope} fileId={a.key} name={a.name} mime={a.mime} serverUrl={cfg.serverUrl} token={cfg.token} compact={compact} onPress={localUri => openViewer(gallery, a.key, localUri)} />;
    return <AttachmentLine key={a.key} name={a.name} />;
  };
  const renderFile = (a: DmAttachmentView) => {
    const scope = `${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`;
    if (a.needsAuth && tauriWeb) return <AttachmentFileDesktop key={scope} uri={a.uri} name={a.name} token={cfg.token} size={a.size} />;
    if (a.needsAuth && Platform.OS !== 'web') return <AttachmentFile key={scope} fileId={a.key} name={a.name} mime={a.mime} serverUrl={cfg.serverUrl} token={cfg.token} />;
    return <AttachmentLine key={a.key} name={a.name} />;
  };
  const renderAttachments = (m: LocalDm) => {
    const views = viewsOf(m);
    if (!views.length) return null;
    const gallery = galleryOf(views);
    const images = views.filter(a => a.isImage);
    const files = views.filter(a => !a.isImage);
    const uploadsFor = (a: DmAttachmentView) => (m._files ? m._uploads?.[views.indexOf(a)] : undefined);
    // 两张及以上 = 微信式方格;单图照原样大图。上传中 / 失败画在格子上。
    const cell = (a: DmAttachmentView, compact = true) => {
      const state = uploadsFor(a);
      return (
        <View key={a.key} style={[compact ? styles.gridCell : styles.singleCell, state?.status === 'failed' && styles.gridCellFailed]} testID="dm-image-cell">
          {renderImage(a, gallery, compact)}
          {state && (state.status === 'queued' || state.status === 'uploading') ? (
            <View style={styles.gridOverlay} pointerEvents="none"><ActivityIndicator size="small" color="#fff" /></View>
          ) : null}
        </View>
      );
    };
    return (
      <View style={styles.attachments} testID="dm-attachments">
        {images.length > 1
          ? <View style={[styles.grid, { width: gridWidth(images.length) }]}>{images.map(a => cell(a))}</View>
          : images.map(a => (m._files ? cell(a, false) : renderImage(a, gallery, false)))}
        {files.map(renderFile)}
      </View>
    );
  };

  const data = useMemo(() => messages, [messages]);
  return (
    <KeyboardAvoidingView
      style={[styles.root, iosKeyboard.style]}
      testID="dm-pane"
      behavior={iosKeyboard.handled ? undefined : 'padding'}
      enabled={keyboardAvoidEnabled(Platform.OS, keyboardVisible)}
      keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0}
      onLayout={e => setPaneWidth(e.nativeEvent.layout.width)}
    >
      {iosKeyboard.probe}
      <View style={styles.header} testID="dm-header">
        {!desktop && !hideBack ? (
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('chat.back')} testID="dm-header-back">
            <Text style={styles.back}>‹</Text>
          </Pressable>
        ) : null}
        {isGroup ? <GroupAvatar size={32} /> : <HumanAvatar hubUrl={cfg.serverUrl} token={cfg.token} person={peer} size={32} testID="dm-peer-avatar" />}
        <View style={styles.headerTitleCol}>
          <Text style={styles.title} numberOfLines={1} testID="dm-header-title">{name}</Text>
          <Text style={styles.subtitle} numberOfLines={1} testID="dm-header-subtitle">
            {isGroup ? (memberCount ? t('group.subtitle', { n: memberCount }) : t('group.subtitleNoCount')) : t('dm.subtitle', { username: peer.username })}
          </Text>
        </View>
      </View>
      {!loaded ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <FlatList
          inverted
          data={data}
          keyExtractor={m => m.message_id}
          contentContainerStyle={{ padding: spacing.lg }}
          testID="dm-list"
          ListFooterComponent={data.length ? null : <Text style={styles.beginning}>{isGroup ? t('group.empty') : t('dm.empty', { name })}</Text>}
          renderItem={({ item, index }) => {
            const showHeader = shouldShowTimeHeader(item.created_at ?? undefined, data[index + 1]?.created_at ?? undefined);
            const out = item.direction === 'out';
            const taskNotice = onOpenTask && !isGroup ? taskNoticeOf(item.meta_json) : null;
            // 群里收到的消息:各画各的发信人;私信:对方。
            const from = isGroup && !out ? senderOf(item, groupPeople) : { username: peer.username, name };
            return (
              <View style={styles.bubbleWrap} testID={`dm-msg-${out ? 'out' : 'in'}`}>
                {showHeader && item.created_at ? <ChatTimePill time={formatChatHeader(item.created_at)} boxStyle={styles.timePill} textStyle={styles.timePillText} testID="dm-time-pill" /> : null}
                <View style={[styles.messageRow, out ? styles.sentRow : styles.replyRow]}>
                  {out ? null : isGroup ? <AliasAvatar alias={from.username} size={36} /> : <HumanAvatar hubUrl={cfg.serverUrl} token={cfg.token} person={peer} size={36} testID="dm-incoming-avatar" />}
                  <View style={[styles.messageContent, out && styles.sentContent, !out && bubbleCap]}>
                    <ChatMetaLine name={out ? me : from.name} time={item.created_at ? formatChatHeader(item.created_at) : ''} textStyle={styles.messageAuthor} style={styles.authorRow} testID="dm-author" />
                    <View style={[styles.bubble, !out && styles.replyBubble, !out && desktop && styles.replyBubbleDesktop]} testID="dm-bubble">
                      <MineBubble value={out}>
                      {item.content ? <Text style={[styles.bubbleText, out && styles.bubbleTextMine]} selectable>{item.content}</Text> : null}
                      {renderAttachments(item)}
                      {taskNotice ? (
                        <Pressable
                          accessibilityRole="link"
                          accessibilityLabel={t('tasks.noticeOpenA11y')}
                          onPress={() => onOpenTask!(taskNotice.requirementId)}
                          hitSlop={6}
                          style={styles.taskLink}
                          testID="dm-open-task"
                        >
                          <Text style={[styles.taskLinkText, bubbleInk(out, 'link')]}>{t('tasks.noticeOpen')}</Text>
                        </Pressable>
                      ) : null}
                      </MineBubble>
                    </View>
                    {item.pending ? <Text style={styles.statusMark}>{t('dm.sending')}</Text> : item.failed ? (
                      <Pressable onPress={() => retry(item)} accessibilityRole="button" accessibilityLabel={t('dm.retry')} hitSlop={6} testID="dm-retry">
                        <Text style={[styles.statusMark, { color: colors.failed }]}>{t('dm.failed')} · {t('dm.retry')}</Text>
                        {item._uploadError ? <Text style={[styles.statusMark, { color: colors.failed }]} numberOfLines={2}>{item._uploadError}</Text> : null}
                      </Pressable>
                    ) : null}
                  </View>
                  {out ? <AliasAvatar alias={me || 'me'} size={36} /> : null}
                </View>
              </View>
            );
          }}
        />
      )}
      {error ? <Text style={styles.error} testID="dm-error" numberOfLines={2}>{error}</Text> : null}
      {attached.length ? (
        <View style={styles.draftStrip} testID="dm-draft-strip">
          <View style={styles.draftStripHeader}>
            <Text style={styles.draftCount} testID="dm-draft-count">{draftCountLabel(attached)}</Text>
            {draftImageCount(attached) ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sendOriginal }}
                aria-checked={sendOriginal}
                accessibilityLabel={t('chat.original')}
                hitSlop={8}
                onPress={() => setSendOriginal(v => !v)}
                style={styles.originalToggle}
                testID="dm-original-toggle"
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
                <View key={item.uri} style={[styles.draftThumbWrap, tooBig && styles.draftThumbTooBig]} testID="dm-draft-thumb">
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
                <View key={item.uri} style={[styles.draftFileChip, tooBig && styles.draftThumbTooBig]} testID="dm-draft-file">
                  <Text style={styles.draftName} numberOfLines={2}>📎 {item.fileName}</Text>
                  <Pressable onPress={() => removeAttachment(item.uri)} hitSlop={8} style={styles.draftRemove} accessibilityLabel={t('chat.removeName', { name: item.fileName })}>
                    <Text style={styles.draftRemoveText}>✕</Text>
                  </Pressable>
                </View>
              );
            })}
            {!desktop && ATTACH_ENABLED && remainingImageSlots(attached) > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chat.addMore')}
                testID="dm-draft-add"
                onPress={() => plusEvent('toggle')}
                style={({ pressed }) => [styles.draftAddTile, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="add" size={26} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
      {notice ? (
        <View style={styles.notice} pointerEvents="none" accessibilityLiveRegion="polite" testID="dm-notice">
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
      {isGroup && !canPost ? (
        <View style={styles.readOnlyBar} testID="group-readonly">
          <Text style={styles.readOnlyText}>{t('group.readOnly')}</Text>
        </View>
      ) : desktop ? (
        <View style={styles.desktopComposerWrap}>
          {/* agent 会话在卡片上方有一条 6 px 的拖动分隔条;私信不可拖,留同样高的空,两边卡片落在同一高度。 */}
          <View style={{ height: COMPOSER_DIVIDER_HEIGHT }} />
          <View style={[styles.desktopComposer, { minHeight: COMPOSER_HEIGHT_DEFAULT }]} testID="dm-desktop-composer">
            <TextInput
              // 一行一行地长(21 px 一行,最多 6 行):web 的 textarea 不写 rows 默认是两行高,卡片会比 agent 会话的高一截。
              style={[styles.desktopInput, { height: Math.min(6, draft.split('\n').length) * 21 }]}
              {...(Platform.OS === 'web' ? { rows: 1 } : null)}
              placeholder={t('dm.placeholder', { name })}
              placeholderTextColor={colors.textMuted}
              value={draft}
              onChangeText={setDraft}
              testID="dm-input"
              onKeyPress={event => {
                const key = event.nativeEvent as typeof event.nativeEvent & { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; isComposing?: boolean };
                if (!shouldSendOnEnter(key, sendKey)) return;
                event.preventDefault?.();
                void submit();
              }}
              multiline
            />
            <View style={styles.desktopToolbar}>
              <Pressable accessibilityLabel={t('chat.addFile')} testID="dm-desktop-plus" style={({ pressed }) => [styles.desktopToolButton, pressed && { opacity: 0.6 }]} onPress={onPlus} hitSlop={6}>
                <Ionicons name="add-circle-outline" size={24} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.desktopSend, !canSend(draft, attached.length > 0, sending) && styles.desktopSendDisabled, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={t('chat.send')}
                onPress={() => void submit()}
                disabled={!canSend(draft, attached.length > 0, sending)}
                testID="dm-desktop-send"
              >
                <Text style={[styles.desktopSendText, !canSend(draft, attached.length > 0, sending) && styles.sendTextDisabled]}>{t('chat.send')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <View style={[styles.inputRow, { alignItems: composerRowAlign(inputLines, false), paddingBottom: spacing.md + composerInset }]} testID="dm-input-row">
          <View style={styles.inputWrap}>
            <TextInput
              style={[styles.input, styles.inputInWrap, Platform.OS === 'web' && { height: webComposerInputHeight(inputLines), flexBasis: 'auto' }]}
              {...(Platform.OS === 'web' ? { rows: 1 } : null)}
              placeholder={t('dm.placeholder', { name })}
              placeholderTextColor={colors.textMuted}
              value={draft}
              onChangeText={setDraft}
              onContentSizeChange={event => onInputContentSize(event.nativeEvent.contentSize.height)}
              onFocus={() => { if (plusOpenRef.current) plusEvent('inputFocus'); }}
              testID="dm-input"
              multiline
            />
          </View>
          <ComposerRightSlot slot={rightSlot} sendDisabled={!canSend(draft, attached.length > 0, sending)} plusOpen={plusOpen} onSend={() => void submit()} onPlus={onPlus} />
        </View>
      )}
      {!desktop && plusOpen ? (
        // 与 agent 会话同样内嵌在输入行下面(占键盘的位置),双栏时不盖住左边列表。
        <View
          accessibilityLabel={t('chat.moreSend')}
          testID="dm-plus-panel"
          style={[styles.plusPanel, { height: plusPanelHeight(windowHeight) + composerInset, paddingBottom: composerInset }]}
        >
          <View style={styles.plusGrid}>
            {plusItems.map(item => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={t(`chat.plusHint.${item.key}`)}
                testID={`dm-plus-${item.key}`}
                style={({ pressed }) => [styles.plusCell, pressed && { opacity: 0.6 }]}
                onPress={() => runPlusItem(item.key)}
              >
                <View style={styles.plusCellIcon}>
                  {item.icon ? <Ionicons name={item.icon as any} size={28} color={colors.text} /> : null}
                </View>
                <Text style={styles.plusCellLabel} numberOfLines={1}>{t(`chat.plus.${item.key}`)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {desktop && dropActive ? (
        <View pointerEvents="none" style={styles.dropOverlay} testID="dm-drop-overlay">
          <Ionicons name="cloud-upload-outline" size={28} color={colors.accent} />
          <Text style={styles.dropOverlayText}>{t('chat.drop')}</Text>
        </View>
      ) : null}
      <ImageViewer state={viewer} onClose={() => setViewer(null)} serverUrl={cfg.serverUrl} token={cfg.token} />
    </KeyboardAvoidingView>
  );
}

const makeStyles = (B = bubbleLayout()) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
  back: { color: colors.accent, fontSize: 28, lineHeight: 30, paddingRight: spacing.sm },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  headerTitleCol: { flex: 1, minWidth: 0 },
  beginning: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginVertical: spacing.md },
  bubbleWrap: { marginBottom: spacing.md, gap: spacing.xs },
  // #683: pill = View box + time Text with a width floor (ChatTimePill), as in ChatScreen.
  timePill: { marginTop: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.subtleFill, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  timePillText: { color: colors.textMuted, fontSize: 11 },
  messageRow: B.messageRow,
  sentRow: B.sentRow,
  replyRow: B.replyRow,
  messageContent: B.messageContent,
  sentContent: B.sentContent,
  // #683: author line = ChatMetaLine row (name shrinks, time never does); the row carries the margin.
  messageAuthor: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  authorRow: { marginBottom: 3 },
  bubble: { ...B.bubble, backgroundColor: colors.bubbleMine, borderRadius: radius.bubble },
  replyBubble: { ...B.replyBubble, backgroundColor: colors.card },
  replyBubbleDesktop: B.replyBubbleDesktop,
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bubbleTextMine: { color: colors.onBubbleMine },
  attachments: { gap: spacing.xs, marginTop: spacing.xs },
  statusMark: { color: colors.textMuted, fontSize: 10, marginTop: 2, alignSelf: 'flex-end' },
  error: { color: colors.failed, fontSize: 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  attachmentLine: { color: colors.accent, fontSize: 12, marginTop: spacing.xs },
  taskLink: { alignSelf: 'flex-start', marginTop: spacing.xs, minHeight: 24, justifyContent: 'center' },
  taskLinkText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  thumb: { width: 180, height: 180, borderRadius: radius.thumb, backgroundColor: colors.inputBg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gridCell: { width: 84, height: 84, borderRadius: radius.thumb, overflow: 'hidden', backgroundColor: colors.inputBg },
  singleCell: { alignSelf: 'flex-start', borderRadius: radius.thumb, overflow: 'hidden' },
  gridCellFailed: { borderWidth: 2, borderColor: colors.failed },
  gridImage: { width: 84, height: 84 },
  gridOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
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
  draftName: { color: colors.textSecondary, fontSize: 12, flexShrink: 1 },
  draftAddTile: { width: 64, height: 64, borderRadius: radius.thumb, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  notice: { alignSelf: 'center', marginVertical: 4, paddingVertical: 5, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.card, maxWidth: '92%', ...elevated('floating') },
  noticeText: { color: colors.text, fontSize: 12 },
  plusPanel: { backgroundColor: colors.inputBg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  plusGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  plusCell: { width: '25%', maxWidth: 104, alignItems: 'center', marginBottom: spacing.lg },
  plusCellIcon: { width: 60, height: 60, borderRadius: radius.surface, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  plusCellLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  dropOverlay: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, bottom: spacing.sm, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: radius.control, backgroundColor: colors.bg + 'E6', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  dropOverlayText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  readOnlyBar: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center' },
  readOnlyText: { color: colors.textMuted, fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  inputWrap: { flex: 1, justifyContent: 'flex-end' },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: COMPOSER_INPUT_BORDER,
    borderRadius: radius.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: composerInputPadY(composerControlSize(uiScale().densityFactor), COMPOSER_LINE_HEIGHT * uiScale().fontMultiplier),
    minHeight: composerControlSize(uiScale().densityFactor),
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    maxHeight: 120,
  },
  // flex:-1 不是 flex:0:web 上 flex:0 = `0 1 0%`(flex-zero-rule.test.ts);-1 两个引擎都是 `0 1 auto`。
  inputInWrap: { flex: -1, alignSelf: 'stretch' },
  desktopComposerWrap: { paddingHorizontal: COMPOSER_CARD_INSET, paddingBottom: COMPOSER_CARD_INSET, backgroundColor: colors.bg },
  desktopComposer: { backgroundColor: colors.card, borderRadius: radius.surface, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, overflow: 'hidden', ...elevated('raised') },
  desktopInput: { minHeight: 21, color: colors.text, fontSize: 14, lineHeight: 21, padding: 0, textAlignVertical: 'top', outlineStyle: 'none' } as any,
  desktopToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, height: 38 },
  desktopToolButton: { width: 34, height: 34, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  desktopSend: { minWidth: ds(64), height: ds(32), borderRadius: radius.control, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  desktopSendDisabled: { backgroundColor: colors.subtleFill },
  desktopSendText: { color: colors.onAccent, fontSize: 13, fontWeight: '600' },
  sendTextDisabled: { color: colors.textMuted },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });

// 「📎 文件名」一行:在「我发出的」实底气泡里换成 onBubbleMine 一族(#545,见 bubble-ink.ts),否则蓝字画在蓝底上。
function AttachmentLine({ name }: { name: string }) {
  const ink = useBubbleInk('link');
  return <Text style={[styles.attachmentLine, ink]}>📎 {name}</Text>;
}
