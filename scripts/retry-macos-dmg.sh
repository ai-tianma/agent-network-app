#!/usr/bin/env bash
# The release workflow embeds this file in a heredoc. CI runs that copy:
# workflow_dispatch checks out the release SHA, which does not contain this path.
# Retry only the macOS DMG step after the .app is already notarized and stapled.
#
# tauri-bundler 2.11.2 runs bundle_dmg.sh (create-dmg 1.2.1 / hdiutil) after
# notarization. On GitHub macos-14 that script often dies in a few seconds
# with "failed to run bundle_dmg.sh" and leaves diskimages-helper behind.
# Without --verbose, tauri drops the script's stderr. Running `tauri build`
# again deletes the stapled .app and notarizes a second time. This wrapper
# keeps that app, retries bundle_dmg.sh, then codesigns the DMG with the
# Developer ID certificate still in the job environment. Tauri deletes its
# temporary keychain on exit, so the DMG signature is a new import of the
# same certificate, not a second notarization.
set -u
set -o pipefail

ATTEMPTS="${ANET_DMG_ATTEMPTS:-3}"
keychain_path=""
p12_path=""

cleanup_signing() {
  if [[ -n "$keychain_path" ]]; then
    security delete-keychain "$keychain_path" >/dev/null 2>&1 || true
    keychain_path=""
  fi
  if [[ -n "$p12_path" ]]; then
    rm -f "$p12_path"
    p12_path=""
  fi
}
trap cleanup_signing EXIT

run_tauri() {
  if [[ -n "${ANET_TAURI_BIN:-}" ]]; then
    "$ANET_TAURI_BIN" "$@"
    return
  fi
  if command -v bun >/dev/null 2>&1; then
    bun tauri "$@"
    return
  fi
  npx --no-install tauri "$@"
}

cleanup_disk_images() {
  local bundle_dir="$1"
  local line info token matched=0
  if command -v hdiutil >/dev/null 2>&1; then
    # hdiutil info prints "image-path      : <file>" and then the /dev/disk
    # nodes for that image. Detach the whole disk, not a partition slice.
    info="$(hdiutil info 2>/dev/null || true)"
    while IFS= read -r line; do
      case "$line" in
        image-path*)
          matched=0
          case "$line" in
            *"$bundle_dir"*) matched=1 ;;
          esac
          ;;
        /dev/disk*)
          token="${line%% *}"
          token="${token%%$'\t'*}"
          case "$token" in
            *s[0-9]*) ;;
            *)
              if [[ "$matched" -eq 1 ]]; then
                hdiutil detach "$token" >/dev/null 2>&1 || hdiutil detach -force "$token" >/dev/null 2>&1 || true
                matched=0
              fi
              ;;
          esac
          ;;
      esac
    done <<< "$info"
  fi
  if command -v pkill >/dev/null 2>&1; then
    # GHA's orphan cleanup prints the truncated name diskimages-help.
    pkill -x diskimages-helper >/dev/null 2>&1 || true
    pkill -x diskimages-help >/dev/null 2>&1 || true
    pkill -x diskimages-hel >/dev/null 2>&1 || true
  fi
}

sign_dmg() {
  local dmg="$1"
  local identity="${APPLE_SIGNING_IDENTITY:-}"
  if [[ -z "$identity" || "$identity" == "-" ]]; then
    echo "DMG left unsigned (APPLE_SIGNING_IDENTITY is unset or ad-hoc)."
    return 0
  fi
  if [[ -z "${APPLE_CERTIFICATE:-}" || -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]]; then
    echo "DMG codesign needs APPLE_CERTIFICATE and APPLE_CERTIFICATE_PASSWORD." >&2
    return 1
  fi
  local password dest
  password="$(openssl rand -hex 16)"
  dest="${RUNNER_TEMP:-/tmp}"
  keychain_path="$dest/anet-dmg-$$.keychain-db"
  p12_path="$(mktemp "$dest/anet-dmg-cert.XXXXXX")"
  chmod 600 "$p12_path"
  printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$p12_path"
  security create-keychain -p "$password" "$keychain_path"
  security unlock-keychain -p "$password" "$keychain_path"
  security import "$p12_path" -k "$keychain_path" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
  security set-keychain-settings -t 3600 -u "$keychain_path"
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain_path"
  rm -f "$p12_path"
  p12_path=""
  local args=(--force -s "$identity" --keychain "$keychain_path")
  if [[ -n "${entitlements:-}" ]]; then
    if [[ ! -f "$entitlements" ]]; then
      echo "Entitlements file not found: $entitlements" >&2
      return 1
    fi
    args+=(--entitlements "$entitlements")
  fi
  echo "Signing DMG with identity \"$identity\""
  codesign "${args[@]}" "$dmg"
  codesign --verify --verbose=2 "$dmg"
  cleanup_signing
}

has_dmg=0
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--bundles" && "$arg" == *dmg* ]]; then
    has_dmg=1
  fi
  if [[ "$arg" == --bundles=* && "$arg" == *dmg* ]]; then
    has_dmg=1
  fi
  prev="$arg"
