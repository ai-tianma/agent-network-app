// 任务评论正文的共用渲染(#1831):「评论」区(TaskComments)和「动态」区(TaskActivity)读的是同一份
// requirements event comment,两处必须一致 —— Markdown 渲染 + 复制 Markdown 原文。
//
// 复制入口按设备分流(phone-only-ui):触屏长按正文;鼠标设备在正文下方给「复制」按钮,不把长按漏进桌面。
// clampLines 给「动态」区保留原来的 8 行折叠:MarkdownMessage 是 View 组合,不吃 numberOfLines,
// 这里用 maxHeight = 行数 × 行高裁剪,并给「展开 / 收起」入口。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from './ui-text';
import MarkdownMessage from './MarkdownMessage';
import { t as tr } from './i18n';
import { colors, spacing, type as typeScale } from './theme';
import { pointerUi } from './pointer-ui';

/** 与 TaskActivity 的 c.comment lineHeight 一致(裁剪高度按它算)。 */
const LINE_HEIGHT = 20;
/** 估算是否需要折叠:显式换行超过上限,或总字符数明显超过一行能放下的量。 */
export const commentNeedsClamp = (text: string, clampLines: number): boolean => {
  const t = text ?? '';
  if (t.split('\n').length > clampLines) return true;
  return t.length > clampLines * 40;
};

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    try { await (globalThis as any).navigator?.clipboard?.writeText?.(text); return true; } catch { return false; }
  }
}

export default function CommentBody({ text, clampLines, testID, style }: {
  text: string;
  /** 超过这么多行就折叠(「动态」区原来 numberOfLines=8);不传 = 不折叠。 */
  clampLines?: number;
  testID?: string;
  style?: object;
}) {
  const pointer = pointerUi();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // 「动态」按 part index 做 key,槽位换文本时会复用同一个组件:换文本就回到折叠态,别停在上一段的展开态。
  useEffect(() => { setExpanded(false); }, [text]);

  const copy = useCallback(async () => {
    if (!(await writeClipboard(text))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  const clampable = clampLines != null && commentNeedsClamp(text, clampLines);
  const clamped = clampable && !expanded;
  return (
    <View style={[{ gap: 2 }, style]}>
      <Pressable
        onLongPress={pointer ? undefined : () => { void copy(); }}
        delayLongPress={400}
        accessibilityRole="text"
        accessibilityHint={pointer ? undefined : tr('comments.copyHint')}
        testID={testID}
      >
        <View style={clamped ? { maxHeight: (clampLines as number) * LINE_HEIGHT, overflow: 'hidden' } : undefined}>
          <MarkdownMessage>{text}</MarkdownMessage>
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {pointer ? (
          <Pressable accessibilityRole="button" hitSlop={6} onPress={() => { void copy(); }} testID={testID ? `${testID}-copy` : undefined}>
            <Text style={{ color: colors.accent, fontSize: typeScale.small }}>{tr('comments.copy')}</Text>
          </Pressable>
        ) : null}
        {clampable ? (
          <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setExpanded(v => !v)} testID={testID ? `${testID}-toggle` : undefined}>
            <Text style={{ color: colors.accent, fontSize: typeScale.small }}>{expanded ? tr('act.collapse') : tr('act.expand')}</Text>
          </Pressable>
        ) : null}
        {copied ? (
          <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }} testID={testID ? `${testID}-copied` : undefined}>{tr('comments.copied')}</Text>
        ) : null}
      </View>
    </View>
  );
}
