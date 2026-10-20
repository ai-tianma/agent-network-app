// Agent 组织架构:点设置入口必须打开页面;部门树和负责人是 Hub 数据;调整结构写 Hub(PUT),失败回滚。
import { existsSync, readFileSync } from 'node:fs';
import { agentCount, agentsDirectlyIn, placeAgents, type AgentOrgData, type OrgOwner } from './agent-org-model';
import { DIRECTORY_MAX_PAGES, loadAgentOrg, moveAgentDepartment, parseDirectoryPage } from './agent-org-api';
import { agentOrgTranslations } from './i18n-agent-org';
import type { Department } from './org-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const code = (src: string) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const dept = (id: string, name: string, parent: string | null = null, sort = 0): Department => ({
  id, name, parent_id: parent, leader_user_id: null, sort, member_count: 0,
});
const owner = (userId: string, departmentId: string | null, agents: OrgOwner['agents'], displayName = ''): OrgOwner => ({
  userId, username: userId, displayName, departmentId, agents,
});
const data = (patch: Partial<AgentOrgData> = {}): AgentOrgData => ({
  departments: [dept('eng', '工程'), dept('fe', '前端', 'eng', 1)],
  owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法' }], '爱丽丝')],
  unowned: [{ nodeId: 'n2', alias: '孤岛' }],
  directory: true,
  departmentsApi: true,
  ...patch,
});

{
  const placed = placeAgents(data(), []);
  ck('负责人名下的 Agent 落在负责人的部门', placed.find(a => a.nodeId === 'n1')?.departmentId === 'eng' && placed.find(a => a.nodeId === 'n1')?.ownerName === '爱丽丝' && placed.find(a => a.nodeId === 'n1')?.demo === false);
  ck('没有负责人的 Agent 未归属', placed.find(a => a.nodeId === 'n2')?.departmentId === null && placed.find(a => a.nodeId === 'n2')?.ownerName === null);
  ck('直接归属算在本部门', agentCount(placed, data(), 'eng') === 1 && agentsDirectlyIn(placed, 'eng').length === 1 && agentCount(placed, data(), 'fe') === 0);
  const nested = data({ owners: [owner('u1', 'fe', [{ nodeId: 'n1', alias: '阿尔法' }])] });
  const nestedPlaced = placeAgents(nested, []);
  ck('父部门计入下级 Agent', agentCount(nestedPlaced, nested, 'eng') === 1 && agentsDirectlyIn(nestedPlaced, 'eng').length === 0 && agentsDirectlyIn(nestedPlaced, 'fe').length === 1);
  const moved = placeAgents(data(), [{ nodeId: 'n1', departmentId: 'fe' }, { nodeId: 'n1', departmentId: 'missing' }]);
  const n1 = moved.find(a => a.nodeId === 'n1')!;
  ck('未知的演示目标算未归属,并标成演示', n1.departmentId === null && n1.demo === true && n1.ownerName === '爱丽丝' && n1.sourceDepartmentId === 'eng');
  const same = placeAgents(data(), [{ nodeId: 'n1', departmentId: 'eng' }]).find(a => a.nodeId === 'n1')!;
  ck('移回原部门不算演示', same.departmentId === 'eng' && same.demo === false);
  const owned = placeAgents(data({ unowned: [{ nodeId: 'n1', alias: '不该赢' }, { nodeId: 'n2', alias: '孤岛' }] }), []);
  ck('同一节点负责人优先于未归属名单', owned.filter(a => a.nodeId === 'n1').length === 1 && owned.find(a => a.nodeId === 'n1')?.alias === '阿尔法');
  const foreign = placeAgents(data({ owners: [owner('u9', 'gone', [{ nodeId: 'n9', alias: '外部门' }])] }), []);
  ck('通讯录部门不在树里则未归属', foreign.find(a => a.nodeId === 'n9')?.departmentId === null && foreign.find(a => a.nodeId === 'n9')?.demo === false);
  const blank = placeAgents(data({ owners: [owner('u1', 'eng', [{ nodeId: '  ', alias: '空' }, { nodeId: 'n3', alias: '  ' }])] }), []);
  ck('空节点丢掉,空别名回落到节点 id', !blank.some(a => a.alias === '空') && blank.find(a => a.nodeId === 'n3')?.alias === 'n3');
}

