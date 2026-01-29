// Jest 환경 설정
// DOM 테스트를 위한 전역 설정

// window.DADAM_CONFIG 모킹
global.DADAM_CONFIG = {
  supabase: {
    url: 'https://test.supabase.co',
    anonKey: 'test-anon-key',
  },
  app: {
    name: '다담가구',
    version: '1.0.0',
  },
};

// localStorage 모킹
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;

// console.error를 조용히
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
};
