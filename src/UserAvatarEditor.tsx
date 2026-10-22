import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import type { HubConfig } from './api';
import { fetchAuthMe, forgetAuthMeFor, HubRequestError, putUserAvatar } from './user-admin-api';
import { POOL_FILENAMES, poolFileNameForAlias, validateCustomAvatarUrl } from './lib/avatar-resolve';
import { sourceForFile } from './lib/avatars';
import { SettingsButton, SettingsCardContent, SettingsGroup } from './settings-kit';
import { colors, avatarRadius, radius } from './theme';
import { useTranslation } from './i18n-react';
import { t } from './i18n';
import './i18n-user-avatar';
import { pickUserAvatar, prepareUserAvatar, uploadLocalUserAvatar } from './user-avatar-local';
import { uploadUserAvatarWith, UserAvatarFileError, UserAvatarUnsupportedError, userAvatarPath } from './user-avatar-upload';
import UserAvatarImage from './UserAvatarImage';

// Remount on account/Hub/token change. An old request can finish for its original
// account, but its disposed editor must never update the new account's UI.
export default function UserAvatarEditor({ cfg }: { cfg: HubConfig }) {
  return <Editor key={JSON.stringify([cfg.serverUrl, cfg.profileId, cfg.token])} cfg={cfg} />;
}

