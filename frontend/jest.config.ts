export default {
  preset: 'jest-puppeteer',
  transform: { '^.+\\.tsx?$': 'ts-jest' },
  testMatch: ['**/tests/e2e/**/*.test.ts'],
  testTimeout: 30000,
}
