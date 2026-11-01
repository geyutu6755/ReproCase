/**
 * Functions in this file are serialized by Playwright and executed INSIDE the
 * browser page. They must be fully self-contained: no imports, no closures
 * over module-level variables. Helper functions are therefore duplicated in
 * each exported function on purpose.
 */

export const OVERFLOW_TOLERANCE_PX = 2;

export interface OffenderInfo {
  selector: string;
  tag: string;
  right: number;
  width: number;
  snippet: string;
}

export interface OverflowMeasurement {
  clientWidth: number;
  scrollWidth: number;
  overflow: boolean;
  offenders: OffenderInfo[];
}

/**
 * Overflow measurement for the main document INCLUDING open shadow roots:
 * document-level querySelectorAll cannot see shadow content, so elements are
 * collected through shadowRoot links (bounded).
 */
export function measureOverflowInPage(tolerance: number): OverflowMeasurement {
  function cssPath(node: Element): string {
    if (node.id) return '#' + node.id;
    const tid =
      node.getAttribute('data-testid') ||
      node.getAttribute('data-test') ||
      node.getAttribute('data-qa');
    if (tid) return '[data-testid="' + tid.replace(/"/g, '\\"') + '"]';
    let path = node.tagName.toLowerCase();
    const aria = node.getAttribute('aria-label');
    if (aria) path += '[aria-label="' + aria.replace(/"/g, '\\"') + '"]';
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      if (sameTag.length > 1) path += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
    }
    return path;
  }

  function deepElements(root: Document | ShadowRoot, out: Element[], depth: number): void {
    if (depth > 6 || out.length > 2500) return;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      out.push(el);
      const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
      if (sr) deepElements(sr, out, depth + 1);
    }
  }

  const all: Element[] = [];
  deepElements(document, all, 0);

  const doc = document.documentElement;
  const clientWidth = doc.clientWidth;
  const bodyWidth = document.body ? document.body.scrollWidth : 0;
  const scrollWidth = Math.max(doc.scrollWidth, bodyWidth);
  const overflow = scrollWidth > clientWidth + tolerance;

  const offenders: OffenderInfo[] = [];
  if (overflow) {
    for (const el of all) {
      if (offenders.length >= 8) break;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > clientWidth + tolerance) {
        offenders.push({
          selector: cssPath(el),
          tag: el.tagName.toLowerCase(),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          snippet: el.outerHTML.replace(/\s+/g, ' ').slice(0, 120)
        });
      }
    }
  }
  return { clientWidth, scrollWidth, overflow, offenders };
}

export interface CandidateInfo {
  kind: 'button';
  selector: string;
  strategy: 'id' | 'testid' | 'aria-label' | 'css-path';
  text: string;
}

export interface SkippedCandidate {
  description: string;
  selector: string;
  /** forbidden = hard-dangerous keyword; risky = soft keyword without allow; denied = denySelectors match */
  reason: 'forbidden' | 'risky' | 'denied';
}

export interface CandidateCollection {
  candidates: CandidateInfo[];
  skipped: SkippedCandidate[];
}

export interface CandidateOptions {
  max: number;
  allowSelectors: string[];
  denySelectors: string[];
}

/**
 * Collects button candidates for a read-only-first explorer.
 *
 * Three-tier policy:
 *  - HARD-dangerous keywords (pay, delete, logout, submit, ...) are forbidden
 *    and can never be overridden;
 *  - SOFT keywords (run, execute, launch, install, order, cancel) are skipped
 *    unless the exact control is authorized via allowSelectors (CSS matches);
 *  - denySelectors exclude any matched control outright.
 *
 * NOTE: fully self-contained — this function runs serialized inside the page,
 * so all regexes and policy logic must live in the function body.
 */
