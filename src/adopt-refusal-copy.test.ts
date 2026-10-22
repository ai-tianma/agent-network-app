// Board #747 ①: every Hub refusal code shows a specific problem + fix, and an
// unknown code still shows the code. Fails if the mapping in adoptionError is dropped.
import { adoptionError } from './node-adoption';
import { ADOPT_REFUSAL_COPY } from './adopt-refusal-copy';
import { setLanguagePreference } from './i18n';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
// Snapshot of publicLifecycleErrors in sleep2agi/agent-network server/src/node-lifecycle-read.ts (07e537e3),
// plus the exact copresence_adopt_v2 code proposed in Hub PR #2887 (board #2012).
const HUB_CODES = [
  'copresence_adopt_v2',
  'adopt_ack_rejected', 'adopt_active_binding_required', 'adopt_alias_invalid', 'adopt_alias_mismatch',
  'adopt_binding_revoked_during_start', 'adopt_binding_unavailable', 'adopt_codex_readopt_required',
  'adopt_config_env_invalid', 'adopt_config_invalid', 'adopt_config_network_mismatch',
  'adopted_node_delete_unsupported', 'adopt_env_file_invalid', 'adopt_env_file_unsafe',
  'adopt_explicit_private_socket_required', 'adopt_hub_invalid', 'adopt_hub_mismatch', 'adopt_hub_missing',
  'adopt_identity_ambiguous', 'adopt_identity_changed', 'adopt_identity_not_found',
  'adopt_launch_mode_mismatch', 'adopt_lifecycle_verification_failed', 'adopt_local_verification_failed',
  'adopt_network_mismatch', 'adopt_pane_invalid', 'adopt_pane_process_mismatch', 'adopt_pane_unverified',
  'adopt_path_not_regular', 'adopt_path_owner_mismatch', 'adopt_path_writable_by_others',
  'adopt_pid_changed', 'adopt_pidfile_unsafe', 'adopt_pid_invalid', 'adopt_platform_unsupported',
  'adopt_process_argv_mismatch', 'adopt_process_changed', 'adopt_process_generation_changed',
  'adopt_process_home_mismatch', 'adopt_process_identity_mismatch', 'adopt_process_still_running',
  'adopt_process_stop_timeout', 'adopt_process_tree_unstable', 'adopt_proc_invalid', 'adopt_proc_unreadable',
  'adopt_registry_conflict', 'adopt_registry_entry_invalid', 'adopt_registry_identity_mismatch',
  'adopt_registry_invalid', 'adopt_registry_unsafe', 'adopt_request_mismatch', 'adopt_roots_not_configured',
  'adopt_self_process_refused', 'adopt_socket_directory_unsafe', 'adopt_socket_unsafe',
  'adopt_start_evidence_missing', 'adopt_start_timeout', 'adopt_stop_evidence_missing',
  'adopt_stop_receipt_changed', 'adopt_tmux_session_still_exists', 'adopt_tmux_socket_mismatch',
  'adopt_workdir_not_absolute', 'adopt_workdir_outside_roots',
];
for (const lang of ['zh', 'en'] as const) {
  setLanguagePreference(lang);
  const generic = adoptionError(null);
  ck(`${lang} generic text non-empty`, generic.length > 0);
  const seen = new Set<string>();
  for (const code of HUB_CODES) {
    const msg = adoptionError(code);
    ck(`${lang} ${code} specific`, msg.length > 0 && msg !== generic && !msg.includes(code) && msg === ADOPT_REFUSAL_COPY[code][lang === 'zh' ? 0 : 1]);
    seen.add(msg);
  }
  ck(`${lang} messages distinct`, seen.size === HUB_CODES.length);
  const copresence = adoptionError('copresence_adopt_v2');
  ck(`${lang} co-presence refusal explains the unsupported mode`, lang === 'zh'
    ? copresence.includes('共存模式暂不支持') && copresence.includes('已被拒绝')
    : copresence.includes('not currently supported for this co-presence mode') && copresence.includes('request was refused'));
  ck(`${lang} co-presence refusal preserves the existing launch method`, lang === 'zh'
    ? copresence.includes('保留现有启动方式') && copresence.includes('无需停止节点或会话')
    : copresence.includes('Keep the existing launch method') && copresence.includes('no need to stop the node or session'));
  ck(`${lang} suffixed code does not match the dedicated copy`, adoptionError('copresence_adopt_v2_extra') !== copresence);
  ck(`${lang} refusal with sensitive details stays generic`, adoptionError('copresence_adopt_v2: /private/fixture') === generic);
  const unknown = adoptionError('adopt_brand_new_refusal');
  ck(`${lang} unknown code shown with generic text`, unknown.includes('adopt_brand_new_refusal') && unknown !== generic);
  ck(`${lang} hub masked code shown`, adoptionError('lifecycle_error').includes('lifecycle_error'));
  ck(`${lang} free text not echoed`, adoptionError('bin: /private/fixture') === generic);
  ck(`${lang} empty never blank`, adoptionError('') === generic && adoptionError(undefined) === generic);
}
setLanguagePreference('zh');
ck('owner case reads as fix', adoptionError('adopt_path_writable_by_others').includes('chmod go-w'));
ck('mapping covers exactly the hub list', Object.keys(ADOPT_REFUSAL_COPY).sort().join() === [...HUB_CODES].sort().join());
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
