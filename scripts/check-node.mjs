// Runs before `npm run dev` and `npm run build`.
//
// The database is Node's built-in node:sqlite, which arrived in 22.13. On an
// older Node the app installs and starts perfectly and then throws
// "Cannot find module 'node:sqlite'" on the first query — a runtime error that
// reads like a broken app rather than a missing requirement. `engines` in
// package.json is only a warning by default, so it does not catch this either.

const NEED = [22, 13];
const [major, minor] = process.versions.node.split('.').map(Number);

if (major < NEED[0] || (major === NEED[0] && minor < NEED[1])) {
  const need = NEED.join('.');
  console.error(`
  ┌──────────────────────────────────────────────────────────────┐
  │  6 Degrees needs Node ${need} or newer.                          │
  └──────────────────────────────────────────────────────────────┘

  You have Node ${process.versions.node}.

  The database uses node:sqlite, which is built into Node from ${need}.
  On older versions the app starts and then fails on its first query.

  Install the current LTS from https://nodejs.org and run this again.
  With nvm:  nvm install --lts && nvm use --lts
`);
  process.exit(1);
}
