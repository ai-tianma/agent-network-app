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
import { planReleaseDraft } from '../scripts/prepare-desktop-release.mjs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

const wf = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
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

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
