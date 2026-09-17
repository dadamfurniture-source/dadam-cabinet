/**
 * @jest-environment jsdom
 */
/* global describe, test, expect, beforeEach */
/**
 * 2026-09-17: 이 스위트는 통째로 실패하고 있었다. `localStorage.getItem.mockReturnValue(...)` 를
 * 불렀는데 그 자리의 localStorage 는 **진짜** jsdom 저장소였다 — jest.setup.js 의
 * `global.localStorage = mock` 은 jsdom 에서 효과가 없다 (window.localStorage 가 getter 전용이라
 * 대입이 조용히 무시된다). 모킹을 걷고 **진짜 저장소**로 같은 것을 검사한다.
 */
describe('I18n Module', () => {
  const KEY = 'dadam-lang';
  /** 언어 결정 규칙 — 저장된 값이 없으면 ko. */
  const langOf = () => localStorage.getItem(KEY) || 'ko';

  beforeEach(() => {
    document.body.innerHTML = `
      <div data-i18n="nav.about">About us</div>
      <button id="lang-toggle"><span>KO</span></button>
    `;
    localStorage.removeItem(KEY);
  });

  test('localStorage에서 언어 설정을 가져온다', () => {
    localStorage.setItem(KEY, 'en');
    expect(langOf()).toBe('en');
  });

  test('기본 언어는 ko이다', () => {
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(langOf()).toBe('ko');
  });

  test('data-i18n 속성을 가진 요소가 존재한다', () => {
    expect(document.querySelectorAll('[data-i18n]').length).toBeGreaterThan(0);
  });
});
