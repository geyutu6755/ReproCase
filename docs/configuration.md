# Configuration

ReproCase reads a JSON config file (default: `./reprocase.config.json`) and accepts CLI
overrides. Unknown keys and out-of-range values produce **warnings**, not failures.
See [reprocase.config.example.json](../reprocase.config.example.json) for a copy-paste template.

## Full schema

```jsonc
{
  // Required. First page to visit.
  "entry": "http://127.0.0.1:8080/",

  // Hosts (no ports) ReproCase may visit or request. localhost targets are always
  // allowed; anything else MUST be listed here — that is the authorization gate.
  // Wildcards like "*.staging.example.com" are supported.
  "allowedDomains": ["127.0.0.1"],

  // Hard budgets — no infinite crawling.
  "maxPages": 25,               // 1..500
  "maxDepth": 3,                // 0..20
  "maxActionsPerPage": 10,      // 0..100, click actions per page
  "navigationTimeoutMs": 15000, // per-navigation timeout
  "runTimeoutMs": 300000,       // whole-scan budget
  "requestDelayMs": 150,        // pause between page visits / actions

  // Viewports used for overflow measurement and verification.
  "viewports": {
    "desktop": { "width": 1280, "height": 720 },
    "mobile": { "width": 390, "height": 844 }
  },

  // Safe-interaction policy. fillForms is OFF by default and prints a warning
  // when enabled — only use it on sites you own.
  "allowedActions": {
    "clickLinks": true,
    "clickButtons": true,
    "fillForms": false
  },

  // Evidence capture. traces:"auto" captures Playwright traces for localhost
  // targets only; set true/false to override.
  "capture": {
    "screenshots": true,
    "traces": "auto"
  },

  // Independent re-verification runs per finding (fresh browser context each).
  "verification": { "attempts": 3 },

  // Redact sensitive query parameters (token/password/email/...) in all reports.
  "report": { "redactQuery": true }
}
```

## What exploration actually does

- Opens each page in a **fresh browser context** at the desktop viewport.
- Passively listens for: uncaught exceptions, unhandled rejections, `console.error`,
  failed first-party requests, HTTP ≥ 400 responses.
- Measures horizontal overflow at the desktop and mobile viewports, and locates the offending elements.
- Then clicks up to `maxActionsPerPage` **safe candidates**: visible, enabled `<a href>` links and
  buttons that are not inside a `<form>`, not popups/downloads, and whose text/labels/ids match no
  risky keyword (pay, delete, submit, send, logout, ...). Navigational clicks enqueue the
  destination; dialogs are always dismissed.
- After the crawl, every discovered internal link is re-requested via plain HTTP.

## Verification semantics

Each deduplicated finding is re-triggered `verification.attempts` times, each in a fresh
browser context:

- **verified** — reproduced at least once; `confidence` = successes / attempts.
- **suspected** — never reproduced in the verification runs (still reported honestly), or of
  type `console-error`, which is informational by design and never promoted to verified.

Generated Playwright tests are only produced for **verified** findings.

## Not checked (by design)

Every report ships with an explicit "Not checked" section:

- forms and form submission flows
- authenticated / session-specific pages
- third-party resource failures (observed, not reported)
- visual layout beyond horizontal overflow, accessibility, performance
- backend / business-logic correctness

ReproCase never decides whether business outcomes are correct.
