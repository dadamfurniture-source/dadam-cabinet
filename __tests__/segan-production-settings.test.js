/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「생산 › 생산 설정」 (segan/production-settings.js + segan/me.html #productionSettings)
 *
 *   누가    다담 공장 구성원(GET /partner/me 의 hq_member) · 협력업체의 대표 · 실장 가운데
 *           GET /production/settings 가 열리는 사람. 다담 본사 구성원 · 업체 직원은 묻지도 않는다
 *   데이터  workflow-api GET /production/settings · POST /production/settings
 *   화면    묶음 일곱(표준시간 · 인력 · 인건비 · 외주 단가 · 외주 업체 · 상판 · 납기 · 견적) — 칸 이름은 PC 화면과 같다
 *   저장    PC 화면과 같은 꼴 (빈 숫자 칸은 빼고, 상판 업체는 빈 글도) + 이 화면에 칸이 없는 공휴일 · 원판 기준은 그대로 싣는다
 *   못 읽으면 칸째 감춘다 (구역 단추도). 저장이 안 되면 서버 글을 단추 옆에, 서버가 짚은 칸에 표시한다
 *   숫자 · 업체 이름은 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-11T03:00:00Z'); // 한국 시간 2026-11-11 (수) 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });
const company = (role) => ({
  id: CO,
  name: '다담 협력 주방',
  plan: 'agent',
  next_plan: null,
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  role,
  created_at: '2026-10-01T00:00:00Z',
});
const partnerOf = (role) =>
  ok({ company: company(role), application: null, members: [], invites: [] });
const PARTNER = partnerOf('owner');

// 칸 이름 — 모듈의 것을 그대로 쓴다 (PC 화면과 같은지는 따로 본다)
const names = () => {
  delete window.SeganProductionSettings;
  (0, eval)(read('segan/production-settings.js'));
  return window.SeganProductionSettings;
};

/** 기본값을 채운 설정 — 칸마다 다른 지어낸 숫자 (묶음 차례 × 100 + 칸 차례) */
const settings = (patch = {}) => {
  const P = names();
  const s = {};
  P.GROUPS.forEach((g, gi) => {
    s[g] = {};
    Object.keys(P.LABELS[g]).forEach((k, ki) => {
      s[g][k] = g === 'vendors' ? '' : (gi + 1) * 100 + ki;
    });
  });
  s.vendors = {
    door: '가람 도어',
    cutEdge: '나래 재단',
    topMarble: '다온 상판',
    topStone: '',
    topCeramic: '',
  };
  s.quote.marginRate = 0.2;
  s.quote.sheetBasis = 'area';
  s.holidays = [];
  for (const g of Object.keys(patch)) s[g] = { ...s[g], ...patch[g] };
  return s;
};

/**
 * 마이페이지를 띄운다 (기본 = 다담 공장 구성원, 생산 설정 화면)
 * opts.get() → GET /production/settings, opts.post(body) → POST /production/settings
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: HQ,
    hash: '#p-config',
    projects: ok({ company: { id: CO }, can_manage: false, items: [] }), // 생산 › 제작 화면
    get: () => ok({ settings: settings(), saved: null, updated_at: null, hq: true }),
    post: (body) => ok({ settings: settings(body), saved: body }),
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/me.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  localStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerProjects',
    'SeganOrders',
    'SeganProductionPlan',
    'SeganProductionWorkers',
    'SeganProductionSettings',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
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
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      type: (init.headers || {})['Content-Type'],
      cache: init.cache,
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/production/settings')
      return reply(await (method === 'POST' ? opts.post(body) : opts.get()));
    if (url === WORK + '/company/projects') return reply(opts.projects);
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/work/me') return reply(ok({ ready: true, worker: null }));
    return reply(fail(404, 'not_found', 'x'));
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
    'segan/orders.js',
    'segan/production-settings.js',
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
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
/** 화면에 보이는가 — 모듈이 감춘 칸(hidden) · 마이페이지가 끈 칸(me-off) 은 아니다 */
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const box = () => $('productionSettings');
const field = (g, k) => $(`ps-${g}-${k}`);
const groups = () =>
  [...box().querySelectorAll('[data-ps-group]')].map((el) => el.getAttribute('data-ps-group'));
const labelsOf = (g) =>
  [...box().querySelectorAll(`[data-ps-group="${g}"] label > span`)].map(text);
const saveBtns = () => [...box().querySelectorAll('[data-act="save"]')];
const msgs = () => [...box().querySelectorAll('[data-ps="msg"]')].map(text);
const notes = () => [...box().querySelectorAll(':scope > p.mk-note')].map(text);
const partIds = () =>
  [...$('meParts').querySelectorAll('a[data-me-part]')].map((a) => a.getAttribute('data-me-part'));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const press = async (el) => {
  el.click();
  await flush();
};
const go = async (hash) => {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await flush();
};
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/production/'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));
const posts = (calls) =>
  calls.fetch.filter((c) => c.method === 'POST' && c.url === WORK + '/production/settings');

afterEach(() => {
  jest.restoreAllMocks();
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 외주 발주 다음 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('productionSettings');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    expect(el.classList.contains('od')).toBe(true);
    expect(el.classList.contains('ps')).toBe(true);
    expect(el.previousElementSibling.id).toBe('outsourceOrders');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    // 없으면(-1) 차례 비교가 거짓으로 통과하지 않게 자리부터 본다
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['production-settings.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('production-settings.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'production-settings.js')");
  });

  test('칸 이름 · 묶음은 PC 화면(production.html)과 같다 — 빠진 칸도 더한 칸도 없다', () => {
    const P = names();
    const pc = read('production.html');
    const at = pc.indexOf('var LABELS = {');
    expect(at).toBeGreaterThanOrEqual(0);
    const block = pc.slice(at, pc.indexOf('};', at));
    // PC 화면의 LABELS 에서 '키: 이름' 을 묶음째 읽는다
    const pcLabels = {};
    let group = '';
    for (const line of block.split('\n')) {
      const g = /^\s*(\w+):\s*\{/.exec(line);
      if (g) {
        group = g[1];
        pcLabels[group] = pcLabels[group] || {};
      }
      const re = /(\w+):\s*'([^']*)'/g;
      let m;
      while ((m = re.exec(line))) if (group) pcLabels[group][m[1]] = m[2];
    }
    expect(Object.keys(pcLabels).sort()).toEqual([...P.GROUPS].sort());
    for (const g of P.GROUPS) expect(P.LABELS[g]).toEqual(pcLabels[g]);
    expect(Object.keys(P.GROUP_TITLE)).toEqual(P.GROUPS);
  });

  test('설정을 기기에 남기지 않는다 — 저장소 · 알림을 쓰지 않고, 확인 창도 띄우지 않는다', () => {
    // 머리말의 설명 글은 빼고 본다 — 코드가 쓰는지만
    const code = read('segan/production-settings.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/production\.html['"]/); // PC 화면으로 보내지 않는다
  });

  test('폰 — 칸은 화면 폭 안에서 줄을 바꾼다 (좁은 칸이 화면을 밀지 않게) · 그림자 없음', () => {
    const css = read('segan/shell.css');
    const grid = /\.ps-grid\s*\{[^}]*\}/.exec(css);
    expect(grid).not.toBeNull();
    expect(grid[0]).toMatch(/repeat\(auto-fill,\s*minmax\(220px,\s*1fr\)\)/);
    expect(/\.ps-field\s*\{[^}]*min-width:\s*0/.test(css)).toBe(true);
    // 이 화면 규칙(.ps-*)을 모두 모아 본다 — 못 찾으면 빈 글로 거짓 통과하지 않게 개수부터 센다
    const rules = css.match(/(^|\n)\.ps-[^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(8);
    expect(rules.join('\n')).not.toMatch(/box-shadow|border-radius/);
  });
});

