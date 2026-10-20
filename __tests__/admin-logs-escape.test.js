/**
 * 관리자 활동 로그(admin/logs.html)의 저장형 XSS (작업자 포털 1주차 후속 A).
 *
 * log.description 에는 트리거가 상담 신청자 이름·제목, 승급 신청 이메일을 이어 붙인다
 * (database/stability-triggers.sql handle_new_consultation 등). 게다가 정책 "System can insert logs"
 * (WITH CHECK (true)) 가 남아 있는 동안은 anon 키로 아무 칸이나 넣을 수 있었다.
 * 예전 renderLogItem 은 설명·유형·대상·이메일·IP·바뀐 값을 innerHTML 에 그대로 넣었다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', 'admin/logs.html'), 'utf8')
  .split('\r\n')
  .join('\n');
const SCRIPT = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n'));

const EVIL_DESC = '새 상담 신청: <img src=x onerror="window.__pwned=1"> - <b>제목</b>';
const EVIL_TYPE = '<svg onload="window.__pwned=2">';
const EVIL_TARGET = '<i>대상</i>';
const EVIL_EMAIL = '"><u>a</u>@example.test';
const EVIL_IP = '<s>127.0.0.1</s>';
const EVIL_OLD = { name: '<img src=x onerror="window.__pwned=3">' };
const EVIL_NEW = { title: '</span><em>새 값</em>' };

function query(result) {
  const q = {};
  for (const m of ['select', 'order', 'range', 'gte', 'lte', 'eq']) q[m] = () => q;
  q.then = (ok, ng) => Promise.resolve(result).then(ok, ng);
  return q;
}

function boot(logs) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  window.AdminAccess = { isAdmin: async () => true };
  const session = { user: { id: 'admin-id', email: 'admin@example.test', user_metadata: {} } };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }) },
      from: () => query({ data: logs, error: null, count: logs.length }),
    }),
  };
  (0, eval)(SCRIPT);
}

describe('admin/logs.html 활동 로그', () => {
  beforeEach(() => {
    delete window.__pwned;
  });

  test('설명·유형·대상·이메일·IP·바뀐 값의 태그는 글자로만 나온다', async () => {
    boot([
      {
        action_type: EVIL_TYPE,
        target_type: EVIL_TARGET,
        description: EVIL_DESC,
        admin_email: EVIL_EMAIL,
        ip_address: EVIL_IP,
        old_value: EVIL_OLD,
        new_value: EVIL_NEW,
        created_at: '2026-10-20T00:00:00Z',
      },
    ]);
    await window.initAdmin();
    const list = document.getElementById('logList');
    expect(list.querySelectorAll('.log-item')).toHaveLength(1);
    expect(list.querySelector('img, svg, b, i, u, s, em, script')).toBeNull();
    expect(list.querySelector('[onerror], [onload]')).toBeNull();
    expect(list.querySelector('.log-action').textContent).toBe(EVIL_TYPE);
    expect(list.querySelector('.log-badge').textContent).toBe(EVIL_TARGET);
    expect(list.querySelector('.log-description').textContent).toBe(EVIL_DESC);
    expect(list.querySelector('.log-meta').textContent).toContain(EVIL_EMAIL);
    expect(list.querySelector('.log-meta').textContent).toContain(EVIL_IP);
    expect(list.querySelector('.log-changes .old').textContent).toBe(JSON.stringify(EVIL_OLD));
    expect(list.querySelector('.log-changes .new').textContent).toBe(JSON.stringify(EVIL_NEW));
    expect(window.__pwned).toBeUndefined();
  });

  test('보통 로그는 그대로 보인다', async () => {
    boot([
      {
        action_type: 'tier_change',
        target_type: 'user',
        description: '회원 등급 변경: test@example.test',
        admin_email: 'admin@example.test',
        old_value: { tier: 'standard' },
        new_value: { tier: 'expert' },
        created_at: '2026-10-20T00:00:00Z',
      },
    ]);
    await window.initAdmin();
    const item = document.querySelector('#logList .log-item');
    expect(item.querySelector('.log-icon').className).toBe('log-icon tier');
    expect(item.querySelector('.log-action').textContent).toBe('등급 변경');
    expect(item.querySelector('.log-description').textContent).toBe(
      '회원 등급 변경: test@example.test'
    );
    expect(item.querySelector('.log-changes .old').textContent).toBe('{"tier":"standard"}');
    expect(item.querySelector('.log-changes .new').textContent).toBe('{"tier":"expert"}');
    expect(document.getElementById('totalCount').textContent).toBe('전체 1건');
  });
});
