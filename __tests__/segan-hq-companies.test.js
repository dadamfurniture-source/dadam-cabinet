/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element */
/**
 * SEGAN 마이페이지 본사 › 업체관리 › 등록 업체 (segan/hq-companies.js + segan/me.html #hqCompanies, 주소 #companies)
 *
 *   누가    다담 본사 구성원 (account-api GET /partner/me platform_member) — 서버가 대표 · 실장만 (403 이면 칸째 감춘다)
 *   데이터  workflow-api GET /hq/companies · /hq/companies/:id/projects · /hq/companies/:id/members (본인 토큰)
 *   화면    목록 → 업체 하나 (「‹ 등록 업체」) — 탭 프로젝트(단계별 수 · 줄) · 회계(월 보고서 · 공장 장부 · 장부 없음) · 인력
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
const B = '11111111-1111-4111-8111-111111111113';
const P1 = '22222222-2222-4222-8222-222222222221';
const P2 = '22222222-2222-4222-8222-222222222222';

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

const COMPANIES = [
  {
    id: HQ,
    kind: 'hq',
    name: '다담 공장',
    plan: null,
    status: 'active',
    sido: null,
    gugun: null,
    members: 1,
    projects: 3,
    ledger: 'full',
  },
  {
    id: A,
    kind: 'partner',
    name: '가나 가구',
    plan: 'agent',
    status: 'active',
    sido: '대구광역시',
    gugun: '북구',
    members: 3,
    projects: 2,
    ledger: 'full',
  },
  {
    id: B,
    kind: 'partner',
    name: '다라 주방',
    plan: 'expert',
    status: 'suspended',
    sido: '경기도',
    gugun: '성남시',
    members: 2,
    projects: 0,
    ledger: 'none',
  },
];
const PROJECTS = [
  {
    id: P2,
    title: '붙박이장',
    status: 'closed',
    created_at: '2026-10-20T16:00:00Z',
    stage: 'installed',
    order_status: 'completed',
    design_count: 2,
    assignee: null,
  },
  {
    id: P1,
    title: '싱크대',
    status: 'active',
    created_at: '2026-10-10T00:00:00Z',
    stage: 'order',
    order_status: 'in_production',
    design_count: 1,
    assignee: { name: '나직원', role: 'staff' },
  },
];
const MEMBERS = [
  { name: '가대표', role: 'owner', status: 'active', joined_at: '2026-10-01T00:00:00Z' },
  { name: '떠난이', role: 'staff', status: 'removed', joined_at: '2026-10-02T00:00:00Z' },
];

/** me.html 을 올린다. opts.companies() · projects(id) · members(id) → GET 응답 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: platformMe(),
    url: '/segan/me.html',
    companies: () => ok({ items: COMPANIES }),
    projects: () => ok({ company: { id: A }, items: PROJECTS }),
    members: () => ok({ company: { id: A }, items: MEMBERS }),
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
    calls.fetch.push({ url, auth: (init.headers || {}).Authorization });
    const reply = (r) => ({ ok: r.ok, status: r.status, json: async () => r.body });
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/hq/companies') return reply(opts.companies());
    const m = /\/hq\/companies\/([^/]+)\/(projects|members)$/.exec(url);
    if (m) return reply(m[2] === 'projects' ? opts.projects(m[1]) : opts.members(m[1]));
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
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const body = () => $('hqCompaniesBody');
const menuRow = () => document.querySelector('#meHub [data-me-item="companies"]');
const lines = (sel) =>
  [...body().querySelectorAll(sel)].map((el) =>
    [...el.querySelectorAll('b, small, .me-badge')].map((x) => x.textContent).join(' | ')
  );
const click = async (el) => {
  el.click();
  await flush();
};

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 본사 › 업체관리 첫 줄 「등록 업체」(#companies), 칸은 처음엔 감춘다 · 스크립트 차례 · 서비스 워커', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const first = doc.querySelector('#meSubHqCompanies > li');
    expect(first.getAttribute('data-me-item')).toBe('companies');
    expect(first.hasAttribute('hidden')).toBe(true);
    expect(first.querySelector('a').getAttribute('href')).toBe('#companies');
    const sec = doc.getElementById('hqCompanies');
    expect(sec.hasAttribute('hidden')).toBe(true);
    expect(sec.querySelector('h2').textContent).toBe('등록 업체');
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    expect(at('hq-companies.js')).toBeGreaterThan(at('partner-projects.js'));
    expect(at('hq-companies.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'hq-companies.js')");
  });

  test('판정 · 단계별 수 (순수)', async () => {
    await load();
    const H = window.SeganHqCompanies;
    expect(H.canSee({ platform_member: true })).toBe(true);
    expect(H.canSee({ hq_member: true })).toBe(false);
    expect(H.canSee(null)).toBe(false);
    expect(H.stageCounts(PROJECTS)).toEqual([
      ['상담', 0],
      ['설계', 0],
      ['견적', 0],
      ['계약', 0],
      ['제작', 1],
      ['설치', 1],
    ]);
  });
});

describe('누가 보나', () => {
  test('다담 본사 구성원 — 본인 토큰으로 묻고, 메뉴 줄 · 칸이 열린다 (다담 공장 먼저 · 이용 중은 상태를 적지 않는다)', async () => {
    const calls = await load({ url: '/segan/me.html#companies' });
    expect(calls.fetch.find((f) => f.url === WORK + '/hq/companies').auth).toBe('Bearer tok-1');
    expect(menuRow().hidden).toBe(false);
    expect($('hqCompanies').hidden).toBe(false);
    expect($('meTitle').textContent).toBe('등록 업체');
    expect(lines('.me-hc-row')).toEqual([
      '다담 공장 | 다담 공장 · 구성원 1명 · 프로젝트 3건',
      '가나 가구 | Agent · 대구광역시 북구 · 구성원 3명 · 프로젝트 2건',
      '다라 주방 | Expert · 경기도 성남시 · 구성원 2명 · 프로젝트 0건 | 결제 멈춤',
    ]);
  });

  test('본사 구성원이 아니면 묻지도 않고, 403(본사 직원)이면 칸째 감춘다 — 메뉴 줄도 없다', async () => {
    let calls = await load({ partner: expertMe() });
    expect(calls.fetch.some((f) => f.url === WORK + '/hq/companies')).toBe(false);
    expect($('hqCompanies').hidden).toBe(true);
    expect(menuRow().hidden).toBe(true);
    calls = await load({ companies: () => fail(403, 'not_platform') });
    expect($('hqCompanies').hidden).toBe(true);
    expect(menuRow().hidden).toBe(true);
  });
});

describe('업체 하나 — 프로젝트 · 회계 · 인력', () => {
  test('누르면 프로젝트 탭 — 단계별 수 · 줄(단계 · 만든 날 · 설계 수 · 담당), 「‹ 등록 업체」 로 목록', async () => {
    const calls = await load({ url: '/segan/me.html#companies' });
    await click(body().querySelector(`[data-co="${A}"]`));
    expect(calls.fetch.some((f) => f.url === `${WORK}/hq/companies/${A}/projects`)).toBe(true);
    expect(body().querySelector('.me-hc-name').textContent).toBe('가나 가구');
    expect(body().querySelector('[data-tab="projects"]').getAttribute('aria-selected')).toBe(
      'true'
    );
    const stages = [...body().querySelectorAll('.me-hc-stages div')].map((d) => d.textContent);
    expect(stages).toEqual(['상담0', '설계0', '견적0', '계약0', '제작1', '설치1']);
    expect(lines('.me-hc-item')).toEqual([
      '붙박이장 | 설치 · 2026.10.21 · 설계 2개 · 담당자 없음 | 끝남',
      '싱크대 | 제작 · 2026.10.10 · 설계 1개 · 담당 나직원 (직원)',
    ]);
    await click(body().querySelector('[data-act="back"]'));
    expect(body().querySelectorAll('.me-hc-row')).toHaveLength(3);
  });

  test('회계 탭 — 협력업체는 월 장부 보고서 새 탭, 다담 공장은 장부 보기, 장부가 없으면 안내 (회계는 따로 묻지 않는다)', async () => {
    const calls = await load({ url: '/segan/me.html#companies' });
    await click(body().querySelector(`[data-co="${A}"]`));
    await click(body().querySelector('[data-tab="ledger"]'));
    let a = body().querySelector('a.sg-row');
    expect(a.textContent).toBe('월 장부 보고서 열기');
    expect(a.getAttribute('href')).toBe('ledger-report.html?company=' + A);
    expect([a.getAttribute('target'), a.getAttribute('rel')]).toEqual(['_blank', 'noopener']);
    await click(body().querySelector('[data-act="back"]'));
    await click(body().querySelector(`[data-co="${HQ}"]`));
    await click(body().querySelector('[data-tab="ledger"]'));
    a = body().querySelector('a.sg-row');
    expect(a.textContent).toBe('공장 장부 보기');
    expect(a.getAttribute('href')).toBe('ledger.html?company=' + HQ);
    expect(a.getAttribute('target')).toBeNull();
    await click(body().querySelector('[data-act="back"]'));
    await click(body().querySelector(`[data-co="${B}"]`));
    await click(body().querySelector('[data-tab="ledger"]'));
    expect(body().querySelector('.me-empty').textContent).toBe(
      window.SeganHqCompanies.TEXT.noLedger
    );
    expect(calls.fetch.some((f) => /\/ledger\//.test(f.url))).toBe(false);
  });

  test('인력 탭 — 구성원 이름 · 직책 · 들어온 날 · 나간 사람 표시 (처음 열 때만 묻는다)', async () => {
    const calls = await load({ url: '/segan/me.html#companies' });
    await click(body().querySelector(`[data-co="${A}"]`));
    await click(body().querySelector('[data-tab="people"]'));
    expect(lines('.me-hc-item')).toEqual([
      '가대표 | 대표 · 2026.10.01 들어옴',
      '떠난이 | 직원 · 2026.10.02 들어옴 | 내보냄',
    ]);
    await click(body().querySelector('[data-tab="projects"]'));
    await click(body().querySelector('[data-tab="people"]'));
    expect(calls.fetch.filter((f) => f.url === `${WORK}/hq/companies/${A}/members`)).toHaveLength(
      1
    );
  });

  test('못 읽으면 그 탭에 안내 · 글은 글자로만', async () => {
    const bad = '<img src=x onerror=alert(1)>';
    await load({
      url: '/segan/me.html#companies',
      companies: () => ok({ items: [{ ...COMPANIES[1], name: bad }] }),
      projects: () => fail(500, 'x'),
    });
    expect(body().querySelector('img')).toBeNull();
    await click(body().querySelector(`[data-co="${A}"]`));
    expect(body().querySelector('.me-hc-name').textContent).toBe(bad);
    expect(body().querySelector('.mk-error').textContent).toBe(window.SeganHqCompanies.TEXT.fail);
  });
});
