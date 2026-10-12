"""Read-only V1 lifecycle observer, with REST proof tasks after native actions."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import sqlite3
import sys
import time
import urllib.parse
import urllib.request

assert os.getuid() == 10001
assert os.getenv('TEST_DAEMON_PREFIX_PREPARE'), 'this slice requires explicit TEST-ONLY candidate provenance'
session = runpy.run_path('/fixture/verify-session.py')
network = session['profile']['networkId']
evidence = Path('/evidence')
created = json.loads((evidence / 'v1-registration-proof.json').read_text())
model_proof = json.loads((evidence / 'v1-model-proof.json').read_text())
node_id = created['node_id']
node_dir = Path.home() / 'v1-native/.anet/nodes/v1-native'
assert created['network_id'] == network == model_proof['network_id']
assert model_proof['node_id'] == node_id and model_proof['runtime_candidate']['test_only']
assert not model_proof['runtime_candidate']['registry_artifact']
selected = 'openai/gpt-4.1-selected'
assert model_proof['model'] == selected and model_proof['response'] == 'FIXTURE_ONLY_V1_ACP_RESPONSE'
db = sqlite3.connect(f'file:{session["root"]}/local-hub/data/commhub.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row


def api(path):
    req = urllib.request.Request(session['endpoint'] + path,
        headers={'Authorization': 'Bearer ' + session['secret']})
    with urllib.request.urlopen(req, timeout=5) as response:
        assert response.status == 200
        return json.load(response)


def processes():
    # Redacted pid/start-time/parent identities only; never export argv/env.
    found, roots = {}, []
    cli = session['root'] / 'local-daemon/anet/lib/node_modules/@sleep2agi/agent-node/dist/cli.js'
    assert hashlib.sha256(cli.read_bytes()).hexdigest() == model_proof['runtime_candidate']['cli_sha256']
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            stat = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
            if stat[0] in ['Z', 'X', 'x']:
                continue
            args = (proc / 'cmdline').read_bytes().decode().strip('\0').split('\0')
            found[int(proc.name)] = {'pid': int(proc.name), 'ticks': stat[19], 'parent': int(stat[1])}
            if '--config' in args and args[args.index('--config') + 1] == str(node_dir / 'config.json'):
                assert any(Path(arg).is_absolute() and Path(arg).resolve() == cli.resolve() for arg in args)
                roots.append(int(proc.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    assert len(roots) <= 1, 'duplicate V1 workers'
    if not roots:
        return []
    owned = set(roots)
    while True:
        children = {pid for pid, row in found.items() if row['parent'] in owned}
        if children.issubset(owned):
            break
        owned.update(children)
    return [found[roots[0]]] + [found[pid] for pid in sorted(owned - set(roots))]


def identity():
    row = db.execute('SELECT lifecycle_state FROM nodes WHERE node_id=? AND network_id=?', (node_id, network)).fetchone()
    assert row is not None
    token = db.execute('SELECT t.revoked_at FROM node_create_requests r JOIN api_tokens t ON t.token_id=r.child_token_id WHERE r.child_node_id=?', (node_id,)).fetchone()
    assert token is not None and token['revoked_at'] is None, 'lifecycle revoked original identity'
    return row['lifecycle_state']


def snapshot(waiting=False):
    config = json.loads((node_dir / 'config.json').read_text())
    assert config['node_id'] == node_id and config['runtime'] == 'opencode-cli'
    assert config.get('opencodeGeneration', 'v1') == 'v1'
    assert config.get('opencodeMode', 'headless') == 'headless'
    assert config.get('flags', {}).get('opencodeUnsafeTools', False) is False
    assert not (node_dir / 'opencode-launch-health.json').exists(), 'do not invent V2 launch proof'
    assert not (node_dir / 'opencode-attach.json').exists(), 'do not invent TUI attachment'
    view = api('/api/nodes/' + urllib.parse.quote(node_id) + '/config')
    assert view['model'] == config['model'] == selected
    live = processes()
    if not live and waiting:
        return None
    assert live, 'no exact live V1 worker'
    roster = api('/api/status?' + urllib.parse.urlencode({'network_id': network, 'light': '0'}))['sessions']
    if not any(r.get('node_id') == node_id and r.get('network_id') == network and r.get('status') == 'idle' for r in roster):
        if waiting:
            return None
        raise AssertionError('exact V1 worker not idle in Hub')
    assert identity() == 'active'
    return {'node_id': node_id, 'network_id': network, 'model': selected,
            'revision': view['config_revision'], 'processes': live,
            'source': created['source'], 'deb_sha256': created['deb_sha256'],
            'candidate_source': model_proof['runtime_candidate']['source'],
            'candidate_cli_sha256': model_proof['runtime_candidate']['cli_sha256']}


def gone(before):
    for process in before['processes']:
        try:
            stat = Path(f'/proc/{process["pid"]}/stat').read_text().rsplit(')', 1)[1].split()
        except FileNotFoundError:
            continue
        if stat[19] == process['ticks'] and stat[0] not in ['Z', 'X', 'x']:
            return False
    return True


def wait(check, message, seconds=100):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(.5)
    raise AssertionError(message)


def cancel_state():
    state = identity()
    view = api('/api/nodes/' + urllib.parse.quote(node_id) + '/config')
    def rows(sql):
        return [dict(row) for row in db.execute(sql, (node_id,)).fetchall()]
    result = {'state': state, 'revision': view['config_revision'], 'model': view['model'],
              'config_sha256': hashlib.sha256((node_dir / 'config.json').read_bytes()).hexdigest(),
              'stop_requests': rows('SELECT request_id,status,action FROM node_stop_requests WHERE child_node_id=? ORDER BY request_id'),
              'config_updates': rows('SELECT update_id,status,new_revision FROM node_config_updates WHERE node_id=? ORDER BY update_id'),
              'create_requests': rows('SELECT request_id,status FROM node_create_requests WHERE child_node_id=? ORDER BY request_id')}
    if state == 'active':
        result['runtime'] = snapshot()
    else:
        assert state == 'stopped'
        assert gone(json.loads((evidence / 'v1-lifecycle-baseline.json').read_text()))
        assert not processes(), 'stopped V1 still has worker'
    return result


mode = sys.argv[1]
if mode in ['cancel-before', 'cancel-after']:
    action = sys.argv[2]
    assert action in ['stop', 'start', 'restart']
    path = evidence / ('v1-cancel-' + action + '.json')
    if mode == 'cancel-before':
        path.write_text(json.dumps(cancel_state(), indent=2))
    else:
        before = json.loads(path.read_text())
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            assert identity() == before['state'], 'native V1 cancellation mutated lifecycle state'
            assert cancel_state() == before, 'native V1 cancellation mutated lifecycle state'
            time.sleep(.5)
        print('PASS: native V1 ' + action + ' cancel preserved requests/config/identity/processes', flush=True)
elif mode == 'baseline':
    before = snapshot()
    assert before['revision'] == model_proof['revision'] > 0
    assert before['processes'][0]['pid'] == model_proof['runtime_candidate']['verified_worker_pid']
    (evidence / 'v1-lifecycle-baseline.json').write_text(json.dumps(before, indent=2))
    print('PASS: V1 lifecycle baseline bound to actual candidate worker/model reply', flush=True)
elif mode == 'stopped':
    before = json.loads((evidence / 'v1-lifecycle-baseline.json').read_text())
    wait(lambda: identity() == 'stopped' and gone(before) and not processes(),
         'native V1 stop did not remove exact worker/descendants', 60)
    config = json.loads((node_dir / 'config.json').read_text())
    assert config['node_id'] == node_id and config['model'] == selected
    (evidence / 'v1-lifecycle-stopped.json').write_text(json.dumps({
        **before, 'old_processes_gone': True, 'identity_active': True, 'model_retained': selected}, indent=2))
    print('PASS: native V1 stop removed exact worker/descendants, retained identity/model', flush=True)
elif mode in ['started', 'restarted']:
    assert (evidence / 'v1-lifecycle-stopped.json').exists()
    restarting = mode == 'restarted'
    before = json.loads((evidence / ('v1-lifecycle-started.json' if restarting else 'v1-lifecycle-baseline.json')).read_text())
    if os.getenv('TEST_V1_START_MISS_CLICK') == '1' and not restarting:
        cancelled = json.loads((evidence / 'v1-cancel-start.json').read_text())
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            assert cancel_state() == cancelled, 'missed native V1 start mutated state'
            time.sleep(.5)
        print('PASS: missed native V1 start preserved stopped identity/config/requests and absent worker', flush=True)
        raise AssertionError('native V1 start confirmation did not apply')
    def started():
        if identity() != 'active':
            return None
        if restarting:
            update = db.execute('SELECT status,apply_mode,new_revision FROM node_config_updates WHERE node_id=? ORDER BY created_at DESC LIMIT 1', (node_id,)).fetchone()
            if update is None or update['apply_mode'] != 'restart_only' or update['status'] != 'applied' or update['new_revision'] <= before['revision']:
                return None
        after = snapshot(waiting=True)
        if after is None or after['processes'][0] == before['processes'][0]:
            return None
        assert after['revision'] >= before['revision'] and gone(before), 'old V1 worker/descendants survived'
        return after
    after = wait(started, 'native V1 start/restart did not restore exact identity')
    os.environ['TEST_V1_MODEL_PHASE'] = mode
    runpy.run_path('/fixture/v1-model-verify.py', run_name='__main__')
    # Capture the new actual ACP descendants after the proof turn, so the next
    # restart must remove them too, not just its owning worker.
    final = wait(lambda: snapshot(waiting=True), 'V1 did not return idle after proof reply')
    assert final['processes'][0] == after['processes'][0]
    (evidence / ('v1-lifecycle-' + mode + '.json')).write_text(json.dumps(final, indent=2))
    print('PASS: native V1 ' + mode + ' same identity/new worker/retained model/actual safe ACP reply', flush=True)
else:
    raise AssertionError('unknown V1 lifecycle mode')
