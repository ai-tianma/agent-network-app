# Settings Management Handoff

## Scope

- Agent organization: create root/child departments, rename, and change parent.
  Uses existing department APIs. Patches omit leader/sort, parent choices exclude
  self/descendants, and successful writes require a returned department followed
  by a refreshed tree. A failed refresh retries reading, not the mutation.
- User management: searchable member list, role filter buttons with keyboard
  activation, discrete role/access columns, and compact new-user entry.
- Account avatar: local JPEG/PNG/WebP selection, 8 MiB input limit, decode and
  PNG re-encode with longest edge at most 512 pixels. Only the authenticated
  human profile is changed, never Agent avatar settings.

## Verification

- Full suite: 434/434 test files passed with Node 24 and Bun 1.3.14, Bash 5 on PATH.
- `npm run typecheck` and `npx expo export --platform web`: passed.
- Existing Agent organization browser checks: 128/128.
- Department editing browser checks: 94/94.
- User-management browser checks: 94/94, including Space activation of filters.
- Avatar browser checks: 122/122, using the actual Expo file chooser and image
  processing. A 1200x800 PNG becomes 512x341; cancellation, invalid/empty/oversize
  input, unsupported Hub, and server errors retain the original avatar.
- Browser checks use four desktop/mobile and light/dark cases with disposable
  same-origin fixture servers. No production accounts or writes are involved.
- Native iOS/Android chooser/keyboard and signed native packages are not verified
  by these browser checks.

Run the fixture checks after exporting `dist`:

```sh
node tests/agent-org-ui/verify.mjs
node tests/agent-org-ui/departments.mjs
node tests/user-management-ui/verify.mjs
node tests/user-avatar-ui/verify.mjs
```

Screenshots and JSON reports are under each suite's ignored `artifacts/` folder.

## Avatar Backend Release Gate

The client must NOT use ordinary `/api/upload` attachments as global avatars:
their network/Agent ACLs do not match human-profile visibility. No such fallback
is present. Current Hubs without this contract return a truthful upgrade message.

Required atomic endpoint:

```http
POST /api/auth/me/avatar/upload
Authorization: Bearer <user credential>
Content-Type: multipart/form-data
```

Exactly one `file` field containing PNG bytes. Server must independently validate
image contents/dimensions/size, derive the user from authentication, and commit
storage plus the user's avatar value before returning:

```json
{"ok":true,"user_id":"user_id","avatar_url":"/api/users/user_id/avatar/version.png"}
```

User ID/version segments are restricted to `[A-Za-z0-9_-]{1,128}`.
`GET /api/users/{user_id}/avatar/{version}.png` must reauthorize according to
permitted human-profile visibility, not attachment membership or Agent grants.
Return `private, no-store`, never redirect, and reject unrelated viewers and
node credentials. No bearer token may be included in an avatar URL.

Client protected images fetch authenticated bytes, single-flight only pending
requests, and do not reuse an authorized native disk cache across later mounts.
Temporary resources are released when consumers unmount.

Communication agent `通信欧` received the backend coordination task
`64815dc2-6488-4d8c-a8cf-8b80e2724895`. It was delivered but had no completion
receipt at handoff time. Do not claim production avatar upload is available or
release it as complete until the paired Hub implementation and ACL tests pass.

## Release Ownership

User requested `通信欧` review, merge to main, and release. This branch does not
change versions or publish existing tags. Reserve the next available version at
release time; do not overwrite published 0.2.284 or 0.2.285. Keep existing signing,
packaged smoke, and distribution checks. The generated local CommHub build
manifest is not part of these settings changes.
