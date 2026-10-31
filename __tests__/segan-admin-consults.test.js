/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 「관리 › 상담 배정」 (segan/admin-consults.js + segan/admin.html#consults)
 *
 *   들어오기  오늘 할 일 「배정을 기다리는 상담」 = #consults, 「업체 답을 기다리는 배정」 = #consults-assigned
 *   서버      workflow-api GET /admin/consult-inbox?state= · GET /admin/consultations/:id/candidates ·
 *             POST /admin/consultations/:id/assign { company_id }
 *   화면      대기 · 답 기다림 탭 → 상담 줄 → 누르면 고객 칸 · 지금 배정 · 거친 업체 · 순위 · 걸러진 업체 ·
 *             「이 업체에 배정」(되묻기는 화면 안에서). 이름표 · 점수 묶음은 PC admin/consult-distribution.html 과 같다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'admin-1', email: 'admin@example.com' } };
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const C1 = 'c1111111-1111-4111-8111-111111111111';
const C2 = 'c2222222-2222-4222-8222-222222222222';
const CO_A = 'a1111111-1111-4111-8111-111111111111';
const CO_F = 'a2222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-11-01T03:00:00Z');

const ok = (data) => ({ ok: true, status: 200, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const consult = (id, extra = {}) => ({
  id,
  name: '김고객',
  phone: '010-1111-2222',
  sido: '대구광역시',
  gugun: '북구',
  furniture_categories: ['sink', 'wardrobe'],
  door_finish: 'pet',
  demolition_needed: true,
  wanted_price_tier: 'mid',
  preferred_date: '2026-11-10',
  preferred_time: '09:00-12:00',
  wanted_done_date: '2026-12-20',
  request_detail_design: true,
  quote_total: 5200000,
  has_generation: true,
  created_at: '2026-10-31T15:30:00Z', // 한국 시간 11-01
  status: 'pending',
  assignment: null,
  tried: [],
  ...extra,
});
const cand = (rank, company_id, company_name, kind, total) => ({
  rank,
  company_id,
  company_name,
  kind,
  total,
  score: {
    eval: { sum: 30, grade: 16, grade_letter: 'B', satisfaction: 8, rework: 3, response: 3 },
    fit: { sum: 27.5, item: 7.5, price: 5, timing: 5, design: 10 },
    location: { sum: 15, why: 'same_gugun' },
    other: { sum: 7, spread: 5, capacity: 2 },
  },
});

/** admin.html# 를 올린다 */
async function load(options = {}) {
  const opts = {
    hash: '#consults',
    inbox: (state) =>
      state === 'pending'
        ? ok({
            items: [
              consult(C1),
              consult(C2, {
                name: '이고객',
                tried: [{ company_name: '다라 가구', state: 'declined' }],
              }),
            ],
          })
        : ok({
            items: [
              consult(C1, {
                status: 'assigned',
                assignment: {
                  id: 'as1',
                  company_id: CO_A,
                  company_name: '가나 인테리어',
                  state: 'assigned',
                  assigned_at: '2026-11-01T01:00:00Z',
                  expires_at: '2026-11-02T01:00:00Z',
                },
              }),
            ],
          }),
    candidates: () =>
      ok({
        items: [
          cand(1, CO_A, '가나 인테리어', 'partner', 79.5),
          cand(2, CO_F, '다담 공장', 'hq', 70),
        ],
        filtered: [{ company_name: '멈춘 가구', reasons: ['inactive', 'docs'] }],
      }),
    assign: () => ok({ assignment: { id: 'as9' } }),
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/admin.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/admin.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'SeganShell',
    'SeganAdmin',
    'SeganAdminApplications',
    'SeganAdminConsults',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: SESSION } }) },
      rpc: async (name) => ({ data: name === 'is_admin', error: null }),
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.fetch.push({ url, method, body, auth: (init.headers || {}).Authorization });
    let r;
    const u = new URL(url);
    if (u.pathname === '/admin/consult-inbox') r = await opts.inbox(u.searchParams.get('state'));
    else if (/\/admin\/consultations\/[^/]+\/candidates$/.test(u.pathname))
      r = await opts.candidates();
    else if (/\/admin\/consultations\/[^/]+\/assign$/.test(u.pathname) && method === 'POST')
      r = await opts.assign(decodeURIComponent(u.pathname.split('/')[3]), body);
    else if (url === WORK + '/reports/summary') r = ok({ pendingProposals: 0 });
    else if (url.startsWith(ACC)) r = ok([]);
    else r = fail(404, 'x', 'Not found');
    if (r instanceof Error) throw r;
    return { ok: r.ok, status: r.status, json: async () => r.body };
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/shell.js',
    'segan/admin-applications.js',
    'segan/admin-consults.js',
    'segan/admin.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganAdmin.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const body = () => $('adConsultsBody');
