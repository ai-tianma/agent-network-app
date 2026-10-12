"""Read-only native lifecycle observer; only proof tasks are submitted via REST."""
import json
import hashlib
import os
from pathlib import Path
import runpy
import sqlite3
import sys
import time
import urllib.parse
import urllib.request

assert os.getuid() == 10001
session = runpy.run_path('/fixture/verify-session.py')
network = session['profile']['networkId']
node_dir = Path('/home/smoke/v2-native/.anet/nodes/v2-native')
evidence = Path('/evidence')
created = json.loads((evidence / 'create-proof.json').read_text())
node_id = created['node_id']
assert created['network_id'] == network
db = sqlite3.connect(f'file:{session["root"]}/local-hub/data/commhub.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row


def api(path, body=None):
    request = urllib.request.Request(session['endpoint'] + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + session['secret'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 200
        return json.load(response)


def snapshot(waiting=False):
    config = json.loads((node_dir / 'config.json').read_text())
    assert config['node_id'] == node_id
    assert config['opencodeGeneration'] == 'v2' and config['flags']['opencodeUnsafeTools'] is True
    try:
        health = json.loads((node_dir / 'opencode-launch-health.json').read_text())
        attach = json.loads((node_dir / 'opencode-attach.json').read_text())
    except FileNotFoundError:
        if waiting:
            return None
        raise
    if waiting and health['generation'] != attach['gen']:
        return None
    assert health['generation'] == attach['gen']
    processes = [health['bridge'], health['serve'], {'pid': attach['pid'], 'ticks': str(attach['startTicks'])}]
    for process in processes:
        try:
            fields = Path(f'/proc/{process["pid"]}/stat').read_text().rsplit(')', 1)[1].split()
        except FileNotFoundError:
            if waiting:
                return None
            raise
        if waiting and (fields[0] in ['Z', 'X', 'x'] or fields[19] != process['ticks']):
            return None
        assert fields[0] not in ['Z', 'X', 'x'] and fields[19] == process['ticks']
    view = api('/api/nodes/' + urllib.parse.quote(node_id) + '/config')
    assert view['node_id'] == node_id and view['config_update_capable'] is True
    assert view['model'] == config['model']
    return {'node_id': node_id, 'network_id': network, 'model': config['model'],
            'revision': view['config_revision'], 'generation': health['generation'],
            'processes': processes, 'source': created['source'], 'deb_sha256': created['deb_sha256']}


def wait(check, message, seconds=100):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.5)
    raise AssertionError(message)


def require_reply(marker, model):
    sent = api('/api/task', {'alias': 'v2-native', 'task': 'Reply with exactly ' + marker, 'network_id': network})
    assert sent.get('ok') and sent.get('message_id')
    def replied():
        query = urllib.parse.urlencode({'network_id': network, 'task_id': sent['message_id']})
        tasks = api('/api/tasks?' + query).get('tasks', [])
        task = next((t for t in tasks if t.get('task_id', t.get('id')) == sent['message_id']), {})
        assert task.get('status') not in ['failed', 'cancelled'], 'lifecycle proof task failed'
        if task.get('status') != 'replied':
            return False
        assert task.get('result') == '[v2-native] ANSWER_NATIVE_' + marker
        return True
    wait(replied, 'lifecycle proof task did not reply', 60)
    records = [json.loads(line) for line in (evidence / 'provider-create.jsonl').read_text().splitlines()]
    turns = [r for r in records if 'Reply with exactly ' + marker in r['user']]
    assert turns and all(r['model'] == model for r in turns), 'lifecycle actual provider model mismatch'


def old_processes_gone(before):
    for process in before['processes']:
        stat = Path(f'/proc/{process["pid"]}/stat')
        if stat.exists():
            fields = stat.read_text().rsplit(')', 1)[1].split()
            if fields[19] == process['ticks'] and fields[0] not in ['Z', 'X', 'x']:
                return False
    return True


def cancel_state():
    state = db.execute('SELECT lifecycle_state FROM nodes WHERE node_id=? AND network_id=?', (node_id, network)).fetchone()
    assert state is not None
    view = api('/api/nodes/' + urllib.parse.quote(node_id) + '/config')
    token = db.execute('SELECT t.revoked_at FROM node_create_requests r JOIN api_tokens t ON t.token_id=r.child_token_id WHERE r.child_node_id=?', (node_id,)).fetchone()
    assert token is not None and token['revoked_at'] is None
    def rows(sql):
        return [dict(row) for row in db.execute(sql, (node_id,)).fetchall()]
    result = {'node_id': node_id, 'network_id': network, 'lifecycle_state': state[0],
              'revision': view['config_revision'], 'model': view['model'],
              'config_sha256': hashlib.sha256((node_dir / 'config.json').read_bytes()).hexdigest(),
              'stop_requests': rows('SELECT request_id,status,action FROM node_stop_requests WHERE child_node_id=? ORDER BY request_id'),
              'config_updates': rows('SELECT update_id,status,new_revision FROM node_config_updates WHERE node_id=? ORDER BY update_id'),
              'create_requests': rows('SELECT request_id,status FROM node_create_requests WHERE child_node_id=? ORDER BY request_id')}
    if state[0] == 'active':
        result['runtime'] = snapshot()
    else:
        assert state[0] == 'stopped'
        assert old_processes_gone(json.loads((evidence / 'lifecycle-model.json').read_text()))
    return result


if sys.argv[1] in ['cancel-before', 'cancel-after']:
    action = sys.argv[2]
    assert action in ['stop', 'start', 'restart']
    path = evidence / ('cancel-' + action + '.json')
    if sys.argv[1] == 'cancel-before':
        path.write_text(json.dumps(cancel_state(), indent=2))
    else:
        before = json.loads(path.read_text())
        # Observe an entire polling interval, not a single premature read.
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            # A submitted stop can change Hub state before its processes exit.
            # Detect that transition directly; do not misclassify the expected
            # negative as a process-cleanup prerequisite failure.
            state = db.execute('SELECT lifecycle_state FROM nodes WHERE node_id=? AND network_id=?', (node_id, network)).fetchone()
            assert state is not None and state[0] == before['lifecycle_state'], 'native cancellation mutated lifecycle state'
            assert cancel_state() == before, 'native cancellation mutated lifecycle state'
            time.sleep(0.5)
        print('PASS: native ' + action + ' cancellation preserved requests/config/identity/process generation')
elif sys.argv[1] == 'baseline':
    before = snapshot()
    assert before['model'] == 'stub/stub-model'
    assert db.execute('SELECT COUNT(*) FROM node_config_updates WHERE node_id=?', (node_id,)).fetchone()[0] == 0
    (evidence / 'lifecycle-baseline.json').write_text(json.dumps(before, indent=2))
    print('PASS: lifecycle baseline has live exact identity/model and no config updates')
elif sys.argv[1] == 'model':
    before = json.loads((evidence / 'lifecycle-baseline.json').read_text())
    if os.getenv('TEST_MODEL_MISS_CLICK') == '1':
        time.sleep(15)
        assert db.execute('SELECT COUNT(*) FROM node_config_updates WHERE node_id=?', (node_id,)).fetchone()[0] == 0
        assert snapshot() == before, 'missed model submit changed runtime identity/config'
        print('PASS: missed model submit left revision/model/generation unchanged', flush=True)
        raise AssertionError('native model switch did not apply')
    def applied():
        rows = db.execute('SELECT patch_json,status,new_revision,error FROM node_config_updates WHERE node_id=?', (node_id,)).fetchall()
        assert len(rows) <= 1, 'duplicate model updates'
        if not rows:
            return None
        row = rows[0]
        assert row['status'] not in ['rejected', 'expired'], 'model update rejected/expired'
        # Hub normalizes an omitted flags patch to an empty object.
        assert json.loads(row['patch_json']) == {'model': 'stub/stub-model-next', 'flags': {}}
        if row['status'] != 'applied':
            return None
        after = snapshot(waiting=True)
        if after is None:
            return None
        assert after['model'] == 'stub/stub-model-next'
        assert after['revision'] == row['new_revision'] and after['revision'] > before['revision']
        assert after['generation'] != before['generation'], 'model switch did not replace runtime generation'
        assert old_processes_gone(before), 'old runtime still live'
        return after
    after = wait(applied, 'native model switch did not apply')
    require_reply('MODEL894', 'stub-model-next')
    (evidence / 'lifecycle-model.json').write_text(json.dumps(after, indent=2))
    print('PASS: native model change applied new revision/generation and actual provider model')
elif sys.argv[1] == 'stopped':
    before = json.loads((evidence / 'lifecycle-model.json').read_text())
    def stopped():
        row = db.execute('SELECT lifecycle_state FROM nodes WHERE node_id=? AND network_id=?', (node_id, network)).fetchone()
        return row is not None and row['lifecycle_state'] == 'stopped' and old_processes_gone(before)
    wait(stopped, 'native stop did not stop every exact runtime process', 60)
    config = json.loads((node_dir / 'config.json').read_text())
    assert config['node_id'] == node_id and config['model'] == before['model']
    token = db.execute('SELECT t.revoked_at FROM node_create_requests r JOIN api_tokens t ON t.token_id=r.child_token_id WHERE r.child_node_id=?', (node_id,)).fetchone()
    assert token is not None and token['revoked_at'] is None, 'stop revoked identity'
    (evidence / 'lifecycle-stopped.json').write_text(json.dumps({'node_id': node_id, 'network_id': network,
        'old_processes_gone': True, 'model_retained': config['model'], 'identity_active': True}, indent=2))
    print('PASS: native stop removed exact runtime processes and retained model/identity')
elif sys.argv[1] in ['started', 'restarted']:
    assert (evidence / 'lifecycle-stopped.json').exists()
    restarting = sys.argv[1] == 'restarted'
    before = json.loads((evidence / ('lifecycle-started.json' if restarting else 'lifecycle-model.json')).read_text())
    def started():
        row = db.execute('SELECT lifecycle_state FROM nodes WHERE node_id=? AND network_id=?', (node_id, network)).fetchone()
        if row is None or row['lifecycle_state'] != 'active':
            return None
        if restarting:
            update = db.execute('SELECT status,apply_mode,new_revision FROM node_config_updates WHERE node_id=? ORDER BY created_at DESC LIMIT 1', (node_id,)).fetchone()
            if update is None or update['apply_mode'] != 'restart_only' or update['status'] != 'applied' or update['new_revision'] <= before['revision']:
                return None
        after = snapshot(waiting=True)
        if after is None or after['generation'] == before['generation']:
            return None
        assert after['model'] == before['model'] and after['revision'] >= before['revision']
        assert after['generation'] != before['generation'] and old_processes_gone(before)
        return after
    after = wait(started, 'native start/restart did not restore exact runtime identity', 100)
    require_reply('RESTART894' if restarting else 'START894', 'stub-model-next')
    (evidence / ('lifecycle-restarted.json' if restarting else 'lifecycle-started.json')).write_text(json.dumps(after, indent=2))
    print('PASS: native ' + ('restart' if restarting else 'start') + ' restored same identity/new generation/model and actual reply')
else:
    raise AssertionError('unknown lifecycle observation mode')
