import { manageSecrets, nodeSecretsNeedsUpgrade, parseSecretSnapshot } from './scoped-secrets';
import { scopedSecrets } from './scoped-secrets-api';
const scope={networkId:'net-fixture',daemonId:'daemon-fixture',nodeId:'node-fixture'};
const snapshot={network_id:scope.networkId,daemon_node_id:scope.daemonId,node_id:scope.nodeId,revision:1,activation:'next_start',keys:[{key:'TEST_VENDOR_KEY',source:'node'}]};
let count=0;function check(name:string,pass:boolean){if(!pass)throw Error(name);count++;}
check('known old runtime needs an explicit upgrade',nodeSecretsNeedsUpgrade('2.5.0-preview.126') && nodeSecretsNeedsUpgrade('2.4.0'));
check('minimum and later versions keep capability readback',!nodeSecretsNeedsUpgrade('2.5.0-preview.137') && !nodeSecretsNeedsUpgrade('2.5.0-preview.138') && !nodeSecretsNeedsUpgrade('2.5.0'));
check('unknown or custom version is not a guessed refusal',!nodeSecretsNeedsUpgrade(null) && !nodeSecretsNeedsUpgrade('TEST-ONLY') && !nodeSecretsNeedsUpgrade('2.5.0-custom.126'));
const id='dsk_11111111-1111-4111-8111-111111111111';
const requests:any[]=[];
const result=await manageSecrets(scope,async(args,_signal,containsKey)=>{
  requests.push({args,containsKey});return args.action==='read'?{ok:true,request_id:id,daemon_node_id:scope.daemonId,node_id:scope.nodeId,status:'succeeded',snapshot}:{ok:true,request_id:id,status:'pending'};
},new AbortController().signal,{action:'put',key:'TEST_VENDOR_KEY',value:'TEST-ONLY-fixture',revision:0},{pollMs:0});
check('saved requires scoped Daemon receipt',result.kind==='ready');
check('only explicit write sends a key, never polling',requests.length===2&&requests[0].containsKey&&requests[0].args.value==='TEST-ONLY-fixture'&&!requests[1].containsKey&&!Object.hasOwn(requests[1].args,'value'));
check('no value in result',!JSON.stringify(result).includes('TEST-ONLY-fixture'));
check('wrong node rejected',parseSecretSnapshot({...snapshot,node_id:'other'},scope)===null);
check('value-bearing receipt rejected',parseSecretSnapshot({...snapshot,value:'bad'},scope)===null);
const old=await manageSecrets(scope,async()=>({ok:false,error:'scoped_secrets_upgrade_required'}),new AbortController().signal);
check('old software is not simulated success',old.kind==='unsupported');
const denied=await manageSecrets(scope,async()=>({ok:false,error:'secret_admin_required'}),new AbortController().signal);
check('member denied visibly',denied.kind==='forbidden');
const pending=await manageSecrets(scope,async(args)=>args.action==='read'?{ok:true,request_id:id,daemon_node_id:scope.daemonId,node_id:scope.nodeId,status:'pending'}:{ok:true,request_id:id,status:'pending'},new AbortController().signal,undefined,{timeoutMs:15,pollMs:2});
check('bounded pending is unconfirmed, not endless loading',pending.kind==='unconfirmed');
globalThis.fetch=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32602,message:'Invalid arguments for tool daemon_provider_snapshot: action enum'}}),{status:200,headers:{'Content-Type':'application/json'}});
const oldEnum=await scopedSecrets({serverUrl:'https://fixture.invalid',token:'TEST-ONLY-human',networkId:scope.networkId},scope,new AbortController().signal);
check('old known management tool rejects secret enum as unsupported',oldEnum.kind==='unsupported');
const ownScope={...scope,daemonId:null}, ownId='nsk_22222222-2222-4222-8222-222222222222';
const ownSnapshot={...snapshot,daemon_node_id:null};
const ownCalls:any[]=[];
globalThis.fetch=async(_url,init)=>{
  const args=JSON.parse(String(init?.body)).params.arguments;ownCalls.push(args);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify(args.action==='secret_read'
    ? {ok:true,request_id:ownId,daemon_node_id:null,node_id:scope.nodeId,status:'succeeded',snapshot:ownSnapshot}
    : {ok:true,request_id:ownId,status:'pending'})}]}}),{status:200});
};
const independent=await scopedSecrets({serverUrl:'https://fixture.invalid',token:'TEST-ONLY-human',networkId:scope.networkId},ownScope,new AbortController().signal,
  {action:'put',key:'TEST_VENDOR_KEY',value:'TEST-ONLY-fixture',revision:0});
check('unbound node can save through its own exact receipt',independent.kind==='ready');
check('unbound write targets node, not a guessed daemon',ownCalls.length===2&&ownCalls[0].action==='node_secret_put'&&ownCalls[0].id===scope.nodeId&&ownCalls[1].action==='secret_read');
check('independent receipt cannot claim daemon inheritance',parseSecretSnapshot({...ownSnapshot,keys:[{key:'TEST_VENDOR_KEY',source:'daemon'}]},ownScope)===null);
const nodeOld=await manageSecrets(ownScope,async()=>({ok:false,error:'node_secrets_upgrade_required'}),new AbortController().signal);
check('old node capability remains unsupported, not a saved claim',nodeOld.kind==='unsupported');
for(const [error,expected] of [
  ['node_secrets_upgrade_required','unsupported'],
  ['scoped_secrets_upgrade_required','unsupported'],
  ['secret_admin_required','forbidden'],
] as const){
  globalThis.fetch=async()=>new Response(`event: message\r\nid: fixture-event\r\ndata: ${JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify({ok:false,error})}]}})}\r\n\r\n`,
    {status:200,headers:{'Content-Type':'text/event-stream'}});
  const refusal=await scopedSecrets({serverUrl:'https://fixture.invalid',token:'TEST-ONLY-human',networkId:scope.networkId},ownScope,new AbortController().signal);
  check(`event-framed SSE preserves ${error}`,refusal.kind===expected);
}
globalThis.fetch=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify({ok:false,error:'node_secrets_upgrade_required'})}]}}),{status:200});
const jsonRefusal=await scopedSecrets({serverUrl:'https://fixture.invalid',token:'TEST-ONLY-human',networkId:scope.networkId},ownScope,new AbortController().signal);
check('JSON old-node response keeps the explicit upgrade requirement',jsonRefusal.kind==='unsupported');
globalThis.fetch=async()=>new Response('event: message\ndata: not-json\n\n',{status:200,headers:{'Content-Type':'text/event-stream'}});
const malformed=await scopedSecrets({serverUrl:'https://fixture.invalid',token:'TEST-ONLY-human',networkId:scope.networkId},ownScope,new AbortController().signal);
check('malformed event frame stays unconfirmed, never saved',malformed.kind==='unconfirmed');
console.log(`scoped secrets: ${count}/${count} checks passed`);
