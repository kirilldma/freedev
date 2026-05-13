## v1.0.0

**Added**

- Single-binary server + embedded UI (`/`, `/console.html`).
- SQLite storage; projects, issues, pipelines/build stubs.
- Git over HTTP + REST (repos, tree, blob/raw, upload).
- Auth (login/register/logout), bootstrap, admin settings/users.
- `FREEDEV_ADDR` default `0.0.0.0:8787`; `FREEDEV_DATA`, optional `FREEDEV_BOOTSTRAP_CODE`.

**Binaries**

`freedev-linux-{amd64,arm64,386,armv7}`, `freedev-darwin-{amd64,arm64}`, `freedev-windows-{amd64,386,arm64}.exe` — `CGO_ENABLED=0`.

**Run**

Linux/macOS: `chmod +x … && ./freedev-<platform>-<arch>`. Windows: matching `.exe`. Console: `:8787/console.html`. Git on `PATH` if you use server-side git.

**License:** BSD-3-Clause.
