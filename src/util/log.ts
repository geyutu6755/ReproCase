type Level = 'quiet' | 'info' | 'verbose';

let level: Level = 'info';

/**
 * Progress goes to stderr so stdout stays clean for CI pipelines that parse
 * command output.
 */
export const log = {
  setLevel(l: Level): void {
    level = l;
  },
  get isVerbose(): boolean {
    return level === 'verbose';
  },
  info(msg: string): void {
    if (level !== 'quiet') process.stderr.write(msg + '\n');
  },
  verbose(msg: string): void {
    if (level === 'verbose') process.stderr.write(msg + '\n');
  },
  warn(msg: string): void {
    if (level !== 'quiet') process.stderr.write('[warn] ' + msg + '\n');
  },
  error(msg: string): void {
    process.stderr.write('[error] ' + msg + '\n');
  },
  out(msg: string): void {
    process.stdout.write(msg + '\n');
  }
};
