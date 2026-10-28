/**
 * 관리자 「업체 신청」(admin/expert-requests.html — 주소는 예전 Expert 승급 관리 그대로).
 *
 *   신청 목록 · 미팅 잡기 · 승인 · 보류, 협력업체 목록 · 업체로 만들기 — 모두 계정 서버(account-api /admin/partner/*)
 *   를 관리자 JWT 로 부른다. 신청 · 업체 쓰기는 service_role 만 할 수 있어 화면이 DB 에 직접 쓰지 않는다.
 *   업체로 만들기의 회원 찾기만 profiles 를 이메일로 읽는다.
 *   미팅 시각: datetime-local(브라우저 = 한국 시간) → new Date(v).toISOString().
 *   확인은 페이지 안 창으로 한다. 신청자가 적은 글(업체 이름 · 대표자 · 소개 …)은 글자로만 그린다.
 *
 * 대시보드(admin/index.html)의 「업체 신청 대기」 = partner_applications 의 applied + meeting 건수,
 * 관리자 메뉴 글자 = 「업체 신청」 도 여기서 본다.
 * 페이지 스크립트를 jsdom 에 올리고 가짜 Supabase · 가짜 fetch 로 돌린다 (admin-consult-accept.test.js 와 같은 방식).
 */
const fs = require('fs');
const path = require('path');

const read = (rel) =>
  fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .split('\r\n')
    .join('\n');

const HTML = read('admin/expert-requests.html');
const SCRIPT = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n'));

const API = 'https://account.test';
const TOKEN = 'admin-access-token';
const ID = '22222222-2222-4222-8222-222222222222';

const APP = {
  id: ID,
  user_id: '33333333-3333-4333-8333-333333333333',
  company_id: null,
  kind: 'new',
  plan: 'agent',
  status: 'applied',
  company_name: '다온 인테리어',
  representative_name: '김대표',
  contact_phone: '010-1234-5678',
  sido: '대구광역시',
  gugun: '북구',
  business_number: '123-45-67890',
  intro: '주방 · 붙박이장 시공',
  meeting_at: null,
  decided_by: null,
  decided_at: null,
  used_at: null,
  created_at: '2026-10-27T01:00:00Z',
  email: 'owner@example.test',
};

const COMPANY = {
  id: '44444444-4444-4444-8444-444444444444',
  name: '다온 인테리어',
  plan: 'expert',
  next_plan: 'agent',
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  created_at: '2026-10-20T00:00:00Z',
  owner_email: 'owner@example.test',
  member_count: 3,
  subscription: { status: 'active', next_charge_at: '2026-11-20T00:00:00Z', amount_krw: 99000 },
};

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function defaultRoute(c) {
  if (c.method === 'GET' && c.path === '/admin/partner/applications')
    return json(200, { success: true, data: [APP] });
  if (c.method === 'GET' && c.path === '/admin/partner/companies')
    return json(200, { success: true, data: [COMPANY] });
  if (c.method === 'POST') return json(200, { success: true, data: { application: {} } });
  return json(404, { success: false, code: 'not_found', error: '찾을 수 없습니다.' });
}

/** 어떤 메서드를 이어 불러도 자기를 돌려주고, await 하면 정해 둔 결과를 내는 가짜 쿼리. 부른 차례를 남긴다. */
function query(result, calls) {
  const q = {};
  for (const m of ['select', 'order', 'limit', 'eq', 'in', 'update', 'single', 'maybeSingle']) {
    q[m] = (...args) => {
      calls.push([m, ...args]);
      return q;
    };
  }
  q.then = (ok, ng) => Promise.resolve(result).then(ok, ng);
  return q;
}

/**
 * 페이지 스크립트를 올린다.
 *   route(call) — 가짜 서버. undefined 를 돌려주면 defaultRoute.
 *   profiles — 업체로 만들기의 회원 찾기 결과
 * 돌려주는 calls 에는 fetch 마다 { method, path, search, headers, body }, db 에는 from() 마다 { table, calls }.
 */
