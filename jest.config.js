/** Los módulos de dominio y de datos son TypeScript puro, sin React Native,
 *  así que se prueban directamente en Node: más rápido y sin preset nativo. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
};
