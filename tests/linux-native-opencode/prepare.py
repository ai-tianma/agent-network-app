"""Only seed the isolated model provider; node identity must be created by UI."""
import json
import os
from pathlib import Path

assert os.getuid() == 10001
root = Path('/home/smoke/v2-native/.anet/nodes/v2-native')
assert not (root / 'config.json').exists(), 'node must not already exist'
if os.getenv('TEST_CURRENT_V2_UI') == '1':
    # Public170/136 reads OpenCode's existing project configuration before
    # creating the child, then copies the selected Provider/model itself.
    # Do not seed a node identity or bypass configured-model alignment.
    config_dir = Path('/home/smoke/v2-native')
    config_dir.mkdir(parents=True, mode=0o700)
    config_dir.chmod(0o700)
else:
    config_dir = root / '.config/opencode'
    config_dir.mkdir(parents=True, mode=0o700)
    for directory in [root, root / '.config', config_dir]:
        directory.chmod(0o700)
provider = {'model': 'stub/stub-model', 'provider': {'stub': {
    'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
    'options': {'baseURL': 'http://127.0.0.1:18827/v1', 'apiKey': 'test-only'},
    'models': {'stub-model': {'name': 'Fixture'}, 'stub-model-next': {'name': 'Next fixture'}}}}}
path = config_dir / 'opencode.json'
assert not path.exists(), 'never replace an existing OpenCode configuration'
path.write_text(json.dumps(provider))
path.chmod(0o600)
print('PASS: isolated provider seeded; no node identity/config created')
