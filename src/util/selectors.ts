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

/** Measures horizontal overflow of the document and locates offenders. */
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

  const doc = document.documentElement;
  const clientWidth = doc.clientWidth;
  const bodyWidth = document.body ? document.body.scrollWidth : 0;
  const scrollWidth = Math.max(doc.scrollWidth, bodyWidth);
  const overflow = scrollWidth > clientWidth + tolerance;

  const offenders: OffenderInfo[] = [];
  if (overflow) {
    const all = document.querySelectorAll('body *');
    for (const el of Array.from(all)) {
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
  kind: 'link' | 'button';
  selector: string;
  href?: string;
  text: string;
}

/**
 * Collects click candidates that are safe for a read-only-first explorer:
 * visible, enabled, not inside a form, no risky keywords, no popups/downloads.
 * NOTE: fully self-contained — this function runs serialized inside the page,
 * so the risky-keyword regex must live in the function body.
 */
export function collectCandidatesInPage(max: number): CandidateInfo[] {
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

  const RISKY_ACTION_RE =
    /(^|[^a-z])(delete|remove|destroy|pay|payment|purchase|buy|checkout|order|subscribe|send|submit|confirm|signout|sign\s?out|logout|log\s?out|cancel|post|publish|upload|transfer|withdraw|install|launch|execute|run)([^a-z]|$)/i;

  const out: CandidateInfo[] = [];
  const els = Array.from(
    document.querySelectorAll('a[href], button, [role="button"], input[type="button"], input[type="submit"]')
  );
  for (const node of els) {
    if (out.length >= max) break;
    if (!(node instanceof HTMLElement)) continue;
    if (node.getClientRects().length === 0) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') continue;
    // Never touch form controls: submitting or mutating forms is out of scope.
    if (node.closest('form') && node.tagName !== 'A') continue;

    if (node.tagName === 'A') {
      const a = node as HTMLAnchorElement;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#')) continue;
      if (!/^https?:/i.test(a.href)) continue;
      if (a.target && a.target !== '_self') continue;
      if (a.hasAttribute('download')) continue;
      const text = (a.textContent || '').trim();
      const label = a.getAttribute('aria-label') || '';
      if (RISKY_ACTION_RE.test(text) || RISKY_ACTION_RE.test(label)) continue;
      out.push({ kind: 'link', selector: cssPath(a), href: a.href, text: (text || label).slice(0, 80) });
    } else {
      const text = (node.textContent || '').trim();
      const label =
        node.getAttribute('aria-label') ||
        (node as HTMLInputElement).value ||
        node.getAttribute('title') ||
        '';
      const name = node.getAttribute('name') || '';
      if (
        RISKY_ACTION_RE.test(text) ||
        RISKY_ACTION_RE.test(label) ||
        RISKY_ACTION_RE.test(node.id) ||
        RISKY_ACTION_RE.test(name)
      ) {
        continue;
      }
      out.push({ kind: 'button', selector: cssPath(node), text: (text || label).slice(0, 80) });
    }
  }
  return out;
}

/**
 * Injected via addInitScript so unhandled promise rejections are captured
 * even when they happen before ReproCase attaches listeners.
 */
export const UNHANDLED_REJECTION_SCRIPT = `
window.__reprocaseRejections = [];
window.addEventListener('unhandledrejection', function (e) {
  var r = e && e.reason;
  var msg = r && typeof r === 'object' && 'message' in r ? String(r.message) : String(r);
  var stack = r && typeof r === 'object' && r.stack ? String(r.stack) : '';
  window.__reprocaseRejections.push({ reason: msg, stack: stack });
});
`;
