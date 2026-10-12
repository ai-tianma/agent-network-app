"""TEST ONLY: native credential stays in memory, no credentials in evidence."""
import json
import os
from pathlib import Path
import runpy
import sys
import time
import urllib.parse
import urllib.request

session = runpy.run_path('/fixture/verify-session.py')
root = session['root']
profile_path = root / 'local-daemon/.anet/nodes/local-daemon/config.json'
private_config = root / 'local-daemon/home/.anet/config.json'


def supervisors():
    network = session['profile']['networkId']
    assert network, 'local workspace has no network identity'
    url = session['endpoint'] + '/api/host-supervisors?' + urllib.parse.urlencode({'network_id': network})
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + session['secret']})
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 200
        payload = json.load(response)
    assert payload.get('ok') is True
    return payload['daemons']


if sys.argv[1] == 'before':
    assert not profile_path.exists(), 'scan unexpectedly created a daemon profile'
    assert not private_config.exists(), 'scan unexpectedly wrote daemon credentials'
    assert supervisors() == [], 'daemon already existed before install click'
    print('PASS: UI navigation/scan did not install or register daemon')
elif sys.argv[1] == 'after':
    # The same acceptance runs for missed-click mode; it must fail precisely
    # because no daemon was registered, not because a different layer broke.
    deadline = time.monotonic() + (20 if os.getenv('TEST_DAEMON_UI_MISS_CLICK') == '1' else 150)
    while time.monotonic() < deadline:
        if profile_path.exists():
            profile = json.loads(profile_path.read_text())
            assert profile.get('network_id') == session['profile']['networkId'], 'daemon registered in wrong network'
            for daemon in supervisors():
                if (daemon.get('daemon_node_id') == profile.get('node_id')
                        and daemon.get('online') is True
                        and daemon.get('can_create_nodes') is True):
                    assert profile.get('node_id'), 'missing daemon identity'
                    private_bin = str(root / 'local-daemon/anet/bin')
                    assert private_bin in profile.get('daemonExtraPath', []), 'private pair absent from daemon child PATH'
                    assert profile_path.stat().st_mode & 0o777 == 0o600, 'daemon profile is not owner-only'
                    Path('/evidence/daemon-registration.json').write_text(json.dumps({
                        'node_id': profile['node_id'], 'online': True, 'can_create_nodes': True,
                        'source': os.environ['TEST_DEB_SOURCE_COMMIT'],
                        'deb_sha256': os.environ['TEST_DEB_SHA256'],
                        'private_pair_child_path': private_bin,
                    }, indent=2))
                    print('PASS: UI-created daemon profile matches authenticated online Hub supervisor')
                    sys.exit(0)
        time.sleep(1)
    if os.getenv('TEST_DAEMON_UI_MISS_CLICK') == '1':
        assert not profile_path.exists(), 'missed click unexpectedly created daemon profile'
        assert not private_config.exists(), 'missed click unexpectedly created daemon credentials'
        assert supervisors() == [], 'missed click unexpectedly registered daemon'
        print('PASS: missed click left daemon credentials/profile/Hub roster untouched', flush=True)
    raise AssertionError('UI install click did not register matching online daemon')
else:
    raise AssertionError('unknown verification phase')
