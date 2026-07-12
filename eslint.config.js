// @ts-check
// ESLint v9 flat-config root for Lariat.
//
// Posture: SOFT-LAUNCH. Most stylistic rules are 'warn' so an iPad-cook-shipping
// dev can keep moving; only correctness rules that catch real bugs are 'error'.
//
// Gate behavior — make sure this matches docs/lint-baseline.md:
//   - pre-commit (lint-staged): errors ONLY. Warnings do not block commits.
//   - `npm run lint:changed`: warnings + errors fail (—max-warnings 0). This is
//     the "am I clean against the warning baseline" check devs can run manually
//     and that future CI can adopt without changing pre-commit ergonomics.
//   - `npm run lint`: full repo, advisory until the 299-warning baseline drains.
//
// Type-checker (`tsc --noEmit`) keeps doing the heavy semantic lifting; we
// deliberately skip type-aware ESLint rules to avoid double-reporting and
// to keep lint fast.
//
// Spec: docs/superpowers/specs/2026-05-04-eslint-setup.md (forthcoming)
// Plan: docs/superpowers/plans/2026-05-04-eslint-setup.md (forthcoming)

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
// @ts-expect-error — eslint-plugin-eslint-comments ships no type declarations
// and no @types package exists; under checkJs this bare import is an
// unavoidable implicit-any. Runtime behavior is unaffected.
import eslintCommentsPlugin from 'eslint-plugin-eslint-comments';
import globals from 'globals';

// NOTE: not annotated `import('eslint').Linter.Config[]` — several
// plugin-provided config objects (e.g. @next/eslint-plugin-next's shared
// configs) use legacy string rule-severities that don't structurally satisfy
// the strict flat `Linter.Config` type, so the honest annotation here is the
// inferred array type rather than a forced/incorrect one.
export default [
  // Globally ignored paths — generated, vendored, or off-tree.
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'next-env.d.ts',
      'dist/**',
      'build/**',
      'LariatNative/.build/**',
      '.venv-datapack/**',
      'coverage/**',
      'public/**',
      '.venv/**',
      'data/**',
      'XL/**',
      'backups/**',
      'exports/**',
      'Lariat-v2/**',     // archived
      'lariat-kms/**',    // archived
      'scripts/datapack/build/**',
      'desktop/dist/**',          // electron build output (gitignored)
      'design/**',                // design mockup archives (gitignored)
      'cad-kernel/build/**',      // cad-kernel build output (gitignored)
      'cad-kernel/build2/**',
      '.gitnexus/**',             // generated index runner (gitignored)
      'line_setups/**',           // local scratch, excluded in tsconfig too
      'worktrees/**',
      '.claude/**',               // agent worktrees (.claude/worktrees) are full repo copies; never lint them
    ],
  },

  // Base recommended ruleset — applies to every JS/TS/JSX/TSX file.
  js.configs.recommended,

  // TypeScript (non-type-aware — see header note).
  ...tseslint.configs.recommended,

  // React + react-hooks — applies to JSX/TSX AND .ts (custom hook files
  // like fire-schedule/_lib/useFireCue.ts use hooks but no JSX, still
  // need the rules-of-hooks + exhaustive-deps coverage).
  {
    files: ['**/*.{jsx,tsx,ts}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      // Next.js ships React import-less; turn off the legacy rules.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Stylistic — JSX renders these entities fine. Demoted from
      // error so the soft-launch isn't blocked on cosmetic JSX text.
      'react/no-unescaped-entities': 'warn',
    },
  },

  // Next.js page/component rules — applies to anything under app/.
  {
    files: ['app/**/*.{js,jsx,ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },

  // eslint-comments hygiene — applies everywhere.
  {
    plugins: { 'eslint-comments': eslintCommentsPlugin },
    rules: {
      // Demoted to warn — pre-existing unused-disable comments shouldn't block CI
      // during the soft launch. T5 of the plan triages these into removal PRs.
      'eslint-comments/no-unused-disable': 'warn',
      'eslint-comments/no-aggregating-enable': 'warn',
      'eslint-comments/no-duplicate-disable': 'warn',
      'eslint-comments/no-unlimited-disable': 'warn',
    },
  },

  // ── PROJECT-WIDE RULE TIERING ────────────────────────────────────
  //
  // ERROR (blocks CI): real-bug shapes only.
  // WARN  (informational): style + likely-noise rules a soft-launch can survive.
  // OFF   (silenced): rules that conflict with intentional patterns in this
  //                   codebase (kitchen-jargon UI, dynamic SQL builders, etc.)
  {
    files: ['**/*.{js,mjs,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Standard runtime presets cover console, setTimeout, fetch,
        // AbortController, Buffer, process, etc. without us hand-rolling.
        ...globals.node,
        ...globals.browser,
        ...globals.jest,
        // Lariat uses webkit-prefixed AudioContext for older Safari iPads.
        webkitAudioContext: 'readonly',
      },
    },
    rules: {
      // ── ERROR (real-bug shapes) ──────────────────────────────────
      'no-debugger': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': 'error',
      'no-misleading-character-class': 'error',
      'no-self-assign': 'error',

      // ── WARN (informational) ─────────────────────────────────────
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],

      // ── OFF (intentional patterns in this codebase) ──────────────
      // The codebase uses string concat in SQL inside parameterized prepare() — no injection risk.
      // No rule covers this directly; flagged so the maintainer doesn't add `no-template-curly-in-string`.

      // We use `Function` types in a few generic helper signatures intentionally.
      '@typescript-eslint/no-unsafe-function-type': 'off',

      // `@ts-nocheck` with a description is the GH #250 migration marker —
      // a 249-file baseline of JS files that fail under checkJs:true. Each
      // header comment names the issue + the migration plan; the default
      // `ban-ts-comment: error` would refuse to commit them. Allowing
      // `@ts-expect-error` / `@ts-ignore` only with descriptions keeps the
      // gate honest for new uses.
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': 'allow-with-description',
        'ts-nocheck': 'allow-with-description',
        'ts-check': false,
        minimumDescriptionLength: 5,
      }],

      // var is never used; let/const enforced via ECMA latest defaults.
    },
  },

  // Test files: more permissive — fixtures often have unused locals,
  // commented-out cases, etc.
  {
    files: ['tests/**/*.{js,mjs,ts}', 'app/__tests__/**/*.{js,jsx,ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': 'off',
    },
  },

  // CommonJS files — .cjs is CommonJS by definition, plus the classic
  // config files. require()/module/process are legitimate here.
  {
    files: ['**/*.cjs', '*.config.{js,cjs}', 'jest.setup.{js,cjs}', 'jest.config.{js,cjs}'],
    languageOptions: { sourceType: 'commonjs' },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off', // module/require are CJS globals
    },
  },
];
