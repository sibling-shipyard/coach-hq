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
  // Tests and build scripts sit outside tsconfig's `include`, so the type-aware
  // parser cannot resolve them. Lint them with the syntax-only rules instead.
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/_tests/**",
      "scripts/**",
      "**/*.mjs",
      "eslint.config.js",
      "*.config.ts",
    ],
    ...tseslint.configs.disableTypeChecked,
  },
);
