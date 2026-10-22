// #2064: one tag, one release object.
//
// 0.2.287 实测：两个矩阵 job 并行跑时，各自在开始时清 stale draft、结束时由
// tauri-action 各建一个同 tag 草稿（420936057 只有 darwin 资产、420938453 只有
// windows 资产）。verify-draft 取到第一个就报 `draft is missing
// ANet_0.2.287_x64-setup.exe`——看起来像"资产没编出来"，实际是 release 对象分裂。
//
// #1035 先修成「macOS 建、其它平台等并复用 releaseId」；#1034 进一步收敛成
// 唯一的 `prepare-release`（published→fail / 0 draft→create / 1 draft→reuse /
// >1 draft→fail-closed），所有 matrix job 只认它输出的 release_id，不再有
// 「谁先谁后」的等待窗口。这些断言读工作流文本 + prepare 的纯函数，和仓库里
// 既有 macOS DMG / 发布说明测试同一风格。
import { readFileSync } from 'node:fs';
import {
  extractReleaseBody,
  requireRequestedCommit,
  planReleaseDraft,
  prepareReleaseDraft,
  staleAssetsFor,
} from '../scripts/prepare-desktop-release.mjs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

// Windows runner 上 git checkout 会用 CRLF，所有对 YAML 的文本断言必须先归一，
// 否则 `/build-release:\n/` 这类断言只在 Linux 成立（#1034 的两条 Windows unit failure 就是这个）。
const wf = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');
const tag = 'desktop-v0.2.287';

// 1. 决策点唯一：prepare-release 创建/复用草稿，matrix job 不再自己建或删。
ck('存在唯一的 prepare-release job', /prepare-release:[\s\S]{0,200}runs-on: ubuntu-latest/.test(wf));
ck('prepare-release 输出 release_id', /prepare-release:[\s\S]{0,600}release_id: \$\{\{ steps\.prepare\.outputs\.release_id \}\}/.test(wf));
ck('prepare-release 调用专用脚本', wf.includes('node scripts/prepare-desktop-release.mjs'));
ck('build-release 依赖 prepare-release', /build-release:\n    needs: \[prepare-release\]/.test(wf));
ck('矩阵 job 内不再有按 tag 删草稿的步骤', !wf.includes('Remove stale draft releases for this tag'));
ck('矩阵 job 内不再等其它平台先建草稿', !wf.includes('Wait for the single draft release created by the macOS job'));

// 2. 所有矩阵 job 只认 prepare-release 的 releaseId（不再按 runner.os 分支）。
ck('tauri-action 使用 prepare-release 的 releaseId',
  /releaseId: \$\{\{ needs\.prepare-release\.outputs\.release_id \}\}/.test(wf));
