// run: bun src/daemon-secret-keys.test.ts
import { DAEMON_KEYS_NONE, describeAllowedSecretKeys } from './daemon-secret-keys';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

// ── 三态 ──
ck('undefined → unknown（旧 Hub/daemon 不上报，不显示）', describeAllowedSecretKeys(undefined).kind === 'unknown');
ck('null → unknown', describeAllowedSecretKeys(null).kind === 'unknown');
ck('空数组 → none（明确未授权）', (() => {
  const v = describeAllowedSecretKeys([]);
  return v.kind === 'none' && v.text === DAEMON_KEYS_NONE;
})());
ck('全是非法名 → none（不是 unknown：字段确实上报了）',
  describeAllowedSecretKeys(['bad name', 'a/b']).kind === 'none');

// ── 列表 ──
{
  const v = describeAllowedSecretKeys(['B_KEY', 'A_KEY', 'A_KEY']);
  ck('排序 + 去重', v.kind === 'some' && v.keys.join(',') === 'A_KEY,B_KEY');
  ck('文案含名字', v.kind === 'some' && v.text.includes('A_KEY · B_KEY'));
}
{
  const many = Array.from({ length: 8 }, (_, i) => `KEY_${i}`);
  const v = describeAllowedSecretKeys(many);
  ck('超过 6 个 → 只列 6 个并给总数', v.kind === 'some' && v.text.includes('等 8 个'), v.kind === 'some' ? v.text : '');
}

// ── 只挡「明显不是名字」的串（不是值检测，理由见 helper 注释）──
{
  const v = describeAllowedSecretKeys(['OK_KEY', 'with space', 'a/b', 'x'.repeat(80)]);
  ck('空格/斜杠/超长的行被丢掉', v.kind === 'some' && v.keys.join(',') === 'OK_KEY', JSON.stringify(v));
}
ck('小写/混合大小写是合法名字（不丢）',
  (() => { const v = describeAllowedSecretKeys(['openai_api_key', 'GITHUB_PAT']); return v.kind === 'some' && v.keys.length === 2; })());

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
