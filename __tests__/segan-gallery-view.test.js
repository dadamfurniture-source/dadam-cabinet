/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event, KeyboardEvent */
/**
 * SEGAN 「기준정보 › 시공사례」 (segan/gallery-view.js + segan/me.html #galleryView)
 *
 *   누가    사이트 관리자(is_admin)만. 관리자가 아니면 칸을 열지 않는다
 *   데이터  Supabase 표 furniture_images — 새 것부터 PAGE 장씩 읽기만 (화면을 열었을 때 처음 읽는다)
 *   화면    품목 · 쓰임 · 찾기 · 몇 장 · 사진 칸 · 더 보기 — 보기 · 찾기만 (2026-11-11 대표님 결정)
 *   올리기 · 지우기 · 갤러리 ↔ 학습용 바꾸기는 PC 화면(admin/gallery.html)에 그대로 — 링크 하나
 *   사진 주소 · 설명은 모두 지어낸 것이다
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
  delete window.SeganGalleryView;
  (0, eval)(read('segan/gallery-view.js'));
  return window.SeganGalleryView;
};

const CATS = ['l_shaped_sink', 'wardrobe', 'fridge_cabinet'];
/** furniture_images n 줄 (새 것부터) */
const images = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: 'g-' + i,
    category: CATS[i % CATS.length],
    style: i % 2 ? '모던' : '',
    description: i % 3 === 0 ? '예시 현장 ' + i : '',
    image_url: 'https://files.example.com/g/' + i + '.jpg',
    is_training: i % 4 === 0,
    created_at: '2026-11-01T00:00:00Z',
  }));

