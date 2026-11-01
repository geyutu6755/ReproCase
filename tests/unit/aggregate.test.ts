import { describe, expect, it } from 'vitest';
import { aggregateFindings, clusterKeyOf, topFrameOf } from '../../src/aggregate.js';
import { makeFinding } from '../helpers/fixtures.js';

function stackAt(script: string, fn: string): string {
  return `Error: boom\n    at ${fn} (http://127.0.0.1:4640/${script}:12:34)\n    at vendor (http://127.0.0.1:4640/vendor.js:1:1)`;
}

describe('topFrameOf normalization', () => {
  it('extracts script basename and function, stripping dirs/ports/line:col', () => {
    const f = topFrameOf(stackAt('js/components/deploy-tab.js', 'onBuild'));
    expect(f).toEqual({ script: 'deploy-tab.js', fn: 'onBuild' });
  });

  it('resolves inline scripts without a path', () => {
    expect(topFrameOf('Error: x\n    at http://127.0.0.1:4661/:33:19')).toEqual({
      script: '(inline)',
      fn: '(anonymous)'
    });
  });

  it('returns null without a stack', () => {
    expect(topFrameOf(undefined)).toBeNull();
    expect(topFrameOf('Error: no frames here')).toBeNull();
  });
});

describe('aggregateFindings (cross-page fault clusters)', () => {
  it('merges the same root cause reached from different pages into one cluster', () => {
    const findings = [
      makeFinding({ url: 'http://x/a.html', evidence: { message: 'Boom: quota exceeded', stack: stackAt('app.js', 'save') } }),
      makeFinding({ url: 'http://x/b.html', evidence: { message: 'Boom: quota exceeded', stack: stackAt('app.js', 'save') } }),
      makeFinding({ url: 'http://x/c.html?route=deep', evidence: { message: 'Boom: quota exceeded', stack: stackAt('app.js', 'save') } })
    ];
    const clusters = aggregateFindings(findings);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(3);
    expect(clusters[0].pages).toHaveLength(3);
    expect(clusters[0].signatureQuality).toBe('stack+message');
    // Sum semantics: 3 members × 3/3 verification each.
    expect(clusters[0].repro.successes).toBe(9);
    expect(clusters[0].repro.attempts).toBe(9);
    expect(clusters[0].status).toBe('verified');
  });

  it('does NOT merge similar messages from different components (wrong-merge guard)', () => {
    const findings = [
      makeFinding({ url: 'http://x/a.html', evidence: { message: 'Cannot read properties of undefined (reading id)', stack: stackAt('cart.js', 'render') } }),
      makeFinding({ url: 'http://x/b.html', evidence: { message: 'Cannot read properties of undefined (reading id)', stack: stackAt('profile.js', 'render') } })
    ];
    const clusters = aggregateFindings(findings);
    expect(clusters).toHaveLength(2);
  });

  it('does NOT merge different messages from the same component (miss-merge guard)', () => {
    const findings = [
      makeFinding({ url: 'http://x/a.html', evidence: { message: 'Boom: quota exceeded', stack: stackAt('app.js', 'save') } }),
      makeFinding({ url: 'http://x/a.html', evidence: { message: 'Boom: network lost', stack: stackAt('app.js', 'save') } })
    ];
    expect(aggregateFindings(findings)).toHaveLength(2);
  });

  it('falls back to a message-only key without a stack and marks the quality', () => {
    const findings = [
      makeFinding({ url: 'http://x/a.html', evidence: { message: 'Legacy failure', stack: undefined } }),
      makeFinding({ url: 'http://x/b.html', evidence: { message: 'Legacy failure', stack: undefined } })
    ];
    const clusters = aggregateFindings(findings);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].signatureQuality).toBe('message-only');
  });

  it('only clusters exception and console-error types (others are fingerprint-merged)', () => {
    const findings = [
      makeFinding({ type: 'resource-load-failure', url: 'http://x/a.html', evidence: { message: 'same', resourceUrl: 'http://x/one.png', statusCode: 404 } }),
      makeFinding({ type: 'resource-load-failure', url: 'http://x/b.html', evidence: { message: 'same', resourceUrl: 'http://x/one.png', statusCode: 404 } })
    ];
    expect(aggregateFindings(findings)).toEqual([]);
  });

  it('does NOT merge a stack-bearing fault with a stack-less fault sharing its message', () => {
    // R2/R3: a reliable signature and a message-only signature must never be
    // folded into one cluster — the stack-less finding has no source evidence
    // to confirm it shares the stack-bearing root cause.
    const withStack = makeFinding({
      url: 'http://x/a.html',
      evidence: { message: 'Boom: quota exceeded', stack: stackAt('app.js', 'save') }
    });
    const noStack = makeFinding({
      url: 'http://x/b.html',
      evidence: { message: 'Boom: quota exceeded', stack: undefined }
    });
    const clusters = aggregateFindings([withStack, noStack]);
    expect(clusters).toHaveLength(2);
    const qualities = clusters.map((c) => c.signatureQuality).sort();
    expect(qualities).toEqual(['message-only', 'stack+message']);
  });

  it('marks only message-only clusters so consumers can flag them low-confidence', () => {
    const reliable = aggregateFindings([
      makeFinding({ url: 'http://x/a.html', evidence: { message: 'Boom: shared', stack: stackAt('app.js', 'save') } }),
      makeFinding({ url: 'http://x/b.html', evidence: { message: 'Boom: shared', stack: stackAt('app.js', 'save') } })
    ])[0];
    const tentative = aggregateFindings([
      makeFinding({ url: 'http://x/a.html', evidence: { message: 'Legacy failure', stack: undefined } }),
      makeFinding({ url: 'http://x/b.html', evidence: { message: 'Legacy failure', stack: undefined } })
    ])[0];
    // The data layer exposes the difference explicitly; the renderers must not
    // present a message-only cluster as a proven cross-page root cause.
    expect(reliable.signatureQuality).toBe('stack+message');
    expect(tentative.signatureQuality).toBe('message-only');
    // Both keep every member finding complete (traceability, never collapsed).
    expect(reliable.members).toHaveLength(2);
    expect(tentative.members).toHaveLength(2);
    expect(tentative.pages).toEqual(['http://x/a.html', 'http://x/b.html']);
  });

  it('keeps per-member verification detail inside a message-only cluster', () => {
    // Even when grouped only by message, each member's own status/stability/evidence
    // must survive untouched — the cluster is a view, not a replacement.
    const members = [
      makeFinding({ url: 'http://x/a.html', status: 'verified', stability: 'stable', evidence: { message: 'Legacy failure', stack: undefined } }),
      makeFinding({ url: 'http://x/b.html', status: 'suspected', stability: 'unreproducible', evidence: { message: 'Legacy failure', stack: undefined } })
    ];
    const cluster = aggregateFindings(members)[0];
    // Members are ordered by URL (a.html, then b.html); each keeps its own truth.
    expect(cluster.members.map((m) => [m.url, m.status, m.stability])).toEqual([
      ['http://x/a.html', 'verified', 'stable'],
      ['http://x/b.html', 'suspected', 'unreproducible']
    ]);
    expect(cluster.signatureQuality).toBe('message-only');
  });

  it('aggregates severity (highest), stability (worst) and unions artifacts', () => {
    const findings = [
      makeFinding({ url: 'http://x/a.html', severity: 'medium', status: 'suspected', stability: 'unreproducible', evidence: { message: 'Boom: x', stack: stackAt('app.js', 'save') }, screenshots: ['s-a.png'], traces: [] }),
      makeFinding({ url: 'http://x/b.html', severity: 'high', status: 'verified', stability: 'stable', evidence: { message: 'Boom: x', stack: stackAt('app.js', 'save') }, screenshots: ['s-b.png'], traces: ['t-b.zip'] })
    ];
    const clusters = aggregateFindings(findings);
    expect(clusters[0].severity).toBe('high');
    expect(clusters[0].status).toBe('verified');
    expect(clusters[0].stability).toBe('stable');
    expect(clusters[0].screenshots).toEqual(['s-a.png', 's-b.png']);
    expect(clusters[0].traces).toEqual(['t-b.zip']);
  });

  it('inline-script faults with identical messages aggregate across pages (message-only key)', () => {
    // Each page has its OWN inline copy of the same faulty code: the script
    // component equals the page document, so the key degrades to message-only
    // and the identical messages merge into one cluster.
    const findings = [
      makeFinding({ url: 'http://x/shared-error-1.html', evidence: { message: 'Boom: same', stack: stackAt('shared-error-1.html', 'tick') } }),
      makeFinding({ url: 'http://x/shared-error-2.html', evidence: { message: 'Boom: same', stack: stackAt('shared-error-2.html', 'tick') } })
    ];
    const clusters = aggregateFindings(findings);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].pages).toHaveLength(2);
    expect(clusters[0].signatureQuality).toBe('message-only');
  });

  it('produces deterministic ids for identical inputs', () => {
    const build = () =>
      aggregateFindings([
        makeFinding({ url: 'http://x/a.html', evidence: { message: 'Boom: x', stack: stackAt('app.js', 'save') } })
      ])[0].id;
    expect(build()).toBe(build());
    expect(build()).toMatch(/^cl-[0-9a-f]{8}$/);
  });
});

describe('clusterKeyOf', () => {
  it('keeps page URLs out of the key (cross-page by design)', () => {
    const a = clusterKeyOf(makeFinding({ url: 'http://x/a.html', evidence: { message: 'boom', stack: stackAt('app.js', 'f') } }));
    const b = clusterKeyOf(makeFinding({ url: 'http://x/deep/nested/b.html', evidence: { message: 'boom', stack: stackAt('app.js', 'f') } }));
    expect(a.key).toBe(b.key);
  });
});
