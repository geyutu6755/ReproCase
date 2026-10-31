import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { Finding, FindingType, PageRecord, ReproCaseConfig, ScanResult, Severity, Step } from './types.js';
import { FindingCollector, type ObservationInput } from './findings.js';
import {
  collectCandidatesInPage,
  measureOverflowInPage,
  OVERFLOW_TOLERANCE_PX,
  UNHANDLED_REJECTION_SCRIPT,
  type CandidateInfo
} from './util/selectors.js';
import { firstLine, hostnameOf, isLocalhostHost, normalizeUrl, redactUrl, sha1Short, sleep } from './util/net.js';
import { domainAllowed } from './config.js';
import { verifyFindings } from './verify.js';
import { log } from './util/log.js';
import { VERSION } from './version.js';

const MAX_LINK_TARGETS = 200;
const MAX_LINK_CHECKS = 150;
const MAX_SOURCES_PER_TARGET = 5;

/** Favicon 404s are browser chrome noise, not application faults. */
const FAVICON_RE = /\/favicon(\.[a-z0-9]+)?(\?.*)?$/i;

const NOT_CHECKED = [
  {
    area: 'Forms and form submission',
    reason: 'Read-only-first exploration never types into or submits forms, so form flows are not exercised.'
  },
  {
    area: 'Authenticated / session-specific pages',
    reason: 'ReproCase explores without credentials; pages behind logins are out of reach.'
  },
  {
    area: 'Third-party resource failures',
    reason: 'Observed but not reported: failures on hosts outside the allowed domains are excluded on purpose.'
  },
  {
    area: 'Visual layout beyond horizontal overflow',
    reason: 'No pixel comparison or visual regression testing is performed.'
  },
  {
    area: 'Accessibility',
    reason: 'Not audited in this version.'
  },
  {
    area: 'Performance',
    reason: 'No timing budgets are evaluated.'
  },
  {
    area: 'Backend / business logic correctness',
    reason: 'Only client-observable behaviour is judged. ReproCase never decides whether business outcomes are correct.'
  }
];

export interface ScanRunOutput {
  result: ScanResult;
  findings: Finding[];
}

type ObserveFn = (input: Omit<ObservationInput, 'screenshot'>) => Promise<void>;

/**
 * Orchestrates one full scan: crawl -> detect -> deduplicate -> verify.
 */
export class Scanner {
  private readonly collector: FindingCollector;
  private readonly pages: PageRecord[] = [];
  private readonly stats = { pagesVisited: 0, actionsPerformed: 0, requestsObserved: 0, linksChecked: 0 };
  private truncated: string | undefined;
  private entryUnreachable = false;
  private readonly linkTargets = new Map<string, Set<string>>();
  private shotSeq = 0;
  private readonly startedAt = Date.now();

  constructor(
    private readonly cfg: ReproCaseConfig,
    private readonly outDir: string
  ) {
    this.collector = new FindingCollector(cfg.report.redactQuery);
  }

