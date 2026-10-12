// Actual exported React UI, synthetic authenticated Hub; Docker only.
import assert from 'node:assert/strict';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=await serveExport(process.env.WEB_DIR),browser=await chromium.launch({headless:true,executablePath:findChromium()});
let passed=0;
function secretsFixture({unbound=false}={}) {
    const daemon={node_id:'daemon-fixture',alias:'daemon-fixture',role:'host_supervisor',lifecycle_state:'running',config_snapshot:{role:'host_supervisor'}},node={node_id:'node-fixture',alias:'child-fixture',runtime:'codex-app-server',...(unbound?{}:{lifecycle_daemon_node_id:'daemon-fixture',lifecycle_controllable:true})};
    window.__secretCalls=[];window.__secretRevision=0;window.__secretKeys=[];window.__secretNode=null;window.__secretUnsupported=false;
    const id=unbound?'nsk_11111111-1111-4111-8111-111111111111':'dsk_11111111-1111-4111-8111-111111111111';
    const envelope=payload=>({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify(payload)}]}});
    window.__routeOverride=(url,text)=>{
      if(url.pathname==='/api/nodes')return {nodes:[daemon,node]};
      if(url.pathname==='/api/status')return {sessions:[daemon,node].map(n=>({...n,status:'idle',version:'TEST-ONLY',updated_at:new Date().toISOString()}))};
      if(url.pathname==='/api/host-supervisors')return {ok:true,daemons:[{daemon_node_id:daemon.node_id,alias:daemon.alias,online:true}]};
      if(url.pathname!=='/mcp')return;
      const params=JSON.parse(text||'{}').params;
      if(params?.name!=='daemon_provider_snapshot'||!(/^(secret_|node_secret_)/.test(params.arguments?.action||'')))return;
      const raw=params.arguments;window.__secretCalls.push(raw);
      const args={...raw.provider,action:raw.action.replace(/^(node_)?secret_/,''),id:raw.id,revision:raw.revision};
      if(window.__secretUnsupported)return envelope({ok:false,error:unbound?'node_secrets_upgrade_required':'scoped_secrets_upgrade_required'});
      const parent=unbound?null:daemon.node_id;
      if(args.action==='read')return envelope({ok:true,request_id:id,daemon_node_id:parent,node_id:window.__secretNode,status:'succeeded',snapshot:{network_id:'net-sweep',daemon_node_id:parent,node_id:window.__secretNode,revision:window.__secretRevision,activation:'next_start',keys:window.__secretKeys}});
      window.__secretNode=unbound?node.node_id:args.node_id??null;
      if(args.action==='put'){if(args.value!=='TEST-ONLY-ui-1053')throw Error('fixture accepts only synthetic key');window.__secretRevision++;window.__secretKeys=[{key:args.key,source:unbound||args.node_id?'node':'daemon'}];}
      if(args.action==='delete'){window.__secretRevision++;window.__secretKeys=[];}
      return envelope({ok:true,request_id:id,status:'pending'});
    };
}
try {
  const ctx=await browser.newContext({locale:TEST_LOCALE,viewport:{width:1200,height:850}}),page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript({content:`(${initScript.toString().replace('http://mock-hub.invalid','http://127.0.0.1:9200')})({theme:'light'});`});
  await page.addInitScript(()=>{
    const daemon={node_id:'daemon-fixture',alias:'daemon-fixture',role:'host_supervisor',lifecycle_state:'running',config_snapshot:{role:'host_supervisor'}},node={node_id:'node-fixture',alias:'child-fixture',runtime:'codex-app-server',lifecycle_daemon_node_id:'daemon-fixture',lifecycle_controllable:true};
    window.__secretCalls=[];window.__secretRevision=0;window.__secretKeys=[];window.__secretNode=null;window.__secretUnsupported=false;
    const id='dsk_11111111-1111-4111-8111-111111111111';
    const envelope=payload=>({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify(payload)}]}});
    window.__routeOverride=(url,text)=>{
      if(url.pathname==='/api/nodes')return {nodes:[daemon,node]};
      if(url.pathname==='/api/status')return {sessions:[daemon,node].map(n=>({...n,status:'idle',version:'TEST-ONLY',updated_at:new Date().toISOString()}))};
      if(url.pathname==='/api/host-supervisors')return {ok:true,daemons:[{daemon_node_id:daemon.node_id,alias:daemon.alias,online:true}]};
      if(url.pathname!=='/mcp')return;
      const params=JSON.parse(text||'{}').params;if(params?.name!=='daemon_provider_snapshot'||!params.arguments?.action?.startsWith('secret_'))return;
      const raw=params.arguments;window.__secretCalls.push(raw);
      const args={...raw.provider,action:raw.action.slice(7),id:raw.id,revision:raw.revision};
      if(window.__secretUnsupported)return envelope({ok:false,error:'scoped_secrets_upgrade_required'});
      if(args.action==='read')return envelope({ok:true,request_id:id,daemon_node_id:daemon.node_id,node_id:window.__secretNode,status:'succeeded',snapshot:{network_id:'net-sweep',daemon_node_id:daemon.node_id,node_id:window.__secretNode,revision:window.__secretRevision,activation:'next_start',keys:window.__secretKeys}});
      window.__secretNode=args.node_id??null;
      if(args.action==='put'){assertNotRealKey(args.value);window.__secretRevision++;window.__secretKeys=[{key:args.key,source:args.node_id?'node':'daemon'}];}
      if(args.action==='delete'){window.__secretRevision++;window.__secretKeys=[];}
      return envelope({ok:true,request_id:id,status:'pending'});
    };
    function assertNotRealKey(value){if(value!=='TEST-ONLY-ui-1053')throw Error('fixture accepts only synthetic key');}
  });
  await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);await page.getByTestId('desktop-workspace-sidebar').waitFor();
  await page.evaluate(()=>window.__anetLayoutSweep.setScreen({name:'nodeInfo',alias:'child-fixture'}));
  await page.getByTestId('node-section-nav').getByText('密钥',{exact:true}).click();
  await page.getByTestId('scoped-secret-save').waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="scoped-secret-save"]').getAttribute('aria-disabled'));
  assert(!(await page.getByTestId('scoped-secrets').innerText()).includes('演示'));passed++;
  await page.getByTestId('scoped-secret-name').fill('TEST_VENDOR_KEY');await page.getByTestId('scoped-secret-value').fill('TEST-ONLY-ui-1053');
  assert.equal(await page.getByTestId('scoped-secret-value').getAttribute('type'),'password');passed++;
  await page.getByTestId('scoped-secret-save').click();
  await page.getByTestId('scoped-secret-notice').getByText(/Daemon 已确认保存/).waitFor();
  assert.equal(await page.getByTestId('scoped-secret-value').inputValue(),'');passed++;
  assert(!(await page.getByTestId('scoped-secrets').innerText()).includes('TEST-ONLY-ui-1053'));passed++;
  const calls=await page.evaluate(()=>window.__secretCalls),writes=calls.filter(c=>c.action==='secret_put');
  assert.equal(writes.length,1);assert.equal(writes[0].id,'daemon-fixture');assert.equal(writes[0].provider.node_id,'node-fixture');assert.equal(writes[0].revision,0);passed++;
  assert(calls.filter(c=>c.action==='secret_read').every(c=>!Object.hasOwn(c,'provider')));passed++;
  assert((await page.getByTestId('scoped-secret-notice').innerText()).includes('当前运行进程未修改'));passed++;
  await page.screenshot({path:'/output/node-secrets1053.png',fullPage:true});
  await page.evaluate(()=>window.__secretUnsupported=true);await page.getByTestId('scoped-secret-refresh').click();
  await page.getByTestId('scoped-secret-notice').getByText(/尚不支持真实密钥管理/).waitFor();
  assert.equal(await page.getByTestId('scoped-secret-save').getAttribute('aria-disabled'),'true');passed++;
  await page.evaluate(()=>{window.__secretUnsupported=false;window.__secretKeys=[];window.__anetLayoutSweep.setScreen({name:'chat',alias:'daemon-fixture',daemonMgmt:true});});
  await page.getByTestId('daemon-section-tabs-tokens').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="scoped-secret-save"]')?.getAttribute('aria-disabled')!=='true');
  await page.getByTestId('scoped-secret-name').fill('TEST_VENDOR_KEY');await page.getByTestId('scoped-secret-value').fill('TEST-ONLY-ui-1053');await page.getByTestId('scoped-secret-save').click();
  await page.getByTestId('scoped-secret-notice').getByText(/Daemon 已确认保存/).waitFor();
  const last=await page.evaluate(()=>window.__secretCalls.filter(c=>c.action==='secret_put').at(-1));
  assert.equal(last.id,'daemon-fixture');assert.equal(last.provider.node_id,null);assert.equal(last.revision,1);passed++;
  assert((await page.getByTestId('scoped-secrets').innerText()).includes('此 Daemon'));passed++;
  await page.screenshot({path:'/output/daemon-secrets1053.png',fullPage:true});
  assert.deepEqual(errors,[]);passed++;
  await ctx.close();console.log(`scoped secrets exported UI: ${passed}/${passed} checks passed`);
  const own=await browser.newContext({locale:TEST_LOCALE,viewport:{width:1200,height:850}}),unbound=await own.newPage();
  await unbound.addInitScript({content:`(${initScript.toString().replace('http://mock-hub.invalid','http://127.0.0.1:9200')})({theme:'light'});`});
  await unbound.addInitScript(secretsFixture,{unbound:true});
  await unbound.goto(`${web.url}?safeAreaSim=0,0,0,0`);await unbound.getByTestId('desktop-workspace-sidebar').waitFor();
  await unbound.evaluate(()=>window.__anetLayoutSweep.setScreen({name:'nodeInfo',alias:'child-fixture'}));
  await unbound.getByTestId('node-section-nav').getByText('密钥',{exact:true}).click();
  await unbound.waitForFunction(()=>{const button=document.querySelector('[data-testid="scoped-secret-save"]');return !!button&&button.getAttribute('aria-disabled')!=='true';});
  assert((await unbound.getByTestId('scoped-secrets').innerText()).includes('无需绑定 Daemon'));passed++;
  await unbound.getByTestId('scoped-secret-name').fill('TEST_VENDOR_KEY');await unbound.getByTestId('scoped-secret-value').fill('TEST-ONLY-ui-1053');
  await unbound.getByTestId('scoped-secret-save').click();await unbound.getByTestId('scoped-secret-notice').getByText(/节点已确认保存/).waitFor();
  const direct=await unbound.evaluate(()=>window.__secretCalls.filter(c=>c.action==='node_secret_put'));
  assert.equal(direct.length,1);assert.equal(direct[0].id,'node-fixture');assert.equal(direct[0].revision,0);passed++;
  assert.equal(await unbound.getByTestId('scoped-secret-value').inputValue(),'');passed++;
  await unbound.screenshot({path:'/output/node-secrets1075-unbound.png',fullPage:true});
  await own.close();console.log(`scoped secrets with independent node: ${passed}/${passed} checks passed`);
} finally {await browser.close();web.close();}
