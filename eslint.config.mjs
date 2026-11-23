import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // A leading underscore marks a variable kept on purpose (a field taken out of an object with ...rest, an unused argument).
  { rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }] } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and packages moved aside so iCloud does not sync them (git ignores them too): never source code.
    ".next.nosync/**",
    "node_modules.nosync/**",
    // A separate app (React + Express) with its own setup; it is not part of the hub.
    "approvals-app/**",
  ]),
]);

export default eslintConfig;
