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

// localStorage 는 jsdom 이 제공하는 실제 구현을 그대로 쓴다.
// 예전엔 jest.fn() 목을 global 에 대입했지만, jsdom 은 localStorage 를 getter 전용
// 접근자로 정의하므로 그 대입은 조용히 무시됐다 — 목은 한 번도 걸린 적이 없다.
// 실제로 걸면 값을 저장하지 않아 planner-store · planner-save-toggle 이 깨진다.

// console.error를 조용히
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
};
