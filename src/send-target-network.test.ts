// 跨网络私信:#1968(admin 2026-10-21「其他用户发不了消息给 Agent 节点」)。
//
// 纯函数,无 react-native、无 fetch。断言的是「发送时用目标 alias 所在的网络」这条规则本身。
import {
  aliasNetworkFor,
  networkCandidates,
  rememberAliasNetworks,
  type AliasNetworkMap,
} from './send-target-network';

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

const map: AliasNetworkMap = new Map();

// 列表是跨网络的:两个网络的行混在一起。
rememberAliasNetworks(map, [
  { alias: 'tang02', network_id: 'net_399bdf86f528' },
  { alias: 'tang03', network_id: 'net_399bdf86f528' },
  { alias: 'mine', network_id: 'net_ac567b4ab74e' },
]);

check('alias 记住它所在的网络', aliasNetworkFor(map, 'tang02') === 'net_399bdf86f528');
check('同一个人另一个网络里的 alias 记的是另一个网络', aliasNetworkFor(map, 'mine') === 'net_ac567b4ab74e');
check('没见过的 alias ⇒ undefined', aliasNetworkFor(map, 'nope') === undefined);
check('空 alias ⇒ undefined', aliasNetworkFor(map, '') === undefined && aliasNetworkFor(map, '  ') === undefined && aliasNetworkFor(map, null) === undefined);

// 老 hub 的行没有 network_id ⇒ 不记(不能记成空串,否则会把发送钉死在空网络上)。
const old = new Map<string, string>();
rememberAliasNetworks(old, [{ alias: 'legacy' }, { alias: 'legacy2', network_id: '   ' }]);
check('没有 network_id 的行不记', aliasNetworkFor(old, 'legacy') === undefined && aliasNetworkFor(old, 'legacy2') === undefined);
check('remember 对 undefined/null 安全', rememberAliasNetworks(old, undefined).size === old.size && rememberAliasNetworks(old, null).size === old.size);

// 候选网络:失败过的那个排除,重复的只留第一次,空值忽略。
check('候选排除失败的网络', JSON.stringify(networkCandidates('net_a', ['net_a', 'net_b', 'net_c'])) === JSON.stringify(['net_b', 'net_c']));
check('候选去重', JSON.stringify(networkCandidates('net_a', ['net_b', 'net_b', 'net_c'])) === JSON.stringify(['net_b', 'net_c']));
check('候选忽略空值', JSON.stringify(networkCandidates('net_a', ['', null, undefined, 'net_b'])) === JSON.stringify(['net_b']));
check('失败的网络是唯一候选 ⇒ 没有候选', networkCandidates('net_a', ['net_a']).length === 0);
check('没有失败网络 ⇒ 全部候选保留', JSON.stringify(networkCandidates(null, ['net_a', 'net_b'])) === JSON.stringify(['net_a', 'net_b']));

// 复现 admin 的场景:tang 落在自己的个人网络,目标在默认网络。
const tang = new Map<string, string>();
rememberAliasNetworks(tang, [{ alias: 'tang02', network_id: 'net_399bdf86f528' }]);
const wrong = 'net_ac567b4ab74e';
const candidates = networkCandidates(wrong, [aliasNetworkFor(tang, 'tang02'), wrong]);
check('第一次就该用目标所在网络,而不是账号落在的那个', candidates[0] === 'net_399bdf86f528' && !candidates.includes(wrong), JSON.stringify(candidates));

console.log(`send target network: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
