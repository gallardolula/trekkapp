/** The domain and data modules are plain TypeScript with no React Native, so
 *  they run directly in Node: faster, and with no native preset. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
};
