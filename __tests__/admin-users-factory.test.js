/**
 * 관리자 회원 관리(admin/users.html) — Manager 이상으로 저장하면 팩토리도 (2026-11-20 대표님 「매니저 등급도 플래너 이용할 수 있게」).
 *
 * 플래너 · 프로젝트는 사람 등급(profiles.tier)이 아니라 팩토리 등급(companies.plan)을 본다
 * (workers/workflow-api/src/planner-drafts.js plannerCompanyOf). 회원 관리에서 등급만 올리면 팩토리가 없어 플래너가 막혔다.
 * 이제 Manager 이상으로 저장할 때 대표인 팩토리가 없으면 「팩토리로 만들기」와 같은 길(account-api POST /admin/partner/companies)로
 * 같은 등급 팩토리를 만들고, 등급은 DB 트리거가 맞추게 둔다(tier · tier_source 를 쓰지 않는다).
 * 2026-11-21 대표님 「Manager 는 가구설계 영업 사원」 — Manager 는 칸 없이 등급만 저장하고, 그 회원이 앱을 열면
 * account-api GET /partner/me 가 「내 영업 공간」(Manager 업체)을 만든다. 칸은 Expert · Agent 만.
 * 페이지 스크립트를 jsdom 에 올리고 가짜 Supabase · 가짜 fetch 로 돌린다 (admin-users-escape.test.js 와 같은 방식).
 */
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', 'admin/users.html'), 'utf8')
  .split('\r\n')
  .join('\n');
const SCRIPT = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n'));

const API = 'https://account.test';
const UID = '11111111-1111-4111-8111-111111111111';
const USER = {
  id: UID,
  name: '김실장',
  email: 'Owner@Example.test',
  company_name: '작은가구',
  sido: '경기도',
  gugun: '수원시',
  tier: 'standard',
  created_at: '2026-11-01T00:00:00Z',
};
const FACTORY = {
  id: '44444444-4444-4444-8444-444444444444',
  name: '작은가구',
  plan: 'manager',
  next_plan: null,
  status: 'active',
  sido: '경기도',
  gugun: '수원시',
  owner_email: 'owner@example.test',
};

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = (id) => document.getElementById(id);

/** companies = 관리자 업체 목록, create = POST 응답 */
function boot({ companies = [], create = null } = {}) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = {
    supabase: { url: 'https://sb.test', anonKey: 'k' },
    accountApi: { url: API },
  };
  window.supabase = {
    createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
  };
  // 페이지의 let 값(supabaseClient · usersData …)은 같은 스크립트 안에서만 바꿀 수 있다 — 끝에 시험용 손잡이를 붙인다
  (0, eval)(
    SCRIPT +
      "\nwindow.__set = (c, u) => { supabaseClient = c; currentUser = { id: 'admin-id' }; usersData = u; };"
  );

  const calls = { fetch: [], updates: [] };
  window.__client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: (table) => ({
      update: (payload) => ({
        eq: async (col, val) => {
          calls.updates.push({ table, payload, col, val });
          return { error: null };
        },
      }),
    }),
  };
  global.fetch = jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const c = {
      url,
      method,
      body: init.body ? JSON.parse(init.body) : null,
      headers: init.headers,
    };
    calls.fetch.push(c);
    if (method === 'GET' && url === `${API}/admin/partner/companies`)
      return json(200, { success: true, data: companies });
    if (method === 'POST' && url === `${API}/admin/partner/companies`)
      return (
        create ||
        json(201, {
          success: true,
          data: { company: { ...FACTORY, ...c.body, user_id: undefined } },
        })
      );
    return json(404, { success: false, error: '없음' });
  });
  window.alert = jest.fn();
  window.loadBilling = async () => {};
  window.loadUsers = async () => {};
  window.__set(window.__client, window.__users);
  return calls;
}

beforeEach(() => {
  window.__users = [{ ...USER }];
});

async function open(opts, tier) {
  const calls = boot(opts);
  window.viewUser(UID);
  await flush();
  if (tier) {
    $('modalTier').value = tier;
    $('modalTier').dispatchEvent(new Event('change'));
  }
  return calls;
}

const posts = (calls) => calls.fetch.filter((c) => c.method === 'POST');

