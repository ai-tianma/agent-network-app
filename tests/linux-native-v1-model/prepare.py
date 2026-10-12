"""Ephemeral TLS/auth and explicit node-local fixture transport; no identity/model."""
import json
import os
from pathlib import Path
import subprocess

assert os.getuid() == 10001
node = Path.home() / 'v1-native/.anet/nodes/v1-native'
assert not (node / 'config.json').exists()
assert not (node / '.config/opencode/opencode.json').exists()
auth_dir = node / '.local/share/opencode'
auth_dir.mkdir(parents=True, mode=0o700)
for directory in [node, node / '.local', node / '.local/share', auth_dir]:
    directory.chmod(0o700)
auth = auth_dir / 'auth.json'
auth.write_text(json.dumps({'openai': {'type': 'api', 'key': 'test-only-v1-acp'}}))
auth.chmod(0o600)
root = Path('/tmp/v1-native-model')
root.mkdir(mode=0o700)
subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=api.openai.com', '-addext', 'subjectAltName=DNS:api.openai.com,DNS:models.opencode.ai',
    '-keyout', str(root / 'fixture.key'), '-out', str(root / 'fixture.crt')],
    check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
(root / 'fixture.key').chmod(0o600)
# The daemon intentionally does not inherit ambient proxy/CA settings into nodes.
# Use the supported node-local 0600 env file; do not widen minimalEnv or seed
# model configuration. NODE_* keys are reserved and must not be bypassed here.
transport = node / 'secrets.env'
with open(transport, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
    stream.write('HTTPS_PROXY=http://127.0.0.1:18829\n'
                 'HTTP_PROXY=http://127.0.0.1:18829\n'
                 'NO_PROXY=127.0.0.1,localhost\n'
                 'SSL_CERT_FILE=/tmp/v1-native-model/fixture.crt\n')
assert transport.stat().st_mode & 0o777 == 0o600
print('PASS: synthetic node-local auth and explicit fixture transport; no identity/model config seeded', flush=True)
