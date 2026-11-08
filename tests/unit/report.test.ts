import { describe, expect, it } from 'vitest';
import { renderHtml } from '../../src/report/html.js';
import { renderIssuesMarkdown, renderSingleIssue } from '../../src/report/issue.js';
import { aggregateFindings } from '../../src/aggregate.js';
import type { ScanResult } from '../../src/types.js';
import { makeFinding } from '../helpers/fixtures.js';

function makeResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    tool: { name: 'ReproCase', version: '0.1.0-test' },
    startedAt: '2026-10-31T10:00:00.000Z',
    finishedAt: '2026-10-31T10:00:20.000Z',
    target: { entry: 'http://127.0.0.1:4610/', allowedDomains: ['127.0.0.1'] },
    config: {} as ScanResult['config'],
    stats: {
      pagesVisited: 2,
      actionsPerformed: 3,
      requestsObserved: 20,
      linksChecked: 4,
      durationMs: 20000,
      findingsRaw: 5,
      findingsAfterDedupe: 1
    },
    findings: [makeFinding()],
    pages: [
      {
        url: 'http://127.0.0.1:4610/demo.html',
        depth: 0,
        status: 200,
        actions: 3,
        jsErrors: 1,
        resourceErrors: 0,
        overflow: false,
        durationMs: 4000
      }
    ],
    notChecked: [{ area: 'Forms', reason: 'Not exercised.' }],
    summary: {
      verified: 1,
      suspected: 0,
      bySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
      byType: { 'js-exception': 1 }
    },
    ...overrides
  };
}

describe('issue markdown reporter', () => {
  it('renders severity, status, evidence, steps and artifacts', () => {
    const md = renderIssuesMarkdown(makeResult());
    expect(md).toContain('## [HIGH] [verified]');
    expect(md).toContain('`js-exception`');
    expect(md).toContain('3/3 independent verification attempts');
    expect(md).toContain('```text');
    expect(md).toContain('Boom: test error');
    expect(md).toContain('click button "Break it"');
    expect(md).toContain('artifacts/screenshots/demo.png');
    expect(md).toContain('npx playwright show-trace');
  });

  it('notes truncated scans', () => {
    const md = renderIssuesMarkdown(makeResult({ truncated: 'page budget reached (maxPages=2)' }));
    expect(md).toContain('stopped early');
    expect(md).toContain('page budget reached');
  });

  it('renders an explicit all-clear when there are no findings', () => {
    const r = makeResult({
      findings: [],
      summary: {
        verified: 0,
        suspected: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        byType: {}
      }
    });
    const md = renderIssuesMarkdown(r);
    expect(md).toContain('No findings');
  });

  describe('cluster-aware issue markdown', () => {
    const STACK = 'Error: Boom: shared\n    at save (http://127.0.0.1:4640/app.js:1:1)';
    const members = [
      makeFinding({ url: 'http://127.0.0.1:4640/a.html', evidence: { message: 'Boom: shared', stack: STACK } }),
      makeFinding({ url: 'http://127.0.0.1:4640/b.html', evidence: { message: 'Boom: shared', stack: STACK } }),
      makeFinding({
        type: 'resource-load-failure',
        severity: 'medium',
        title: 'First-party resource failed to load: http://127.0.0.1:4640/one.png (HTTP 404)',
        url: 'http://127.0.0.1:4640/one-page.html',
        evidence: { resourceUrl: 'http://127.0.0.1:4640/one.png', statusCode: 404 },
        steps: []
      })
    ];

    function clusteredResult(): ScanResult {
      const findings = members.map((m, i) => ({ ...m, id: 'fp-test' + String(i).padStart(2, '0') }));
      return makeResult({ findings, clusters: aggregateFindings(findings) });
    }

    it('groups exception findings by cluster with collapsed per-page detail', () => {
      const md = renderIssuesMarkdown(clusteredResult());
      expect((md.match(/fault cluster,/g) || []).length).toBe(1);
      expect(md).toContain('Affected pages:');
      expect(md).toContain('<details>');
      expect(md).toContain('</details>');
      expect(md).toContain('http://127.0.0.1:4640/a.html');
      expect(md).toContain('http://127.0.0.1:4640/b.html');
    });

    it('keeps non-clusterable finding types standalone', () => {
      const md = renderIssuesMarkdown(clusteredResult());
      expect(md).toContain('First-party resource failed to load');
      expect(md).toContain('## [MEDIUM] [verified] First-party resource');
    });

    it('renders every finding id exactly once (traceability, no duplication)', () => {
      const md = renderIssuesMarkdown(clusteredResult());
      for (const item of clusteredResult().findings) {
        const count = md.split('`' + item.id + '`').length - 1;
        expect(count, 'finding ' + item.id + ' must appear exactly once').toBe(1);
      }
    });

    it('aggregates repro numbers and lists the cluster id', () => {
      const md = renderIssuesMarkdown(clusteredResult());
      expect(md).toContain('Cluster ID:');
      expect(md).toContain('6/6 member-verification attempts');
    });

    it('renders findings without clusters exactly as before (back-compat)', () => {
      const plain = makeResult({ findings: [makeFinding({ title: 'solo fault', evidence: { message: 'boom' } })], clusters: [] });
      const md = renderIssuesMarkdown(plain);
      expect(md).toContain('## [HIGH] [verified] solo fault');
      expect(md).not.toContain('fault cluster,');
    });
  });

  it('renderSingleIssue produces a standalone document per finding', () => {
    const r = makeResult();
    const single = renderSingleIssue(r.findings[0], r);
    expect(single.startsWith('# [HIGH]')).toBe(true);
    expect(single).toContain('ReproCase');
  });
});

