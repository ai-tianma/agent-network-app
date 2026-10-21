#!/usr/bin/env node
/**
 * release-timeline.mjs — 只读发版耗时复跑脚本
 *
 * 用途：从 GitHub API 取最近 N 个 release 的关键时间点，算各段耗时与分布，
 *       输出可直接贴进卡片的 markdown 表。以后每周复跑看趋势。
 *
 * 依赖：node >= 20（内置 fetch）+ 已登录的 gh（或 GITHUB_TOKEN）。
 * 只读：只用 GET；不建/改 release，不碰 workflow。
 *
 * 用法：
 *   node release-timeline.mjs --repo sleep2agi/agent-network-app --n 20
 *   node release-timeline.mjs --repo sleep2agi/agent-network --n 10 --json
 *   node release-timeline.mjs --repo ... --n 20 --out /tmp/timeline.md
 *
 * 口径：
 *   ① 等派发 = release workflow run.created_at - 它之前最后一个已合并 PR 的 merged_at
 *   ② 排队   = run.run_started_at - run.created_at
 *   ③ 构建   = max(asset.created_at) - run.run_started_at
 *   ④ 发布   = published_at - release.created_at
 *   端到端   = published_at - 最后一个已合并 PR 的 merged_at
 *   草稿（draft / 无 published_at）= 端到端 ∞，另报「release 对象 → 产物」延迟。
 *   重复 tag：同一 tag 出现多个 release 对象时逐行列出并标记 duplicate。
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const REPO = arg("repo");
const N = Number(arg("n", "20"));
const JSON_OUT = process.argv.includes("--json");
const OUT = arg("out", "");
if (!REPO) {
  console.error("usage: node release-timeline.mjs --repo owner/name [--n 20] [--json] [--out file]");
  process.exit(2);
}

/**
 * Token:先看环境变量,再试 PATH 上的 `gh`。
 * (原来这里写死了一个家目录里的绝对路径 —— 那是本机的布局,进公开仓会让别人跑不起来。)
 */
function resolveToken() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env && env.trim()) return env.trim();
  try {
    return execFileSync("gh", ["auth", "token"], { env: process.env, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    throw new Error("no GitHub token: set GITHUB_TOKEN, or run `gh auth login`");
  }
}
const TOKEN = resolveToken();

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

const p = (s) => (s ? new Date(s) : null);
const mins = (a, b) => (a && b ? (p(a) - p(b)) / 60000 : null);
const hm = (s) => (s ? p(s).toISOString().slice(5, 16).replace("T", " ") : "—");
const fmt = (x) => (x === null || x === undefined ? "—" : `${x.toFixed(0)}m`);

function stats(arr) {
  const v = arr.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return {
    n: v.length,
    med: +v[Math.floor((v.length - 1) / 2)].toFixed(1),
    p90: +v[Math.min(v.length - 1, Math.ceil(v.length * 0.9) - 1)].toFixed(1),
    max: +v[v.length - 1].toFixed(1),
  };
}

async function paginate(path, maxPages, stopWhen) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const raw = await api(`${path}${sep}per_page=100&page=${page}`);
    const batch = Array.isArray(raw) ? raw : (raw.workflow_runs ?? raw.releases ?? raw.items ?? []);
    if (!batch.length) break;
    out.push(...batch);
    if (stopWhen && stopWhen(batch[batch.length - 1])) break;
  }
  return out;
}

