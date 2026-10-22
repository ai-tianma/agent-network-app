#!/usr/bin/env node
// After release-desktop-auto-update.yml builds every platform, check the draft
// GitHub Release. This does not publish the draft and does not talk to ModelScope.
//
//   node scripts/verify-desktop-release-draft.mjs
//
// Reads src-tauri/tauri.conf.json for the product name and version. Uses `gh`
// (GH_TOKEN) to read the draft. EXPECTED_COMMIT must be the 40-character SHA
// the workflow was dispatched with.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LINUX_UPDATER_PLATFORMS = ['linux-x86_64', 'linux-x86_64-deb'];

const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/;

export const releaseAssetNames = (product, version, includeLinux = true) => [
  ...(includeLinux ? [`${product}_${version}_amd64.deb`, `${product}_${version}_amd64.deb.sig`] : []),
  `${product}_${version}_aarch64.dmg`,
  `${product}_${version}_aarch64.app.tar.gz`,
  `${product}_${version}_aarch64.app.tar.gz.sig`,
  `${product}_${version}_x64-setup.exe`,
  `${product}_${version}_x64-setup.exe.sig`,
  `${product}_${version}_x64_en-US.msi`,
  `${product}_${version}_x64_en-US.msi.sig`,
  'latest.json',
];

const urlCandidates = (asset) => [asset?.apiUrl, asset?.url, asset?.browser_download_url]
  .filter((value) => typeof value === 'string' && value.length > 0);

const matchesAsset = (entryUrl, asset) => urlCandidates(asset).includes(entryUrl);

/**
 * Pure check of one draft desktop release. `release.assets` uses the fields
 * `gh release view --json assets` returns (name, state, digest, apiUrl, url).
 * Throws on the first broken contract.
 */
export function assertDesktopReleaseDraft({ product, version, release, manifest, expectedCommit, includeLinux = true }) {
  if (typeof includeLinux !== 'boolean') throw new Error('includeLinux must be boolean');
  if (!product || !version) throw new Error('product and version are required');
  if (!release || typeof release !== 'object') throw new Error('release is required');
  if (release.isDraft !== true) throw new Error(`desktop-v${version} is not a draft`);
  if (expectedCommit && release.targetCommitish !== expectedCommit) {
    throw new Error(`draft targetCommitish ${release.targetCommitish} is not ${expectedCommit}`);
  }
  if (!Array.isArray(release.assets)) throw new Error('release assets missing');
  const names = release.assets.map((asset) => asset?.name);
  if (new Set(names).size !== names.length) throw new Error('release has duplicate asset names');
  for (const name of releaseAssetNames(product, version, includeLinux)) {
    if (!names.includes(name)) throw new Error(`draft is missing ${name}`);
  }
  for (const asset of release.assets) {
    if (asset.state !== 'uploaded') throw new Error(`${asset.name} is not uploaded (${asset.state})`);
  }
  const debName = `${product}_${version}_amd64.deb`;
  const deb = release.assets.find((asset) => asset.name === debName);
  const digest = SHA256_DIGEST.exec(deb?.digest ?? '');
  if (includeLinux && !digest) throw new Error(`${debName} has no sha256 digest`);
  const sigName = `${debName}.sig`;
  const sig = release.assets.find((asset) => asset.name === sigName);
  const sigDigest = SHA256_DIGEST.exec(sig?.digest ?? '');
  if (includeLinux && !sigDigest) throw new Error(`${sigName} has no sha256 digest`);
  if (!includeLinux && release.assets.some(asset => /\.deb(?:\.sig)?$/.test(asset.name))) {
    throw new Error('Linux assets present but Linux was not selected');
  }

  if (manifest?.version !== version) {
    throw new Error(`latest.json version ${JSON.stringify(manifest?.version)} is not ${version}`);
  }
  if (!manifest.platforms || typeof manifest.platforms !== 'object' || Array.isArray(manifest.platforms)) {
    throw new Error('latest.json platforms missing');
  }
  const linuxPlatforms = includeLinux ? LINUX_UPDATER_PLATFORMS : [];
  if (!includeLinux && Object.keys(manifest.platforms).some(key => key.startsWith('linux-'))) {
    throw new Error('Linux updater entries present but Linux was not selected');
  }
  for (const key of ['darwin-aarch64', 'windows-x86_64', ...linuxPlatforms]) {
    const entry = manifest.platforms[key];
    if (!entry || typeof entry.url !== 'string' || !entry.url) throw new Error(`latest.json missing ${key} url`);
    if (typeof entry.signature !== 'string' || !entry.signature) throw new Error(`latest.json missing ${key} signature`);
  }
  const linuxSignatures = linuxPlatforms.map((key) => manifest.platforms[key].signature);
  if (includeLinux && new Set(linuxSignatures).size !== 1) throw new Error('linux updater entries do not share one signature');
  for (const key of linuxPlatforms) {
    if (!matchesAsset(manifest.platforms[key].url, deb)) {
      throw new Error(`latest.json ${key} does not point at ${debName}`);
    }
  }
  const exeName = `${product}_${version}_x64-setup.exe`;
  const exe = release.assets.find((asset) => asset.name === exeName);
  if (!matchesAsset(manifest.platforms['windows-x86_64'].url, exe)) {
    throw new Error(`latest.json windows-x86_64 does not point at ${exeName}`);
  }
  const macName = `${product}_${version}_aarch64.app.tar.gz`;
  const mac = release.assets.find((asset) => asset.name === macName);
  if (!matchesAsset(manifest.platforms['darwin-aarch64'].url, mac)) {
    throw new Error(`latest.json darwin-aarch64 does not point at ${macName}`);
  }
  return { debSha256: digest?.[1] ?? null, sigSha256: sigDigest?.[1] ?? null };
}