const item = (id) => document.querySelector(`[data-consult="${id}"]`);
const act = async (sel) => {
  body().querySelector(sel).click();
  await flush();
};
const pick = (id) => act(`[data-consult="${id}"] [data-act="pick"]`);
const inboxCalls = (calls) => calls.fetch.filter((f) => f.url.includes('/admin/consult-inbox'));

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('들어오기 · 목록', () => {
  test('오늘 할 일 줄 — 대기는 #consults, 답 기다림은 #consults-assigned', async () => {
    await load({ hash: '' });
    const href = (k) => document.querySelector(`[data-today="${k}"] a`).getAttribute('href');
    expect(href('pending')).toBe('#consults');
    expect(href('assigned')).toBe('#consults-assigned');
  });

  test('#consults — 대기 탭, 상담 줄(이름 · 지역 · 품목 · 신청일 · 거친 업체 · 상태)', async () => {
    const calls = await load();
    expect($('adConsults').hidden).toBe(false);
    expect($('adToday').hidden).toBe(true);
    expect(inboxCalls(calls).map((f) => new URL(f.url).searchParams.get('state'))).toEqual([
      'pending',
    ]);
    expect(inboxCalls(calls)[0].auth).toBe('Bearer tok-1');
    const tab = body().querySelector('[data-act="tab"][aria-selected="true"]');
    expect(tab.textContent).toBe('대기');
    const line = (id) => item(id).querySelector('small').textContent;
    expect(line(C1)).toBe('대구광역시 북구 · 싱크대 · 붙박이장 · 2026.11.01');
    expect(line(C2)).toBe('대구광역시 북구 · 싱크대 · 붙박이장 · 2026.11.01 · 거친 업체 1');
    expect(item(C1).querySelector('.ad-status').textContent).toBe('대기');
    expect(document.querySelector('#adConsults .ad-more a').getAttribute('href')).toBe(
      '../admin/consult-distribution.html'
    );
  });

  test('#consults-assigned — 답 기다림 탭, 업체 이름 · 남은 시간 · 상태 「배정됨」', async () => {
    await load({ hash: '#consults-assigned' });
    expect(body().querySelector('[aria-selected="true"]').textContent).toBe('답 기다림');
    expect(item(C1).querySelector('small').textContent).toContain('가나 인테리어 22시간 0분 남음');
    expect(item(C1).querySelector('.ad-status').textContent).toBe('배정됨');
  });

  test('탭을 바꾸면 그 상태로 다시 읽는다, 비면 안내, 못 읽으면 한 줄', async () => {
    const calls = await load({
      inbox: (s) => (s === 'pending' ? ok({ items: [] }) : fail(500, 'x', 'x')),
    });
    expect(body().textContent).toContain('기다리는 상담이 없습니다.');
    await act('[data-act="tab"][data-tab="assigned"]');
    expect(inboxCalls(calls).map((f) => new URL(f.url).searchParams.get('state'))).toEqual([
      'pending',
      'assigned',
    ]);
    expect(body().textContent).toContain('상담을 불러오지 못했습니다.');
  });
});

describe('상담 열기', () => {
  test('누르면 그 자리에 고객 칸 · 지금 배정 · 거친 업체 · 순위(점수 내역) · 걸러진 업체', async () => {
    await load();
    await pick(C2);
    const facts = [...item(C2).querySelectorAll('.me-facts div')].map((d) => [
      d.querySelector('dt').textContent,
      d.querySelector('dd').textContent,
    ]);
    expect(facts).toEqual([
      ['전화', '010-1111-2222'],
      ['지역', '대구광역시 북구'],
      ['품목', '싱크대 · 붙박이장'],
      ['도어 마감', 'PET'],
      ['철거', '필요'],
      ['가격대', '중급'],
      ['희망 시기', '2026-12-20 시공 완료'],
      ['희망 상담', '2026-11-10 오전'],
      ['상세 설계', '요청함'],
      ['예상 견적', '5,200,000원'],
      ['연출컷', '있음'],
      ['신청일', '2026.11.01'],
    ]);
    expect(item(C2).querySelector('a[href="tel:01011112222"]')).not.toBeNull();
    expect(item(C2).querySelector('[data-assign-now]').textContent).toBe('지금 배정 없음');
    expect(item(C2).querySelector('[data-tried]').textContent).toBe(
      '거친 업체 — 다라 가구 못 받음'
    );
    const cands = [...item(C2).querySelectorAll('.ad-cand')];
    expect(cands.map((c) => c.querySelector('.ad-cand-head').textContent)).toEqual([
      '1순위 가나 인테리어Agent · 79.5점',
      '2순위 다담 공장다담 공장 · 70점',
    ]);
    expect([...cands[0].querySelectorAll('.ad-score li')].map((l) => l.textContent)).toEqual([
      '본사 평가 30/40 (등급 B 16/16 · 고객 만족 8/12 · 재작업 3/6 · 응답 3/6)',
      '선택 적합도 27.5/35 (품목 실적 7.5/15 · 가격대 5/5 · 희망 시기 5/5 · 상세 설계 10/10)',
      '위치 15/15 (같은 시/군/구)',
      '기타 7/10 (일감 고르게 5/5 · 처리 여유 2/5)',
    ]);
    expect(item(C2).querySelector('.ad-filtered summary').textContent).toBe('걸러진 업체 1');
    expect(item(C2).querySelector('.ad-filtered li').textContent).toBe(
      '멈춘 가구 — 활동 안 함 · 서류 미확인'
    );
    // 다시 누르면 닫는다
    await pick(C2);
    expect(item(C2).querySelector('.ad-detail')).toBeNull();
  });

  test('답 기다림 상담은 배정 단추가 없고 까닭을 적는다, 남는 업체가 없으면 안내', async () => {
    await load({ hash: '#consults-assigned' });
    await pick(C1);
    expect(item(C1).querySelector('[data-assign-now]').textContent).toBe(
      '가나 인테리어 · 답 기다림 · 22시간 0분 남음 · 배정 2026.11.01 10:00'
    );
    expect(item(C1).querySelector('[data-act="assign"]')).toBeNull();
    expect(item(C1).textContent).toContain('답을 기다리는 배정이 있어 지금은 배정할 수 없습니다.');
    await load({ candidates: () => ok({ items: [], filtered: [] }) });
    await pick(C1);
    expect(item(C1).textContent).toContain('남는 업체 없음 — 고객에게 직접 연락해 주세요.');
  });
});

