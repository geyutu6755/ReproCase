import type {
  Evidence,
  Finding,
  FindingType,
  ReproPlan,
  Severity,
  Step,
  ViewportLabel
} from './types.js';
import { normalizeUrl, redactUrl, sha1Short, trimStack } from './util/net.js';

export interface ObservationInput {
  type: FindingType;
  /** Page where the observation happened (already-normalized absolute URL). */
  url: string;
  evidence: Evidence;
  steps: Step[];
  screenshot?: string;
  /** Link/resource target when different from the page (broken links, resources, direct 404s). */
  targetUrl?: string;
}

const SEVERITY_BY_TYPE: Record<FindingType, Severity> = {
  'page-load-failure': 'high',
  'js-exception': 'high',
  'console-error': 'low',
  'resource-load-failure': 'medium',
  'broken-internal-link': 'medium',
  'horizontal-overflow': 'low'
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function norm(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function fingerprintOf(obs: ObservationInput, redactQuery: boolean): string {
  const pageUrl = redactUrl(normalizeUrl(obs.url), redactQuery);
  const e = obs.evidence;
  switch (obs.type) {
    case 'js-exception':
      return ['js-exception', pageUrl, norm(e.message)].join('|');
    case 'console-error':
      return ['console-error', pageUrl, norm(e.message)].join('|');
    case 'page-load-failure':
      return ['page-load-failure', normalizeUrl(obs.targetUrl ?? obs.url), String(e.statusCode ?? norm(e.failureText))].join('|');
    case 'resource-load-failure':
      return ['resource-load-failure', normalizeUrl(e.resourceUrl ?? ''), String(e.statusCode ?? norm(e.failureText))].join('|');
    case 'broken-internal-link':
      return ['broken-internal-link', normalizeUrl(obs.targetUrl ?? '')].join('|');
    case 'horizontal-overflow':
      return ['horizontal-overflow', pageUrl, e.viewport ?? 'desktop'].join('|');
  }
}

export function titleFor(obs: ObservationInput): string {
  const e = obs.evidence;
  switch (obs.type) {
    case 'js-exception':
      return `Uncaught JS exception: ${norm(e.message).slice(0, 120) || '(unknown error)'}`;
    case 'console-error':
      return `Console error: ${norm(e.message).slice(0, 120) || '(unknown message)'}`;
    case 'page-load-failure':
      return e.statusCode
        ? `Page failed to load with HTTP ${e.statusCode}`
        : `Page failed to load (network error: ${norm(e.failureText).slice(0, 80) || 'unknown'})`;
    case 'resource-load-failure':
      return e.statusCode
        ? `First-party resource failed to load: ${norm(e.resourceUrl).slice(0, 100)} (HTTP ${e.statusCode})`
        : `First-party resource failed to load: ${norm(e.resourceUrl).slice(0, 100)} (${norm(e.failureText).slice(0, 60) || 'network error'})`;
    case 'broken-internal-link':
      return `Broken internal link -> ${norm(obs.targetUrl).slice(0, 120)}`;
    case 'horizontal-overflow':
      return `Horizontal overflow on ${e.viewport ?? 'desktop'} viewport`;
  }
}

function planFor(obs: ObservationInput): ReproPlan {
  const e = obs.evidence;
  switch (obs.type) {
    case 'js-exception':
      return { kind: 'js-error', url: obs.url, message: norm(e.message), steps: obs.steps };
    case 'console-error':
      return { kind: 'console-error', url: obs.url, message: norm(e.message), steps: obs.steps };
    case 'page-load-failure':
      return {
        kind: 'goto-status',
        url: normalizeUrl(obs.targetUrl ?? obs.url),
        statusCode: e.statusCode,
        message: norm(e.failureText) || undefined
      };
    case 'resource-load-failure':
      return e.statusCode
        ? { kind: 'resource-status', url: obs.url, targetUrl: normalizeUrl(e.resourceUrl ?? ''), statusCode: e.statusCode }
        : { kind: 'resource-request-error', url: obs.url, targetUrl: normalizeUrl(e.resourceUrl ?? '') };
    case 'broken-internal-link':
      return { kind: 'link-status', url: obs.url, targetUrl: normalizeUrl(obs.targetUrl ?? ''), statusCode: e.statusCode };
    case 'horizontal-overflow':
      return { kind: 'overflow', url: obs.url, viewport: (e.viewport ?? 'desktop') as ViewportLabel };
  }
}

function cleanEvidence(e: Evidence, redactQuery: boolean): Evidence {
  const out: Evidence = {};
  if (e.message) out.message = norm(e.message);
  if (e.stack) out.stack = trimStack(e.stack);
  if (e.statusCode !== undefined) out.statusCode = e.statusCode;
  if (e.resourceUrl) out.resourceUrl = redactUrl(normalizeUrl(e.resourceUrl), redactQuery);
  if (e.failureText) out.failureText = norm(e.failureText);
  if (e.selector) out.selector = e.selector;
  if (e.viewport) out.viewport = e.viewport;
  if (e.scrollWidth !== undefined) out.scrollWidth = e.scrollWidth;
  if (e.clientWidth !== undefined) out.clientWidth = e.clientWidth;
  if (e.offenders) out.offenders = e.offenders.slice(0, 8);
  return out;
}

const MAX_FINDINGS = 500;

/**
 * Collects raw observations and merges them into deduplicated findings.
 * Two observations belong to the same finding when their fingerprint
 * (type + URL + normalized error signature) matches.
 */
export class FindingCollector {
  private readonly byFingerprint = new Map<string, Finding>();
  rawCount = 0;

  constructor(
    private readonly redactQuery: boolean,
    private readonly maxSteps = 25
  ) {}

  observe(obs: ObservationInput): { finding: Finding; created: boolean } {
    this.rawCount++;
    if (this.byFingerprint.size >= MAX_FINDINGS && !this.byFingerprint.has(fingerprintOf(obs, this.redactQuery))) {
      // Hard cap to keep runs bounded on pathological sites.
      const overflowGuard = this.byFingerprint.values().next().value as Finding | undefined;
      if (overflowGuard) return { finding: overflowGuard, created: false };
    }
    const fp = fingerprintOf(obs, this.redactQuery);
    const existing = this.byFingerprint.get(fp);
    const now = new Date().toISOString();

    if (existing) {
      existing.repro.observedCount++;
      existing.lastSeenAt = now;
      const pageUrl = redactUrl(normalizeUrl(obs.url), this.redactQuery);
      if (pageUrl && !existing.pages.includes(pageUrl)) existing.pages.push(pageUrl);
      if (obs.screenshot && !existing.screenshots.includes(obs.screenshot)) {
        existing.screenshots.push(obs.screenshot);
      }
      if (obs.steps.length > existing.steps.length) existing.steps = obs.steps.slice(0, this.maxSteps);
      return { finding: existing, created: false };
    }

    const finding: Finding = {
      id: 'fp-' + sha1Short(fp),
      fingerprint: fp,
      type: obs.type,
      severity: SEVERITY_BY_TYPE[obs.type],
      // Every finding starts as suspected; only the independent verification
      // pass may promote it to verified.
      status: 'suspected',
      confidence: obs.type === 'console-error' ? 0.3 : 0.5,
      title: titleFor(obs),
      url: redactUrl(normalizeUrl(obs.url), this.redactQuery),
      pages: [redactUrl(normalizeUrl(obs.url), this.redactQuery)],
      evidence: cleanEvidence(obs.evidence, this.redactQuery),
      steps: obs.steps.slice(0, this.maxSteps),
      repro: { attempts: 0, successes: 0, observedCount: 1 },
      screenshots: obs.screenshot ? [obs.screenshot] : [],
      traces: [],
      plan: planFor(obs),
      firstSeenAt: now,
      lastSeenAt: now
    };
    this.byFingerprint.set(fp, finding);
    return { finding, created: true };
  }

  attachTrace(fingerprints: Iterable<string>, tracePath: string): void {
    for (const fp of fingerprints) {
      const finding = this.byFingerprint.get(fp);
      if (finding && !finding.traces.includes(tracePath)) finding.traces.push(tracePath);
    }
  }

  list(): Finding[] {
    return [...this.byFingerprint.values()].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'verified' ? -1 : 1;
      const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (rank !== 0) return rank;
      return a.type.localeCompare(b.type) || a.title.localeCompare(b.title);
    });
  }
}
