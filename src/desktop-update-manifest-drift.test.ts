import { readFileSync } from 'node:fs';
import {
  canonicalJson,
  normalizeGeneratedManifestAssetUrls,
  verifyDesktopUpdateManifest,
} from '../scripts/verify-desktop-update-manifest.mjs';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total++;
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
};

const endpoint = 'https://updates.example/latest.json';
const repo = 'sleep2agi/agent-network-app';
const generatedManifest = {
  version: '0.2.33-1',
  notes: 'Signed update',
  platforms: {
    'windows-x86_64': { url: 'https://api.asset/win', signature: 'sig-win' },
    'darwin-aarch64': { signature: 'sig-mac', url: 'https://api.asset/mac' },
  },
};
const deployedManifest = {
  ...generatedManifest,
  platforms: {
    'windows-x86_64': { ...generatedManifest.platforms['windows-x86_64'], url: 'https://download.asset/win' },
    'darwin-aarch64': { ...generatedManifest.platforms['darwin-aarch64'], url: 'https://download.asset/mac' },
  },
};
const releaseAssets = [
  { name: 'latest.json', url: 'https://api.asset/latest', browser_download_url: 'https://download.asset/latest.json' },
  { name: 'win.exe', url: 'https://api.asset/win', browser_download_url: 'https://download.asset/win' },
  { name: 'mac.tar.gz', url: 'https://api.asset/mac', browser_download_url: 'https://download.asset/mac' },
];

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const mock = (releaseManifest: unknown = generatedManifest, releaseOverrides: Record<string, unknown> = {}) =>
  async (url: string | URL | Request) => {
    const href = String(url);
    if (href === endpoint) return response(deployedManifest);
    if (href.includes('/releases/tags/desktop-v0.2.33-1')) {
      return response({ draft: false, assets: releaseAssets, ...releaseOverrides });
    }
    if (href === 'https://download.asset/latest.json') return response(releaseManifest);
    return response({ error: 'unexpected url' }, 404);
  };

check('canonical comparison ignores object key and whitespace formatting',
  canonicalJson({ z: 1, nested: { b: 2, a: 1 } }) === canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }));

const ok = await verifyDesktopUpdateManifest({ fetchImpl: mock() as typeof fetch, endpoint, repository: repo });
check('dynamic endpoint URL rewriting passes with the deployed version tag', ok.tag === 'desktop-v0.2.33-1');

const normalized = normalizeGeneratedManifestAssetUrls(generatedManifest, { assets: releaseAssets });
check('normalization changes only platform URLs',
  canonicalJson(normalized) === canonicalJson(deployedManifest));

let drift = '';
try {
  await verifyDesktopUpdateManifest({ fetchImpl: mock({ ...generatedManifest, notes: 'different' }) as typeof fetch, endpoint, repository: repo });
} catch (error) { drift = String(error); }
check('a semantic field drift fails closed', drift.includes('deployed manifest differs'));

let draft = '';
try {
  await verifyDesktopUpdateManifest({ fetchImpl: mock(generatedManifest, { draft: true }) as typeof fetch, endpoint, repository: repo });
} catch (error) { draft = String(error); }
check('a draft release is rejected', draft.includes('still a draft'));

let missing = '';
try {
  await verifyDesktopUpdateManifest({ fetchImpl: mock(generatedManifest, { assets: [] }) as typeof fetch, endpoint, repository: repo });
} catch (error) { missing = String(error); }
check('a missing latest.json asset is rejected', missing.includes('latest.json asset missing'));

let ambiguousLatest = '';
try {
  await verifyDesktopUpdateManifest({ fetchImpl: mock(generatedManifest, { assets: [releaseAssets[0], ...releaseAssets] }) as typeof fetch, endpoint, repository: repo });
} catch (error) { ambiguousLatest = String(error); }
check('an ambiguous latest.json asset is rejected', ambiguousLatest.includes('latest.json asset ambiguous'));

let missingMapping = '';
try {
  normalizeGeneratedManifestAssetUrls(generatedManifest, { assets: releaseAssets.filter((asset) => asset.name !== 'win.exe') });
} catch (error) { missingMapping = String(error); }
check('a missing platform mapping is rejected', missingMapping.includes('no browser download mapping'));

let ambiguousMapping = '';
try {
  normalizeGeneratedManifestAssetUrls(generatedManifest, { assets: [...releaseAssets, { ...releaseAssets[1] }] });
} catch (error) { ambiguousMapping = String(error); }
check('an ambiguous platform mapping is rejected', ambiguousMapping.includes('ambiguous browser download mapping'));

let missingDownload = '';
try {
  normalizeGeneratedManifestAssetUrls(generatedManifest, {
    assets: releaseAssets.map((asset) => asset.name === 'win.exe' ? { ...asset, browser_download_url: '' } : asset),
  });
} catch (error) { missingDownload = String(error); }
check('a missing browser download URL is rejected', missingDownload.includes('missing browser download URL'));

// 发布前 normalize 已经把平台 URL 换成 releases/download/<tag>/<file>；drift guard 必须接受。
const publicTag = 'desktop-v0.2.33-1';
const publicish = {
  ...generatedManifest,
  platforms: {
    'windows-x86_64': { ...generatedManifest.platforms['windows-x86_64'], url: `https://github.com/${repo}/releases/download/${publicTag}/win.exe` },
    'darwin-aarch64': { ...generatedManifest.platforms['darwin-aarch64'], url: `https://github.com/${repo}/releases/download/${publicTag}/mac.tar.gz` },
  },
};
const accepted = normalizeGeneratedManifestAssetUrls(publicish, { assets: releaseAssets }, { repository: repo, tag: publicTag });
check('already-normalized public urls are accepted as-is',
  canonicalJson(accepted) === canonicalJson(publicish));

let ghostFile = '';
try {
  normalizeGeneratedManifestAssetUrls(
    { ...publicish, platforms: { ...publicish.platforms, 'windows-x86_64': { url: `https://github.com/${repo}/releases/download/${publicTag}/ghost.exe`, signature: 's' } } },
    { assets: releaseAssets },
    { repository: repo, tag: publicTag },
  );
} catch (error) { ghostFile = String(error); }
check('a public url naming a missing file is rejected', ghostFile.includes('does not have exactly once'));

const workflow = readFileSync('.github/workflows/desktop-update-manifest-drift.yml', 'utf8').replace(/\r\n?/g, '\n');
check('guard can be dispatched immediately after deployment', /workflow_dispatch:/.test(workflow));
check('guard also runs on a fixed schedule', /schedule:[\s\S]*cron:/.test(workflow));
check('guard has read-only repository permissions', /permissions:\s*\n\s*contents: read/.test(workflow));
check('workflow runs the same verifier tested here', workflow.includes('node scripts/verify-desktop-update-manifest.mjs'));

console.log(`desktop update manifest drift: ${passed}/${total} checks passed`);