{
  const junk = parseDirectoryPage({
    people: [null, { username: 'no-id' }, { user_id: 'u', username: 'alice', display_name: '', agents: [{ node_id: '' }, { node_id: 'n', alias: 'Bot' }, 'x', { node_id: 'n', alias: 'dup' }], department: { id: 'd', name: '' } }, { user_id: 'u2', username: 'bob', department: { id: 'd2', name: '销售' }, agents: [] }],
    agents_without_owner: [{ alias: 'nope' }, { node_id: 'z' }],
    has_more: 'yes',
    next_offset: '3',
  });
  ck('垃圾项丢掉,缺名字的部门不算', junk.people.length === 2 && junk.people[0].agents.length === 1 && junk.people[0].departmentId === null && junk.people[1].departmentName === '销售');
  ck('没有 node_id 的未归属丢掉,分页字段不合法则停', junk.unowned.length === 1 && junk.unowned[0].alias === 'z' && junk.hasMore === false && junk.nextOffset === null);
  ck('非对象页是空页', parseDirectoryPage(null).people.length === 0 && parseDirectoryPage('x').unowned.length === 0);
}

const original = globalThis.fetch;
const cfg = { serverUrl: 'https://hub.example', token: 'tok', networkId: 'net 1' };
type Call = { url: string; method: string };
async function withFetch(handler: (url: string, method: string) => Response, body: () => Promise<void>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method });
    return handler(url, method);
  }) as typeof fetch;
  try { await body(); } finally { globalThis.fetch = original; }
  return calls;
}
const json = (status: number, body: unknown) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

{
  const calls = await withFetch(url => json(url.includes('departments') ? 404 : 405, ''), async () => {
    ck('两边都没有则是旧 Hub', await loadAgentOrg(cfg, 'net 1') === null);
  });
  ck('旧 Hub 也只发 GET', calls.length === 2 && calls.every(c => c.method === 'GET') && calls.some(c => c.url.includes('/departments')) && calls.some(c => c.url.includes('/api/requirements/people/directory')));
}
{
  await withFetch(url => url.includes('departments') ? json(404, '') : new Response('<html>missing</html>', { status: 404 }), async () => {
    ck('通讯录 404 的 HTML 也算没有这个接口', await loadAgentOrg(cfg, 'net 1') === null);
  });
}

{
  const calls = await withFetch(url => {
    if (url.includes('departments')) return json(200, { departments: [dept('eng', '工程'), dept('fe', '前端', 'eng')], members: [] });
    const offset = Number(new URL(url).searchParams.get('offset'));
    if (offset === 0) return json(200, { ok: true, people: [{ user_id: 'u1', username: 'alice', display_name: '爱丽丝', department: { id: 'eng', name: '工程' }, agents: [{ node_id: 'n1', alias: '阿尔法' }] }], agents_without_owner: [{ node_id: 'n0', alias: '第一页' }], has_more: true, next_offset: 200 });
    return json(200, { ok: true, people: [{ user_id: 'u2', username: 'bob', display_name: '', department: { id: 'missing', name: '不在树上' }, agents: [{ node_id: 'n2', alias: '贝塔' }] }, { user_id: 'u1', username: 'alice', agents: [{ node_id: 'n9', alias: '不合并' }] }], agents_without_owner: [{ node_id: 'n8', alias: '后页不收' }], has_more: false, next_offset: null });
  }, async () => {
    const org = await loadAgentOrg(cfg, 'net 1');
    const placed = org ? placeAgents(org, []) : [];
    ck('翻页合并负责人,未归属只取第一页', !!org && org.owners.length === 2 && org.unowned.length === 1 && org.unowned[0].nodeId === 'n0' && org.departmentsApi && org.directory);
    ck('不在树上的部门按未归属', placed.find(a => a.nodeId === 'n2')?.departmentId === null && placed.find(a => a.nodeId === 'n1')?.departmentId === 'eng');
    ck('重复的人保留先读到的 Agent', !placed.some(a => a.nodeId === 'n9'));
  });
  ck('只 GET 部门树和通讯录', calls.every(c => c.method === 'GET' && !c.url.includes('POST')) && calls.filter(c => c.url.includes('directory')).length === 2 && calls.every(c => c.url.startsWith('https://hub.example/')));
}

