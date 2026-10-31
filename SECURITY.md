# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| >= 0.1.1 | ✅ |
| 0.1.0 | ❌ (security defects — see the [audit report](docs/audit-2026-10-31-v0.1.0.md); upgrade to 0.1.1+) |

## Reporting a vulnerability

Open a [GitHub Security Advisory](https://github.com/geyutu6755/ReproCase/security/advisories/new)
(private) instead of a public issue. Include a minimal reproduction and the affected command.

## Security model (what ReproCase guarantees)

- **Authorization gate:** only localhost targets are scanned unless the host is explicitly
  listed in `allowedDomains` (host-level) — and the runtime scope is pinned to the entry origin
  (host **and** port). A redirect to another port/protocol/host is logged and its observations
  are suppressed.
- **Read-only-first exploration:** forms are never typed into or submitted; dialogs are always
  dismissed; hard-dangerous buttons (pay, delete, logout, submit, ...) are never clickable;
  soft-risky buttons are skipped unless explicitly authorized via `exploration.allowSelectors`.
- **Privacy:** URLs and free text (messages, stacks) are redacted for sensitive query parameters
  before anything reaches a report. Browser **traces** record raw network traffic and
  **screenshots** capture raw page content — neither can be reliably auto-redacted, so they are
  treated as **private evidence**: review them before sharing, and CI/Pages workflows in this
  repository strip `artifacts/traces` before any upload.
- **Report integrity:** the HTML report renders everything via `textContent` from escaped JSON;
  findings cannot inject markup. The static server rejects path traversal.

## Known limitations

- The explore deny-list is deliberately conservative; harmless buttons with labels like "run"
  are skipped (configurable per-control via `exploration.allowSelectors`).
- No SSRF hardening beyond the origin pinning described above — do not point ReproCase at
  networks you do not own.
