#!/usr/bin/env node
// Runs before `npm run dev`.
//
// A dev server started before a `git pull` keeps serving what it had at launch,
// and when you start a second one Next quietly takes the next free port. Your
// browser is still pointed at the first, so the app looks like the pull never
// happened — the exact confusion that cost an evening: correct commit, correct
// files, old screen.
//
// This does not kill anything. It tells you what is already listening and gives
// you the line to run.

import { execFileSync } from 'node:child_process';

const PORTS = [3000, 3001, 3002, 3210];

function listeners() {
  try {
    const out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    return out
      .split('\n')
      .filter((l) => /^node\b/.test(l))
      .map((l) => {
        const pid = l.split(/\s+/)[1];
        const port = (l.match(/:(\d+)\s+\(LISTEN\)/) || [])[1];
        return port ? { pid, port: Number(port) } : null;
      })
      .filter(Boolean)
      .filter((p) => PORTS.includes(p.port));
  } catch {
    return [];   // no lsof, or not permitted — never block the dev server
  }
}

const running = listeners();
if (running.length > 0) {
  const list = running.map((r) => `port ${r.port} (pid ${r.pid})`).join(', ');
  console.log(`
  ┌──────────────────────────────────────────────────────────────┐
  │  Something is already serving on a port this app uses.       │
  └──────────────────────────────────────────────────────────────┘

  Already listening: ${list}

  If that is an older copy of this app, it is still serving the code it had
  when it started — including from before your last git pull. Starting another
  one now takes the NEXT free port, so your browser keeps showing the old one.

  To replace it:

      pkill -f "next dev"; pkill -f "next-server"; npm run dev

  Continuing anyway — watch the port this prints, it may not be ${running[0].port}.
`);
}
