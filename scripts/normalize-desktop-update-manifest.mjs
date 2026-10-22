#!/usr/bin/env node

// 0.2.286 的教训:tauri-action 生成的 latest.json 里，五个 platforms.url 是
// `https://api.github.com/repos/<repo>/releases/assets/<id>`，而不是
// `https://github.com/<repo>/releases/download/<tag>/<file>`。前者是 asset API
// 端点（需要 Accept 头/跟随重定向），站点校验与普通 updater 都按后者解析。
//
// 这个脚本在 draft 阶段（attach-android-apk 之后、发布之前）把 manifest 的
// 平台 URL 映射成同一次发布里真实资产的 browser_download_url，并回读断言：
//   * 缺映射 / 歧义 / 非公开 URL → 抛错（fail-closed），不静默留坏 URL；
//   * 已经是公开下载链接时幂等，不上传、不改字节；
//   * draft 阶段**不做匿名访问检查**（草稿资产对外 404 是正常的），只校验鉴权元数据与
//     最终 URL 语法；匿名 200 留到发布之后再验（desktop-update-manifest-drift.yml）；
//   * draft 资产的 browser_download_url 常是 `untagged-...` 形状，因此最终 URL 由
//     repository + tag + asset.name 合成，而不是照抄 browser_download_url；
//   * release 一律按 release_id 鉴权查找，不用 `GET /releases/tags/{tag}`。

import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPOSITORY = 'sleep2agi/agent-network-app';
const ASSET_API_PREFIX = 'https://api.github.com/repos/';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const latestJsonAssetName = 'latest.json';

export const publicDownloadUrl = (repository, tag, name) =>
  `https://github.com/${repository}/releases/download/${tag}/${name}`;

export const latestJsonUploadArgs = ({ repository, releaseId, file }) => [
  'api', '-X', 'POST',
  `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${latestJsonAssetName}`,
  '-H', 'Content-Type: application/octet-stream', '--input', file,
];

/** 只认本仓本次发布标签下的公开下载链接；其它的（含 asset API URL）都不算。 */
export const isPublicDownloadUrl = (url, { repository, tag }) => {
  if (typeof url !== 'string' || url.length === 0) return false;
  const prefix = publicDownloadUrl(repository, tag, '');
  return url.startsWith(prefix) && url.length > prefix.length && !url.slice(prefix.length).includes('/');
};

/** 从公开下载链接里取出文件名；不是本 release 的公开链接就返回空串。 */
export const fileNameFromPublicUrl = (url, { repository, tag }) =>
  (isPublicDownloadUrl(url, { repository, tag }) ? url.slice(publicDownloadUrl(repository, tag, '').length) : '');

const isAssetApiUrl = (url, repository) =>
  typeof url === 'string' && url.startsWith(`${ASSET_API_PREFIX}${repository}/releases/assets/`);

/**
 * 把 manifest 的 platforms.*.url 全部映射成本 release 的公共下载链接。
 *
 * @returns {{manifest: object, changed: boolean, platforms: Array<{name: string, asset: string}>}}
 */
