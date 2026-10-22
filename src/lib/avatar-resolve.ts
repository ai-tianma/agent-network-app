/**
 * Pure avatar-resolution logic (NO react-native / no asset require()s) so the
 * resolution chain is node-unit-testable. `avatars.ts` owns the bundled asset
 * handles (require('.webp')) and materialises the plan this module returns.
 *
 * Split rationale (2026-08-01, R1 avatar 接线): avatars.ts require()s .webp at
 * module scope — those only resolve under Metro, so importing it in a node test
 * throws. Keeping the decision here (strings only) lets the bidirectional test
 * run in plain node while the render module stays a thin materialiser.
 *
 * Resolution order mirrors the web dashboard (app/lib/avatars.ts @ origin/main):
 *   1. hub avatar_url (node-backed aliases only) — cross-device truth
 *   2. named override
 *   3. djb2 pool pick
 */

// MUST equal AVATAR_POOL.length in avatars.ts — asserted there at module load.
export const POOL_SIZE = 20;

// Named overrides: alias → bundled filename. Mirror manifest.json non-`_pool`.
export const NAMED_ALIAS_TO_FILE: Record<string, string> = {
  '通信N站马': 'intern_avatar.png',
};

export const POOL_FILENAMES: string[] = Array.from(
  { length: POOL_SIZE },
  (_, i) => `avatar-${String(i + 1).padStart(2, '0')}.webp`,
);

// Relative avatar_url values the pool picker writes (the exact form the hub #550
// validator accepts + the web stores): '/avatars/avatar-NN.webp'.
export const POOL_RELATIVE_PATHS: string[] = POOL_FILENAMES.map((f) => `/avatars/${f}`);

// Filenames the App actually bundles — a relative avatar_url must map to one of
// these to render (else it falls through, avoiding a broken relative reference).
export const KNOWN_BUNDLED_FILES: Set<string> = new Set([
  ...POOL_FILENAMES,
  ...Object.values(NAMED_ALIAS_TO_FILE),
]);

/** Stable per-alias pool index. djb2 over UTF-16 code units — byte-matches the
 *  web dashboard's poolPick (verified). NOT the h*31 color-palette hash. */
export function poolIndexForAlias(alias: string): number {
  if (!alias) return 0;
  let h = 5381;
  for (let i = 0; i < alias.length; i++) h = ((h << 5) + h + alias.charCodeAt(i)) >>> 0;
  return h % POOL_SIZE;
}

export function poolFileNameForAlias(alias: string): string {
  return `avatar-${String(poolIndexForAlias(alias) + 1).padStart(2, '0')}.webp`;
}

function basenameOf(url: string): string {
  const noHashQuery = url.split(/[?#]/)[0];
  const parts = noHashQuery.split('/');
  return parts[parts.length - 1] || '';
}

/** Hub state, passed in explicitly so this stays pure. */
export interface HubAvatarState {
  nodeAliases: Set<string>; // aliases that HAVE a nodes row (node-backed)
  map: Record<string, string>; // alias → non-empty avatar_url
}

/** Resolve a URL string (hub value or local echo) to a plan tag. Empty → 'none'.
 *   absolute http(s) → 'remote:<uri>' ; relative bundled → 'file:<name>' ;
 *   unresolvable → 'none'. */
function resolveUrlToPlan(url: string): string {
  const u = url.trim();
  if (!u) return 'none';
  if (/^https?:\/\//i.test(u)) return `remote:${u}`;
  const f = basenameOf(u);
  return KNOWN_BUNDLED_FILES.has(f) ? `file:${f}` : 'none';
}

/** Designed default chain: named override → djb2 pool. Never consults local. */
function designDefault(alias: string): string {
  const namedFile = NAMED_ALIAS_TO_FILE[alias];
  if (namedFile) return `file:${namedFile}`;
  return `file:${poolFileNameForAlias(alias)}`;
}

/**
 * Decide an alias's avatar as a materialiser-agnostic tag ('remote:'/'file:'/'none').
 *
 * Semantic fork (identical to web #75):
 *   - Node-backed (alias ∈ nodeAliases): hub is the WHOLE truth. A set url wins
 *     (set-but-unresolvable → 'none' = pill, matching web 404). Cleared (in
 *     nodeAliases, no map entry) → designed default (named → pool), **SKIPPING
 *     the local layer** — 🔴 clear-consistency: a stale local echo on THIS device
 *     must not resurrect the old picture once the hub value is cleared elsewhere.
 *     This branch never reads `local`.
 *   - Session-only (alias ∉ nodeAliases): local echo is the ONLY personalization
 *     layer → local → named → pool.
 *
 * `local` = per-device echo (persisted) of what the user set; consulted ONLY
 * for session-only aliases. Omit for pure display (R1 read-only behavior).
 */
export function planAvatarFile(
  alias: string | null | undefined,
  hub: HubAvatarState,
  local?: Record<string, string>,
): string {
  if (!alias) return 'none';
  if (hub.nodeAliases.has(alias)) {
    const url = (hub.map[alias] || '').trim();
    if (url) return resolveUrlToPlan(url);
    return designDefault(alias); // cleared → default, SKIP local (never reads `local`)
  }
  const localUrl = (local && local[alias] ? local[alias] : '').trim();
  if (localUrl) {
    const p = resolveUrlToPlan(localUrl);
    if (p !== 'none') return p;
  }
  return designDefault(alias);
}

/** Can this alias's avatar be edited? Only node-backed aliases (have a hub nodes
 *  row) — session-only aliases 404 on PUT, so the UI must disable + explain
 *  BEFORE the user acts (通信龙 判据·披露在动手前). Pure = unit-testable. */
export function canEditAvatar(alias: string | null | undefined, hub: HubAvatarState): boolean {
  return !!alias && hub.nodeAliases.has(alias);
}

/** Client-side validate a custom avatar URL before PUT — mirror hub #550
 *  (avatar-validate.ts): absolute http(s) only (relative pool paths are set via
 *  the pool picker, not this field). Rejects early to avoid a doomed round-trip. */
/** True for a site-relative path ("/x", not "//host/x") or a URL on the Hub's own origin.
 *  Protected avatar endpoints only exist on the Hub; an external origin that happens to
 *  contain "/api/files/" is just a normal image URL and must not be blocked (Codex P2). */
export function isRelativeOrSameHub(value: string, hubUrl: string): boolean {
  const u = (value || '').trim();
  if (!u) return false;
  if (u.startsWith('/') && !u.startsWith('//')) return true;
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return url.origin === new URL(hubUrl).origin;
  } catch {
    return false;
  }
}

/** Paths that only the Hub can serve with the caller's bearer token. */
export function isLegacyAvatarApiRoute(value: string): boolean {
  return /\/api\/(?:files\/|users\/[^/?#]*\/avatar)/i.test(value || '');
}

export function validateCustomAvatarUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; reason: string } {
  const u = (raw || '').trim();
  if (!u) return { ok: false, reason: '请输入图片 URL,或点上方图案选默认头像' };
  if (/\s/.test(u)) return { ok: false, reason: 'URL 不能含空格' };
  if (!/^https?:\/\//i.test(u)) return { ok: false, reason: '只支持 http(s) 绝对图片 URL' };
  if (u.length > 2048) return { ok: false, reason: 'URL 过长' };
  try {
    const parsed = new URL(u);
    if (parsed.username || parsed.password) return { ok: false, reason: 'URL 不能含账号密码' };
  } catch {
    return { ok: false, reason: 'URL 格式无效' };
  }
  return { ok: true, url: u };
}
