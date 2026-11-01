import type { Finding, FindingStability, FindingType, Severity } from './types.js';
import { sha1Short } from './util/net.js';

/**
 * Cross-page fault aggregation.
 *
 * Resource, broken-link and page-load findings already aggregate across pages
 * by fingerprint (their identity is the target URL, not the page). Uncaught
 * exceptions and console errors, however, are identified per page — the same
 * root cause reached through five routes currently produces five findings.
 *
 * Aggregation is a VIEW on top of the raw findings: `findings` stays complete
 * and machine-readable (traceability), `clusters` groups what shares a root
 * cause. Clustering is conservative by construction — the key combines the
 * error category, the normalized top stack frame (script + function) and the
 * message head, so similar texts from different components are NOT merged.
 * Findings without a stack fall back to a message-only key, marked as such.
 */
export interface FaultCluster {
  id: string;
  key: string;
  type: FindingType;
  title: string;
  severity: Severity;
  /** Aggregated: verified when any member reproduced independently. */
  status: 'verified' | 'suspected';
  /** Worst-case member stability (unreproducible dominates). */
  stability?: FindingStability;
  /** Original per-page findings, ordered by page URL (traceability). */
  members: Finding[];
  pages: string[];
  repro: {
    /** Sum of member successes — how many member pages reproduce. */
    successes: number;
    /** Sum of member attempts. */
    attempts: number;
    observedCount: number;
  };
  screenshots: string[];
  traces: string[];
  generatedTests: string[];
  /** 'stack+message' = location-aware key; 'message-only' = no stack available. */
  signatureQuality: 'stack+message' | 'message-only';
}

const STACK_FRAME_RE = /^\s*at\s+(.+?)\s+\((.+?)\)\s*$|^\s*at\s+(\S+)\s*$/;

function messageHead(message: string | undefined, len = 100): string {
  return (message ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, len);
}

/**
 * Normalized top stack frame: "script basename (function)" with directories,
 * ports, query strings and line/column stripped. Two pages hitting the same
 * component produce the same frame; framework-internal frames resolve to the
 * vendored bundle name.
 */
export function topFrameOf(stack: string | undefined): { script: string; fn: string } | null {
  if (!stack) return null;
  for (const line of stack.split('\n')) {
    const m = STACK_FRAME_RE.exec(line);
    if (!m) continue;
    const rawFn = m[1];
    const rawLoc = m[2] ?? m[3];
    if (!rawLoc) continue;
    let script = '(inline)';
    let fn = '(anonymous)';
    try {
      const url = new URL(rawLoc.replace(/:\d+:\d+$/, ''));
      const base = url.pathname.split('/').filter(Boolean).pop();
      script = base || '(inline)';
    } catch {
      // Non-URL location (e.g. "Function.foo"); use its tail.
      const tail = rawLoc.split('/').pop() ?? rawLoc;
      script = tail.split(':').slice(0, 1).join(':') || '(inline)';
    }
    if (rawFn) fn = rawFn.replace(/\s+/g, ' ').trim();
    return { script, fn };
  }
  return null;
}

/**
 * Conservative cross-page cluster key for exceptions/console errors:
 * type + normalized top frame + message head. The top frame only carries
 * cross-page signal when it names a SHARED script — an inline frame whose
 * script equals the page's own document is per-page by definition and drops
 * to a message-only key (marked honestly in the cluster).
 */
export function clusterKeyOf(f: Finding): { key: string; quality: 'stack+message' | 'message-only' } {
  const frame = topFrameOf(f.evidence.stack);
  const head = messageHead(f.evidence.message);
  if (frame) {
    const pageBase = basenameOf(f.url);
    const scriptIsThePageItself = frame.script === pageBase || frame.script === '(inline)';
    if (!scriptIsThePageItself) {
      return { key: [f.type, frame.script, frame.fn, head].join('|'), quality: 'stack+message' };
    }
  }
  return { key: [f.type, '(message)', head].join('|'), quality: 'message-only' };
}

function basenameOf(u: string): string {
  try {
    const segments = new URL(u).pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? '(root)';
  } catch {
    return '(root)';
  }
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STABILITY_RANK: Record<NonNullable<FindingStability>, number> = {
  stable: 0,
  intermittent: 1,
  unreproducible: 2
};

/** Aggregates per-page exception/console findings into root-cause clusters. */
export function aggregateFindings(findings: Finding[]): FaultCluster[] {
  const byKey = new Map<string, Finding[]>();
  const qualities = new Map<string, 'stack+message' | 'message-only'>();

  for (const f of findings) {
    if (f.type !== 'js-exception' && f.type !== 'console-error') continue;
    const { key, quality } = clusterKeyOf(f);
    const list = byKey.get(key) ?? [];
    list.push(f);
    byKey.set(key, list);
    // A single stack-bearing member upgrades the whole cluster's key quality.
    if (quality === 'stack+message' || !qualities.has(key)) qualities.set(key, quality);
  }

  const clusters: FaultCluster[] = [];
  for (const [key, members] of byKey) {
    const sorted = [...members].sort((a, b) => a.url.localeCompare(b.url) || a.title.localeCompare(b.title));
    const pages = [...new Set(sorted.map((m) => m.url))];
    const severity = sorted.reduce<Severity>(
      (acc, m) => (SEVERITY_RANK[m.severity] < SEVERITY_RANK[acc] ? m.severity : acc),
      'low'
    );
    const status: 'verified' | 'suspected' = sorted.some((m) => m.status === 'verified')
      ? 'verified'
      : 'suspected';
    const stabilities = sorted.map((m) => m.stability).filter(Boolean) as NonNullable<FindingStability>[];
    const stability =
      stabilities.length > 0
        ? (['stable', 'intermittent', 'unreproducible'] as const).find((s) =>
            stabilities.includes(s)
          ) ?? undefined
        : undefined;
    const screenshots = [...new Set(sorted.flatMap((m) => m.screenshots))];
    const traces = [...new Set(sorted.flatMap((m) => m.traces))];
    const generatedTests = [...new Set(sorted.flatMap((m) => (m.generatedTest ? [m.generatedTest] : [])))];

    clusters.push({
      id: 'cl-' + sha1Short(key),
      key,
      type: sorted[0].type,
      title: sorted[0].title,
      severity,
      status,
      stability,
      members: sorted,
      pages,
      repro: {
        successes: sorted.reduce((sum, m) => sum + m.repro.successes, 0),
        attempts: sorted.reduce((sum, m) => sum + m.repro.attempts, 0),
        observedCount: sorted.reduce((sum, m) => sum + m.repro.observedCount, 0)
      },
      screenshots,
      traces,
      generatedTests,
      signatureQuality: qualities.get(key) ?? 'message-only'
    });
  }

  return clusters.sort(
    (a, b) =>
      (a.status === b.status ? 0 : a.status === 'verified' ? -1 : 1) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.pages.length - b.pages.length ||
      a.title.localeCompare(b.title)
  );
}
