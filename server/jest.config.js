/** The server is tested with Jest, the same runner the app's domain core
 *  uses, so the repository does not carry two testing tools. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  // The integration tests share one database, so they must not run in parallel.
  maxWorkers: 1,
  // jose ships only as ESM. Jest loads this suite as CommonJS, so the
  // package is transformed along with the project's own sources instead of
  // being skipped as node_modules usually is.
  transformIgnorePatterns: ['/node_modules/(?!(jose|cookie)/)'],
  transform: {
    '^.+\\.(ts|js)$': [
      'ts-jest',
      { tsconfig: { module: 'commonjs', strict: true, esModuleInterop: true, types: ['jest', 'node'] } },
    ],
  },
};
