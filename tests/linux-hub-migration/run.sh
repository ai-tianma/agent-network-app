#!/bin/bash
set -euo pipefail
test "$(id -u)" != 0
test ! -e "$ANET_PACKAGED_SMOKE_ROOT"
test "$ANET_SMOKE_PREVIOUS_HUB_VERSION" = 0.9.0-preview.66
case "${1:-}" in
  upgrade) smoke_flag=--smoke-local-hub-migration ;;
  rollback) smoke_flag=--smoke-local-hub-failed-migration ;;
  *) echo 'FAIL: expected upgrade or rollback' >&2; exit 2 ;;
esac
export ANET_PREVIOUS_HUB_PASSWORD_FILE=/home/smoke/previous-password
printf 'TEST ONLY source=%s deb_sha256=%s scenario=%s\n' "$TEST_DEB_SOURCE_COMMIT" "$TEST_DEB_SHA256" "$1"
timeout 90 node /fixture/seed.mjs "$ANET_PACKAGED_SMOKE_ROOT" \
  /previous/node_modules/@sleep2agi/commhub-server "$ANET_PREVIOUS_HUB_PASSWORD_FILE"
test -s "$ANET_PACKAGED_SMOKE_ROOT/local-hub/data/commhub.db"
timeout 120 /usr/bin/agent-network-desktop "$smoke_flag"
test ! -e "$ANET_PREVIOUS_HUB_PASSWORD_FILE"
# Require a real cross-version snapshot even for the rollback scenario. This
# prevents an older .66 executable's same-version fast path from yielding green.
node --input-type=module - "$1" <<'JS'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.ANET_PACKAGED_SMOKE_ROOT;
const expected = process.argv[2] === 'upgrade' ? '0.9.0-preview.120' : '0.9.0-preview.66';
const config = JSON.parse(readFileSync(join(root, 'local-hub/config.json'), 'utf8'));
if (config.hubVersion !== expected) throw Error('FAIL: resulting Hub version mismatch');
const backups = join(root, 'backups');
const prefix = 'local-hub-migration-0.9.0-preview.66-to-0.9.0-preview.120-';
if (!existsSync(backups) || !readdirSync(backups).some(name => name.startsWith(prefix) && existsSync(join(backups, name, 'data/commhub.db')) && statSync(join(backups, name, 'data/commhub.db')).size > 0)) {
  throw Error('FAIL: cross-version .66-to-.120 snapshot missing');
}
console.log(`PASS: cross-version snapshot and resulting metadata (${expected})`);
JS
echo "PASS: native packaged $1; credentials/database remain disposable container state"
