import { useEffect, useRef, useState, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { fetchHostSupervisors, type HubConfig, type HostSupervisorDaemon } from './api';
import { readHubProviderCatalogInfo, saveHubProviderConfig, bindHubProviderConfig } from './hub-provider-management-api';
import { confusableSecretGroups, isInConfusableGroup } from './secret-name-hints';
import { readHubTokenNames } from './hub-token-management-api';
import { EMPTY_HUB_PROVIDER, hubProviderInput, type HubProvider, type HubProviderForm } from './hub-provider-management';
import { providerWriteTransportAllowed, providerHttpWarning } from './daemon-provider-management-api';
import { buttonStyle, buttonTextStyle } from './elevation';
import { useTranslation } from './i18n-react';
import './i18n-hub-provider-management';
import './i18n-provider-management';
import { colors, spacing, radius, type } from './theme';

export default function HubProviderManagementScreen({ cfg, onBack }: { cfg: HubConfig; onBack?: () => void }) {
  // Remount on identity changes: no frame of another network's catalog or key.
  return <HubProviderPage key={JSON.stringify([cfg.serverUrl, cfg.networkId, cfg.token])} cfg={cfg} onBack={onBack} />;
}

function HubProviderPage({ cfg, onBack }: { cfg: HubConfig; onBack?: () => void }) {
  const { t } = useTranslation();
  const wide = useWindowDimensions().width >= 1000;
  const [rows, setRows] = useState<HubProvider[] | null>(null);
  const [daemons, setDaemons] = useState<HostSupervisorDaemon[] | null>(null);
  const [form, setForm] = useState<HubProviderForm>({ ...EMPTY_HUB_PROVIDER });
  const [credentialMode, setCredentialMode] = useState<'key' | 'reference'>('key');
  const [secretReferences, setSecretReferences] = useState(false);
  const [secretNames, setSecretNames] = useState<string[] | null>(null);
  const [chosen, choose] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [receipts, setReceipts] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const reading = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const live = useRef(true);
  const secure = providerWriteTransportAllowed(cfg.serverUrl);
  const provider = rows?.find(p => p.id === chosen);
  const selectedDaemons = daemons?.filter(d => targets.includes(d.daemon_node_id)) ?? [];
  const canBind = !!provider?.enabled && provider.credential_present && provider.protocol === 'openai-responses' && secure;
  const load = async () => {
    if (locked.current) return;
    reading.current?.abort();
    const ctrl = new AbortController(); reading.current = ctrl;
    setLoading(true); setRows(null); setDaemons(null); choose(null); setTargets([]); setConfirm(false); setReceipts({});
    const [catalog, hosts, names] = await Promise.all([readHubProviderCatalogInfo(cfg, ctrl.signal), fetchHostSupervisors(cfg), readHubTokenNames(cfg, ctrl.signal)]);
    if (ctrl.signal.aborted || !live.current) return;
    setRows(catalog?.providers ?? null);
    setSecretReferences(catalog?.secretReferences === true); setSecretNames(names);
    setDaemons(hosts.ok ? hosts.daemons.filter(d => d.online === true && typeof d.daemon_node_id === 'string') : null);
    setLoading(false); setNote(catalog === null ? 'hubProvider.unconfirmed' : '');
  };
  useEffect(() => {
    live.current = true; void load();
    return () => { live.current = false; reading.current?.abort(); controller.current?.abort(); };
  }, []);
  // 只差大小写/下划线的密钥名（TM_PAT 与 TMPAT）在这里是「选错就换了一把钥匙」：标出来。
  const confusableGroups = useMemo(() => confusableSecretGroups(secretNames ?? []), [secretNames]);
  const field = (name: keyof HubProviderForm, value: string) => setForm(f => ({ ...f, [name]: value }));
  const save = async () => {
    if (locked.current || !secure || rows === null || !hubProviderInput(form)
      || (credentialMode === 'reference' && (!secretReferences || !form.secretKeyRef || !secretNames?.includes(form.secretKeyRef)))) return;
    locked.current = true; setBusy(true); setNote('hubProvider.saving');
    const ctrl = new AbortController(); controller.current = ctrl;
    const captured = { ...form }; setForm(f => ({ ...f, key: '' }));
    try {
      const saved = await saveHubProviderConfig(cfg, captured, ctrl.signal);
      if (!live.current || ctrl.signal.aborted) return;
      setNote(saved ? 'hubProvider.saved' : 'hubProvider.unconfirmed');
      if (saved) {
        setRows(old => [...(old ?? []).filter(p => p.id !== saved.id), saved]);
        setForm({ ...saved, models: saved.models.join(', '), key: '', ...(saved.secret_key_ref ? { secretKeyRef: saved.secret_key_ref } : {}) });
        choose(null); setTargets([]); setConfirm(false); setReceipts({});
      }
    } finally { captured.key = ''; locked.current = false; if (live.current) setBusy(false); }
  };
  const distribute = async () => {
    if (locked.current || !provider || !canBind || !confirm || !targets.length) return;
    const selected = targets.filter(id => daemons?.some(d => d.daemon_node_id === id));
    if (!selected.length) return;
    locked.current = true; setBusy(true); setNote('hubProvider.syncing'); setConfirm(false); setReceipts({});
    const ctrl = new AbortController(); controller.current = ctrl;
    try {
      for (let i = 0; i < selected.length && !ctrl.signal.aborted; i += 4) {
        await Promise.all(selected.slice(i, i + 4).map(async id => {
          const ok = await bindHubProviderConfig(cfg, provider, id, ctrl.signal).catch(() => false);
          if (live.current && !ctrl.signal.aborted) setReceipts(old => ({ ...old, [id]: ok }));
        }));
      }
      if (live.current && !ctrl.signal.aborted) setNote('hubProvider.distributionFinished');
    } finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const button = (label: string, onPress: () => void, disabled = false, primary = false, testID?: string) =>
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={[buttonStyle(primary ? 'primary' : 'secondary'), disabled && { opacity: 0.45 }]}>
      <Text style={buttonTextStyle(primary ? 'primary' : 'secondary')}>{t(label)}</Text>
    </Pressable>;
  const heading = (label: string) => <Text style={{ color: colors.text, fontSize: type.title, fontWeight: '600' }}>{t(label)}</Text>;
  const card = { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md };
  return <ScrollView testID="hub-providers-real" style={{ flex: 1, backgroundColor: colors.bg }} keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        {onBack && button('hubProvider.back', onBack)}
        <Text style={{ color: colors.text, fontSize: type.title, fontWeight: '600' }}>{t('hubProvider.title')}</Text>
        {button('providerManagement.refresh', () => void load(), busy, false, 'hub-provider-refresh')}
      </View>
      <Text style={{ color: colors.textSecondary }}>{t('hubProvider.boundary')}</Text>
      {!secure && <Text style={{ color: colors.failed }}>{t('providerManagement.insecure')}</Text>}
      {providerHttpWarning(cfg.serverUrl) && <Text testID="hub-provider-http-advisory" style={{ color: colors.textSecondary }}>{t('providerManagement.httpWarning')}</Text>}
      {!!note && <Text testID="hub-provider-status" accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t(note)}</Text>}
    </View>
    <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: 'stretch', gap: spacing.lg }}>
      <View style={{ flex: 1, gap: spacing.lg }}>
        <View style={card}>
          {heading('hubProvider.catalog')}
          {loading ? <ActivityIndicator color={colors.accent} /> : rows?.length === 0 ? <Text style={{ color: colors.textSecondary }}>{t('hubProvider.empty')}</Text> : null}
          {rows?.map(p => <View key={p.id} testID={`hub-provider-row-${p.id}`} style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.md,
            backgroundColor: chosen === p.id ? colors.tonalBg : colors.inputBg }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{p.label}</Text>
            <Text style={{ color: colors.textSecondary }}>{p.protocol} · {p.models.length} {t('hubProvider.models')}</Text>
            <Text style={{ color: colors.textMuted }}>{t('hubProvider.source', { revision: p.revision })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {button('hubProvider.edit', () => { setCredentialMode(p.secret_key_ref ? 'reference' : 'key'); setForm({ ...p, models: p.models.join(', '), key: '', ...(p.secret_key_ref ? { secretKeyRef: p.secret_key_ref } : {}) }); }, busy)}
              {button('hubProvider.choose', () => { choose(p.id); setTargets([]); setConfirm(false); setReceipts({}); }, busy, false, `hub-provider-choose-${p.id}`)}
            </View>
          </View>)}
        </View>
        <View style={card}>
          {heading('hubProvider.distribute')}
          <Text style={{ color: colors.textSecondary }}>{provider?.label ?? t('hubProvider.choose')}</Text>
          <Text style={{ color: colors.textMuted }}>{t('hubProvider.compatibility')}</Text>
          {daemons === null && !loading ? <Text style={{ color: colors.failed }}>{t('hubProvider.unconfirmed')}</Text> : daemons?.length === 0 ? <Text style={{ color: colors.textSecondary }}>{t('hubProvider.noDaemons')}</Text> : null}
          {!!daemons?.length && button('hubProvider.selectAll', () => { setTargets(daemons.map(d => d.daemon_node_id)); setConfirm(false); }, busy || !canBind)}
          {daemons?.map(d => <View key={d.daemon_node_id} style={{ gap: spacing.xs }}>
            <Pressable testID={`hub-provider-target-${d.daemon_node_id}`} accessibilityRole="checkbox" accessibilityState={{ checked: targets.includes(d.daemon_node_id), disabled: busy || !canBind }} disabled={busy || !canBind}
              onPress={() => { setTargets(old => old.includes(d.daemon_node_id) ? old.filter(id => id !== d.daemon_node_id) : [...old, d.daemon_node_id]); setConfirm(false); }}
              style={{ padding: spacing.md, backgroundColor: targets.includes(d.daemon_node_id) ? colors.tonalBg : colors.inputBg, borderRadius: radius.md }}>
              <Text style={{ color: colors.text }}>{targets.includes(d.daemon_node_id) ? '✓ ' : '○ '}{d.alias}</Text>
            </Pressable>
            {receipts[d.daemon_node_id] !== undefined && <Text testID={`hub-provider-receipt-${d.daemon_node_id}`} style={{ color: receipts[d.daemon_node_id] ? colors.textSecondary : colors.failed }}>{t(receipts[d.daemon_node_id] ? 'hubProvider.synced' : 'hubProvider.notSynced')}</Text>}
          </View>)}
          <Text style={{ color: colors.textSecondary }}>{t('hubProvider.confirmHint')}</Text>
          {confirm && provider && <View testID="hub-provider-distribution-review"
            style={{ padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.inputBg }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{t('hubProvider.reviewTitle')}</Text>
            <Text style={{ color: colors.text }}>{provider.label} · {provider.id}</Text>
            <Text style={{ color: colors.textSecondary }}>{t('hubProvider.reviewRevision', { revision: provider.revision })} · {provider.protocol}</Text>
            <Text style={{ color: colors.textSecondary }}>{t('hubProvider.reviewModels', { models: provider.models.join(', ') })}</Text>
            <Text style={{ color: colors.textSecondary }}>{t('hubProvider.reviewTargets', { count: selectedDaemons.length })}</Text>
            {selectedDaemons.map(d => <Text key={d.daemon_node_id} style={{ color: colors.text }}>{d.alias} · {d.daemon_node_id}</Text>)}
            {button('hubProvider.cancelReview', () => setConfirm(false), busy, false, 'hub-provider-cancel-distribution')}
          </View>}
          {!confirm ? button('hubProvider.distribute', () => setConfirm(true), busy || !canBind || !targets.length, false, 'hub-provider-review-distribution')
            : button('hubProvider.confirm', () => void distribute(), busy || !canBind || !targets.length, true, 'hub-provider-confirm-distribution')}
        </View>
      </View>
      <View style={[card, { flex: 1 }]}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm }}>
          {heading('hubProvider.form')}
          {button('hubProvider.new', () => { setCredentialMode('key'); setForm({ ...EMPTY_HUB_PROVIDER }); }, busy)}
        </View>
        <Text style={{ color: colors.textSecondary }}>{t('hubProvider.credentialSource')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {(['key', 'reference'] as const).map(mode => <Pressable key={mode} testID={`hub-provider-credential-${mode}`}
            accessibilityRole="radio" accessibilityState={{ selected: credentialMode === mode, disabled: busy || (mode === 'reference' && !secretReferences) }}
            disabled={busy || (mode === 'reference' && !secretReferences)}
            onPress={() => { setCredentialMode(mode); setForm(f => ({ ...f, key: '', secretKeyRef: undefined })); }}
            style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: credentialMode === mode ? colors.tonalBg : colors.inputBg }}>
            <Text style={{ color: colors.text }}>{t(mode === 'key' ? 'hubProvider.newKey' : 'hubProvider.savedKey')}</Text>
          </Pressable>)}
        </View>
        {!loading && !secretReferences && <Text style={{ color: colors.textMuted }}>{t('hubProvider.referenceUpgrade')}</Text>}
        {credentialMode === 'reference' && <View style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.textMuted }}>{t('hubProvider.referenceHint')}</Text>
          {secretNames === null ? <Text style={{ color: colors.failed }}>{t('hubProvider.unconfirmed')}</Text> : secretNames.length === 0 ? <Text style={{ color: colors.textMuted }}>{t('hubProvider.noSavedKeys')}</Text> : null}
          {confusableGroups.length ? (
            <Text testID="hub-provider-secret-confusable" style={{ color: colors.blocked, fontSize: 12 }}>
              {t('hubProvider.confusableHint', { names: confusableGroups.map(g => g.join('、')).join(' / ') })}
            </Text>
          ) : null}
          {secretNames?.map(name => <Pressable key={name} testID={`hub-provider-secret-${name}`} accessibilityRole="radio"
            accessibilityState={{ selected: form.secretKeyRef === name, disabled: busy }} disabled={busy}
            onPress={() => setForm(f => ({ ...f, secretKeyRef: name, key: '' }))}
            style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: form.secretKeyRef === name ? colors.tonalBg : colors.inputBg }}>
            <Text style={{ color: colors.text }}>{form.secretKeyRef === name ? '✓ ' : '○ '}{name}</Text>
            {isInConfusableGroup(name, confusableGroups) ? (
              <Text testID={`hub-provider-secret-confusable-${name}`} style={{ color: colors.blocked, fontSize: 12 }}>{t('hubProvider.confusableRow')}</Text>
            ) : null}
          </Pressable>)}
        </View>}
        {(['id', 'label', 'baseUrl', 'models', ...(credentialMode === 'key' ? ['key'] as const : [])] as const).map(name => <View key={name} style={{ gap: spacing.xs }}>
          <Text style={{ color: colors.textSecondary }}>{t(`providerManagement.field.${name}`)}</Text>
          <TextInput testID={`hub-provider-field-${name}`} accessibilityLabel={t(`providerManagement.field.${name}`)} value={form[name]} editable={!busy && !(name === 'id' && form.revision > 0)}
            onChangeText={value => field(name, value)} autoCapitalize="none" autoCorrect={false} secureTextEntry={name === 'key'}
            style={{ color: colors.text, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }} />
        </View>)}
        {providerHttpWarning(form.baseUrl) && <Text testID="hub-provider-endpoint-advisory" style={{ color: colors.textSecondary }}>{t('providerManagement.httpEndpointWarning')}</Text>}
        <Text style={{ color: colors.textSecondary }}>{t('hubProvider.protocol')}</Text>
        <View style={{ gap: spacing.sm }}>
          {(['openai-responses', 'openai-chat-completions', 'anthropic-messages'] as const).map(protocol => <Pressable key={protocol}
            accessibilityRole="radio" accessibilityState={{ selected: form.protocol === protocol, disabled: busy }} disabled={busy} onPress={() => setForm(f => ({ ...f, protocol }))}
            style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: form.protocol === protocol ? colors.tonalBg : colors.inputBg }}>
            <Text style={{ color: form.protocol === protocol ? colors.accent : colors.text }}>{form.protocol === protocol ? '✓ ' : '○ '}{protocol}</Text>
          </Pressable>)}
        </View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: form.enabled, disabled: busy }} disabled={busy} onPress={() => setForm(f => ({ ...f, enabled: !f.enabled }))}>
          <Text style={{ color: colors.text }}>{form.enabled ? '✓ ' : '○ '}{t('providerManagement.enable')}</Text>
        </Pressable>
        {button('hubProvider.save', () => void save(), busy || !secure || rows === null || !hubProviderInput(form)
          || (credentialMode === 'reference' && (!secretReferences || !form.secretKeyRef || !secretNames?.includes(form.secretKeyRef))), true, 'hub-provider-save')}
      </View>
    </View>
  </ScrollView>;
}