{
  await withFetch(url => {
    if (url.includes('departments')) return json(404, '');
    return json(200, { ok: true, people: [{ user_id: 'u', username: 'sam', display_name: '', department: { id: 'sales', name: '销售' }, agents: [{ node_id: 'n', alias: '销售助手' }] }], has_more: false, next_offset: null });
  }, async () => {
    const org = await loadAgentOrg(cfg, 'net 1');
    ck('没有部门树时按通讯录平铺', !!org && org.departmentsApi === false && org.departments.length === 1 && org.departments[0].parent_id === null && org.departments[0].name === '销售');
    ck('平铺部门上能看到 Agent', !!org && placeAgents(org, [])[0].departmentId === 'sales');
  });
}

{
  await withFetch(url => url.includes('departments') ? json(200, { departments: [dept('eng', '工程')], members: [] }) : json(404, ''), async () => {
    const org = await loadAgentOrg(cfg, 'net 1');
    ck('没有通讯录时仍给出部门树', !!org && org.directory === false && org.owners.length === 0 && org.departments[0].id === 'eng');
  });
}

{
  let threw = false;
  await withFetch(() => json(500, { ok: false, error: 'boom' }), async () => {
    try { await loadAgentOrg(cfg, 'net 1'); } catch { threw = true; }
  });
  ck('非 404 的失败留给页面重试', threw);
  let bad = false;
  await withFetch(url => url.includes('directory') ? new Response('nope', { status: 200 }) : json(200, { departments: [], members: [] }), async () => {
    try { await loadAgentOrg(cfg, 'net 1'); } catch { bad = true; }
  });
  ck('通讯录不是 JSON 则失败', bad);
}

{
  const calls = await withFetch(url => {
    if (url.includes('departments')) return json(200, { departments: [], members: [] });
    const offset = Number(new URL(url).searchParams.get('offset'));
    return json(200, { ok: true, people: [], has_more: true, next_offset: offset + 200 });
  }, async () => { await loadAgentOrg(cfg, 'net 1'); });
  ck('通讯录翻页有上限', calls.filter(c => c.url.includes('directory')).length === DIRECTORY_MAX_PAGES);
}

{
  // 显式 department_id 优先于负责人部门,未设置才推断;null = 明确清空(未归属)。
  const explicit = data({ owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法', departmentId: 'fe' }], '爱丽丝')] });
  const explicitPlaced = placeAgents(explicit, []).find(a => a.nodeId === 'n1')!;
  ck('显式部门优先于负责人部门', explicitPlaced.departmentId === 'fe' && explicitPlaced.sourceDepartmentId === 'fe' && explicitPlaced.ownerName === '爱丽丝');
  const cleared = data({ owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法', departmentId: null }])] });
  ck('显式 null 覆盖负责人部门(未归属)', placeAgents(cleared, []).find(a => a.nodeId === 'n1')?.departmentId === null);
  const unknown = data({ owners: [owner('u1', 'eng', [{ nodeId: 'n1', alias: '阿尔法', departmentId: 'gone' }])] });
  ck('显式部门不在树里按未归属', placeAgents(unknown, []).find(a => a.nodeId === 'n1')?.departmentId === null);
}

{
  const d = parseDirectoryPage({ people: [{ user_id: 'u', username: 'alice', agents: [
    { node_id: 'a', alias: 'A', department_id: 'fe' },
    { node_id: 'b', alias: 'B', department_id: null },
    { node_id: 'c', alias: 'C' },
  ] }] });
  const byId = new Map(d.people[0].agents.map(a => [a.nodeId, a]));
  ck('通讯录保留显式 department_id', byId.get('a')?.departmentId === 'fe' && byId.get('b')?.departmentId === null && byId.get('c')?.departmentId === undefined);
}

{
  const cfgMove = { serverUrl: 'https://hub.example', token: 'tok', networkId: 'net 1' };
  const okCalls = await withFetch(() => json(200, { ok: true, node_id: 'n1', department_id: 'd1' }), async () => {
    ck('保存部门 200 = ok', (await moveAgentDepartment(cfgMove, 'net 1', 'n 1', 'd1')).ok === true);
  });
  ck('PUT 到节点部门接口并编码路径', okCalls.length === 1 && okCalls[0].method === 'PUT' && okCalls[0].url === 'https://hub.example/api/networks/net%201/nodes/n%201/department');
  await withFetch(() => json(200, { ok: false }), async () => {
    ck('200 但 ok:false 不算成功', (await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1')).ok === false);
  });
  await withFetch(() => json(403, {}), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('403 = forbidden', r.ok === false && r.reason === 'forbidden');
  });
  await withFetch(() => json(400, { ok: false, error: 'department_not_found' }), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('400 error=department_not_found(Hub .140) = department', r.ok === false && r.reason === 'department');
  });
  await withFetch(() => json(400, { code: 'department_not_found' }), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('400 code=department_not_found(旧草案) = department', r.ok === false && r.reason === 'department');
  });
  await withFetch(() => json(404, { ok: false, error: 'node_not_found' }), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('404 error=node_not_found(Hub .140) = node', r.ok === false && r.reason === 'node');
  });
  await withFetch(() => json(404, { code: 'node_not_found' }), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('404 code=node_not_found(旧草案) = node', r.ok === false && r.reason === 'node');
  });
  await withFetch(() => new Response('<html>not found</html>', { status: 404 }), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('旧 Hub 无此路由(404 非 JSON) = unsupported', r.ok === false && r.reason === 'unsupported');
  });
  await withFetch(() => json(501, {}), async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', 'd1');
    ck('501 = unsupported', r.ok === false && r.reason === 'unsupported');
  });
  await withFetch(() => { throw new Error('offline'); }, async () => {
    const r = await moveAgentDepartment(cfgMove, 'net 1', 'n1', null);
    ck('网络错误 = error,且 null 目标合法', r.ok === false && r.reason === 'error');
  });
}

