import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Resolved from package.json so the CLI, reports and generated files never drift apart.
export const VERSION: string = require('../package.json').version as string;