(async () => {
  const releases = await api(`/repos/${REPO}/releases?per_page=${Math.max(N, 20)}`);
  const chosen = releases.slice(0, N);
  const oldest = p(chosen[chosen.length - 1]?.created_at)?.getTime() ?? Date.now();
  const runs = await paginate(`/repos/${REPO}/actions/runs`, 10, (last) => p(last.created_at)?.getTime() < oldest);
  const mergedPrs = await paginate(`/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc`, 5);

  const releaseRuns = runs.filter((r) => /release/i.test(r.name) && r.event !== "pull_request");
  const merged = mergedPrs.filter((x) => x.merged_at);

  const tagCount = {};
  for (const r of chosen) tagCount[r.tag_name] = (tagCount[r.tag_name] || 0) + 1;

  const rows = chosen.map((r) => {
    const created = p(r.created_at);
    const assets = (r.assets || []).map((a) => a.created_at);
    const lastAsset = assets.length ? assets.sort().at(-1) : null;
    const cand = releaseRuns.filter((x) => Math.abs((p(x.created_at) - created) / 60000) < 180);
    const run = cand.sort((a, b) => Math.abs(p(a.created_at) - created) - Math.abs(p(b.created_at) - created))[0] || null;
    let lastPr = null;
    if (run) {
      const before = merged.filter((x) => p(x.merged_at) <= p(run.created_at));
      if (before.length) lastPr = before.sort((a, b) => p(b.merged_at) - p(a.merged_at))[0];
    }
    return {
      tag: r.tag_name,
      draft: r.draft,
      duplicate: tagCount[r.tag_name] > 1,
      created: r.created_at,
      lastAsset,
      published: r.published_at,
      runCreated: run?.created_at ?? null,
      runStarted: run?.run_started_at ?? null,
      wait: run && lastPr ? mins(run.created_at, lastPr.merged_at) : null,
      queue: run ? mins(run.run_started_at, run.created_at) : null,
      build: run && lastAsset ? mins(lastAsset, run.run_started_at) : null,
      publishLag: lastAsset ? mins(r.published_at, lastAsset) : null,
      e2e: lastPr ? mins(r.published_at, lastPr.merged_at) : null,
      lastPr: lastPr?.number ?? null,
      assetLate: !r.published_at && lastAsset ? mins(lastAsset, r.created_at) : null,
    };
  });

  if (JSON_OUT) {
    console.log(JSON.stringify(rows, null, 1));
    return;
  }

  const published = rows.filter((x) => x.published);
  const drafts = rows.filter((x) => !x.published);
  const lines = [];
  lines.push(`## ${REPO} · 最近 ${rows.length} 个 release 耗时（只读）`);
  lines.push("");
  lines.push("| # | 版本 | 状态 | tag 建立 | 产物就绪 | 发布 | 等派发 | 排队 | 构建 | 端到端 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  rows.forEach((x, i) => {
    const state = x.published ? "published" : x.draft ? "**draft**" : "未发布";
    lines.push(
      `| ${i + 1} | ${x.tag.replace(/^desktop-v/, "").replace(/^internal-superseded-/, "superseded ")} | ${state} ${x.duplicate ? "·dup" : ""} | ${hm(x.created)} | ${hm(x.lastAsset)} | ${hm(x.published)} | ${fmt(x.wait)} | ${fmt(x.queue)} | ${fmt(x.build)} | ${x.published ? (x.e2e !== null ? fmt(x.e2e) : '—') : `∞（资产 ${fmt(x.assetLate)}）`} |`,
    );
  });
  lines.push("");
  const sE2E = stats(published.map((x) => x.e2e).filter((v) => v !== null));
  const sBuild = stats(rows.map((x) => x.build));
  const sQueue = stats(rows.map((x) => x.queue));
  const sPub = stats(rows.map((x) => x.publishLag));
  const sWait = stats(rows.map((x) => x.wait));
  lines.push(
    `**分布（已发布 ${published.length} / ${rows.length}）**：端到端 中位 ${sE2E?.med ?? "—"}m · p90 ${sE2E?.p90 ?? "—"}m · 最长 ${sE2E?.max ?? "—"}m`,
  );
  lines.push(
    `分段：等派发 ${sWait?.med ?? "—"}m（p90 ${sWait?.p90 ?? "—"}）｜排队 ${sQueue?.med ?? "—"}m（max ${sQueue?.max ?? "—"}）｜构建 ${sBuild?.med ?? "—"}m（p90 ${sBuild?.p90 ?? "—"}，max ${sBuild?.max ?? "—"}）｜产物→发布 ${sPub?.med ?? "—"}m`,
  );
  lines.push("");
  lines.push(
    `**未发布 ${drafts.length} 个**${drafts.length ? "：" + drafts.map((x) => x.tag).join("、") : ""}${rows.some((x) => x.duplicate) ? "；**存在重复 tag**：" + [...new Set(rows.filter((x) => x.duplicate).map((x) => x.tag))].join("、") : ""}`,
  );
  const out = lines.join("\n");
  if (OUT) {
    writeFileSync(OUT, out + "\n");
    console.log(`written ${OUT} (${rows.length} releases)`);
  } else {
    console.log(out);
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