describe('배정', () => {
  test('「이 업체에 배정」 → 화면 안 되묻기 → 보내고 목록을 다시 읽어 알린다', async () => {
    let sent = null;
    const calls = await load({
      assign: (id, b) => {
        sent = [id, b];
        return ok({});
      },
    });
    await pick(C1);
    await act(`[data-consult="${C1}"] [data-company="${CO_A}"] [data-act="assign"]`);
    expect(item(C1).querySelector('.ad-panel .mk-note').textContent).toBe(
      '김고객 상담을 「가나 인테리어」에 배정할까요?'
    );
    expect(sent).toBeNull();
    await act('[data-act="assign-no"]');
    expect(item(C1).querySelector('.ad-panel')).toBeNull();
    await act(`[data-consult="${C1}"] [data-company="${CO_A}"] [data-act="assign"]`);
    await act('[data-act="assign-yes"]');
    expect(sent).toEqual([C1, { company_id: CO_A }]);
    expect(inboxCalls(calls)).toHaveLength(2);
    expect(body().querySelector('.me-pt-msg').textContent).toBe(
      '「가나 인테리어」에 배정했습니다. 업체가 24시간 안에 답합니다.'
    );
  });

  test('409 이미 배정 → 목록을 다시 읽고 알림, 422 조건 안 맞음 → 순위를 다시 읽고 알림, 그 밖 → 서버 글', async () => {
    let reply = fail(409, 'open_assignment', 'x');
    const calls = await load({ assign: () => reply });
    const ask = async () => {
      await act(`[data-consult="${C1}"] [data-company="${CO_A}"] [data-act="assign"]`);
      await act('[data-act="assign-yes"]');
    };
    await pick(C1);
    await ask();
    expect(body().querySelector('.me-pt-msg').textContent).toBe(
      '이미 답을 기다리는 배정이 있습니다. 목록을 다시 불러왔습니다.'
    );
    expect(inboxCalls(calls)).toHaveLength(2);
    // 다시 읽어도 고른 상담은 열린 채다
    expect(item(C1).querySelector('.ad-detail')).not.toBeNull();
    reply = fail(422, 'not_eligible', 'x');
    await ask();
    expect(body().querySelector('.me-pt-msg').textContent).toBe(
      '「가나 인테리어」은 지금 배정 조건에 맞지 않습니다. 순위를 다시 불러왔습니다.'
    );
    reply = fail(500, 'boom', '서버가 바빠요');
    await ask();
    expect(item(C1).querySelector('[data-err]').textContent).toBe('서버가 바빠요');
  });
});

describe('이름 · 점수 묶음 = PC 상담 분배', () => {
  test('이름표 · 점수 묶음이 admin/consult-distribution.html 과 같다', async () => {
    await load();
    const pc = read('admin/consult-distribution.html');
    const A = window.SeganAdminConsults;
    for (const name of [
      'ITEM_LABEL',
      'TIME_LABEL',
      'DOOR_FINISH_LABEL',
      'PRICE_TIER_LABEL',
      'STATUS_LABEL',
      'ASSIGN_STATE_LABEL',
      'KIND_LABEL',
      'LOCATION_WHY',
    ])
      for (const [k, v] of Object.entries(A[name]))
        expect(pc).toMatch(
          new RegExp(`['"]?${k.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}['"]?: '${v}'`)
        );
    for (const [k, v] of Object.entries(A.FILTER_REASON)) expect(pc).toContain(`${k}: ['${v}',`);
    for (const g of A.SCORE_GROUPS) {
      expect(pc).toContain(`key: '${g.key}'`);
      expect(pc).toContain(`label: '${g.label}'`);
      for (const [k, name, max] of g.parts) expect(pc).toContain(`['${k}', '${name}', ${max}]`);
    }
    expect(A.SCORE_GROUPS.reduce((s, g) => s + g.max, 0)).toBe(100);
  });
});