describe('HTML report', () => {
  it('embeds the scan data as JSON and renders offline (no external resources)', () => {
    const html = renderHtml(makeResult());
    expect(html).toContain('window.__REPROCASE_DATA__');
    expect(html).not.toMatch(/src=["']https?:/);
    expect(html).not.toMatch(/href=["']https?:\/\/(?!127\.0\.0\.1)/);
    expect(html).toContain('<!doctype html>');
  });

  it('provides a noscript fallback pointing at result.json/issues.md', () => {
    const html = renderHtml(makeResult());
    expect(html).toContain('<noscript>');
    expect(html).toContain('result.json');
    expect(html).toContain('issues.md');
  });

  it('escapes HTML-sensitive characters inside the embedded data', () => {
    const evil = makeFinding({
      title: 'Evil <img src=x onerror=alert(1)> finding',
      evidence: { message: '<script>alert(1)</script>' }
    });
    const html = renderHtml(makeResult({ findings: [evil] }));
    expect(html).toContain('\\u003cimg src=x');
    expect(html).toContain('\\u003cscript');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).not.toContain('<script>alert(1)');
  });

  it('shows the partial-scan warning when truncated', () => {
    const html = renderHtml(makeResult({ truncated: 'time budget reached' }));
    expect(html).toContain('Partial scan');
    expect(html).toContain('time budget reached');
  });

  it('contains the not-checked section', () => {
    const html = renderHtml(makeResult());
    expect(html).toContain('Not checked');
    expect(html).toContain('Forms');
  });

  it('restricts public sharing of evidence that cannot be auto-redacted (v0.1.1)', () => {
    // Traces record raw network traffic (including unredacted URLs) and
    // screenshots capture raw page content; the report must carry an explicit
    // review-before-sharing warning wherever such artifacts are linked.
    const html = renderHtml(makeResult());
    expect(html).toContain('review them before sharing this report publicly');
    expect(html).toContain('may contain unredacted page content, URLs and query parameters');

    const noEvidence = renderHtml(
      makeResult({
        findings: [makeFinding({ screenshots: [], traces: [] })]
      })
    );
    // Footer warning is always present; the per-finding artifact note is tied
    // to evidence actually being attached.
    expect(noEvidence).toContain('Review them before sharing this report publicly');
    expect(noEvidence.match(/review them before sharing this report publicly/g)).toHaveLength(1);
  });
});

describe('report accuracy & consistency (v0.3.1)', () => {
  it('issues.md lists every finding even when some are grouped into a cluster', () => {
    const members = [
      makeFinding({ url: 'http://127.0.0.1:4610/a.html', evidence: { message: 'Boom: shared', stack: 'Error: Boom: shared\n    at save (http://127.0.0.1:4610/app.js:1:1)' } }),
      makeFinding({ url: 'http://127.0.0.1:4610/b.html', evidence: { message: 'Boom: shared', stack: 'Error: Boom: shared\n    at save (http://127.0.0.1:4610/app.js:1:1)' } })
    ];
    const clusters = aggregateFindings(members);
    expect(clusters).toHaveLength(1); // the two share a confirmed root cause...
    const md = renderIssuesMarkdown(makeResult({ findings: members, clusters }));
    // ...but issues.md keeps each original finding with its own id/evidence.
    expect(md).toContain(members[0].id);
    expect(md).toContain(members[1].id);
    expect(md).toContain('http://127.0.0.1:4610/app.js:1:1');
  });

  it('does not print a fabricated global verification count in the header', () => {
    const r = makeResult({
      findings: [
        makeFinding({ repro: { attempts: 3, successes: 3, observedCount: 1 } }),
        makeFinding({ repro: { attempts: 1, successes: 1, observedCount: 1 } })
      ]
    });
    const md = renderIssuesMarkdown(r);
    expect(md).not.toMatch(/reproduced in \d+ independent browser runs/);
    expect(md).toContain('Each finding below lists its own reproduction ratio.');
    // Per-finding ratios still appear in each finding body.
    expect(md).toMatch(/1\/1 independent verification attempts/);
  });

  it('escapes CJK, emoji and markup so the offline report cannot be injected or mangled', () => {
    const tricky = makeFinding({
      title: '故障 <b>bold</b> 中文 · 🐛',
      evidence: { message: '错误 <script>alert(1)</script> "引号" ' }
    });
    const html = renderHtml(makeResult({ findings: [tricky] }));
    // `<`/`>` inside the embedded JSON are neutralised; raw markup never appears.
    expect(html).toContain('\\u003cscript');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<b>bold</b> 中文');
    // CJK and emoji survive intact (not stripped or double-encoded).
    expect(html).toContain('故障');
    expect(html).toContain('🐛');
  });
});

describe('report URL safety (v0.3.2)', () => {
  it('never renders the target entry as a live non-HTTP(S) anchor in the header', () => {
    const html = renderHtml(
      makeResult({ target: { entry: 'javascript:alert(1)', allowedDomains: ['x'] } })
    );
    // The topbar is server-rendered: it must not emit href="javascript:...".
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/href="data:/i);
    // The value is still shown (escaped) as plain text, not as a clickable link.
    expect(html).toContain('javascript:alert(1)');
  });

  it('keeps a legitimate HTTP(S) target as a clickable header link', () => {
    const html = renderHtml(
      makeResult({ target: { entry: 'https://example.com/app', allowedDomains: ['example.com'] } })
    );
    expect(html).toContain('<a href="https://example.com/app"');
  });

  it('labels trace links as private local evidence, not a public download', () => {
    const withTrace = makeFinding({ traces: ['artifacts/traces/trace-a.zip'] });
    const html = renderHtml(makeResult({ findings: [withTrace] }));
    // v0.3.2 UX: the trace affordance must set expectations that hosted/public copies omit it.
    expect(html).toMatch(/playwright show-trace/);
    expect(html.toLowerCase()).toContain('not included in hosted');
  });
});
