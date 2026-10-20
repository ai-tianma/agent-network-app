import { catalogErrorText, isOpenCodeV2Node, modelIdsFromCatalog } from './opencode-v2-model-list';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else { console.error('❌', n); } };

ck('v2 flag is a V2 node even if runtime label differs', isOpenCodeV2Node({ runtime: 'opencode-sdk', config_snapshot: { flags: { opencodeGeneration: 'v2' } } }));
ck('explicit v1 is not', isOpenCodeV2Node({ runtime: 'opencode-cli', config_snapshot: { flags: { opencodeGeneration: 'v1' } } }) === false);
ck('unknown generation still tries the server list for OpenCode runtimes', isOpenCodeV2Node({ runtime: 'opencode-sdk', config_snapshot: null }));
ck('other runtimes are not', isOpenCodeV2Node({ runtime: 'codex-sdk', config_snapshot: null }) === false);

const ids = modelIdsFromCatalog({
  providers: [{ id: 'deepseek', activation: 'enabled' }, { id: 'off', activation: 'disabled' }],
  models: [
    { providerId: 'deepseek', id: 'deepseek-flash' },
    { providerId: 'off', id: 'secret-model' },
    { providerId: 'deepseek', id: 'deepseek-flash' },
    { providerId: 'openai', id: 'gpt-6' },
  ],
});
ck('keeps provider/model and drops disabled providers and duplicates', JSON.stringify(ids) === JSON.stringify(['deepseek/deepseek-flash', 'openai/gpt-6']));
ck('empty snapshot is an empty list, not a builtin fallback', modelIdsFromCatalog(null).length === 0);
ck('not_opencode_v2 is readable', catalogErrorText('not_opencode_v2').includes('不是 OpenCode V2'));

console.log(`\n${p}/${t} 通过`);
if (p !== t) process.exit(1);
