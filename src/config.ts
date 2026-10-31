import fs from 'node:fs';
import type { ReproCaseConfig, ViewportSize } from './types.js';
import { isLocalhostHost } from './util/net.js';

export class ConfigError extends Error {}

export const DEFAULT_CONFIG: Omit<ReproCaseConfig, 'entry'> = {
  allowedDomains: [],
  maxPages: 25,
  maxDepth: 3,
  maxActionsPerPage: 10,
  navigationTimeoutMs: 15_000,
  runTimeoutMs: 300_000,
  requestDelayMs: 150,
  viewports: {
    desktop: { width: 1280, height: 720 },
    mobile: { width: 390, height: 844 }
  },
  allowedActions: { clickLinks: true, clickButtons: true, fillForms: false },
  exploration: { allowSelectors: [], denySelectors: [] },
  capture: { screenshots: true, traces: 'auto' },
  verification: { attempts: 3 },
  report: { redactQuery: true }
};

export interface ResolvedConfig {
  config: ReproCaseConfig;
  warnings: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(value: unknown, path: string, min: number, max: number, warnings: string[], def: number): number {
  if (value === undefined) return def;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    warnings.push(`Ignoring ${path}: expected a number, got ${JSON.stringify(value)}`);
    return def;
  }
  if (value < min || value > max) {
    warnings.push(`Ignoring ${path}: ${value} is outside the allowed range [${min}, ${max}]`);
    return def;
  }
  return Math.round(value);
}

function bool(value: unknown, path: string, warnings: string[], def: boolean): boolean {
  if (value === undefined) return def;
  if (typeof value !== 'boolean') {
    warnings.push(`Ignoring ${path}: expected true or false, got ${JSON.stringify(value)}`);
    return def;
  }
  return value;
}

function viewport(value: unknown, path: string, warnings: string[], def: ViewportSize): ViewportSize {
  if (value === undefined) return def;
  if (!isPlainObject(value)) {
    warnings.push(`Ignoring ${path}: expected an object like {"width":1280,"height":720}`);
    return def;
  }
  return {
    width: num(value.width, `${path}.width`, 200, 8000, warnings, def.width),
    height: num(value.height, `${path}.height`, 200, 8000, warnings, def.height)
  };
}

function stringList(value: unknown, path: string, warnings: string[], def: string[]): string[] {
  if (value === undefined) return def;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    warnings.push(`Ignoring ${path}: expected an array of strings`);
    return def;
  }
  return (value as string[]).map((v) => v.trim().toLowerCase()).filter(Boolean);
}

const KNOWN_KEYS = new Set([
  'entry',
  'allowedDomains',
  'maxPages',
  'maxDepth',
  'maxActionsPerPage',
  'navigationTimeoutMs',
  'runTimeoutMs',
  'requestDelayMs',
  'viewports',
  'allowedActions',
  'exploration',
  'capture',
  'verification',
  'report'
]);

/**
 * Validates a partial config object against the defaults. Unknown fields and
 * out-of-range values produce warnings instead of hard failures, but the
 * entry URL and the local-scan safety rule are enforced strictly.
 */