describe('순수 함수', () => {
  test('canSee — 다담 공장 구성원 · 협력업체 대표 · 실장만 (본사 구성원 · 직원 · 고객은 아니다)', () => {
    const P = names();
    expect(P.canSee({ hq_member: true })).toBe(true);
    expect(P.canSee({ company: { role: 'owner' } })).toBe(true);
    expect(P.canSee({ company: { role: 'manager' } })).toBe(true);
    expect(P.canSee({ company: { role: 'staff' } })).toBe(false);
    expect(P.canSee({ company: { role: 'designer' } })).toBe(false);
    expect(P.canSee({ platform_member: true })).toBe(false);
    expect(P.canSee({ platform_member: true, company: { role: 'owner' } })).toBe(false);
    expect(P.canSee({ company: null })).toBe(false);
    expect(P.canSee({ hq_member: 'true' })).toBe(false);
    for (const v of [null, undefined, '', 0, [], 'x']) expect(P.canSee(v)).toBe(false);
  });

  test('bodyOf — 빈 숫자 칸은 뺀다 · 상판 업체는 빈 글도 · 그 밖의 업체는 적은 것만 · 모르는 칸은 뺀다', () => {
    const P = names();
    const inp = (g, k, value) => ({
      value,
      getAttribute: (n) => (n === 'data-g' ? g : n === 'data-k' ? k : null),
    });
    const body = P.bodyOf(
      [
        inp('standards', 'cutPerSheet', '310'),
        inp('standards', 'cutPerJob', ''),
        inp('crew', 'util', ' 0.75 '),
        inp('costs', 'assemblerDay', '0'),
        inp('vendors', 'door', '  가람 도어  '),
        inp('vendors', 'cutEdge', '   '),
        inp('vendors', 'topMarble', ''),
        inp('vendors', 'topStone', ' 라온 스톤 '),
        inp('quote', 'marginRate', '0.25'),
        inp('quote', 'nope', '1'),
        inp('nope', 'cutPerSheet', '1'),
        inp('__proto__', 'x', '1'),
      ],
      null
    );
    expect(body).toEqual({
      standards: { cutPerSheet: 310 },
      crew: { util: 0.75 },
      costs: { assemblerDay: 0 },
      leads: {},
      quote: { marginRate: 0.25 },
      vendors: { door: '가람 도어', topMarble: '', topStone: '라온 스톤' },
      countertop: {},
    });
    expect('holidays' in body).toBe(false);
  });

  test('bodyOf — 이 화면에 칸이 없는 공휴일 · 원판 기준은 저장돼 있던 그대로 싣는다 (이상한 값은 싣지 않는다)', () => {
    const P = names();
    const saved = { quote: { sheetBasis: 'nested', hinge: 9 }, holidays: ['2026-12-25'] };
    const body = P.bodyOf([], saved);
    expect(body.quote).toEqual({ sheetBasis: 'nested' }); // 칸이 있는 값은 칸에서만 온다
    expect(body.holidays).toEqual(['2026-12-25']);
    expect(body.holidays).not.toBe(saved.holidays);
    expect(P.bodyOf([], { quote: { sheetBasis: 'x' }, holidays: [] })).toEqual(P.bodyOf([], null));
    expect(P.bodyOf([], { quote: 'x', holidays: 'x' })).toEqual(P.bodyOf([], null));
    expect(P.bodyOf(null, [])).toEqual(P.bodyOf([], null));
  });

  test('fieldOf — 서버 글이 짚은 칸 (모르는 칸 · 다른 글은 null)', () => {
    const P = names();
    expect(P.fieldOf('crew.util 값이 범위를 벗어났습니다')).toEqual({ group: 'crew', key: 'util' });
    expect(P.fieldOf('vendors.door 는 1~40자 업체 이름이어야 합니다')).toEqual({
      group: 'vendors',
      key: 'door',
    });
    expect(P.fieldOf('알 수 없는 설정: quote.nope')).toBeNull();
    expect(P.fieldOf('quote.sheetBasis 값이 범위를 벗어났습니다')).toBeNull(); // 이 화면에 칸이 없다
    expect(P.fieldOf('holidays 는 날짜 목록이어야 합니다')).toBeNull();
    for (const v of ['', null, undefined, 7, {}]) expect(P.fieldOf(v)).toBeNull();
  });
});

