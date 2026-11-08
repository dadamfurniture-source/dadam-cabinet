/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Event */
/**
 * SEGAN 「관리 › 제작 의뢰」 (segan/admin-production.js + segan/admin.html#production)
 *
 *   들어오기  오늘 할 일 「추천할 제작 의뢰」 = #production (#production-waiting · -done = 그 탭)
 *   서버      workflow-api GET /admin/production-requests?state= · POST …/:id/review ·
 *             GET …/:id/suggestions · POST …/:id/recommend { company_ids[1~5], note?, notes? }
 *   화면      할 일 · 답 기다림 · 끝 탭 → 의뢰 줄 → 누르면 의뢰 내용 · 지금 추천 · 고른 기록(못 받음 사유 — 본사만) ·
 *             돌려보낸 팩토리 · 「추천 후보 보기」(접수면 검토 시작 먼저) → 순위 위 3곳을 미리 골라 둔다 · 1~5곳 ·
 *             소개 · Manager 에게 남길 말. 지역 · 품목으로 걸러진 팩토리는 이유를 적고 고를 수 있게 둔다
 * 업체 · 사람은 모두 지어낸 시험 값이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'admin-1', email: 'admin@example.com' } };
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const CO = '11111111-1111-4111-8111-111111111111';
const R1 = '22222222-2222-4222-8222-222222222221';
const R2 = '22222222-2222-4222-8222-222222222222';
const F = (n) => `33333333-3333-4333-8333-33333333333${n}`;
const P1 = '44444444-4444-4444-8444-444444444441';
const NOW = Date.parse('2026-11-09T03:00:00Z');

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
/** 본사 목록 한 줄 (워커 admin.js listRequestsAdmin) */
const item = (id, extra = {}) => ({
  id,
  status: 'submitted',
  label: '접수',
  created_at: '2026-11-08T01:00:00Z', // 한국 시간 11-08 10:00
  status_at: '2026-11-08T01:00:00Z',
  item: 'sink',
  item_label: '싱크대',
  draft: { id: 'd-kitchen-01', name: '김고객 주방', rev: 3, current_rev: 4, walls: 2, modules: 9 },
  design_id: null,
  project: { id: P1, title: '김고객 주방 리모델링' },
  note: '상판은 세라믹으로 생각합니다',
  sido: '대구광역시',
  gugun: '북구',
  region: '대구광역시 북구',
  wanted_done_date: '2026-12-20',
  round: 0,
  hq_note: null,
  manager: { company_id: CO, name: '가나 인테리어', region: '대구광역시 수성구', plan: 'manager' },
  factory: null,
  recommendations: [],
  offers: [],
  tried: [],
  can_review: true,
  can_recommend: true,
  ...extra,
});
const declined = (id) =>
  item(id, {
    status: 'declined',
    label: '팩토리가 못 받음',
    round: 1,
    hq_note: '대구 근처 두 곳입니다.',
    factory: { company_id: F(9), name: '마바 목공' },
    recommendations: [
      {
        company_id: F(9),
        name: '마바 목공',
        rank: 1,
        note: '빠릅니다',
        chosen: true,
        state: 'declined',
      },
      { company_id: F(1), name: '가나 공방', rank: 2, note: null, chosen: false, state: null },
    ],
    offers: [
      {
        round: 1,
        company_id: F(9),
        name: '마바 목공',
        state: 'declined',
        chosen_at: '2026-11-08T02:00:00Z',
        expires_at: '2026-11-09T02:00:00Z',
        responded_at: '2026-11-08T03:00:00Z',
        reason: '이번 달 일정이 꽉 찼습니다',
      },
    ],
    tried: [{ company_id: F(9), name: '마바 목공' }],
    can_review: false,
  });
