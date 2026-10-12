"""Native creation observer; only subsequent test task dispatch uses REST."""
import json
import os
from pathlib import Path
import re
import runpy
import sqlite3
import sys
import time
import urllib.parse
import urllib.request

node_dir = Path('/home/smoke/v2-native/.anet/nodes/v2-native')
config_path = node_dir / 'config.json'
redact = lambda s: re.sub(r'\b(?:atok|ntok|utok)_[A-Za-z0-9_-]+', '[test-token]', s)
if sys.argv[1] == 'evidence':
    path = node_dir / 'logs/copresence-bridge.log'
    if path.exists():
        Path('/evidence/create-bridge.log').write_text(redact(path.read_text()))
    sys.exit(0)

assert os.getuid() == 10001
session = runpy.run_path('/fixture/verify-session.py')
network = session['profile']['networkId']
assert network
root = session['root']
db = sqlite3.connect(f'file:{root}/local-hub/data/commhub.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row


def api(path, body=None):
    request = urllib.request.Request(session['endpoint'] + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + session['secret'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 200
        return json.load(response)


def wait(check, seconds=90, message='native V2 create did not produce confirmed launch'):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.25)
    raise AssertionError(message)


if sys.argv[1] == 'before':
    assert not config_path.exists(), 'node identity exists before UI create'
    assert db.execute('SELECT COUNT(*) FROM node_create_requests').fetchone()[0] == 0
    with urllib.request.urlopen('http://127.0.0.1:18827/v1/models', timeout=3) as response:
        assert response.status == 200
    print('PASS: provider healthy; no create request/node identity before UI submit')
    sys.exit(0)
assert sys.argv[1] == 'after'


def launched():
    rows = db.execute('SELECT request_id,status,error,child_node_id,network_id FROM node_create_requests').fetchall()
    assert len(rows) <= 1, 'UI generated duplicate create requests'
    if not rows:
        return None
    row = dict(rows[0])
    if row['status'] in ['failed', 'rejected', 'runtime_capability_check_failed']:
        raise AssertionError('native create failed: ' + redact(str(row['error'])))
    if row['status'] != 'succeeded' or not config_path.exists():
        return None
    query = urllib.parse.urlencode({'network_id': network, 'request_id': row['request_id']})
    proof = api('/api/node-create-requests?' + query).get('request', {})
    if not proof.get('launch_verified_at'):
        return None
    assert proof['status'] == 'succeeded' and proof['child_node_id'] == row['child_node_id']
    assert proof['network_id'] == row['network_id'] == network, 'wrong authoritative request network'
    assert proof['runtime'] == 'opencode-cli' and proof['model'] == 'stub/stub-model'
    assert proof['child_name'] == 'v2-native'
    return row


if os.getenv('TEST_CREATE_MISS_CLICK') == '1':
    try:
        wait(launched, 15)
    except AssertionError as error:
        assert str(error) == 'native V2 create did not produce confirmed launch'
        assert not config_path.exists(), 'missed click wrote a node identity'
        assert db.execute('SELECT COUNT(*) FROM node_create_requests').fetchone()[0] == 0
        print('PASS: missed submit left no request or node identity', flush=True)
        raise
    raise AssertionError('missed submit unexpectedly launched a node')

row = wait(launched)
config = json.loads(config_path.read_text())
assert config['node_id'] == row['child_node_id']
assert config['runtime'] == 'opencode-cli'
assert config['opencodeGeneration'] == 'v2' and config['opencodeMode'] == 'copresence'
assert config['flags']['opencodeUnsafeTools'] is True and config['model'] == 'stub/stub-model'
# The child JSON has no network_id field; its token is network-bound. Verify
# authoritative Hub request scope above, rather than inventing a local field.
# The launch proof is the daemon's post-launch verdict, not transient online.
token = db.execute('SELECT t.revoked_at FROM node_create_requests r JOIN api_tokens t ON t.token_id=r.child_token_id WHERE r.request_id=?', (row['request_id'],)).fetchone()
assert token is not None and token['revoked_at'] is None
health = json.loads((node_dir / 'opencode-launch-health.json').read_text())
attach = json.loads((node_dir / 'opencode-attach.json').read_text())
assert health['generation'] == attach['gen']
for process in [health['bridge'], health['serve'], {'pid': attach['pid'], 'ticks': str(attach['startTicks'])}]:
    fields = Path(f'/proc/{process["pid"]}/stat').read_text().rsplit(')', 1)[1].split()
    assert fields[0] not in ['Z', 'X', 'x'] and fields[19] == process['ticks'], 'stale process identity'
print('PASS: native UI created exact V2 config with daemon launch proof/live process identities', flush=True)

sent = api('/api/task', {'alias': 'v2-native', 'task': 'Reply with exactly CREATED894', 'network_id': network})
assert sent.get('ok') and sent.get('message_id')


def answered():
    query = urllib.parse.urlencode({'network_id': network, 'task_id': sent['message_id']})
    tasks = api('/api/tasks?' + query).get('tasks', [])
    task = next((t for t in tasks if t.get('task_id', t.get('id')) == sent['message_id']), {})
    assert task.get('status') not in ['failed', 'cancelled'], 'created runtime task failed'
    if task.get('status') != 'replied':
        return None
    assert task.get('result') == '[v2-native] ANSWER_NATIVE_CREATED894', 'not exact provider response'
    return task


wait(answered, 60, 'native-created V2 task did not return a terminal reply')
records = [json.loads(line) for line in Path('/evidence/provider-create.jsonl').read_text().splitlines()]
turns = [r for r in records if 'Reply with exactly CREATED894' in r['user']]
assert turns and all(r['model'] == 'stub-model' for r in turns), 'wrong actual provider model'
Path('/evidence/create-proof.json').write_text(json.dumps({
    'node_id': row['child_node_id'], 'request_id': row['request_id'], 'runtime': 'opencode-cli',
    'network_id': network,
    'generation': health['generation'], 'model': 'stub/stub-model', 'task_result': 'ANSWER_NATIVE_CREATED894',
    'source': os.environ['TEST_DEB_SOURCE_COMMIT'], 'deb_sha256': os.environ['TEST_DEB_SHA256'],
    'native_ui_create': True, 'subsequent_task_driver': 'REST',
}, indent=2))
print('PASS: native-created V2 node returned provider-only response via real runtime', flush=True)
