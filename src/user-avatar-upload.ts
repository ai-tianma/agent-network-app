import type { HubConfig } from './api';
import type { PickedImage } from './attach';
import { forgetAuthMeFor, HubRequestError } from './user-admin-api';

export const MAX_USER_AVATAR_BYTES = 8 * 1024 * 1024;
export const USER_AVATAR_EDGE = 512;
export const USER_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class UserAvatarFileError extends Error {
  constructor(readonly key: 'type' | 'size' | 'decode') { super(key); }
}

export function validateUserAvatarFile(image: PickedImage): void {
  if (!USER_AVATAR_TYPES.includes(image.mimeType)) throw new UserAvatarFileError('type');
  const size = image.webFile?.size ?? image.fileSize;
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0 || size > MAX_USER_AVATAR_BYTES) throw new UserAvatarFileError('size');
}

export class UserAvatarUnsupportedError extends HubRequestError {
  constructor(status: number) { super('avatar_upload_unsupported', status); }
}

/** Deliberately relative-only: no other origin, query, encoding or traversal can receive auth. */
export function userAvatarPath(value: unknown): { path: string; userId: string; version: string } | null {
  if (typeof value !== 'string') return null;
  const match = /^\/api\/users\/([A-Za-z0-9_-]{1,128})\/avatar\/([A-Za-z0-9_-]{1,128})\.png$/.exec(value);
  return match && match[0] === value ? { path: value, userId: match[1], version: match[2] } : null;
}

export async function postUserAvatarWith(cfg: HubConfig, userId: string, image: PickedImage,
  send: (url: string, image: PickedImage, token: string) => Promise<{ status: number; body: string }>): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId) || userId.trim() !== userId) throw new HubRequestError('avatar_identity_missing', 0);
  validateUserAvatarFile(image);
  if (image.mimeType !== 'image/png') throw new UserAvatarFileError('type');
  const response = await send(`${cfg.serverUrl.replace(/\/+$/, '')}/api/auth/me/avatar/upload`, image, cfg.token);
  if ([404, 405].includes(response.status)) throw new UserAvatarUnsupportedError(response.status);
  if (response.status < 200 || response.status >= 300) throw new HubRequestError('avatar_upload_failed', response.status);
  let receipt: any;
  try { receipt = JSON.parse(response.body); } catch { throw new HubRequestError('avatar_receipt_mismatch', 0); }
  if (receipt?.ok !== true || receipt.user_id !== userId || userAvatarPath(receipt.avatar_url)?.userId !== userId) {
    throw new HubRequestError('avatar_receipt_mismatch', 0);
  }
  forgetAuthMeFor(cfg);
  return receipt.avatar_url;
}

export async function uploadUserAvatarWith(cfg: HubConfig, userId: string, deps: {
  pick: () => Promise<PickedImage | null>;
  prepare: (image: PickedImage) => Promise<PickedImage>;
  upload: (cfg: HubConfig, userId: string, image: PickedImage) => Promise<string>;
  active: () => boolean;
  stage: (stage: 'preparing' | 'uploading') => void;
}): Promise<string | undefined> {
  const image = await deps.pick();
  if (!image || !deps.active()) return undefined;
  validateUserAvatarFile(image);
  deps.stage('preparing');
  const prepared = await deps.prepare(image);
  validateUserAvatarFile(prepared);
  if (!deps.active()) return undefined;
  deps.stage('uploading');
  const avatar = await deps.upload(cfg, userId, prepared);
  if (!deps.active()) return undefined;
  if (userAvatarPath(avatar)?.userId !== userId) throw new HubRequestError('avatar_receipt_mismatch', 0);
  return avatar;
}
