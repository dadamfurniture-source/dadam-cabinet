/**
 * 관리자 Expert 승급 관리(admin/expert-requests.html)의 저장형 XSS (작업자 포털 1주차 후속 A).
 *
 * expert_requests 는 회원이 직접 insert 하는 행이라 이름·이메일·회사·업종·사업자번호·포트폴리오 주소,
 * 그리고 status·admin_memo 까지 신청자가 정할 수 있다. 예전 renderRequestCard 는 그 글을 innerHTML 에
 * 그대로 넣고, 포트폴리오는 <a href="${req.portfolio_url}">, 단추는 onclick="…('${req.id}')" 였다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', 'admin/expert-requests.html'), 'utf8')
  .split('\r\n')
  .join('\n');
const SCRIPT = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n'));

const ID = '22222222-2222-4222-8222-222222222222';
const EVIL_NAME = '<img src=x onerror="window.__pwned=1">';
const EVIL_EMAIL = '"><svg onload="window.__pwned=2">@example.test';
const EVIL_COMPANY = '<b>회사</b>';
const EVIL_MEMO = '<script>window.__pwned=3</script>';
const EVIL_URL = 'javascript:window.__pwned=4';

function query(result, calls) {
  const q = {};
  for (const m of ['select', 'order', 'eq', 'update']) {
    q[m] = (...args) => {
      if (calls) calls.push([m, ...args]);
      return q;
    };
  }
  q.then = (ok, ng) => Promise.resolve(result).then(ok, ng);
  return q;
}

function boot(rows, calls) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  window.AdminAccess = { isAdmin: async () => true };
  const session = { user: { id: 'admin-id', email: 'admin@example.test', user_metadata: {} } };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }) },
      from: () => query({ data: rows, error: null }, calls),
    }),
  };
  (0, eval)(SCRIPT);
}

const EVIL_ROW = {
  id: ID,
  user_name: EVIL_NAME,
  user_email: EVIL_EMAIL,
  requested_tier: '<i>expert</i>',
  company_name: EVIL_COMPANY,
  business_type: '<u>업종</u>',
  business_number: '<s>000-00-00000</s>',
  career_years: 3,
  portfolio_url: EVIL_URL,
  admin_memo: EVIL_MEMO,
  status: 'pending',
  created_at: '2026-10-20T00:00:00Z',
};

describe('admin/expert-requests.html 승급 신청 카드', () => {
  beforeEach(() => {
    delete window.__pwned;
  });

  test('신청자가 적은 글은 모두 글자로만 나온다', async () => {
    boot([EVIL_ROW]);
    await window.initAdmin();
    const list = document.getElementById('requestList');
    expect(list.querySelectorAll('.request-card')).toHaveLength(1);
    expect(list.querySelector('img, svg, script, b, i, u, s')).toBeNull();
    expect(list.querySelector('[onerror], [onload]')).toBeNull();
    for (const t of [
      EVIL_NAME,
      EVIL_EMAIL,
      EVIL_COMPANY,
      EVIL_MEMO,
      '<i>expert</i>',
      '<u>업종</u>',
    ]) {
      expect(list.textContent).toContain(t);
    }
    expect(list.querySelector('.user-avatar').textContent).toBe('<');
    expect(window.__pwned).toBeUndefined();
  });

  test('javascript: 포트폴리오 주소는 링크가 되지 않고 글자로만 보인다', async () => {
    boot([EVIL_ROW]);
    await window.initAdmin();
    const list = document.getElementById('requestList');
    expect(list.querySelector('a')).toBeNull();
    expect(list.textContent).toContain(EVIL_URL);
  });

  test('따옴표로 href 를 깨고 나오지 못하고, http(s) 주소는 새 창 링크가 된다', async () => {
    const url = 'https://portfolio.example.test/a?b="><img src=x onerror="window.__pwned=5">';
    boot([{ ...EVIL_ROW, portfolio_url: url }]);
    await window.initAdmin();
    const links = document.querySelectorAll('#requestList a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(url);
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(document.querySelector('#requestList img, #requestList [onerror]')).toBeNull();
  });

  test('status 로 배지 class 속성을 깨고 나오지 못한다', async () => {
    boot([{ ...EVIL_ROW, status: 'x" onmouseover="window.__pwned=6' }]);
    await window.initAdmin();
    const list = document.getElementById('requestList');
    expect(list.querySelector('[onmouseover]')).toBeNull();
    expect(list.querySelectorAll('.badge')).toHaveLength(1);
    expect(list.querySelector('.badge').textContent).toBe('x" onmouseover="window.__pwned=6');
  });

  test('단추에 인라인 onclick 이 없고, 승인은 data-id 의 id 로 update 한다', async () => {
    const calls = [];
    boot([EVIL_ROW], calls);
    await window.initAdmin();
    const list = document.getElementById('requestList');
    expect(list.querySelectorAll('[onclick]')).toHaveLength(0);
    list.querySelector('button[data-act="approve"]').click();
    expect(document.getElementById('reviewModal').classList.contains('active')).toBe(true);
    expect(document.getElementById('modalTitle').textContent).toBe('Expert 승급 승인');
    window.alert = () => {};
    await window.submitReview('approved');
    const upd = calls.findIndex((c) => c[0] === 'update');
    expect(calls[upd][1].status).toBe('approved');
    expect(calls[upd + 1]).toEqual(['eq', 'id', ID]);
  });

  test('id 에 따옴표가 있어도 data-id 에 글자 그대로 실릴 뿐 실행되지 않는다', async () => {
    const evilId = "x');window.__pwned=7;('";
    boot([{ ...EVIL_ROW, id: evilId }]);
    await window.initAdmin();
    const buttons = document.querySelectorAll('#requestList button[data-act]');
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect(b.dataset.id).toBe(evilId));
    expect(window.__pwned).toBeUndefined();
  });

  test('보통 신청은 그대로 보인다', async () => {
    boot([
      {
        id: ID,
        user_name: '테스트 업체',
        user_email: 'test@example.test',
        company_name: '테스트 인테리어',
        career_years: 5,
        portfolio_url: 'https://portfolio.example.test',
        status: 'approved',
        created_at: '2026-10-20T00:00:00Z',
      },
    ]);
    await window.initAdmin();
    const card = document.querySelector('#requestList .request-card');
    expect(card.querySelector('.user-details h4').textContent).toBe('테스트 업체');
    expect(card.querySelector('.user-details span').textContent).toBe('test@example.test');
    expect(card.querySelector('.badge').className).toBe('badge approved');
    expect(card.querySelector('.badge').textContent).toBe('승인됨');
    expect(card.textContent).toContain('5년');
    expect(card.querySelector('a').getAttribute('href')).toBe('https://portfolio.example.test');
    expect([...card.querySelectorAll('button[data-act]')].map((b) => b.dataset.act)).toEqual([
      'details',
    ]);
  });
});