const cand = (rank, n, name, kind, total) => ({
  company_id: F(n),
  company_name: name,
  kind,
  total,
  rank,
  region: '대구광역시 북구',
  score: {
    eval: { sum: 30, grade: 16, grade_letter: 'B', satisfaction: 8, rework: 3, response: 3 },
    fit: { sum: 27.5, item: 7.5, price: 2.5, timing: 5, design: 10 },
    location: { sum: 15, why: 'same_gugun' },
    other: { sum: 7, spread: 5, capacity: 2 },
  },
});
const suggestions = () =>
  ok({
    request: { id: R1, status: 'recommending', round: 0, item: 'sink', region: '대구광역시 북구' },
    default_count: 3,
    max: 5,
    can_recommend: true,
    items: [
      cand(1, 1, '가나 공방', 'partner', 82),
      cand(2, 2, '다라 가구', 'partner', 75),
      cand(3, 3, '다담 공장', 'hq', 70),
      cand(4, 4, '라마 목공', 'partner', 60),
      cand(5, 5, '바사 공방', 'partner', 55),
    ],
    filtered: [
      {
        company_id: F(6),
        company_name: '사아 가구',
        reasons: ['region', 'item'],
        region: '부산광역시 해운대구',
        can_recommend: true,
      },
      {
        company_id: F(7),
        company_name: '멈춘 가구',
        reasons: ['inactive'],
        region: '',
        can_recommend: false,
      },
      {
        company_id: F(9),
        company_name: '마바 목공',
        reasons: ['tried'],
        region: '대구광역시 북구',
        can_recommend: false,
      },
    ],
  });

/** admin.html# 를 올린다. list(state) · review(id) · suggestions(id) · recommend(body, id) */
async function load(options = {}) {
  const opts = {
    hash: '#production',
    list: (state) =>
      state === 'todo'
        ? ok({ ready: true, state, items: [item(R1), declined(R2)] })
        : ok({ ready: true, state, items: [] }),
    review: (id) => ok({ id, status: 'recommending' }),
    suggestions,
    recommend: (body, id) => ok({ id, status: 'recommended', round: 1 }, 201),
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
    'SeganAdminConsults',
    'SeganAdminProduction',
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
    const reply = (r) => ({ ok: r.ok, status: r.status, json: async () => r.body });
    const tail = url.startsWith(WORK) ? url.slice(WORK.length) : '';
    let m;
    if ((m = /^\/admin\/production-requests\?state=(\w+)$/.exec(tail)))
      return reply(await opts.list(m[1]));
    if ((m = /^\/admin\/production-requests\/([^/]+)\/review$/.exec(tail)))
      return reply(await opts.review(m[1]));
    if ((m = /^\/admin\/production-requests\/([^/]+)\/suggestions$/.exec(tail)))
      return reply(await opts.suggestions(m[1]));
    if ((m = /^\/admin\/production-requests\/([^/]+)\/recommend$/.exec(tail)))
      return reply(await opts.recommend(body, m[1]));
    if (tail === '/work/me') return reply(ok({ ready: true, worker: null }));
    return reply(fail(404, 'not_found', 'x'));
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/shell.js',
    'segan/admin-consults.js',
    'segan/admin-production.js',
    'segan/admin.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganAdmin.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('기다린 상태가 오지 않았다');
}
const body = () => $('adProductionBody');
const click = async (el) => {
  el.dispatchEvent(new Event('click', { bubbles: true }));
  await flush();
};
const button = (root, label) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label);
const boxes = () => [...body().querySelectorAll('input[name="pick"]')];
const toggle = async (n) => {
  const el = boxes().find((b) => b.value === F(n));
  el.checked = !el.checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
};
const submitBtn = () => body().querySelector('form[data-form="recommend"] button[type="submit"]');
const posts = (calls, re) => calls.fetch.filter((f) => f.method === 'POST' && re.test(f.url));

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 값', () => {
  test('admin.html — 상담 배정 다음 칸, 스크립트는 admin-consults.js 뒤 · admin.js 앞, 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/admin.html'), 'text/html');
    const sec = doc.getElementById('adProduction');
    expect(sec.hasAttribute('hidden')).toBe(true);
    expect(sec.previousElementSibling.id).toBe('adConsults');
    expect(sec.querySelector('h2').textContent).toBe('제작 의뢰');
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    expect(at('admin-production.js')).toBeGreaterThan(at('admin-consults.js'));
    expect(at('admin-production.js')).toBeLessThan(at('admin.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'admin-production.js')");
  });

  test('한도 · 기본 수 · 상태 이름 = 워커 production-requests/common.js · distribution/rules.js', async () => {
    await load();
    const A = window.SeganAdminProduction;
    const common = read('workers/workflow-api/src/production-requests/common.js');
    expect(common).toContain(`export const RECOMMEND_MAX = ${A.RECOMMEND_MAX};`);
    expect(common).toContain(`export const HQ_NOTE_MAX = ${A.HQ_NOTE_MAX};`);
    expect(common).toContain(`export const PROFILE_NOTE_MAX = ${A.PROFILE_NOTE_MAX};`);
    expect(common).toContain('export const RECOMMEND_DEFAULT = TOP_N;');
    expect(read('workers/workflow-api/src/distribution/rules.js')).toContain(
      `export const TOP_N = ${A.RECOMMEND_DEFAULT};`
    );
    for (const [k, v] of Object.entries(A.STATUS_LABEL))
      expect(common).toContain(`  ${k}: '${v}',`);
    // 거르기 이유 이름 = 상담 배정 화면과 같다
    const AC = window.SeganAdminConsults;
    for (const [k, v] of Object.entries(AC.FILTER_REASON)) expect(A.FILTER_REASON[k]).toBe(v);
    expect(read('workers/workflow-api/src/production-requests/admin.js')).toContain(
      "BLOCKING_REASONS = Object.freeze(['tier', 'inactive', 'tried']);"
    );
  });

  test('추천 본문 (순수) — 고른 차례 그대로 · 1~5곳 · 소개는 적은 것만 · 글자 수', async () => {
    await load();
    const A = window.SeganAdminProduction;
    expect(A.recommendBodyOf({ ids: [] }).error).toBe('1~5곳을 골라 주세요.');
    expect(A.recommendBodyOf({ ids: [F(1), F(2), F(3), F(4), F(5), F(6)] }).error).toBe(
      '1~5곳을 골라 주세요.'
    );
    expect(
      A.recommendBodyOf({ ids: [F(2), F(1)], note: '  ', notes: { [F(1)]: ' 빠름 ', [F(2)]: '' } })
    ).toEqual({
      body: { company_ids: [F(2), F(1)], notes: { [F(1)]: '빠름' } },
    });
    expect(A.recommendBodyOf({ ids: [F(1)], note: '가'.repeat(501) }).error).toBe(
      'Manager 에게 남길 말은 500자까지입니다.'
    );
    expect(A.recommendBodyOf({ ids: [F(1)], notes: { [F(1)]: '가'.repeat(201) } }).error).toBe(
      '소개는 200자까지입니다.'
    );
    expect(A.defaultPicks(A.suggestionsOf(suggestions().body))).toEqual([F(1), F(2), F(3)]);
    expect(A.listOf({ success: true, data: { ready: false, items: [] } })).toBe('pending');
  });
});

