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
//
// 2026-09-17: 이 대입은 **node 환경 시험에서만** 듣는다. jsdom 환경(jest.config testEnvironment)은
//   window.localStorage 를 getter 전용으로 정의하므로 `global.localStorage = ...` 가 조용히 무시되고
//   시험은 **진짜** localStorage 를 쓴다. jsdom 시험에서 값을 꾸미려면
//   `jest.spyOn(window.localStorage, 'getItem')` 처럼 그 자리에서 씌워야 한다
//   (플래너 시험들은 하네스가 자기 저장소를 넘겨 이 문제를 비켜 간다).
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