describe('생산 설정 화면 — 다담 공장', () => {
  test('#p-config 에서 칸이 보이고, 제목이 화면 이름이 된다 · 처음에는 읽기만 한다', async () => {
    const calls = await load();
    expect(seen('productionSettings')).toBe(true);
    expect($('partner').hidden).toBe(false);
    expect(text($('productionSettingsTitle'))).toBe('생산 설정');
    expect($('partner').getAttribute('aria-labelledby')).toBe('productionSettingsTitle');
    expect($('meTitle').textContent).toBe('생산 설정');
    expect(asked(calls)).toEqual(['GET /production/settings']);
    const get = calls.fetch.find((c) => c.url === WORK + '/production/settings');
    expect(get.auth).toBe('Bearer tok-1');
    expect(get.cache).toBe('no-store');
    expect(get.type).toBeUndefined();
  });

  test('구역 단추 — 「생산 설정」이 지금 화면으로 표시된다 · 다른 화면에서는 칸을 끈다', async () => {
    await load();
    const on = $('meParts').querySelector('a[data-me-part="p-config"]');
    expect(on).not.toBeNull();
    expect($('meParts').hidden).toBe(false);
    expect(text(on)).toBe('생산 설정');
    expect(on.getAttribute('aria-current')).toBe('page');
    expect(on.getAttribute('href')).toBe('#p-config');
    // 생산 줄의 화면 차례 — 제작 다음 (생산 계획은 이 시험에서 싣지 않았다)
    expect(partIds()).toEqual(['p-make', 'p-config']);
    await go('#account');
    expect(seen('productionSettings')).toBe(false);
    await go('#p-config');
    expect(seen('productionSettings')).toBe(true);
  });

  test('묶음 일곱 — 차례 · 제목 · 칸 이름', async () => {
    await load();
    const P = window.SeganProductionSettings;
    expect(groups()).toEqual([
      'standards',
      'crew',
      'costs',
      'vendors',
      'countertop',
      'leads',
      'quote',
    ]);
    expect([...box().querySelectorAll('[data-ps-group] > h4.od-h')].map(text)).toEqual([
      '표준시간 (초)',
      '인력',
      '인건비 · 외주 단가 (원)',
      '외주 업체',
      '상판',
      '납기',
      '견적',
    ]);
    for (const g of P.GROUPS) expect(labelsOf(g)).toEqual(Object.values(P.LABELS[g]));
    expect(labelsOf('standards')[0]).toBe('재단 원판 1장');
    expect(labelsOf('vendors')).toContain('세라믹 상판 업체');
    expect(labelsOf('quote').length).toBe(27);
    expect(box().querySelectorAll('input[data-g][data-k]').length).toBe(
      P.GROUPS.reduce((n, g) => n + Object.keys(P.LABELS[g]).length, 0)
    );
  });

  test('칸 — 숫자 칸은 숫자 자판 · 업체 칸은 글 40자, 받은 값을 적는다 · 이름표가 칸에 이어진다', async () => {
    await load();
    const cut = field('standards', 'cutPerSheet');
    expect(cut.type).toBe('number');
    expect(cut.getAttribute('step')).toBe('any');
    expect(cut.getAttribute('inputmode')).toBe('decimal');
    expect(cut.value).toBe('100');
    expect(field('crew', 'util').value).toBe('201');
    expect(field('quote', 'marginRate').value).toBe('0.2');
    const door = field('vendors', 'door');
    expect(door.type).toBe('text');
    expect(door.getAttribute('maxlength')).toBe('40');
    expect(door.getAttribute('autocomplete')).toBe('off');
    expect(door.value).toBe('가람 도어');
    expect(field('vendors', 'topStone').value).toBe('');
    expect(cut.closest('label').getAttribute('for')).toBe('ps-standards-cutPerSheet');
    expect(cut.closest('label').classList.contains('mk-input')).toBe(true);
    // 이 화면에 칸이 없는 값은 그리지 않는다
    expect(field('quote', 'sheetBasis')).toBeNull();
    expect(box().querySelector('[data-g="holidays"]')).toBeNull();
  });

  test('값이 없거나 숫자가 아니면 빈 칸으로 둔다', async () => {
    await load({
      get: () =>
        ok({
          settings: settings({
            standards: { cutPerSheet: null, cutPerJob: 'abc', edgePerFace: '55' },
            vendors: { door: 7 },
          }),
          saved: null,
          hq: true,
        }),
    });
    expect(field('standards', 'cutPerSheet').value).toBe('');
    expect(field('standards', 'cutPerJob').value).toBe('');
    expect(field('standards', 'edgePerFace').value).toBe('55');
    expect(field('vendors', 'door').value).toBe('');
  });

  test('안내 글 — 단위 · 다시 계산 · 견적 묶음 · 빈 칸', async () => {
    await load();
    expect(notes()).toEqual([
      '시간은 초, 금액은 원(부가세 별도). 실제로 재 보고 바꾸면 추천이 정확해집니다. 저장한 뒤 생산 계획에서 「지금 다시 계산」을 누르세요.',
      '아래 「견적」 묶음은 상세설계 견적(장당 계산: BOM 수량 × 실제 원가 × (1 + 마진율))에 쓰입니다. 바꾸면 다음 스냅샷부터 반영됩니다.',
      '숫자 칸을 비우고 저장하면 그 값은 기본값으로 돌아갑니다.',
    ]);
  });

  test('「설정 저장」은 위 · 아래에 하나씩 — 결과 글은 단추 옆 (위는 알림 줄, 아래는 눈으로만)', async () => {
    await load();
    const btns = saveBtns();
    expect(btns.map(text)).toEqual(['설정 저장', '설정 저장']);
    for (const b of btns) {
      expect(b.type).toBe('button');
      expect(b.className).toBe('mk-btn mk-btn--solid');
    }
    const bars = [...box().querySelectorAll('.ps-bar')];
    expect(bars.length).toBe(2);
    // 위 줄은 묶음들 앞, 아래 줄은 마지막 묶음 뒤
    expect(bars[0].nextElementSibling.getAttribute('data-ps-group')).toBe('standards');
    expect(bars[1].previousElementSibling.getAttribute('data-ps-group')).toBe('quote');
    const [top, bottom] = bars.map((b) => b.querySelector('[data-ps="msg"]'));
    expect(top.getAttribute('role')).toBe('status');
    expect(top.hasAttribute('aria-hidden')).toBe(false);
    expect(bottom.getAttribute('aria-hidden')).toBe('true');
    expect(bottom.hasAttribute('role')).toBe(false);
    expect(msgs()).toEqual(['', '']);
  });
});

