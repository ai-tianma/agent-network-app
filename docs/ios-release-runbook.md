# iOS CLI/API release runbook

This runbook keeps the iOS release path reproducible without using the Xcode
GUI. It distinguishes the protected GitHub-hosted path from a self-hosted or
SSH Mac because their keychain requirements are different.

## Shared prerequisites

- Apple Developer membership and an App Store Connect app record for
  `top.vansin.agentnetwork` under team `446BLT75JZ`.
- An App Store Connect API key with the role required to manage signing assets
  and upload builds. Keep its key ID, issuer ID, and `.p8` private key secret.
- A unique numeric `CFBundleVersion` for every uploaded build.
- App Privacy answers completed once in App Store Connect; Apple does not
  expose the complete questionnaire through the public API.

The repository sets `EXPO_USE_PRECOMPILED_MODULES=false` for release builds.
This preserves the known-good behavior from the original remote-Mac release:
native modules compile from the exact checkout instead of relying on a
potentially incompatible precompiled React Native framework.

## Protected GitHub Actions path

Use `.github/workflows/ios-build.yml`.

1. The workflow is manual and runs on `macos-15`.
   It explicitly selects Xcode 26.2 / Swift 6.2 because the image default
   Xcode 16.4 cannot resolve Expo SDK 56's Swift 6.2 package dependencies.
2. It generates `ios/` with Expo CNG, installs pods, and resolves the generated
   workspace and shared scheme.
3. The reviewed `macos-signing` environment supplies the App Store Connect API
   key. Its deployment policy is main-only; never broaden it to arbitrary PR
   branches.
4. The protected job creates an ephemeral Apple Distribution private key/CSR,
   certificate, and `IOS_APP_STORE` profile through the App Store Connect API.
   It imports the identity into a temporary keychain, then archives with manual
   distribution signing and `github.run_number` as `CURRENT_PROJECT_VERSION`.
   An `always()` cleanup revokes the temporary profile/certificate and removes
   local key material.
5. Before export, CI verifies the archive authority and embedded profile:
   no registered-device list, `get-task-allow=false`, and the expected
   team-qualified application identifier.
6. Export creates an App Store IPA and uploads it as an artifact before the
   optional TestFlight step.
7. After a successful TestFlight upload, the same approved job waits up to
   15 minutes for that exact build number to become `VALID`, attaches it to
   every existing ordinary internal group, and reads back membership. Groups
   with `hasAccessToAllBuilds=true` receive no manual attachment; their automatic
   membership is also confirmed. No testers or public groups are changed.
   Failure leaves the IPA/upload evidence intact and reports distribution as
   failed. After correcting the reported cause, dispatch `ios-testflight-status`
   with the same build number and `distribute_to_groups=all-internal` to retry
   distribution without rebuilding or uploading again.

The shared `scripts/ios-distribute-internal.mjs` helper is checked out separately
from the workflow dispatch's exact main SHA. The IPA still uses the requested
release SHA; this lets a current workflow distribute an older main build whose
source predates the helper. Both paths use the existing protected ASC key, with
no additional environment approval between upload and automatic distribution.

First run with `upload_testflight=false`. Inspect and retain the IPA artifact.
Only after that gate succeeds should a maintainer run the same workflow with
`upload_testflight=true`.

## Remote or self-hosted Mac path

An SSH/background session may not have usable access to `login.keychain-db`.
The characteristic signing failure is `errSecInternalComponent`. For that
environment, create a dedicated temporary build keychain, import an Apple
Distribution identity and private key, and grant `codesign` access:

```sh
security create-keychain -p '<KEYCHAIN_PASSWORD>' build.keychain-db
security unlock-keychain -p '<KEYCHAIN_PASSWORD>' build.keychain-db
security import '<DISTRIBUTION_CERTIFICATE.p12>' \
  -k build.keychain-db -P '<P12_PASSWORD>' -A -T /usr/bin/codesign
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: -s \
  -k '<KEYCHAIN_PASSWORD>' build.keychain-db
security list-keychains -d user -s build.keychain-db login.keychain-db
```

Unlock, partition-list configuration, archive, and export must remain in the
same session. Delete the temporary keychain and decrypted credentials after
the build. Do not copy this keychain workaround into GitHub-hosted Actions;
that workflow uses its reviewed environment and ephemeral runner keychain.

## Archive and export contract

The effective command shape is:

```sh
EXPO_USE_PRECOMPILED_MODULES=false npx expo prebuild --platform ios --no-install
(cd ios && pod install)

xcodebuild \
  -workspace ios/<App>.xcworkspace \
  -scheme <Scheme> \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/App.xcarchive \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=446BLT75JZ \
  CODE_SIGN_STYLE=Manual \
  'CODE_SIGN_IDENTITY=Apple Distribution' \
  PROVISIONING_PROFILE_SPECIFIER='<EPHEMERAL_IOS_APP_STORE_PROFILE>' \
  CURRENT_PROJECT_VERSION=<UNIQUE_NUMERIC_BUILD> \
  clean archive

xcodebuild -exportArchive \
  -archivePath build/App.xcarchive \
  -exportPath build/ipa \
  -exportOptionsPlist ios-ci/ExportOptions.plist \
  -allowProvisioningUpdates
```

The actual workflow additionally supplies App Store Connect API-key arguments
to both commands. Never print those secret values.

## TestFlight and App Store Connect API

To inspect an existing upload, dispatch `ios-testflight-status.yml` from `main`
with its numeric build number, `include_app_store_versions=true`, and all write
options disabled (`enable_public_testing=false`,
`set_export_compliance_only=false`, `distribute_to_groups=""`). The protected
job reports App Store version/review states and linked build numbers separately
from TestFlight status. Its App Store response uses a field allowlist, omitting
review accounts and credentials. `complete=false` means more than one response
page exists; do not infer the absence of a public version from that partial
list. A TestFlight upload or Beta Review approval does not establish an App
Store public release.

After upload, use an ES256 JWT (`kid`, issuer, `aud=appstoreconnect-v1`) with
the App Store Connect REST API to:

1. set export-compliance metadata and attach the build to an internal beta
   group;
2. attach a tested build to the App Store version;
3. maintain localizations, category, age rating, privacy-policy URL, screenshots,
   and pricing;
4. create a review submission and submit it only after every required item is
   complete.

Do not automate the final TestFlight upload or App Store review submission
until the preceding artifact/runtime gates have succeeded for that exact build.

## Failure signals

- Requests registered devices / `iOS App Development`: archive selected the
  wrong identity/profile; the distribution verification step must fail.
- `errSecInternalComponent` on an SSH Mac: private-key/keychain access problem,
  not a provisioning-profile request.
- Duplicate build number: rerun through Actions so a new `github.run_number`
  becomes `CFBundleVersion`.
- IPA succeeds but app crashes at launch: confirm the release used
  `EXPO_USE_PRECOMPILED_MODULES=false` and test the exact artifact before any
  submission.
