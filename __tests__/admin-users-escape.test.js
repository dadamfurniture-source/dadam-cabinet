/**
 * 관리자 회원 목록(admin/users.html)의 저장형 XSS (worker-portal.plan.md 개정 #20, contract §5).
 *
 * 이름·이메일·지역은 가입한 사람이 직접 적는다. 예전 renderUsers 는 그 글을 innerHTML 에 그대로 넣어
 * 관리자가 회원 목록을 여는 순간 남이 심은 스크립트가 관리자 세션으로 돌았다.
 * 페이지 스크립트를 jsdom 에 올려 renderUsers 를 직접 부른다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', 'admin/users.html'), 'utf8')
  .split('\r\n')
  .join('\n');
const SCRIPT = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n'));

const EVIL_NAME = '<img src=x onerror="window.__pwned=1">';
const EVIL_EMAIL = '"><svg onload="window.__pwned=2">@example.test';
const UID = '11111111-1111-4111-8111-111111111111';

function boot() {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  window.supabase = {
    createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
  };
  (0, eval)(SCRIPT);
}

describe('admin/users.html renderUsers', () => {
  beforeEach(() => {
    delete window.__pwned;
    boot();
  });

  test('이름·이메일·지역·가입 경로의 태그는 글자로만 나온다', () => {
    window.renderUsers([
      {
        id: UID,
        name: EVIL_NAME,
        email: EVIL_EMAIL,
        sido: '<b>시</b>',
        gugun: '<i>구</i>',
        tier: 'standard"><u>t</u>',
        provider: 'kakao"><s>p</s>',
        created_at: '2026-10-20T00:00:00Z',
      },
    ]);
    const tbody = document.getElementById('usersTableBody');
    expect(tbody.querySelector('img, svg, b, i, u, s, script')).toBeNull();
    expect(tbody.querySelector('[onerror], [onload]')).toBeNull();
    expect(tbody.textContent).toContain(EVIL_NAME);
    expect(tbody.textContent).toContain(EVIL_EMAIL);
    expect(tbody.textContent).toContain('<b>시</b> <i>구</i>');
    expect(window.__pwned).toBeUndefined();
  });

  test('이름 첫 글자(아바타)도 이스케이프한다', () => {
    window.renderUsers([{ id: UID, name: '<x', email: 'a@example.test', created_at: null }]);
    const avatar = document.querySelector('#usersTableBody .user-avatar');
    expect(avatar.textContent).toBe('<');
    expect(avatar.children).toHaveLength(0);
  });

  test('보통 이름은 그대로 보인다', () => {
    window.renderUsers([
      { id: UID, name: '테스트 사용자', email: 'test@example.test', created_at: null },
    ]);
    const row = document.querySelector('#usersTableBody tr');
    expect(row.querySelector('.user-details h4').textContent).toBe('테스트 사용자');
    expect(row.querySelector('.user-details span').textContent).toBe('test@example.test');
  });
});