export const normalizeManifestAssetUrls = (manifest, release, { repository, tag }) => {
  if (!isObject(manifest?.platforms)) throw new Error('release manifest: platforms must be an object');
  if (!Array.isArray(release?.assets)) throw new Error('release: assets must be an array');
  // 发布中的 release 自带 tag_name；调用方没给就以它为准，避免合成出别的 tag 的链接。
  if (!tag) tag = release?.tag_name;
  if (typeof tag !== 'string' || tag.length === 0) throw new Error('release tag is required to synthesize download urls');

  const assets = release.assets.filter((asset) => isObject(asset));
  const byApiUrl = new Map();
  const byName = new Map();
  for (const asset of assets) {
    if (typeof asset.name !== 'string' || asset.name.length === 0) continue;
    const list = byName.get(asset.name) ?? [];
    list.push(asset);
    byName.set(asset.name, list);
    if (typeof asset.url === 'string' && asset.url.length > 0) {
      const seen = byApiUrl.get(asset.url) ?? [];
      seen.push(asset);
      byApiUrl.set(asset.url, seen);
    }
  }

  const names = Object.keys(manifest.platforms);
  if (names.length === 0) throw new Error('release manifest: platforms is empty');

  const resolved = [];
  const platforms = {};
  let changed = false;

  for (const name of names) {
    const entry = manifest.platforms[name];
    if (!isObject(entry) || typeof entry.url !== 'string' || entry.url.length === 0) {
      throw new Error(`release manifest: ${name} has no url`);
    }

    let asset;
    if (isPublicDownloadUrl(entry.url, { repository, tag })) {
      // 幂等分支：已经是本 release 的公共下载链接，只核对它确实指向一个真实资产。
      const fileName = fileNameFromPublicUrl(entry.url, { repository, tag });
      const matches = byName.get(fileName) ?? [];
      if (matches.length === 0) {
        throw new Error(`release manifest: ${name} points at ${fileName}, which this release does not have`);
      }
      if (matches.length !== 1) {
        throw new Error(`release manifest: ambiguous asset name ${fileName} for ${name}`);
      }
      asset = matches[0];
    } else if (isAssetApiUrl(entry.url, repository)) {
      const matches = byApiUrl.get(entry.url) ?? [];
      if (matches.length === 0) {
        throw new Error(`release manifest: no browser download mapping for ${name} (${entry.url})`);
      }
      if (matches.length !== 1) {
        throw new Error(`release manifest: ambiguous browser download mapping for ${name}`);
      }
      asset = matches[0];
      // draft 资产的 browser_download_url 常为 untagged-...，不能当最终 URL 用：
      // 由 repository + tag + asset.name 合成，并断言它确实是本 release 的公开链接。
      const synthesized = publicDownloadUrl(repository, tag, asset.name);
      if (!isPublicDownloadUrl(synthesized, { repository, tag })) {
        throw new Error(`release manifest: cannot synthesize a public download URL for ${name}`);
      }
      changed = changed || entry.url !== synthesized;
    } else {
      throw new Error(`release manifest: ${name} url is neither a public download link nor an asset API url (${entry.url})`);
    }

    const finalUrl = isPublicDownloadUrl(entry.url, { repository, tag })
      ? entry.url
      : publicDownloadUrl(repository, tag, asset.name);
    changed = changed || finalUrl !== entry.url;
    platforms[name] = { ...entry, url: finalUrl };
    resolved.push({ name, asset: asset.name });
  }

  return {
    manifest: changed ? { ...manifest, platforms } : manifest,
    changed,
    platforms: resolved,
  };
};

const authHeaders = (token) => {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
};

