"""V1 environment/auth/session prerequisite ONLY; no model reply claimed."""
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
assert subprocess.check_output(['opencode', '--version']).decode().strip() == '1.18.34'
root = Path.home() / 'v1-atomic'
root.mkdir(mode=0o700)
(root / 'managed').mkdir(mode=0o700)
password = secrets.token_urlsafe(32)
auth = 'Basic ' + base64.b64encode(('opencode:' + password).encode()).decode()
env = {**os.environ, 'HOME': str(root), 'XDG_CONFIG_HOME': str(root / '.config'),
       'XDG_DATA_HOME': str(root / '.local/share'), 'XDG_CACHE_HOME': str(root / '.cache'),
       'OPENCODE_SERVER_USERNAME': 'opencode', 'OPENCODE_SERVER_PASSWORD': password,
       'OPENCODE_DISABLE_AUTOUPDATE': 'true', 'OPENCODE_DISABLE_PROJECT_CONFIG': 'true',
       'OPENCODE_PURE': '1', 'OPENCODE_DISABLE_EXTERNAL_SKILLS': '1',
       'OPENCODE_DISABLE_CLAUDE_CODE': '1', 'OPENCODE_DISABLE_LSP_DOWNLOAD': '1',
       'OPENCODE_TEST_MANAGED_CONFIG_DIR': str(root / 'managed'),
       'OPENCODE_CONFIG_CONTENT': json.dumps({'permission': {'*': 'deny'}})}


def api(path, body=None, authenticated=True):
    req = urllib.request.Request('http://127.0.0.1:18828' + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', **({'Authorization': auth} if authenticated else {})})
    with urllib.request.urlopen(req, timeout=3) as response:
        return json.load(response)


with open('/evidence/v1-atomic-process.log', 'w') as log:
    process = subprocess.Popen(['opencode', 'serve', '--hostname', '127.0.0.1', '--port', '18828'],
                               cwd=root, env=env, stdout=log, stderr=log, start_new_session=True)
try:
    deadline = time.monotonic() + 30
    while True:
        assert process.poll() is None, 'V1 prerequisite exited'
        try:
            health = api('/global/health')
            break
        except (urllib.error.URLError, TimeoutError):
            assert time.monotonic() < deadline, 'V1 health timeout'
            time.sleep(0.2)
    assert health.get('healthy') is True and health.get('version') == '1.18.34'
    try:
        api('/global/health', authenticated=False)
    except urllib.error.HTTPError as error:
        assert error.code == 401
    else:
        raise AssertionError('V1 unauthenticated health accepted')
    session = api('/session', {'title': 'startup prerequisite only'})
    assert session['id'].startswith('ses_')
    assert api('/session/' + session['id'])['id'] == session['id']
    print('PASS: pinned V1 health, unauthenticated401, authenticated session round-trip; NO model test', flush=True)
finally:
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
