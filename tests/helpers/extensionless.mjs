// Next resolves the app's extensionless relative imports ('../../../lib/db');
// plain Node doesn't. A test that imports a route registers this first
// (node:module register), so the route loads as the app loads it.
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?js$|\.json$/.test(specifier)) {
    try {
      return await next(`${specifier}.js`, context);
    } catch {
      // Not a .js file: resolve it as written.
    }
  }
  return next(specifier, context);
}
