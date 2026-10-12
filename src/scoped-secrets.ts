export type SecretScope = { networkId: string; daemonId: string | null; nodeId: string | null };
export type SecretSnapshot = { network_id: string; daemon_node_id: string | null; node_id: string | null;
  revision: number; activation: 'next_start'; keys: { key: string; source: 'daemon' | 'node' }[] };
export type SecretResult = { kind: 'ready'; snapshot: SecretSnapshot } | { kind: 'unconfirmed' | 'cancelled' | 'forbidden' | 'unsupported' | 'invalid' };
export type SecretWrite = { action: 'put' | 'delete'; key: string; value?: string; revision: number };
// Only known release versions preflight here; custom/unknown builds still use Hub capability readback.
export function nodeSecretsNeedsUpgrade(version?: string | null): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/.exec(version ?? '');
  if (!match) return false;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (major !== 2) return major < 2;
  if (minor !== 5) return minor < 5;
  if (patch !== 0) return false;
  return match[4] !== undefined && Number(match[4]) < 137;
}
export function validSecretInput(key: string, value: string): boolean {
  return /^[A-Z_][A-Z0-9_]{0,127}$/.test(key) && !!value && new TextEncoder().encode(value).length <= 8192 && !value.includes('\0');
}
export function parseSecretSnapshot(v: any, scope: SecretScope): SecretSnapshot | null {
  if (!v || Object.keys(v).some(k=>!['network_id','daemon_node_id','node_id','revision','activation','keys'].includes(k))
    || v.network_id !== scope.networkId || v.daemon_node_id !== scope.daemonId || v.node_id !== scope.nodeId
    || !Number.isSafeInteger(v.revision) || v.revision < 0 || v.activation !== 'next_start' || !Array.isArray(v.keys) || v.keys.length > 256
    || new Set(v.keys.map((x:any)=>x?.key)).size !== v.keys.length || v.keys.some((x:any)=>!x
      || Object.keys(x).some(k=>!['key','source'].includes(k)) || typeof x.key !== 'string' || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(x.key)
      || !['node','daemon'].includes(x.source) || (!scope.nodeId && x.source !== 'daemon') || (!scope.daemonId && x.source !== 'node'))) return null;
  return v;
}
type Rpc = (args: Record<string,unknown>, signal: AbortSignal, containsKey: boolean) => Promise<any>;
export async function manageSecrets(scope: SecretScope, rpc: Rpc, signal: AbortSignal, write?: SecretWrite,
  options: { timeoutMs?: number; pollMs?: number } = {}): Promise<SecretResult> {
  if (!scope.networkId || (!scope.daemonId && !scope.nodeId)) return { kind: 'unsupported' };
  if (signal.aborted) return { kind: 'cancelled' };
  if (write?.action === 'put' && !validSecretInput(write.key,write.value ?? '')) return { kind: 'invalid' };
  const ctrl = new AbortController(), cancel = ()=>ctrl.abort(); signal.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,options.timeoutMs ?? 20000);
  const aborted=new Promise<any>(resolve=>ctrl.signal.addEventListener('abort',()=>resolve({ok:false,error:'cancelled'}),{once:true}));
  const call = (args:Record<string,unknown>, containsKey=false)=>Promise.race([rpc(args,ctrl.signal,containsKey),aborted]);
  const errorResult = (r:any): SecretResult => ({kind: signal.aborted ? 'cancelled'
    : r?.error === 'invalid_secret_input' ? 'invalid'
    : ['user_token_required','secret_admin_required','forbidden'].includes(r?.error) ? 'forbidden'
    : ['unsupported','scoped_secrets_upgrade_required','node_secrets_upgrade_required'].includes(r?.error) ? 'unsupported' : 'unconfirmed'});
  try {
    const request=await call({action:write?.action ?? 'list',id:scope.daemonId ?? scope.nodeId,network_id:scope.networkId,node_id:scope.nodeId,
      ...(write ? {key:write.key,revision:write.revision,...(write.action==='put'?{value:write.value}:{})} : {})},write?.action==='put');
    const requestIdPattern=scope.daemonId ? /^dsk_[a-f0-9-]{36}$/ : /^nsk_[a-f0-9-]{36}$/;
    if (!request?.ok || request.status !== 'pending' || !requestIdPattern.test(request.request_id)) return errorResult(request);
    while (!ctrl.signal.aborted) {
      const r=await call({action:'read',id:request.request_id,network_id:scope.networkId});
      if (!r?.ok) return errorResult(r);
      if (r.request_id !== request.request_id || r.daemon_node_id !== scope.daemonId || r.node_id !== scope.nodeId) return {kind:'unconfirmed'};
      if (r.status==='succeeded') {
        const snapshot=parseSecretSnapshot(r.snapshot,scope);
        const owns=(source:string)=>source === (scope.nodeId?'node':'daemon');
        if (!snapshot || (write && (snapshot.revision !== write.revision+1
          || (write.action==='put' && !snapshot.keys.some(k=>k.key===write.key&&owns(k.source)))
          || (write.action==='delete' && snapshot.keys.some(k=>k.key===write.key&&owns(k.source)))))) return {kind:'unconfirmed'};
        return {kind:'ready',snapshot};
      }
      if (r.status!=='pending') return {kind:'unconfirmed'};
      await new Promise<void>(resolve=>{
        const finish=()=>{clearTimeout(wait);ctrl.signal.removeEventListener('abort',finish);resolve();};
        const wait=setTimeout(finish,options.pollMs ?? 500);ctrl.signal.addEventListener('abort',finish,{once:true});
      });
    }
    return errorResult(null);
  } catch { return errorResult(null); }
  finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}