const fetchJson = async (fetchImpl, url, token) => {
  const response = await fetchImpl(url, { headers: authHeaders(token) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
};

const fetchLatestJsonBytes = async (fetchImpl, asset, token) => {
  const response = await fetchImpl(asset.url, {
    headers: { ...authHeaders(token), accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`latest.json download: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

const fetchLatestJson = async (fetchImpl, release, token, repository, tag) => {
  const manifestAssets = (release.assets ?? []).filter((asset) => asset?.name === latestJsonAssetName);
  if (manifestAssets.length === 0) throw new Error(`release ${tag}: latest.json asset missing`);
  if (manifestAssets.length !== 1) throw new Error(`release ${tag}: latest.json asset ambiguous`);
  const [asset] = manifestAssets;
  if (typeof asset.url !== 'string' || asset.url.length === 0) throw new Error(`release ${tag}: latest.json asset url missing`);
  const bytes = await fetchLatestJsonBytes(fetchImpl, asset, token);
  return { asset, bytes, manifest: JSON.parse(bytes.toString('utf8')) };
};

/** 匿名 HEAD：公共下载链接必须真的能拿到（跟随重定向，2xx 且带长度）。 */
export const assertAnonymousDownloads = async (urls, { fetchImpl = fetch } = {}) => {
  const unique = [...new Set(urls)];
  const checked = [];
  for (const url of unique) {
    const response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' });
    if (!response.ok) throw new Error(`anonymous download failed (${response.status}) for ${url}`);
    const length = Number(response.headers.get('content-length') ?? '0');
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error(`anonymous download reported no content-length for ${url}`);
    }
    checked.push({ url, status: response.status, bytes: length });
  }
  return checked;
};

export async function normalizeReleaseManifest({
  repository = DEFAULT_REPOSITORY,
  tag,
  releaseId = '',
  token = '',
  fetchImpl = fetch,
  upload = ({ file, releaseId, existingAssetIds = [], repository: repo }) => {
    // 全程按 release id / asset id 操作，不按 tag 猜对象。
    const gh = (args, options = {}) => {
      const result = spawnSync('gh', args, { encoding: 'utf8', stdio: options.inherit ? 'inherit' : 'pipe' });
      if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed (exit ${result.status})`);
      return result.stdout;
    };
    for (const assetId of existingAssetIds) gh(['api', '-X', 'DELETE', `repos/${repo}/releases/assets/${assetId}`]);
    // 二进制资产上传端点在 uploads.github.com（api.github.com 会 404）。
    // 必须用完整的 uploads.github.com URL；`gh api --hostname` 不会改写路径前缀。
    gh(latestJsonUploadArgs({ repository: repo, releaseId, file }), { inherit: true });
  },
  anonymousCheck = (urls) => assertAnonymousDownloads(urls, { fetchImpl }),
  log = (line) => console.log(line),
} = {}) {
  if (!releaseId) throw new Error('release id is required (RELEASE_ID from prepare-release)');
  if (!/^\d+$/.test(String(releaseId))) throw new Error(`release id must be numeric (got ${JSON.stringify(releaseId)})`);
  // 只按 release id 鉴权查找：draft 的 tag 端点 GET /releases/tags/{tag} 不可靠，
  // 也避免「同 tag 多个对象」时读错一个。
  const releaseUrl = `https://api.github.com/repos/${repository}/releases/${releaseId}`;

  // 1) fresh 回读 release，用真实资产做唯一映射
  const release = await fetchJson(fetchImpl, releaseUrl, token);
  tag = tag || release.tag_name;
  if (release.draft === false && !release.assets?.length) throw new Error(`release ${tag}: has no assets`);
  const before = await fetchLatestJson(fetchImpl, release, token, repository, tag);
  const normalized = normalizeManifestAssetUrls(before.manifest, release, { repository, tag });
  const version = normalized.manifest.version;

  const draft = release.draft !== false;
  const summary = {
    tag,
    releaseId: Number(releaseId),
    draft,
    version,
    changed: normalized.changed,
    anonymousChecked: false,
    platforms: normalized.platforms.map((entry) => entry.name),
    beforeSha256: createHash('sha256').update(before.bytes).digest('hex'),
    afterSha256: '',
    anonymous: [],
  };

  if (!normalized.changed) {
    log(`latest.json already uses public download URLs (release ${releaseId}, ${tag}, version ${version}, sha256 ${summary.beforeSha256}); nothing to upload`);
    summary.afterSha256 = summary.beforeSha256;
    if (draft) {
      log('draft release: skipping the anonymous download check (draft assets are not publicly reachable; the post-publish drift guard re-checks them)');
    } else {
      summary.anonymous = await anonymousCheck(normalized.platforms.map((entry) => normalized.manifest.platforms[entry.name].url));
      summary.anonymousChecked = true;
      log(`anonymous download check passed for ${summary.anonymous.length} unique urls`);
    }
    return summary;
  }

  // 2) 替换 latest.json（--clobber 覆盖同 release 里的同名资产）
  const dir = mkdtempSync(join(tmpdir(), 'anet-update-manifest-'));
  const file = join(dir, latestJsonAssetName);
  const text = `${JSON.stringify(normalized.manifest, null, 2)}\n`;
  writeFileSync(file, text);
  log(`uploading normalized latest.json to release ${releaseId} (${tag}, version ${version})`);
  upload({
    file,
    releaseId,
    repository,
    existingAssetIds: (release.assets ?? []).filter((asset) => asset?.name === latestJsonAssetName).map((asset) => asset.id),
  });

  // 3) 回读 + 断言：五个平台 URL 必须都是公共下载链接
  const afterRelease = await fetchJson(fetchImpl, releaseUrl, token);
  const after = await fetchLatestJson(fetchImpl, afterRelease, token, repository, tag);
  const verified = normalizeManifestAssetUrls(after.manifest, afterRelease, { repository, tag });
  if (verified.manifest.version !== version) {
    throw new Error(`latest.json version changed during normalization: ${version} -> ${verified.manifest.version}`);
  }
  if (verified.changed) throw new Error(`latest.json still carries asset API urls after upload (${tag})`);
  summary.afterSha256 = createHash('sha256').update(after.bytes).digest('hex');
  if (draft) {
    log(`latest.json now carries final public urls (release ${releaseId}, ${tag}): version ${version}, sha256 ${summary.afterSha256}; anonymous check deferred to post-publish`);
  } else {
    summary.anonymous = await anonymousCheck(verified.platforms.map((entry) => verified.manifest.platforms[entry.name].url));
    summary.anonymousChecked = true;
    log(`latest.json now public for ${tag}: version ${version}, sha256 ${summary.afterSha256}, ${summary.anonymous.length} unique urls anonymous-checked`);
  }
  return summary;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const version = process.env.VERSION || '';
  const tag = process.env.RELEASE_TAG || (version ? `desktop-v${version}` : '');
  const releaseId = process.env.RELEASE_ID || '';
  normalizeReleaseManifest({ repository, tag, releaseId, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '' })
    .then((summary) => {
      for (const entry of summary.anonymous) console.log(`  ${entry.status} ${entry.bytes}B ${entry.url}`);
    })
    .catch((error) => {
      console.error(`normalize latest.json failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
