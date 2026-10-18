// Hub 服务器管理 — SKILLS / 令牌 / Provider 演示壳，以及 Runtime 支持。
// 一台主机一台 daemon：Runtime 页读 host_supervisor，多台时只说明，不给选择。
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { useTranslation } from './i18n-react';
import './i18n-backend-pending';
import { fetchHostSupervisors, type HubConfig } from './api';
import { BackendPendingIntegration } from './BackendPendingDemo';
import { type PendingTab } from './backend-pending-ui';
import RuntimeSupportPane from './RuntimeSupportScreen';
import HubProviderManagementScreen from './HubProviderManagementScreen';
import HubSkillsPane from './HubSkillsPane';
import HubTokenManagementScreen from './HubTokenManagementScreen';
import { hostContextFromSupervisorList, type RuntimeHostContext } from './runtime-support';
import { colors, onThemeChange, spacing, type, weight } from './theme';

const TITLE_KEY: Record<PendingTab, string> = {
  skills: 'server.pendingTitle.skills',
  tokens: 'server.pendingTitle.tokens',
  provider: 'server.pendingTitle.provider',
  runtime: 'server.pendingTitle.runtime',
};

function HubRuntimeSupport({ cfg }: { cfg: HubConfig }) {
  const [host, setHost] = useState<RuntimeHostContext>({ kind: 'pending' });
  const serverUrl = cfg.serverUrl;
  const token = cfg.token;
  const networkId = cfg.networkId;
  useEffect(() => {
    let cancel = false;
    setHost({ kind: 'pending' });
    void fetchHostSupervisors({ serverUrl, token, networkId }).then(result => {
      if (!cancel) setHost(hostContextFromSupervisorList(result));
    });
    return () => { cancel = true; };
  }, [serverUrl, token, networkId]);
  return <RuntimeSupportPane layer="hub" host={host} cfg={host.kind === 'daemon' ? cfg : undefined} />;
}

export default function HubPendingScreen({ tab, cfg }: { tab: PendingTab; cfg: HubConfig }) {
  const { t } = useTranslation();
  if (tab === 'skills') return <HubSkillsPane cfg={cfg} />;
  if (tab === 'provider') return <HubProviderManagementScreen cfg={cfg} />;
  if (tab === 'tokens') return <HubTokenManagementScreen cfg={cfg} />;
  if (tab === 'runtime') {
    return (
      <View testID="hub-runtime-support" style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>{t(TITLE_KEY.runtime)}</Text>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner}>
          <HubRuntimeSupport cfg={cfg} />
        </ScrollView>
      </View>
    );
  }
  return (
    <View testID="hub-pending-screen" style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{t(TITLE_KEY[tab])}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner} keyboardShouldPersistTaps="handled">
        <BackendPendingIntegration layer="hub" tab={tab} showTabs={false} testIDPrefix="hub-pending" />
      </ScrollView>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: spacing.xs,
    },
    title: { color: colors.text, fontSize: type.title, fontWeight: weight.strong },
    scroll: { flex: 1 },
    scrollInner: { padding: spacing.xl, paddingBottom: spacing.xl * 2, width: '100%' },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
