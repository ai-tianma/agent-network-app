"""Read-only native configuration observer; one REST proof task after UI setup."""
import json
import hashlib
import os
from pathlib import Path
import runpy
import time
import urllib.parse
import urllib.request

assert os.getuid() == 10001
session = runpy.run_path('/fixture/verify-session.py')
network = session['profile']['networkId']
created = json.loads(Path('/evidence/v1-registration-proof.json').read_text())
assert created['network_id'] == network
node = Path.home() / 'v1-native/.anet/nodes/v1-native'
selected_model = os.getenv('TEST_SELECTED_MODEL', 'openai/gpt-4.1-selected')
phase = os.getenv('TEST_V1_MODEL_PHASE', '')
assert phase in ['', 'started', 'restarted']
suffix = '-' + phase if phase else ''
prompt = ('ANET_MODEL_BINDING_MAIN_PROMPT_' + phase + ': Return a short test reply.'
          if phase else 'ANET_MODEL_BINDING_MAIN_PROMPT: Return a short test reply.')
expect_rejected = os.getenv('TEST_EXPECT_MODEL_REJECTION') == '1'
if expect_rejected:
    assert selected_model == 'openai/not-in-fixture'
assert selected_model.startswith('openai/') and len(selected_model.split('/')) == 2


def api(path, body=None):
    request = urllib.request.Request(session['endpoint'] + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + session['secret'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 200
        return json.load(response)


def wait(check, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(.3)
    raise AssertionError(message)


def configured():
    config = json.loads((node / 'config.json').read_text())
    assert config['node_id'] == created['node_id']
    assert config.get('opencodeGeneration', 'v1') == 'v1'
    assert config.get('opencodeMode', 'headless') == 'headless'
    assert config.get('flags', {}).get('opencodeUnsafeTools', False) is False
    view = api('/api/nodes/' + urllib.parse.quote(created['node_id']) + '/config')
    if config['model'] != selected_model or view['model'] != config['model']:
        return None
    roster = api('/api/status?' + urllib.parse.urlencode({'network_id': network, 'light': '0'}))['sessions']
    return view if any(r.get('node_id') == created['node_id'] and r.get('status') == 'idle' for r in roster) else None


view = wait(configured, 100, 'native V1 model configuration did not apply')
assert view['config_revision'] > 0
candidate_path = Path('/evidence/runtime-candidate-source.json')
candidate = None
if os.getenv('TEST_DAEMON_PREFIX_PREPARE'):
    candidate = json.loads(candidate_path.read_text())
    assert candidate['test_only'] and not candidate['registry_artifact']
    cli = session['root'] / 'local-daemon/anet/lib/node_modules/@sleep2agi/agent-node/dist/cli.js'
    assert hashlib.sha256(cli.read_bytes()).hexdigest() == candidate['cli_sha256']
    matching = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = (proc / 'cmdline').read_bytes().decode().strip('\0').split('\0')
            if '--config' in args and args[args.index('--config') + 1] == str(node / 'config.json'):
                assert any(Path(arg).is_absolute() and Path(arg).resolve() == cli.resolve() for arg in args)
                matching.append(int(proc.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    assert len(matching) == 1, 'one actual worker must execute the exact candidate CLI'
    candidate['verified_worker_pid'] = matching[0]
    print('PASS: actual native-created worker executes exact TEST-ONLY runtime CLI hash', flush=True)
print('PASS: native UI persisted exact V1 safe model; no model reply claimed yet', flush=True)
sent = api('/api/task', {'alias': 'v1-native', 'task': prompt, 'network_id': network})
assert sent.get('ok') and sent.get('message_id')
safe_children = []


def answered():
    # Observe actual ACP child, not merely a safe flag in node configuration.
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = (proc / 'cmdline').read_bytes().split(b'\0')
            if b'acp' not in args:
                continue
            env = dict(entry.split(b'=', 1) for entry in (proc / 'environ').read_bytes().split(b'\0') if b'=' in entry)
            assert env.get(b'OPENCODE_PURE') == b'1'
            assert json.loads(env[b'OPENCODE_PERMISSION'])['*'] == 'deny'
            safe_children.append(int(proc.name))
            runtime_config_path = Path(env[b'XDG_CONFIG_HOME'].decode()) / 'opencode/opencode.json'
            runtime_config = json.loads(runtime_config_path.read_text())
            # Redacted diagnostics only: never persist auth, argv or full env.
            Path('/evidence/v1-acp-observation' + suffix + '.json').write_text(json.dumps({
                'pid': int(proc.name), 'pure': True, 'wildcard_deny': True,
                'node_selected_model': selected_model,
                'runtime_config_model': runtime_config.get('model'),
                'https_proxy_matches_fixture': env.get(b'HTTPS_PROXY') == b'http://127.0.0.1:18829',
                'ssl_cert_matches_fixture': env.get(b'SSL_CERT_FILE') == b'/tmp/v1-native-model/fixture.crt',
                'extra_ca_matches_fixture': env.get(b'NODE_EXTRA_CA_CERTS') == b'/tmp/v1-native-model/fixture.crt',
            }, indent=2))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    query = urllib.parse.urlencode({'network_id': network, 'task_id': sent['message_id']})
    tasks = api('/api/tasks?' + query).get('tasks', [])
    task = next((t for t in tasks if t.get('task_id', t.get('id')) == sent['message_id']), {})
    if expect_rejected:
        if task.get('status') not in ['failed', 'replied']:
            return False
        assert task.get('status') == 'failed', 'unavailable model must not reply successfully'
        assert 'refusing default-model fallback' in task.get('result', '')
        assert 'model not found: openai/not-in-fixture' in task.get('result', '')
        return True
    if task.get('status') == 'failed':
        raise AssertionError('native V1 proof task failed; inspect isolated evidence')
    if task.get('status') != 'replied':
        return False
    assert task.get('result') == '[v1-native] FIXTURE_ONLY_V1_ACP_RESPONSE', 'not exact fixture-only model response'
    return True


wait(answered, 90, 'native V1 model task did not return a terminal reply')
assert safe_children, 'no actual safe ACP child observed'
records = [json.loads(line) for line in Path('/evidence/v1-provider.jsonl').read_text().splitlines()]
turns = [r for r in records if r['authorized']]
expected = 'deliberately-wrong' if os.getenv('TEST_WRONG_MODEL') == '1' else selected_model.split('/')[1]
if expect_rejected:
    assert not turns, 'unavailable model must not generate with a fallback'
    for pid in set(safe_children):
        proc = Path('/proc') / str(pid)
        if (proc / 'cmdline').exists():
            assert b'acp' not in (proc / 'cmdline').read_bytes().split(b'\0'), 'rejected model ACP child survived'
    print('PASS: native unavailable model failed with exact upstream refusal, zero generation and ACP exit', flush=True)
else:
    print('PASS: native-created V1 consumes fixture-only model response with safe ACP child', flush=True)
    main = [r for r in turns if isinstance(r.get('input'), list)
            and any(p.get('role') == 'system' and str(p.get('content')).startswith('You are opencode,') for p in r['input'])
            and prompt in json.dumps(r['input'])]
    assert len(main) == 1, 'exactly one real main task request'
    assert all(r['model'] == expected for r in main), 'native V1 provider model mismatch'
assert all(r['path'] == '/v1/responses' and r['host'] == 'api.openai.com' for r in turns)
Path('/evidence/v1-model-proof' + suffix + '.json').write_text(json.dumps({
    'source': created['source'], 'deb_sha256': created['deb_sha256'],
    'node_id': created['node_id'], 'network_id': network, 'mode': 'headless',
    'model': selected_model, 'revision': view['config_revision'], 'safe_acp_pids': sorted(set(safe_children)),
    'unsafe_tools': False, 'native_ui_create': True, 'native_ui_model_change': True,
    'proof_task_driver': 'REST', 'response': None if expect_rejected else 'FIXTURE_ONLY_V1_ACP_RESPONSE',
    'unavailable_model_rejected': expect_rejected, 'runtime_candidate': candidate,
}, indent=2))
print('PASS: exact native V1 selected-model gate; candidate/release scope recorded in proof', flush=True)
