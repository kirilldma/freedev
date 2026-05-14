# Contributing

Go 1.23+. See `go.mod`. Git on `PATH` if you exercise git-backed code. Rest is obvious.

```bash
go run ./cmd/freedev
```

Env vars: README.

Layout: `cmd/freedev` → entry. `internal/app` → HTTP + `//go:embed static`. `internal/webapi` → API. `internal/store` → SQLite. `internal/git*` → git plumbing. Put code where it already lives. Don’t invent new package trees for one function.

Static is embedded. Touch `internal/app/static/**` or app Go → **rebuild the binary**. No magic hot reload.

Before you spam a PR: `gofmt`, `go vet ./...`. Match surrounding style. No random refactors in the same patch as your fix. One topic per PR. Explain what broke and what you changed; skip the essay.

Fork? Fix `go.mod`, `go mod tidy`, say so in the PR.

Release: `make release` or `.\scripts\build-release.ps1`. Output in `dist/`. Don’t commit binaries.

Patches are BSD-3-Clause like the rest. `LICENSE`.
