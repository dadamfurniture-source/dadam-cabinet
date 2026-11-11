/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「플랫폼 › 완료 보고」 (segan/done-reports.js + segan/me.html #doneReports)
 *
 *   누가    사이트 관리자(is_admin)만. 관리자가 아니면 묻지도 않는다
 *   데이터  workflow-api GET /admin/order-reports?days=7|30|90
 *   화면    기간 단추 셋 · 「다시 읽기」 · 건수 · 보고 줄(때 · 팩토리 · 주문번호 · 종류 · 학습 · 메모 · 사진) — 보기만 한다
 *   못 읽으면 칸째 감춘다 — 관리자에게는 PC 화면 줄 하나가 남는다
 *   팩토리 이름 · 주문번호 · 메모 · 사진 주소는 모두 지어낸 것이다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'admin@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const NOW = Date.parse('2026-11-11T03:00:00Z'); // 한국 시간 2026-11-11 (수) 12:00

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
const NOBODY = ok({ company: null, application: null, members: [], invites: [] });

const mod = () => {
  delete window.SeganDoneReports;
  (0, eval)(read('segan/done-reports.js'));
  return window.SeganDoneReports;
};

const ITEMS = () => [
  {
    id: 'r-1',
    company_name: '예시 가온 팩토리',
    order_no: 'EX-2611-014',
    kind: 'install_done',
    label: '설치 완료',
    note: '상부장 수평 다시 맞춤',
    photo_urls: ['https://files.example.com/a1?sig=1&x=2', 'https://files.example.com/a2'],
    learn_ok: true,
    created_at: '2026-11-10T07:20:00Z',
  },
  {
    id: 'r-2',
    company_name: '다담 공장',
    order_no: 'EX-2611-009',
    kind: 'as_done',
    label: 'A/S 완료',
    note: null,
    photo_urls: [],
    learn_ok: false,
    created_at: '2026-11-08T02:05:00Z',
  },
  {
    id: 'r-3',
    company_name: null,
    order_no: null,
    kind: 'install_done',
    label: null,
    note: null,
    photo_urls: ['https://files.example.com/c1'],
    learn_ok: null,
    created_at: '2026-10-27T15:40:00Z',
  },
];
const feed = (days, items = ITEMS()) => ok({ ready: true, days, items });

/**
 * 마이페이지를 띄운다 (기본 = 사이트 관리자인 본사 구성원, 완료 보고 화면)
 * opts.list(days, n) 로 답을 바꾼다 (n = 몇 번째 읽기인가) · opts.gate = 둘째 읽기부터 붙잡아 둘 약속
 */
async function load(options = {}) {
  const store = { lists: 0 };
  const opts = {
    session: SESSION,
    partner: PLATFORM,
    hash: '#done-reports',
    isAdmin: true,
    list: null,
    gate: null,
    work: WORK,
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
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: opts.work },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [], store };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) =>
        name === 'is_admin' ? { data: opts.isAdmin, error: null } : { data: [], error: null },
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
      cache: init.cache,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url.startsWith(WORK + '/admin/order-reports?days=')) {
      store.lists += 1;
      const n = store.lists;
      const days = Number(url.split('days=')[1]);
      if (opts.gate && n > 1) await opts.gate;
      return reply(opts.list ? await opts.list(days, n) : feed(days));
    }
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
    'segan/done-reports.js',
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
const box = () => $('doneReportsBody');
const q = (sel) => box().querySelector(sel);
const qa = (sel) => [...box().querySelectorAll(sel)];
const part = (name) => q(`[data-dr="${name}"]`);
const dayBtn = (n) => q(`[data-act="days"][data-days="${n}"]`);
const rows = () => qa('li[data-dr-row]');
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/admin/order-reports'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 팩토리 평가 다음의 제 칸 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('doneReports');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('SECTION');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.classList.contains('me-screen')).toBe(true);
    expect(el.previousElementSibling.id).toBe('partnerEval');
    expect(el.getAttribute('aria-labelledby')).toBe('doneReportsTitle');
    expect(text(doc.getElementById('doneReportsTitle'))).toBe('완료 보고');
    expect(doc.getElementById('doneReportsBody').parentElement).toBe(el);
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['done-reports.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('done-reports.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'done-reports.js')");
  });

  test('메뉴 — 플랫폼 아래 앱 화면 줄, 바로 다음에 관리자 PC 화면 줄 (둘 다 처음엔 감춘다)', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const li = doc.querySelector('li[data-me-item="done-reports"]');
    expect(li).not.toBeNull();
    expect(li.closest('ul').id).toBe('meSubPlatform');
    expect(li.hasAttribute('hidden')).toBe(true);
    const a = li.querySelector('a');
    expect(a.getAttribute('href')).toBe('#done-reports');
    expect(a.getAttribute('data-me-go')).toBe('done-reports');
    expect(text(a)).toBe('완료 보고');
    const pc = li.nextElementSibling;
    expect(pc.getAttribute('data-me-item')).toBe('hq-done');
    expect(pc.hasAttribute('hidden')).toBe(true);
    // 관리자 줄 판정은 me.js rowOn 이 한다 — data-need 로는 앱 화면이 있는지 모른다
    expect(pc.hasAttribute('data-need')).toBe(false);
    expect(pc.querySelector('a').getAttribute('href')).toBe('../admin/order-reports.html');
    expect(pc.querySelector('a').hasAttribute('data-desktop-tab')).toBe(true);
  });

  test('기간 · 종류 이름 · 안내 글은 서버 · PC 화면(admin/order-reports.html)과 같다', () => {
    const D = mod();
    const pc = read('admin/order-reports.html');
    const server = read('workers/workflow-api/src/order-reports.js');
    expect(D.DAYS).toEqual([7, 30, 90]);
    expect(D.DAYS_DEFAULT).toBe(30);
    for (const n of D.DAYS) expect(pc).toContain(`<option value="${n}"`);
    expect(pc).toContain('<option value="30" selected>');
    expect(server).toContain('FEED_DAYS = 30');
    expect(server).toContain('FEED_DAYS_MAX = 90');
    expect(D.KIND_NAME).toEqual({ install_done: '설치 완료', as_done: 'A/S 완료' });
    expect(server).toContain("install_done: '설치 완료', as_done: 'A/S 완료'");
    for (const key of ['lead', 'empty', 'needSql', 'reload', 'fail', 'loading']) {
      expect(D.TEXT[key].length).toBeGreaterThan(2);
      expect(pc).toContain(D.TEXT[key]);
    }
  });

  test('보기만 한다 — 서버에 쓰지 않고, 기기에 남기지 않고, 확인 창도 띄우지 않는다', () => {
    const code = read('segan/done-reports.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/method:/); // GET 만
    expect(code).not.toMatch(/order-reports\.html['"]/); // PC 화면으로 보내지 않는다
  });

  test('폰 — 긴 팩토리 이름은 줄을 바꾼다 · 사진은 네모 칸에 맞춘다 · 그림자 · 둥근 모서리 없음', () => {
    const css = read('segan/shell.css');
    const name = /\.dr-head \.me-c-main b,\s*\.dr-head \.me-c-main small\s*\{[^}]*\}/.exec(css);
    expect(name).not.toBeNull();
    expect(name[0]).toMatch(/white-space:\s*normal/);
    expect(name[0]).toMatch(/overflow-wrap:\s*anywhere/);
    const img = /\.dr-photos img\s*\{[^}]*\}/.exec(css);
    expect(img).not.toBeNull();
    expect(img[0]).toMatch(/object-fit:\s*cover/);
    const rules = css.match(/(^|\n)\.dr[-\s][^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(12);
    expect(rules.join('\n')).not.toMatch(/box-shadow|border-radius/);
  });
});

describe('순수 함수', () => {
  test('when — 한국 시간 MM.DD HH:mm, 날짜가 아니면 빈 글', () => {
    const D = mod();
    expect(D.when('2026-11-10T07:20:00Z')).toBe('11.10 16:20');
    expect(D.when('2026-10-27T15:40:00Z')).toBe('10.28 00:40');
    expect(D.when('엉뚱')).toBe('');
    expect(D.when(null)).toBe('');
  });

  test('learnLabel — 동의 · 안 함 · 모름', () => {
    const D = mod();
    expect(D.learnLabel(true)).toBe('동의');
    expect(D.learnLabel(false)).toBe('안 함');
    expect(D.learnLabel(null)).toBe('모름');
    expect(D.learnLabel('true')).toBe('모름');
  });

  test('rowOf — id 없는 줄은 버린다. 종류 이름은 서버 글 → 아는 이름 → 키. 사진은 https 주소만', () => {
    const D = mod();
    expect(D.rowOf({ company_name: 'x' })).toBeNull();
    expect(D.rowOf(null)).toBeNull();
    const r = D.rowOf({
      id: 7,
      kind: 'as_done',
      photo_urls: ['https://a.example.com/1', 'javascript:alert(1)', 'http://a.example.com/2', 5],
      learn_ok: 'yes',
    });
    expect(r).toEqual({
      id: '7',
      company: '',
      orderNo: '',
      label: 'A/S 완료',
      note: '',
      photos: ['https://a.example.com/1'],
      learn: null,
      at: '',
    });
    expect(D.rowOf({ id: 'a', kind: 'other' }).label).toBe('other');
    expect(D.rowOf({ id: 'a' }).label).toBe('-');
    expect(D.rowOf({ id: 'a', kind: 'as_done', label: '서버 글' }).label).toBe('서버 글');
  });

  test('feedOf · statusText — 목록이 배열이 아니면 null. 표가 없으면 건수를 적지 않는다', () => {
    const D = mod();
    expect(D.feedOf({ items: 'x' }, 30)).toBeNull();
    expect(D.feedOf(null, 30)).toBeNull();
    const f = D.feedOf({ ready: true, days: 7, items: [{ id: 'a' }, {}] }, 30);
    expect(f.ready).toBe(true);
    expect(f.days).toBe(7);
    expect(f.items.length).toBe(1);
    expect(D.statusText(f)).toBe('1건 · 최근 7일');
    expect(D.feedOf({ items: [], days: 365 }, 90).days).toBe(90); // 모르는 기간이면 물은 기간
    const none = D.feedOf({ ready: false, days: 30, items: [] }, 30);
    expect(none.ready).toBe(false);
    expect(D.statusText(none)).toBe('');
    expect(D.statusText(null)).toBe('');
  });
});

describe('화면', () => {
  test('관리자 — 최근 30일을 한 번 읽어 보고 줄을 그린다 (본인 토큰 · 캐시 없이)', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /admin/order-reports?days=30']);
    const c = calls.fetch.find((x) => x.url.startsWith(WORK + '/admin/order-reports'));
    expect(c.auth).toBe('Bearer tok-1');
    expect(c.cache).toBe('no-store');
    expect(seen('doneReports')).toBe(true);
    expect(text(part('status'))).toBe('3건 · 최근 30일');
    expect(part('err').hidden).toBe(true);
    expect([7, 30, 90].map((n) => dayBtn(n).getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect([7, 30, 90].map((n) => text(dayBtn(n)))).toEqual(['최근 7일', '최근 30일', '최근 90일']);
    const li = rows();
    expect(li.map((x) => text(x.querySelector('b')))).toEqual([
      '예시 가온 팩토리',
      '다담 공장',
      '팩토리 모름',
    ]);
    expect(li.map((x) => text(x.querySelector('small')))).toEqual([
      '11.10 16:20 · 주문번호 EX-2611-014 · 학습 동의',
      '11.08 11:05 · 주문번호 EX-2611-009 · 학습 안 함',
      '10.28 00:40 · 학습 모름',
    ]);
    expect(li.map((x) => text(x.querySelector('.dr-kind')))).toEqual([
      '설치 완료',
      'A/S 완료',
      '설치 완료',
    ]);
    expect(text(li[0].querySelector('.dr-note'))).toBe('상부장 수평 다시 맞춤');
    expect(li[1].querySelector('.dr-note')).toBeNull();
    expect(menu('done-reports').hidden).toBe(false);
    expect(menu('hq-done').hidden).toBe(true);
  });

  test('사진 — 서명 주소 그대로 새 탭 링크 · 이름 붙은 작은 그림 · 참조자를 보내지 않는다', async () => {
    await load();
    const a = [...rows()[0].querySelectorAll('.dr-photos a')];
    expect(a.map((x) => x.getAttribute('href'))).toEqual([
      'https://files.example.com/a1?sig=1&x=2',
      'https://files.example.com/a2',
    ]);
    for (const x of a) {
      expect(x.getAttribute('target')).toBe('_blank');
      expect(x.getAttribute('rel')).toBe('noopener noreferrer');
    }
    const img = a.map((x) => x.querySelector('img'));
    expect(img.map((x) => x.getAttribute('src'))).toEqual(a.map((x) => x.getAttribute('href')));
    expect(img.map((x) => x.getAttribute('alt'))).toEqual(['설치 완료 사진 1', '설치 완료 사진 2']);
    for (const x of img) {
      expect(x.getAttribute('loading')).toBe('lazy');
      expect(x.getAttribute('referrerpolicy')).toBe('no-referrer');
    }
    expect(rows()[1].querySelector('.dr-photos')).toBeNull(); // 사진 없는 보고
  });

  test('보고가 없으면 — 0건과 안내 글. 표가 아직 없으면 — 그 안내만', async () => {
    await load({ list: (days) => feed(days, []) });
    expect(seen('doneReports')).toBe(true);
    expect(text(part('status'))).toBe('0건 · 최근 30일');
    expect(text(part('empty'))).toBe('이 기간에 들어온 보고가 없습니다.');
    await load({ list: (days) => ok({ ready: false, days, items: [] }) });
    expect(seen('doneReports')).toBe(true);
    expect(text(part('status'))).toBe('');
    expect(text(part('needsql'))).toBe(
      '완료 보고 칸이 아직 없습니다 — DB 0043 적용 뒤에 보입니다.'
    );
    expect(part('empty')).toBeNull();
  });

  test('이름 · 메모 · 사진 주소는 글자 그대로 그린다', async () => {
    const items = ITEMS();
    items[0].company_name = '<img src=x onerror=1>';
    items[0].note = '<script>x</script>';
    items[0].photo_urls = ['https://files.example.com/"><img src=x>'];
    await load({ list: (days) => feed(days, items) });
    expect(qa('img').length).toBe(2); // 사진 칸의 그림 둘뿐 (첫 줄 하나 + 셋째 줄 하나)
    expect(q('script')).toBeNull();
    expect(text(rows()[0].querySelector('b'))).toBe('<img src=x onerror=1>');
    expect(text(rows()[0].querySelector('.dr-note'))).toBe('<script>x</script>');
    expect(rows()[0].querySelector('.dr-photos a').getAttribute('href')).toBe(
      'https://files.example.com/"><img src=x>'
    );
  });

  test('완료 보고 화면에서만 보인다 — 메뉴 줄을 눌러 들어온다', async () => {
    await load({ hash: '' });
    expect(seen('doneReports')).toBe(false);
    await press(menu('done-reports').querySelector('a'));
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(seen('doneReports')).toBe(true);
  });
});

describe('기간 · 다시 읽기', () => {
  test('기간 단추 — 그 기간을 다시 읽어 줄 · 건수 · 고른 단추를 바꾼다', async () => {
    const calls = await load({
      list: (days) => feed(days, days === 7 ? ITEMS().slice(0, 1) : ITEMS()),
    });
    await press(dayBtn(7));
    expect(asked(calls)).toEqual([
      'GET /admin/order-reports?days=30',
      'GET /admin/order-reports?days=7',
    ]);
    expect(rows().length).toBe(1);
    expect(text(part('status'))).toBe('1건 · 최근 7일');
    expect(dayBtn(7).getAttribute('aria-pressed')).toBe('true');
    expect(dayBtn(30).getAttribute('aria-pressed')).toBe('false');
  });

  test('이미 고른 기간을 누르면 — 다시 읽지 않는다', async () => {
    const calls = await load();
    await press(dayBtn(30));
    expect(asked(calls).length).toBe(1);
  });

  test('「다시 읽기」 — 지금 기간을 다시 읽는다', async () => {
    const calls = await load({
      list: (days, n) => feed(days, n === 1 ? ITEMS().slice(0, 1) : ITEMS()),
    });
    expect(rows().length).toBe(1);
    await press(q('[data-act="reload"]'));
    expect(asked(calls)).toEqual([
      'GET /admin/order-reports?days=30',
      'GET /admin/order-reports?days=30',
    ]);
    expect(rows().length).toBe(3);
  });

  test('읽는 동안 — 단추를 잠그고 다시 눌러도 한 번만 읽는다', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const calls = await load({ gate });
    await press(dayBtn(90));
    expect(box().getAttribute('aria-busy')).toBe('true');
    expect(text(part('status'))).toBe('불러오는 중…');
    expect(qa('button').every((b) => b.disabled)).toBe(true);
    expect(rows().length).toBe(3); // 있던 줄은 그대로
    await press(dayBtn(7));
    await press(q('[data-act="reload"]'));
    release();
    await flush();
    await flush();
    expect(asked(calls).length).toBe(2);
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(dayBtn(90).getAttribute('aria-pressed')).toBe('true');
  });

  test('다시 읽다가 못 읽으면 — 있던 줄 · 고른 기간은 그대로 두고 글만 남긴다', async () => {
    await load({
      list: (days, n) => (n === 1 ? feed(days) : fail(400, 'invalid', 'days 는 1~90 입니다')),
    });
    await press(dayBtn(90));
    expect(text(part('err'))).toBe('days 는 1~90 입니다');
    expect(rows().length).toBe(3);
    expect(text(part('status'))).toBe('3건 · 최근 30일');
    expect(dayBtn(30).getAttribute('aria-pressed')).toBe('true');
    expect(seen('doneReports')).toBe(true);
  });

  test('끊기거나 이상한 답 — 기본 글', async () => {
    for (const second of [() => new Error('offline'), () => ok({ items: 'x' })]) {
      await load({ list: (days, n) => (n === 1 ? feed(days) : second()) });
      await press(q('[data-act="reload"]'));
      expect(text(part('err'))).toBe('불러오지 못했습니다.');
      expect(rows().length).toBe(3);
    }
  });
});

describe('관리자 PC 화면 줄', () => {
  test('처음에 못 읽은 관리자 — 앱 화면은 감추고 PC 화면 줄이 남는다', async () => {
    await load({ list: () => fail(404, 'not_found', 'Not found') });
    expect(seen('doneReports')).toBe(false);
    expect(menu('done-reports').hidden).toBe(true);
    expect(menu('hq-done').hidden).toBe(false);
  });

  test('관리자가 아니면 — 두 줄 다 없다', async () => {
    await load({ isAdmin: false });
    expect(menu('done-reports').hidden).toBe(true);
    expect(menu('hq-done').hidden).toBe(true);
  });
});

describe('안 보이는 때', () => {
  test('관리자가 아닌 사람 · 로그인하지 않은 사람 · 워커 주소가 없을 때 — 묻지 않는다', async () => {
    for (const o of [
      { isAdmin: false },
      { isAdmin: false, partner: NOBODY },
      { session: null },
      { work: '' },
    ]) {
      const calls = await load(o);
      expect(asked(calls)).toEqual([]);
      expect(seen('doneReports')).toBe(false);
      expect(box().innerHTML).toBe('');
    }
  }, 20000);

  test('처음에 못 읽으면(403 · 오류 · 끊김 · 목록 없는 답) — 칸째 감춘다', async () => {
    for (const list of [
      () => fail(403, 'forbidden', '관리자만 볼 수 있습니다'),
      () => ({ ok: false, status: 500, body: {} }),
      () => new Error('offline'),
      () => ok({ items: 'x' }),
      () => ok(null),
    ]) {
      const calls = await load({ list });
      expect(asked(calls)).toEqual(['GET /admin/order-reports?days=30']);
      expect(seen('doneReports')).toBe(false);
      expect($('doneReports').hidden).toBe(true);
      expect(box().innerHTML).toBe('');
      expect(menu('done-reports').hidden).toBe(true);
    }
  }, 20000);
});
