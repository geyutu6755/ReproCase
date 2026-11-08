import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type {
  ExplorationLogEntry,
  Finding,
  FindingType,
  PageRecord,
  ReproCaseConfig,
  ScanResult,
  Severity,
  Step
} from './types.js';
import { FindingCollector, type ObservationInput } from './findings.js';
import {
  collectCandidatesInPage,
  measureOverflowInPage,
  OVERFLOW_TOLERANCE_PX,
  UNHANDLED_REJECTION_SCRIPT,
  type CandidateCollection,
  type CandidateInfo
} from './util/selectors.js';
import { firstHttpUrlInText, firstLine, hostnameOf, isLocalhostHost, normalizeUrl, redactSecretsInText, redactUrl, samePort, sha1Short, sleep } from './util/net.js';
import { domainAllowed } from './config.js';
import { verifyFindings } from './verify.js';
import { aggregateFindings } from './aggregate.js';
import { log } from './util/log.js';
import { VERSION } from './version.js';

const MAX_LINK_TARGETS = 200;

/**
 * A single throw surfaces twice in Chromium-land: window.onerror (pageerror)
 * and — when a framework logs it — console.error. Same normalized message on
 * the same page = same event; the js-exception (which carries a stack and a
 * better repro plan) subsumes the console-error copy. Exact message match on
 * the same page only: different messages or pages are never merged here.
 */
