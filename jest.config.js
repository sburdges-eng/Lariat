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
  testPathIgnorePatterns: ['/node_modules/'],
  // next/jest handles most module resolution; this only adds the rare
  // bare-identifier import style some of our own modules use.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

module.exports = createJestConfig(config);
