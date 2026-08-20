import nextPlugin from "@next/eslint-plugin-next";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Flat config composed from the underlying plugins rather than from
 * `eslint-config-next`.
 *
 * That package is still eslintrc-shaped and loads @rushstack/eslint-patch on
 * import, which throws on ESLint 9 ("Failed to patch ESLint because the calling
 * module was not recognized"). The plugins it wraps — @next/eslint-plugin-next
 * and eslint-plugin-react-hooks — both ship real flat configs, so we use those
 * directly and get the same rules without the patch.
 */
export default [
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "node_modules/**",
      "drizzle/**",
      "public/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.flatConfig.coreWebVitals.rules,
      ...reactHooks.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],

      /**
       * Design tokens are the single source of truth (globals.css §top). A
       * component that hardcodes a hex has stepped outside the system, and the
       * contrast gate in scripts/check-contrast.ts cannot see it — so it can
       * silently ship below AA. Import a token instead.
       */
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/]",
          message:
            "Hardcoded hex colour. Use a design token from globals.css instead — " +
            "values outside the token set are invisible to the WCAG contrast gate.",
        },
      ],
    },
  },

  // Scripts run in Node and legitimately handle raw colour values: the contrast
  // checker's whole job is parsing hexes out of the stylesheet.
  {
    files: ["scripts/**/*.ts", "*.config.{ts,mjs}"],
    rules: { "no-restricted-syntax": "off" },
  },
];