describe('admin/users.html — Manager 이상 저장 때 팩토리', () => {
  test('Standard 면 팩토리 칸을 감추고 팩토리를 만들지 않는다', async () => {
    const calls = await open({}, 'standard');
    expect($('modalFactory').hidden).toBe(true);
    await window.saveUserChanges();
    expect(posts(calls)).toEqual([]);
    expect(calls.updates[0].payload.tier).toBe('standard');
  });

  test('팩토리 없는 회원을 Expert 로 — 칸에 회원 정보를 채우고, 저장하면 같은 등급 팩토리를 만든 뒤 등급은 트리거에 맡긴다', async () => {
    const calls = await open({}, 'expert');
    expect($('modalFactory').hidden).toBe(false);
    expect($('modalFactoryForm').hidden).toBe(false);
    expect($('modalFactoryName').value).toBe('작은가구');
    expect($('modalFactorySido').value).toBe('경기도');
    expect($('modalFactoryGugun').value).toBe('수원시');
    await window.saveUserChanges();
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0]).toMatchObject({
      url: `${API}/admin/partner/companies`,
      body: { user_id: UID, name: '작은가구', plan: 'expert', sido: '경기도', gugun: '수원시' },
    });
    expect(posts(calls)[0].headers.Authorization).toBe('Bearer tok');
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].payload).not.toHaveProperty('tier');
    expect(calls.updates[0].payload).not.toHaveProperty('tier_source');
    expect(window.alert.mock.calls[0][0]).toContain('플래너');
  });

  test('팩토리 없는 회원을 Manager 로 — 칸 없이 「내 영업 공간」 안내, 등급만 저장 (앱을 열면 서버가 만든다, 2026-11-21)', async () => {
    const calls = await open({}, 'manager');
    expect($('modalFactory').hidden).toBe(false);
    expect($('modalFactoryForm').hidden).toBe(true);
    expect($('modalFactoryInfo').textContent).toContain('「내 영업 공간」');
    await window.saveUserChanges();
    expect(posts(calls)).toEqual([]);
    expect(calls.updates[0].payload).toMatchObject({ tier: 'manager', tier_source: 'manual' });
  });

  test('Expert · Agent 도 같은 등급으로 만든다', async () => {
    for (const tier of ['expert', 'agent']) {
      const calls = await open({}, tier);
      await window.saveUserChanges();
      expect(posts(calls)[0].body.plan).toBe(tier);
    }
  });

  test('이미 대표인 팩토리가 있으면 이름 · 팩토리 등급을 보이고 만들지 않는다 — 등급이 다르면 알린다', async () => {
    const calls = await open({ companies: [FACTORY] }, 'expert');
    expect($('modalFactoryForm').hidden).toBe(true);
    expect($('modalFactoryInfo').textContent).toContain('「작은가구」 대표 · 팩토리 등급 Manager');
    expect($('modalFactoryInfo').textContent).toContain('팩토리 등급(Manager)을 따릅니다');
    await window.saveUserChanges();
    expect(posts(calls)).toEqual([]);
    expect(calls.updates[0].payload).toMatchObject({ tier: 'expert', tier_source: 'manual' });
  });

  test('팩토리 칸이 비면 저장하지 않는다', async () => {
    window.__users = [{ ...USER, sido: null, gugun: null }];
    const calls = await open({}, 'expert');
    await window.saveUserChanges();
    expect(window.alert.mock.calls[0][0]).toContain('시·도');
    expect(posts(calls)).toEqual([]);
    expect(calls.updates).toEqual([]);
  });

  test('다른 팩토리(본사) 구성원이면(409 already_member) 등급만 저장하고 알린다', async () => {
    const calls = await open(
      { create: json(409, { success: false, code: 'already_member', error: '이미 구성원' }) },
      'expert'
    );
    await window.saveUserChanges();
    expect(calls.updates[0].payload).toMatchObject({ tier: 'expert', tier_source: 'manual' });
    expect(window.alert.mock.calls[0][0]).toContain('그 팩토리 등급을 따릅니다');
  });

  test('팩토리를 못 만들면(그 밖의 실패) 회원 정보도 바꾸지 않는다', async () => {
    const calls = await open(
      { create: json(422, { success: false, code: 'invalid', field: 'name', error: '이름' }) },
      'expert'
    );
    await window.saveUserChanges();
    expect(calls.updates).toEqual([]);
    expect(window.alert.mock.calls[0][0]).toContain('팩토리를 만들지 못했습니다');
  });

  test('다른 회원을 열면 팩토리 칸 입력을 비운다', async () => {
    window.__users = [
      { ...USER },
      {
        ...USER,
        id: 'u2',
        email: 'b@example.test',
        company_name: '',
        name: '박대표',
        sido: '',
        gugun: '',
      },
    ];
    await open({}, 'expert');
    expect($('modalFactoryName').value).toBe('작은가구');
    window.viewUser('u2');
    await flush();
    $('modalTier').value = 'expert';
    $('modalTier').dispatchEvent(new Event('change'));
    expect($('modalFactoryName').value).toBe('박대표');
    expect($('modalFactorySido').value).toBe('');
  });
});
