import { POOL_FILENAMES, poolFileNameForAlias, validateCustomAvatarUrl } from './lib/avatar-resolve';
import { userAvatarPath } from './user-avatar-upload';

/** Human records are supplied by the selected Hub. Never look up node aliases
 * or local node overrides, even when the human and node have the same name. */
export function humanAvatarPlan(userId: string, value: unknown): { file: string } | { uri: string } | null {
  if (!userId) return null;
  if (typeof value === 'string') {
    const url = value.trim();
    const file = url.startsWith('/avatars/') ? url.slice(9) : '';
    if (POOL_FILENAMES.includes(file)) return { file };
    if (userAvatarPath(url)?.userId === userId) return { uri: url };
    const valid = validateCustomAvatarUrl(url);
    if (valid.ok) return { uri: valid.url };
  }
  return { file: poolFileNameForAlias(userId) };
}