function ghJson(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

function main() {
  const linuxInput = process.env.INCLUDE_LINUX ?? 'true';
  if (!['true', 'false'].includes(linuxInput)) throw new Error('INCLUDE_LINUX must be true or false');
  const includeLinux = linuxInput === 'true';
  const expectedCommit = process.env.EXPECTED_COMMIT || '';
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error('EXPECTED_COMMIT must be a 40-character SHA');
  const repository = process.env.GITHUB_REPOSITORY || 'sleep2agi/agent-network-app';
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const tag = `desktop-v${config.version}`;
  // 只按 release id 鉴权回读：draft 阶段的 `GET /releases/tags/{tag}` 不可靠
  // （同 tag 可能有多个对象），prepare-release 已经把唯一 id 传下来。
  const releaseId = process.env.RELEASE_ID || '';
  if (!/^\d+$/.test(releaseId)) throw new Error('RELEASE_ID must be a numeric release id from prepare-release');
  const rawRelease = ghJson(['api', `repos/${repository}/releases/${releaseId}`]);
  const rawAssets = ghJson(['api', `repos/${repository}/releases/${releaseId}/assets?per_page=100`, '--paginate']);
  const release = {
    isDraft: rawRelease.draft,
    targetCommitish: rawRelease.target_commitish,
    assets: (Array.isArray(rawAssets) ? rawAssets : []).map((asset) => ({
      name: asset.name,
      state: asset.state,
      digest: asset.digest,
      apiUrl: asset.url,
      url: asset.browser_download_url,
    })),
  };
  const latest = release.assets.find((asset) => asset.name === 'latest.json');
  if (!latest?.apiUrl) throw new Error(`${tag} has no latest.json asset`);
  const assetId = latest.apiUrl.split('/').pop();
  const manifestRaw = execFileSync(
    'gh',
    ['api', '-H', 'Accept: application/octet-stream', `repos/${repository}/releases/assets/${assetId}`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const manifest = JSON.parse(manifestRaw);
  const { debSha256, sigSha256 } = assertDesktopReleaseDraft({
    product: config.productName,
    version: config.version,
    release,
    manifest,
    expectedCommit,
    includeLinux,
  });
  const debName = `${config.productName}_${config.version}_amd64.deb`;
  const evidence = includeLinux
    ? [`${debSha256}  ${debName}`, `${sigSha256}  ${debName}.sig`]
    : ['Linux deferred: macOS and Windows assets and updater entries verified.'];
  console.log(`draft ${tag} verified; include_linux=${includeLinux}`);
  console.log(evidence.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '### Draft release check',
      '',
      `Tag \`${tag}\` is still a draft. include_linux=${includeLinux}.`,
      '',
      '```',
      ...evidence,
      '```',
      '',
    ].join('\n'));
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
