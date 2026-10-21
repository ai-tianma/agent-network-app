import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { useTranslation } from './i18n-react';
import './i18n-provider';
import {
  catalogIsVisible,
  displayDaemonProviders,
  type DaemonProviderSource,
  type PublicProvider,
  type TaggedProvider,
} from './daemon-runtime-providers';
import { colors, spacing } from './theme';

function ModelLine({ model, onSelect }: { model: string; onSelect?: (model: string) => void }) {
  if (!onSelect) return <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{model}</Text>;
  return (
    <Pressable testID={`daemon-provider-model-${model}`} accessibilityRole="button" accessibilityLabel={`选择模型 ${model}`} onPress={() => onSelect(model)} style={{ minHeight: 32, justifyContent: 'center' }}>
      <Text style={{ color: colors.accent, fontSize: 13 }}>{model}</Text>
    </Pressable>
  );
}

function ProviderBlock({ provider, onSelectModel }: { provider: PublicProvider; onSelectModel?: (model: string) => void }) {
  return (
    <View style={{ gap: 2 }}>
      {provider.id ? <Text style={{ color: colors.text, fontSize: 13 }}>{provider.id}</Text> : null}
      {provider.baseUrl ? <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{provider.baseUrl}</Text> : null}
      {provider.models.map(model => (
        <ModelLine key={model} model={model} onSelect={onSelectModel} />
      ))}
    </View>
  );
}

/** 建节点(daemon)时:这个 runtime 在这台机器上上报了哪些供应商 / 模型。 */
export default function DaemonRuntimeProviders({
  daemon,
  rows,
  read,
  runtimeId,
  opencodeGeneration,
  onSelectModel,
}: {
  daemon: DaemonProviderSource;
  rows: readonly TaggedProvider[];
  read: 'pending' | 'ok' | 'unsupported' | 'error';
  runtimeId: string;
  opencodeGeneration?: 'v1' | 'v2';
  /** 点一个已上报的模型，写进创建表单。不传则只展示。 */
  onSelectModel?: (model: string) => void;
}) {
  const { t } = useTranslation();
  const display = displayDaemonProviders({ daemon, rows, read, runtimeId, opencodeGeneration });
  if (!catalogIsVisible(display, runtimeId, opencodeGeneration)) return null;
  const muted = { color: colors.textSecondary, fontSize: 12, lineHeight: 18 };
  if (display.kind === 'pending') {
    return (
      <View testID="daemon-runtime-providers" style={{ marginTop: spacing.md }}>
        <Text testID="daemon-runtime-providers-pending" style={muted}>{t('daemonProviders.pending')}</Text>
      </View>
    );
  }
  let notice: string | null = null;
  if (display.kind === 'upgrade' || display.kind === 'empty') {
    const tone = display.tone;
    if (display.kind === 'upgrade') {
      notice = tone === 'codex' ? t('daemonProviders.upgradeCodex') : tone === 'opencode' ? t('daemonProviders.upgradeOpencode') : t('daemonProviders.upgrade');
    } else {
      notice = tone === 'codex' ? t('daemonProviders.emptyCodex') : tone === 'opencode' ? t('daemonProviders.emptyOpencode') : t('daemonProviders.empty');
    }
  } else if (display.kind === 'read-error') {
    notice = t('daemonProviders.readError');
  } else if (display.kind === 'unlisted') {
    notice = t('daemonProviders.unlisted');
  }
  return (
    <View testID="daemon-runtime-providers" style={{ gap: spacing.sm, marginTop: spacing.md }}>
      {display.kind === 'codex' ? (
        <>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t('daemonProviders.codexTitle')}</Text>
          <Text style={muted}>{t('daemonProviders.codexHint')}</Text>
          <View testID="daemon-runtime-providers-codex" style={{ gap: spacing.sm }}>
            {display.providers.map(provider => (
              <ProviderBlock key={`${provider.id}:${provider.baseUrl ?? ''}`} provider={provider} onSelectModel={onSelectModel} />
            ))}
          </View>
        </>
      ) : null}
      {display.kind === 'opencode' ? (
        <>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t('daemonProviders.opencodeTitle')}</Text>
          <Text style={muted}>{t('daemonProviders.opencodeHint')}</Text>
          <View testID="daemon-runtime-providers-opencode" style={{ gap: 2 }}>
            {display.models.map(model => (
              <ModelLine key={model} model={model} onSelect={onSelectModel} />
            ))}
          </View>
        </>
      ) : null}
      {display.kind === 'listed' ? (
        <>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t('daemonProviders.listedTitle')}</Text>
          <View testID="daemon-runtime-providers-listed" style={{ gap: spacing.sm }}>
            {display.providers.map(provider => (
              <View key={`${provider.id}:${provider.models.join(',')}`} style={{ gap: 2 }}>
                {provider.id ? <Text style={{ color: colors.text, fontSize: 13 }}>{provider.id}</Text> : null}
                {provider.models.map(model => (
                  <ModelLine key={model} model={model} onSelect={onSelectModel} />
                ))}
              </View>
            ))}
          </View>
        </>
      ) : null}
      {notice ? <Text testID={`daemon-runtime-providers-${display.kind}`} style={muted}>{notice}</Text> : null}
    </View>
  );
}
