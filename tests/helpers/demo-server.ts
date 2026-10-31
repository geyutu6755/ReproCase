import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer, type StaticServer } from '../../src/dev-server.js';

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEMO_SITE_DIR = path.join(PROJECT_ROOT, 'examples', 'demo-site');

export async function startDemoServer(): Promise<StaticServer> {
  return startStaticServer(DEMO_SITE_DIR);
}
