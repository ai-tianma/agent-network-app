"""Software-only seed of verified PUBLIC packages, no source substitution."""
import hashlib
import json
import os
from pathlib import Path
import shutil

assert os.getuid() == 10001
root = Path(os.environ['ANET_PACKAGED_SMOKE_ROOT'])
assert (root / 'profiles/index.json').exists(), 'native authentication must precede software seed'
prefix = root / 'local-daemon/anet'
assert not prefix.exists(), 'never replace an existing prefix'
assert not (root / 'local-daemon/home/.anet/config.json').exists()
assert not (root / 'local-daemon/.anet/nodes/local-daemon/config.json').exists()
manifest = json.loads(Path('/fixture/public-pair.json').read_text())
assert manifest['source'] == 'f86012a30c75f59abeeed3221647f5d2847bd969'
assert manifest['source_candidate'] is False
shutil.copytree('/fixture/exact-prefix', prefix, symlinks=True)
prefix.chmod(0o700)
proof = dict(manifest)
proof['payload_sha256'] = {}
for name, version, entry in [
        ('agent-network', manifest['cli_version'], 'dist/bin/anet.cjs'),
        ('agent-node', manifest['runtime_version'], 'dist/cli.js')]:
    package = prefix / 'lib/node_modules/@sleep2agi' / name
    assert json.loads((package / 'package.json').read_text())['version'] == version
    assert (package / entry).stat().st_mode & 0o111
    proof['payload_sha256'][name] = hashlib.sha256((package / entry).read_bytes()).hexdigest()
Path('/evidence/public-pair-inputs.json').write_text(json.dumps(proof, indent=2))
print('PASS: public170/136 software seeded unchanged; reused prefix, not a source candidate or fresh install', flush=True)