  async run(): Promise<ScanRunOutput> {
    fs.mkdirSync(path.join(this.outDir, 'artifacts', 'screenshots'), { recursive: true });
    fs.mkdirSync(path.join(this.outDir, 'artifacts', 'traces'), { recursive: true });
    fs.mkdirSync(path.join(this.outDir, 'generated-tests'), { recursive: true });

    const browser = await chromium.launch({ headless: true });
    try {
      await this.crawl(browser);
      await this.checkLinks();
      const findings = this.collector.list();
      await verifyFindings(browser, findings, this.cfg, this.outDir);
      return { result: this.buildResult(findings), findings };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  private firstPartyDomains(): string[] {
    const hosts = new Set(this.cfg.allowedDomains);
    const entryHost = hostnameOf(this.cfg.entry);
    if (entryHost) hosts.add(entryHost);
    return [...hosts];
  }

  private isFirstParty(url: string): boolean {
    return domainAllowed(hostnameOf(url), this.firstPartyDomains());
  }

  private tracesEnabled(): boolean {
    const t = this.cfg.capture.traces;
    if (t === true) return true;
    if (t === false) return false;
    return isLocalhostHost(hostnameOf(this.cfg.entry));
  }

  private async crawl(browser: Browser): Promise<void> {
    const cfg = this.cfg;
    const deadline = this.startedAt + cfg.runTimeoutMs;
    const queue: { url: string; depth: number }[] = [{ url: normalizeUrl(cfg.entry), depth: 0 }];
    const visited = new Set<string>();

    const enqueue = (rawUrl: string, depth: number): void => {
      const url = normalizeUrl(rawUrl);
      if (!/^https?:/i.test(url)) return;
      if (!this.isFirstParty(url)) return;
      if (visited.has(url) || depth > cfg.maxDepth) return;
      if (queue.length >= cfg.maxPages * 4) return;
      queue.push({ url, depth });
    };

    while (queue.length > 0) {
      if (this.stats.pagesVisited >= cfg.maxPages) {
        this.truncated = `page budget reached (maxPages=${cfg.maxPages})`;
        break;
      }
      if (Date.now() > deadline) {
        this.truncated = `time budget reached (runTimeoutMs=${cfg.runTimeoutMs})`;
        break;
      }
      const next = queue.shift()!;
      if (visited.has(next.url)) continue;
      visited.add(next.url);
      this.stats.pagesVisited++;
      log.info(`[scan] page ${this.stats.pagesVisited}/${cfg.maxPages}: ${next.url}`);
      this.pages.push(await this.scanPage(browser, next.url, next.depth, deadline, enqueue));
      await sleep(cfg.requestDelayMs);
    }
    if (!this.truncated && queue.length > 0) {
      this.truncated = `crawl stopped with ${queue.length} queued pages left (budget)`;
    }
  }

  private async scanPage(
    browser: Browser,
    url: string,
    depth: number,
    deadline: number,
    enqueue: (rawUrl: string, depth: number) => void
  ): Promise<PageRecord> {
    const cfg = this.cfg;
    const outDir = this.outDir;
    const t0 = Date.now();
    const record: PageRecord = {
      url: redactUrl(url, cfg.report.redactQuery),
      depth,
      actions: 0,
      jsErrors: 0,
      resourceErrors: 0,
      overflow: false,
      durationMs: 0
    };

    const context = await browser.newContext({ viewport: { ...cfg.viewports.desktop } });
    const withTraces = this.tracesEnabled();
    if (withTraces) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false }).catch(() => undefined);
    }

    const page = await context.newPage();
    await page.addInitScript(UNHANDLED_REJECTION_SCRIPT);

    const pageFingerprints = new Set<string>();
    let sawFinding = false;
    const stepsBox: { steps: Step[] } = { steps: [] };

    const obs: ObserveFn = async (input) => {
      let screenshot: string | undefined;
      if (cfg.capture.screenshots) {
        try {
          const name = `page-${String(this.shotSeq++).padStart(3, '0')}.png`;
          await page.screenshot({
            path: path.join(outDir, 'artifacts', 'screenshots', name),
            fullPage: false,
            timeout: 3000
          });
          screenshot = `artifacts/screenshots/${name}`;
        } catch {
          // Page may be mid-navigation or already closing; evidence is best-effort here.
        }
      }
      const { finding } = this.collector.observe({ ...input, screenshot });
      sawFinding = true;
      pageFingerprints.add(finding.fingerprint);
      if (input.type === 'js-exception') record.jsErrors++;
      if (input.type === 'resource-load-failure') record.resourceErrors++;
      if (input.type === 'horizontal-overflow') record.overflow = true;
    };

