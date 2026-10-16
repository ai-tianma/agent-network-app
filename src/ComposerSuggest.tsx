import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "./ui-text";
import { colors, onThemeChange, radius, spacing } from "./theme";

export type SuggestRow = {
  id: string;
  group: string;
  label: string;
  description: string;
};

export function ComposerSuggest(props: {
  rows: SuggestRow[];
  active: number;
  empty: string;
  onPick: (index: number) => void;
}) {
  const { rows, active, empty, onPick } = props;
  return (
    <View style={styles.box} testID="composer-suggest">
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
        {rows.length === 0 ? <Text style={styles.empty}>{empty}</Text> : rows.map((row, index) => {
          const showGroup = index === 0 || rows[index - 1]!.group !== row.group;
          return (
            <View key={row.id}>
              {showGroup ? <Text style={styles.group}>{row.group}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={row.label}
                onPress={() => onPick(index)}
                style={[styles.row, index === active && styles.rowActive]}
              >
                <Text style={styles.label} numberOfLines={1}>{row.label}</Text>
                <Text style={styles.desc} numberOfLines={1}>{row.description}</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  box: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    maxHeight: 240,
    borderRadius: radius.surface,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  scroll: { maxHeight: 240 },
  group: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rowActive: { backgroundColor: "rgba(127,127,127,0.12)" },
  label: { color: colors.text, fontSize: 15 },
  desc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  empty: { color: colors.textMuted, padding: spacing.md },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
