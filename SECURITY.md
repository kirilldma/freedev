# Security

## Threat model

FreeDev is a **self-hosted** binary: SQLite + repos on disk, HTTP API, Git smart HTTP. Whoever can reach the listen address can hammer the app. Treat it like any admin tool on your LAN — **firewall**, **TLS at the reverse proxy**, **`127.0.0.1` bind** if you don’t need LAN. That’s deployment, not a CVE.

## Reporting

**Real bugs** (auth bypass, RCE, path traversal, broken isolation between projects in a way the code claims to enforce, etc.): use [GitHub Security Advisories](https://github.com/kirilldma/freedev/security/advisories/new) (private report) or open a draft advisory and we’ll triage from there.

Don’t dump public issues with exploit details until there’s a fix or agreed disclosure timeline.

Include: version or commit, repro, impact. PoC optional but speeds things up.

## Out of scope

- “I exposed `:8787` to the internet with no TLS and a guessable password” — fix your ops.
- Social engineering, stolen backups of `FREEDEV_DATA`, compromised host OS.
- Dependency issues: report upstream; we bump when it makes sense.

## Supported versions

Security fixes land on **`main`** and tagged releases going forward. Older tags are best-effort. Run current `main` or latest tag if you care.

## After a fix

We’ll cut a release or tag when the fix is merged. Changelog / release notes call out security-relevant changes when applicable.
