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
    // three 0.186+ 는 ESM 전용이다 — CommonJS 입구(three.cjs)가 Node 의 require(esm) 으로 ESM 빌드를 다시
    //   내보내는데 jest 모듈 로더는 그것을 못 한다. three 의 .js 만 CommonJS 로 트랜스파일해 싣는다.
    '[\\\\/]node_modules[\\\\/]three[\\\\/].+\\.js$': ['ts-jest', {
      tsconfig: { allowJs: true, module: 'commonjs', target: 'es2020', esModuleInterop: true },
      isolatedModules: true,
      diagnostics: false,
    }],
  },
  // node_modules 는 원래대로 변환하지 않는다 — three 만 예외
  transformIgnorePatterns: ['[\\\\/]node_modules[\\\\/](?!three[\\\\/])'],
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
