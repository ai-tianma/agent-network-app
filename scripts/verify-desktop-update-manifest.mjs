#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ENDPOINT = 'https://www.anet.sh/desktop/update/latest.json';
const DEFAULT_REPOSITORY = 'sleep2agi/agent-network-app';

const sorted = (value) => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(sorted(value));

const PUBLIC_DOWNLOAD = (repository, tag, name) => `https://github.com/${repository}/releases/download/${tag}/${name}`;

/**
 * 发布前的 normalize 会把平台 URL 从 asset API URL 换成 `releases/download/<tag>/<file>`
 * 形式的最终公开链接（见 scripts/normalize-desktop-update-manifest.mjs）。drift guard
 * 比较的正是「发布后读到的 manifest」，所以这里必须同样接受已经规范化的 URL：
 * 已经是本 release 的公开下载链接 → 原样保留；否则仍按 asset API URL 唯一映射。
 */
export const normalizeGeneratedManifestAssetUrls = (manifest, release, { repository = '', tag = '' } = {}) => {
  if (!manifest?.platforms || typeof manifest.platforms !== 'object' || Array.isArray(manifest.platforms)) {
    throw new Error('release manifest: platforms must be an object');
  }
  if (!Array.isArray(release?.assets)) throw new Error('release: assets must be an array');

  const platforms = Object.fromEntries(Object.entries(manifest.platforms).map(([name, entry]) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.url !== 'string') {
      throw new Error(`release manifest: ${name} has no asset API URL`);
    }
    const publicPrefix = repository && tag ? PUBLIC_DOWNLOAD(repository, tag, '') : '';
    if (publicPrefix && entry.url.startsWith(publicPrefix) && !entry.url.slice(publicPrefix.length).includes('/')) {
      const fileName = entry.url.slice(publicPrefix.length);
      const exists = release.assets.filter((asset) => asset?.name === fileName);
      if (exists.length !== 1) {
        throw new Error(`release manifest: ${name} points at ${fileName}, which this release does not have exactly once`);
      }
      return [name, entry];
    }
    const matches = release.assets.filter((asset) => asset?.url === entry.url);
    if (matches.length === 0) {
      throw new Error(`release manifest: no browser download mapping for ${name}`);
    }
    if (matches.length !== 1) {
      throw new Error(`release manifest: ambiguous browser download mapping for ${name}`);
    }
    const direct = matches[0]?.browser_download_url;
    if (typeof direct !== 'string' || direct.length === 0) {
      throw new Error(`release manifest: missing browser download URL for ${name}`);
    }
    return [name, { ...entry, url: direct }];
  }));
  return { ...manifest, platforms };
};

const jsonResponse = async (response, label, requireJsonContentType = true) => {
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (requireJsonContentType && !contentType.toLowerCase().includes('json')) {
    throw new Error(`${label}: expected JSON content-type, got ${contentType || '(missing)'}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
};

export async function verifyDesktopUpdateManifest({
  fetchImpl = fetch,
  endpoint = DEFAULT_ENDPOINT,
  repository = DEFAULT_REPOSITORY,
  token = '',
} = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const deployed = await jsonResponse(await fetchImpl(endpoint), 'deployed manifest');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(deployed?.version ?? '')) {
    throw new Error(`deployed manifest: invalid version ${JSON.stringify(deployed?.version)}`);
  }

  const tag = `desktop-v${deployed.version}`;
  const releaseUrl = `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`;
  const release = await jsonResponse(await fetchImpl(releaseUrl, { headers }), `release ${tag}`);
  if (release.draft) throw new Error(`release ${tag}: still a draft`);
  const manifestAssets = Array.isArray(release.assets)
    ? release.assets.filter((candidate) => candidate?.name === 'latest.json')
    : [];
  if (manifestAssets.length === 0) throw new Error(`release ${tag}: latest.json asset missing`);
  if (manifestAssets.length !== 1) throw new Error(`release ${tag}: latest.json asset ambiguous`);
  const [asset] = manifestAssets;
  if (!asset?.browser_download_url) throw new Error(`release ${tag}: latest.json download URL missing`);

  const generated = await jsonResponse(
    await fetchImpl(asset.browser_download_url, { headers }),
    `release ${tag} latest.json`,
    false,
  );
  const normalizedGenerated = normalizeGeneratedManifestAssetUrls(generated, release, { repository, tag });
  if (canonicalJson(deployed) !== canonicalJson(normalizedGenerated)) {
    throw new Error(`desktop updater drift: deployed manifest differs from ${tag} release asset`);
  }

  return { version: deployed.version, tag, assetUrl: asset.browser_download_url };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  verifyDesktopUpdateManifest({
    endpoint: process.env.DESKTOP_UPDATE_ENDPOINT || DEFAULT_ENDPOINT,
    repository: process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
    token: process.env.GITHUB_TOKEN || '',
  }).then(({ version, tag }) => {
    console.log(`desktop updater manifests match: ${version} (${tag})`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
