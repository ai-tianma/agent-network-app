#!/usr/bin/env node

// 一个 tag 只允许一个 release 对象，而且必须由**一个** job 决定用哪个。
//
// 0.2.274 的教训:每个 matrix job 各自按 tag 创建 release(draft)，重跑就多一个草稿，
// 同一 tag 上出现 draft + published 并存。这里把「查-建-复用」收敛成单点：
//   * 同 tag 已有 published → fail（要重发就 bump 版本号）；
//   * 0 个 draft → 创建一个 draft，输出 release_id；
//   * 1 个 draft → 复用，输出它的 release_id；
//   * >1 个 draft → fail-closed（不猜哪个才是本次的）。
// 后面所有 matrix job 都只认这个 release_id，不再按 tag 各自创建。

import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPOSITORY = 'sleep2agi/agent-network-app';

export const extractReleaseBody = (workflowText, version) => {
  if (typeof workflowText !== 'string') throw new Error('workflow text is required');
  const lines = workflowText.split('\n');
  const start = lines.findIndex((line) => /^\s{10}releaseBody: \|-\s*$/.test(line));
  if (start < 0) throw new Error('releaseBody block not found in the release workflow');
  const indent = (lines[start].match(/^\s*/) ?? [''])[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { body.push(''); continue; }
    const currentIndent = (line.match(/^\s*/) ?? [''])[0].length;
    if (currentIndent <= indent) break;
    body.push(line.slice(indent + 2));
  }
  const text = body.join('\n').replaceAll('__VERSION__', version).trim();
  if (!text) throw new Error('releaseBody block is empty');
  return text;
};

export const planReleaseDraft = (releases, tag) => {
  if (!tag) throw new Error('tag is required');
  if (!Array.isArray(releases)) throw new Error('releases must be an array');
  const same = releases.filter((release) => release?.tag_name === tag);
  const published = same.filter((release) => release.draft !== true);
  if (published.length > 0) {
    return { action: 'fail', reason: 'already-published', releaseIds: published.map((release) => release.id) };
  }
  const drafts = same.filter((release) => release.draft === true);
  if (drafts.length === 0) return { action: 'create', releaseIds: [] };
  if (drafts.length === 1) return { action: 'reuse', releaseId: drafts[0].id, releaseIds: [drafts[0].id] };
  return { action: 'fail', reason: 'multiple-drafts', releaseIds: drafts.map((release) => release.id) };
};

const gh = (args, { parse = true } = {}) => {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return parse ? JSON.parse(result.stdout) : result.stdout;
};

export const staleAssetsFor = (assets, { includeLinux }) => {
  if (!Array.isArray(assets)) throw new Error('assets must be an array');
  if (includeLinux) return [];
  // 上一次 include_linux=true 的失败尝试会留下 .deb / .deb.sig；这次不编 Linux 时必须清掉，
  // 否则 verify-draft 会看到「Linux assets present but Linux was not selected」。
  return assets
    .filter((asset) => /_amd64\.deb(?:\.sig)?$/.test(asset?.name ?? ''))
    .map((asset) => ({ id: asset.id, name: asset.name }));
};

export const requireRequestedCommit = (commit) => {
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
    throw new Error(`REQUESTED_COMMIT must be a 40-character lowercase SHA (got ${JSON.stringify(commit ?? '')})`);
  }
  return commit;
};