describe('목록 · 탭', () => {
  test('#production — 할 일 탭부터 본인 토큰으로, 줄 = 업체 · 품목 · 지역 · 의뢰일 · 차례 · 돌려보낸 수 · 상태', async () => {
    const calls = await load();
    expect($('adProduction').hidden).toBe(false);
    expect($('adToday').hidden).toBe(true);
    const lists = calls.fetch.filter((f) => f.url.startsWith(WORK + '/admin/production-requests?'));
    expect(lists.map((f) => [f.url, f.auth])).toEqual([
      [WORK + '/admin/production-requests?state=todo', 'Bearer tok-1'],
    ]);
    expect(
      [...body().querySelectorAll('[data-act="tab"]')].map((b) => [
        b.textContent,
        b.getAttribute('aria-selected'),
      ])
    ).toEqual([
      ['할 일', 'true'],
      ['답 기다림', 'false'],
      ['끝', 'false'],
    ]);
    const rows = [...body().querySelectorAll('[data-request]')];
    expect(rows.map((r) => r.querySelector('small').textContent)).toEqual([
      '싱크대 · 대구광역시 북구 · 2026.11.08',
      '싱크대 · 대구광역시 북구 · 2026.11.08 · 1차 추천 · 마바 목공 · 돌려보낸 팩토리 1',
    ]);
    expect(rows.map((r) => r.querySelector('.ad-status').textContent)).toEqual([
      '접수',
      '팩토리가 못 받음',
    ]);
    await click(button(body(), '답 기다림'));
    await until(() => body().textContent.includes('답을 기다리는 제작 의뢰가 없습니다.'));
    expect(
      calls.fetch.some((f) => f.url === WORK + '/admin/production-requests?state=waiting')
    ).toBe(true);
  });

  test('#production-done — 끝 탭부터, DB 0050 전(ready false)은 그 안내 한 줄', async () => {
    const calls = await load({
      hash: '#production-done',
      list: () => ok({ ready: false, state: 'done', items: [] }),
    });
    expect(calls.fetch.some((f) => f.url === WORK + '/admin/production-requests?state=done')).toBe(
      true
    );
    expect(body().textContent).toContain('제작 의뢰 DB(0050)를 적용한 뒤에 볼 수 있습니다.');
  });

  test('못 받은 의뢰를 펼치면 — 의뢰 내용 · 지금 추천 · 고른 기록(못 받음 사유는 본사만) · 돌려보낸 팩토리 · 「다시 추천」', async () => {
    await load();
    await click(body().querySelector(`[data-act="pick"][data-id="${R2}"]`));
    const d = body().querySelector('.ad-detail');
    expect(d.textContent).toContain('가나 인테리어 · 대구광역시 수성구 · Manager');
    expect(d.textContent).toContain('김고객 주방 · 벽 2 · 모듈 9 · 3차 저장 · 의뢰 뒤 고침');
    expect(d.textContent).toContain('대구 근처 두 곳입니다.');
    expect(d.querySelector('[data-recs]').textContent).toBe(
      '1. 마바 목공 · 고름 · 못 받음 · 소개: 빠릅니다2. 가나 공방'
    );
    expect(d.querySelector('[data-offers]').textContent).toBe(
      '1차 마바 목공 · 못 받음 · 고름 2026.11.08 11:00 · 답 2026.11.08 12:00 · 사유: 이번 달 일정이 꽉 찼습니다'
    );
    expect(d.querySelector('[data-tried]').textContent).toBe(
      '돌려보낸 팩토리 (다시 추천할 수 없음) — 마바 목공'
    );
    expect(button(d, '다시 추천')).toBeTruthy();
  });
});