describe('저장', () => {
  test('고친 값을 PC 화면과 같은 꼴로 보낸다 — 빈 숫자 칸은 빼고, 상판 업체는 빈 글도', async () => {
    const calls = await load();
    type(field('standards', 'cutPerSheet'), '310');
    type(field('standards', 'cutPerJob'), '');
    type(field('crew', 'util'), '0.75');
    type(field('vendors', 'door'), '  새봄 도어 ');
    type(field('vendors', 'cutEdge'), '');
    await press(saveBtns()[0]);
    const sent = posts(calls);
    expect(sent.length).toBe(1);
    expect(sent[0].auth).toBe('Bearer tok-1');
    expect(sent[0].type).toBe('application/json');
    const body = sent[0].body;
    expect(Object.keys(body).sort()).toEqual([
      'costs',
      'countertop',
      'crew',
      'leads',
      'quote',
      'standards',
      'vendors',
    ]);
    expect(body.standards.cutPerSheet).toBe(310);
    expect('cutPerJob' in body.standards).toBe(false);
    expect(body.standards.edgePerFace).toBe(102); // 손대지 않은 칸은 받은 값 그대로
    expect(body.crew.util).toBe(0.75);
    expect(body.vendors).toEqual({
      door: '새봄 도어',
      topMarble: '다온 상판',
      topStone: '',
      topCeramic: '',
    });
    expect(body.quote.marginRate).toBe(0.2);
    expect('sheetBasis' in body.quote).toBe(false); // 저장된 적이 없으면 싣지 않는다
    for (const g of ['standards', 'crew', 'costs', 'leads', 'quote', 'countertop'])
      for (const v of Object.values(body[g])) expect(typeof v).toBe('number');
  });

  test('저장한 뒤 — 받은 설정으로 다시 그리고, 두 단추 옆에 결과 글', async () => {
    await load({
      post: (body) =>
        ok({ settings: settings({ ...body, standards: { cutPerSheet: 315 } }), saved: body }),
    });
    type(field('standards', 'cutPerSheet'), '310');
    await press(saveBtns()[1]); // 아래 단추도 같은 일을 한다
    expect(msgs()).toEqual([
      '설정을 저장했습니다. 생산 계획에서 「지금 다시 계산」을 누르면 반영됩니다.',
      '설정을 저장했습니다. 생산 계획에서 「지금 다시 계산」을 누르면 반영됩니다.',
    ]);
    expect(field('standards', 'cutPerSheet').value).toBe('315'); // 서버가 돌려준 값
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(seen('productionSettings')).toBe(true);
  });

  test('공휴일 · 원판 기준 — 이 화면에 칸이 없어도 저장돼 있던 그대로 다시 싣는다 (PC 저장처럼 지우지 않는다)', async () => {
    const saved = {
      crew: { cutters: 2 },
      quote: { sheetBasis: 'nested', hinge: 900 },
      holidays: ['2026-12-25', '2027-01-01'],
      tax: { vat: true },
    };
    const calls = await load({
      get: () =>
        ok({
          settings: settings({ quote: { sheetBasis: 'nested' } }),
          saved,
          hq: true,
        }),
    });
    await press(saveBtns()[0]);
    const body = posts(calls)[0].body;
    expect(body.quote.sheetBasis).toBe('nested');
    expect(body.holidays).toEqual(['2026-12-25', '2027-01-01']);
    expect('tax' in body).toBe(false); // 과세 설정은 서버가 지킨다 — 보내지 않는다
    // 두 번째 저장에도 서버가 돌려준 저장값에서 다시 싣는다
    await press(saveBtns()[0]);
    const again = posts(calls)[1].body;
    expect(again.quote.sheetBasis).toBe('nested');
    expect(again.holidays).toEqual(['2026-12-25', '2027-01-01']);
  });

  test('저장하는 동안 다시 눌러도 한 번만 보낸다', async () => {
    let release;
    const wait = new Promise((r) => (release = r));
    const calls = await load({
      post: async (body) => {
        await wait;
        return ok({ settings: settings(body), saved: body });
      },
    });
    saveBtns()[0].click();
    await flush();
    expect(msgs()).toEqual(['저장하는 중입니다.', '저장하는 중입니다.']);
    expect(box().getAttribute('aria-busy')).toBe('true');
    saveBtns()[0].click();
    saveBtns()[1].click();
    await flush();
    expect(posts(calls).length).toBe(1);
    release();
    await flush();
    expect(posts(calls).length).toBe(1);
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(msgs()[0]).toContain('설정을 저장했습니다.');
  });

  test('서버가 칸을 짚어 거절 — 칸 이름을 붙여 알리고, 그 칸에 표시하고 그리로 간다 · 적은 값은 그대로', async () => {
    await load({
      post: () => fail(400, 'invalid', 'crew.util 값이 범위를 벗어났습니다'),
    });
    type(field('crew', 'util'), '7');
    type(field('standards', 'cutPerSheet'), '310');
    await press(saveBtns()[0]);
    const want = '「실작업 비율 (0~1)」 — crew.util 값이 범위를 벗어났습니다';
    expect(msgs()).toEqual([want, want]);
    const util = field('crew', 'util');
    expect(util.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(util);
    expect(box().querySelectorAll('[aria-invalid="true"]').length).toBe(1);
    expect(util.value).toBe('7');
    expect(field('standards', 'cutPerSheet').value).toBe('310');
    // 칸 아래에도 까닭을 적는다 (저장 단추가 화면 밖일 수 있다) — 칸이 그 글을 가리킨다
    const why = box().querySelectorAll('.ps-err');
    expect(why.length).toBe(1);
    expect(why[0].textContent).toBe('crew.util 값이 범위를 벗어났습니다');
    expect(why[0].parentNode).toBe(util.parentNode);
    expect(util.getAttribute('aria-describedby')).toBe(why[0].id);
    // 고치기 시작하면 표시를 지운다
    type(util, '0.7');
    expect(util.hasAttribute('aria-invalid')).toBe(false);
    expect(util.hasAttribute('aria-describedby')).toBe(false);
    expect(box().querySelectorAll('.ps-err').length).toBe(0);
  });

  test('거절이 이어지면 표시는 새로 짚은 칸 하나에만 남는다', async () => {
    let n = 0;
    await load({
      post: () =>
        n++ === 0
          ? fail(400, 'invalid', 'crew.util 값이 범위를 벗어났습니다')
          : fail(400, 'invalid', 'leads.doorLeadDays 값이 범위를 벗어났습니다'),
    });
    await press(saveBtns()[0]);
    await press(saveBtns()[0]);
    expect(box().querySelectorAll('[aria-invalid]').length).toBe(1);
    expect(field('leads', 'doorLeadDays').getAttribute('aria-invalid')).toBe('true');
    expect(field('crew', 'util').hasAttribute('aria-describedby')).toBe(false);
    const why = box().querySelectorAll('.ps-err');
    expect(why.length).toBe(1);
    expect(why[0].parentNode).toBe(field('leads', 'doorLeadDays').parentNode);
  });

  test('다시 저장하면 앞선 표시를 지운다', async () => {
    let n = 0;
    await load({
      post: (body) =>
        n++ === 0
          ? fail(400, 'invalid', 'vendors.door 는 1~40자 업체 이름이어야 합니다')
          : ok({ settings: settings(body), saved: body }),
    });
    await press(saveBtns()[0]);
    expect(field('vendors', 'door').getAttribute('aria-invalid')).toBe('true');
    expect(msgs()[0]).toBe('「도어 외주 업체」 — vendors.door 는 1~40자 업체 이름이어야 합니다');
    await press(saveBtns()[0]);
    expect(box().querySelectorAll('[aria-invalid]').length).toBe(0);
    expect(msgs()[0]).toContain('설정을 저장했습니다.');
  });

  test('칸을 짚지 않은 거절 · 글 없는 오류 · 끊김 — 글만 알리고 칸은 그대로 둔다', async () => {
    await load({ post: () => fail(403, 'not_money', '원가 설정은 팩토리 대표 · 실장만 다룹니다') });
    type(field('crew', 'cutters'), '3');
    await press(saveBtns()[0]);
    expect(msgs()[0]).toBe('원가 설정은 팩토리 대표 · 실장만 다룹니다');
    expect(box().querySelectorAll('[aria-invalid]').length).toBe(0);
    expect(field('crew', 'cutters').value).toBe('3');
    expect(seen('productionSettings')).toBe(true);

    await load({ post: () => ({ ok: false, status: 500, body: {} }) });
    await press(saveBtns()[0]);
    expect(msgs()).toEqual([
      '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
      '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    ]);

    await load({ post: () => new Error('끊김') });
    await press(saveBtns()[0]);
    expect(msgs()[0]).toBe('처리하지 못했습니다. 잠시 뒤 다시 해 주세요.');
    expect(box().hasAttribute('aria-busy')).toBe(false);
  });

  test('업체 이름 속 꺾쇠는 글자로만 그린다', async () => {
    await load({
      get: () =>
        ok({
          settings: settings({ vendors: { door: '"><img src=x onerror=1>' } }),
          saved: null,
          hq: true,
        }),
    });
    expect(box().querySelector('img')).toBeNull();
    expect(field('vendors', 'door').value).toBe('"><img src=x onerror=1>');
  });
});

describe('협력업체', () => {
  test('대표 — 생산 › 「생산 설정」이 보이고, 안내 글이 협력업체용이다', async () => {
    const calls = await load({
      partner: PARTNER,
      get: () => ok({ settings: settings(), saved: null, hq: false }),
    });
    expect(asked(calls)).toEqual(['GET /production/settings']);
    expect(seen('productionSettings')).toBe(true);
    expect(notes()[0]).toBe(
      '시간은 초, 금액은 원(부가세 별도). 우리 업체의 견적 · 외주 발주 설정입니다. 생산 계획 · 인력 추천 · Slack 지시는 다담 공장만 씁니다.'
    );
    expect(groups().length).toBe(7);
    expect($('meParts').querySelector('a[data-me-part="p-config"]')).not.toBeNull();
    expect(partIds()).toEqual(['p-make', 'p-config']); // 생산 계획은 다담 공장만
  });

  test('대표 — 저장하면 「다시 계산」 없는 결과 글', async () => {
    const calls = await load({
      partner: PARTNER,
      get: () => ok({ settings: settings(), saved: null, hq: false }),
    });
    type(field('quote', 'marginRate'), '0.3');
    await press(saveBtns()[0]);
    expect(posts(calls)[0].body.quote.marginRate).toBe(0.3);
    expect(msgs()).toEqual(['설정을 저장했습니다.', '설정을 저장했습니다.']);
    expect(notes()[0]).toContain('우리 업체의 견적 · 외주 발주 설정입니다.');
  });

  test('실장도 본다 · 직원에게는 묻지 않고 칸도 없다', async () => {
    const manager = await load({
      partner: partnerOf('manager'),
      get: () => ok({ settings: settings(), saved: null, hq: false }),
    });
    expect(asked(manager)).toEqual(['GET /production/settings']);
    expect(seen('productionSettings')).toBe(true);

    const staff = await load({ partner: partnerOf('staff') });
    expect(asked(staff)).toEqual([]);
    expect(seen('productionSettings')).toBe(false);
    expect(box().innerHTML).toBe('');
    expect(document.querySelector('a[data-me-part="p-config"]')).toBeNull();
  });
});

describe('안 보이는 때', () => {
  test('다담 본사 구성원 — 묻지 않는다', async () => {
    const calls = await load({
      partner: ok({
        company: null,
        application: null,
        members: [],
        invites: [],
        platform_member: true,
      }),
    });
    expect(asked(calls)).toEqual([]);
    expect(seen('productionSettings')).toBe(false);
    expect(document.querySelector('a[data-me-part="p-config"]')).toBeNull();
  });

  test('업체가 없는 사람 · 로그인하지 않은 사람 — 묻지 않는다', async () => {
    const none = await load({
      partner: ok({ company: null, application: null, members: [], invites: [] }),
    });
    expect(asked(none)).toEqual([]);
    expect(seen('productionSettings')).toBe(false);
    const out = await load({ session: null });
    expect(asked(out)).toEqual([]);
    expect(seen('productionSettings')).toBe(false);
  });

  test('서버가 내주지 않으면(403) · 오류 · 끊김 · 설정 없는 답 — 칸째 감추고 구역 단추도 없다', async () => {
    for (const get of [
      () => fail(403, 'not_money', '원가 설정은 팩토리 대표 · 실장만 다룹니다'),
      () => ({ ok: false, status: 500, body: {} }),
      () => new Error('끊김'),
      () => ok({ saved: null, hq: true }),
      () => ok({ settings: [], saved: null, hq: true }),
      () => ok(null),
    ]) {
      const calls = await load({ get });
      expect(asked(calls)).toEqual(['GET /production/settings']);
      expect(seen('productionSettings')).toBe(false);
      expect(box().hidden).toBe(true);
      expect(box().innerHTML).toBe('');
      expect(document.querySelector('a[data-me-part="p-config"]')).toBeNull();
    }
  });

  test('워커 주소가 없으면 묻지 않는다', async () => {
    const P = names();
    document.body.innerHTML =
      '<section id="partner" hidden><div id="productionSettings"></div></section>';
    window.DADAM_CONFIG = {};
    window.fetch = jest.fn();
    await P.load(null, SESSION, { hq_member: true });
    expect(window.fetch).not.toHaveBeenCalled();
    expect($('productionSettings').hidden).toBe(true);
    expect($('partner').hidden).toBe(true);
  });
});