ck('releaseId 不再按 runner.os 条件分支',
  !/releaseId: \$\{\{ runner\.os == 'macOS'/.test(wf));

// 3. 验证阶段先把「同 tag 草稿数量」点清，避免误报成缺资产（#1035 保留）。
ck('verify-draft 先断言恰好一个草稿',
  /- name: Require exactly one draft release for this tag/.test(wf) && /expected exactly one draft release/.test(wf));
ck('数量断言在资产断言之前',
  wf.indexOf('Require exactly one draft release for this tag') < wf.indexOf('Require selected platform draft assets, updater entries, and checksums'));

// 4. 纯函数判定：0/1/2 drafts 与 published。
ck('0 个草稿 → 创建', planReleaseDraft([], tag).action === 'create');
ck('1 个草稿 → 复用同一个 id',
  planReleaseDraft([{ id: 11, tag_name: tag, draft: true }], tag).releaseId === 11);
ck('2 个草稿 → fail-closed，不猜哪个是本次的',
  planReleaseDraft([{ id: 11, tag_name: tag, draft: true }, { id: 12, tag_name: tag, draft: true }], tag).reason === 'multiple-drafts');
ck('已发布 → 拒绝复用该 tag',
  planReleaseDraft([{ id: 13, tag_name: tag, draft: false }], tag).reason === 'already-published');
ck('别的 tag 不影响判定',
  planReleaseDraft([{ id: 14, tag_name: 'desktop-v0.2.286', draft: true }], tag).action === 'create');

// 5. 分页 / commit / 说明 / 旧资产回收（exact-review 4351263301/304/322/338）
ck('release 列表用 --slurp 分页再摊平', (() => {
  const calls: string[][] = [];
  prepareReleaseDraft({
    version: '0.2.287',
    listReleases: () => {
      calls.push(['slurp']);
      return [{ id: 1, tag_name: 'desktop-v0.2.287', draft: true }];
    },
    listAssets: () => [[{ id: 3, name: 'ANet_0.2.287_x64_en-US.msi' }]],
    log: () => {},
  });
  return calls.length === 1;
})());

ck('建草稿带 target_commitish 与用户可见说明', (() => {
  let args: string[] = [];
  prepareReleaseDraft({
    version: '0.2.287',
    commit: 'a'.repeat(40),
    body: 'What is new in 0.2.287:\n- x',
    listReleases: () => [],
    run: (a: string[]) => { args = a; return { id: 99 }; },
    log: () => {},
  });
  return args.includes('target_commitish=' + 'a'.repeat(40)) && args.some((a) => a.startsWith('body='));
})());

ck('include_linux=false 时回收 .deb/.deb.sig', JSON.stringify(staleAssetsFor([
  { id: 1, name: 'ANet_0.2.287_amd64.deb' },
  { id: 2, name: 'ANet_0.2.287_amd64.deb.sig' },
  { id: 3, name: 'ANet_0.2.287_x64_en-US.msi' },
], { includeLinux: false })) === JSON.stringify([
  { id: 1, name: 'ANet_0.2.287_amd64.deb' },
  { id: 2, name: 'ANet_0.2.287_amd64.deb.sig' },
]));
ck('include_linux=true 时不动 .deb', staleAssetsFor([{ id: 1, name: 'x_amd64.deb' }], { includeLinux: true }).length === 0);

ck('从 workflow 解出 releaseBody 并替换 __VERSION__',
  extractReleaseBody(wf, '0.2.287').startsWith('Signed and notarized update'));

// 6. dry run 仍能构建 + updater 写入串行 + 二进制上传走 uploads host
ck('publish=false 的 dry run 仍会跑 build matrix',
  /build-release:[\s\S]{0,400}if: always\(\) && \(inputs\.publish == false \|\| needs\.prepare-release\.result == 'success'\)/.test(wf));
ck('矩阵串行写同一个 latest.json', /max-parallel: 1/.test(wf));
ck('二进制资产上传使用完整 uploads.github.com URL',
  /https:\/\/uploads\.github\.com\/repos\//.test(readFileSync(new URL('../scripts/normalize-desktop-update-manifest.mjs', import.meta.url), 'utf8'))
  && !readFileSync(new URL('../scripts/normalize-desktop-update-manifest.mjs', import.meta.url), 'utf8').includes("'--hostname', 'uploads.github.com'"));

// 7. REQUESTED_COMMIT 校验 + target 一致性
ck('REQUESTED_COMMIT 必须是 40 位小写 SHA', (() => {
  try { requireRequestedCommit('ABC123'); return false; } catch { return true; }
})()
  && requireRequestedCommit('a'.repeat(40)) === 'a'.repeat(40));
ck('prepare 在 requireCommit 时拒绝缺 commit', (() => {
  try { prepareReleaseDraft({ version: '0.2.287', requireCommit: true, commit: '', listReleases: () => [], log: () => {} }); return false; } catch { return true; }
})());
ck('建草稿把 target_commitish 写进请求', (() => {
  let args: string[] = [];
  prepareReleaseDraft({
    version: '0.2.287',
    commit: 'b'.repeat(40),
    listReleases: () => [],
    run: (a: string[]) => { args = a; return { id: 5 }; },
    log: () => {},
  });
  return args.includes(`target_commitish=${'b'.repeat(40)}`);
})());
ck('复用指向别的 SHA 的草稿 → fail-closed', (() => {
  try {
    prepareReleaseDraft({
      version: '0.2.287',
      commit: 'b'.repeat(40),
      listReleases: () => [{ id: 6, tag_name: tag, draft: true, target_commitish: 'c'.repeat(40) }],
      listAssets: () => [[]],
      log: () => {},
    });
    return false;
  } catch (error) { return String(error).includes('targets'); }
})());
ck('复用指向 ref 的草稿，ref resolve 到本次 SHA → 允许', (() => {
  const result = prepareReleaseDraft({
    version: '0.2.287',
    commit: 'b'.repeat(40),
    listReleases: () => [{ id: 7, tag_name: tag, draft: true, target_commitish: 'main' }],
    listAssets: () => [[]],
    run: (args: string[]) => {
      if (!args.some((arg) => arg.includes('/commits/main'))) throw new Error(`unexpected gh call: ${args.join(' ')}`);
      return { sha: 'b'.repeat(40) };
    },
    log: () => {},
  });
  return result.action === 'reuse' && result.releaseId === 7;
})());
ck('复用指向 ref 的草稿，ref resolve 到别的 SHA → fail-closed', (() => {
  try {
    prepareReleaseDraft({
      version: '0.2.287',
      commit: 'b'.repeat(40),
      listReleases: () => [{ id: 7, tag_name: tag, draft: true, target_commitish: 'main' }],
      listAssets: () => [[]],
      resolveCommit: () => 'c'.repeat(40),
      log: () => {},
    });
    return false;
  } catch (error) { return String(error).includes('targets'); }
})());
ck('复用指向 ref 的草稿，ref resolve 失败 → fail-closed', (() => {
  try {
    prepareReleaseDraft({
      version: '0.2.287',
      commit: 'b'.repeat(40),
      listReleases: () => [{ id: 7, tag_name: tag, draft: true, target_commitish: 'missing-ref' }],
      listAssets: () => [[]],
      resolveCommit: () => { throw new Error('not found'); },
      log: () => {},
    });
    return false;
  } catch (error) { return String(error).includes('not found'); }
})());

// 8. include_linux 变化时连旧 manifest 一起回收 + 创建草稿前先过 exact-commit 门
ck('回收 .deb 时同时删掉旧 latest.json', (() => {
  const deleted: number[] = [];
  prepareReleaseDraft({
    version: '0.2.287',
    listReleases: () => [{ id: 21, tag_name: tag, draft: true, target_commitish: 'main' }],
    listAssets: () => [[
      { id: 31, name: 'ANet_0.2.287_amd64.deb' },
      { id: 32, name: 'ANet_0.2.287_amd64.deb.sig' },
      { id: 33, name: 'latest.json' },
    ]],
    deleteAsset: (id: number) => { deleted.push(id); return {}; },
    includeLinux: false,
    log: () => {},
  });
  return deleted.includes(31) && deleted.includes(32) && deleted.includes(33);
})());
ck('deb/sig 已不存在时仍回收旧 latest.json', (() => {
  const deleted: number[] = [];
  prepareReleaseDraft({
    version: '0.2.287',
    listReleases: () => [{ id: 22, tag_name: tag, draft: true, target_commitish: 'main' }],
    listAssets: () => [[{ id: 34, name: 'latest.json' }]],
    deleteAsset: (id: number) => { deleted.push(id); return {}; },
    resolveCommit: () => 'b'.repeat(40),
    commit: 'b'.repeat(40),
    includeLinux: false,
    log: () => {},
  });
  return JSON.stringify(deleted) === JSON.stringify([34]);
})());
ck('创建/复用 release 之前先跑 exact-merged-commit 门',
  /prepare-release:[\s\S]{0,900}- name: Require exact merged commit[\s\S]{0,1200}node scripts\/prepare-desktop-release\.mjs/.test(wf));
ck('prepare 的 checkout 有完整历史', /prepare-release:[\s\S]{0,400}fetch-depth: 0/.test(wf));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
