import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import type { HubConfig } from './api';
import { scopedSecrets } from './scoped-secrets-api';
import { validSecretInput, type SecretSnapshot, type SecretWrite } from './scoped-secrets';
import { useTranslation } from './i18n-react';
import './i18n-scoped-secrets';
import './i18n-provider-management';
import { providerHttpWarning } from './daemon-provider-management-api';
import { colors, spacing, radius, type } from './theme';
import { buttonStyle, buttonTextStyle } from './elevation';
type Props={cfg:HubConfig;daemonId?:string|null;nodeId?:string|null};
export default function ScopedSecretsSection(props:Props) {
  return <Page key={JSON.stringify([props.cfg.serverUrl,props.cfg.networkId,props.cfg.token,props.daemonId,props.nodeId])} {...props}/>;
}
function Page({cfg,daemonId,nodeId}:Props) {
  const {t}=useTranslation();const [snapshot,setSnapshot]=useState<SecretSnapshot|null>(null),[key,setKey]=useState(''),[value,setValue]=useState('');
  const [busy,setBusy]=useState(false),[writing,setWriting]=useState(false),[notice,setNotice]=useState(''),[deleting,setDeleting]=useState<string|null>(null);
  const active=useRef<AbortController|null>(null), mounted=useRef(true);
  const supported=!!(daemonId||nodeId) && !!cfg.networkId;
  const independent=!!nodeId && !daemonId;
  const run=async(write?:SecretWrite)=>{
    if(!supported||active.current)return;
    const ctrl=new AbortController();active.current=ctrl;setBusy(true);setWriting(!!write);setNotice('');setDeleting(null);
    if(write){setValue('');setSnapshot(null);}
    const result=await scopedSecrets(cfg,{networkId:cfg.networkId!,daemonId:daemonId??null,nodeId:nodeId??null},ctrl.signal,write);
    if(!mounted.current||ctrl.signal.aborted)return;
    if(result.kind==='ready') {setSnapshot(result.snapshot);if(write)setNotice(t(independent
      ? write.action==='put'?'scopedSecrets.nodeSaved':'scopedSecrets.nodeDeleted'
      : write.action==='put'?'scopedSecrets.saved':'scopedSecrets.deleted'));}
    else {setSnapshot(null);setNotice(t(result.kind==='unsupported'&&independent?'scopedSecrets.nodeUnsupported':`scopedSecrets.${result.kind==='cancelled'?'unconfirmed':result.kind}`));}
    active.current=null;setBusy(false);
  };
  useEffect(()=>{mounted.current=true;void run();return()=>{mounted.current=false;active.current?.abort();};},[]);
  const field={borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,padding:spacing.sm,color:colors.text,fontSize:type.body,backgroundColor:colors.bg};
  const Button=({title,press,disabled=false,testID}:{title:string;press:()=>void;disabled?:boolean;testID?:string})=><Pressable testID={testID} accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={press} style={[buttonStyle('secondary'),{opacity:disabled?0.45:1}]}><Text style={buttonTextStyle('secondary')}>{title}</Text></Pressable>;
  return <View testID="scoped-secrets" style={{gap:spacing.md}}>
    <Text style={{fontSize:type.title,fontWeight:'600',color:colors.text}}>{t('scopedSecrets.title')}</Text>
    <Text style={{color:colors.textMuted}}>{t(independent?'scopedSecrets.nodeIndependent':nodeId?'scopedSecrets.node':'scopedSecrets.daemon')}</Text>
    <Text style={{color:colors.textMuted,fontSize:type.small}}>{t(independent?'scopedSecrets.nodeBoundary':'scopedSecrets.boundary')}</Text>
    {providerHttpWarning(cfg.serverUrl)?<Text style={{color:colors.textMuted}}>{t('providerManagement.httpWarning')}</Text>:null}
    {!supported?<Text>{t('scopedSecrets.unbound')}</Text>:<>
      <Button title={t('scopedSecrets.refresh')} testID="scoped-secret-refresh" disabled={busy} press={()=>void run()}/>
      {busy?<View style={{flexDirection:'row',gap:spacing.sm}}><ActivityIndicator/><Text>{t(writing?'scopedSecrets.saving':'scopedSecrets.loading')}</Text></View>:null}
      {snapshot?<View style={{borderWidth:1,borderColor:colors.border,borderRadius:radius.md,padding:spacing.md,gap:spacing.sm}}>
        {!snapshot.keys.length?<Text style={{color:colors.textMuted}}>{t('scopedSecrets.empty')}</Text>:snapshot.keys.map(item=><View key={item.key} style={{gap:spacing.xs}}>
          <Text style={{color:colors.text}}>{item.key}</Text><Text style={{color:colors.textMuted,fontSize:type.small}}>{t(item.source==='node'?'scopedSecrets.sourceNode':nodeId?'scopedSecrets.sourceDaemon':'scopedSecrets.sourceOwnDaemon')}</Text>
          {item.source===(nodeId?'node':'daemon')?<Button title={t(deleting===item.key?'scopedSecrets.confirmDelete':'scopedSecrets.delete')} press={()=>{
            if(deleting===item.key)void run({action:'delete',key:item.key,revision:snapshot.revision});else setDeleting(item.key);
          }}/>:null}
        </View>)}
      </View>:null}
      <Text>{t('scopedSecrets.name')}</Text><TextInput testID="scoped-secret-name" accessibilityLabel={t('scopedSecrets.name')} value={key} onChangeText={setKey} editable={!busy} autoCapitalize="characters" autoCorrect={false} style={field}/>
      <Text>{t('scopedSecrets.value')}</Text><TextInput testID="scoped-secret-value" accessibilityLabel={t('scopedSecrets.value')} value={value} onChangeText={setValue} editable={!busy} secureTextEntry autoCapitalize="none" autoCorrect={false} style={field}/>
      <Button title={t('scopedSecrets.save')} testID="scoped-secret-save" disabled={busy||!snapshot} press={()=>{
        if(!validSecretInput(key.trim(),value)){setNotice(t('scopedSecrets.invalid'));return;}
        void run({action:'put',key:key.trim(),value,revision:snapshot!.revision});
      }}/>
      {notice?<Text testID="scoped-secret-notice" style={{color:colors.textMuted}}>{notice}</Text>:null}
    </>}
  </View>;
}
