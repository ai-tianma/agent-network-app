import { readFileSync } from 'node:fs';
import { planReleaseDraft } from '../scripts/prepare-desktop-release.mjs';
import {
  assertAnonymousDownloads,
  fileNameFromPublicUrl,
  isPublicDownloadUrl,
  latestJsonUploadArgs,
  normalizeManifestAssetUrls,
  normalizeReleaseManifest,
  publicDownloadUrl,
} from '../scripts/normalize-desktop-update-manifest.mjs';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total++;
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
};

const repository = 'sleep2agi/agent-network-app';
const tag = 'desktop-v0.2.287';
const releaseId = '420700001';
const assetNames = {
  mac: 'ANet_0.2.287_aarch64.app.tar.gz',
  win: 'ANet_0.2.287_x64-setup.exe',
  msi: 'ANet_0.2.287_x64_en-US.msi',
};
const apiAssetUrl = (id: number) => `https://api.github.com/repos/${repository}/releases/assets/${id}`;
const assets = [
  { id: 1, name: 'latest.json', url: apiAssetUrl(1), browser_download_url: publicDownloadUrl(repository, tag, 'latest.json') },
  { id: 2, name: assetNames.mac, url: apiAssetUrl(2), browser_download_url: publicDownloadUrl(repository, tag, assetNames.mac) },
  { id: 3, name: assetNames.win, url: apiAssetUrl(3), browser_download_url: publicDownloadUrl(repository, tag, assetNames.win) },
  { id: 4, name: assetNames.msi, url: apiAssetUrl(4), browser_download_url: publicDownloadUrl(repository, tag, assetNames.msi) },
];
const release = { id: Number(releaseId), tag_name: tag, draft: true, assets };

const generatedManifest = {
  version: '0.2.287',
  notes: 'Signed update',
  pub_date: '2026-10-23T00:00:00Z',
  platforms: {
    'darwin-aarch64': { url: apiAssetUrl(2), signature: 'sig-mac' },
    'windows-x86_64': { url: apiAssetUrl(3), signature: 'sig-win' },
    'windows-x86_64-msi': { url: apiAssetUrl(4), signature: 'sig-msi' },
  },
};

const expectThrow = (label: string, fn: () => unknown, needle: string) => {
  let message = '';
  try {
    fn();
  } catch (error) {
    message = String(error);
  }
  check(`${label} fails closed`, message.includes(needle));
};

check('public download url builder targets the release tag',
  publicDownloadUrl(repository, tag, 'a.zip') === `https://github.com/${repository}/releases/download/${tag}/a.zip`);
check('asset api url is not a public download url', !isPublicDownloadUrl(apiAssetUrl(2), { repository, tag }));
check('public download url for another tag is rejected',
  !isPublicDownloadUrl(publicDownloadUrl(repository, 'desktop-v0.2.286', 'a.zip'), { repository, tag }));
check('file name is recovered from a public download url',
  fileNameFromPublicUrl(publicDownloadUrl(repository, tag, assetNames.win), { repository, tag }) === assetNames.win);
const uploadArgs = latestJsonUploadArgs({ repository, releaseId, file: '/tmp/latest.json' });
check('latest.json upload uses the complete uploads.github.com release-assets url',
  uploadArgs.includes(`https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=latest.json`));
check('latest.json upload never relies on gh api --hostname', !uploadArgs.includes('--hostname'));

// 1) 正确映射：API URL → 公共下载链接，签名等其它字段原样保留
const normalized = normalizeManifestAssetUrls(generatedManifest, release, { repository, tag });
check('correct mapping rewrites every platform url', normalized.changed === true
  && Object.values(normalized.manifest.platforms).every((entry: { url: string }) => isPublicDownloadUrl(entry.url, { repository, tag })));
check('correct mapping keeps signatures and notes',
  normalized.manifest.platforms['darwin-aarch64'].signature === 'sig-mac'
  && normalized.manifest.notes === generatedManifest.notes
  && normalized.manifest.pub_date === generatedManifest.pub_date);
check('correct mapping reports the mapped assets', normalized.platforms.length === 3
  && normalized.platforms.some((entry: { name: string; asset: string }) => entry.name === 'windows-x86_64-msi' && entry.asset === assetNames.msi));
