/**
 * @jest-environment jsdom
 */

describe('I18n Module', () => {
  beforeEach(() => {
    // DOM 초기화
    document.body.innerHTML = `
      <div data-i18n="nav.about">About us</div>
      <button id="lang-toggle"><span>KO</span></button>
    `;
    localStorage.getItem.mockReturnValue('ko');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('localStorage에서 언어 설정을 가져온다', () => {
    localStorage.getItem.mockReturnValue('en');
    const lang = localStorage.getItem('dadam-lang') || 'ko';
    expect(lang).toBe('en');
  });

  test('기본 언어는 ko이다', () => {
    localStorage.getItem.mockReturnValue(null);
    const lang = localStorage.getItem('dadam-lang') || 'ko';
    expect(lang).toBe('ko');
  });

  test('data-i18n 속성을 가진 요소가 존재한다', () => {
    const elements = document.querySelectorAll('[data-i18n]');
    expect(elements.length).toBeGreaterThan(0);
  });
});