/**
 * 마이페이지를 띄운다 (기본 = 사이트 관리자인 본사 구성원, 시공사례 화면)
 * opts.all = 표에 있는 줄 · opts.table(query, n) 로 답을 바꾼다 ({ data, count, error }) · opts.gate = 둘째 읽기부터 붙잡을 약속
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    hash: '#gallery-list',
    isAdmin: true,
    all: images(74),
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
    'SeganGalleryView',
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
  const calls = { table: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) =>
        name === 'is_admin' ? { data: opts.isAdmin, error: null } : { data: [], error: null },
      from: (table) => {
        const q = {
          table,
          select: null,
          opt: null,
          eq: {},
          order: null,
          range: null,
          or: null,
          writes: [],
        };
        const answer = async () => {
          if (table !== 'furniture_images') return { data: [], error: null };
          calls.table.push(q);
          const n = calls.table.length;
          if (opts.gate && n > 1) await opts.gate;
          if (opts.table) {
            const r = await opts.table(q, n);
            if (r instanceof Error) throw r;
            return r;
          }
          const needle = q.or ? /ilike\.\*(.*?)\*/.exec(q.or)[1] : '';
          const hit = opts.all.filter(
            (r) =>
              (!('category' in q.eq) || r.category === q.eq.category) &&
              (!('is_training' in q.eq) || r.is_training === q.eq.is_training) &&
              (!needle || (r.description + ' ' + r.style).includes(needle))
          );
          return { data: hit.slice(q.range[0], q.range[1] + 1), count: hit.length, error: null };
        };
        const chain = {
          select: (cols, opt) => {
            q.select = cols;
            q.opt = opt || null;
            return chain;
          },
          eq: (k, v) => {
            q.eq[k] = v;
            return chain;
          },
          order: (k, o) => {
            q.order = [k, o];
            return chain;
          },
          range: (a, b) => {
            q.range = [a, b];
            return chain;
          },
          or: (f) => {
            q.or = f;
            return chain;
          },
          limit: () => chain,
          insert: () => (q.writes.push('insert'), chain),
          update: () => (q.writes.push('update'), chain),
          delete: () => (q.writes.push('delete'), chain),
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve, reject) => answer().then(resolve, reject),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async (url) => {
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
    'segan/gallery-view.js',
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
const box = () => $('galleryViewBody');
const q = (sel) => box().querySelector(sel);
const qa = (sel) => [...box().querySelectorAll(sel)];
const part = (name) => q(`[data-gv="${name}"]`);
const act = (name) => q(`[data-act="${name}"]`);
const tiles = () => qa('li[data-gv-row]');
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const pick = async (id, value) => {
  $(id).value = value;
  $(id).dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
};
const type = (value) => {
  $('gvSearch').value = value;
  $('gvSearch').dispatchEvent(new Event('input', { bubbles: true }));
};
const enter = async () => {
  $('gvSearch').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
};

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 가전 모델 다음의 제 칸 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('galleryView');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('SECTION');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.classList.contains('me-screen')).toBe(true);
    expect(el.previousElementSibling.id).toBe('applianceList');
    expect(el.getAttribute('aria-labelledby')).toBe('galleryViewTitle');
    expect(text(doc.getElementById('galleryViewTitle'))).toBe('시공사례');
    expect(doc.getElementById('galleryViewBody').parentElement).toBe(el);
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['gallery-view.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('gallery-view.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'gallery-view.js')");
  });

  test('메뉴 — 기준정보 아래 앱 화면 줄, 바로 다음에 관리자 PC 화면 줄 (둘 다 처음엔 감춘다)', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const li = doc.querySelector('li[data-me-item="gallery-list"]');
    expect(li).not.toBeNull();
    expect(li.closest('ul').id).toBe('meSubMaster');
    expect(li.hasAttribute('hidden')).toBe(true);
    const a = li.querySelector('a');
    expect(a.getAttribute('href')).toBe('#gallery-list');
    expect(a.getAttribute('data-me-go')).toBe('gallery-list');
    expect(text(a)).toBe('시공사례');
    const pc = li.nextElementSibling;
    expect(pc.getAttribute('data-me-item')).toBe('hq-gallery');
    expect(pc.hasAttribute('hidden')).toBe(true);
    expect(pc.hasAttribute('data-need')).toBe(false);
    expect(pc.querySelector('a').getAttribute('href')).toBe('../admin/gallery.html');
    expect(pc.querySelector('a').hasAttribute('data-desktop-tab')).toBe(true);
  });

  test('품목 · 예전 id · 쓰임 이름은 PC 화면(admin/gallery.html)과 같다', () => {
    const G = mod();
    const pc = read('admin/gallery.html');
    const ids = [...pc.matchAll(/\{ id: '([a-z_]+)', name: '([^']+)' \}/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(ids.length).toBe(17);
    expect(G.CATEGORIES).toEqual(ids);
    for (const [k, v] of Object.entries(G.LEGACY)) expect(pc).toContain(`'${k}': '${v}'`);
    expect(Object.keys(G.LEGACY).length).toBe(5);
    expect(G.USES).toEqual([
      ['', '전체'],
      ['false', '갤러리용'],
      ['true', '학습용'],
    ]);
    for (const [v, name] of G.USES) expect(pc).toContain(`<option value="${v}">${name}</option>`);
    expect(pc).toContain(G.TEXT.empty);
    expect(pc).toContain(G.TEXT.catAll);
    expect(pc).toContain(".from('furniture_images')");
  });

  test('보기만 한다 — 표 · 저장소에 쓰지 않고, 기기에 남기지 않고, 확인 창도 띄우지 않는다', () => {
    const code = read('segan/gallery-view.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/\.(insert|update|delete|upsert|remove|upload)\(/);
    expect(code).not.toMatch(/\.storage\b/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
  });

  test('사진 칸 — 네모로 맞춘다 · 그림자 · 둥근 모서리 없음', () => {
    const css = read('segan/shell.css');
    const img = /\.gv-tile img\s*\{[^}]*\}/.exec(css);
    expect(img).not.toBeNull();
    expect(img[0]).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
    expect(img[0]).toMatch(/object-fit:\s*cover/);
    const rules = css.match(/(^|\n)\.gv[-\s][^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(10);
    expect(rules.join('\n')).not.toMatch(/box-shadow|border-radius/);
  });
});

describe('순수 함수', () => {
  test('catLabel — 아는 품목 · 예전 id · 그 밖은 id 그대로', () => {
    const G = mod();
    expect(G.catLabel('wardrobe')).toBe('붙박이장');
    expect(G.catLabel('shoe')).toBe('신발장 (구 id)');
    expect(G.catLabel('mystery')).toBe('mystery');
    expect(G.catLabel('toString')).toBe('toString');
    expect(G.catLabel('')).toBe('-');
  });

  test('rowOf — id 가 없거나 https 주소가 아니면 버린다', () => {
    const G = mod();
    expect(G.rowOf(null)).toBeNull();
    expect(G.rowOf({ id: 'a', image_url: 'javascript:alert(1)' })).toBeNull();
    expect(G.rowOf({ id: 'a', image_url: 'http://files.example.com/a.jpg' })).toBeNull();
    expect(G.rowOf({ image_url: 'https://files.example.com/a.jpg' })).toBeNull();
    expect(
      G.rowOf({
        id: 3,
        image_url: 'https://files.example.com/a.jpg',
        style: ' 모던 ',
        is_training: 'true',
      })
    ).toEqual({
      id: '3',
      url: 'https://files.example.com/a.jpg',
      category: '',
      style: '모던',
      description: '',
      training: false,
    });
  });

  test('needle · orFilter — 거르기 글법에 뜻이 있는 글자는 빼고 40자까지', () => {
    const G = mod();
    expect(G.needle('  무몰딩   화이트 ')).toBe('무몰딩 화이트');
    expect(G.needle('a,b(c)"d\'e%f*g\\h')).toBe('a b c d e f g h');
    expect(G.needle(',()%*')).toBe('');
    expect(G.needle(null)).toBe('');
    expect(G.needle('가'.repeat(60)).length).toBe(40);
    expect(G.orFilter('무몰딩')).toBe('description.ilike.*무몰딩*,style.ilike.*무몰딩*');
    expect(G.orFilter('x),id.gt.0,(y')).toBe(
      'description.ilike.*x  id.gt.0  y*,style.ilike.*x  id.gt.0  y*'.replace(/ {2}/g, ' ')
    );
    expect(G.orFilter('  ')).toBe('');
  });

  test('subOf · countText', () => {
    const G = mod();
    expect(G.subOf({ style: '모던', description: '짧은 설명' })).toBe('모던 · 짧은 설명');
    expect(G.subOf({ style: '', description: '가'.repeat(45) })).toBe('가'.repeat(40) + '…');
    expect(G.subOf({ style: '', description: '' })).toBe('');
    expect(G.countText(30, 74)).toBe('보이는 30장 / 전체 74장');
    expect(G.countText(74, 74)).toBe('74장');
    expect(G.countText(0, 0)).toBe('0장');
    expect(G.countText(5, null)).toBe('5장');
  });
});

describe('화면', () => {
  test('관리자가 화면을 열면 — 새 것부터 PAGE 장을 한 번 읽어 사진 칸을 그린다 (읽기만)', async () => {
    const calls = await load();
    const G = window.SeganGalleryView;
    expect(calls.table.length).toBe(1);
    expect(calls.table[0]).toEqual({
      table: 'furniture_images',
      select: G.COLUMNS,
      opt: { count: 'exact' },
      eq: {},
      order: ['created_at', { ascending: false }],
      range: [0, G.PAGE - 1],
      or: null,
      writes: [],
    });
    expect(seen('galleryView')).toBe(true);
    expect(tiles().length).toBe(G.PAGE);
    expect(text(part('count'))).toBe(`보이는 ${G.PAGE}장 / 전체 74장`);
    expect(text(act('more'))).toBe(`더 보기 (남은 ${74 - G.PAGE}장)`);
    const first = tiles()[0];
    expect(text(first.querySelector('b'))).toBe('L자형 싱크대');
    expect(text(first.querySelector('.gv-badge'))).toBe('학습용');
    expect(text(first.querySelector('small'))).toBe('예시 현장 0');
    expect(tiles()[1].querySelector('.gv-badge')).toBeNull();
    expect(text(tiles()[1].querySelector('small'))).toBe('모던');
    expect([...$('gvCat').options].map((o) => o.value)).toEqual([
      '',
      ...G.CATEGORIES.map((c) => c[0]),
    ]);
    expect([...$('gvUse').options].map(text)).toEqual(['전체', '갤러리용', '학습용']);
    expect(menu('gallery-list').hidden).toBe(false);
    expect(menu('hq-gallery').hidden).toBe(true);
  });

  test('사진 — 새 탭 링크 · 이름 붙은 그림 · 참조자를 보내지 않는다', async () => {
    await load();
    const a = tiles()[0].querySelector('a');
    expect(a.getAttribute('href')).toBe('https://files.example.com/g/0.jpg');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    const img = a.querySelector('img');
    expect(img.getAttribute('src')).toBe('https://files.example.com/g/0.jpg');
    expect(img.getAttribute('alt')).toBe('L자형 싱크대 사진 1');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  test('PC 화면 링크 — 올리기 · 지우기는 PC 관리 화면에서. 고치는 단추가 없다', async () => {
    await load();
    const a = part('pc');
    expect(a.getAttribute('href')).toBe('../admin/gallery.html');
    expect(a.hasAttribute('data-desktop-tab')).toBe(true);
    expect(qa('button').map((b) => b.getAttribute('data-act'))).toEqual(['find', 'more']);
    expect(qa('input[type="checkbox"], input[type="file"]').length).toBe(0);
  });

  test('마이페이지 다른 화면에 있을 때는 읽지 않는다 — 들어오면 그때 한 번 읽는다', async () => {
    const calls = await load({ hash: '' });
    expect(calls.table.length).toBe(0);
    expect(menu('gallery-list').hidden).toBe(false);
    window.location.hash = '#gallery-list';
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(calls.table.length).toBe(1);
    expect(seen('galleryView')).toBe(true);
    window.location.hash = '#appliances';
    window.dispatchEvent(new Event('hashchange'));
    window.location.hash = '#gallery-list';
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(calls.table.length).toBe(1);
  });

  test('설명 · 스타일 · 모르는 품목은 글자 그대로 그린다. 이상한 주소의 줄은 버린다', async () => {
    const all = images(3);
    all[0].description = '<img src=x onerror=1>';
    all[0].style = '<b>x</b>';
    all[0].category = '<script>';
    all[1].image_url = 'javascript:alert(1)';
    await load({ all });
    expect(tiles().length).toBe(2);
    expect(qa('img').length).toBe(2);
    expect(q('script')).toBeNull();
    expect(text(tiles()[0].querySelector('b'))).toBe('<script>');
    expect(text(tiles()[0].querySelector('small'))).toBe('<b>x</b> · <img src=x onerror=1>');
  });

  test('사진이 없으면 — 0장과 안내 글', async () => {
    await load({ all: [] });
    expect(text(part('count'))).toBe('0장');
    expect(text(part('empty'))).toBe('이미지가 없습니다');
    expect(act('more')).toBeNull();
  });
});

describe('거르기 · 찾기 · 더 보기', () => {
  test('품목 · 쓰임 — 서버에서 걸러 처음부터 다시 읽는다', async () => {
    const calls = await load();
    await pick('gvCat', 'wardrobe');
    expect(calls.table[1].eq).toEqual({ category: 'wardrobe' });
    expect(calls.table[1].range).toEqual([0, 29]);
    expect(tiles().every((li) => text(li.querySelector('b')) === '붙박이장')).toBe(true);
    expect(text(part('count'))).toBe('25장');
    await pick('gvUse', 'true');
    expect(calls.table[2].eq).toEqual({ category: 'wardrobe', is_training: true });
    await pick('gvUse', 'false');
    expect(calls.table[3].eq).toEqual({ category: 'wardrobe', is_training: false });
    await pick('gvCat', '');
    await pick('gvUse', '');
    expect(calls.table[5].eq).toEqual({});
    expect($('gvCat').value).toBe('');
  });

  test('찾기 — Enter 나 「찾기」로 서버에 묻는다 (적는 동안에는 묻지 않는다). 뜻 있는 글자는 뺀다', async () => {
    const calls = await load();
    type('현장 1');
    expect(calls.table.length).toBe(1);
    await enter();
    expect(calls.table[1].or).toBe('description.ilike.*현장 1*,style.ilike.*현장 1*');
    expect(calls.table[1].range).toEqual([0, 29]);
    expect($('gvSearch').value).toBe('현장 1');
    expect(tiles().length).toBeGreaterThan(0);
    type('모던),id.gt.0');
    await press(act('find'));
    expect(calls.table[2].or).toBe('description.ilike.*모던 id.gt.0*,style.ilike.*모던 id.gt.0*');
    // 빈 글이면 거르지 않는다
    type('  ');
    await press(act('find'));
    expect(calls.table[3].or).toBeNull();
  });

  test('더 보기 — 다음 PAGE 장을 이어 붙인다 (같은 거르기로). 다 읽으면 단추가 없다', async () => {
    const calls = await load();
    await pick('gvUse', 'false');
    const total = images(74).filter((r) => !r.is_training).length;
    expect(text(part('count'))).toBe(`보이는 30장 / 전체 ${total}장`);
    await press(act('more'));
    expect(calls.table[2].range).toEqual([30, 59]);
    expect(calls.table[2].eq).toEqual({ is_training: false });
    expect(tiles().length).toBe(total);
    expect(text(part('count'))).toBe(`${total}장`);
    expect(act('more')).toBeNull();
    expect(document.activeElement).toBe(tiles()[30].querySelector('a')); // 새로 붙은 첫 사진
  });

  test('더 보기가 모자라게 오면 — 끝으로 보고 단추를 지운다', async () => {
    await load({
      table: (query) =>
        query.range[0] === 0
          ? { data: images(30), count: 500, error: null }
          : { data: images(4).map((r) => ({ ...r, id: 'x-' + r.id })), count: 500, error: null },
    });
    expect(text(act('more'))).toBe('더 보기 (남은 470장)');
    await press(act('more'));
    expect(tiles().length).toBe(34);
    expect(act('more')).toBeNull();
    expect(text(part('count'))).toBe('34장');
  });

  test('읽는 동안 — 칸과 단추를 잠그고 다시 눌러도 한 번만 읽는다. 있던 사진은 그대로', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const calls = await load({ gate });
    await press(act('more'));
    expect(box().getAttribute('aria-busy')).toBe('true');
    expect(text(part('count'))).toBe('불러오는 중…');
    expect(qa('button, select, input').every((el) => el.disabled)).toBe(true);
    expect(tiles().length).toBe(30);
    await press(act('more'));
    release();
    await flush();
    await flush();
    expect(calls.table.length).toBe(2);
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(tiles().length).toBe(60);
  });
});

describe('못 읽을 때', () => {
  test('처음에 표가 오류를 주면 — 그 자리에 글과 「다시 읽기」. 다시 읽으면 사진이 나온다', async () => {
    const calls = await load({
      table: (query, n) =>
        n === 1
          ? { data: null, error: { message: 'permission denied' } }
          : { data: images(3), count: 3, error: null },
    });
    expect(seen('galleryView')).toBe(true);
    expect(text(part('failed'))).toBe('불러오지 못했습니다. (permission denied)');
    expect(tiles().length).toBe(0);
    await press(act('retry'));
    expect(calls.table.length).toBe(2);
    expect(part('failed')).toBeNull();
    expect(tiles().length).toBe(3);
  });

  test('더 보기를 못 읽으면 — 있던 사진은 그대로 두고 글만 남긴다', async () => {
    for (const second of [() => new Error('offline'), () => ({ data: 'x', error: null })]) {
      await load({
        table: (query, n) => (n === 1 ? { data: images(30), count: 74, error: null } : second()),
      });
      await press(act('more'));
      expect(text(part('failed'))).toBe('불러오지 못했습니다.');
      expect(tiles().length).toBe(30);
      expect(act('more')).not.toBeNull();
    }
  });
});

describe('안 보이는 때', () => {
  test('관리자가 아닌 사람 · 로그인하지 않은 사람 — 칸을 열지 않고 표도 읽지 않는다. 메뉴 줄 둘 다 없다', async () => {
    for (const o of [{ isAdmin: false }, { session: null }]) {
      const calls = await load(o);
      expect(calls.table.length).toBe(0);
      expect(seen('galleryView')).toBe(false);
      expect(box().innerHTML).toBe('');
      expect(menu('gallery-list').hidden).toBe(true);
      expect(menu('hq-gallery').hidden).toBe(true);
    }
  }, 20000);
});
