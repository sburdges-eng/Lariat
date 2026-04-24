// Jest config for React component tests under app/__tests__/**.
//
// Uses next/jest to pick up:
//   - next.config.mjs + tsconfig paths
//   - SWC transform for JSX / TS / TSX
//   - CSS module + file mocks
//
// Server-side integration tests (tests/js/**) use node --test and are NOT
// run under jest. Jest's testMatch is scoped to app/__tests__/** only.

const nextJest = require('next/jest.js');

const createJestConfig = nextJest({
  dir: './',
});

/** @type {import('jest').Config} */
const config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  testMatch: ['<rootDir>/app/__tests__/**/*.test.{js,jsx,ts,tsx}'],
  // Two aspirational tests from before Jest was wired up:
  //   recipe-api.test.js        — uses bare `fetch('/api/recipes/...')` against
  //                               a non-existent server; needs rewrite against
  //                               the route handler directly (like
  //                               tests/js/test-checks-api.mjs).
  //   protected-pages.test.jsx  — imports ../costing/CostingDashboard which
  //                               was never extracted from the server page.
  // Left in tree as TODOs; skipped until someone reworks them.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/app/__tests__/recipe-api.test.js$',
    '/app/__tests__/protected-pages.test.jsx$',
  ],
  // next/jest handles most module resolution; this only adds the rare
  // bare-identifier import style some of our own modules use.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

module.exports = createJestConfig(config);
