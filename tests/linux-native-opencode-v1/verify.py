"""Read-only native V1 startup observer; never grants unsafe-tools consent."""
import json
import base64
import os
from pathlib import Path
import re
import runpy
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

node_dir = Path.home() / 'v1-native/.anet/nodes/v1-native'
config_path = node_dir / 'config.json'
redact = lambda s: re.sub(r'\b(?:atok|ntok|utok)_[A-Za-z0-9_-]+', '[test-token]', s)
if sys.argv[1] == 'evidence':
    path = node_dir / 'logs/copresence-bridge.log'
    if path.exists():
        Path('/evidence/v1-bridge.log').write_text(redact(path.read_text()))
    sys.exit(0)
assert os.getuid() == 10001
session = runpy.run_path('/fixture/verify-session.py')
network = session['profile']['networkId']
assert network
db = sqlite3.connect(f'file:{session["root"]}/local-hub/data/commhub.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row
if sys.argv[1] == 'before':
    assert not config_path.exists()
    assert db.execute('SELECT COUNT(*) FROM node_create_requests').fetchone()[0] == 0
    print('PASS: no V1 node identity or create request before real UI submit', flush=True)
    sys.exit(0)
assert sys.argv[1] == 'after'
deadline = time.monotonic() + (15 if os.getenv('TEST_CREATE_MISS_CLICK') == '1' else 90)
while True:
    rows = db.execute('SELECT request_id,status,error,child_node_id,network_id FROM node_create_requests').fetchall()
    assert len(rows) <= 1, 'duplicate native V1 create requests'
    if rows:
        row = dict(rows[0])
        assert row['status'] not in ['failed', 'rejected', 'runtime_capability_check_failed'], 'V1 create failed: ' + redact(str(row['error']))
        if row['status'] == 'succeeded' and config_path.exists():
            created = json.loads(config_path.read_text())
            assert created['node_id'] == row['child_node_id'] and row['network_id'] == network
            if created.get('opencodeMode', 'headless') != 'copresence':
                Path('/evidence/v1-mode-mismatch.json').write_text(json.dumps({
                    'request_id': row['request_id'], 'node_id': row['child_node_id'],
                    'network_id': network, 'status': row['status'],
                    'runtime': created.get('runtime'),
                    'opencode_generation': created.get('opencodeGeneration', 'v1'),
                    'effective_mode': created.get('opencodeMode', 'headless'),
                    'unsafe_tools': created.get('flags', {}).get('opencodeUnsafeTools', False),
                    'source': os.environ['TEST_DEB_SOURCE_COMMIT'],
                    'deb_sha256': os.environ['TEST_DEB_SHA256'],
                }, indent=2))
                raise AssertionError('V1 UI labels copresence but created config defaults to headless')
            if (node_dir / 'opencode-attach.json').exists():
                break
    if time.monotonic() >= deadline:
        if os.getenv('TEST_CREATE_MISS_CLICK') == '1':
            assert not rows and not config_path.exists(), 'missed click mutated V1 identity/request'
            print('PASS: missed submit preserved absent V1 request and identity', flush=True)
        raise AssertionError('native V1 create did not produce verified live startup')
    time.sleep(0.25)
assert os.getenv('TEST_CREATE_MISS_CLICK') != '1', 'missed submit unexpectedly launched V1'
query = urllib.parse.urlencode({'network_id': network, 'request_id': row['request_id']})
request = urllib.request.Request(session['endpoint'] + '/api/node-create-requests?' + query,
                                 headers={'Authorization': 'Bearer ' + session['secret']})
with urllib.request.urlopen(request, timeout=5) as response:
    proof = json.load(response)['request']
assert proof['status'] == 'succeeded' and proof['child_node_id'] == row['child_node_id']
assert proof['network_id'] == row['network_id'] == network
assert proof['runtime'] == 'opencode-cli' and proof['model'] == 'opencode/mimo-v2.6-flash-free' and proof['child_name'] == 'v1-native'
config = json.loads(config_path.read_text())
assert config['node_id'] == row['child_node_id'] and config['runtime'] == 'opencode-cli'
assert config.get('opencodeGeneration', 'v1') == 'v1' and config['opencodeMode'] == 'copresence'
assert config.get('flags', {}).get('opencodeUnsafeTools', False) is False, 'V1 unexpectedly granted unsafe tools'
assert config['model'] == 'opencode/mimo-v2.6-flash-free'
token = db.execute('SELECT t.revoked_at FROM node_create_requests r JOIN api_tokens t ON t.token_id=r.child_token_id WHERE r.request_id=?', (row['request_id'],)).fetchone()
assert token is not None and token['revoked_at'] is None
attach = json.loads((node_dir / 'opencode-attach.json').read_text())
assert attach['gen'] == config['session']


def live(pid):
    directory = Path('/proc') / str(pid)
    fields = (directory / 'stat').read_text().rsplit(')', 1)[1].split()
    assert fields[0] not in ['Z', 'X', 'x'], 'dead V1 process'
    return {'pid': int(pid), 'ticks': fields[19], 'parent': int(fields[1]),
            'args': (directory / 'cmdline').read_bytes().decode().strip('\0').split('\0')}


# V1 does NOT publish V2's launch-health record. Observe its real attach and
# serve/bridge identities independently; do not invent a daemon V2 ACK.
for attempt in range(100):
    tui = live(attach['pid'])
    assert tui['ticks'] == str(attach['startTicks']), 'reused V1 attach PID'
    if '--session' in tui['args'] and tui['args'][tui['args'].index('--session') + 1] == attach['gen']:
        break
    time.sleep(0.05)
else:
    raise AssertionError('V1 attach never execed matching session')
assert 'attach' in tui['args']
url = tui['args'][tui['args'].index('attach') + 1]
parsed = urllib.parse.urlparse(url)
assert parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.port
matches = []
for directory in Path('/proc').iterdir():
    if not directory.name.isdigit():
        continue
    try:
        candidate = live(int(directory.name))
        args = candidate['args']
        if 'serve' in args and '--port' in args and args[args.index('--port') + 1] == str(parsed.port):
            bridge = live(candidate['parent'])
            bargs = bridge['args']
            if '--config' in bargs and bargs[bargs.index('--config') + 1] == str(config_path):
                matches.append((candidate, bridge))
    except (FileNotFoundError, ProcessLookupError, PermissionError, AssertionError):
        pass
assert len(matches) == 1, 'missing or ambiguous V1 serve/bridge ownership'
serve, bridge = matches[0]
assert len({tui['pid'], serve['pid'], bridge['pid']}) == 3
assert Path(f'/proc/{serve["pid"]}/exe').resolve() == Path('/usr/local/bin/opencode').resolve()
private_env = dict(part.split('=', 1) for part in Path(f'/proc/{serve["pid"]}/environ').read_bytes().decode().split('\0') if '=' in part)
assert private_env.get('OPENCODE_PURE') == '1'
permissions = json.loads(private_env['OPENCODE_PERMISSION'])
assert all(permissions.get(tool) == 'deny' for tool in ['bash', 'read', 'write', 'edit', 'task', 'skill', 'webfetch']), 'V1 local-tool deny policy missing'
password = private_env['OPENCODE_SERVER_PASSWORD']
assert password
auth = 'Basic ' + base64.b64encode(('opencode:' + password).encode()).decode()
try:
    urllib.request.urlopen(url + '/global/health', timeout=3)
except urllib.error.HTTPError as error:
    assert error.code == 401
else:
    raise AssertionError('native V1 accepted unauthenticated health')
for path in ['/global/health', '/session/' + attach['gen']]:
    req = urllib.request.Request(url + path, headers={'Authorization': auth})
    with urllib.request.urlopen(req, timeout=3) as response:
        payload = json.load(response)
    if path == '/global/health':
        assert payload.get('healthy') is True and payload.get('version') == '1.18.34'
    else:
        assert payload['id'] == attach['gen']
for process in [tui, serve, bridge]:
    assert live(process['pid'])['ticks'] == process['ticks'], 'V1 identity changed during verification'
reachability = [json.loads(line) for line in Path('/evidence/v1-reachability.jsonl').read_text().splitlines()]
assert any(entry['opencode_connect'] is True for entry in reachability), 'availability fixture was not exercised'
Path('/evidence/v1-create-proof.json').write_text(json.dumps({
    'node_id': row['child_node_id'], 'network_id': network, 'request_id': row['request_id'],
    'opencode_generation': 'v1', 'unsafe_tools': False, 'model': 'opencode/mimo-v2.6-flash-free',
    'process_generation': attach['gen'], 'model_reply_tested': False,
    'external_reachability': 'CONNECT-status fixture only; not vendor or TLS proof',
    'source': os.environ['TEST_DEB_SOURCE_COMMIT'], 'deb_sha256': os.environ['TEST_DEB_SHA256'],
}, indent=2))
print('PASS: native V1 safe-default config, authoritative identity, active token and live process generations; NO model reply', flush=True)
