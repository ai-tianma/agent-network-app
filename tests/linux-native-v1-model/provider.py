"""Pinned closed TLS provider plus availability-only CONNECT for native scan."""
import ast
import hashlib
import json
from pathlib import Path
import ssl
import sys
import threading
import urllib.error
import urllib.request

source = Path('/fixture/pinned-v1-provider.py').read_bytes()
assert hashlib.sha256(source).hexdigest() == 'fa6a889fc12be5a8aeb83209876af2c1ca052a84dd878d9c8b76e32d22b444ac'
# Reuse the pinned handler verbatim. Replace only its final server binding so
# the existing native reachability driver and model transport share one port.
tree = ast.parse(source)
last = tree.body.pop()
assert isinstance(last, ast.Expr) and isinstance(last.value, ast.Call)
assert isinstance(last.value.func, ast.Attribute) and last.value.func.attr == 'serve_forever'
sys.argv = ['pinned-v1-provider', '/tmp/v1-native-model/fixture.crt',
            '/tmp/v1-native-model/fixture.key', '/evidence/v1-provider.jsonl']
namespace = {'__name__': 'pinned_v1_fixture'}
exec(compile(tree, '/fixture/pinned-v1-provider.py', 'exec'), namespace)


class NativeProxy(namespace['Proxy']):
    def do_CONNECT(self):
        # No headers, credentials or payloads; distinguish availability from
        # actual TLS model transport when the task fails before a request.
        with Path('/evidence/v1-connect.jsonl').open('a') as journal:
            journal.write(json.dumps({'authority': self.path}) + '\n')
        if self.path == 'opencode.ai:443':
            # Scan availability ONLY; no TLS or external forwarding here.
            self.send_response(200, 'Connection Established')
            self.end_headers()
            self.close_connection = True
            return
        super().do_CONNECT()


server = namespace['ThreadingHTTPServer'](('127.0.0.1', 18829), NativeProxy)
threading.Thread(target=server.serve_forever, daemon=True).start()
context = ssl.create_default_context(cafile='/tmp/v1-native-model/fixture.crt')
opener = urllib.request.build_opener(
    urllib.request.ProxyHandler({'https': 'http://127.0.0.1:18829'}),
    urllib.request.HTTPSHandler(context=context))
try:
    opener.open(urllib.request.Request('https://api.openai.com/v1/responses', data=b'{}',
        headers={'content-type': 'application/json'}), timeout=5)
    raise AssertionError('unauthenticated TLS fixture accepted')
except urllib.error.HTTPError as error:
    assert error.code == 401
print('PASS: closed fixture verified TLS and unauthenticated401 before native workload', flush=True)
Path('/evidence/v1-reachability-ready').touch()
threading.Event().wait()
