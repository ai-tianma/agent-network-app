# User Management Full App Tests

```sh
/Users/vansin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/user-management-ui/verify.mjs
```

Uses the existing exported `dist`, org fixture server, scheduler Tauri bootstrap,
and Playwright installation. Does not build or mount isolated components.
Override `PLAYWRIGHT_MODULE` if needed. No real Hub or credentials are used;
loopback-only serving, CSP, fetch guard and browser routing block external traffic.

Latest result: **94/94 checks, 12 screenshots**, covering desktop 1440x1100 and
mobile 390x844 in both light and dark themes. Mobile emulates an Android browser
and 32px/24px safe areas, not native OS or keyboard behavior.

The fixture contains five members: one owner (self), one admin, two members,
and one viewer. Tests enter Settings through the actual App navigation, then
exercise the users category. Coverage includes total/filtered counts, selected
role semantics, case-insensitive trimmed username/display-name search, clear,
search/role intersection and empty state, duplicate username suppression,
distinct usernames, unchanged disabled self row, other-member edit affordance,
responsive columns, compact new-user header placement, existing dialog fields,
disabled empty submit, draft role selection, cancellation, zero mutations without
submit, bounded dialog and document overflow.

`artifacts/report.json` contains exact checks, screenshots, bundle hashes and
errors. Per-case state logs include every API request and rejected unexpected
write. Screenshots show members, search no-results and the filled unsubmitted
new-user dialog. They are review evidence, not pixel-baseline assertions.
