/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「기준정보 › 가전 모델」 (segan/appliance-list.js + segan/me.html #applianceList)
 *
 *   누가    사이트 관리자(is_admin)만. 관리자가 아니면 칸을 열지 않는다
 *   데이터  Supabase 표 appliance_models — 종류 하나씩 읽기만 (화면을 열었을 때 처음 읽는다)
 *   화면    종류 단추 열넷 · 찾기 · 세부 구분 · 몇 개 · 모델 줄 · 더 보기 — 보기 · 찾기만 (2026-11-11 대표님 결정)
 *   넣기 · 고치기 · 지우기 · 사진 가져오기는 PC 화면(admin/appliances.html)에 그대로 — 링크 하나
 *   브랜드 · 모델 이름 · 코드는 모두 지어낸 것이다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'admin@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const NOW = Date.parse('2026-11-11T03:00:00Z');

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const PLATFORM = ok({
  company: null,
  application: null,
  members: [],
  invites: [],
  platform_member: true,
});

const mod = () => {
  delete window.SeganApplianceList;
  (0, eval)(read('segan/appliance-list.js'));
  return window.SeganApplianceList;
};

/** appliance_models 한 줄 (표와 같은 꼴) */
const am = (id, category, brand, name, patch = {}) => ({
  id,
  category,
  brand,
  model_name: name,
  model_code: null,
  model_codes: null,
  subtype: null,
  line: null,
  install_type: null,
  gas_types: null,
  width_mm: null,
  depth_mm: null,
  height_mm: null,
  capacity_l: null,
  side_gap_mm: null,
  top_gap_mm: null,
  back_gap_mm: null,
  niche_min_w_mm: null,
  niche_min_h_mm: null,
  niche_min_d_mm: null,
  niche_max_w_mm: null,
  niche_max_h_mm: null,
  niche_max_d_mm: null,
  verified: false,
  image_path: null,
  image_approved_at: null,
  image_source_url: null,
  ...patch,
});
const FRIDGES = () => [
  am('f-1', 'refrigerator', '예시전자', '예시 4도어 615L', {
    model_code: 'EX-RF61A',
    model_codes: ['EX-RF61A', 'EX-RF61B', 'EX-RF61C'],
    subtype: 'french_4door',
    line: '예시 컬렉션',
    install_type: 'kitchen_fit',
    width_mm: 912,
    depth_mm: 697,
    height_mm: 1853,
    capacity_l: 615,
    side_gap_mm: 4,
    top_gap_mm: 20,
    back_gap_mm: 25,
    verified: true,
    image_path: 'refrigerator/예시 a.jpg',
    image_approved_at: '2026-10-20T01:00:00Z',
    image_source_url: 'https://maker.example.com/a.jpg',
  }),
  am('f-2', 'refrigerator', '보기가전', '보기 빌트인', {
    model_code: 'BG-BI30',
    subtype: 'built_in',
    install_type: 'built_in',
    width_mm: 595,
    depth_mm: 545,
    height_mm: 1770,
    niche_min_w_mm: 560,
    niche_max_w_mm: 570,
    niche_min_h_mm: 1775,
    niche_min_d_mm: 550,
    image_source_url: 'https://maker.example.com/b.jpg',
  }),
  am('f-3', 'refrigerator', '보기가전', '보기 소형', {
    width_mm: 480,
    depth_mm: 520,
    height_mm: 850,
  }),
];
const COOKTOPS = () => [
  am('c-1', 'cooktop', '예시전자', '예시 가스 3구', {
    subtype: 'gas',
    gas_types: ['LNG', 'LPG'],
    width_mm: 600,
    depth_mm: 510,
    height_mm: 110,
  }),
];
const many = (n) =>
  Array.from({ length: n }, (_, i) =>
    am('m-' + i, 'refrigerator', '예시전자', '모델 ' + String(i).padStart(3, '0'), {
      width_mm: 600 + i,
      depth_mm: 600,
      height_mm: 1800,
    })
  );

/**
 * 마이페이지를 띄운다 (기본 = 사이트 관리자인 본사 구성원, 가전 모델 화면)
 * opts.table(category, n) 로 표 답을 바꾼다 ({ data, error } — n = 몇 번째 읽기인가) · opts.gate = 읽기를 붙잡아 둘 약속
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    hash: '#appliances',
    isAdmin: true,
    table: null,
    gate: null,
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
    'SeganPartnerEval',
    'SeganDoneReports',
    'SeganAsStatus',
    'SeganApplianceList',
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
  const calls = { fetch: [], table: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) =>
        name === 'is_admin' ? { data: opts.isAdmin, error: null } : { data: [], error: null },
      from: (table) => {
        const q = { table, select: null, eq: [], order: [], writes: [] };
        const answer = async () => {
          if (table !== 'appliance_models') return { data: [], error: null };
          calls.table.push(q);
          const n = calls.table.length;
          if (opts.gate) await opts.gate;
          const cat = (q.eq.find((e) => e[0] === 'category') || [])[1];
          if (opts.table) {
            const r = await opts.table(cat, n);
            if (r instanceof Error) throw r;
            return r;
          }
          return {
            data: cat === 'cooktop' ? COOKTOPS() : cat === 'refrigerator' ? FRIDGES() : [],
            error: null,
          };
        };
        const chain = {
          select: (cols) => {
            q.select = cols;
            return chain;
          },
          eq: (k, v) => {
            q.eq.push([k, v]);
            return chain;
          },
          order: (k) => {
            q.order.push(k);
            return chain;
          },
          limit: () => chain,
          insert: () => {
            q.writes.push('insert');
            return chain;
          },
          update: () => {
            q.writes.push('update');
            return chain;
          },
          delete: () => {
            q.writes.push('delete');
            return chain;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve, reject) => answer().then(resolve, reject),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.fetch.push({ url, method: init.method || 'GET' });
    const reply = (r) => ({ ok: r.ok, status: r.status, json: async () => r.body });
    if (url === ACC + '/partner/me') return reply(PLATFORM);
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
    'segan/appliance-list.js',
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
const box = () => $('applianceListBody');
const q = (sel) => box().querySelector(sel);
const qa = (sel) => [...box().querySelectorAll(sel)];
const part = (name) => q(`[data-al="${name}"]`);
const catBtn = (k) => q(`[data-act="cat"][data-cat="${k}"]`);
const rows = () => qa('li[data-al-row]');
const names = () => rows().map((li) => text(li.querySelector('b')));
const facts = (li) =>
  Object.fromEntries(
    [...li.querySelectorAll('.al-facts > div')].map((d) => [
      text(d.querySelector('dt')),
      text(d.querySelector('dd')),
    ])
  );
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const type = (value) => {
  $('alSearch').value = value;
  $('alSearch').dispatchEvent(new Event('input', { bubbles: true }));
};
const pickSub = (value) => {
  $('alSub').value = value;
  $('alSub').dispatchEvent(new Event('change', { bubbles: true }));
};

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — A/S 현황 다음의 제 칸 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('applianceList');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('SECTION');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.classList.contains('me-screen')).toBe(true);
    expect(el.previousElementSibling.id).toBe('asStatus');
    expect(el.getAttribute('aria-labelledby')).toBe('applianceListTitle');
    expect(text(doc.getElementById('applianceListTitle'))).toBe('가전 모델');
    expect(doc.getElementById('applianceListBody').parentElement).toBe(el);
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['appliance-list.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('appliance-list.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'appliance-list.js')");
  });

  test('메뉴 — 기준정보 아래 앱 화면 줄, 바로 다음에 관리자 PC 화면 줄 (둘 다 처음엔 감춘다)', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const li = doc.querySelector('li[data-me-item="appliances"]');
    expect(li).not.toBeNull();
    expect(li.closest('ul').id).toBe('meSubMaster');
    expect(li.hasAttribute('hidden')).toBe(true);
    const a = li.querySelector('a');
    expect(a.getAttribute('href')).toBe('#appliances');
    expect(a.getAttribute('data-me-go')).toBe('appliances');
    expect(text(a)).toBe('가전 모델');
    const pc = li.nextElementSibling;
    expect(pc.getAttribute('data-me-item')).toBe('hq-appliances');
    expect(pc.hasAttribute('hidden')).toBe(true);
    expect(pc.hasAttribute('data-need')).toBe(false);
    expect(pc.querySelector('a').getAttribute('href')).toBe('../admin/appliances.html');
    expect(pc.querySelector('a').hasAttribute('data-desktop-tab')).toBe(true);
  });

  test('종류 · 세부 구분 · 설치 방식 이름은 PC 화면(admin/appliances.html)과 같다', () => {
    const A = mod();
    const pc = read('admin/appliances.html');
    // 종류 — PC 탭 차례 그대로
    const tabs = [
      ...pc.matchAll(/<button(?: type="button")? data-cat="([a-z_]+)"[^>]*>([^<]+)<\/button>/g),
    ].map((m) => [m[1], m[2].replace(/^[^가-힣A-Za-z]+/, '').trim()]);
    expect(tabs.length).toBe(14);
    expect(A.CATEGORIES).toEqual(tabs);
    // 세부 구분 — 종류마다 키 · 이름
    for (const [cat, subs] of Object.entries(A.SUBTYPES)) {
      for (const [k, v] of Object.entries(subs)) {
        expect(pc).toContain(`${k}: '${v}'`);
      }
      expect(A.CATEGORIES.some((c) => c[0] === cat)).toBe(true);
    }
    expect(Object.keys(A.SUBTYPES).length).toBe(12);
    expect(A.INSTALL_LABEL).toEqual({
      freestanding: '일반',
      kitchen_fit: '키친핏',
      built_in: '빌트인',
    });
    expect(pc).toContain("{ freestanding: '일반', kitchen_fit: '키친핏', built_in: '빌트인' }");
    expect(pc).toContain("PHOTO_BUCKET = 'appliance-images'");
    for (const key of ['subAll', 'subNone', 'empty']) expect(pc).toContain(A.TEXT[key]);
  });

  test('보기만 한다 — 표에 쓰지 않고, 제조사 서버에 묻지 않고, 기기에 남기지 않는다', () => {
    const code = read('segan/appliance-list.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(code).not.toMatch(/\bfetch\(/); // 사진 가져오기(워커)도 부르지 않는다
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
  });

  test('폰 — 긴 모델명은 줄을 바꾼다 · 그림자 · 둥근 모서리 없음', () => {
    const css = read('segan/shell.css');
    const name = /\.al-head \.me-c-main b,\s*\.al-head \.me-c-main small\s*\{[^}]*\}/.exec(css);
    expect(name).not.toBeNull();
    expect(name[0]).toMatch(/white-space:\s*normal/);
    expect(name[0]).toMatch(/overflow-wrap:\s*anywhere/);
    const rules = css.match(/(^|\n)\.al[-\s][^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(12);
    expect(rules.join('\n')).not.toMatch(/box-shadow|border-radius/);
  });
});

describe('순수 함수', () => {
  test('rowOf — 이름 없는 줄은 버린다. 숫자가 아닌 치수는 null, 사진 원본은 https 주소만', () => {
    const A = mod();
    expect(A.rowOf(null)).toBeNull();
    expect(A.rowOf({ id: 'x' })).toBeNull();
    expect(A.rowOf({ brand: 'a', model_name: 'b' })).toBeNull();
    const r = A.rowOf({
      id: 7,
      category: 'hood',
      brand: ' 예시 ',
      model_name: '후드',
      width_mm: '900',
      depth_mm: 500,
      model_codes: ['A', null, ' B '],
      gas_types: 'LNG',
      verified: 'true',
      image_source_url: 'http://maker.example.com/a.jpg',
    });
    expect(r).toMatchObject({
      id: '7',
      brand: '예시',
      name: '후드',
      w: null,
      d: 500,
      codes: ['A', 'B'],
      gas: [],
      verified: false,
      hasSource: false,
    });
  });

  test('subOf · sizeText · codeText', () => {
    const A = mod();
    const [a, b, c] = FRIDGES().map(A.rowOf);
    expect(A.subOf(a)).toBe('4도어 · 예시 컬렉션 · 키친핏');
    expect(A.subOf(c)).toBe('');
    expect(A.subOf(A.rowOf(COOKTOPS()[0]))).toBe('가스 · LNG/LPG');
    expect(
      A.subOf(
        A.rowOf(am('x', 'hood', 'a', 'b', { subtype: 'toString', install_type: 'constructor' }))
      )
    ).toBe('');
    expect(A.sizeText(a)).toBe('912 × 697 × 1853 mm');
    expect(A.sizeText(A.rowOf(am('x', 'faucet', 'a', 'b')))).toBe('');
    expect(A.sizeText(A.rowOf(am('x', 'hood', 'a', 'b', { width_mm: 900 })))).toBe(
      '900 × ? × ? mm'
    );
    expect(A.codeText(a)).toBe('EX-RF61A 외 2개');
    expect(A.codeText(b)).toBe('BG-BI30');
    expect(A.codeText(c)).toBe('');
  });

  test('gapText · nicheText — 자리 = W + 2 × 좌우 · H + 위, 니치는 한 값 또는 최소~최대', () => {
    const A = mod();
    const [a, b, c] = FRIDGES().map(A.rowOf);
    expect(A.gapText(a)).toBe('좌우 4 · 위 20 · 뒤 25 (자리 920 × 1873)');
    expect(A.gapText(c)).toBe('');
    expect(
      A.gapText(
        A.rowOf(am('x', 'hood', 'a', 'b', { width_mm: 600, height_mm: 500, top_gap_mm: 30 }))
      )
    ).toBe('위 30 (자리 600 × 530)');
    expect(A.gapText(A.rowOf(am('x', 'hood', 'a', 'b', { back_gap_mm: 0 })))).toBe('뒤 0');
    expect(A.nicheText(b)).toBe('장 560~570 × 1775 × 550');
    expect(A.nicheText(a)).toBe('');
    expect(A.nicheText(A.rowOf(am('x', 'oven', 'a', 'b', { niche_min_h_mm: 590 })))).toBe(
      '장 ? × 590 × ?'
    );
  });

  test('photoUrl — 가져온 사진만, 경로 조각마다 인코딩 + 승인 시각', () => {
    const A = mod();
    window.DADAM_CONFIG = { supabase: { url: 'https://example.supabase.co/' } };
    const [a, b] = FRIDGES().map(A.rowOf);
    expect(A.photoUrl(a)).toBe(
      'https://example.supabase.co/storage/v1/object/public/appliance-images/refrigerator/' +
        encodeURIComponent('예시 a.jpg') +
        '?v=' +
        encodeURIComponent('2026-10-20T01:00:00Z')
    );
    expect(A.photoUrl(b)).toBe(''); // 원본 주소만 있는 모델
    window.DADAM_CONFIG = {};
    expect(A.photoUrl(a)).toBe('');
  });

  test('filtered · countText — 브랜드 · 모델명 · 라인 · 코드(변형 포함)로 찾고, 세부 구분으로 거른다', () => {
    const A = mod();
    const list = FRIDGES().map(A.rowOf);
    const ids = (q, sub, cat = 'refrigerator') => A.filtered(list, q, sub, cat).map((r) => r.id);
    expect(ids('', '')).toEqual(['f-1', 'f-2', 'f-3']);
    expect(ids('  보기가전 ', '')).toEqual(['f-2', 'f-3']);
    expect(ids('컬렉션', '')).toEqual(['f-1']);
    expect(ids('ex-rf61c', '')).toEqual(['f-1']); // 변형 코드 · 대소문자
    expect(ids('', 'built_in')).toEqual(['f-2']);
    expect(ids('', '_none')).toEqual(['f-3']);
    expect(ids('보기', 'french_4door')).toEqual([]);
    expect(ids('', 'built_in', 'faucet')).toEqual(['f-1', 'f-2', 'f-3']); // 세부 구분이 없는 종류는 거르지 않는다
    expect(A.countText(3, 3)).toBe('3개');
    expect(A.countText(1, 3)).toBe('1개 / 전체 3개');
  });
});

describe('화면', () => {
  test('관리자가 화면을 열면 — 냉장고를 한 번 읽어 줄을 그린다 (PC 화면과 같은 조회 · 읽기만)', async () => {
    const calls = await load();
    expect(calls.table.length).toBe(1);
    expect(calls.table[0]).toEqual({
      table: 'appliance_models',
      select: '*',
      eq: [['category', 'refrigerator']],
      order: ['brand', 'model_name'],
      writes: [],
    });
    expect(seen('applianceList')).toBe(true);
    expect(qa('[data-act="cat"]').map(text)).toEqual(
      window.SeganApplianceList.CATEGORIES.map((c) => c[1])
    );
    expect(catBtn('refrigerator').getAttribute('aria-pressed')).toBe('true');
    expect(catBtn('hood').getAttribute('aria-pressed')).toBe('false');
    expect(text(part('count'))).toBe('3개');
    expect(names()).toEqual([
      '예시전자 예시 4도어 615L',
      '보기가전 보기 빌트인',
      '보기가전 보기 소형',
    ]);
    const [a, b, c] = rows();
    expect(text(a.querySelector('small'))).toBe('4도어 · 예시 컬렉션 · 키친핏');
    expect(text(a.querySelector('.al-badge'))).toBe('검증');
    expect(a.querySelector('.al-badge').classList.contains('al-ok')).toBe(true);
    expect(text(c.querySelector('.al-badge'))).toBe('표준 추정');
    expect(facts(a)).toEqual({
      크기: '912 × 697 × 1853 mm',
      용량: '615 L',
      코드: 'EX-RF61A 외 2개',
      여유: '좌우 4 · 위 20 · 뒤 25 (자리 920 × 1873)',
    });
    expect(facts(b)).toEqual({
      크기: '595 × 545 × 1770 mm',
      코드: 'BG-BI30',
      여유: '장 560~570 × 1775 × 550',
    });
    expect(facts(c)).toEqual({ 크기: '480 × 520 × 850 mm' });
    expect(menu('appliances').hidden).toBe(false);
    expect(menu('hq-appliances').hidden).toBe(true);
  });

  test('사진 — 가져온 사진만 그린다. 원본 주소만 있으면 글로만 (제조사 서버에 묻지 않는다)', async () => {
    await load();
    const [a, b, c] = rows();
    const img = a.querySelector('img');
    expect(img.getAttribute('src')).toContain(
      '/storage/v1/object/public/appliance-images/refrigerator/'
    );
    expect(img.getAttribute('alt')).toBe('예시전자 예시 4도어 615L 가져온 사진');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(a.querySelector('.dr-note')).toBeNull();
    expect(b.querySelector('img')).toBeNull();
    expect(text(b.querySelector('.dr-note'))).toBe('사진 원본 주소만 있음');
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('.dr-note')).toBeNull();
    expect(box().innerHTML).not.toContain('maker.example.com');
  });

  test('PC 화면 링크 — 넣기 · 고치기는 PC 관리 화면에서', async () => {
    await load();
    const a = part('pc');
    expect(a.getAttribute('href')).toBe('../admin/appliances.html');
    expect(a.hasAttribute('data-desktop-tab')).toBe(true);
    expect(text(a.closest('p'))).toContain(
      '넣기 · 고치기 · 지우기 · 사진 가져오기는 PC 관리 화면에서 합니다'
    );
    // 고치는 단추가 없다
    expect(qa('button').map((b) => b.getAttribute('data-act'))).toEqual(Array(14).fill('cat'));
  });

  test('마이페이지 다른 화면에 있을 때는 읽지 않는다 — 메뉴 줄로 들어오면 그때 읽는다', async () => {
    const calls = await load({ hash: '' });
    expect(calls.table.length).toBe(0);
    expect(menu('appliances').hidden).toBe(false);
    window.location.hash = '#appliances';
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(calls.table.length).toBe(1);
    expect(seen('applianceList')).toBe(true);
    expect(rows().length).toBe(3);
    // 나갔다 다시 와도 다시 읽지 않는다
    window.location.hash = '#as-status';
    window.dispatchEvent(new Event('hashchange'));
    window.location.hash = '#appliances';
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(calls.table.length).toBe(1);
  });

  test('이름 · 코드는 글자 그대로 그린다', async () => {
    const list = FRIDGES();
    list[0].brand = '<img src=x onerror=1>';
    list[0].model_code = '<b>x</b>';
    list[0].image_path = null;
    await load({ table: () => ({ data: list, error: null }) });
    expect(q('img')).toBeNull();
    expect(text(rows()[0].querySelector('b'))).toBe('<img src=x onerror=1> 예시 4도어 615L');
    expect(facts(rows()[0])['코드']).toBe('<b>x</b> 외 3개');
  });
});

describe('종류 · 찾기 · 더 보기', () => {
  test('종류 단추 — 그 종류를 읽고, 읽은 종류는 다시 읽지 않는다. 세부 구분 목록은 그 종류 것', async () => {
    const calls = await load();
    expect([...$('alSub').options].map((o) => o.value)).toEqual([
      '',
      ...Object.keys(window.SeganApplianceList.SUBTYPES.refrigerator),
      '_none',
    ]);
    await press(catBtn('cooktop'));
    expect(calls.table.length).toBe(2);
    expect(calls.table[1].eq).toEqual([['category', 'cooktop']]);
    expect(catBtn('cooktop').getAttribute('aria-pressed')).toBe('true');
    expect(names()).toEqual(['예시전자 예시 가스 3구']);
    expect(text(rows()[0].querySelector('small'))).toBe('가스 · LNG/LPG');
    expect([...$('alSub').options].map((o) => text(o))).toEqual([
      '전체 구분',
      '인덕션',
      '하이라이트',
      '하이브리드',
      '가스',
      '구분 없음',
    ]);
    await press(catBtn('refrigerator'));
    await press(catBtn('cooktop'));
    expect(calls.table.length).toBe(2);
    // 세부 구분이 없는 종류(수전) — 고르는 칸이 없다
    await press(catBtn('faucet'));
    expect($('alSub')).toBeNull();
    expect(text(part('empty'))).toBe('데이터 없음');
    expect(text(part('count'))).toBe('0개');
  });

  test('찾기 · 세부 구분 — 서버에 묻지 않고 거른다. 찾는 칸은 다시 그리지 않는다', async () => {
    const calls = await load();
    const input = $('alSearch');
    type('보기');
    expect($('alSearch')).toBe(input);
    expect(names()).toEqual(['보기가전 보기 빌트인', '보기가전 보기 소형']);
    expect(text(part('count'))).toBe('2개 / 전체 3개');
    pickSub('built_in');
    expect(names()).toEqual(['보기가전 보기 빌트인']);
    pickSub('_none');
    expect(names()).toEqual(['보기가전 보기 소형']);
    type('없는 모델');
    expect(rows().length).toBe(0);
    expect(text(part('empty'))).toBe('데이터 없음');
    expect(text(part('count'))).toBe('0개 / 전체 3개');
    expect(calls.table.length).toBe(1);
    // 종류를 바꾸면 찾던 글 · 구분은 비운다
    await press(catBtn('cooktop'));
    expect($('alSearch').value).toBe('');
    expect($('alSub').value).toBe('');
  });

  test('더 보기 — 한 번에 PAGE 줄, 남은 수를 적고 이어 붙인다. 찾으면 처음부터', async () => {
    const A0 = mod();
    const n = A0.PAGE * 2 + 5;
    await load({ table: () => ({ data: many(n), error: null }) });
    const A = window.SeganApplianceList;
    expect(rows().length).toBe(A.PAGE);
    expect(text(q('[data-act="more"]'))).toBe(`더 보기 (남은 ${A.PAGE + 5}개)`);
    await press(q('[data-act="more"]'));
    expect(rows().length).toBe(A.PAGE * 2);
    expect(document.activeElement).toBe(rows()[A.PAGE]); // 새로 붙은 첫 줄
    await press(q('[data-act="more"]'));
    expect(rows().length).toBe(n);
    expect(q('[data-act="more"]')).toBeNull();
    type('모델 0'); // 모두 걸린다 — 보이는 줄 수는 처음으로 돌아간다
    expect(rows().length).toBe(A.PAGE);
    expect(text(part('count'))).toBe(`${n}개`);
    type('모델 00');
    expect(rows().length).toBe(10);
    expect(text(part('count'))).toBe(`10개 / 전체 ${n}개`);
    expect(q('[data-act="more"]')).toBeNull();
  });

  test('읽는 동안 — 종류 단추를 잠그고 「불러오는 중」', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const calls = await load({ gate });
    expect(text(part('loading'))).toBe('불러오는 중…');
    expect(box().getAttribute('aria-busy')).toBe('true');
    expect(qa('[data-act="cat"]').every((b) => b.disabled)).toBe(true);
    await press(catBtn('cooktop'));
    release();
    await flush();
    await flush();
    expect(calls.table.length).toBe(1);
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(rows().length).toBe(3);
  });
});

describe('못 읽을 때', () => {
  test('표가 오류를 주면 — 그 자리에 글과 「다시 읽기」. 다시 읽으면 줄이 나온다', async () => {
    const calls = await load({
      table: (cat, n) =>
        n === 1
          ? { data: null, error: { message: 'permission denied' } }
          : { data: FRIDGES(), error: null },
    });
    expect(seen('applianceList')).toBe(true);
    expect(text(part('failed'))).toBe('불러오지 못했습니다. (permission denied)');
    expect(rows().length).toBe(0);
    await press(q('[data-act="retry"]'));
    expect(calls.table.length).toBe(2);
    expect(part('failed')).toBeNull();
    expect(rows().length).toBe(3);
  });

  test('끊기거나 이상한 답 — 기본 글. 다른 종류는 읽을 수 있다', async () => {
    for (const first of [() => new Error('offline'), () => ({ data: 'x', error: null })]) {
      await load({
        table: (cat) => (cat === 'refrigerator' ? first() : { data: COOKTOPS(), error: null }),
      });
      expect(text(part('failed'))).toBe('불러오지 못했습니다.');
      await press(catBtn('cooktop'));
      expect(part('failed')).toBeNull();
      expect(rows().length).toBe(1);
    }
  });
});

describe('안 보이는 때', () => {
  test('관리자가 아닌 사람 · 로그인하지 않은 사람 — 칸을 열지 않고 표도 읽지 않는다. 메뉴 줄 둘 다 없다', async () => {
    for (const o of [{ isAdmin: false }, { session: null }]) {
      const calls = await load(o);
      expect(calls.table.length).toBe(0);
      expect(seen('applianceList')).toBe(false);
      expect(box().innerHTML).toBe('');
      expect(menu('appliances').hidden).toBe(true);
      expect(menu('hq-appliances').hidden).toBe(true);
    }
  }, 20000);
});
