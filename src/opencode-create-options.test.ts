import { strict as assert } from 'node:assert';
import { buildCreateNodeSpec } from './create-node-request';
import { describeOpenCodeCreateError, opencodeCreateError, OPENCODE_GENERATION_LABELS, OPENCODE_V1_NOTE } from './opencode-create-options';
import { createRequestVerdict } from './create-request-status';

const base = { name: 'v2-test', runtimeId: 'opencode-cli', model: 'stub/model', runtimeModels: [], permissionMode: 'default', maxTurns: '', budget: '', workdirField: {} };
assert.equal(OPENCODE_GENERATION_LABELS.v1, 'V1（兼容默认 · headless）');
assert.equal(OPENCODE_GENERATION_LABELS.v2, 'V2（实验性 TUI 共存）');
assert.match(OPENCODE_V1_NOTE, /不请求 TUI 共存/);
assert.equal(buildCreateNodeSpec(base).flags, undefined);
assert.equal(buildCreateNodeSpec({ ...base, opencodeGeneration: 'v1', opencodeUnsafeTools: true }).flags, undefined);
for (const consent of [undefined, false, 'true', 1]) {
  assert.throws(() => buildCreateNodeSpec({ ...base, opencodeGeneration: 'v2', opencodeUnsafeTools: consent as boolean }), /明确同意/);
}
const v2 = buildCreateNodeSpec({ ...base, opencodeGeneration: 'v2', opencodeUnsafeTools: true });
assert.deepEqual(v2.flags, { opencodeGeneration: 'v2', opencodeUnsafeTools: true });
assert.equal(v2.runtime, 'opencode-cli');
assert.equal(v2.model, 'stub/model');
assert.equal('opencodeGeneration' in v2, false);
for (const runtimeId of ['codex-app-server', 'codex-sdk', 'claude-agent-sdk', 'claude-code-cli', 'grok-build-acp', 'grok-build-cli']) {
  const request = buildCreateNodeSpec({ ...base, runtimeId, opencodeGeneration: 'v2', opencodeUnsafeTools: true });
  assert.equal(request.flags?.opencodeGeneration, undefined);
  assert.equal(request.flags?.opencodeUnsafeTools, undefined);
  assert.equal(request.flags?.copresence, runtimeId === 'codex-app-server' ? true : undefined);
}
for (const model of ['', 'model', ' provider/model', 'p/m ', 'p/m/x', 'p/', '/m', '../m', 'p/..', 'p/$x', 'p/m;echo', `p/${'x'.repeat(99)}`]) {
  assert.throws(() => buildCreateNodeSpec({ ...base, model, opencodeGeneration: 'v2', opencodeUnsafeTools: true }), /provider\/model/);
}
for (const model of ['p/m', 'opencode/mimo-v2.6-flash-free', 'p-1/m_2.0:latest']) {
  assert.equal(opencodeCreateError({ ...base, model, opencodeGeneration: 'v2', opencodeUnsafeTools: true }), null);
}
for (const field of ['opencodeGeneration', 'opencodeUnsafeTools']) {
  assert.match(describeOpenCodeCreateError({ error: 'flag_key_unknown', field })!, /不会自动改为 V1/);
  const verdict = createRequestVerdict({ status: 'rejected', error: `validate: flag_key_unknown:${field}` });
  assert.equal(verdict.kind, 'failed');
  assert.match((verdict as { text: string }).text, /不会自动改为 V1/);
}
assert.equal(describeOpenCodeCreateError({ error: 'flag_key_unknown', field: 'other' }), null);
console.log('PASS: V2 strict flags, boolean consent, legacy/Codex compatibility, model validation, no downgrade errors');