function boot({
  route,
  profiles = { data: [], error: null },
  accountUrl = API,
  admin = true,
} = {}) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = {
    supabase: { url: 'https://sb.test', anonKey: 'k' },
    accountApi: { url: accountUrl },
  };
  window.AdminAccess = { isAdmin: async () => admin };
  const session = {
    access_token: TOKEN,
    user: { id: 'admin-id', email: 'admin@example.test', user_metadata: {} },
  };
  const calls = [];
  const db = [];
  window.fetch = jest.fn(async (url, init = {}) => {
    const u = new URL(url);
    const c = {
      url,
      method: init.method || 'GET',
      path: u.pathname,
      search: u.search,
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(c);
    return (route && route(c)) || defaultRoute(c);
  });
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }) },
      from: (table) => {
        const entry = { table, calls: [] };
        db.push(entry);
        return query(table === 'profiles' ? profiles : { data: [], error: null }, entry.calls);
      },
    }),
  };
  (0, eval)(SCRIPT);
  return { calls, db };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = (id) => document.getElementById(id);
const gets = (calls, p) => calls.filter((c) => c.method === 'GET' && c.path === p);
const posts = (calls) => calls.filter((c) => c.method === 'POST');

describe('admin/expert-requests.html — 업체 신청', () => {
  beforeEach(() => {
    delete window.__pwned;
  });

  test('관리자가 아니면 접근 거부 — 계정 서버를 부르지 않는다', async () => {
    const { calls } = boot({ admin: false });
    await window.initAdmin();
    expect($('accessDenied').style.display).toBe('block');
    expect($('pageContent').style.display).toBe('none');
    expect(calls).toHaveLength(0);
  });

  test('열린 신청(applied,meeting)과 협력업체를 관리자 JWT 로 읽는다', async () => {
    const { calls, db } = boot();
    await window.initAdmin();
    const [apps] = gets(calls, '/admin/partner/applications');
    expect(apps.url).toBe(`${API}/admin/partner/applications?status=applied,meeting`);
    expect(apps.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const [companies] = gets(calls, '/admin/partner/companies');
    expect(companies.url).toBe(`${API}/admin/partner/companies`);
    expect(companies.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    // 신청 · 업체 표는 화면이 직접 읽거나 쓰지 않는다
    expect(db.map((e) => e.table)).not.toEqual(expect.arrayContaining(['partner_applications']));
    expect(db.map((e) => e.table)).not.toEqual(expect.arrayContaining(['expert_requests']));
  });

  test('신청 카드 — 업체 이름 · 대표자 · 연락처 · 지역 · 사업자번호 · 소개 · 이메일 · 신청일 · 종류', async () => {
    boot({
      route: (c) =>
        c.path === '/admin/partner/applications'
          ? json(200, {
              success: true,
              data: [
                APP,
                {
                  ...APP,
                  id: 'x2',
                  kind: 'upgrade',
                  company_id: COMPANY.id,
                  status: 'meeting',
                  meeting_at: '2026-11-03T05:30:00Z',
                },
              ],
            })
          : undefined,
    });
    await window.initAdmin();
    const cards = document.querySelectorAll('#requestList .request-card');
    expect(cards).toHaveLength(2);
    const t = cards[0].textContent;
    for (const s of [
      '다온 인테리어',
      '김대표',
      '010-1234-5678',
      '대구광역시 북구',
      '123-45-67890',
      '주방 · 붙박이장 시공',
      'owner@example.test',
      '새 업체',
      '신청 접수',
    ])
      expect(t).toContain(s);
    // 신청일 · 미팅은 한국 시간 (UTC 01:00 → 10:00, 05:30 → 14:30)
    expect(t).toMatch(/2026\. 10\. 27\. 오전 10:00/);
    expect(cards[1].textContent).toContain('Expert→Agent');
    expect(cards[1].textContent).toContain('미팅 예정');
    expect(cards[1].textContent).toMatch(/2026\. 11\. 03\. 오후 02:30/);
  });

  test('신청자가 적은 글은 모두 글자로만 나오고, status 로 배지 class 를 깨지 못한다', async () => {
    const evil = {
      ...APP,
      company_name: '<img src=x onerror="window.__pwned=1">',
      representative_name: '<b>대표</b>',
      contact_phone: '"><svg onload="window.__pwned=2">',
      intro: '<script>window.__pwned=3</script>',
      email: '<i>e</i>@example.test',
      sido: '<u>시</u>',
      status: 'x" onmouseover="window.__pwned=4',
    };
    boot({
      route: (c) =>
        c.path === '/admin/partner/applications'
          ? json(200, { success: true, data: [evil] })
          : undefined,
    });
    await window.initAdmin();
    const list = $('requestList');
    expect(list.querySelector('img, svg, script, b, i, u')).toBeNull();
    expect(list.querySelector('[onerror], [onload], [onmouseover], [onclick]')).toBeNull();
    for (const s of [
      evil.company_name,
      evil.representative_name,
      evil.contact_phone,
      evil.intro,
      evil.email,
    ])
      expect(list.textContent).toContain(s);
    const status = list.querySelectorAll('.badge')[1];
    expect(status.className).toBe('badge other');
    expect(status.textContent).toBe(evil.status);
    // 모르는 상태에는 단추를 두지 않는다
    expect(list.querySelectorAll('button[data-act]')).toHaveLength(0);
    expect(window.__pwned).toBeUndefined();
  });

  test('열린 신청(접수 · 미팅)에만 미팅 · 승인 · 보류 단추 — 미팅 예정이면 「미팅 바꾸기」', async () => {
    const rows = ['applied', 'meeting', 'approved', 'held', 'withdrawn'].map((s, i) => ({
      ...APP,
      id: `id-${i}`,
      status: s,
    }));
    boot({
      route: (c) =>
        c.path === '/admin/partner/applications'
          ? json(200, { success: true, data: rows })
          : undefined,
    });
    await window.initAdmin();
    const cards = [...document.querySelectorAll('#requestList .request-card')];
    const acts = cards.map((card) =>
      [...card.querySelectorAll('button[data-act]')].map((b) => b.dataset.act)
    );
    expect(acts).toEqual([
      ['meeting', 'approve', 'hold'],
      ['meeting', 'approve', 'hold'],
      [],
      [],
      [],
    ]);
    expect(cards[0].querySelector('[data-act="meeting"]').textContent).toBe('미팅 잡기');
    expect(cards[1].querySelector('[data-act="meeting"]').textContent).toBe('미팅 바꾸기');
    // 승인된 새 업체 — 결제 전이면 그렇게 보인다
    expect(cards[2].textContent).toContain('결제 전');
  });

  test('상태 거름 — 바꾸면 그 값으로 다시 읽고, 「전체」는 status 없이', async () => {
    const { calls } = boot();
    await window.initAdmin();
    const sel = $('statusFilter');
    sel.value = 'held';
    sel.dispatchEvent(new Event('change'));
    await flush();
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    await flush();
    expect(gets(calls, '/admin/partner/applications').map((c) => c.search)).toEqual([
      '?status=applied,meeting',
      '?status=held',
      '',
    ]);
  });

  test('미팅 잡기 — datetime-local 값을 new Date(v).toISOString() 으로 보낸다', async () => {
    const { calls } = boot();
    await window.initAdmin();
    document.querySelector('#requestList [data-act="meeting"]').click();
    expect($('meetingModal').classList.contains('active')).toBe(true);
    expect($('meetingTarget').textContent).toContain('다온 인테리어');
    $('meetingAt').value = '2026-11-03T14:30';
    $('meetingSubmit').click();
    await flush();
    const [p] = posts(calls);
    expect(p.url).toBe(`${API}/admin/partner/applications/${ID}`);
    expect(p.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(p.headers['Content-Type']).toBe('application/json');
    expect(p.body).toEqual({
      action: 'meeting',
      meeting_at: new Date('2026-11-03T14:30').toISOString(),
    });
    expect($('meetingModal').classList.contains('active')).toBe(false);
    expect($('statusLine').className).toBe('status-line ok');
    // 목록을 새로 읽는다
    expect(gets(calls, '/admin/partner/applications')).toHaveLength(2);
  });

  test('미팅 바꾸기 — 이미 잡힌 시각을 칸에 채워 연다', async () => {
    const at = new Date(2026, 10, 3, 14, 30); // 브라우저 시간 2026-11-03 14:30
    boot({
      route: (c) =>
        c.path === '/admin/partner/applications'
          ? json(200, {
              success: true,
              data: [{ ...APP, status: 'meeting', meeting_at: at.toISOString() }],
            })
          : undefined,
    });
    await window.initAdmin();
    document.querySelector('#requestList [data-act="meeting"]').click();
    expect($('meetingAt').value).toBe('2026-11-03T14:30');
  });

  test('미팅 날짜가 비어 있으면 보내지 않는다', async () => {
    const { calls } = boot();
    await window.initAdmin();
    document.querySelector('#requestList [data-act="meeting"]').click();
    $('meetingSubmit').click();
    await flush();
    expect(posts(calls)).toHaveLength(0);
    expect($('meetingError').textContent).toBe('미팅 날짜와 시각을 골라 주세요.');
    expect($('meetingModal').classList.contains('active')).toBe(true);
  });

  test('승인 — 페이지 안 확인 창을 거쳐 approve, 신청 · 업체 목록을 새로 읽는다', async () => {
    const { calls } = boot();
    await window.initAdmin();
    document.querySelector('#requestList [data-act="approve"]').click();
    expect($('decideModal').classList.contains('active')).toBe(true);
    expect($('decideTitle').textContent).toBe('신청 승인');
    expect($('decideText').textContent).toContain(
      '카드를 등록하고 첫 달을 결제할 때 Agent 업체가 시작됩니다'
    );
    expect(posts(calls)).toHaveLength(0); // 확인 전에는 보내지 않는다
    $('decideSubmit').click();
    await flush();
    const [p] = posts(calls);
    expect(p.path).toBe(`/admin/partner/applications/${ID}`);
    expect(p.body).toEqual({ action: 'approve' });
    expect($('decideModal').classList.contains('active')).toBe(false);
    expect($('statusLine').textContent).toBe('승인했습니다.');
    expect(gets(calls, '/admin/partner/applications')).toHaveLength(2);
    expect(gets(calls, '/admin/partner/companies')).toHaveLength(2);
  });

  test('Expert→Agent 승인 확인 글 — 다음 결제일부터 Agent', async () => {
    boot({
      route: (c) =>
        c.path === '/admin/partner/applications'
          ? json(200, {
              success: true,
              data: [{ ...APP, kind: 'upgrade', company_id: COMPANY.id }],
            })
          : undefined,
    });
    await window.initAdmin();
    document.querySelector('#requestList [data-act="approve"]').click();
    expect($('decideText').textContent).toContain('다음 결제일부터 Agent 금액 · 크레딧이 됩니다');
  });

  test('보류 — hold, 취소를 누르면 보내지 않는다', async () => {
    const { calls } = boot();
    await window.initAdmin();
    document.querySelector('#requestList [data-act="hold"]').click();
    expect($('decideTitle').textContent).toBe('신청 보류');
    document.querySelector('#decideModal .btn-secondary[data-close]').click();
    expect($('decideModal').classList.contains('active')).toBe(false);
    expect(posts(calls)).toHaveLength(0);
    document.querySelector('#requestList [data-act="hold"]').click();
    $('decideSubmit').click();
    await flush();
    expect(posts(calls).map((c) => c.body)).toEqual([{ action: 'hold' }]);
    expect($('statusLine').textContent).toBe('보류했습니다.');
  });

  test('서버가 409 invalid_transition 이면 창에 서버 문장을 보이고 닫지 않는다', async () => {
    boot({
      route: (c) =>
        c.method === 'POST'
          ? json(409, {
              success: false,
              code: 'invalid_transition',
              error: '이미 처리된 신청입니다.',
            })
          : undefined,
    });
    await window.initAdmin();
    document.querySelector('#requestList [data-act="approve"]').click();
    $('decideSubmit').click();
    await flush();
    expect($('decideError').textContent).toBe('이미 처리된 신청입니다.');
    expect($('decideModal').classList.contains('active')).toBe(true);
    expect($('decideSubmit').disabled).toBe(false);
  });

  test('id 에 따옴표가 있어도 data-id 에 글자 그대로, 주소에는 인코딩되어 실린다', async () => {
    const evilId = "x');window.__pwned=7;('/../y";
    const { calls } = boot({
      route: (c) =>
        c.path === '/admin/partner/applications'
          ? json(200, { success: true, data: [{ ...APP, id: evilId }] })
          : undefined,
    });
    await window.initAdmin();
    const buttons = document.querySelectorAll('#requestList button[data-act]');
    expect(buttons).toHaveLength(3);
    buttons.forEach((b) => expect(b.dataset.id).toBe(evilId));
    document.querySelector('#requestList [data-act="hold"]').click();
    $('decideSubmit').click();
    await flush();
    expect(posts(calls)[0].url).toBe(
      `${API}/admin/partner/applications/${encodeURIComponent(evilId)}`
    );
    expect(window.__pwned).toBeUndefined();
  });

  test('계정 서버 주소가 없으면 목록 자리에 안내한다', async () => {
    const { calls } = boot({ accountUrl: '' });
    await window.initAdmin();
    expect($('requestList').textContent).toContain(
      '계정 서버(accountApi.url)가 설정되지 않았습니다.'
    );
    expect(calls).toHaveLength(0);
  });
});

describe('admin/expert-requests.html — 협력업체 · 업체로 만들기', () => {
  test('협력업체 목록 — 등급 · 다음 결제일 등급 · 상태 · 지역 · 대표 이메일 · 구성원 · 구독', async () => {
    boot({
      route: (c) =>
        c.path === '/admin/partner/companies'
          ? json(200, {
              success: true,
              data: [
                COMPANY,
                {
                  ...COMPANY,
                  id: 'c2',
                  name: '<b>둘째</b>',
                  plan: 'agent',
                  next_plan: null,
                  status: 'suspended',
                  subscription: null,
                },
              ],
            })
          : undefined,
    });
    await window.initAdmin();
    const rows = document.querySelectorAll('#companyList tr');
    expect(rows).toHaveLength(2);
    const t = rows[0].textContent;
    for (const s of [
      '다온 인테리어',
      'Expert',
      '다음 결제일부터 Agent',
      '이용 중',
      '대구광역시 북구',
      'owner@example.test',
      '3',
      '99,000원',
    ])
      expect(t).toContain(s);
    const t2 = rows[1].textContent;
    expect(t2).toContain('<b>둘째</b>');
    expect(t2).toContain('Agent');
    expect(t2).not.toContain('다음 결제일부터');
    expect(t2).toContain('정지 (결제 멈춤)');
    expect(rows[1].querySelectorAll('td')[6].textContent).toBe('없음');
    expect(document.querySelector('#companyList b')).toBeNull();
  });

  test('이메일로 회원을 찾아(profiles) 업체 이름 · 등급 · 지역을 보낸다', async () => {
    const member = {
      id: '55555555-5555-4555-8555-555555555555',
      name: '박대표',
      email: 'owner@example.test',
      tier: 'agent',
      company_name: '박가구',
      sido: '경상북도',
      gugun: '포항시',
    };
    const { calls, db } = boot({ profiles: { data: [member], error: null } });
    await window.initAdmin();
    $('createCompanyBtn').click();
    expect($('companyModal').classList.contains('active')).toBe(true);
    expect($('cmSubmit').disabled).toBe(true);
    $('cmEmail').value = '  Owner@Example.TEST ';
    $('cmFind').click();
    await flush();
    const lookup = db.find((e) => e.table === 'profiles');
    expect(lookup.calls).toEqual(expect.arrayContaining([['eq', 'email', 'owner@example.test']]));
    expect($('cmFound').hidden).toBe(false);
    expect($('cmFound').textContent).toContain('박대표');
    // 비어 있는 칸은 회원 정보로 채운다 · 등급은 지금 등급
    expect($('cmName').value).toBe('박가구');
    expect($('cmSido').value).toBe('경상북도');
    expect($('cmGugun').value).toBe('포항시');
    expect($('cmPlan').value).toBe('agent');
    $('cmName').value = '  박가구 인테리어 ';
    $('cmSubmit').click();
    await flush();
    const [p] = posts(calls);
    expect(p.url).toBe(`${API}/admin/partner/companies`);
    expect(p.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(p.body).toEqual({
      user_id: member.id,
      name: '박가구 인테리어',
      plan: 'agent',
      sido: '경상북도',
      gugun: '포항시',
    });
    expect($('companyModal').classList.contains('active')).toBe(false);
    expect($('statusLine').textContent).toBe('박가구 인테리어 업체를 만들었습니다.');
    expect(gets(calls, '/admin/partner/companies')).toHaveLength(2);
  });

  test('회원이 없으면 보내지 않는다', async () => {
    const { calls } = boot({ profiles: { data: [], error: null } });
    await window.initAdmin();
    $('createCompanyBtn').click();
    $('cmEmail').value = 'nobody@example.test';
    $('cmFind').click();
    await flush();
    expect($('companyError').textContent).toBe('그 이메일의 회원이 없습니다.');
    expect($('cmSubmit').disabled).toBe(true);
    $('cmSubmit').disabled = false; // 억지로 눌러도
    $('cmSubmit').click();
    await flush();
    expect(posts(calls)).toHaveLength(0);
  });

  test('지역이 비면 보내지 않고, 409 already_member 는 창에 서버 문장을 보인다', async () => {
    const member = { id: 'm1', name: '', email: 'a@example.test', tier: 'standard' };
    const { calls } = boot({
      profiles: { data: [member], error: null },
      route: (c) =>
        c.method === 'POST'
          ? json(409, { success: false, code: 'already_member', error: '이미 업체 구성원입니다.' })
          : undefined,
    });
    await window.initAdmin();
    $('createCompanyBtn').click();
    $('cmEmail').value = 'a@example.test';
    $('cmFind').click();
    await flush();
    expect($('cmPlan').value).toBe('expert');
    $('cmName').value = '새 업체';
    $('cmSubmit').click();
    await flush();
    expect(posts(calls)).toHaveLength(0);
    expect($('companyError').textContent).toBe('지역(시·도, 시·군·구)을 넣어 주세요.');
    $('cmSido').value = '서울특별시';
    $('cmGugun').value = '강남구';
    $('cmSubmit').click();
    await flush();
    expect(posts(calls)).toHaveLength(1);
    expect($('companyError').textContent).toBe('이미 업체 구성원입니다.');
    expect($('companyModal').classList.contains('active')).toBe(true);
  });
});

describe('admin/index.html — 업체 신청 대기 건수', () => {
  const INDEX = read('admin/index.html');

  test('partner_applications 의 applied + meeting 건수를 센다 (expert_requests 는 읽지 않는다)', async () => {
    const script = INDEX.match(/<script>\n([\s\S]*?)<\/script>/)[1];
    document.body.innerHTML = INDEX.slice(INDEX.indexOf('<body>') + 6, INDEX.indexOf('<script>\n'));
    window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
    window.AdminAccess = { isAdmin: async () => true };
    const session = { user: { id: 'admin-id', email: 'admin@example.test', user_metadata: {} } };
    const db = [];
    window.supabase = {
      createClient: () => ({
        auth: { getSession: async () => ({ data: { session } }) },
        from: (table) => {
          const entry = { table, calls: [] };
          db.push(entry);
          const res =
            table === 'partner_applications'
              ? { data: [{ id: 'a' }, { id: 'b' }], error: null }
              : table === 'companies'
                ? { data: { id: 'hq' }, error: null }
                : { data: [], error: null };
          return query(res, entry.calls);
        },
      }),
    };
    (0, eval)(script);
    await window.initAdmin();
    const pa = db.filter((e) => e.table === 'partner_applications');
    expect(pa).toHaveLength(1);
    expect(pa[0].calls).toEqual(expect.arrayContaining([['in', 'status', ['applied', 'meeting']]]));
    expect(db.some((e) => e.table === 'expert_requests')).toBe(false);
    expect($('pendingExpertCount').textContent).toBe('대기 중 2건');
    expect($('pendingUpgrades').textContent).toBe('업체 신청 대기 2건');
    expect($('pendingItems').textContent).toBe('2');
    expect(document.querySelector('a[href="expert-requests.html"] h4').textContent).toBe(
      '업체 신청 검토'
    );
  });
});

describe('관리자 메뉴 — 「업체 신청」', () => {
  test('expert-requests.html 메뉴 글자는 「업체 신청」', () => {
    document.body.innerHTML = '<ul class="nav-menu" id="adminNav"></ul>';
    window.history.replaceState(null, '', '/admin/expert-requests.html');
    (0, eval)(read('js/admin-shell.js'));
    const a = document.querySelector('#adminNav a.active');
    expect(a.getAttribute('href')).toBe('expert-requests.html');
    expect(a.textContent).toBe('⭐업체 신청');
  });
});
