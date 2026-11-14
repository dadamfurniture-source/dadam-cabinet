/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element */
/**
 * SEGAN 마이페이지 본사 › 플랫폼 › 설계 · 학습 점검 (segan/hq-design-check.js + segan/me.html #hqDesignCheck, 주소 #hq-design-check)
 *
 *   누가    다담 본사 구성원 (account-api GET /partner/me platform_member) — 서버가 대표 · 실장만 (403 이면 칸째 감춘다)
 *   데이터  workflow-api GET /hq/design-check · GET|POST /hq/design-check/reviews · POST /hq/design-check/run (본인 토큰)
 *   화면    점검 걸음 · 가는 길의 수(앱 플래너 · PC 플래너) · 팩토리별 · 지난 7일 저장 실패 · 검토 줄(기다림 · 검토함 · 시공 완료만)
 *           양질은 바로 저장, 보통 · 제외는 까닭을 고른 뒤 저장. DB 준비 전(409 db_pending)이면 「준비 중」
 * 사람 · 업체 · 설계는 모두 지어낸 시험 값이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const HQ = '11111111-1111-4111-8111-111111111111';
const A = '11111111-1111-4111-8111-111111111112';
const WEB_KEY = `planner-web:${A}:design-aaaa-0001`;
const PC_KEY = 'planner-lite:design:design-pc01-0001';

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code) => ({
  ok: false,
  status,
  body: { success: false, code, message: 'x' },
});
const platformMe = () =>
  ok({ company: null, application: null, members: [], invites: [], platform_member: true });
const expertMe = () =>
  ok({
    company: { id: A, name: '가나 가구', plan: 'expert', status: 'active', role: 'owner' },
    application: null,
    members: [],
    invites: [],
  });

const STEPS = [
  { key: 'save', label: '설계 저장', ok: true, ms: 120, note: 'rev 4' },
  { key: 'read', label: '설계 읽기', ok: true, ms: 40, note: 'rev 4' },
  { key: 'learn', label: '학습 묶음 받기', ok: true, ms: 80, note: '묶음 저장' },
  {
    key: 'ingest',
    label: '학습 자료로 수집',
    ok: false,
    ms: 30,
    note: '마지막 수집이 45분 전입니다',
  },
  {
    key: 'export_block',
    label: '시험 설계는 내보내기에서 막힘',
    ok: true,
    ms: 20,
    note: '학습 자료에 없음 (정상)',
  },
];
const SUMMARY = {
  companies: [
    {
      id: HQ,
      name: '다담 공장',
      kind: 'hq',
      plan: null,
      photos: 'always',
      drafts: 3,
      last_saved: '2026-11-13T20:34:00Z',
      bundles: 0,
      pending: 0,
      failed: 0,
      issues: 0,
    },
    {
      id: A,
      name: '가나 가구',
      kind: 'partner',
      plan: 'expert',
      photos: 'off',
      drafts: 5,
      last_saved: '2026-11-13T21:00:00Z',
      bundles: 4,
      pending: 1,
      failed: 1,
      issues: 2,
    },
    {
      id: 'x',
      name: '아직 안 쓴 팩토리',
      kind: 'partner',
      plan: 'agent',
      photos: 'off',
      drafts: 0,
      last_saved: null,
      bundles: 0,
      pending: 0,
      failed: 0,
      issues: 0,
    },
  ],
  funnel: {
    drafts: 8,
    bundles: 4,
    pending: 1,
    failed: 1,
    samples: 3,
    waiting: 2,
    good: 1,
    normal: 0,
    exclude: 0,
    linked: 1,
    exportable: 1,
  },
  pc: { designs: 11, photos: 14, completed: 2, graded: 0, exportable: 10 },
  suggest: { days: 7, shown: 6, accepted: 2, skipped: 3 },
  issues: {
    days: 7,
    total: 3,
    by_code: [
      { stage: 'save', code: 'conflict', n: 2 },
      { stage: 'learn', code: 'too_large', n: 1 },
    ],
  },
  checks: [
    {
      id: 'c1',
      cause: 'daily',
      run_date: '2026-11-14',
      ok: false,
      steps: STEPS,
      created_at: '2026-11-13T22:00:05Z',
    },
  ],
  ingest: { last_run: '2026-11-13T20:40:00Z', last_count: 0, last_error: null },
};
const WEB_ITEM = {
  group_key: WEB_KEY,
  source: 'web',
  company_id: A,
  draft_id: 'design-aaaa-0001',
  company: '가나 가구',
  company_kind: 'partner',
  name: '합성 주방 <b>',
  gone: false,
  item: 'sink',
  space: 'kitchen',
  furniture: 'sink',
  layout_shape: 'L',
  region: '대구 북구',
  rev_now: 6,
  rev_bundle: 6,
  reviewed_rev: 4,
  grade: 'good',
  reasons: [],
  linked: true,
  completed: false,
  exportable: false,
  walls: [
    {
      name: '공간 A',
      length: 3000,
      lines: {
        floor: [
          { id: 'LB-D2-900', w: 900 },
          { id: 'LB-SINK-1000', w: 1000 },
          { id: 'TL-A', w: null },
        ],
        upper: [{ id: 'UB-D2-900', w: 900 }],
      },
    },
  ],
  modules: 4,
  photos: [
    {
      url: 'https://example.supabase.co/storage/v1/object/sign/planner-photos/a.jpg?token=t',
      kind: 'site',
      phase: 'before',
      media: 'photo',
    },
  ],
  photo_count: 1,
  updated_at: '2026-11-13T21:00:00Z',
};
const PC_ITEM = {
  ...WEB_ITEM,
  group_key: PC_KEY,
  source: 'pc',
  company_id: HQ,
  draft_id: 'design-pc01-0001',
  company: '다담 공장',
  company_kind: 'hq',
  name: '',
  region: '',
  rev_now: null,
  rev_bundle: null,
  reviewed_rev: null,
  grade: null,
  linked: false,
  completed: true,
  exportable: true,
  photos: [],
  photo_count: 0,
};

/** me.html 을 올린다. opts.summary() · reviews(url) · post(body) · run() → 응답 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: platformMe(),
    url: '/segan/me.html',
    summary: () => ok(SUMMARY),
    reviews: () => ok({ state: 'waiting', only: null, items: [WEB_ITEM, PC_ITEM] }),
    post: () => ok({ reviewed: 2, grade: 'good', reasons: [], src_rev: 6 }, 201),
    run: () =>
      ok({
        id: 'c2',
        ok: true,
        steps: STEPS.map((s) => ({ ...s, ok: true })),
        created_at: '2026-11-13T23:10:00Z',
      }),
    ...options,
  };
  window.history.replaceState(null, '', opts.url);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerProjects',
    'SeganHqCompanies',
    'SeganHqDesignCheck',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  delete window.matchMedia;
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
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
    const method = init.method || 'GET';
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      body: init.body ? JSON.parse(init.body) : null,
    });
    const reply = (r) => ({ ok: r.ok, status: r.status, json: async () => r.body });
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/hq/design-check') return reply(opts.summary());
    if (url.startsWith(WORK + '/hq/design-check/reviews'))
      return reply(method === 'POST' ? opts.post(JSON.parse(init.body)) : opts.reviews(url));
    if (url === WORK + '/hq/design-check/run') return reply(opts.run());
    if (url === WORK + '/hq/companies') return reply(fail(403, 'not_platform'));
    if (url === WORK + '/company/projects') return reply(fail(403, 'not_project_company'));
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/me/projects') return reply(fail(404, 'not_found'));
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
    'segan/hq-companies.js',
    'segan/hq-design-check.js',
    'segan/shell.js',
    'segan/make.js',
    'segan/me.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const body = () => $('hqDesignCheckBody');
const menuRow = () => document.querySelector('#meHub [data-me-item="hq-design-check"]');
const texts = (sel) =>
  [...body().querySelectorAll(sel)].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
const facts = (i) =>
  [...body().querySelectorAll('.me-dc-facts')[i].querySelectorAll('div')].map((d) =>
    d.textContent.replace(/\s+/g, ' ').trim()
  );
const card = (key) => body().querySelector(`.me-dc-card[data-key="${key}"]`);
const click = async (el) => {
  el.click();
  await flush();
};
const reviewCalls = (calls) =>
  calls.fetch.filter((f) => f.url.startsWith(WORK + '/hq/design-check/reviews'));

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 관리 › 플랫폼 둘째 줄 「설계 · 학습 점검」(#hq-design-check), 칸은 처음엔 감춘다 · 스크립트 차례 · 서비스 워커', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const rows = [...doc.querySelectorAll('#meSubPlatform > li')];
    expect(rows[0].getAttribute('data-me-item')).toBe('companies');
    expect(rows[1].getAttribute('data-me-item')).toBe('hq-design-check');
    expect(rows[1].hasAttribute('hidden')).toBe(true);
    expect(rows[1].querySelector('a').getAttribute('href')).toBe('#hq-design-check');
    const sec = doc.getElementById('hqDesignCheck');
    expect(sec.hasAttribute('hidden')).toBe(true);
    expect(sec.querySelector('h2').textContent).toBe('설계 · 학습 점검');
    expect(sec.nextElementSibling.id).toBe('hqCompanies');
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    expect(at('hq-design-check.js')).toBeGreaterThan(at('hq-companies.js'));
    expect(at('hq-design-check.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'hq-design-check.js')");
  });

  test('점검 알림이 여는 주소가 이 화면의 주소다 (workflow-api push/messages.js)', () => {
    expect(read('workers/workflow-api/src/push/messages.js')).toContain(
      "export const HQ_DESIGN_CHECK_URL = '/segan/me.html#hq-design-check';"
    );
  });

  test('판정 · 줄 글 (순수)', async () => {
    await load();
    const D = window.SeganHqDesignCheck;
    expect(D.canSee({ platform_member: true })).toBe(true);
    expect(D.canSee({ hq_member: true })).toBe(false);
    expect(D.canSee(null)).toBe(false);
    expect(D.dataOf({ success: true, data: { a: 1 } })).toEqual({ a: 1 });
    expect(D.dataOf({ success: false, data: { a: 1 } })).toBeNull();
    expect(D.dataOf({ success: true, data: [] })).toBeNull();
    expect(D.checkLine(SUMMARY.checks[0])).toBe('11.14 07:00 매일 점검 — 막힌 걸음 1곳');
    expect(
      D.checkLine({
        cause: 'manual',
        created_at: '2026-11-13T23:10:00Z',
        steps: [{ ok: true }, { ok: true }],
      })
    ).toBe('11.14 08:10 손으로 돌린 점검 — 2걸음 모두 됨');
    expect(D.funnelRows(SUMMARY.funnel)).toEqual([
      ['저장된 설계', 8, ''],
      ['받은 학습 묶음', 4, '수집 기다림 1 · 수집 오류 1'],
      ['학습 자료', 3, ''],
      ['검토 기다림', 2, ''],
      ['검토함', 1, '양질 1 · 보통 0 · 제외 0'],
      ['앱 설계로 이어짐', 1, ''],
      ['내보낼 수 있는 것', 1, ''],
    ]);
    expect(D.funnelRows(null)[0]).toEqual(['저장된 설계', 0, '']);
    // 폭을 모르는 모듈은 600 으로 그린다 (그림용)
    expect(D.barWidths([{ w: 900 }, { w: 1000 }, { w: null }])).toEqual([36, 40, 24]);
    expect(D.barWidths([])).toEqual([]);
    expect(D.metaLine(WEB_ITEM)).toBe('싱크대 · ㄱ자 · 대구 북구 · 모듈 4개 · 사진 1장');
    expect(D.revLine(WEB_ITEM)).toBe('검토한 rev 4, 지금 6');
    expect(D.revLine({ ...WEB_ITEM, reviewed_rev: null, rev_bundle: 5 })).toBe(
      '받은 묶음 rev 5, 지금 6'
    );
    expect(D.revLine({ ...WEB_ITEM, reviewed_rev: 6 })).toBe('rev 6');
    expect(D.revLine({ ...WEB_ITEM, gone: true })).toBe('설계 모음에서 빠진 설계입니다');
    expect(D.revLine(PC_ITEM)).toBe('');
  });
});

describe('누가 보나', () => {
  test('다담 본사 구성원 — 본인 토큰으로 묻고, 메뉴 줄 · 칸이 열린다', async () => {
    const calls = await load({ url: '/segan/me.html#hq-design-check' });
    expect(calls.fetch.find((f) => f.url === WORK + '/hq/design-check').auth).toBe('Bearer tok-1');
    expect(menuRow().hidden).toBe(false);
    expect($('hqDesignCheck').hidden).toBe(false);
    expect($('meTitle').textContent).toBe('설계 · 학습 점검');
    expect(reviewCalls(calls).map((f) => f.url)).toEqual([
      WORK + '/hq/design-check/reviews?state=waiting',
    ]);
  });

  test('본사 구성원이 아니면 묻지도 않고, 403(본사 직원) · 오류면 칸째 감춘다 — 메뉴 줄도 없다', async () => {
    let calls = await load({ partner: expertMe() });
    expect(calls.fetch.some((f) => f.url.startsWith(WORK + '/hq/design-check'))).toBe(false);
    expect($('hqDesignCheck').hidden).toBe(true);
    expect(menuRow().hidden).toBe(true);
    for (const summary of [
      () => fail(403, 'not_platform'),
      () => fail(500, 'error'),
      () => ok([]),
    ]) {
      calls = await load({ summary });
      expect($('hqDesignCheck').hidden).toBe(true);
      expect(menuRow().hidden).toBe(true);
      expect(reviewCalls(calls)).toEqual([]);
    }
  });

  test('DB 준비 전(409 db_pending) — 칸은 열고 「준비 중」 한 줄, 검토 줄은 묻지 않는다', async () => {
    const calls = await load({ summary: () => fail(409, 'db_pending') });
    expect($('hqDesignCheck').hidden).toBe(false);
    expect(menuRow().hidden).toBe(false);
    expect(body().textContent).toBe(window.SeganHqDesignCheck.TEXT.pending);
    expect(reviewCalls(calls)).toEqual([]);
  });
});

describe('한눈에', () => {
  test('점검 — 마지막 점검 한 줄 · 걸음마다 됨 / 안 됨 · 마지막 수집', async () => {
    await load();
    expect(texts('.me-dc-line')[0]).toBe('11.14 07:00 매일 점검 — 막힌 걸음 1곳');
    expect(texts('.me-dc-steps li')).toEqual([
      '됨설계 저장rev 4',
      '됨설계 읽기rev 4',
      '됨학습 묶음 받기묶음 저장',
      '안 됨학습 자료로 수집마지막 수집이 45분 전입니다',
      '됨시험 설계는 내보내기에서 막힘학습 자료에 없음 (정상)',
    ]);
    expect(body().querySelectorAll('.me-dc-steps li.me-dc-bad').length).toBe(1);
    expect(body().textContent).toContain('마지막 수집 11.14 05:40 (10분마다)');
  });

  test('가는 길의 수 — 앱 플래너와 PC 플래너를 따로, 팩토리별(쓴 곳만) · 지난 7일 저장 실패', async () => {
    await load();
    expect(facts(0)).toEqual([
      '저장된 설계8',
      '받은 학습 묶음4 수집 기다림 1 · 수집 오류 1',
      '학습 자료3',
      '검토 기다림2',
      '검토함1 양질 1 · 보통 0 · 제외 0',
      '앱 설계로 이어짐1',
      '내보낼 수 있는 것1',
    ]);
    expect(facts(1)).toEqual([
      '올라온 설계11 사진 14장',
      '시공 완료 확인2',
      '검토함0',
      '내보낼 수 있는 것10',
    ]);
    // 앱 플래너 「자주 쓴 구성」 카드가 쓰였나 — 지난 7일 수만
    expect(body().textContent).toContain('자주 쓴 구성 카드 — 지난 7일');
    expect(facts(2)).toEqual(['보임6', '누름2', '지나침3']);
    expect(texts('.me-dc-co')).toEqual([
      '다담 공장설계 3개 · 마지막 저장 11.14 05:34 · 묶음 0개늘 제공',
      '가나 가구설계 5개 · 마지막 저장 11.14 06:00 · 묶음 4개 · 수집 기다림 1 · 수집 오류 1 · 저장 실패 2건사진 제공 끔',
    ]);
    expect(texts('.me-dc-codes li')).toEqual(['저장 · conflict2', '묶음 보내기 · too_large1']);
  });

  test('아직 아무것도 없을 때 — 빈 글', async () => {
    await load({
      summary: () =>
        ok({
          companies: [],
          funnel: {},
          pc: {},
          issues: { total: 0, by_code: [] },
          checks: [],
          ingest: {},
        }),
      reviews: () => ok({ items: [] }),
    });
    const T = window.SeganHqDesignCheck.TEXT;
    expect(body().textContent).toContain(T.noCheck);
    expect(body().textContent).toContain(T.noCompanies);
    expect(body().textContent).toContain(T.noIssues);
    expect(body().textContent).toContain(
      T.emptyWaiting + ' 앱 플래너에서 저장한 설계는 10분 안에 여기로 옵니다.'
    );
    expect(body().textContent).toContain('마지막 수집 없음');
    // 옛 서버 답(suggest 없음)이면 카드 칸을 그리지 않는다
    expect(body().textContent).not.toContain('자주 쓴 구성 카드');
  });
});

describe('검토 줄', () => {
  test('한 장 — 팩토리 · 출처 · 시공 완료 확인 · 구성(공간마다 줄 · 모듈 폭) · 사진, 설계 이름은 글자로만', async () => {
    await load();
    const web = card(WEB_KEY);
    expect(
      [...web.querySelectorAll('.me-dc-head b, .me-dc-head .me-badge')].map((x) => x.textContent)
    ).toEqual(['가나 가구', '앱 플래너']);
    expect(web.querySelector('.me-dc-name').textContent).toBe('합성 주방 <b>');
    expect(web.querySelector('.me-dc-name b')).toBeNull();
    expect(web.querySelector('.mk-note').textContent).toBe(
      '싱크대 · ㄱ자 · 대구 북구 · 모듈 4개 · 사진 1장 · 검토한 rev 4, 지금 6'
    );
    expect(web.querySelector('.me-dc-wall p').textContent).toBe('공간 A 3,000');
    const bars = [...web.querySelectorAll('.me-dc-bar')];
    expect(bars.map((b) => b.querySelector('small').textContent)).toEqual(['상부 줄', '바닥 줄']);
    expect(
      [...bars[1].querySelectorAll('i')].map((i) => [
        i.textContent,
        i.getAttribute('title'),
        i.style.flexBasis,
      ])
    ).toEqual([
      ['900', 'LB-D2-900', '36%'],
      ['1000', 'LB-SINK-1000', '40%'],
      ['', 'TL-A', '24%'],
    ]);
    const a = web.querySelector('.me-dc-photos a');
    expect([
      a.getAttribute('target'),
      a.getAttribute('rel'),
      a.querySelector('img').getAttribute('alt'),
    ]).toEqual(['_blank', 'noopener', '현장사진']);
    expect(web.querySelector('[data-grade="good"]').getAttribute('aria-pressed')).toBe('true');
    const pc = card(PC_KEY);
    expect(
      [...pc.querySelectorAll('.me-dc-head b, .me-dc-head .me-badge')].map((x) => x.textContent)
    ).toEqual(['다담 공장', 'PC 플래너', '시공 완료 확인', '내보낼 수 있음']);
    expect(pc.querySelector('.me-dc-name').textContent).toBe(window.SeganHqDesignCheck.TEXT.pcName);
    expect(pc.querySelector('.me-dc-photos')).toBeNull();
    expect(
      [...pc.querySelectorAll('[data-grade]')].map((b) => b.getAttribute('aria-pressed'))
    ).toEqual(['false', 'false', 'false']);
  });

  test('탭 · 「시공 완료만」 — 그 줄을 다시 묻는다', async () => {
    const seen = [];
    const calls = await load({
      reviews: (url) => {
        seen.push(url.replace(WORK, ''));
        return ok({
          items: url.includes('only=completed')
            ? [PC_ITEM]
            : url.includes('state=done')
              ? []
              : [WEB_ITEM, PC_ITEM],
        });
      },
    });
    await click(body().querySelector('[data-tab="done"]'));
    expect(body().querySelector('[data-tab="done"]').getAttribute('aria-selected')).toBe('true');
    expect(body().textContent).toContain(window.SeganHqDesignCheck.TEXT.emptyDone);
    await click(body().querySelector('[data-tab="waiting"]'));
    await click(body().querySelector('[data-act="only"]'));
    expect(body().querySelector('[data-act="only"]').getAttribute('aria-pressed')).toBe('true');
    expect(
      [...body().querySelectorAll('.me-dc-card')].map((c) => c.getAttribute('data-key'))
    ).toEqual([PC_KEY]);
    expect(seen).toEqual([
      '/hq/design-check/reviews?state=waiting',
      '/hq/design-check/reviews?state=done',
      '/hq/design-check/reviews?state=waiting',
      '/hq/design-check/reviews?state=waiting&only=completed',
    ]);
    expect(reviewCalls(calls).every((f) => f.auth === 'Bearer tok-1')).toBe(true);
  });

  test('양질 — 누르면 바로 저장하고 한눈에 · 검토 줄을 다시 읽는다', async () => {
    const calls = await load();
    const before = calls.fetch.length;
    await click(card(PC_KEY).querySelector('[data-grade="good"]'));
    const post = calls.fetch.find(
      (f) => f.method === 'POST' && f.url === WORK + '/hq/design-check/reviews'
    );
    expect(post.body).toEqual({ group_key: PC_KEY, grade: 'good', reasons: [] });
    expect(post.auth).toBe('Bearer tok-1');
    const after = calls.fetch.slice(before).map((f) => f.method + ' ' + f.url.replace(WORK, ''));
    expect(after).toEqual([
      'POST /hq/design-check/reviews',
      'GET /hq/design-check',
      'GET /hq/design-check/reviews?state=waiting',
    ]);
    expect(body().querySelector('.me-dc-note').textContent).toBe(
      window.SeganHqDesignCheck.TEXT.saved
    );
  });

  test('보통 · 제외 — 까닭을 고른 뒤 저장 (누르기만 해서는 보내지 않는다)', async () => {
    const calls = await load();
    await click(card(PC_KEY).querySelector('[data-grade="exclude"]'));
    expect(calls.fetch.some((f) => f.method === 'POST')).toBe(false);
    expect(card(PC_KEY).querySelector('[data-grade="exclude"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect([...card(PC_KEY).querySelectorAll('[data-why]')].map((b) => b.textContent)).toEqual([
      '치수 이상',
      '구성 미완성',
      '사진 흐림',
      '시험 설계',
    ]);
    await click(card(PC_KEY).querySelector('[data-why="test"]'));
    await click(card(PC_KEY).querySelector('[data-why="dimension"]'));
    await click(card(PC_KEY).querySelector('[data-why="dimension"]')); // 다시 누르면 뺀다
    expect(card(PC_KEY).querySelector('[data-why="test"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(card(PC_KEY).querySelector('[data-why="dimension"]').getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect(card(WEB_KEY).querySelector('[data-why]')).toBeNull();
    await click(card(PC_KEY).querySelector('[data-act="save"]'));
    expect(calls.fetch.find((f) => f.method === 'POST').body).toEqual({
      group_key: PC_KEY,
      grade: 'exclude',
      reasons: ['test'],
    });
  });

  test('저장이 안 되면 알리고 고르던 것은 그대로 둔다', async () => {
    await load({ post: () => fail(500, 'error') });
    await click(card(PC_KEY).querySelector('[data-grade="normal"]'));
    await click(card(PC_KEY).querySelector('[data-act="save"]'));
    expect(body().querySelector('.me-dc-note').textContent).toBe(
      window.SeganHqDesignCheck.TEXT.saveFail
    );
    expect(card(PC_KEY).querySelector('[data-grade="normal"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(card(PC_KEY).querySelector('[data-act="save"]')).not.toBeNull();
  });
});

describe('지금 점검', () => {
  test('누르면 점검을 돌리고 그 결과를 맨 위에 보인다', async () => {
    const calls = await load();
    await click(body().querySelector('[data-act="run"]'));
    const run = calls.fetch.find((f) => f.url === WORK + '/hq/design-check/run');
    expect([run.method, run.auth]).toEqual(['POST', 'Bearer tok-1']);
    // 그 뒤 한눈에를 다시 읽는다 (시험의 한눈에는 옛 점검 그대로 — 다시 읽은 것이 보인다)
    expect(calls.fetch.filter((f) => f.url === WORK + '/hq/design-check').length).toBe(2);
    expect(body().querySelector('[data-act="run"]').disabled).toBe(false);
  });

  test('점검이 안 돌면 알린다', async () => {
    await load({ run: () => fail(500, 'error') });
    await click(body().querySelector('[data-act="run"]'));
    expect(body().querySelector('.me-dc-note').textContent).toBe(
      window.SeganHqDesignCheck.TEXT.fail
    );
  });
});
