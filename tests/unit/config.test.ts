import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, domainAllowed, resolveConfig } from '../../src/config.js';

function tmpConfigFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-cfg-'));
  const file = path.join(dir, 'reprocase.config.json');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

describe('resolveConfig', () => {
  it('fills defaults and keeps the entry', () => {
    const { config, warnings } = resolveConfig({ entry: 'http://127.0.0.1:8080/' });
    expect(warnings).toEqual([]);
    expect(config.entry).toBe('http://127.0.0.1:8080/');
    expect(config.maxPages).toBe(25);
    expect(config.maxDepth).toBe(3);
    expect(config.viewports.mobile).toEqual({ width: 390, height: 844 });
    expect(config.allowedActions.fillForms).toBe(false);
    expect(config.report.redactQuery).toBe(true);
  });

  it('rejects a missing entry', () => {
    expect(() => resolveConfig({})).toThrow(ConfigError);
    expect(() => resolveConfig({})).toThrow(/entry/);
  });

  it('rejects invalid URLs and protocols', () => {
    expect(() => resolveConfig({ entry: 'not-a-url' })).toThrow(ConfigError);
    expect(() => resolveConfig({ entry: 'ftp://example.com/' })).toThrow(ConfigError);
  });

  it('refuses non-local hosts without explicit allowedDomains', () => {
    expect(() => resolveConfig({ entry: 'https://example.com/' })).toThrow(/allowedDomains/);
  });

  it('accepts non-local hosts listed in allowedDomains', () => {
    const { config } = resolveConfig({
      entry: 'https://staging.example.com/',
      allowedDomains: ['staging.example.com']
    });
    expect(config.allowedDomains).toContain('staging.example.com');
  });

  it('accepts wildcard allowedDomains entries', () => {
    const { config } = resolveConfig({
      entry: 'https://api.staging.example.com/',
      allowedDomains: ['*.staging.example.com']
    });
    expect(config.entry).toBe('https://api.staging.example.com/');
  });

  it('warns about unknown keys and out-of-range values instead of failing', () => {
    const { config, warnings } = resolveConfig({
      entry: 'http://localhost:3000',
      nonsense: true,
      maxPages: 100000
    });
    expect(config.maxPages).toBe(25);
    expect(warnings.some((w) => w.includes('nonsense'))).toBe(true);
    expect(warnings.some((w) => w.includes('maxPages'))).toBe(true);
  });

  it('warns when form filling is enabled', () => {
    const { warnings } = resolveConfig({ entry: 'http://localhost', allowedActions: { fillForms: true } });
    expect(warnings.some((w) => w.includes('fillForms'))).toBe(true);
  });
});

describe('loadConfigFile', () => {
  it('parses a valid file', () => {
    const file = tmpConfigFile('{"entry":"http://localhost:8080/"}');
    expect(resolveConfig(require2load(file)).config.entry).toBe('http://localhost:8080/');
  });

  it('throws a ConfigError for invalid JSON', () => {
    const file = tmpConfigFile('{entry: nope');
    expect(() => require2load(file)).toThrow(ConfigError);
  });

  it('throws a ConfigError for a missing file', () => {
    expect(() => require2load(path.join(os.tmpdir(), 'reprocase-does-not-exist.json'))).toThrow(ConfigError);
  });
});

// Imported lazily to keep the import list flat.
import { loadConfigFile } from '../../src/config.js';
function require2load(file: string): Record<string, unknown> {
  return loadConfigFile(file);
}

describe('domainAllowed', () => {
  it('matches exact hosts case-insensitively', () => {
    expect(domainAllowed('Staging.Example.com', ['staging.example.com'])).toBe(true);
    expect(domainAllowed('example.com', ['staging.example.com'])).toBe(false);
  });

  it('supports wildcard subdomains', () => {
    expect(domainAllowed('a.b.example.com', ['*.example.com'])).toBe(true);
    expect(domainAllowed('example.com', ['*.example.com'])).toBe(true);
    expect(domainAllowed('evilexample.com', ['*.example.com'])).toBe(false);
  });
});
