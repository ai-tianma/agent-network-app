// #725: the read-only "registered but no session" block in the Agents list.
//
// Why a separate block instead of list rows: the list is Session-shaped, and
// giving these entries a Session.status would paint them online/green
// (chat-actions.ts:69, agent-row-model.ts default branch). This block never
// opens a chat and never offers start/stop/restart/adopt.
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, spacing } from './theme';
import type { RegisteredAgentRow } from './registered-agents';

export default function RegisteredAgentsSection(props: {
  rows: RegisteredAgentRow[];
  /** False until an authorized read finished — the block renders nothing before that. */
  loaded: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onExplain?: (row: RegisteredAgentRow) => void;
  compact?: boolean;
}) {
  const { rows, loaded, collapsed, onToggle, onExplain, compact } = props;
  if (!loaded || rows.length === 0) return null;
  return (
    <View testID="registered-agents-section">
      <Pressable
        testID="registered-agents-header"
        accessibilityRole="button"
        accessibilityLabel={`已登记未启动 ${rows.length} 个节点，${collapsed ? '已折叠' : '已展开'}`}
        accessibilityState={{ expanded: !collapsed }}
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: spacing.md, backgroundColor: compact ? colors.listBg : colors.bg }}
      >
        <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={12} color={colors.textMuted} />
        <Text selectable={false} numberOfLines={1} style={{ flex: 1, color: colors.textMuted, fontSize: 12 }}>
          已登记 · 未启动
        </Text>
        <Text selectable={false} testID="registered-agents-count" style={{ color: colors.textMuted, fontSize: 12 }}>
          {rows.length}
        </Text>
      </Pressable>
      {collapsed ? null : rows.map(row => (
        <Pressable
          key={row.key}
          testID={`registered-agent-${row.alias}`}
          accessibilityRole="button"
          accessibilityLabel={`${row.alias}，${row.hint}`}
          onPress={() => onExplain?.(row)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md }}
        >
          {/* Grey dot: the node has no session, so it must not look online. */}
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.rest }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text selectable={false} numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13 }}>{row.alias}</Text>
            <Text selectable={false} numberOfLines={1} style={{ color: colors.textMuted, fontSize: 11 }}>
              {row.hint}{row.runtime ? ` · ${row.runtime}` : ''}
            </Text>
          </View>
          <View style={{ borderRadius: radius.mark, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text selectable={false} style={{ color: colors.textMuted, fontSize: 10 }}>只读</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
