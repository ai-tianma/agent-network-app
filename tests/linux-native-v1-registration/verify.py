"""Read-only registration gate. NOT a model, ACP, TUI or V2 launch-proof gate."""
import json
import os
import re
from pathlib import Path
import runpy
import sqlite3
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request

if sys.argv[1] == 'evidence':
    sys.exit(0)  # Do not export credential-bearing profiles/process argv.
assert os.getuid() == 10001
session = runpy.run_path('/fixture/verify-session.py')
network = session['profile']['networkId']
assert network
node_dir = Path.home() / 'v1-native/.anet/nodes/v1-native'
config_path = node_dir / 'config.json'
db = sqlite3.connect(f'file:{session["root"]}/local-hub/data/commhub.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row


def api(path, **query):
    query['network_id'] = network
    req = urllib.request.Request(session['endpoint'] + path + '?' + urllib.parse.urlencode(query),
        headers={'Authorization': 'Bearer ' + session['secret']})
    with urllib.request.urlopen(req, timeout=5) as response:
        assert response.status == 200
        return json.load(response)


def rows():
    return db.execute('SELECT request_id,status,child_node_id,network_id,error FROM node_create_requests').fetchall()


def preserve_refusal(row):
    # Preserve only an opaque reason code, never diagnostic text/paths/keys.
    prefix = str(row.get('error') or '').split(':', 1)[0]
    code = prefix if re.fullmatch(r'[a-z][a-z0-9_]{0,95}', prefix) else 'unclassified'
    proof = {key: row[key] for key in ['request_id', 'status', 'child_node_id', 'network_id']}
    proof.update(error_code=code, observer_read_only=True, model_reply_tested=False,
                 source=os.environ['TEST_DEB_SOURCE_COMMIT'],
                 deb_sha256=os.environ['TEST_DEB_SHA256'])
    Path('/evidence/v1-registration-refusal.json').write_text(json.dumps(proof, indent=2))
    print(f"V1 registration refusal: status={row['status']} error_code={code}", flush=True)


def diagnose_failed_start():
    # One failure-only replay of the SAME public CLI/profile in this isolated
    # fixture, after Hub revoked the child token. NOT a registration retry/pass.
    if not config_path.exists():
        return
    cfg = json.loads(config_path.read_text())
    if cfg.get('runtime') != 'opencode-cli' or cfg.get('opencodeGeneration', 'v1') != 'v1':
        return
    original = rows()[0]
    token = db.execute('SELECT t.revoked_at FROM node_create_requests r JOIN api_tokens t ON t.token_id=r.child_token_id WHERE r.request_id=?', (original['request_id'],)).fetchone()
    if token is None or token['revoked_at'] is None:
        return  # Never diagnose with a still-active identity after rejection.
    daemon_cfg = session['root'] / 'local-daemon/.anet/nodes/local-daemon/config.json'
    daemon = json.loads(daemon_cfg.read_text())
    matches = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = (proc / 'cmdline').read_bytes().split(b'\0')
            if b'--config' in args and args[args.index(b'--config') + 1] == str(daemon_cfg).encode():
                env = dict(e.split(b'=', 1) for e in (proc / 'environ').read_bytes().split(b'\0') if b'=' in e)
                matches.append((proc, {k.decode(): v.decode() for k, v in env.items()}))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    if len(matches) != 1:
        return
    proc, parent = matches[0]
    node_bin = str((proc / 'exe').resolve())
    # Same POSIX minimalEnv inherited keys/fixed PATH from published f860 source.
    inherited = ['USER', 'LOGNAME', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY',
                 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']
    env = {k: parent[k] for k in inherited if parent.get(k)}
    paths = ['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin']
    if str(Path(node_bin).parent) not in paths:
        paths.insert(0, str(Path(node_bin).parent))
    paths.extend(daemon.get('daemonExtraPath', []))
    env.update(HOME=parent['HOME'], LANG=parent.get('LANG', 'C.UTF-8'), PATH=':'.join(paths))
    cli = session['root'] / 'local-daemon/anet/lib/node_modules/@sleep2agi/agent-network/dist/bin/anet.cjs'
    child = subprocess.Popen([node_bin, str(cli), 'node', 'start', 'v1-native'],
        cwd=str(node_dir.parent.parent.parent), env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    timed_out = False
    try:
        output, _ = child.communicate(timeout=12)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            output, _ = child.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            output, _ = child.communicate()
    text = output.decode(errors='replace')[-16384:]
    secrets = [cfg.get('token'), session['secret'], *cfg.get('env', {}).values()]
    for secret in secrets:
        if isinstance(secret, str) and secret:
            text = text.replace(secret, 'REDACTED')
    text = re.sub(r'(?:ntok|atok|utok)_[\w.-]+', 'TOKEN_REDACTED', text)
    Path('/evidence/v1-startup-diagnostic.json').write_text(json.dumps({
        'failure_only_replay': True, 'registration_proof': False,
        'original_request_still_failed': rows()[0]['status'] == original['status'],
        'diagnostic_token_already_revoked': True, 'exit_code': child.returncode,
        'timed_out': timed_out, 'sanitized_output': text,
        'source': os.environ['TEST_DEB_SOURCE_COMMIT'],
        'deb_sha256': os.environ['TEST_DEB_SHA256'],
    }, indent=2))
    print('Failure-only public CLI diagnostic saved; NOT original startup/registration acceptance', flush=True)


def workers():
    found = []
    for directory in Path('/proc').iterdir():
        if not directory.name.isdigit():
            continue
        try:
            args = (directory / 'cmdline').read_bytes().decode().strip('\0').split('\0')
            if '--config' not in args or args[args.index('--config') + 1] != str(config_path):
                continue
            fields = (directory / 'stat').read_text().rsplit(')', 1)[1].split()
            if fields[0] not in ['Z', 'X', 'x']:
                found.append({'pid': int(directory.name), 'start_ticks': fields[19]})
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return found


if sys.argv[1] == 'before':
    assert not rows() and not config_path.exists() and not workers()
    print('PASS: no V1 request/config/worker before native submit', flush=True)
    sys.exit(0)
assert sys.argv[1] == 'after'
missed = os.getenv('TEST_CREATE_MISS_CLICK') == '1'
deadline = time.monotonic() + (15 if missed else 90)
while time.monotonic() < deadline:
    requests = rows()
    assert len(requests) <= 1, 'duplicate V1 create requests'
    if requests:
        row = dict(requests[0])
        if row['status'] in ['failed', 'rejected', 'runtime_capability_check_failed']:
            preserve_refusal(row)
            diagnose_failed_start()
            raise AssertionError('V1 registration rejected')
        if row['status'] == 'succeeded' and config_path.exists():
            roster = api('/api/status', light='0').get('sessions', [])
            exact = [r for r in roster if r.get('node_id') == row['child_node_id'] and r.get('network_id') == network]
            live = workers()
            if len(exact) == 1 and exact[0].get('status') == 'idle' and len(live) == 1:
                break
    time.sleep(0.25)
else:
    if missed:
        assert not rows() and not config_path.exists() and not workers(), 'missed click mutated V1 registration'
        assert not any(r.get('alias') == 'v1-native' for r in api('/api/status', light='0').get('sessions', []))
        print('PASS: missed submit preserved absent request/config/worker/roster identity', flush=True)
    raise AssertionError('native V1 registration did not bind a live headless worker')
assert not missed, 'missed submit unexpectedly registered V1'
config = json.loads(config_path.read_text())
assert config_path.stat().st_mode & 0o777 == 0o600
assert config['node_id'] == row['child_node_id'] and row['network_id'] == network
assert config['runtime'] == 'opencode-cli' and config.get('opencodeGeneration', 'v1') == 'v1'
assert config.get('opencodeMode', 'headless') == 'headless'
assert config.get('flags', {}).get('opencodeUnsafeTools', False) is False
assert config['model'] == 'opencode/mimo-v2.6-flash-free'
assert not (node_dir / 'opencode-attach.json').exists(), 'headless creation unexpectedly attached TUI'
assert not (node_dir / 'opencode-launch-health.json').exists(), 'V1 registration incorrectly presents V2 launch proof'
request = api('/api/node-create-requests', request_id=row['request_id'])['request']
assert request['status'] == 'succeeded' and request['child_node_id'] == config['node_id']
assert request['network_id'] == network and request['child_name'] == 'v1-native'
assert request['runtime'] == config['runtime'] and request['model'] == config['model']
assert not request.get('launch_verified_at'), 'V1 must not invent V2 launch proof'
token = db.execute('SELECT t.revoked_at FROM node_create_requests r JOIN api_tokens t ON t.token_id=r.child_token_id WHERE r.request_id=?', (row['request_id'],)).fetchone()
assert token is not None and token['revoked_at'] is None
time.sleep(2)
assert workers() == live, 'headless worker identity changed during verification'
assert any(r.get('node_id') == config['node_id'] and r.get('status') == 'idle'
           for r in api('/api/status', light='0').get('sessions', [])), 'headless registration lost online state'
Path('/evidence/v1-registration-proof.json').write_text(json.dumps({
    'request_id': row['request_id'], 'node_id': config['node_id'], 'network_id': network,
    'runtime': config['runtime'], 'generation': 'v1', 'mode': 'headless', 'unsafe_tools': False,
    'worker': live[0], 'model': config['model'], 'model_reply_tested': False,
    'native_ui_create': True, 'observer_read_only': True,
    'source': os.environ['TEST_DEB_SOURCE_COMMIT'], 'deb_sha256': os.environ['TEST_DEB_SHA256'],
}, indent=2))
print('PASS: native V1 legacy registration binds request/config/token/roster/live headless worker; NO ACP/model/TUI proof', flush=True)
