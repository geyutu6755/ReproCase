import { describe, expect, it } from 'vitest';
import {
  hostnameOf,
  isLocalhostHost,
  normalizeUrl,
  redactUrl,
  sha1Short,
  trimStack
} from '../../src/util/net.js';

describe('redactUrl', () => {
  it('masks sensitive query parameter values', () => {
    const out = redactUrl('https://example.com/p?token=abc&session=s1&q=hello', true);
    expect(out).toContain('token=***');
    expect(out).toContain('session=***');
    expect(out).not.toContain('abc');
    expect(out).toContain('q=hello');
  });

  it('keeps everything when redaction is off', () => {
    expect(redactUrl('https://example.com/p?token=abc', false)).toContain('token=abc');
  });

  it('survives invalid URLs', () => {
    expect(redactUrl('::::', true)).toBe('::::');
  });
});

describe('normalizeUrl', () => {
  it('strips hash fragments', () => {
    expect(normalizeUrl('http://localhost:8080/a.html#section')).toBe('http://localhost:8080/a.html');
  });
  it('returns the input for garbage', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('isLocalhostHost', () => {
  it('accepts localhost variants', () => {
    expect(isLocalhostHost('localhost')).toBe(true);
    expect(isLocalhostHost('127.0.0.1')).toBe(true);
    expect(isLocalhostHost('::1')).toBe(true);
    expect(isLocalhostHost('app.localhost')).toBe(true);
  });
  it('rejects other hosts', () => {
    expect(isLocalhostHost('example.com')).toBe(false);
    expect(isLocalhostHost('localhost.evil.com')).toBe(false);
  });
});

describe('hostnameOf', () => {
  it('extracts lowercased hostnames', () => {
    expect(hostnameOf('http://EXAMPLE.com:8080/x')).toBe('example.com');
  });
});

describe('sha1Short', () => {
  it('is deterministic and 8 chars long', () => {
    expect(sha1Short('abc')).toBe(sha1Short('abc'));
    expect(sha1Short('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(sha1Short('abc')).not.toBe(sha1Short('abd'));
  });
});

describe('trimStack', () => {
  it('caps stack traces at N lines', () => {
    const stack = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    expect(trimStack(stack, 8)!.split('\n')).toHaveLength(8);
    expect(trimStack(undefined)).toBeUndefined();
  });
});
