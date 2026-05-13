# FreeDev

One binary. SQLite on disk. Static UI baked in. Projects, tickets, Git over HTTP with browse/upload, YAML-shaped pipeline stubs.

Not OneDev. Not GitLab. Not trying to be. If you need enterprise SSO and RBAC matrices, stop reading and buy something.

**Dependencies:** Go 1.23+. Router is [chi](https://github.com/go-chi/chi). SQLite via `modernc.org/sqlite`. Release builds use `CGO_ENABLED=0` so you are not dragging libc SQLite headaches across targets.


---
# Disclaimer
Join our discord server, its best support for me! https://discord.gg/DbmMQe7ZN
---

## Run it

```bash
go run ./cmd/freedev
```

Console: `http://127.0.0.1:8787/console.html` on same machine (or `http://<host-ip>:8787/` from LAN — default bind is all IPv4 interfaces). Landing: `/`.

Git CLI on `PATH` if you expect the server to actually run git for you. Obvious, but people still open issues without reading.

---

## Environment

Stuff worth touching:

| Variable | Default | What |
|----------|---------|------|
| `FREEDEV_ADDR` | `0.0.0.0:8787` | Listen address (`0.0.0.0` = IPv4 all interfaces). Local-only: `127.0.0.1:8787`. Behind nginx bind loopback if you proxy. |
| `FREEDEV_DATA` | `./data` | SQLite DB + bare repos live here. Back it up or cry later. |
| `FREEDEV_BOOTSTRAP_CODE` | _(unset)_ | First admin creation demands this once if set. |

---

## Release binaries

Cross-compile, stripped, no CGO:

```bash
make release
```

Linux/Git Bash/WSL → above. Windows:

```powershell
.\scripts\build-release.ps1
```

Output in `dist/`:

- `freedev-linux-amd64`, `freedev-linux-arm64`, `freedev-linux-386`, `freedev-linux-armv7`
- `freedev-darwin-amd64`, `freedev-darwin-arm64`
- `freedev-windows-amd64.exe`, `freedev-windows-386.exe`, `freedev-windows-arm64.exe`

`dist/` is gitignored. Ship those files as GitHub Release attachments if you care; nobody wants mega-binary commits in history.

---

## GitHub

1. Make an empty repo. Do not tick “add README” if you already have this tree unless you enjoy merge trivia.

2.

```bash
git init
git add .
git commit -m "Initial import"
git branch -M main
git remote add origin https://github.com/kirilldma/freedev.git
git push -u origin main
```

3. Fork under another namespace or repo name? Fix `module` line in `go.mod`, then `go mod tidy`. Default here is `github.com/kirilldma/freedev`.

4. Tag when you ship:

```bash
git tag v0.4.1
git push origin v0.4.1
```

Attach `dist/*` from `make release` to the release. Done.

---

## Where things live

- `cmd/freedev` — main
- `internal/app` — HTTP, embedded static
- `internal/webapi` — API
- `internal/store` — SQLite
- `internal/gitbrowse`, `internal/gitwork`, `internal/githttp` — Git plumbing

---

## License

BSD-3-Clause. See [LICENSE](LICENSE).
