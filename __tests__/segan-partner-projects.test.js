/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「내 정보 › 업체」 안의 프로젝트 (segan/partner-projects.js + segan/me.html #partnerProjects)
 *
 *   누가    다담 공장 구성원 · Expert · Agent 협력업체 구성원 (account-api GET /partner/me)
 *           업체 없음 · /partner/me 를 못 읽음 → 묻지도 않고 칸이 없다. 서버 403 → 칸째 감춘다
 *   데이터  workflow-api GET /company/projects (본인 토큰) → { company, can_manage, items }
 *   만들기  can_manage 일 때 「새 고객 · 프로젝트」 → POST /company/projects
 *           { title, customer: { name, phone } } | { title, customer_id }, 보내기 전 서버와 같은 검사
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const CO = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222221';
const P2 = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333331';
const C2 = '33333333-3333-4333-8333-333333333332';

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const company = (extra = {}) => ({
  id: CO,
  name: '다담 협력 주방',
  plan: 'expert',
  next_plan: null,
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  role: 'owner',
  created_at: '2026-10-01T00:00:00Z',
  ...extra,
});
const partnerMe = (extra = {}) =>
  ok({ company: company(extra), application: null, members: [], invites: [] });

const projects = (extra = {}) => ({
  company: { id: CO, name: '다담 협력 주방', kind: 'partner', plan: 'expert' },
  can_manage: true,
  items: [
    {
      id: P2,
      title: '붙박이장',
      status: 'closed',
      created_at: '2026-10-20T16:00:00Z', // 한국 시간 10-21
      closed_at: '2026-10-25T00:00:00Z',
      customer: { id: C1, name: '김고객', phone: '010-1111-2222' },
      design_count: 2,
    },
    {
      id: P1,
      title: '싱크대',
      status: 'active',
      created_at: '2026-10-10T00:00:00Z',
      closed_at: null,
      customer: { id: C1, name: '김고객', phone: '010-1111-2222' },
      design_count: 0,
    },
    { id: 'not-a-uuid', title: '빼는 줄', status: 'active', customer: null, design_count: 0 },
  ],
  ...extra,
});

/**
 * me.html 을 올린다. opts.list() → GET /company/projects 응답, opts.create(body) → POST 응답 (Error 면 끊김)
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: partnerMe(),
    list: () => ok(projects()),
    create: () => ok({ project_id: P1, customer_id: C2 }, 201),
    workflowUrl: WORK,
    ...options,
  };
  window.history.replaceState(null, '', '/segan/me.html');
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerProjects',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: opts.workflowUrl },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async () => ({ data: [], error: null }),
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.fetch.push({
      url,
      method: init.method || 'GET',
      auth: (init.headers || {}).Authorization,
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/company/projects')
      return reply(await ((init.method || 'GET') === 'POST' ? opts.create(body) : opts.list()));
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/me/projects') return reply(fail(404, 'not_found', 'x'));
    return reply(ok({ ready: true, worker: null })); // /work/me
  });
  Element.prototype.scrollIntoView = jest.fn();
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/regions.js',
    'segan/partner.js',
    'segan/partner-projects.js',
    'segan/shell.js',
    'segan/make.js',
    'segan/me.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const box = () => $('partnerProjects');
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const projectCalls = (calls) => calls.fetch.filter((f) => f.url === WORK + '/company/projects');
// 줄마다 [이름, 고객 · 날 · 설계 수, 전화, 상태] 칸 글자 (없는 칸은 빠진다)
const rows = () =>
  [...box().querySelectorAll('[data-project]')].map((li) =>
    [...li.querySelectorAll('b, small, .me-pr-status')].map((el) => el.textContent).join(' | ')
  );
const setValue = (sel, v) => {
  const el = box().querySelector(sel);
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const pick = (value) => {
  const el = box().querySelector(`input[name="mode"][value="${value}"]`);
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const submit = async () => {
  box()
    .querySelector('form[data-form="project"]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
};

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 상담 설정 아래 · 회계 위, 처음엔 감춘다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('partnerProjects');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    const ids = [...el.parentElement.children].map((x) => x.id);
    const pos = (id) => ids.indexOf(id);
    expect(pos('partnerProjects')).toBeGreaterThan(pos('partnerConsultSettings'));
    expect(pos('partnerProjects')).toBeLessThan(pos('meBooks'));
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    expect(at('partner-projects.js')).toBeGreaterThan(at('partner.js'));
    expect(at('partner-projects.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'partner-projects.js')");
  });

  test('상태 이름 = segan/me.js PROJECT_STATUS, 한도 = 워커 company-projects.js', async () => {
    await load();
    const P = window.SeganPartnerProjects;
    expect(read('segan/me.js')).toContain(
      "var PROJECT_STATUS = { closed: '끝남', cancelled: '취소', handed_over: '넘김' };"
    );
    expect(P.PROJECT_STATUS).toEqual({ closed: '끝남', cancelled: '취소', handed_over: '넘김' });
    const worker = read('workers/workflow-api/src/company-projects.js');
    expect(worker).toContain(`PROJECT_TITLE_MAX = ${P.TITLE_MAX};`);
    expect(worker).toContain(`CUSTOMER_NAME_MAX = ${P.NAME_MAX};`);
    expect(worker).toContain(`PHONE_RE = ${String(P.PHONE_RE)};`);
  });
});

describe('누가 보나', () => {
  test('판정 — 다담 공장 구성원 · Expert · Agent 구성원만', async () => {
    await load();
    const { canSee } = window.SeganPartnerProjects;
    expect(canSee({ hq_member: true, company: null })).toBe(true);
    expect(canSee({ company: company() })).toBe(true);
    expect(canSee({ company: company({ plan: 'agent', role: 'staff' }) })).toBe(true);
    expect(canSee({ company: company({ plan: 'standard' }) })).toBe(false);
    expect(canSee({ company: company({ role: 'guest' }) })).toBe(false);
    expect(canSee({ company: null })).toBe(false);
    expect(canSee({ hq_member: 'yes' })).toBe(false);
    expect(canSee(null)).toBe(false);
  });

  test('업체 없음 · /partner/me 못 읽음 → 묻지 않고 칸이 없다', async () => {
    for (const partner of [ok({ company: null, application: null }), fail(500, 'x', 'x')]) {
      const calls = await load({ partner });
      await flush();
      expect(projectCalls(calls)).toHaveLength(0);
      expect(box().hidden).toBe(true);
    }
  });

  test('서버 403 · 끊김 · 모양이 틀림 → 칸째 감춘다', async () => {
    for (const list of [
      () => fail(403, 'not_project_company', 'x'),
      () => new Error('offline'),
      () => ok({ items: 'x' }),
    ]) {
      const calls = await load({ list });
      await flush();
      expect(projectCalls(calls)).toHaveLength(1);
      expect(box().hidden).toBe(true);
      expect(box().innerHTML).toBe('');
    }
  });

  test('다담 공장 구성원 — 업체 내용 없이 업체 칸을 연다', async () => {
    await load({ partner: ok({ hq_member: true, company: null }) });
    await flush();
    expect(box().hidden).toBe(false);
    expect($('partner').hidden).toBe(false);
  });
});

describe('목록', () => {
  test('최신 순 그대로, 이름 · 상태(진행 중은 안 적음) · 고객 · 만든 날(한국 시간) · 설계 수 · 전화 링크', async () => {
    const calls = await load();
    await flush();
    expect(projectCalls(calls)[0].auth).toBe('Bearer tok-1');
    expect(box().hidden).toBe(false);
    expect(box().querySelector('.me-pt-sub').textContent).toBe('프로젝트');
    expect(rows()).toEqual([
      '붙박이장 | 김고객 · 2026.10.21 · 설계 2개 | 010-1111-2222 | 끝남',
      '싱크대 | 김고객 · 2026.10.10 · 설계 0개 | 010-1111-2222',
    ]);
    expect(box().querySelector('a[href="tel:01011112222"]')).not.toBeNull();
  });

  test('비면 안내, 직원(can_manage 거짓)은 만들기 단추가 없다', async () => {
    await load({ list: () => ok(projects({ items: [], can_manage: false })) });
    await flush();
    expect(box().querySelector('.me-empty').textContent).toBe('아직 프로젝트가 없습니다.');
    expect(box().querySelector('[data-act="open"]')).toBeNull();
  });
});

describe('새 고객 · 프로젝트', () => {
  test('새 고객 — 이름 · 전화 · 프로젝트 이름을 보내고, 목록을 다시 읽어 알린다', async () => {
    let created = null;
    const calls = await load({
      create: (body) => {
        created = body;
        return ok({ project_id: P1, customer_id: C2 }, 201);
      },
    });
    await flush();
    box().querySelector('[data-act="open"]').click();
    setValue('input[name="title"]', '  거실장 ');
    setValue('input[name="name"]', ' 박고객 ');
    setValue('input[name="phone"]', '010-3333-4444');
    await submit();
    expect(created).toEqual({
      title: '거실장',
      customer: { name: '박고객', phone: '010-3333-4444' },
    });
    expect(projectCalls(calls).map((c) => c.method)).toEqual(['GET', 'POST', 'GET']);
    expect(box().querySelector('form[data-form="project"]')).toBeNull();
    expect(box().querySelector('.me-pt-msg').textContent).toBe('프로젝트를 만들었습니다.');
  });

  test('있는 고객 — 목록에 나온 고객을 한 번씩 고르게 하고 customer_id 로 보낸다', async () => {
    let created = null;
    await load({
      create: (body) => {
        created = body;
        return ok({ project_id: P1, customer_id: C1 }, 201);
      },
    });
    await flush();
    box().querySelector('[data-act="open"]').click();
    setValue('input[name="title"]', '두 번째');
    pick('existing');
    expect(box().querySelector('input[name="title"]').value).toBe('두 번째');
    const options = [...box().querySelectorAll('select[name="customer_id"] option')].map(
      (o) => o.value
    );
    expect(options).toEqual(['', C1]);
    await submit();
    expect(created).toBeNull();
    expect(box().querySelector('[data-err]').textContent).toBe('고객을 골라 주세요.');
    setValue('select[name="customer_id"]', C1);
    await submit();
    expect(created).toEqual({ title: '두 번째', customer_id: C1 });
  });

  test('보내기 전 검사 — 이름 · 프로젝트 이름 · 전화, 못 보내면 적은 값이 남는다', async () => {
    const calls = await load();
    await flush();
    box().querySelector('[data-act="open"]').click();
    await submit();
    expect(box().querySelector('[data-err]').textContent).toBe('프로젝트 이름을 적어 주세요.');
    setValue('input[name="title"]', '거실장');
    await submit();
    expect(box().querySelector('[data-err]').textContent).toBe('고객 이름을 적어 주세요.');
    expect(box().querySelector('input[name="title"]').value).toBe('거실장');
    setValue('input[name="name"]', '박고객');
    setValue('input[name="phone"]', '전화번호');
    await submit();
    expect(box().querySelector('[data-err]').textContent).toBe(
      '전화는 숫자와 - 로 8~20자로 적어 주세요.'
    );
    expect(projectCalls(calls).filter((c) => c.method === 'POST')).toHaveLength(0);
    const { bodyOf } = window.SeganPartnerProjects;
    expect(bodyOf({ title: 'x'.repeat(101), mode: 'new', name: '고객' }).error).toBe(
      '프로젝트 이름은 100자까지 적을 수 있습니다.'
    );
    expect(bodyOf({ title: 'x', mode: 'new', name: '가'.repeat(51) }).error).toBe(
      '고객 이름은 50자까지 적을 수 있습니다.'
    );
    expect(bodyOf({ title: 'x', mode: 'new', name: '고객', phone: '' }).body).toEqual({
      title: 'x',
      customer: { name: '고객', phone: null },
    });
  });

  test('서버가 못 만들면 서버 글을 그 자리에 · 칸은 열어 둔다', async () => {
    await load({ create: () => fail(403, 'not_manager', '업체 대표 · 실장만 할 수 있습니다') });
    await flush();
    box().querySelector('[data-act="open"]').click();
    setValue('input[name="title"]', '거실장');
    setValue('input[name="name"]', '박고객');
    await submit();
    expect(box().querySelector('[data-err]').textContent).toBe('업체 대표 · 실장만 할 수 있습니다');
    expect(box().querySelector('input[name="name"]').value).toBe('박고객');
    box().querySelector('[data-act="close"]').click();
    expect(box().querySelector('form[data-form="project"]')).toBeNull();
  });
});
