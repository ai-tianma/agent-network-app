// 金库密钥名「只差一点点」的提醒（2026-10-21：TM_PAT 与 TMPAT 同时存在）。
import {
  confusableSecretGroups,
  confusableSecretName,
  isInConfusableGroup,
  normalizeSecretName,
} from './secret-name-hints';

let passed = 0;
let total = 0;
function check(name: string, ok: unknown, extra = '') {
  total += 1;
  if (ok) {
    passed += 1;
    console.log(`✅ ${name}`);
  } else {
    console.log(`❌ ${name}${extra ? ` (${extra})` : ''}`);
  }
}

check('TM_PAT and TMPAT normalize to the same key', normalizeSecretName('TM_PAT') === normalizeSecretName('TMPAT'));
check('normalize lowercases and drops punctuation', normalizeSecretName('  Deeps-Key_01 ') === 'deepskey01');

const existing = ['PROVIDER_PROVIDER_KEY', 'TMPAT', 'TM_PAT'];

check('typing TM_PAT points at the existing TMPAT', confusableSecretName('TM_PAT', existing) === 'TMPAT');
check('typing TMPAT points at the existing TM_PAT', confusableSecretName('TMPAT', existing) === 'TM_PAT');
check('typing tm_pat points at one of them', confusableSecretName('tm_pat', existing) !== null);
check('an exact match still warns when a confusable sibling exists', confusableSecretName('TMPAT', existing) === 'TM_PAT');
check('an exact match with no sibling is not a confusable warning', confusableSecretName('TMPAT', ['TMPAT', 'OTHER']) === null);
check('an unrelated name is not a confusable warning', confusableSecretName('DEEPSEEK_API_KEY', existing) === null);
check('an empty input is not a confusable warning', confusableSecretName('', existing) === null && confusableSecretName('   ', existing) === null);
check('different names that merely look alike are not confused', confusableSecretName('DEEPSEEK_KEY', ['DEEPSEEK_API_KEY']) === null);

const groups = confusableSecretGroups(existing);
check('the near-identical pair is one group', groups.length === 1 && groups[0].length === 2 && groups[0].includes('TMPAT') && groups[0].includes('TM_PAT'), JSON.stringify(groups));
check('a normal list has no group', confusableSecretGroups(['A_KEY', 'B_KEY']).length === 0);
check('a group member is flagged', isInConfusableGroup('TM_PAT', groups) && isInConfusableGroup('TMPAT', groups));
check('a non-member is not flagged', !isInConfusableGroup('PROVIDER_PROVIDER_KEY', groups));

console.log(`secret name hints: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
