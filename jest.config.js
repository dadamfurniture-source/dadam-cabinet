/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  moduleFileExtensions: ['js', 'ts', 'tsx', 'json'],
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  // 자체 테스트 러너·의존성을 가진 하위 패키지는 루트 jest에서 제외
  // planner-vite: vitest / mcp-server: 전용 워크플로우(mcp-server-ci.yml) / workers: Cloudflare Workers
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/planner-vite/',
    '<rootDir>/mcp-server/',
    '<rootDir>/workers/',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { useESM: true }],
  },
  collectCoverageFrom: [
    'js/**/*.js',
    'lib/**/*.ts',
    '!**/node_modules/**',
    '!**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

module.exports = config;