{
  const screen = code(read('./AgentOrgScreen.tsx'));
  const settings = code(read('./SettingsScreen.tsx'));
  const phone = code(read('./SettingsPhonePages.tsx'));
  const forbidden = ['createDepartment', 'setMemberDepartment', 'updateDepartment', 'deleteDepartment', 'appFetch', 'fetchOrg', 'listRequirementPeople', "method: 'POST'", "method: 'PUT'", "method: 'PATCH'", "method: 'DELETE'", 'AgentTeamsEntry'];
  ck('页面不写 Hub、不走团队接口', forbidden.every(s => !screen.includes(s)));
  ck('调整按钮调用真实写接口,失败回滚', screen.includes('moveAgentDepartment(p.cfg, p.networkId, nodeId, pickDept)') && screen.includes('previous ? [...rest, previous] : rest'));
  ck('页面根始终在,且不再有演示条', screen.includes('testID="agent-org-page"') && !screen.includes('return null') && !screen.includes('agent-org-demo-banner'));
  ck('桌面和手机都挂这页,并带上已保存的网络', settings.includes('<AgentOrgScreen cfg={cfg} networkId={me.networkId || cfg.networkId} phone={false} />') && settings.includes('renderAgentOrg: () => <AgentOrgScreen cfg={cfg} networkId={me.networkId || cfg.networkId} phone />') && phone.includes("case 'agentTeams': return <>{ctx.renderAgentOrg()}</>"));
  ck('设置里不再挂会点空的团队入口', !settings.includes('AgentTeamsEntry') && !phone.includes('renderAgentTeams') && !existsSync(new URL('./AgentTeamsEntry.tsx', import.meta.url)));
  ck('手机列表行会进入子页', settings.includes('onPress={() => openPage(cat.key)}'));
  ck('不再有演示文案,标题/hint 指向真实保存', !('agentOrg.demoBanner' in agentOrgTranslations) && agentOrgTranslations['agentOrg.demoTitle'][0] === '调整结构' && agentOrgTranslations['agentOrg.demoHint'][0].includes('写入 Hub'));
  ck('失败态有 403/400/404/旧Hub 可读文案', ['agentOrg.saveForbidden', 'agentOrg.saveNoDepartment', 'agentOrg.saveNoNode', 'agentOrg.saveUnsupported'].every(k => (agentOrgTranslations as Record<string, readonly string[]>)[k]?.length === 2));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