export function prepareReleaseDraft({
  repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
  version,
  commit = '',
  requireCommit = false,
  includeLinux = true,
  body = '',
  run = (args) => gh(args),
  resolveCommit = (ref) => {
    const resolved = run(['api', `repos/${repository}/commits/${encodeURIComponent(ref)}`]);
    const sha = typeof resolved === 'string' ? resolved.trim() : resolved?.sha;
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) {
      throw new Error(`could not resolve target_commitish ${JSON.stringify(ref)} to a 40-character SHA`);
    }
    return sha;
  },
  // --slurp 让分页结果是一个数组的数组；直接 JSON.parse 多页拼接会炸（gh 的手册明确要求）。
  listReleases = () => {
    const pages = run(['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp']);
    return (Array.isArray(pages) ? pages : []).flat();
  },
  listAssets = (releaseId) => run(['api', `repos/${repository}/releases/${releaseId}/assets?per_page=100`, '--paginate', '--slurp']),
  deleteAsset = (assetId) => run(['api', '-X', 'DELETE', `repos/${repository}/releases/assets/${assetId}`]),
  createRelease = (tag, name) => run([
    'api', '-X', 'POST', `repos/${repository}/releases`,
    '-f', `tag_name=${tag}`,
    '-f', `name=${name}`,
    '-F', 'draft=true',
    ...(commit ? ['-f', `target_commitish=${commit}`] : []),
    ...(body ? ['-f', `body=${body}`] : []),
  ]),
  log = (line) => console.log(line),
} = {}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error(`version is required (got ${JSON.stringify(version)})`);
  if (requireCommit) requireRequestedCommit(commit);
  const tag = `desktop-v${version}`;
  const releases = listReleases();
  const plan = planReleaseDraft(Array.isArray(releases) ? releases : [], tag);
  if (plan.action === 'fail') {
    throw new Error(`${tag}: ${plan.reason} (release ids: ${plan.releaseIds.join(', ')}) — bump the version instead of reusing this tag`);
  }
  if (plan.action === 'reuse') {
    // 复用必须对得上本次要发的 commit：指向别的 commit 的草稿会让 verify-draft 与资产错配。
    // tauri-action 常把 target_commitish 留成分支名，因此 ref 必须先 resolve 成 SHA；
    // 无法解析或不等于本次 commit 都在任何昂贵 build 之前 fail-closed。
    const reused = (Array.isArray(releases) ? releases : []).find((release) => release?.id === plan.releaseId);
    const target = reused?.target_commitish;
    if (commit) {
      if (typeof target !== 'string' || target.length === 0) {
        throw new Error(`${tag}: draft ${plan.releaseId} has no target_commitish to compare with ${commit}`);
      }
      const resolvedTarget = /^[0-9a-f]{40}$/.test(target) ? target : resolveCommit(target);
      if (resolvedTarget !== commit) {
        throw new Error(`${tag}: draft ${plan.releaseId} targets ${target} (${resolvedTarget}), not ${commit}`);
      }
      if (resolvedTarget !== target) log(`${tag}: draft ${plan.releaseId} target_commitish ${target} resolved to ${resolvedTarget}`);
    }
    const pages = listAssets(plan.releaseId);
    const assets = (Array.isArray(pages) ? pages : []).flat();
    const stale = [
      ...staleAssetsFor(assets, { includeLinux }),
      ...(!includeLinux ? assets.filter((asset) => asset?.name === 'latest.json') : []),
    ];
    for (const asset of stale) {
      log(`${tag}: removing stale asset ${asset.name} (id ${asset.id}) because include_linux=${includeLinux}`);
      deleteAsset(asset.id);
    }
    log(`${tag}: reusing draft release ${plan.releaseId}${stale.length ? ` after removing ${stale.length} stale asset(s)` : ''}`);
    return { action: 'reuse', tag, releaseId: plan.releaseId, removedAssets: stale };
  }
  const created = createRelease(tag, `ANet Desktop v${version}`);
  if (!Number.isInteger(created?.id)) throw new Error(`${tag}: created release has no numeric id`);
  log(`${tag}: created draft release ${created.id} targeting ${commit || '(default branch)'}`);
  return { action: 'create', tag, releaseId: created.id, removedAssets: [] };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    const version = process.env.VERSION || JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    const workflowText = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
    const includeLinux = (process.env.INCLUDE_LINUX ?? 'true') === 'true';
    const result = prepareReleaseDraft({
      version,
      requireCommit: true,
      commit: process.env.REQUESTED_COMMIT || '',
      includeLinux,
      body: extractReleaseBody(workflowText, version),
    });
    const line = `release_id=${result.releaseId}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
    console.log(line.trim());
  } catch (error) {
    console.error(`prepare release failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
