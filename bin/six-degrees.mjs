#!/usr/bin/env node
/**
 * Launcher for the published package: `npx six-degrees`.
 *
 * Starts the prebuilt server on this machine, opens a browser at it, and stays
 * in the foreground so Ctrl-C stops it. Nothing is installed globally and
 * nothing is written outside the data directory.
 */
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// node:sqlite is the database driver and is only available unflagged from
// 22.13. engines is advisory, so check before anything can fail obscurely.
const MIN_NODE = [22, 13, 0];
function checkNode() {
  const parts = process.versions.node.split('.').map(Number);
  for (let i = 0; i < MIN_NODE.length; i++) {
    if ((parts[i] || 0) > MIN_NODE[i]) return;
    if ((parts[i] || 0) < MIN_NODE[i]) {
      console.error(
        `\n  six-degrees needs Node ${MIN_NODE.join('.')} or newer (this is ${process.versions.node}).` +
        `\n  It uses node:sqlite, which older versions do not provide.\n`
      );
      process.exit(1);
    }
  }
}

function parseArgs(argv) {
  const out = { port: Number(process.env.PORT) || 6363, open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = Number(argv[++i]);
    else if (a === '--no-open') out.open = false;
    else if (a === '--data-dir') process.env.SIX_DEGREES_HOME = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--version' || a === '-v') out.version = true;
  }
  return out;
}

const HELP = `
  six-degrees — map your professional network as a galaxy, on your own machine

  Usage
    npx six-degrees [options]

  Options
    -p, --port <n>      port to listen on (default 6363)
        --data-dir <p>  where to keep the database (default ~/.six-degrees)
        --no-open       do not open a browser
    -h, --help          show this
    -v, --version       print the version

  Your data stays on this machine. Nothing is uploaded.
`;

// Walk upward from the requested port rather than failing when it is taken —
// a port collision is the most common way a local tool wastes someone's time.
function freePort(start, attempts = 20) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      const srv = createServer();
      srv.once('error', () => {
        srv.close();
        if (++port - start >= attempts) reject(new Error('no free port found'));
        else tryPort();
      });
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, '127.0.0.1');
    };
    tryPort();
  });
}

function openBrowser(url) {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  const args = platform() === 'win32' ? ['', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, shell: platform() === 'win32' }).unref();
  } catch {
    /* a browser that will not open is not worth failing over */
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { console.log(HELP); return; }
  if (args.version) {
    const { default: pkg } = await import(path.join(ROOT, 'package.json'), { with: { type: 'json' } });
    console.log(pkg.version);
    return;
  }

  checkNode();

  const dataDir = process.env.SIX_DEGREES_HOME || path.join(homedir(), '.six-degrees');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const server = path.join(ROOT, '.next', 'standalone', 'server.js');
  if (!existsSync(server)) {
    console.error(
      '\n  This package is missing its build output.' +
      '\n  If you are running from a clone, build it first:  npm run build\n'
    );
    process.exit(1);
  }

  const port = await freePort(args.port);
  const url = `http://127.0.0.1:${port}`;

  process.env.PORT = String(port);
  process.env.HOSTNAME = '127.0.0.1';
  process.env.SIX_DEGREES_BIND = '127.0.0.1';   // read by the destructive-route gate
  process.env.SIX_DEGREES_HOME = dataDir;
  process.env.NEXT_TELEMETRY_DISABLED = '1';

  console.log(`
  six-degrees

  ▸ Running at   ${url}
  ▸ Data         ${dataDir}

  Nothing leaves this machine. Press Ctrl-C to stop.
`);

  // The standalone server resolves its assets relative to its own directory.
  process.chdir(path.join(ROOT, '.next', 'standalone'));
  await import(server);

  if (args.open) setTimeout(() => openBrowser(url), 600);
}

main().catch((err) => {
  console.error('\n  Failed to start:', err?.message || err, '\n');
  process.exit(1);
});
