import { useEffect, useState } from 'react';
import { Image, Platform, type ImageProps } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { appFetch } from './app-fetch';
import { userAvatarPath } from './user-avatar-upload';
import { acquireUserAvatarWith, fetchUserAvatarBytes, type AvatarResource } from './user-avatar-download';
import { bytesToBase64 } from './voice-wav';
import { validateCustomAvatarUrl } from './lib/avatar-resolve';

let sequence = 0;
async function loadAvatar(url: string, token: string): Promise<AvatarResource> {
  const bytes = await fetchUserAvatarBytes(appFetch, url, token);
  if (Platform.OS === 'web') {
    const uri = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'image/png' }));
    return { uri, dispose: () => URL.revokeObjectURL(uri) };
  }
  if (!FileSystem.cacheDirectory) throw new Error('avatar_temp_directory_unavailable');
  const uri = `${FileSystem.cacheDirectory}user-avatar-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}.png`;
  const dispose = () => { void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}); };
  try {
    await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), { encoding: FileSystem.EncodingType.Base64 });
    return { uri, dispose };
  } catch (error) { dispose(); throw error; }
}

/** Reauthorize on every mount. Temporary pixels are released on unmount, never reused as an ACL cache. */
export default function UserAvatarImage({ value, hubUrl, token, ...props }: Omit<ImageProps, 'source'> & {
  value: string; hubUrl: string; token?: string;
}) {
  const avatar = userAvatarPath(value);
  const key = JSON.stringify([hubUrl, token, value]);
  const [local, setLocal] = useState<{ key: string; uri: string } | null>(null);
  useEffect(() => {
    if (!avatar || !token) return;
    let live = true;
    let release: (() => void) | undefined;
    void acquireUserAvatarWith({ serverUrl: hubUrl, token }, value, loadAvatar).then(lease => {
      release = lease.release;
      if (live) setLocal({ key, uri: lease.uri });
      else release();
    }).catch(() => { /* Keep the caller's fallback, never retry without auth. */ });
    return () => { live = false; release?.(); };
  }, [key, avatar?.path, hubUrl, token, value]);
  if (avatar) return local?.key === key ? <Image {...props} source={{ uri: local.uri }} /> : null;
  // Protected/legacy API routes must not fall through to unauthenticated external image loading.
  if (value.startsWith('/') || /\/api\/(?:files\/|users\/[^/?#]*\/avatar)/i.test(value) || !validateCustomAvatarUrl(value).ok) return null;
  return <Image {...props} source={{ uri: value }} />;
}