    page.on('request', () => {
      this.stats.requestsObserved++;
    });
    page.on('dialog', (dialog) => {
      // Read-only-first: never accept dialogs; accepting could confirm destructive actions.
      dialog.dismiss().catch(() => undefined);
    });
    page.on('pageerror', (err) => {
      void obs({
        type: 'js-exception',
        url: page.url(),
        evidence: { message: err.message, stack: err.stack },
        steps: [...stepsBox.steps]
      });
    });
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      // Chromium logs "Failed to load resource: ..." for every failed network
      // response; those root causes are already reported by the resource and
      // page-load detectors, so the console copy is skipped as noise.
      if (/^Failed to load resource/i.test(msg.text())) return;
      void obs({
        type: 'console-error',
        url: page.url(),
        evidence: { message: msg.text() },
        steps: [...stepsBox.steps]
      });
    });
    page.on('requestfailed', (req) => {
      if (req.resourceType() === 'document') return;
      const u = req.url();
      if (FAVICON_RE.test(new URL(u, page.url()).pathname)) return;
      if (!this.isFirstParty(u)) return;
      void obs({
        type: 'resource-load-failure',
        url: page.url(),
        evidence: { resourceUrl: u, failureText: req.failure()?.errorText ?? 'request failed' },
        steps: [...stepsBox.steps]
      });
    });
    page.on('response', (res) => {
      if (res.status() < 400) return;
      const u = res.url();
      if (FAVICON_RE.test(new URL(u, page.url()).pathname)) return;
      if (!this.isFirstParty(u)) return;
      if (res.request().resourceType() === 'document') {
        void obs({
          type: 'page-load-failure',
          url: page.url(),
          targetUrl: u,
          evidence: { statusCode: res.status() },
          steps: [...stepsBox.steps]
        });
      } else {
        void obs({
          type: 'resource-load-failure',
          url: page.url(),
          evidence: { resourceUrl: u, statusCode: res.status() },
          steps: [...stepsBox.steps]
        });
      }
    });

    let loaded = false;
    try {
      const resp = await page.goto(url, { waitUntil: 'load', timeout: cfg.navigationTimeoutMs });
      if (resp) record.status = resp.status();
      loaded = true;
    } catch (e) {
      const msg = firstLine((e as Error)?.message ?? String(e));
      record.error = msg;
      if (depth === 0) this.entryUnreachable = true;
      await obs({ type: 'page-load-failure', url, evidence: { failureText: msg }, steps: [] });
    }

    if (loaded) {
      const desktopOverflow = await page
        .evaluate(measureOverflowInPage, OVERFLOW_TOLERANCE_PX)
        .catch(() => undefined);
      if (desktopOverflow?.overflow) {
        await obs({
          type: 'horizontal-overflow',
          url: page.url(),
          evidence: {
            viewport: 'desktop',
            scrollWidth: desktopOverflow.scrollWidth,
            clientWidth: desktopOverflow.clientWidth,
            offenders: desktopOverflow.offenders
          },
          steps: []
        });
      }

      // Collect internal links for the crawl queue and for link checking
      // BEFORE exploring: an exploratory click may navigate away, and the
      // hub page's remaining links must still enter the queue.
      const hrefs = await page
        .$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href))
        .catch((): string[] => []);
      for (const href of hrefs) {
        let u: URL;
        try {
          u = new URL(href);
        } catch {
          continue;
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
        if (!this.isFirstParty(u.href)) continue;
        const target = normalizeUrl(u.href);
        let sources = this.linkTargets.get(target);
        if (!sources) {
          if (this.linkTargets.size >= MAX_LINK_TARGETS) continue;
          sources = new Set<string>();
          this.linkTargets.set(target, sources);
        }
        if (sources.size < MAX_SOURCES_PER_TARGET) {
          sources.add(redactUrl(normalizeUrl(page.url()), cfg.report.redactQuery));
        }
        enqueue(target, depth + 1);
      }

      // Mobile viewport overflow check — run BEFORE exploration so an
      // exploratory navigation cannot move the measurement to another page.
      const measureOverflowAt = async (viewport: 'desktop' | 'mobile'): Promise<void> => {
        await page.setViewportSize(
          viewport === 'mobile' ? { ...cfg.viewports.mobile } : { ...cfg.viewports.desktop }
        );
        await page.waitForTimeout(250);
        const m = await page.evaluate(measureOverflowInPage, OVERFLOW_TOLERANCE_PX).catch(() => undefined);
        if (m?.overflow) {
          await obs({
            type: 'horizontal-overflow',
            url: page.url(),
            evidence: {
              viewport,
              scrollWidth: m.scrollWidth,
              clientWidth: m.clientWidth,
              offenders: m.offenders
            },
            steps: []
          });
        }
      };
      await measureOverflowAt('mobile');
      await page.setViewportSize({ ...cfg.viewports.desktop });
      await page.waitForTimeout(150);

      await this.explorePage(page, record, stepsBox, obs, deadline, depth, enqueue);
      await this.pollRejections(page, stepsBox.steps, obs);

      // If exploration stayed on this page, re-check mobile overflow once —
      // interaction-injected content can overflow at phone widths only.
      if (normalizeUrl(page.url()) === normalizeUrl(url) && Date.now() <= deadline) {
        await measureOverflowAt('mobile');
        await page.setViewportSize({ ...cfg.viewports.desktop });
      }
    }

    if (withTraces) {
      if (sawFinding) {
        const traceRel = `artifacts/traces/trace-${sha1Short(normalizeUrl(url))}.zip`;
        try {
          await context.tracing.stop({ path: path.join(outDir, traceRel) });
          this.collector.attachTrace(pageFingerprints, traceRel);
        } catch {
          await context.tracing.stop().catch(() => undefined);
        }
      } else {
        await context.tracing.stop().catch(() => undefined);
      }
    }

    await context.close().catch(() => undefined);
    record.durationMs = Date.now() - t0;
    return record;
  }

  /** Safe, read-only-first interaction exploration. */
  private async explorePage(
    page: Page,
    record: PageRecord,
    stepsBox: { steps: Step[] },
    obs: ObserveFn,
    deadline: number,
    depth: number,
    enqueue: (rawUrl: string, depth: number) => void
  ): Promise<void> {
    const cfg = this.cfg;
    if (!cfg.allowedActions.clickLinks && !cfg.allowedActions.clickButtons) return;
    if (cfg.maxActionsPerPage === 0) return;

    let candidates: CandidateInfo[] = await page
      .evaluate(collectCandidatesInPage, 200)
      .catch((): CandidateInfo[] => []);
    candidates = candidates
      .filter((c) => (c.kind === 'link' ? cfg.allowedActions.clickLinks : cfg.allowedActions.clickButtons))
      .slice(0, cfg.maxActionsPerPage);

    for (const cand of candidates) {
      if (Date.now() > deadline) break;
      const step: Step =
        cand.kind === 'link'
          ? {
              action: 'click',
              description: `click link "${cand.text || cand.href}"`,
              selector: cand.selector,
              url: cand.href
            }
          : {
              action: 'click',
              description: `click button "${cand.text || cand.selector}"`,
              selector: cand.selector
            };
      const before = normalizeUrl(page.url());
      stepsBox.steps = [...stepsBox.steps, step];
      try {
        await page.click(cand.selector, { timeout: 3000 });
      } catch {
        // Element vanished or is not clickable; skip it and continue.
        stepsBox.steps = stepsBox.steps.slice(0, -1);
        continue;
      }
      this.stats.actionsPerformed++;
      record.actions++;

      await page.waitForTimeout(400 + cfg.requestDelayMs).catch(() => undefined);
      await page.waitForLoadState('load', { timeout: 5000 }).catch(() => undefined);
      await this.pollRejections(page, stepsBox.steps, obs);

      const m = await page.evaluate(measureOverflowInPage, OVERFLOW_TOLERANCE_PX).catch(() => undefined);
      if (m?.overflow) {
        await obs({
          type: 'horizontal-overflow',
          url: page.url(),
          evidence: {
            viewport: 'desktop',
            scrollWidth: m.scrollWidth,
            clientWidth: m.clientWidth,
            offenders: m.offenders
          },
          steps: [...stepsBox.steps]
        });
      }

      if (normalizeUrl(page.url()) !== before) {
        // Navigational click: let the BFS queue handle the destination page.
        enqueue(page.url(), depth + 1);
        break;
      }
    }
  }

  private async pollRejections(page: Page, steps: Step[], obs: ObserveFn): Promise<void> {
    const rejections = await page
      .evaluate(
        () =>
          (window as unknown as { __reprocaseRejections?: { reason: string; stack: string }[] })
            .__reprocaseRejections?.splice(0) ?? []
      )
      .catch((): { reason: string; stack: string }[] => []);
    for (const rej of rejections) {
      await obs({
        type: 'js-exception',
        url: page.url(),
        evidence: { message: rej.reason, stack: rej.stack || undefined },
        steps: [...steps]
      });
    }
  }

  /** HTTP status check of every discovered internal link, via plain fetch. */
  private async checkLinks(): Promise<void> {
    for (const [target, sources] of this.linkTargets) {
      if (this.stats.linksChecked >= MAX_LINK_CHECKS) {
        this.truncated ??= `link check budget reached (${MAX_LINK_CHECKS} links)`;
        break;
      }
      this.stats.linksChecked++;
      let statusCode: number | undefined;
      let failureText: string | undefined;
      try {
        const res = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        statusCode = res.status;
        await res.body?.cancel().catch(() => undefined);
      } catch (e) {
        failureText = firstLine((e as Error)?.message ?? String(e));
      }
      const broken = statusCode !== undefined ? statusCode >= 400 : true;
      if (broken) {
        for (const source of sources) {
          this.collector.observe({
            type: 'broken-internal-link',
            url: source,
            targetUrl: target,
            evidence: { statusCode, resourceUrl: target, failureText },
            steps: []
          });
        }
      }
      await sleep(Math.min(this.cfg.requestDelayMs, 50));
    }
  }

  private buildResult(findings: Finding[]): ScanResult {
    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const byType: Partial<Record<FindingType, number>> = {};
    for (const f of findings) {
      bySeverity[f.severity]++;
      byType[f.type] = (byType[f.type] ?? 0) + 1;
    }
    const verified = findings.filter((f) => f.status === 'verified').length;
    return {
      tool: { name: 'ReproCase', version: VERSION },
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      target: {
        entry: redactUrl(normalizeUrl(this.cfg.entry), this.cfg.report.redactQuery),
        allowedDomains: this.cfg.allowedDomains
      },
      config: this.cfg,
      stats: {
        ...this.stats,
        durationMs: Date.now() - this.startedAt,
        findingsRaw: this.collector.rawCount,
        findingsAfterDedupe: findings.length
      },
      findings,
      pages: this.pages,
      notChecked: NOT_CHECKED,
      truncated: this.truncated,
      entryUnreachable: this.entryUnreachable,
      summary: { verified, suspected: findings.length - verified, bySeverity, byType }
    };
  }
}
