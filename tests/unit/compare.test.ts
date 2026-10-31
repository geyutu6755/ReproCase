import { describe, expect, it } from 'vitest';
import { compareResults, stableKey } from '../../src/compare.js';
import type { ScanResult } from '../../src/types.js';
import { makeFinding } from '../helpers/fixtures.js';

function makeResult(findings: ReturnType<typeof makeFinding>[], pages: string[]): ScanResult {
  return {
    tool: { name: 'ReproCase', version: '0.2.0-test' },
    startedAt: '2026-11-01T10:00:00.000Z',
    finishedAt: '2026-11-01T10:00:20.000Z',
    target: { entry: 'http://127.0.0.1:4640/', allowedDomains: ['127.0.0.1'] },
    config: {} as ScanResult['config'],
    stats: {
      pagesVisited: pages.length,
      actionsPerformed: 5,
      requestsObserved: 30,
      linksChecked: 6,
      durationMs: 20000,
      findingsRaw: findings.length,
      findingsAfterDedupe: findings.length
    },
    findings,
    pages: pages.map((p, i) => ({
      url: p,
      depth: 0,
      status: 200,
      actions: 1,
      jsErrors: 0,
      resourceErrors: 0,
      overflow: false,
      durationMs: 1000 + i
    })),
    exploration: [],
    notChecked: [],
    summary: {
      verified: findings.filter((f) => f.status === 'verified').length,
      suspected: findings.filter((f) => f.status === 'suspected').length,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byType: {}
    }
  };
}

describe('stableKey', () => {
  it('ignores volatile query parameters and timestamps', () => {
    const a = makeFinding({
      url: 'http://x/page.html?session=abc&page=2',
      firstSeenAt: '2026-01-01T00:00:00Z',
      lastSeenAt: '2026-01-02T00:00:00Z'
    });
    const b = makeFinding({ url: 'http://x/page.html?session=zzz&page=9' });
    expect(stableKey(a)).toBe(stableKey(b));
  });

  it('separates different fault types and signatures', () => {
    const a = makeFinding({ type: 'js-exception', evidence: { message: 'boom one' } });
    const b = makeFinding({ type: 'js-exception', evidence: { message: 'boom two' } });
    const c = makeFinding({ type: 'resource-load-failure', evidence: { message: 'boom one' } });
    expect(stableKey(a)).not.toBe(stableKey(b));
    expect(stableKey(a)).not.toBe(stableKey(c));
  });
});

describe('compareResults', () => {
  const page = 'http://127.0.0.1:4640/page.html';
  const demoUrl = 'http://127.0.0.1:4640/demo.html';

  it('classifies new, persistent and resolved findings', () => {
    const base = makeResult(
      [
        makeFinding({ id: 'fp-1', title: 'kept fault', evidence: { message: 'boom-kept' } }),
        makeFinding({ id: 'fp-2', title: 'gone fault', evidence: { message: 'boom-gone' } })
      ],
      [page, demoUrl]
    );
    const cur = makeResult(
      [
        makeFinding({ id: 'fp-1b', title: 'kept fault', evidence: { message: 'boom-kept' } }),
        makeFinding({ id: 'fp-3', title: 'fresh fault', evidence: { message: 'boom-new' } })
      ],
      [page, demoUrl]
    );
    const r = compareResults(base, cur);
    expect(r.summary.newCount).toBe(1);
    expect(r.summary.resolvedCount).toBe(1);
    expect(r.summary.persistentCount).toBe(1);
    expect(r.new[0].finding.title).toBe('fresh fault');
    expect(r.resolved[0].finding.title).toBe('gone fault');
    expect(r.resolved[0].confirmed).toBe(true);
  });

  it('marks resolved findings unconfirmed when coverage shrank', () => {
    const base = makeResult([makeFinding({ evidence: { message: 'boom-gone' } })], [page, demoUrl]);
    const cur = makeResult([], [page]); // demo.html not visited anymore
    const r = compareResults(base, cur);
    expect(r.summary.resolvedCount).toBe(1);
    expect(r.resolved[0].confirmed).toBe(false);
    expect(r.resolved[0].reason).toContain('NOT visited');
    expect(r.coverage.coverageShrunk).toBe(true);
  });

  it('detects status changes on persistent findings', () => {
    const base = makeResult([makeFinding({ status: 'verified' })], [page]);
    const cur = makeResult([makeFinding({ status: 'suspected' })], [page]);
    const r = compareResults(base, cur);
    expect(r.summary.statusChangedCount).toBe(1);
    expect(r.persistent[0].changes).toEqual([
      { field: 'status', from: 'verified', to: 'suspected' },
      { field: 'reproduction', from: '3/3', to: '3/3' }
    ].filter((c) => c.field === 'status'));
  });

  it('merges the same logical fault across different query strings', () => {
    const base = makeResult(
      [makeFinding({ url: 'http://127.0.0.1:4640/p.html?session=a', evidence: { message: 'boom' } })],
      ['http://127.0.0.1:4640/p.html?session=a']
    );
    const cur = makeResult(
      [makeFinding({ url: 'http://127.0.0.1:4640/p.html?session=b', evidence: { message: 'boom' } })],
      ['http://127.0.0.1:4640/p.html?session=b']
    );
    const r = compareResults(base, cur);
    expect(r.summary.newCount).toBe(0);
    expect(r.summary.resolvedCount).toBe(0);
    expect(r.summary.persistentCount).toBe(1);
  });

  it('never carries timestamps into the comparison output', () => {
    const base = makeResult([makeFinding({ evidence: { message: 'boom' } })], [page]);
    const cur = makeResult([makeFinding({ evidence: { message: 'boom' } })], [page]);
    const r = compareResults(base, cur);
    const raw = JSON.stringify(r);
    expect(raw).not.toContain('firstSeenAt');
    expect(raw).not.toContain('lastSeenAt');
  });
});