function dedupeConsoleDuplicates(findings: Finding[]): Finding[] {
  const normHead = (s: string | undefined): string =>
    (s ?? '')
      .replace(/s+/g, ' ')
      .trim()
      .replace(/^error:s*/i, '')
      .slice(0, 100);
  const jsKeys = new Set(
    findings.filter((f) => f.type === 'js-exception').map((f) => normHead(f.evidence.message) + '|' + f.url)
  );
  return findings.filter(
    (f) => !(f.type === 'console-error' && jsKeys.has(normHead(f.evidence.message) + '|' + f.url))
  );
}
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
    area: 'Cross-origin iframes and closed shadow roots',
    reason: 'Not accessible from the scanning context. Same-origin iframes and OPEN shadow roots are explored and reported; everything else is logged in the exploration log.'
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
  private readonly stats = {
    pagesVisited: 0,
    actionsPerformed: 0,
    requestsObserved: 0,
    linksChecked: 0,
    observationTimeouts: 0
  };
  private truncated: string | undefined;
  private entryUnreachable = false;
  private readonly linkTargets = new Map<string, Set<string>>();
  private readonly exploration: ExplorationLogEntry[] = [];
  private shotSeq = 0;
  private readonly startedAt = Date.now();

  constructor(
    private readonly cfg: ReproCaseConfig,
    private readonly outDir: string
  ) {
    this.collector = new FindingCollector(cfg.report.redactQuery);
  }

  async run(): Promise<ScanRunOutput> {
    try {
      fs.mkdirSync(path.join(this.outDir, 'artifacts', 'screenshots'), { recursive: true });
      fs.mkdirSync(path.join(this.outDir, 'artifacts', 'traces'), { recursive: true });
      fs.mkdirSync(path.join(this.outDir, 'generated-tests'), { recursive: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? 'error';
      throw new Error(
        `Cannot create the output directory "${this.outDir}" (${code}). ` +
          'Choose a writable location via --out <dir>, or fix the folder permissions.'
      );
    }

    let browser: Browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      const msg = firstLine((e as Error).message);
      if (/Executable doesn't exist|playwright install|browserType\.launch/i.test(msg)) {
        throw new Error(
          'Chromium is not installed for Playwright — the most common first-run issue.\n' +
            '  Fix:  npx playwright install chromium\n' +
            '  Then re-run the scan. (npx reprocase doctor verifies the environment.)\n' +
            `  Detail: ${msg}`
        );
      }
      throw e;
    }
    // Ctrl+C: close the browser gracefully and always terminate (no partial report).
    const onInterrupt = (): void => {
      log.info('\n[interrupted] Ctrl+C received — closing the browser (no partial report is written).');
      process.exitCode = 130;
      const hardExit = setTimeout(() => process.exit(130), 2000);
      void browser
        .close()
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(hardExit);
          process.exit(130);
        });
    };
    process.once('SIGINT', onInterrupt);
    try {
      await this.crawl(browser);
      await this.checkLinks();
      const findings = dedupeConsoleDuplicates(this.collector.list());
      await verifyFindings(browser, findings, this.cfg, this.outDir);
      return { result: this.buildResult(findings), findings };
    } finally {
      process.removeListener('SIGINT', onInterrupt);
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
    if (!domainAllowed(hostnameOf(url), this.firstPartyDomains())) return false;
    // Same host but different port (or protocol) = different application.
    return samePort(this.cfg.entry, url);
  }

  private tracesEnabled(): boolean {
    const t = this.cfg.capture.traces;
    if (t === true) return true;
    if (t === false) return false;
    return isLocalhostHost(hostnameOf(this.cfg.entry));
  }

  private logExploration(entry: ExplorationLogEntry): void {
    if (this.exploration.length < 300) this.exploration.push(entry);
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
    // The page the recorded click path belongs to. After a navigation the
    // pending observations belong to the DESTINATION page, so replaying the
    // previous page's clicks there would be invalid (audit finding D5).
    const stepsOriginUrl: { current: string } = { current: normalizeUrl(url) };
    // Counts document loads so exploration can tell real navigations from
    // same-document (pushState/replaceState) SPA transitions.
    const documentLoadsRef = { count: 0 };

    const obs: ObserveFn = async (input) => {
      // Scope guard: a redirect can drag the page out of the scan origin
      // (different port/protocol/host). Observations from outside the scope
      // are suppressed and logged — never reported (audit D1 hardening).
      // about:blank is a transient pre-commit attribution and is allowed:
      // document observations carry the response URL as ground truth.
      if (!this.isFirstParty(input.url) && input.url !== 'about:blank') {
        this.logExploration({
          page: redactUrl(normalizeUrl(input.url), cfg.report.redactQuery),
          description: `suppressed ${input.type} observation from outside the scan scope`,
          outcome: 'skipped-off-scope'
        });
        return;
      }
      // Redact at the source, before anything can reach a finding, a repro
      // plan, a generated test or a report: query strings ride along in page
      // URLs, resource URLs and stack traces alike (audit finding D7).
      const safeInput: Omit<ObservationInput, 'screenshot'> = {
        type: input.type,
        url: redactUrl(normalizeUrl(input.url), cfg.report.redactQuery),
        targetUrl: input.targetUrl
          ? redactUrl(normalizeUrl(input.targetUrl), cfg.report.redactQuery)
          : undefined,
        evidence: {
          ...input.evidence,
          message: input.evidence.message ? redactSecretsInText(input.evidence.message) : undefined,
          stack: input.evidence.stack ? redactSecretsInText(input.evidence.stack) : undefined,
          failureText: input.evidence.failureText
            ? redactSecretsInText(input.evidence.failureText)
            : undefined,
          resourceUrl: input.evidence.resourceUrl
            ? redactUrl(normalizeUrl(input.evidence.resourceUrl), cfg.report.redactQuery)
            : undefined
        },
        // Observations that fired on a page other than the one the recorded
        // clicks belong to must not inherit that click path.
        steps: normalizeUrl(input.url) === stepsOriginUrl.current ? input.steps : []
      };
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
      const { finding } = this.collector.observe({ ...safeInput, screenshot });
      sawFinding = true;
      pageFingerprints.add(finding.fingerprint);
      if (input.type === 'js-exception') record.jsErrors++;
      if (input.type === 'resource-load-failure') record.resourceErrors++;
      if (input.type === 'horizontal-overflow') record.overflow = true;
    };

    const reqCounter = { count: 0 };
    page.on('request', () => {
      reqCounter.count++;
      this.stats.requestsObserved++;
    });
    page.on('dialog', (dialog) => {
      // Read-only-first: never accept dialogs; accepting could confirm destructive actions.
      dialog.dismiss().catch(() => undefined);
    });
    page.on('pageerror', (err) => {
      // Attribute the error to the document it came from: a stack URL that
      // matches a KNOWN FRAME wins (iframe faults otherwise land on the host
      // page); everything else — inline scripts, vendored bundles,
      // pushState routes — belongs to the current page URL. Attributing to
      // the raw script URL would break SPA routes and vendor rethrows.
      const srcUrl = firstHttpUrlInText(err.stack);
      let attributed = page.url();
      if (srcUrl && this.isFirstParty(srcUrl)) {
        const frameMatch = page
          .frames()
          .find((fr) => normalizeUrl(fr.url()) === normalizeUrl(srcUrl));
        if (frameMatch) attributed = frameMatch.url();
      }
      void obs({
        type: 'js-exception',
        url: attributed,
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
      // Scope check by MESSAGE SOURCE: console events fire for all frames,
      // including cross-origin ones whose content must never be reported.
      const loc = (msg.location() && msg.location().url) || '';
      const srcUrl = /^https?:/i.test(loc) ? loc : page.url();
      if (!this.isFirstParty(srcUrl)) {
        this.logExploration({
          page: redactUrl(normalizeUrl(srcUrl), cfg.report.redactQuery),
          description: 'suppressed console error from outside the scan scope: ' + msg.text().slice(0, 80),
          outcome: 'skipped-off-scope'
        });
        return;
      }
      // Attribute to the page where the console event happened — the call
      // site (msg.location) may sit inside a framework bundle, which is not
      // a page. The location is only used for the scope decision above.
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
      if (res.request().resourceType() === 'document') {
        documentLoadsRef.count++;
        const landedUrl = res.url();
        if (!this.isFirstParty(landedUrl)) {
          // A redirect dragged the page outside the scan origin: log it and
          // never report anything from there (SSRF/越界 hardening).
          this.logExploration({
            page: redactUrl(normalizeUrl(landedUrl), cfg.report.redactQuery),
            description: 'out-of-scope document request (redirect or iframe)',
            outcome: 'skipped-off-scope'
          });
          return;
        }
      }
      if (res.status() < 400) return;
      // XHR/fetch responses are application-level business states: REST lookups
      // legitimately return 404/410/etc. and pages handle them (friendly errors,
      // empty states). Reporting them as resource failures produced false
      // positives on real sites (v0.7.0 accuracy fix). Network-level failures on
      // those requests are still captured by the requestfailed listener above.
      const rt = res.request().resourceType();
      if (rt === 'xhr' || rt === 'fetch') return;
      const u = res.url();
      if (FAVICON_RE.test(new URL(u, page.url()).pathname)) return;
      if (!this.isFirstParty(u)) return;
      if (res.request().resourceType() === 'document') {
        void obs({
          type: 'page-load-failure',
          // The response URL is the ground truth for what was loaded —
          // page.url() can still be about:blank at response-event time.
          url: u,
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
      if (resp) {
        record.status = resp.status();
        // Record the URL the browser actually landed on (redirects resolved),
        // not just the URL that was requested.
        record.url = redactUrl(normalizeUrl(resp.url()), cfg.report.redactQuery);
      }
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
        // Link destinations are traversed by the crawl queue (gated here);
        // broken-link checking below happens regardless of this flag.
        if (cfg.allowedActions.clickLinks) enqueue(target, depth + 1);
      }

      // Mobile viewport overflow check — run BEFORE exploration so an
      // exploratory navigation cannot move the measurement to another page.
      const measureOverflowAt = async (viewport: 'desktop' | 'mobile', steps: Step[]): Promise<void> => {
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
            steps
          });
        }
      };
      await measureOverflowAt('mobile', []);
      await page.setViewportSize({ ...cfg.viewports.desktop });
      await page.waitForTimeout(150);

      const docLoadsAtStart = documentLoadsRef.count;
      await this.explorePage(
        page,
        record,
        stepsBox,
        stepsOriginUrl,
        obs,
        deadline,
        depth,
        enqueue,
        documentLoadsRef
      );
      await this.pollRejections(page, stepsBox, stepsOriginUrl, obs);
      await this.exploreFrames(page, record, stepsBox, stepsOriginUrl, obs, deadline);

      // A same-document (SPA) transition may have changed the URL without a
      // document load: open the final URL directly once, as a deep-link check.
      if (
        normalizeUrl(page.url()) !== normalizeUrl(url) &&
        documentLoadsRef.count === docLoadsAtStart &&
        Date.now() <= deadline
      ) {
        enqueue(page.url(), depth + 1);
        log.verbose(`[spa] same-document route queued for deep-link check: ${page.url()}`);
      }

      // If exploration stayed on this page, re-check mobile overflow once —
      // interaction-injected content can overflow at phone widths only. The
      // recorded click path is part of this finding's reproduction plan.
      if (normalizeUrl(page.url()) === normalizeUrl(url) && Date.now() <= deadline) {
        await measureOverflowAt('mobile', [...stepsBox.steps]);
        await page.setViewportSize({ ...cfg.viewports.desktop });
      }

      // Adaptive async-observation window: wait until the page goes quiet
      // (no DOM mutations, no requests, no new errors) for the remainder of
      // detection.windowMs, extending up to detection.maxWaitMs while errors
      // keep appearing. Pages that never go quiet are flagged honestly.
      if (Date.now() <= deadline) {
        const outcome = await this.adaptiveObservationWindow(page, reqCounter);
        if (outcome.timedOut) {
          record.observationTimedOut = true;
          this.stats.observationTimeouts++;
          log.verbose(`[observe] async activity did not settle on ${page.url()} within maxWaitMs`);
        }
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

  /**
   * Safe, read-only-first interaction exploration.
   *
   * Buttons only: <a> destinations are traversed by the crawl queue, and
   * clicking navigational links (header navs!) would abandon the page before
   * its buttons are ever tried — the audit found exactly that systematic
   * false-negative (findings D2/D6).
   *
   * Policy (three tiers): hard-dangerous keywords are forbidden; soft keywords
   * are skipped unless authorized via exploration.allowSelectors; anything
   * matching exploration.denySelectors is excluded. Every considered control
   * is recorded in the exploration log (explored / navigated / skipped /
   * not-covered), so coverage gaps are visible instead of silent.
   *
   * Same-document (pushState/replaceState) transitions continue the loop —
   * the final URL is queued afterwards as a deep-link check instead of
   * abandoning the remaining buttons.
   */
  private async explorePage(
    page: Page,
    record: PageRecord,
    stepsBox: { steps: Step[] },
    stepsOriginUrl: { current: string },
    obs: ObserveFn,
    deadline: number,
    depth: number,
    enqueue: (rawUrl: string, depth: number) => void,
    documentLoadsRef: { count: number }
  ): Promise<void> {
    const cfg = this.cfg;
    if (!cfg.allowedActions.clickButtons) return;
    if (cfg.maxActionsPerPage === 0) return;
    const pageUrl = redactUrl(normalizeUrl(page.url()), cfg.report.redactQuery);

    let collection: CandidateCollection = await page
      .evaluate(collectCandidatesInPage, {
        max: 200,
        allowSelectors: cfg.exploration.allowSelectors,
        denySelectors: cfg.exploration.denySelectors
      })
      .catch((): CandidateCollection => ({ candidates: [], skipped: [] }));

    for (const skip of collection.skipped) {
      this.logExploration({
        page: pageUrl,
        description: skip.description,
        selector: skip.selector,
        outcome:
          skip.reason === 'forbidden'
            ? 'forbidden'
            : skip.reason === 'denied'
              ? 'skipped-denied'
              : 'skipped-risky',
        note:
          skip.reason === 'forbidden'
            ? 'hard-dangerous keyword (never clickable)'
            : skip.reason === 'denied'
              ? 'matched exploration.denySelectors'
              : 'soft risky keyword — authorize via exploration.allowSelectors to enable'
      });
    }

    const overflow = collection.candidates.length - cfg.maxActionsPerPage;
    if (overflow > 0) {
      this.logExploration({
        page: pageUrl,
        description: `${overflow} additional button(s) not covered (maxActionsPerPage=${cfg.maxActionsPerPage})`,
        outcome: 'not-covered'
      });
    }
    const candidates = collection.candidates.slice(0, cfg.maxActionsPerPage);
    const queue: CandidateInfo[] = [...candidates];
    const seenSelectors = new Set(queue.map((c) => c.selector));
    let recollects = 0;

    for (let qi = 0; qi < queue.length; qi++) {
      const cand = queue[qi];
      if (Date.now() > deadline) {
        this.logExploration({
          page: pageUrl,
          description: 'remaining buttons not covered (run deadline)',
          outcome: 'not-covered'
        });
        break;
      }
      const step: Step = {
        action: 'click',
        description:
          cand.strategy === 'css-path' && cand.selector.startsWith('a[')
            ? `click view link "${cand.text || cand.selector}"`
            : `click button "${cand.text || cand.selector}"`,
        selector: cand.selector,
        locatorStrategy: cand.strategy
      };
      const before = normalizeUrl(page.url());
      const beforeRaw = page.url();
      const docLoadsBefore = documentLoadsRef.count;
      stepsBox.steps = [...stepsBox.steps, step];
      try {
        await page.click(cand.selector, { timeout: 3000 });
      } catch {
        // Element vanished or is not clickable; skip it and continue.
        stepsBox.steps = stepsBox.steps.slice(0, -1);
        this.logExploration({
          page: pageUrl,
          description: step.description,
          selector: cand.selector,
          outcome: 'click-failed'
        });
        continue;
      }
      this.stats.actionsPerformed++;
      record.actions++;

      // Event-first waiting: resolve the load state if a navigation happens,
      // then a bounded micro-settle for SPA re-render + the request delay.
      await page.waitForLoadState('load', { timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(Math.min(250 + cfg.requestDelayMs, 1000)).catch(() => undefined);

      const urlChanged = normalizeUrl(page.url()) !== before;
      const docLoaded = documentLoadsRef.count > docLoadsBefore;

      if (urlChanged && docLoaded) {
        // Real navigation to a new document: observations from here belong to
        // the destination (audit finding D5), and the BFS queue takes over.
        stepsOriginUrl.current = normalizeUrl(page.url());
        stepsBox.steps = [];
        enqueue(page.url(), depth + 1);
        this.logExploration({
          page: pageUrl,
          description: step.description,
          selector: cand.selector,
          outcome: 'navigated',
          note: `destination queued: ${redactUrl(normalizeUrl(page.url()), cfg.report.redactQuery)}`
        });
        break;
      }

      if (!urlChanged && page.url() !== beforeRaw) {
        // Hash-only change (hash-router SPA): the view re-rendered in place.
        // The click path KEEPS accumulating — the same page is still being
        // scanned, so reproduction needs the hash navigation recorded (D5
        // logic only applies to real document navigations).
        this.logExploration({
          page: pageUrl,
          description: step.description,
          selector: cand.selector,
          outcome: 'explored',
          note: `same-page hash navigation -> ${redactUrl(page.url(), cfg.report.redactQuery)}`
        });
      } else if (urlChanged && !docLoaded) {
        // Same-document SPA transition (pushState/replaceState): the URL now
        // points at a deep-linkable route; the caller queues it after the loop
        // and the click path resets — the deep link has its own path.
        stepsOriginUrl.current = normalizeUrl(page.url());
        stepsBox.steps = [];
        this.logExploration({
          page: pageUrl,
          description: step.description,
          selector: cand.selector,
          outcome: 'explored',
          note: `same-document navigation (SPA) -> ${redactUrl(normalizeUrl(page.url()), cfg.report.redactQuery)}`
        });
      } else if (!urlChanged) {
        this.logExploration({
          page: pageUrl,
          description: step.description,
          selector: cand.selector,
          outcome: 'explored'
        });
      }

      // Re-collect after EVERY non-navigating click: React/Vue/SPA views swap
      // content in place without changing the URL, so controls that only
      // exist after an interaction must enter the queue. Bounded per page to
      // prevent render/collect loops.
      if (recollects < 5) {
        recollects++;
        const again = await page
          .evaluate(collectCandidatesInPage, {
            max: 200,
            allowSelectors: cfg.exploration.allowSelectors,
            denySelectors: cfg.exploration.denySelectors
          })
          .catch((): CandidateCollection => ({ candidates: [], skipped: [] }));
        for (const c of again.candidates) {
          if (!seenSelectors.has(c.selector)) {
            seenSelectors.add(c.selector);
            queue.push(c);
          }
        }
      }

      if (!urlChanged) {
        await this.pollRejections(page, stepsBox, stepsOriginUrl, obs);

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
      }
    }
  }

  private async pollRejections(
    page: Page,
    stepsBox: { steps: Step[] },
    stepsOriginUrl: { current: string },
    obs: ObserveFn
  ): Promise<void> {
    const rejections = await page
      .evaluate(
        () =>
          (window as unknown as { __reprocaseRejections?: { reason: string; stack: string }[] })
            .__reprocaseRejections?.splice(0) ?? []
      )
      .catch((): { reason: string; stack: string }[] => []);
    const steps = normalizeUrl(page.url()) === stepsOriginUrl.current ? [...stepsBox.steps] : [];
    for (const rej of rejections) {
      await obs({
        type: 'js-exception',
        url: page.url(),
        evidence: { message: rej.reason, stack: rej.stack || undefined },
        steps
      });
    }
  }

  /**
   * Same-origin iframe exploration (v0.3.0): buttons, clicks and per-frame
   * overflow are collected for child frames whose URL is inside the scan
   * origin. Cross-origin frames are logged and skipped — their content is
   * outside the scanning context by design. Bounded: 5 frames × 3 actions.
   */
  private async exploreFrames(
    page: Page,
    record: PageRecord,
    stepsBox: { steps: Step[] },
    stepsOriginUrl: { current: string },
    obs: ObserveFn,
    deadline: number
  ): Promise<void> {
    const cfg = this.cfg;
    if (!cfg.allowedActions.clickButtons || cfg.maxActionsPerPage === 0) return;
    const main = page.mainFrame();
    let framesExplored = 0;

    for (const frame of page.frames()) {
      if (Date.now() > deadline) break;
      if (frame === main || framesExplored >= 5) continue;
      const frameUrl = frame.url();
      if (!frameUrl || !/^https?:/i.test(frameUrl)) continue;
      const frameUrlRed = redactUrl(normalizeUrl(frameUrl), cfg.report.redactQuery);

      if (!this.isFirstParty(frameUrl)) {
        this.logExploration({
          page: frameUrlRed,
          description: 'cross-origin iframe detected',
          outcome: 'skipped-off-scope',
          note: 'iframe content is outside the scan origin — not accessible, not reported'
        });
        continue;
      }
      framesExplored++;
      // Frame clicks are recorded in the shared step path: the fault thrown
      // inside the frame is attributed to the frame URL (via its stack), and
      // reproduction replays the same click after opening that URL directly.
      // Switching origin resets the path — earlier main-page clicks have no
      // meaning on the frame document (same rule as D5).
      stepsOriginUrl.current = normalizeUrl(frameUrl);
      stepsBox.steps = [];

      const collection: CandidateCollection = await frame
        .evaluate(collectCandidatesInPage, {
          max: 3,
          allowSelectors: cfg.exploration.allowSelectors,
          denySelectors: cfg.exploration.denySelectors
        })
        .catch((): CandidateCollection => ({ candidates: [], skipped: [] }));

      for (const cand of collection.candidates.slice(0, 3)) {
        if (Date.now() > deadline) break;
        const description = `click button "${cand.text || cand.selector}" (same-origin iframe)`;
        const step: Step = {
          action: 'click',
          description,
          selector: cand.selector,
          locatorStrategy: cand.strategy
        };
        // Record in the shared step path: the frame fault is attributed to the
        // frame URL (via its stack) and reproduction replays this click there.
        stepsBox.steps = [...stepsBox.steps, step];
        try {
          await frame.click(cand.selector, { timeout: 3000 });
        } catch {
          stepsBox.steps = stepsBox.steps.slice(0, -1);
          this.logExploration({
            page: frameUrlRed,
            description,
            selector: cand.selector,
            outcome: 'click-failed'
          });
          continue;
        }
        this.stats.actionsPerformed++;
        record.actions++;
        this.logExploration({
          page: frameUrlRed,
          description,
          selector: cand.selector,
          outcome: 'explored',
          note: 'inside same-origin iframe'
        });
        await page.waitForTimeout(Math.min(250 + cfg.requestDelayMs, 800)).catch(() => undefined);

        const m = await frame
          .evaluate(measureOverflowInPage, OVERFLOW_TOLERANCE_PX)
          .catch(() => undefined);
        if (m?.overflow) {
          await obs({
            type: 'horizontal-overflow',
            url: frameUrlRed,
            evidence: {
              viewport: 'desktop',
              scrollWidth: m.scrollWidth,
              clientWidth: m.clientWidth,
              offenders: m.offenders,
              selector: 'same-origin iframe content'
            },
            steps: []
          });
        }
      }
    }
  }

  /**
   * Adaptive async-observation window (v0.3.0).
   *
   * Signals combined: in-page DOM mutations (MutationObserver), request
   * activity (node-side counter) and error events. The page counts as
   * observed when it has stayed quiet through `detection.windowMs`; while
   * activity or errors continue, observation extends up to
   * `detection.maxWaitMs` — hard-bounded on both sides, so long-polling or
   * continuously animating pages can never extend a scan indefinitely.
   * `timedOut` marks pages that never went quiet (reported to the user).
   */
  private async adaptiveObservationWindow(
    page: Page,
    reqCounter: { count: number }
  ): Promise<{ timedOut: boolean; elapsedMs: number }> {
    const start = Date.now();
    const windowDeadline = start + this.cfg.detection.windowMs;
    const hardDeadline = start + this.cfg.detection.maxWaitMs;
    const QUIET_MS = 500; // sustained stillness required before "quiet" counts
    let lastMutations = -1;
    let lastRequests = -1;
    let lastErrors = -1;
    let lastChangeAt = start;
    let timedOut = false;

    const snapshot = async (): Promise<{ mutations: number; errors: number }> =>
      page
        .evaluate(() => ({
          mutations:
            (window as unknown as { __reprocaseActivity?: { mutations: number } }).__reprocaseActivity?.mutations ?? 0,
          errors: (window as unknown as { __reprocaseErrorSeen?: boolean }).__reprocaseErrorSeen === true ? 1 : 0
        }))
        .catch(() => ({ mutations: Math.max(lastMutations, 0), errors: Math.max(lastErrors, 0) }));

    for (;;) {
      await sleep(250).catch(() => undefined);
      const now = Date.now();
      const snap = await snapshot();
      const mutations = snap.mutations;
      const requests = reqCounter.count;
      const errors = snap.errors;
      if (
        lastMutations !== mutations ||
        requests !== lastRequests ||
        errors !== lastErrors
      ) {
        lastChangeAt = now;
      }
      lastMutations = mutations;
      lastRequests = requests;
      lastErrors = errors;

      // Quiet must be SUSTAINED (no mutation/request/error change for
      // QUIET_MS): two lucky consecutive samples of a 300 ms polling loop
      // must not read as "quiet" (beat-race guard).
      const sustainedQuiet = now - lastChangeAt >= QUIET_MS;
      if (sustainedQuiet && now >= windowDeadline) break;
      if (now >= hardDeadline) {
        timedOut = true;
        break;
      }
    }
    return { timedOut, elapsedMs: Date.now() - start };
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
      clusters: aggregateFindings(findings),
      pages: this.pages,
      exploration: this.exploration,
      notChecked: NOT_CHECKED,
      truncated: this.truncated,
      entryUnreachable: this.entryUnreachable,
      summary: { verified, suspected: findings.length - verified, bySeverity, byType }
    };
  }
}
