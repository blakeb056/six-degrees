#!/usr/bin/env node
// Run the Next CLI with this project's settings, on any OS.
//
// package.json used to say `NEXT_TELEMETRY_DISABLED=1 next build`, which is
// shell syntax Windows does not have — the Windows build failed on exactly
// that line. Same settings, set here instead:
//   NEXT_TELEMETRY_DISABLED=1          always
//   SIX_DEGREES_BIND=127.0.0.1         for dev and start (only this machine)

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
if (['dev', 'start'].includes(args[0])) env.SIX_DEGREES_BIND ??= '127.0.0.1';

const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [next, ...args], { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
