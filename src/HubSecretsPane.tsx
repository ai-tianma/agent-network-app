// Hub 服务器管理 → 环境变量/密钥（#1479 / #909）。
//
// 这一页以前是 `HubScopeScreen` 的演示壳：内存里的假数据，`hub-scope-demo.ts`
// 自己写着「Hub 这些写接口还没接通 ... 不发请求」。现在接真实的 GET /api/secrets。
//
// 只显示 **key 名 + 更新时间**：Hub 的 SELECT 里没有 ciphertext/iv/tag，这一页
// 也没有任何地方能拿到值。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { fetchHubSecrets, type HubConfig, type HubSecretsResult } from './api';
import { hubSecretUpdatedAt, hubSecretsView } from './hub-secrets';
import { colors, onThemeChange, radius, spacing, type, weight } from './theme';

const makeStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.xs,
  },
  title: { color: colors.text, fontSize: type.title, fontWeight: weight.strong },
  hint: { color: colors.textSecondary, fontSize: type.small },
  scroll: { flex: 1 },
  scrollInner: { padding: spacing.xl, gap: spacing.sm },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.control,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.card,
  },
  keyName: { color: colors.text, fontSize: type.body, fontWeight: weight.strong },
  meta: { color: colors.textSecondary, fontSize: type.small },
  error: { color: colors.text, fontSize: type.body },
  link: { color: colors.accent, fontSize: type.small },
});

export default function HubSecretsPane({ cfg }: { cfg: HubConfig }) {
  const [result, setResult] = useState<HubSecretsResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [, forceTheme] = useState(0);
  useEffect(() => onThemeChange(() => forceTheme(n => n + 1)), []);
  const styles = makeStyles();

  useEffect(() => {
    let cancel = false;
    setResult(null);
    void fetchHubSecrets(cfg).then(r => { if (!cancel) setResult(r); });
    return () => { cancel = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, reloadKey]);

  const retry = useCallback(() => setReloadKey(k => k + 1), []);
  const view = hubSecretsView(result);

  return (
    <View testID="hub-secrets-pane" style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>环境变量 / 密钥</Text>
        <Text style={styles.hint}>Hub 上这个网络配置的密钥名。**值永远不会显示**，这里只用于确认「配没配」。</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner}>
        {view.kind === 'loading' ? <ActivityIndicator testID="hub-secrets-loading" /> : null}
        {view.kind === 'empty' ? <Text testID="hub-secrets-empty" style={styles.meta}>{view.text}</Text> : null}
        {view.kind === 'error' ? (
          <View style={{ gap: spacing.sm }}>
            <Text testID="hub-secrets-error" style={styles.error}>{view.text}</Text>
            {view.retryable ? (
              <Pressable testID="hub-secrets-retry" onPress={retry}>
                <Text style={styles.link}>重试</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {view.kind === 'list' ? view.rows.map(row => {
          const when = hubSecretUpdatedAt(row.updated_at);
          return (
            <View key={row.key} testID={`hub-secret-${row.key}`} style={styles.row}>
              <Text style={styles.keyName}>{row.key}</Text>
              <Text style={styles.meta}>{when ? `更新于 ${when}` : '更新时间未知'}</Text>
            </View>
          );
        }) : null}
      </ScrollView>
    </View>
  );
}