check('normalization does not mutate the input manifest',
  generatedManifest.platforms['darwin-aarch64'].url === apiAssetUrl(2));

// draft 资产的 browser_download_url 常是 untagged-...：最终 URL 必须由 repo+tag+name 合成
const untagged = normalizeManifestAssetUrls(generatedManifest, {
  ...release,
  assets: assets.map((asset) => (asset.id === 2 ? { ...asset, browser_download_url: 'https://github.com/sleep2agi/agent-network-app/releases/download/untagged-abc123/' + asset.name } : asset)),
}, { repository, tag });
check('untagged draft download url is replaced by the final tag url',
  untagged.manifest.platforms['darwin-aarch64'].url === publicDownloadUrl(repository, tag, assetNames.mac));

// 2) 缺映射
expectThrow('missing asset mapping', () => normalizeManifestAssetUrls(
  { ...generatedManifest, platforms: { ...generatedManifest.platforms, 'linux-x86_64': { url: apiAssetUrl(99), signature: 'sig' } } },
  release,
  { repository, tag },
), 'no browser download mapping');

// 3) 歧义
expectThrow('ambiguous asset mapping', () => normalizeManifestAssetUrls(
  generatedManifest,
  { draft: true, assets: [...assets, { ...assets[1] }] },
  { repository, tag },
), 'ambiguous browser download mapping');

// 4) 幂等：已经是公共链接 → 不改、不上传
const publicManifest = normalizeManifestAssetUrls(generatedManifest, release, { repository, tag }).manifest;
const idempotent = normalizeManifestAssetUrls(publicManifest, release, { repository, tag });
check('already-public manifest is idempotent', idempotent.changed === false);
check('idempotent normalization returns the same bytes',
  JSON.stringify(idempotent.manifest) === JSON.stringify(publicManifest));

// 5) 已有公共链接但本 release 没这个文件
expectThrow('public url for a missing asset', () => normalizeManifestAssetUrls(
  { ...publicManifest, platforms: { ...publicManifest.platforms, 'windows-x86_64': { url: publicDownloadUrl(repository, tag, 'ghost.exe'), signature: 's' } } },
  release,
  { repository, tag },
), 'which this release does not have');

// 6) 已有公共链接但带了额外参数/和资产的 download url 不一致
expectThrow('public url with an extra query', () => normalizeManifestAssetUrls(
  { ...publicManifest, platforms: { ...publicManifest.platforms, 'windows-x86_64': { url: `${publicDownloadUrl(repository, tag, assetNames.win)}?x=1`, signature: 's' } } },
  release,
  { repository, tag },
), 'which this release does not have');

// 7) 非公开 browser_download_url：draft 阶段照常合成最终链接（这正是 draft 的常态）
const synthesized = normalizeManifestAssetUrls(
  generatedManifest,
  { draft: true, assets: assets.map((asset) => (asset.id === 3 ? { ...asset, browser_download_url: apiAssetUrl(3) } : asset)) },
  { repository, tag },
);
check('a draft asset api browser url still yields the final tag url',
  synthesized.manifest.platforms['windows-x86_64'].url === publicDownloadUrl(repository, tag, assetNames.win));
expectThrow('an asset without a name cannot be synthesized', () => normalizeManifestAssetUrls(
  generatedManifest,
  { draft: true, assets: [{ id: 3, url: apiAssetUrl(3), browser_download_url: '' }] },
  { repository, tag },
), 'no browser download mapping');

// 8) 结构错误
expectThrow('platform without url', () => normalizeManifestAssetUrls(
  { ...generatedManifest, platforms: { ...generatedManifest.platforms, 'windows-x86_64': { signature: 's' } } },
  release,
  { repository, tag },
), 'has no url');
expectThrow('empty platforms', () => normalizeManifestAssetUrls({ version: '0.2.287', platforms: {} }, release, { repository, tag }), 'platforms is empty');
expectThrow('release without assets', () => normalizeManifestAssetUrls(generatedManifest, {}, { repository, tag }), 'assets must be an array');

