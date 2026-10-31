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
