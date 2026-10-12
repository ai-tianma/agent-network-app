"""TEST ONLY source software seed; no profile/credential/identity writes."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

assert os.getuid() == 10001
root = Path(os.environ['ANET_PACKAGED_SMOKE_ROOT'])
assert (root / 'profiles/index.json').exists(), 'native workspace must initialize first'
prefix = root / 'local-daemon/anet'
assert not prefix.exists(), 'never overwrite a prior prefix'
assert not (root / 'local-daemon/home/.anet/config.json').exists()
assert not (root / 'local-daemon/.anet/nodes/local-daemon/config.json').exists()
manifest = json.loads(Path('/fixture/runtime-candidate/TEST_ONLY_SOURCE.json').read_text())
assert manifest['test_only'] is True and manifest['registry_artifact'] is False
assert manifest['source'] == 'ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a'
archive = Path('/fixture/runtime-candidate') / manifest['archive']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['archive_sha256']
shutil.copytree('/fixture/exact-prefix', prefix, symlinks=True)
prefix.chmod(0o700)
package = prefix / 'lib/node_modules/@sleep2agi/agent-node'
# Retain the already installed dependency tree; replace only files explicitly
# present in npm pack's candidate package. No production or registry mutation.
with tarfile.open(archive, 'r:gz') as source:
    for member in source.getmembers():
        relative = Path(member.name)
        assert relative.parts[0] == 'package' and '..' not in relative.parts
        assert member.isfile() or member.isdir(), 'no candidate symlinks'
        target = package.joinpath(*relative.parts[1:])
        assert not target.is_symlink()
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as stream:
                target.write_bytes(stream.read())
            target.chmod(member.mode & 0o777)
cli = package / 'dist/cli.js'
assert hashlib.sha256(cli.read_bytes()).hexdigest() == manifest['cli_sha256']
metadata = json.loads((package / 'package.json').read_text())
assert metadata['name'] == manifest['package_name'] and metadata['version'] == manifest['package_version']
subprocess.run(['node', '--check', str(cli)], check=True)
Path('/evidence/runtime-candidate-source.json').write_text(json.dumps(manifest, indent=2))
print('PASS: TEST-ONLY exact-source runtime seeded; not registry package or clean install', flush=True)
