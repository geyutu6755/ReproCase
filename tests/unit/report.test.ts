import { describe, expect, it } from 'vitest';
import { renderHtml } from '../../src/report/html.js';
import { renderIssuesMarkdown, renderSingleIssue } from '../../src/report/issue.js';
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
});
