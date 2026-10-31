/**
 * Core data model shared by the scanner, verifiers, reporters and the CLI.
 */

export type FindingType =
  | 'page-load-failure'
  | 'js-exception'
  | 'console-error'
  | 'resource-load-failure'
  | 'broken-internal-link'
  | 'horizontal-overflow';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

/**
 * 'verified'  — the fault was reproduced in independent verification runs.
 * 'suspected' — observed once but not proven reproducible (or informational).
 */
export type FindingStatus = 'verified' | 'suspected';

export type ViewportLabel = 'desktop' | 'mobile';

export interface ViewportSize {
  width: number;
  height: number;
}

/** One recorded interaction step. The initial page navigation is implicit. */
export interface Step {
  action: 'goto' | 'click';
  description: string;
  selector?: string;
  url?: string;
}

export interface OverflowOffender {
  selector: string;
  tag: string;
  /** Distance from viewport left edge to the element's right edge, in px. */
  right: number;
  width: number;
  /** Trimmed outerHTML snippet (privacy: capped length). */
  snippet: string;
}

export interface Evidence {
  message?: string;
  stack?: string;
  statusCode?: number;
  resourceUrl?: string;
  failureText?: string;
  selector?: string;
  viewport?: ViewportLabel;
  scrollWidth?: number;
  clientWidth?: number;
  offenders?: OverflowOffender[];
}

/**
 * Declarative description of how to re-trigger a finding. Used by the
 * verification pass and by the Playwright test generator.
 */
export interface ReproPlan {
  kind:
    | 'goto-status'
    | 'link-status'
    | 'resource-status'
    | 'resource-request-error'
    | 'js-error'
    | 'console-error'
    | 'overflow';
  /** Page to open for the replay. */
  url: string;
  /** Link/resource URL when different from the page. */
  targetUrl?: string;
  statusCode?: number;
  /** Substring of the expected error message. */
  message?: string;
  /** Clicks to replay after opening the page. */
  steps?: Step[];
  viewport?: ViewportLabel;
}

export interface Finding {
  id: string;
  fingerprint: string;
  type: FindingType;
  severity: Severity;
  status: FindingStatus;
  /** 0..1 — successes/attempts for verified findings, lower for suspected. */
  confidence: number;
  title: string;
  /** First page where the finding was observed (redacted per config). */
  url: string;
  /** All pages where this fingerprint was observed. */
  pages: string[];
  evidence: Evidence;
  steps: Step[];
  repro: {
    /** Independent verification attempts. */
    attempts: number;
    /** Attempts that reproduced the fault. */
    successes: number;
    /** Times observed during the crawl (deduped). */
    observedCount: number;
  };
  screenshots: string[];
  traces: string[];
  generatedTest?: string;
  plan: ReproPlan;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface PageRecord {
  url: string;
  depth: number;
  status?: number;
  error?: string;
  actions: number;
  jsErrors: number;
  resourceErrors: number;
  overflow: boolean;
  durationMs: number;
}

export interface ScanStats {
  pagesVisited: number;
  actionsPerformed: number;
  requestsObserved: number;
  linksChecked: number;
  durationMs: number;
  findingsRaw: number;
  findingsAfterDedupe: number;
}

export interface NotCheckedItem {
  area: string;
  reason: string;
}

export interface ScanResult {
  tool: { name: 'ReproCase'; version: string };
  startedAt: string;
  finishedAt: string;
  target: { entry: string; allowedDomains: string[] };
  config: ReproCaseConfig;
  stats: ScanStats;
  findings: Finding[];
  pages: PageRecord[];
  notChecked: NotCheckedItem[];
  /** Set when the crawl stopped early (budget reached). */
  truncated?: string;
  /** True when the entry page itself could not be reached at all. */
  entryUnreachable?: boolean;
  summary: {
    verified: number;
    suspected: number;
    bySeverity: Record<Severity, number>;
    byType: Partial<Record<FindingType, number>>;
  };
}

export interface ReproCaseConfig {
  entry: string;
  allowedDomains: string[];
  maxPages: number;
  maxDepth: number;
  maxActionsPerPage: number;
  navigationTimeoutMs: number;
  runTimeoutMs: number;
  requestDelayMs: number;
  viewports: { desktop: ViewportSize; mobile: ViewportSize };
  allowedActions: {
    clickLinks: boolean;
    clickButtons: boolean;
    fillForms: boolean;
  };
  capture: {
    screenshots: boolean;
    /** 'auto' enables traces only for localhost targets. */
    traces: 'auto' | boolean;
  };
  verification: { attempts: number };
  report: { redactQuery: boolean };
}
