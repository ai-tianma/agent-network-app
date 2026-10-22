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

export function prepareReleaseDraft({
  repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
  version,
  run = (args) => gh(args),
  listReleases = () => run(['api', `repos/${repository}/releases?per_page=100`, '--paginate']),
  createRelease = (tag, name) => run(['api', '-X', 'POST', `repos/${repository}/releases`, '-f', `tag_name=${tag}`, '-f', `name=${name}`, '-F', 'draft=true']),
  log = (line) => console.log(line),
} = {}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error(`version is required (got ${JSON.stringify(version)})`);
  const tag = `desktop-v${version}`;
  const releases = listReleases();
  const plan = planReleaseDraft(Array.isArray(releases) ? releases : [], tag);
  if (plan.action === 'fail') {
    throw new Error(`${tag}: ${plan.reason} (release ids: ${plan.releaseIds.join(', ')}) — bump the version instead of reusing this tag`);
  }
  if (plan.action === 'reuse') {
    log(`${tag}: reusing draft release ${plan.releaseId}`);
    return { action: 'reuse', tag, releaseId: plan.releaseId };
  }
  const created = createRelease(tag, `ANet Desktop v${version}`);
  if (!Number.isInteger(created?.id)) throw new Error(`${tag}: created release has no numeric id`);
  log(`${tag}: created draft release ${created.id}`);
  return { action: 'create', tag, releaseId: created.id };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    const version = process.env.VERSION || JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    const result = prepareReleaseDraft({ version });
    const line = `release_id=${result.releaseId}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
    console.log(line.trim());
  } catch (error) {
    console.error(`prepare release failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
