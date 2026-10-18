// run: bun src/node-secret-keys.test.ts
import { parseSecretKeys, CLIENT_SECRET_KEYS_MAX } from './node-secret-keys';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

// ── 三态：没上报 ≠ 没有 ──
ck('undefined → unknown（旧 Hub/旧节点，不渲染空态）', parseSecretKeys(undefined).kind === 'unknown');
ck('null → unknown', parseSecretKeys(null).kind === 'unknown');
ck('空字符串 → unknown（不是"没有"）', parseSecretKeys('').kind === 'unknown');
ck('坏 JSON → unknown（不崩）', parseSecretKeys('{oops').kind === 'unknown');
ck('JSON 但不是数组 → unknown', parseSecretKeys('{"a":1}').kind === 'unknown');
ck("'[]' → none（节点明确说一个都没有）", parseSecretKeys('[]').kind === 'none');
ck('全是非法名 → none（不是 unknown：字段确实上报了）', parseSecretKeys('["bad-name","lower"]').kind === 'none');

// ── 列表 ──
{
  const v = parseSecretKeys('["BETA_KEY","ALPHA_KEY","ALPHA_KEY"]');
  ck('排序 + 去重', v.kind === 'list' && v.keys.join(',') === 'ALPHA_KEY,BETA_KEY');
}
ck('已是数组时也接受', (() => { const v = parseSecretKeys(['X_KEY']); return v.kind === 'list' && v.keys[0] === 'X_KEY'; })());

// ── 第二道防线：值形状的东西不渲染 ──
{
  const value = 'ghp_' + 'A'.repeat(40);
  const v = parseSecretKeys(JSON.stringify(['OK_KEY', value, 'mixedCase', 'WITH-DASH']));
  ck('只留下合法名字，值/小写/带连字符全丢', v.kind === 'list' && v.keys.join(',') === 'OK_KEY', JSON.stringify(v));
}

// ── 上限 ──
{
  const many = Array.from({ length: CLIENT_SECRET_KEYS_MAX + 10 }, (_, i) => `KEY_${String(i).padStart(3, '0')}`);
  const v = parseSecretKeys(JSON.stringify(many));
  ck('列表被封顶', v.kind === 'list' && v.keys.length === CLIENT_SECRET_KEYS_MAX);
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