export function collectCandidatesInPage(opts: CandidateOptions): CandidateCollection {
  function cssPath(node: Element): { selector: string; strategy: 'id' | 'testid' | 'aria-label' | 'css-path' } {
    const tid =
      node.getAttribute('data-testid') ||
      node.getAttribute('data-test') ||
      node.getAttribute('data-qa');
    if (tid) return { selector: '[data-testid="' + tid.replace(/"/g, '\\"') + '"]', strategy: 'testid' };
    if (node.id) return { selector: '#' + node.id, strategy: 'id' };
    const aria = node.getAttribute('aria-label');
    if (aria) {
      return {
        selector: node.tagName.toLowerCase() + '[aria-label="' + aria.replace(/"/g, '\\"') + '"]',
        strategy: 'aria-label'
      };
    }
    // Full structural path up to <body>, crossing OPEN shadow-root boundaries
    // (Playwright's CSS engine pierces open shadow roots, so the composed
    // host > ... > inner path resolves document-wide). Parent-relative paths
    // are ambiguous when two panels each contain a first button of the same tag.
    var parts: string[] = [];
    var cur: Element | null = node;
    var guard = 0;
    while (cur && cur !== document.body && guard < 40) {
      guard++;
      var seg = cur.tagName.toLowerCase();
      var root: Node = cur.getRootNode();
      var inShadow: boolean = root instanceof ShadowRoot;
      var siblings: Element[];
      if (cur.parentElement) {
        siblings = Array.from(cur.parentElement.children).filter(function (c) { return c.tagName === cur!.tagName; });
      } else if (inShadow) {
        siblings = Array.from((root as ShadowRoot).children).filter(function (c) { return c.tagName === cur!.tagName; });
      } else {
        siblings = [];
      }
      if (siblings.length > 1) seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
      parts.unshift(seg);
      cur = inShadow && cur.parentElement === null
        ? (root as ShadowRoot).host
        : cur.parentElement;
    }
    return { selector: parts.join(' > '), strategy: 'css-path' };
  }

  const HARD_RE =
    /(^|[^a-z])(delete|remove|destroy|pay|payment|purchase|buy|checkout|transfer|withdraw|logout|sign\s?out|subscribe|send|submit|confirm|upload|publish|post)([^a-z]|$)/i;
  const SOFT_RE = /(^|[^a-z])(run|execute|launch|install|order|cancel)([^a-z]|$)/i;

  const allow = opts.allowSelectors || [];
  const deny = opts.denySelectors || [];
  function matchesAny(node: Element, list: string[]): boolean {
    return list.some((s) => {
      try {
        return node.matches(s);
      } catch {
        return false;
      }
    });
  }

  const candidates: CandidateInfo[] = [];
  const skipped: SkippedCandidate[] = [];
  // Deep collection: document tree plus OPEN shadow roots (bounded).
  const els: Element[] = [];
  (function deepButtons(root: Document | ShadowRoot, depth: number): void {
    if (depth > 6 || els.length >= 400) return;
    for (const el of Array.from(root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a[href^="#"]'))) {
      els.push(el);
    }
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
      if (sr) deepButtons(sr, depth + 1);
    }
  })(document, 0);
  for (const node of els) {
    if (candidates.length >= opts.max) break;
    if (!(node instanceof HTMLElement)) continue;
    if (node.getClientRects().length === 0) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') continue;
    // Never touch form controls: submitting or mutating forms is out of scope.
    if (node.closest('form')) continue;

    const isHashLink = node.tagName === 'A';
    const text = (node.textContent || '').trim();
    const label =
      node.getAttribute('aria-label') ||
      (node as HTMLInputElement).value ||
      node.getAttribute('title') ||
      '';
    const name = node.getAttribute('name') || '';
    let selector: string;
    let strategy: 'id' | 'testid' | 'aria-label' | 'css-path';
    if (isHashLink) {
      const href = node.getAttribute('href') || '';
      selector = 'a[href="' + href.replace(/"/g, '\\"') + '"]';
      strategy = 'css-path';
    } else {
      const built = cssPath(node);
      selector = built.selector;
      strategy = built.strategy;
    }
    const description = 'click ' + (isHashLink ? 'view link "' : 'button "') + (text || label || selector).slice(0, 80) + '"';

    if (matchesAny(node, deny)) {
      skipped.push({ description, selector, reason: 'denied' });
      continue;
    }
    const hardRisk =
      HARD_RE.test(text) || HARD_RE.test(label) || HARD_RE.test(node.id) || HARD_RE.test(name);
    if (hardRisk) {
      skipped.push({ description, selector, reason: 'forbidden' });
      continue;
    }
    const softRisk =
      SOFT_RE.test(text) || SOFT_RE.test(label) || SOFT_RE.test(node.id) || SOFT_RE.test(name);
    if (softRisk && !matchesAny(node, allow)) {
      skipped.push({ description, selector, reason: 'risky' });
      continue;
    }
    candidates.push({ kind: 'button', selector, strategy, text: (text || label).slice(0, 80) });
  }
  return { candidates, skipped: skipped.slice(0, 100) };
}

/**
 * Injected via addInitScript so unhandled promise rejections are captured
 * even when they happen before ReproCase attaches listeners.
 */
export const UNHANDLED_REJECTION_SCRIPT = `
window.__reprocaseRejections = [];
window.__reprocaseErrorSeen = false;
window.__reprocaseActivity = { mutations: 0 };
window.addEventListener('error', function () { window.__reprocaseErrorSeen = true; });
window.addEventListener('unhandledrejection', function (e) {
  window.__reprocaseErrorSeen = true;
  var r = e && e.reason;
  var msg = r && typeof r === 'object' && 'message' in r ? String(r.message) : String(r);
  var stack = r && typeof r === 'object' && r.stack ? String(r.stack) : '';
  window.__reprocaseRejections.push({ reason: msg, stack: stack });
});
try {
  new MutationObserver(function (records) {
    window.__reprocaseActivity.mutations += records.length;
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
} catch (e) { /* documentElement unavailable at init time on some documents */ }
`;
