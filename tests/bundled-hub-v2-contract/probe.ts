// Pure packaged contract selection gate. Not HTTP, daemon or native UI acceptance.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildAnetArgs } from '/candidate/src/create-node-validate.ts';
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) process.exit(1);
}
const manifest = JSON.parse(readFileSync('/candidate/package.json', 'utf8'));
check('exact candidate version', manifest.version === '0.9.0-preview.127');
check('product pin agrees', JSON.parse(readFileSync('/fixture/package.json', 'utf8')).dependencies['@sleep2agi/commhub-server'] === manifest.version);
const locked = JSON.parse(readFileSync('/fixture/package-lock.json', 'utf8')).packages['node_modules/@sleep2agi/commhub-server'];
check('product lock agrees', locked.version === manifest.version && locked.integrity === 'sha512-E2AXhvKeAWC7pMHfy1jvvFg5MhGgGfASTjc9gOBwsee85ZgXjvbHoyuL/lTa6MehEj3NuxK+/OVi0FILl3RY0w==');
check('Rust expected Hub agrees', readFileSync('/fixture/local_hub.rs', 'utf8').includes(`const EXPECTED_HUB_VERSION: &str = "${manifest.version}";`));
// All four files independently matched this main ancestor via GitHub contents:
//31b0dbdae3192f471c8812574c118795658120f0 (not a full-tarball provenance claim).
const sourceHashes = {
  'create-node-validate.ts': 'efff311f1a441c1d14f25d672a8dae5b03a06a4ac43b4b5a91252970e8b75bce',
  'db.ts': '9f5394fb0772df0c4f52bd5555984a4128f27770056667560aec237f4f81e272',
  'tools.ts': 'd8c50362b716ab5c064b80f6938708acfec7faf2568dfc3904130634b4f0f186',
  'server.ts': '1d40b89041075ebeace2d53f98f2887da3d34551443e995177987c71b1ae226e',
};
for (const [file, digest] of Object.entries(sourceHashes)) {
  check(`main-ancestor contract source ${file}`, createHash('sha256').update(readFileSync(`/candidate/src/${file}`)).digest('hex') === digest);
}
const spec = { name: 'test894', runtime: 'opencode-cli' as const, model: 'stub/stub-model' };
check('V1 baseline accepted', buildAnetArgs(spec).includes('opencode-cli'));
let refusal = '';
try { buildAnetArgs({ ...spec, flags: { opencodeGeneration: 'v2' } }); }
catch (error) { refusal = (error as { code: string }).code; }
check('V2 missing explicit opt-in refused precisely', refusal === 'opencode_v2_requires_unsafe_opt_in');
const args = buildAnetArgs({ ...spec, flags: { opencodeGeneration: 'v2', opencodeUnsafeTools: true } });
check('V2 generation emitted', args[args.indexOf('--opencode-generation') + 1] === 'v2');
check('V2 exact argv includes valueless explicit opt-in', JSON.stringify(args) === JSON.stringify([
  'node', 'create', 'test894', '--runtime', 'opencode-cli', '--model', 'stub/stub-model',
  '--opencode-generation', 'v2', '--opencode-unsafe-tools',
]));
// Necessary source contract, not sufficient proof of runtime migration/ack behavior.
for (const file of ['db.ts', 'tools.ts', 'server.ts']) {
  check(`launch proof source contract in ${file}`, readFileSync(`/candidate/src/${file}`, 'utf8').includes('launch_verified_at'));
}
console.log('PASS: candidate selection gate only; require real HTTP/daemon/native UI gates next');
