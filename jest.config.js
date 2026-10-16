module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // test/engine runs against DynamoDB Local: `npm run test:engine`.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/engine/'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testTimeout: 120000,
  silent: true,
};