export function resolveConfig(partial: Record<string, unknown>): ResolvedConfig {
  const warnings: string[] = [];

  if (!isPlainObject(partial)) {
    throw new ConfigError('Config must be a JSON object.');
  }
  for (const key of Object.keys(partial)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`Unknown config key "${key}" (ignored)`);
  }

  const entryRaw = partial.entry;
  if (typeof entryRaw !== 'string' || !entryRaw.trim()) {
    throw new ConfigError(
      'Config error: "entry" is required. Provide it in the config file or via --url <url>.'
    );
  }
  let entryUrl: URL;
  try {
    entryUrl = new URL(entryRaw.trim());
  } catch {
    throw new ConfigError(`Config error: "entry" is not a valid URL: ${entryRaw}`);
  }
  if (entryUrl.protocol !== 'http:' && entryUrl.protocol !== 'https:') {
    throw new ConfigError(
      `Config error: "entry" must use http:// or https:// (got "${entryUrl.protocol}")`
    );
  }

  const allowedDomains = stringList(partial.allowedDomains, 'allowedDomains', warnings, DEFAULT_CONFIG.allowedDomains);

  const host = entryUrl.hostname.toLowerCase();
  if (!isLocalhostHost(host) && !domainAllowed(host, allowedDomains)) {
    throw new ConfigError(
      `Refusing to scan non-local host "${host}" without explicit permission.\n` +
        'Add it to "allowedDomains" in your config to confirm you are authorized to test this site.'
    );
  }

  const viewports = isPlainObject(partial.viewports) ? partial.viewports : {};
  const allowedActions = isPlainObject(partial.allowedActions) ? partial.allowedActions : {};
  const exploration = isPlainObject(partial.exploration) ? partial.exploration : {};
  const capture = isPlainObject(partial.capture) ? partial.capture : {};
  const verification = isPlainObject(partial.verification) ? partial.verification : {};
  const report = isPlainObject(partial.report) ? partial.report : {};

  let traces: 'auto' | boolean = DEFAULT_CONFIG.capture.traces;
  if (capture.traces !== undefined) {
    if (capture.traces === 'auto' || typeof capture.traces === 'boolean') {
      traces = capture.traces as 'auto' | boolean;
    } else {
      warnings.push('Ignoring capture.traces: expected true, false or "auto"');
    }
  }

  const config: ReproCaseConfig = {
    entry: entryUrl.href,
    allowedDomains,
    maxPages: num(partial.maxPages, 'maxPages', 1, 500, warnings, DEFAULT_CONFIG.maxPages),
    maxDepth: num(partial.maxDepth, 'maxDepth', 0, 20, warnings, DEFAULT_CONFIG.maxDepth),
    maxActionsPerPage: num(partial.maxActionsPerPage, 'maxActionsPerPage', 0, 100, warnings, DEFAULT_CONFIG.maxActionsPerPage),
    navigationTimeoutMs: num(partial.navigationTimeoutMs, 'navigationTimeoutMs', 1000, 120000, warnings, DEFAULT_CONFIG.navigationTimeoutMs),
    runTimeoutMs: num(partial.runTimeoutMs, 'runTimeoutMs', 5000, 3600000, warnings, DEFAULT_CONFIG.runTimeoutMs),
    requestDelayMs: num(partial.requestDelayMs, 'requestDelayMs', 0, 60000, warnings, DEFAULT_CONFIG.requestDelayMs),
    viewports: {
      desktop: viewport(viewports.desktop, 'viewports.desktop', warnings, DEFAULT_CONFIG.viewports.desktop),
      mobile: viewport(viewports.mobile, 'viewports.mobile', warnings, DEFAULT_CONFIG.viewports.mobile)
    },
    allowedActions: {
      clickLinks: bool(allowedActions.clickLinks, 'allowedActions.clickLinks', warnings, true),
      clickButtons: bool(allowedActions.clickButtons, 'allowedActions.clickButtons', warnings, true),
      fillForms: bool(allowedActions.fillForms, 'allowedActions.fillForms', warnings, false)
    },
    exploration: {
      allowSelectors: stringList(exploration.allowSelectors, 'exploration.allowSelectors', warnings, []),
      denySelectors: stringList(exploration.denySelectors, 'exploration.denySelectors', warnings, [])
    },
    capture: {
      screenshots: bool(capture.screenshots, 'capture.screenshots', warnings, true),
      traces
    },
    verification: {
      attempts: num(verification.attempts, 'verification.attempts', 1, 10, warnings, DEFAULT_CONFIG.verification.attempts)
    },
    report: {
      redactQuery: bool(report.redactQuery, 'report.redactQuery', warnings, true)
    }
  };

  if (config.allowedActions.fillForms) {
    warnings.push('allowedActions.fillForms is true: explorers may type into inputs. Only use this on sites you own.');
  }

  return { config, warnings };
}

export function loadConfigFile(filePath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new ConfigError(`Cannot read config file "${filePath}": ${(e as Error).message}`);
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    throw new ConfigError(`Config file "${filePath}" is not valid JSON: ${(e as Error).message}`);
  }
}

/**
 * Exact-match domain allow list with optional "*.example.com" wildcard
 * entries. Hostnames are compared without ports.
 */
export function domainAllowed(host: string, allowedDomains: string[]): boolean {
  const h = (host || '').toLowerCase();
  return allowedDomains.some((d) => {
    const domain = d.toLowerCase().trim();
    if (domain.startsWith('*.')) {
      const base = domain.slice(2);
      return h === base || h.endsWith('.' + base);
    }
    return h === domain;
  });
}

export { isLocalhostHost };
