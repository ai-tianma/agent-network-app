"""TEST ONLY: real OpenCode V2 with a loopback model fixture, no vendor secrets."""
import base64
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import time
import urllib.error
import urllib.request

assert os.getuid() == 10001
assert subprocess.check_output(['opencode', '--version'], timeout=10).decode().strip() == 'opencode v2.0.22'
root = Path('/home/smoke/opencode-atomic')
root.mkdir(mode=0o700)
config = {'model': 'stub/stub-model', 'provider': {'stub': {
    'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
    'options': {'baseURL': 'http://127.0.0.1:18827/v1', 'apiKey': 'test-only'},
    'models': {'stub-model': {'name': 'Fixture'}}}}}
password = secrets.token_urlsafe(32)
env = {**os.environ, 'HOME': str(root), 'XDG_CONFIG_HOME': str(root / '.config'),
       'XDG_DATA_HOME': str(root / '.local/share'), 'XDG_CACHE_HOME': str(root / '.cache'),
       'OPENCODE_SERVER_USERNAME': 'opencode', 'OPENCODE_SERVER_PASSWORD': password,
       'OPENCODE_CONFIG_CONTENT': json.dumps(config)}
processes = []
auth = 'Basic ' + base64.b64encode(('opencode:' + password).encode()).decode()


def api(path, body=None, authenticated=True):
    headers = {'Content-Type': 'application/json'}
    if authenticated:
        headers['Authorization'] = auth
    req = urllib.request.Request('http://127.0.0.1:18828' + path,
                                 data=None if body is None else json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=3) as response:
        data = response.read()
        return json.loads(data) if data else None


def wait(check, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        assert all(p.poll() is None for p in processes), 'fixture process exited before acceptance'
        try:
            if check():
                return
        except urllib.error.URLError:
            pass
        time.sleep(0.2)
    raise AssertionError('runtime atomic acceptance timed out')


try:
    with open('/evidence/provider-process.log', 'w') as log:
        processes.append(subprocess.Popen(['python3', '/fixture/stub-model.py', '18827',
                                           '/evidence/provider.jsonl', 'ANSWER_NATIVE_'],
                                          stdout=log, stderr=log, start_new_session=True))
    wait(lambda: urllib.request.urlopen('http://127.0.0.1:18827/v1/models', timeout=1).status == 200)
    with open('/evidence/runtime-process.log', 'w') as log:
        processes.append(subprocess.Popen(['opencode', 'serve', '--hostname', '127.0.0.1', '--port', '18828'],
                                          cwd=root, env=env, stdout=log, stderr=log, start_new_session=True))
    wait(lambda: bool(api('/api/info').get('version')))
    try:
        api('/api/info', authenticated=False)
    except urllib.error.HTTPError as error:
        assert error.code == 401
    else:
        raise AssertionError('unauthenticated runtime access was accepted')
    print('PASS: actual pinned V2 runtime healthy; unauthenticated access rejected401', flush=True)
    session = api('/api/session', {'title': 'native prerequisite', 'model': {'providerID': 'stub', 'id': 'stub-model'}})['data']['id']
    assert session.startswith('ses_')
    api('/api/session/' + session + '/prompt', {'text': 'Reply with exactly ATOMIC894', 'delivery': 'queue'})

    def answered():
        entries = api('/api/session/' + session + '/message?order=desc&limit=100')['data']
        replies = [''.join(p.get('text', '') for p in e.get('content', []) if p.get('type') == 'text')
                   for e in entries if e.get('type') == 'assistant']
        return 'ANSWER_NATIVE_ATOMIC894' in replies and any(e.get('type') == 'idle' for e in entries)

    wait(answered, 45)
    records = [json.loads(line) for line in Path('/evidence/provider.jsonl').read_text().splitlines()]
    turns = [r for r in records if 'Reply with exactly ATOMIC894' in r['user']]
    assert turns, 'prompt never reached real runtime provider transport'
    expected = 'wrong-model-negative' if os.getenv('TEST_WRONG_MODEL') == '1' else 'stub-model'
    assert all(r['model'] == expected for r in turns), 'provider model mismatch'
    print('PASS: actual V2 session returned provider-only marker and exact requested model', flush=True)
finally:
    for process in reversed(processes):
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
