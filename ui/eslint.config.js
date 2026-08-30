import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "client/src/data/**",
      "**/*.bundle.js",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,mjs,js}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks, "@typescript-eslint": tseslint.plugin },
    rules: {
      // TypeScript already reports these; the base rules only double-report and
      // misfire on type-only syntax and DOM/Node globals.
      "no-undef": "off",
      "no-unused-vars": "off",

      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // `_repo`, `_path`: the leading underscore is how this repo already spells a parameter
      // that exists to satisfy a signature it does not use.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/require-await": "error",
      // `no-explicit-any` is deliberately absent: 81 violations today. Enabling it
      // is a typing refactor, not a lint fix, so it is tracked separately.
    },
  },
  // Build scripts and config sit outside tsconfig's `include` (client/src/** and api/**), so
  // the type-aware parser cannot resolve them — syntax-only rules for those. Tests are NOT
  // here: they are inside `include`, so the promise rules apply to them too.
  {
    files: ["scripts/**", "**/*.mjs", "eslint.config.js", "*.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
  // A test double must be `async` to match the signature it stands in for, and usually has
  // nothing to await, so this rule only ever fires on correct mocks here. The two rules that
  // catch real promise bugs — no-floating-promises, no-misused-promises — stay on for tests.
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/_tests/**"],
    rules: { "@typescript-eslint/require-await": "off" },
  },
);
