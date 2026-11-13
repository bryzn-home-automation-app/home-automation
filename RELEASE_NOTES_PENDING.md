# Release notes waiting for Friday

Patch notes go out once a week, on Friday morning, as one entry in
`backend/src/main/java/com/homeplatform/config/ReleaseSeeder.java`. Deploys during
the week do not add an entry or change the version. Instead, add a line here for
each change that the household would notice, in the same plain wording the notes
use (`new` / `improved` / `fixed`, one short line each).

On Friday morning: fold these lines into a single new `define(...)` entry at the
top of `HISTORY`, bump the version in `frontend/package.json` and
`frontend/package-lock.json`, empty the list below, commit and deploy.

## Since the last notes (2.9.1, Fri Nov 13 2026)

Nothing yet.
