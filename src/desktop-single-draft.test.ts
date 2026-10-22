// #2064: one tag, one release object.
//
// 0.2.287 实测：两个矩阵 job 并行跑时，各自在开始时清 stale draft、结束时由
// tauri-action 各建一个同 tag 草稿（420936057 只有 darwin 资产、420938453 只有
// windows 资产）。verify-draft 取到第一个就报 `draft is missing
// ANet_0.2.287_x64-setup.exe`——看起来像"资产没编出来"，实际是 release 对象分裂。
//
// 这些断言在修复前失败（工作流里没有唯一创建者、没有 releaseId 复用、没有数量断言），
// 修复后通过。它们读的是工作流文本，和仓库里既有的 macOS DMG / 发布说明测试同一风格。
import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

const wf = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');

// 1. 只有 macOS job 允许清理/创建草稿；其它平台不再有自己的清理步骤。
ck('清 stale draft 只在 macOS job 执行',
  /- name: Remove stale draft releases for this tag[\s\S]{0,400}?if: inputs\.publish == true && runner\.os == 'macOS'/.test(wf));
ck('清理步骤没有变成「所有平台都跑」',
  !/Remove stale draft releases for this tag \(idempotent release creation\)\n        if: inputs\.publish == true\n/.test(wf));

// 2. 非 macOS 平台等 macOS 建好草稿，然后按 releaseId 追加资产。
ck('非 macOS 会等 macOS 的草稿', /- name: Wait for the single draft release created by the macOS job[\s\S]{0,120}?runner\.os != 'macOS'/.test(wf));
ck('用 macOS 资产名判断草稿已就绪', /mac_asset="ANet_\$\{version\}_aarch64\.app\.tar\.gz"/.test(wf));
ck('tauri-action 复用该 releaseId（macOS 留空）',
  /releaseId: \$\{\{ runner\.os == 'macOS' && '' \|\| steps\.draft\.outputs\.id \}\}/.test(wf));
ck('等待有上限并明确拒绝再建第二个 release 对象',
  /for attempt in \$\(seq 1 120\)/.test(wf) && /refusing to create a second release object/.test(wf));

// 3. 验证阶段先把「同 tag 草稿数量」点清，避免误报成缺资产。
ck('verify-draft 先断言恰好一个草稿',
  /- name: Require exactly one draft release for this tag/.test(wf) && /expected exactly one draft release/.test(wf));
ck('数量断言在资产断言之前',
  wf.indexOf('Require exactly one draft release for this tag') < wf.indexOf('Require selected platform draft assets, updater entries, and checksums'));


// 4. 数量断言的取数方式：`gh api --paginate --jq "… | length"` 每页各吐一个数字
// （0.2.287 实测 "1\n0\n0"），和 "1" 比较永远失败——这正是 #1035 之后那单
// verify-draft 挂掉的原因。必须数 id 的行数。
ck('草稿计数按行数取（跨页只得到一个整数）',
  /count=\$\(gh api[\s\S]{0,200}?\|\s*wc -l/.test(wf));
ck('草稿计数不再直接比较 paginate 的 length 输出',
  !/count=\$\(gh api[\s\S]{0,200}?\|\s*length"\)/.test(wf));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
