import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import type { HubConfig } from './api';
import { Text, TextInput } from './ui-text';
import { readHubTokenNames, saveHubToken } from './hub-token-management-api';
import { hubTokenInput } from './hub-token-management';
import { confusableSecretGroups, confusableSecretName, isInConfusableGroup } from './secret-name-hints';
import { providerWriteTransportAllowed, providerHttpWarning } from './daemon-provider-management-api';
import { buttonStyle, buttonTextStyle } from './elevation';
import { useTranslation } from './i18n-react';
import './i18n-hub-token-management';
import './i18n-provider-management';
import { colors, spacing, radius, type } from './theme';

export default function HubTokenManagementScreen({ cfg }: { cfg: HubConfig }) {
  return <HubTokenPage key={JSON.stringify([cfg.serverUrl, cfg.networkId, cfg.token])} cfg={cfg} />;
}
function HubTokenPage({ cfg }: { cfg: HubConfig }) {
  const { t } = useTranslation(); const wide = useWindowDimensions().width >= 1000;
  const [names, setNames] = useState<string[] | null>(null);
  const [key, setKey] = useState(''); const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const current = useRef<AbortController | null>(null); const locked = useRef(false); const live = useRef(true);
  const secure = providerWriteTransportAllowed(cfg.serverUrl);
  // 只差大小写/下划线的名字（TM_PAT 与 TMPAT）会让人以为在加一个新钥匙：标出来，让人自己确认。
  const confusableGroups = useMemo(() => confusableSecretGroups(names ?? []), [names]);
  const refresh = async () => {
    if (locked.current) return;
    current.current?.abort(); const ctrl = new AbortController(); current.current = ctrl;
    setLoading(true); setNames(null); setNote('');
    const rows = await readHubTokenNames(cfg, ctrl.signal);
    if (!live.current || ctrl.signal.aborted) return;
    setNames(rows); setLoading(false); if (rows === null) setNote('hubToken.failed');
  };
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; current.current?.abort(); }; }, []);
  const save = async () => {
    if (locked.current || !secure || names === null || !hubTokenInput(key, value)) return;
    current.current?.abort(); const ctrl = new AbortController(); current.current = ctrl;
    locked.current = true; setBusy(true); setNote('hubToken.saving');
    let captured = value; setValue('');
    try {
      const rows = await saveHubToken(cfg, key, captured, ctrl.signal);
      if (!live.current || ctrl.signal.aborted) return;
      setNote(rows ? 'hubToken.saved' : 'hubToken.failed'); if (rows) setNames(rows);
    } finally { captured = ''; locked.current = false; if (live.current) setBusy(false); }
  };
  const button = (label: string, press: () => void, disabled = false, primary = false, testID?: string) =>
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={press}
      style={[buttonStyle(primary ? 'primary' : 'secondary'), disabled && { opacity: .45 }]}>
      <Text style={buttonTextStyle(primary ? 'primary' : 'secondary')}>{t(label)}</Text>
    </Pressable>;
  const card = { flex: 1, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md };
  return <ScrollView testID="hub-tokens-real" style={{ flex: 1, backgroundColor: colors.bg }} keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
      <Text style={{ color: colors.text, fontSize: type.title, fontWeight: '600' }}>{t('hubToken.title')}</Text>
      {button('hubToken.refresh', () => void refresh(), busy, false, 'hub-token-refresh')}
    </View>
    <Text style={{ color: colors.textSecondary }}>{t('hubToken.boundary')}</Text>
    {!secure && <Text style={{ color: colors.failed }}>{t('providerManagement.insecure')}</Text>}
    {providerHttpWarning(cfg.serverUrl) && <Text testID="hub-token-http-advisory" style={{ color: colors.textSecondary }}>{t('providerManagement.httpWarning')}</Text>}
    {!!note && <Text testID="hub-token-status" accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t(note)}</Text>}
    <View style={{ flexDirection: wide ? 'row' : 'column', gap: spacing.lg }}>
      <View style={card}>
        <Text style={{ color: colors.text, fontSize: type.title }}>{t('hubToken.catalog')}</Text>
        {loading ? <ActivityIndicator color={colors.accent} /> : names?.length === 0 ? <Text style={{ color: colors.textSecondary }}>{t('hubToken.empty')}</Text> : null}
        {names?.map(name => <View key={name} testID={`hub-token-row-${name}`} style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.inputBg, gap: spacing.sm }}>
          <Text style={{ color: colors.text }}>{name}</Text>
          {isInConfusableGroup(name, confusableGroups) ? (
            <Text testID={`hub-token-confusable-row-${name}`} style={{ color: colors.blocked, fontSize: 12 }}>{t('hubToken.confusableRow')}</Text>
          ) : null}
          {button('hubToken.replace', () => { setKey(name); setValue(''); }, busy, false, `hub-token-replace-${name}`)}
        </View>)}
        <Text style={{ color: colors.textMuted }}>{t('hubToken.noDelete')}</Text>
      </View>
      <View style={card}>
        <Text style={{ color: colors.text, fontSize: type.title }}>{t('hubToken.form')}</Text>
        {button('hubToken.new', () => { setKey(''); setValue(''); }, busy)}
        <Text style={{ color: colors.textSecondary }}>{t('hubToken.name')}</Text>
        <TextInput testID="hub-token-name" value={key} onChangeText={setKey} editable={!busy} autoCapitalize="none" autoCorrect={false}
          style={{ color: colors.text, backgroundColor: colors.inputBg, borderRadius: radius.md, padding: spacing.md }} />
        {confusableSecretName(key, names ?? []) ? (
          <Text testID="hub-token-confusable-hint" style={{ color: colors.blocked, fontSize: 12 }}>{t('hubToken.confusableHint', { name: confusableSecretName(key, names ?? []) ?? '' })}</Text>
        ) : null}
        <Text style={{ color: colors.textSecondary }}>{t('hubToken.value')}</Text>
        <TextInput testID="hub-token-value" value={value} onChangeText={setValue} editable={!busy} secureTextEntry autoCapitalize="none" autoCorrect={false}
          style={{ color: colors.text, backgroundColor: colors.inputBg, borderRadius: radius.md, padding: spacing.md }} />
        {button('hubToken.save', () => void save(), busy || !secure || names === null || !hubTokenInput(key, value), true, 'hub-token-save')}
        <Text style={{ color: colors.textMuted }}>{t('hubToken.usage')}</Text>
      </View>
    </View>
  </ScrollView>;
}