describe('추천 — 검토 시작 · 후보 · 1~5곳', () => {
  const openSug = async (calls, id = R1, label = '검토 시작 · 추천 후보 보기') => {
    await click(body().querySelector(`[data-act="pick"][data-id="${id}"]`));
    await click(button(body(), label));
    await until(() => body().querySelector('form[data-form="recommend"]'));
    return calls;
  };

  test('접수 의뢰 — 검토 시작(POST review)을 먼저 보내고 후보를 읽는다, 순위 위 3곳을 골라 둔다', async () => {
    const calls = await openSug(await load());
    const seq = calls.fetch
      .filter((f) => f.url.includes(`/admin/production-requests/${R1}/`))
      .map((f) => [f.method, f.url.split('/').pop()]);
    expect(seq).toEqual([
      ['POST', 'review'],
      ['GET', 'suggestions'],
    ]);
    expect(body().querySelector(`[data-request="${R1}"] .ad-status`).textContent).toBe(
      '본사 검토 중'
    );
    expect(boxes().map((b) => [b.value, b.checked, b.disabled])).toEqual([
      [F(1), true, false],
      [F(2), true, false],
      [F(3), true, false],
      [F(4), false, false],
      [F(5), false, false],
      [F(6), false, false],
    ]);
    expect(submitBtn().textContent).toBe('3곳 추천');
    // 순위 줄 — 점수 내역은 상담 배정과 같은 묶음 글
    const first = body().querySelector(`.ad-cand[data-company="${F(1)}"]`);
    expect(first.querySelector('.ad-cand-head b').textContent).toBe('1순위 가나 공방 · 82점');
    expect(first.querySelector('.ad-score').textContent).toContain('본사 평가 30/40');
    // 지역 · 품목으로 걸러진 팩토리 — 이유를 적고 고를 수 있다 (막지 않는다)
    const soft = body().querySelector(`.ad-cand[data-company="${F(6)}"]`);
    expect(soft.querySelector('[data-hint]').textContent).toBe('확인 — 지역 밖 · 품목 안 함');
    // 활동 안 함 · 돌려보낸 곳은 고를 수 없다 — 이유만
    const blocked = body().querySelector('.ad-filtered');
    expect(blocked.querySelector('summary').textContent).toBe('추천할 수 없는 팩토리 2');
    expect([...blocked.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '멈춘 가구 — 활동 안 함',
      '마바 목공 — 거친 팩토리',
    ]);
    expect(blocked.querySelector('input')).toBeNull();
  });

  test('많아야 5곳 — 다섯을 고르면 나머지는 막힌다, 하나를 풀면 다시 열린다, 0곳이면 보내지 못한다', async () => {
    await openSug(await load());
    await toggle(4);
    await toggle(6);
    expect(submitBtn().textContent).toBe('5곳 추천');
    expect(boxes().find((b) => b.value === F(5)).disabled).toBe(true);
    await toggle(1);
    expect(submitBtn().textContent).toBe('4곳 추천');
    expect(boxes().find((b) => b.value === F(5)).disabled).toBe(false);
    for (const n of [2, 3, 4, 6]) await toggle(n);
    expect(submitBtn().textContent).toBe('0곳 추천');
    expect(submitBtn().disabled).toBe(true);
  });

  test('보내기 — 고른 차례 · 소개(적은 것만) · 남길 말, 다시 그려도 적던 글은 남는다, 보낸 뒤 목록을 다시 읽는다', async () => {
    const calls = await openSug(await load());
    body().querySelector(`[data-note-for="${F(1)}"]`).value = '세라믹 상판 경험이 많습니다';
    body().querySelector('textarea[name="hq_note"]').value = '대구 근처 세 곳입니다.';
    await toggle(6); // 다시 그린다 — 적던 글은 남는다
    expect(body().querySelector(`[data-note-for="${F(1)}"]`).value).toBe(
      '세라믹 상판 경험이 많습니다'
    );
    expect(body().querySelector('textarea[name="hq_note"]').value).toBe('대구 근처 세 곳입니다.');
    await toggle(2);
    const before = calls.fetch.filter(
      (f) => f.url === WORK + '/admin/production-requests?state=todo'
    ).length;
    body()
      .querySelector('form[data-form="recommend"]')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => body().textContent.includes('3곳을 추천했습니다.'));
    expect(posts(calls, /\/recommend$/).map((f) => [f.url, f.body])).toEqual([
      [
        WORK + `/admin/production-requests/${R1}/recommend`,
        {
          company_ids: [F(1), F(3), F(6)],
          note: '대구 근처 세 곳입니다.',
          notes: { [F(1)]: '세라믹 상판 경험이 많습니다' },
        },
      ],
    ]);
    expect(body().textContent).toContain('Manager 가 고르면 그 팩토리가 24시간 안에 답합니다.');
    expect(
      calls.fetch.filter((f) => f.url === WORK + '/admin/production-requests?state=todo').length
    ).toBe(before + 1);
    expect(body().querySelector('form[data-form="recommend"]')).toBeNull();
  });

  test('소개가 200자를 넘으면 보내지 않는다, 서버가 막으면(422) 서버 글을 그 자리에, 그사이 바뀌면(409) 다시 읽는다', async () => {
    let reply = fail(422, 'not_eligible', '추천할 수 없는 팩토리가 있습니다');
    const calls = await openSug(await load({ recommend: () => reply }));
    body().querySelector(`[data-note-for="${F(2)}"]`).value = '가'.repeat(201);
    const send = () =>
      body()
        .querySelector('form[data-form="recommend"]')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    send();
    await flush();
    expect(body().querySelector('[data-err]').textContent).toBe('소개는 200자까지입니다.');
    expect(posts(calls, /\/recommend$/)).toHaveLength(0);
    body().querySelector(`[data-note-for="${F(2)}"]`).value = '';
    send();
    await until(
      () =>
        body().querySelector('[data-err]') &&
        body().querySelector('[data-err]').textContent === '추천할 수 없는 팩토리가 있습니다'
    );
    expect(body().querySelector('form[data-form="recommend"]')).not.toBeNull();
    reply = fail(409, 'stale', '그사이 의뢰가 바뀌었습니다');
    send();
    await until(() =>
      body().textContent.includes('그사이 의뢰가 바뀌었습니다. 목록을 다시 불러왔습니다.')
    );
    expect(body().querySelector('form[data-form="recommend"]')).toBeNull();
  });

  test('못 받은 의뢰 — 검토 시작 없이 후보만, 후보를 못 읽으면 한 줄', async () => {
    const calls = await load({ suggestions: () => fail(500, 'x', 'x') });
    await click(body().querySelector(`[data-act="pick"][data-id="${R2}"]`));
    await click(button(body(), '다시 추천'));
    await until(() => body().textContent.includes('추천 후보를 불러오지 못했습니다.'));
    expect(posts(calls, /\/review$/)).toHaveLength(0);
  });
});
