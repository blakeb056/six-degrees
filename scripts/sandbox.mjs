// `npm run fresh` — run the app as if you had never used it before.
//
// Everything personal lives in one place: SIX_DEGREES_HOME (default
// ~/.six-degrees) holds the database, the captured avatars, the scraper's
// signed-in Chrome profile and its Python environment. Point that somewhere
// else and you are a brand-new user, with your real data untouched.
//
// This exists because there is no other honest way to check the first-run
// experience once you have used the app: your own data makes every empty state
// and every setup step invisible.

import { spawn } from 'node:child_process';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = path.join(ROOT, '.sandbox');
const PORT = process.env.PORT || '3456';
const reset = process.argv.includes('--reset');

if (reset && existsSync(HOME)) {
  rmSync(HOME, { recursive: true, force: true });
  console.log('  Wiped the sandbox. This run starts from nothing again.\n');
}
mkdirSync(HOME, { recursive: true });

const firstRun = !existsSync(path.join(HOME, 'six-degrees.sqlite'));

console.log(`
  ┌──────────────────────────────────────────────────────────────┐
  │  Sandbox — you are a brand-new user                          │
  └──────────────────────────────────────────────────────────────┘

  Data for this run:  .sandbox/
  Your real data:     ${process.env.SIX_DEGREES_HOME || '~/.six-degrees'}  (untouched)

  ${firstRun ? 'Nothing here yet — this is a true first run.' : 'Reusing the last sandbox. Add --reset to start over.'}

  Opening http://localhost:${PORT}
  Stop with Ctrl-C.  Start over:  npm run fresh -- --reset
`);

const child = spawn(
  'npx',
  ['next', 'dev', '-H', '127.0.0.1', '-p', PORT],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      SIX_DEGREES_HOME: HOME,
      SIX_DEGREES_BIND: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  }
);

child.on('close', (code) => process.exit(code ?? 0));