done

tauri_args=("$@")
seen_verbose=0
for arg in "${tauri_args[@]}"; do
  if [[ "$arg" == "--verbose" || "$arg" == "-v" ]]; then
    seen_verbose=1
  fi
done
if [[ "$seen_verbose" -eq 0 ]]; then
  tauri_args+=("--verbose")
fi

set +e
run_tauri "${tauri_args[@]}"
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  exit 0
fi

if [[ "$has_dmg" -eq 0 ]]; then
  echo "tauri build failed and --bundles did not include dmg; not retrying."
  exit "$status"
fi

if [[ "$(uname -s)" != "Darwin" && "${ANET_DMG_ASSUME_DARWIN:-}" != "1" ]]; then
  echo "tauri build failed off macOS; not retrying the DMG."
  exit "$status"
fi

layout="$(node << 'END_LAYOUT'
const c = require('./src-tauri/tauri.conf.json');
const mac = (c.bundle && c.bundle.macOS) || {};
const dmg = mac.dmg || {};
const app = dmg.appPosition || { x: 180, y: 170 };
const folder = dmg.applicationFolderPosition || { x: 480, y: 170 };
const size = dmg.windowSize || { width: 660, height: 400 };
const ent = mac.entitlements || '';
process.stdout.write([c.productName, c.version, app.x, app.y, folder.x, folder.y, size.width, size.height, ent].join('\t') + '\n');
END_LAYOUT
)" || {
  echo "Not retrying DMG: could not read src-tauri/tauri.conf.json."
  exit "$status"
}

IFS=$'\t' read -r product version ax ay fx fy ww hh entitlements <<< "$layout"
if [[ -z "${product:-}" || -z "${version:-}" ]]; then
  echo "Not retrying DMG: tauri.conf.json has no productName or version."
  exit "$status"
fi
if [[ -n "${entitlements:-}" && "${entitlements#/}" == "$entitlements" ]]; then
  entitlements="src-tauri/${entitlements#./}"
fi

case "$(uname -m)" in
  arm64|aarch64) arch=aarch64 ;;
  x86_64) arch=x64 ;;
  *)
    echo "Not retrying DMG: unsupported architecture $(uname -m)."
    exit "$status"
    ;;
esac

root="$(pwd)"
bundle="$root/src-tauri/target/release/bundle"
macos_dir="$bundle/macos"
dmg_dir="$bundle/dmg"
app_path="$macos_dir/${product}.app"
dmg_name="${product}_${version}_${arch}.dmg"
script="$dmg_dir/bundle_dmg.sh"

if [[ ! -d "$app_path" || ! -f "$script" ]]; then
  echo "Not retrying DMG: stapled app or bundle_dmg.sh is missing (this failure is earlier than the hdiutil step)."
  exit "$status"
fi

if ! xcrun stapler validate "$app_path"; then
  echo "Not retrying DMG: the app is not stapled, so notarization did not finish."
  exit "$status"
fi

echo "macOS DMG bundling failed after notarization was accepted. Retrying bundle_dmg.sh only; the stapled app is kept."

dmg_args=(
  --volname "$product"
  --icon "${product}.app" "$ax" "$ay"
  --app-drop-link "$fx" "$fy"
  --window-size "$ww" "$hh"
  --hide-extension "${product}.app"
)
if [[ -f "$dmg_dir/icon.icns" ]]; then
  dmg_args+=(--volicon "$dmg_dir/icon.icns")
fi
dmg_args+=("$dmg_name" "${product}.app")

attempt=2
while [[ "$attempt" -le "$ATTEMPTS" ]]; do
  cleanup_disk_images "$bundle"
  if [[ -n "${ANET_DMG_BACKOFF_SECONDS:-}" ]]; then
    wait_s="$ANET_DMG_BACKOFF_SECONDS"
  else
    wait_s=$(( (attempt - 1) * 10 ))
  fi
  echo "DMG retry ${attempt}/${ATTEMPTS}: waiting ${wait_s}s for diskimages-helper to exit"
  sleep "$wait_s"
  cleanup_disk_images "$bundle"
  rm -f "$macos_dir/$dmg_name" "$macos_dir"/rw.*.dmg "$dmg_dir"/rw.*.dmg
  if (
    cd "$macos_dir"
    bash "$script" "${dmg_args[@]}"
  ); then
    if [[ -s "$macos_dir/$dmg_name" ]]; then
      mv -f "$macos_dir/$dmg_name" "$dmg_dir/$dmg_name"
      sign_dmg "$dmg_dir/$dmg_name"
      echo "DMG retry ${attempt} produced $dmg_dir/$dmg_name"
      exit 0
    fi
    echo "bundle_dmg.sh exited 0 but did not write $dmg_name"
  fi
  echo "DMG retry ${attempt} failed"
  attempt=$((attempt + 1))
done

echo "DMG bundling failed after ${ATTEMPTS} attempts. The stapled app was not re-notarized."
exit 1
