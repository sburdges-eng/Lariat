// @ts-check
// Jest config for React component tests under app/__tests__/**.
//
// Uses next/jest to pick up:
//   - next.config.mjs + tsconfig paths
//   - SWC transform for JSX / TS / TSX
//   - CSS module + file mocks
//
// Server-side integration tests (tests/js/**) use node --test and are NOT
// run under jest. Jest's testMatch is scoped to app/__tests__/** only.

// next/jest's `.default` is identical to its module.exports (dual CJS/ESM
// export: module.exports === module.exports.default), so `.default` is a
// zero-behavior-change reference that also satisfies checkJs (the bare
// module namespace has no call signatures).
const nextJest = require('next/jest.js').default;

const createJestConfig = nextJest({
  dir: './',
});

/** @type {import('jest').Config} */
const config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  testMatch: [
    '<rootDir>/app/__tests__/**/*.test.{js,jsx,ts,tsx}',
    // Colocated __tests__ dirs (e.g. app/recipes/__tests__/*.test.jsx)
    // so feature-area tests live next to the components they cover.
    '<rootDir>/app/**/__tests__/**/*.test.{js,jsx,ts,tsx}',
  ],
  testPathIgnorePatterns: ['/node_modules/'],
  // next/jest handles most module resolution; this only adds the rare
  // bare-identifier import style some of our own modules use.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

module.exports = createJestConfig(config);
