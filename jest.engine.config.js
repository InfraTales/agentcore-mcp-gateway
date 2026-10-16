// Runs against DynamoDB Local. Set AWS_ENDPOINT_URL_DYNAMODB first: `npm run test:engine`.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/engine'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testTimeout: 60000,
  silent: true,
};
