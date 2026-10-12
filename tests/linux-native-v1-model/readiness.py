"""Wait for actual daemon measurement before using the reviewed native layout."""
import json
from pathlib import Path
import runpy
import time
import urllib.parse
import urllib.request

session = runpy.run_path('/fixture/verify-session.py')
registered = json.loads(Path('/evidence/daemon-registration.json').read_text())
query = urllib.parse.urlencode({'network_id': session['profile']['networkId']})
others = ['claude-agent-sdk', 'codex-sdk', 'grok-build-acp',
          'claude-code-cli', 'codex-app-server']
deadline = time.monotonic() + 150
observed = set()
while time.monotonic() < deadline:
    req = urllib.request.Request(session['endpoint'] + '/api/host-supervisors?' + query,
        headers={'Authorization': 'Bearer ' + session['secret']})
    with urllib.request.urlopen(req, timeout=5) as response:
        assert response.status == 200
        payload = json.load(response)
    daemon = next((d for d in payload['daemons']
                   if d['daemon_node_id'] == registered['node_id']), None)
    readiness = (daemon or {}).get('runtime_readiness') or {}
    observed.add('measured' if readiness else 'unmeasured')
    entry = readiness.get('opencode-cli', {})
    if (daemon and daemon.get('online') and daemon.get('can_create_nodes')
            and entry.get('state') == 'ready' and entry.get('checked_at')
            and all(readiness.get(r, {}).get('state') in
                    ['missing_cli', 'not_logged_in', 'no_network'] for r in others)):
        Path('/evidence/v1-readiness.json').write_text(json.dumps({
            'daemon_node_id': registered['node_id'],
            'network_id': session['profile']['networkId'],
            'observed_states': sorted(observed),
            'runtime_states': {r: readiness[r]['state'] for r in others + ['opencode-cli']},
            'opencode_checked_at': entry['checked_at'],
            'observer_read_only': True,
        }, indent=2))
        print('PASS: actual daemon runtime measurement matches reviewed native layout', flush=True)
        break
    time.sleep(.5)
else:
    raise AssertionError('native V1 measured runtime layout not ready; do not click wizard')
