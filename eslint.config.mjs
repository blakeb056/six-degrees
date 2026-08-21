import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Identity and scraper-status are read from localStorage and from a
      // process on the user's own machine. Neither exists during server
      // rendering, so the read MUST happen in an effect and its result MUST
      // land in state — which is exactly what this rule flags. Kept visible as
      // a warning rather than silenced, so genuine cascading-render bugs still
      // surface in review.
      "react-hooks/set-state-in-effect": "warn",

      // Avatars are user-supplied remote URLs (or local files captured by the
      // scraper) with graceful initial-letter fallbacks. next/image would add a
      // loader and per-request cost for no benefit here.
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
