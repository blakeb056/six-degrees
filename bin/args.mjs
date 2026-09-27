// The npx launcher's command line, kept apart from bin/six-degrees.mjs (which
// starts a server the moment it runs) so the tests can read it directly.

import { homedir } from 'node:os';
import path from 'node:path';

/**
 * A folder named on the command line, made absolute. The launcher changes into
 * the package's own folder before the server starts, so a relative folder
 * passed on as it is would land inside the npx cache, and be lost when that is
 * cleared. A leading ~ is the home folder: the shell expands `--data-dir ~/x`
 * but not `--data-dir=~/x`, which would otherwise make a folder named "~".
 */
export function absoluteFolder(value, { cwd = process.cwd(), home = homedir() } = {}) {
  const s = String(value);
  const expanded = s === '~' ? home : s.startsWith('~/') ? path.join(home, s.slice(2)) : s;
  return path.resolve(cwd, expanded);
}

/**
 * @returns {{ port, open, dataDir, help, version, error }}
 * dataDir is absolute (absoluteFolder), or null when not given.
 */
export function parseArgs(argv, { env = process.env, cwd = process.cwd(), home = homedir() } = {}) {
  const out = { port: Number(env.PORT) || 6363, open: true, dataDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--port' || a === '-p') out.port = Number(argv[++i]);
    else if (a === '--no-open') out.open = false;
    else if (a === '--data-dir' || a.startsWith('--data-dir=')) {
      const value = a === '--data-dir' ? argv[++i] : a.slice('--data-dir='.length);
      if (value) out.dataDir = absoluteFolder(value, { cwd, home });
      else out.error = '--data-dir needs a folder, for example: --data-dir ~/six-degrees-copy';
    }
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--version' || a === '-v') out.version = true;
  }
  return out;
}

/** The data folder: --data-dir, else SIX_DEGREES_HOME, else ~/.six-degrees. Always absolute, for the same reason. */
export function resolveDataDir(args, { env = process.env, cwd = process.cwd(), home = homedir() } = {}) {
  return absoluteFolder(args.dataDir || env.SIX_DEGREES_HOME || path.join(home, '.six-degrees'), { cwd, home });
}
