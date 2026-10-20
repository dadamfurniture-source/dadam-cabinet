/**
 * 관리자 대시보드 첫 화면(admin/index.html)의 저장형 XSS (worker-portal.plan.md 개정 #20 과 같은 종류).
 *
 * 「최근 가입 회원」은 profiles.name·email·tier 를, 「최근 활동」은 admin_logs.description 을 그린다.
 * name 은 가입할 때 적은 메타데이터(raw_user_meta_data->>'name')에서 오고, description 에는
 * 비로그인 상담 신청의 이름·제목이 트리거로 들어간다(database/stability-triggers.sql handle_new_consultation).
 * 예전엔 둘 다 innerHTML 에 그대로 넣어, 관리자가 대시보드를 열 때마다 남이 심은 스크립트가 관리자 세션으로 돌았다.
 * 페이지 스크립트를 jsdom 에 올리고 가짜 Supabase 로 initAdmin 을 끝까지 돌린다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', 'admin/index.html'), 'utf8')
  .split('\r\n')
  .join('\n');
const SCRIPT = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n'));

const EVIL_NAME = '<img src=x onerror="window.__pwned=1">';
const EVIL_EMAIL = '"><svg onload="window.__pwned=2">@example.test';
const EVIL_TIER = 'standard"><u>t</u>';
const EVIL_LOG = '새 상담 신청: <img src=x onerror="window.__pwned=3"> - <b>제목</b>';

/** 어떤 메서드를 이어 불러도 자기를 돌려주고, await 하면 정해 둔 결과를 내는 가짜 쿼리 */
function query(result) {
  const q = {};
  for (const m of ['select', 'order', 'limit', 'eq', 'single']) q[m] = () => q;
  q.then = (ok, ng) => Promise.resolve(result).then(ok, ng);
  return q;
}

function boot(tables) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  window.AdminAccess = { isAdmin: async () => true };
  const session = { user: { id: 'admin-id', email: 'admin@example.test', user_metadata: {} } };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }) },
      from: (t) => query(tables[t] || { data: [], error: null }),
    }),
  };
  (0, eval)(SCRIPT);
}

const ROWS = {
  profile_stats: {
    data: { total_users: 1, expert_users: 0, agent_users: 0, today_signups: 1 },
    error: null,
  },
  profiles: {
    data: [
      { name: EVIL_NAME, email: EVIL_EMAIL, tier: EVIL_TIER, created_at: '2026-10-20T00:00:00Z' },
    ],
    error: null,
  },
  admin_logs: {
    data: [
      {
        action_type: 'new_consultation',
        description: EVIL_LOG,
        created_at: '2026-10-20T00:00:00Z',
      },
    ],
    error: null,
  },
};

describe('admin/index.html 대시보드', () => {
  beforeEach(() => {
    delete window.__pwned;
  });

  test('최근 가입 회원: 이름·이메일·등급의 태그는 글자로만 나온다', async () => {
    boot(ROWS);
    await window.initAdmin();
    const tbody = document.getElementById('recentUsers');
    expect(tbody.querySelectorAll('tr')).toHaveLength(1);
    expect(tbody.querySelector('img, svg, u, script')).toBeNull();
    expect(tbody.querySelector('[onerror], [onload]')).toBeNull();
    expect(tbody.textContent).toContain(EVIL_NAME);
    expect(tbody.textContent).toContain(EVIL_EMAIL);
    // 등급 배지의 class 속성을 깨고 나오지 못한다
    expect(tbody.querySelectorAll('.badge')).toHaveLength(1);
    expect(window.__pwned).toBeUndefined();
  });

  test('최근 활동: 로그 설명의 태그는 글자로만 나온다', async () => {
    boot(ROWS);
    await window.initAdmin();
    const box = document.getElementById('recentActivity');
    expect(box.querySelector('img, b, script')).toBeNull();
    expect(box.querySelector('[onerror]')).toBeNull();
    expect(box.textContent).toContain(EVIL_LOG);
    expect(window.__pwned).toBeUndefined();
  });

  test('보통 회원은 그대로 보인다', async () => {
    boot({
      ...ROWS,
      profiles: {
        data: [
          {
            name: '테스트 사용자',
            email: 'test@example.test',
            tier: 'expert',
            created_at: '2026-10-20T00:00:00Z',
          },
        ],
        error: null,
      },
    });
    await window.initAdmin();
    const cells = document.querySelectorAll('#recentUsers tr td');
    expect(cells[0].textContent).toBe('테스트 사용자');
    expect(cells[1].textContent).toBe('test@example.test');
    const badge = cells[2].querySelector('.badge');
    expect(badge.className).toBe('badge expert');
    expect(badge.textContent).toBe('Expert');
  });
});