// 9) 匿名下载断言
const headResponse = (status: number, length: string | null) => new Response(null, { status, headers: length === null ? {} : { 'content-length': length } });
const anonymousOk = await assertAnonymousDownloads([publicDownloadUrl(repository, tag, assetNames.win)], {
  fetchImpl: (async () => headResponse(200, '1024')) as unknown as typeof fetch,
});
check('anonymous check records status and size', anonymousOk.length === 1 && anonymousOk[0].bytes === 1024);
let anonymousFailure = '';
try {
  await assertAnonymousDownloads([publicDownloadUrl(repository, tag, assetNames.win)], {
    fetchImpl: (async () => headResponse(403, null)) as unknown as typeof fetch,
  });
} catch (error) { anonymousFailure = String(error); }
check('anonymous check fails closed on a non-2xx download', anonymousFailure.includes('anonymous download failed (403)'));
let anonymousLength = '';
try {
  await assertAnonymousDownloads([publicDownloadUrl(repository, tag, assetNames.win)], {
    fetchImpl: (async () => headResponse(200, null)) as unknown as typeof fetch,
  });
} catch (error) { anonymousLength = String(error); }
check('anonymous check fails closed without a content-length', anonymousLength.includes('no content-length'));

// 10) 端到端：上传一次、回读断言、日志带 version/sha256
const manifestUrl = assets[0].url;
let uploaded = 0;
let currentManifest: unknown = generatedManifest;
const releaseRequests: string[] = [];
const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
  const href = String(input);
  releaseRequests.push(href);
  if (href.includes('/releases/tags/')) {
    return new Response(JSON.stringify({ error: 'draft release must not be read through the tag endpoint' }), { status: 404 });
  }
  if (href === `https://api.github.com/repos/${repository}/releases/${releaseId}`) {
    return new Response(JSON.stringify(release), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (href === manifestUrl) {
    return new Response(JSON.stringify(currentManifest), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (init?.method === 'HEAD') return headResponse(200, '2048');
  return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
}) as unknown as typeof fetch;
const logs: string[] = [];
const summary = await normalizeReleaseManifest({
  repository,
  tag,
  releaseId,
  fetchImpl: fetchStub,
  anonymousCheck: async () => { throw new Error('draft release must not be anonymously checked'); },
  upload: ({ file }: { file: string }) => {
    uploaded++;
    currentManifest = JSON.parse(readFileSync(file, 'utf8'));
  },
  log: (line: string) => logs.push(line),
});
check('end-to-end uploads the normalized manifest once', uploaded === 1);
check('end-to-end reports the version', summary.version === '0.2.287');
check('end-to-end reads the release by id, never by tag', releaseRequests.length > 0
  && releaseRequests.every((href) => !href.includes('/releases/tags/'))
  && releaseRequests.some((href) => href.endsWith(`/releases/${releaseId}`)));
check('end-to-end does not anonymously check a draft', summary.anonymousChecked === false && summary.draft === true);
check('end-to-end records a post-upload sha256', /^[0-9a-f]{64}$/.test(summary.afterSha256));
check('end-to-end leaves anonymous urls empty on a draft', summary.anonymous.length === 0);
check('end-to-end logs version and sha256', logs.some((line) => line.includes('0.2.287') && line.includes(summary.afterSha256)));

// 11) 幂等运行不上传
uploaded = 0;
currentManifest = normalizeManifestAssetUrls(generatedManifest, release, { repository, tag }).manifest;
const idempotentRun = await normalizeReleaseManifest({
  repository,
  tag,
  releaseId,
  fetchImpl: fetchStub,
  upload: () => { uploaded++; },
  log: () => {},
});
check('idempotent run does not upload', uploaded === 0 && idempotentRun.changed === false);

// 12) 上传后仍是 API URL → 失败（不能静默留坏 URL）
uploaded = 0;
currentManifest = generatedManifest;
let stillBroken = '';
try {
  await normalizeReleaseManifest({
    repository,
    tag,
    releaseId,
    fetchImpl: fetchStub,
    upload: () => { uploaded++; }, // 假装上传成功但内容没变
    log: () => {},
  });
} catch (error) { stillBroken = String(error); }
check('post-upload asset-api urls fail the run', stillBroken.includes('still carries asset API urls after upload'));

// 13) 版本被改动 → 失败（上传后的内容本身是公共链接，只有版本被换掉）
currentManifest = generatedManifest;
let versionDrift = '';
try {
  await normalizeReleaseManifest({
    repository,
    tag,
    releaseId,
    fetchImpl: fetchStub,
    upload: () => { currentManifest = { ...publicManifest, version: '9.9.9' }; },
    log: () => {},
  });
} catch (error) { versionDrift = String(error); }
check('a version change during normalization fails', versionDrift.includes('version changed during normalization'));

// 14) 缺少 release id → 失败（禁止退回 tag 端点）
let noId = '';
try {
  await normalizeReleaseManifest({ repository, tag, fetchImpl: fetchStub, log: () => {} });
} catch (error) { noId = String(error); }
check('a missing release id fails closed', noId.includes('release id is required'));

// 15) 工作流接线：在 draft 阶段（attach-android-apk 之后）跑这个脚本
const workflow = readFileSync('.github/workflows/release-desktop-auto-update.yml', 'utf8').replace(/\r\n?/g, '\n');
const normalizeJob = workflow.slice(workflow.indexOf('normalize-updater-manifest:'));
check('release workflow declares the normalizer job', workflow.includes('normalize-updater-manifest:'));
check('release workflow has a single prepare-release job', workflow.includes('prepare-release:') && workflow.includes('node scripts/prepare-desktop-release.mjs'));
check('build matrix depends on prepare-release', /build-release:\n\s+needs: \[prepare-release\]/.test(workflow));
check('every matrix job uploads into the same release id', /releaseId: \$\{\{ needs\.prepare-release\.outputs\.release_id \}\}/.test(workflow));
check('draft verification reads the release by id', /verify-draft:[\s\S]{0,2500}RELEASE_ID: \$\{\{ needs\.prepare-release\.outputs\.release_id \}\}/.test(workflow));
check('normalizer reads the release by id', /normalize-updater-manifest:[\s\S]{0,1200}RELEASE_ID: \$\{\{ needs\.prepare-release\.outputs\.release_id \}\}/.test(workflow));
check('build matrix no longer deletes drafts per job', !workflow.includes('Remove stale draft releases for this tag'));

// 16) prepare-release 的 0/1/2 drafts 与 published 判定
check('no draft plans a create', planReleaseDraft([], tag).action === 'create');
check('one draft is reused with its id', planReleaseDraft([{ id: 7, tag_name: tag, draft: true }], tag).action === 'reuse'
  && planReleaseDraft([{ id: 7, tag_name: tag, draft: true }], tag).releaseId === 7);
check('two drafts fail closed', planReleaseDraft([{ id: 7, tag_name: tag, draft: true }, { id: 8, tag_name: tag, draft: true }], tag).action === 'fail'
  && planReleaseDraft([{ id: 7, tag_name: tag, draft: true }, { id: 8, tag_name: tag, draft: true }], tag).reason === 'multiple-drafts');
check('a published release blocks the tag', planReleaseDraft([{ id: 9, tag_name: tag, draft: false }], tag).action === 'fail'
  && planReleaseDraft([{ id: 9, tag_name: tag, draft: false }], tag).reason === 'already-published');
check('other tags are ignored', planReleaseDraft([{ id: 1, tag_name: 'desktop-v0.2.286', draft: true }], tag).action === 'create');
check('normalizer runs after the APK attach', /normalize-updater-manifest:[\s\S]{0,200}needs: \[prepare-release, attach-android-apk\]/.test(workflow));
check('normalizer only runs for publish builds', /normalize-updater-manifest:[\s\S]{0,300}if: inputs\.publish == true/.test(workflow));
check('normalizer runs this script', normalizeJob.slice(0, 2000).includes('node scripts/normalize-desktop-update-manifest.mjs'));
check('normalizer passes the release tag', normalizeJob.slice(0, 2000).includes('RELEASE_TAG='));
check('normalizer job is declared after attach-android-apk', workflow.indexOf('normalize-updater-manifest:') > workflow.indexOf('attach-android-apk:'));

console.log(`desktop update manifest normalize: ${passed}/${total} checks passed`);
