/**
 * @jest-environment jsdom
 */

describe('Supabase Utils', () => {
  beforeEach(() => {
    // window.DADAM_CONFIG 설정
    window.DADAM_CONFIG = {
      supabase: {
        url: 'https://test.supabase.co',
        anonKey: 'test-anon-key',
      },
    };
  });

  test('DADAM_CONFIG가 정의되어 있다', () => {
    expect(window.DADAM_CONFIG).toBeDefined();
    expect(window.DADAM_CONFIG.supabase).toBeDefined();
  });

  test('Supabase URL이 올바른 형식이다', () => {
    const url = window.DADAM_CONFIG.supabase.url;
    expect(url).toMatch(/^https:\/\/.+\.supabase\.co$/);
  });

  test('Supabase anon key가 존재한다', () => {
    const anonKey = window.DADAM_CONFIG.supabase.anonKey;
    expect(anonKey).toBeTruthy();
    expect(typeof anonKey).toBe('string');
  });
});