function Editor({ cfg }: { cfg: HubConfig }) {
  useTranslation();
  const live = useRef(true);
  const busyRef = useRef(false);
  const [user, setUser] = useState<{ id: string; avatar: string | null } | null>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('userAvatar.busy');
  const [message, setMessage] = useState('');
  const [imageError, setImageError] = useState(false);
  const load = async () => {
    setLoading(true); setMessage('');
    try {
      forgetAuthMeFor(cfg);
      const me = await fetchAuthMe(cfg);
      if (!live.current) return;
      if (!me.user?.user_id || !Object.hasOwn(me.user, 'avatar_url')) {
        setMessage('userAvatar.unsupported'); return;
      }
      setUser({ id: me.user.user_id, avatar: me.user.avatar_url ?? null });
    } catch { if (live.current) setMessage('userAvatar.failed'); }
    finally { if (live.current) setLoading(false); }
  };
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; }; }, []);
  useEffect(() => { setImageError(false); }, [user?.avatar]);
  const apply = async (value: string | null) => {
    if (!user || busyRef.current) return;
    busyRef.current = true; setBusy(true); setStage('userAvatar.busy'); setMessage('');
    try {
      const avatar = await putUserAvatar(cfg, user.id, value);
      if (live.current) { setUser({ ...user, avatar }); setMessage('userAvatar.saved'); }
    } catch (e) {
      if (live.current) setMessage(e instanceof HubRequestError && [404, 405].includes(e.status) ? 'userAvatar.unsupported' : 'userAvatar.failed');
    } finally { busyRef.current = false; if (live.current) setBusy(false); }
  };
  const upload = async () => {
    if (!user || busyRef.current) return;
    busyRef.current = true; setBusy(true); setStage('userAvatar.selecting'); setMessage('');
    try {
      const avatar = await uploadUserAvatarWith(cfg, user.id, {
        pick: pickUserAvatar, prepare: prepareUserAvatar,
        upload: uploadLocalUserAvatar, active: () => live.current,
        stage: value => { if (live.current) setStage(`userAvatar.${value}`); },
      });
      if (live.current && avatar !== undefined) { setUser({ ...user, avatar }); setMessage('userAvatar.saved'); }
    } catch (e) {
      if (live.current) setMessage(e instanceof UserAvatarFileError ? `userAvatar.file.${e.key}`
        : e instanceof UserAvatarUnsupportedError ? 'userAvatar.uploadUnsupported' : 'userAvatar.failed');
    } finally { busyRef.current = false; if (live.current) setBusy(false); }
  };
  const avatar = user?.avatar;
  // Bundled files, dedicated protected avatar paths, or validated public URLs; never node alias maps.
  const source = avatar?.startsWith('/avatars/') ? sourceForFile(avatar.slice(9))
    : avatar && (userAvatarPath(avatar) || validateCustomAvatarUrl(avatar).ok) ? { uri: avatar }
    : user ? sourceForFile(poolFileNameForAlias(user.id)) : null;
  return <SettingsGroup title={t('userAvatar.title')} testID="user-avatar-editor">
    <SettingsCardContent>
      <Text testID="user-avatar-hint" style={{ color: colors.text, lineHeight: 20 }}>{t('userAvatar.hint')}</Text>
      <View style={{ width: 56, height: 56, marginVertical: 12, justifyContent: 'center' }}>
        <Text style={{ color: colors.text }} testID="user-avatar-fallback">{cfg.username || '·'}</Text>
        {source && !imageError ? avatar && !avatar.startsWith('/avatars/') ? <UserAvatarImage key={avatar} value={avatar} hubUrl={cfg.serverUrl} token={cfg.token} testID="user-avatar-preview" onError={() => setImageError(true)} style={{ position: 'absolute', width: 56, height: 56, borderRadius: avatarRadius(56) }} /> : <Image testID="user-avatar-preview" source={source} onError={() => setImageError(true)} style={{ position: 'absolute', width: 56, height: 56, borderRadius: avatarRadius(56) }} /> : null}
      </View>
      {loading ? <Text style={{ color: colors.textSecondary }}>{t('userAvatar.loading')}</Text> : null}
      {user ? <>
        <SettingsButton testID="user-avatar-upload" label={t('userAvatar.upload')} disabled={busy || loading} onPress={() => void upload()} />
        <Text testID="user-avatar-upload-hint" style={{ color: colors.textMuted, marginVertical: 8 }}>{t('userAvatar.uploadHint')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {POOL_FILENAMES.map((file, i) => <Pressable key={file} accessibilityRole="button" accessibilityLabel={t('userAvatar.pick', { n: i + 1 })} testID={`user-avatar-pick-${i + 1}`} disabled={busy || loading} onPress={() => void apply(`/avatars/${file}`)} style={{ padding: 6, opacity: busy ? 0.5 : 1 }}>
            <Image source={sourceForFile(file)!} style={{ width: 36, height: 36, borderRadius: avatarRadius(36) }} />
          </Pressable>)}
        </View>
        <Text style={{ color: colors.textMuted, marginVertical: 12 }}>{t('userAvatar.remote')}</Text>
        <TextInput testID="user-avatar-url" accessibilityLabel={t('userAvatar.url')} placeholder={t('userAvatar.url')} placeholderTextColor={colors.textMuted} value={url} onChangeText={setUrl} editable={!busy && !loading} autoCapitalize="none" style={{ color: colors.text, backgroundColor: colors.inputBg, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control }} />
        <SettingsButton testID="user-avatar-save" label={t('userAvatar.save')} variant={busy || loading || !url.trim() ? 'plain' : 'primary'} disabled={busy || loading || !url.trim()} onPress={() => {
          const v = validateCustomAvatarUrl(url);
          if (!v.ok) setMessage('userAvatar.invalid'); else void apply(v.url);
        }} />
        <SettingsButton testID="user-avatar-reset" variant="plain" label={t('userAvatar.reset')} disabled={busy || loading} onPress={() => void apply(null)} />
      </> : !loading ? <SettingsButton label={t('userAvatar.retry')} testID="user-avatar-retry" onPress={() => void load()} /> : null}
      {busy ? <Text testID="user-avatar-progress" accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t(stage)}</Text> : null}
      {message ? <Text style={{ color: colors.text, marginTop: 12, lineHeight: 20 }} testID="user-avatar-message" accessibilityLiveRegion="polite">{t(message)}</Text> : null}
    </SettingsCardContent>
  </SettingsGroup>;
}
