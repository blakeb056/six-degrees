// This build's version, from package.json, for code that runs on the server.
// An import attribute rather than a file read: a read resolves against the
// caller's folder and breaks once the app is installed (TRAPS §4), while an
// import is resolved at build time and works in the tests too.
import pkg from '../package.json' with { type: 'json' };

export const APP_VERSION = pkg.version;
