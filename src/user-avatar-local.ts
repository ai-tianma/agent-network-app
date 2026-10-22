import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import type { PickedImage } from './attach';
import { postUserAvatarWith, USER_AVATAR_EDGE, USER_AVATAR_TYPES, UserAvatarFileError } from './user-avatar-upload';
import type { HubConfig } from './api';
import { appFetch } from './app-fetch';

export function uploadLocalUserAvatar(cfg: HubConfig, userId: string, image: PickedImage): Promise<string> {
  return postUserAvatarWith(cfg, userId, image, async (url, prepared, token) => {
    const ctrl = new AbortController();
    const task = Platform.OS !== 'web' ? FileSystem.createUploadTask(url, prepared.uri, {
      httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file', mimeType: 'image/png', parameters: {},
      headers: { Authorization: `Bearer ${token}` },
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
    }) : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = async () => {
        if (task) {
          const response = await task.uploadAsync();
          if (!response) throw new Error('avatar_upload_cancelled');
          return { status: response.status, body: response.body };
        }
        if (!prepared.webFile) throw new Error('avatar_browser_file_missing');
        const body = new FormData();
        body.append('file', prepared.webFile, 'avatar.png');
        const response = await appFetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body, signal: ctrl.signal });
        return { status: response.status, body: await response.text() };
      };
      return await Promise.race([request(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctrl.abort();
          if (task) void task.cancelAsync().catch(() => {});
          reject(new Error('avatar_upload_timeout'));
        }, 120_000);
      })]);
    } finally {
      clearTimeout(timer);
      if (task) await FileSystem.deleteAsync(prepared.uri, { idempotent: true }).catch(() => {});
    }
  });
}

export async function pickUserAvatar(): Promise<PickedImage | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: USER_AVATAR_TYPES, multiple: false, copyToCacheDirectory: true, base64: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  let size = asset.file?.size ?? asset.size;
  if (Platform.OS !== 'web' && size === undefined) {
    const info = await FileSystem.getInfoAsync(asset.uri);
    if (info.exists) size = info.size;
  }
  const mimeType = asset.mimeType || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[asset.name.split('.').pop()?.toLowerCase() ?? ''] || '';
  // Expo allocates this URL; web processing uses the File bytes, not its URI.
  if (Platform.OS === 'web' && asset.uri.startsWith('blob:')) URL.revokeObjectURL(asset.uri);
  return { uri: asset.uri, fileName: asset.name, mimeType, fileSize: size, webFile: asset.file };
}

/** Decode and re-encode rather than trusting a filename/MIME declaration. Never upload the original on decode failure. */
export async function prepareUserAvatar(image: PickedImage): Promise<PickedImage> {
  const dimensions = (width: number, height: number) => {
    if (width <= 0 || height <= 0 || width * height > 40_000_000) throw new UserAvatarFileError('decode');
    const scale = Math.min(1, USER_AVATAR_EDGE / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  };
  try {
    if (Platform.OS === 'web') {
      // Keep local Blob reads on the browser transport, never Tauri's HTTP transport.
      if (!image.webFile || typeof document === 'undefined') throw new Error('missing_browser_file');
      const bitmap = await createImageBitmap(image.webFile, { imageOrientation: 'from-image' });
      try {
        const { width, height } = dimensions(bitmap.width, bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas_unavailable');
        ctx.drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('encode_failed');
        return { uri: image.uri, fileName: 'avatar.png', mimeType: 'image/png', fileSize: blob.size, webFile: blob, width, height };
      } finally { bitmap.close(); }
    }
    const uri = image.uri;
    const decode = ImageManipulator.manipulate(uri);
    let size: { width: number; height: number };
    try {
      const ref = await decode.renderAsync();
      try { size = dimensions(ref.width, ref.height); } finally { ref.release(); }
    } finally { decode.release(); }
    // URI only: passing ImageRef into manipulate crashes the iOS native bridge.
    const context = ImageManipulator.manipulate(uri).resize(size);
    try {
      const ref = await context.renderAsync();
      try {
        const saved = await ref.saveAsync({ format: SaveFormat.PNG });
        const info = await FileSystem.getInfoAsync(saved.uri);
        return { uri: saved.uri, fileName: 'avatar.png', mimeType: 'image/png', fileSize: info.exists ? info.size : undefined, ...size };
      } finally { ref.release(); }
    } finally { context.release(); }
  } catch { throw new UserAvatarFileError('decode'); }
}
