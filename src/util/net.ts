import { createHash } from 'node:crypto';

export function isLocalhostHost(host: string): boolean {
  const h = (host || '').toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '[::1]' ||
    h.endsWith('.localhost')
  );
}

/** Strips the hash fragment; keeps everything else verbatim. */
export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    return url.href;
  } catch {
    return u;
  }
}

export function hostnameOf(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * True when the target URL lives on the same port as the origin URL (ports
 * are normalized to their protocol defaults). Two apps on the same host but
 * different ports are different sites, so an explicit port pins the scan
 * scope: http://127.0.0.1:3000 must never reach http://127.0.0.1:3001.
 */
export function samePort(originUrl: string, targetUrl: string): boolean {
  try {
    const origin = new URL(originUrl);
    const target = new URL(targetUrl);
    const originPort = origin.port || (origin.protocol === 'https:' ? '443' : '80');
    const targetPort = target.port || (target.protocol === 'https:' ? '443' : '80');
    return originPort === targetPort;
  } catch {
    return false;
  }
}

/**
 * Removes values of sensitive-looking query parameters (tokens, emails,
 * session ids, ...) before anything is written to a report.
 */
const SENSITIVE_KEY_RE =
  /token|secret|password|passwd|pwd|api[-_]?key|access[-_]?key|auth|session|sid|jwt|email|phone|ssn|card|credit|address/i;

export function redactUrl(u: string, redact: boolean): string {
  if (!redact) return u;
  try {
    const url = new URL(u);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY_RE.test(key)) url.searchParams.set(key, '***');
    }
    return url.toString();
  } catch {
    return u;
  }
}

/**
 * Masks sensitive query-parameter values inside free text such as error
 * messages and stack traces (e.g. ".../page?token=abc123&x=1" keeps x=1 but
 * masks the token). Query strings ride along in stack frames, so URLs must be
 * redacted in text too — not only in structured URL fields.
 */
export function redactSecretsInText(text: string): string {
  return text.replace(
    /([?&][\w.\-]*(?:token|secret|password|passwd|pwd|api[-_]?key|access[-_]?key|auth|session|sid|jwt|email|phone|ssn|card|credit|address)[\w.\-]*=)[^&\s'"<>]*/gi,
    '$1***'
  );
}

export function sha1Short(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 8);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function firstLine(s: string): string {
  return (s || '').split('\n')[0].trim();
}

export function trimStack(stack: string | undefined, lines = 8): string | undefined {
  if (!stack) return undefined;
  return stack.split('\n').slice(0, lines).join('\n');
}
