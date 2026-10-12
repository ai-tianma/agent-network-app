import type { HubConfig } from './api';
import { providerFetch } from './daemon-provider-management-api';
import { parseProviderRpc } from './daemon-provider-management';
import { manageSecrets, type SecretScope, type SecretWrite } from './scoped-secrets';
export function scopedSecrets(cfg: HubConfig, scope: SecretScope, signal: AbortSignal, write?: SecretWrite) {
  return manageSecrets(scope,async(args, requestSignal, containsKey)=>{
    const response=await providerFetch(`${cfg.serverUrl.replace(/\/$/,'')}/mcp`,{
      method:'POST',signal:requestSignal,
      headers:{Authorization:`Bearer ${cfg.token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'daemon_provider_snapshot',arguments:{
        action:args.action==='read' ? 'secret_read' : `${scope.daemonId?'secret':'node_secret'}_${args.action}`,id:args.id,network_id:args.network_id,
        ...(args.action==='read'?{}:{provider:{node_id:args.node_id,...(args.key?{key:args.key}:{}),...(containsKey?{value:args.value}:{})},
          ...(args.revision!==undefined?{revision:args.revision}:{})}),
      }}}),
    },containsKey);
    const text=response.ok?await response.text():'';
    const parsed=parseProviderRpc(response.status,text);if(parsed.kind==='payload')return parsed.value;
    if(parsed.kind==='forbidden')return {ok:false,error:'forbidden'};
    if(parsed.kind==='unsupported')return {ok:false,error:'unsupported'};
    try {
      const envelope=JSON.parse(text.startsWith('data:')?text.split(/\r?\n/).filter(l=>l.startsWith('data:')).at(-1)!.slice(5):text);
      // Older Hubs know the management tool but not the secret_* actions.
      // Valid locally constructed protocol arguments failing MCP validation are
      // a compatibility failure, not an endlessly pending save.
      if(envelope.error?.code===-32602)return {ok:false,error:'unsupported'};
      const value=JSON.parse(envelope.result.content[0].text);
      if(['secret_admin_required','user_token_required','scoped_secrets_upgrade_required','node_secrets_upgrade_required','invalid_secret_input'].includes(value.error))return {ok:false,error:value.error};
    } catch {}
    return {ok:false,error:'unconfirmed'};
  },signal,write);
}
