/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, File, Event, setTimeout, btoa */
/**
 * SEGAN 「구매 · 재고 › 철물 · 부속 카탈로그」 (segan/part-catalog.js + segan/me.html #part-catalog)
 *
 *   누가    다담 공장 구성원(GET /partner/me 의 hq_member) · 다담 본사 구성원(platform_member). 다른 팩토리 · 업체 없는 사람은 묻지도 않는다
 *   데이터  workflow-api GET /parts/catalog · POST /parts/import · POST /parts/items/:id/photo · PATCH /parts/items/:id
 *   화면    공급 회사 고르기 · 분류 · 찾기 · 상품 줄(사진 · 참고가 · 매입가) · 펼치면 옵션 · 사양 · 「카탈로그 파일 올리기」
 *   못 읽으면 칸째 감춘다 (메뉴 줄도)
 *   회사 · 상품 · 값은 모두 지어낸 것이다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const WORK = 'https://work.example.workers.dev';
const SESSION = { access_token: 'tok-1', user: { id: 'user-1' } };
const HQ = { company: null, hq_member: true };
const PLATFORM = { company: null, platform_member: true };
const PARTNER = { company: { id: 'c-1', plan: 'agent', role: 'owner' } };

const item = (id, patch = {}) => ({
  id,
  vendor_id: 'v-1',
  vendor_item_no: id.toUpperCase(),
  category: '경첩',
  sub_category: '',
  brand: '',
  name: `시험 상품 ${id}`,
  ref_price: 1000,
  ref_price_on: '2026-11-18',
  buy_price: null,
  buy_price_on: null,
  options: [],
  addons: [],
  specs: {},
  specs_checked: false,
  width_mm: null,
  depth_mm: null,
  height_mm: null,
  source_url: '',
  note: '',
  photo_url: null,
  has_photo: false,
  active: true,
  ...patch,
});
const CATALOG = (manage = true) => ({
  can_manage: manage,
  vendors: [
    { id: 'v-1', name: '가나 철물', site_url: 'https://parts.example.com', count: 3 },
    { id: 'v-2', name: '마바 상사', site_url: '', count: 1 },
  ],
  items: [
    item('a1', {
      name: '댐핑 경첩 <b>110도</b>',
      brand: '다라',
      sub_category: '댐핑',
      ref_price: 3200,
      buy_price: manage ? 2500 : null,
      options: [
        { g: '두께', l: '18T용', d: 0, x: false },
        { g: '두께', l: '15T용', d: 500, x: true },
      ],
      addons: [{ l: '시험 캡', p: 300 }],
      source_url: 'https://parts.example.com/p/a1',
      photo_url: 'https://x.supabase.co/storage/v1/object/sign/part-photos/c/a1.jpg?token=t',
      has_photo: true,
    }),
    item('a2', { category: '씽크볼', name: '시험 씽크볼 800', ref_price: null, specs: { 재질: 'SUS304' }, width_mm: 800, depth_mm: 480, height_mm: 220 }),
    item('a3', { name: '숨긴 경첩', active: false }),
    item('b1', { vendor_id: 'v-2', category: '레일', name: '명세표 레일', source_url: 'javascript:alert(1)' }),
  ],
});

const mod = () => {
  delete window.SeganPartCatalog;
  (0, eval)(read('segan/part-catalog.js'));
  return window.SeganPartCatalog;
};

/** 가짜 서버 — 부른 것을 적어 두고 차례로 답한다 */
function serve(handler) {
  const calls = [];
  window.fetch = async (url, init = {}) => {
    const call = { method: init.method || 'GET', path: String(url).replace(WORK, ''), body: init.body, headers: init.headers || {} };
    calls.push(call);
    const r = handler(call) || { status: 500, body: { success: false, message: '시험: 모르는 길' } };
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  };
  return calls;
}
const ok = (data, status = 200) => ({ status, body: { success: true, data } });

async function boot(me = HQ, handler = () => ok(CATALOG())) {
  document.body.innerHTML = '<section id="partner" hidden><div id="partCatalog" hidden></div></section>';
  window.DADAM_CONFIG = { workflowApi: { url: WORK + '/' } };
  const calls = serve(handler);
  const M = mod();
  await M.load(null, SESSION, me);
  return { M, calls, box: document.getElementById('partCatalog') };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  for (let i = 0; i < 200 && !fn(); i++) await tick(5);
  expect(fn()).toBeTruthy();
};

afterEach(() => {
  document.body.innerHTML = '';
  delete window.fetch;
  delete window.DADAM_CONFIG;
});

describe('철물 · 부속 카탈로그 — 누가', () => {
  test('다담 공장 · 본사 구성원만 묻는다 — 다른 팩토리 · 업체 없는 사람에게는 서버를 부르지 않는다', async () => {
    const M = mod();
    expect([M.canSee(HQ), M.canSee(PLATFORM), M.canSee(PARTNER), M.canSee({}), M.canSee(null), M.canSee([])]).toEqual([true, true, false, false, false, false]);
    for (const me of [PARTNER, {}, null]) {
      const { calls, box } = await boot(me);
      expect(calls).toHaveLength(0);
      expect(box.hidden).toBe(true);
    }
    const hq = await boot(PLATFORM);
    expect(hq.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /parts/catalog']);
    expect(hq.calls[0].headers.Authorization).toBe('Bearer tok-1');
    expect(hq.box.hidden).toBe(false);
    expect(document.getElementById('partner').hidden).toBe(false);
  });

  test('못 읽으면 칸째 감춘다 — DB 적용 전(409) · 권한 없음(403) · 끊김 · 모양이 다른 답', async () => {
    for (const handler of [
      () => ({ status: 409, body: { success: false, code: 'db_pending', message: 'DB 0071 적용 전입니다' } }),
      () => ({ status: 403, body: { success: false, code: 'not_catalog_company' } }),
      () => ok({ vendors: 'x' }),
      () => {
        throw new Error('끊김');
      },
    ]) {
      const { box } = await boot(HQ, handler);
      expect(box.hidden).toBe(true);
      expect(box.innerHTML).toBe('');
    }
  });
});

describe('철물 · 부속 카탈로그 — 화면', () => {
  test('공급 회사 · 분류 · 상품 줄을 그린다 — 글은 그대로 글로 (태그로 읽지 않는다), 주소는 https 만', async () => {
    const { box } = await boot();
    expect(box.querySelector('#partCatalogTitle').textContent).toBe('철물 · 부속 카탈로그');
    expect([...box.querySelectorAll('[data-pc-vendor]')].map((b) => b.textContent)).toEqual(['전체 4', '가나 철물 3', '마바 상사 1']);
    expect([...box.querySelectorAll('#partCatalogCat option')].map((o) => o.textContent)).toEqual(['분류 모두', '경첩 2', '레일 1', '씽크볼 1']);
    const rows = [...box.querySelectorAll('.pc-row')];
    expect(rows).toHaveLength(4);
    const a1 = box.querySelector('[data-pc-item="a1"]');
    expect(a1.querySelector('.pc-name').textContent).toBe('댐핑 경첩 <b>110도</b>');
    expect(a1.querySelector('.pc-name b')).toBeNull();
    expect(a1.querySelector('.pc-meta').textContent).toBe('다라 · 경첩 › 댐핑 · 가나 철물');
    expect(a1.querySelector('img.pc-ph').getAttribute('src')).toContain('/object/sign/part-photos/');
    expect(a1.querySelector('.pc-money').textContent).toContain('3,200원');
    expect(a1.querySelector('summary').textContent).toBe('옵션 2 · 추가상품 1');
    expect([...a1.querySelectorAll('.pc-opts li')].map((li) => li.textContent)).toEqual(['두께', '18T용', '15T용 (품절)+500원', '시험 캡+300원']);
    expect(a1.querySelector('.pc-note a').getAttribute('href')).toBe('https://parts.example.com/p/a1');
    expect(a1.querySelector('.pc-note a').getAttribute('rel')).toBe('noopener noreferrer');
    // 값이 없으면 「가격 없음」, 사양은 확인 전 표시와 크기 줄
    const a2 = box.querySelector('[data-pc-item="a2"]');
    expect(a2.querySelector('.pc-none').textContent).toBe('가격 없음');
    expect(a2.querySelector('.pc-det').textContent).toContain('사양 확인 전');
    expect(a2.querySelector('.pc-det').textContent).toContain('800 × 480 × 220');
    expect(a2.querySelector('span.pc-ph')).not.toBeNull();
    // 숨긴 상품은 흐리게 + 「다시 쓰기」
    const a3 = box.querySelector('[data-pc-item="a3"]');
    expect(a3.classList.contains('is-off')).toBe(true);
    expect(a3.querySelector('[data-pc-toggle]').textContent).toBe('다시 쓰기');
    // https 가 아닌 주소는 링크로 그리지 않는다
    expect(box.querySelector('[data-pc-item="b1"] a')).toBeNull();
  });

  test('대표 · 실장이 아니면 매입가 · 숨기기 · 파일 올리기가 없다', async () => {
    const { box } = await boot(HQ, () => ok(CATALOG(false)));
    expect(box.querySelector('[data-pc-buy]')).toBeNull();
    expect(box.querySelector('[data-pc-toggle]')).toBeNull();
    expect(box.querySelector('#partCatalogFile')).toBeNull();
    expect(box.textContent).not.toContain('매입가');
    const boss = await boot();
    expect(boss.box.querySelector('[data-pc-buy="a1"]').value).toBe('2,500');
    expect(boss.box.querySelector('#partCatalogFile')).not.toBeNull();
  });

  test('공급 회사 · 분류 · 찾는 말로 거른다', async () => {
    const { box } = await boot();
    const ids = () => [...box.querySelectorAll('.pc-row')].map((r) => r.getAttribute('data-pc-item'));
    box.querySelector('[data-pc-vendor="v-2"]').click();
    expect(ids()).toEqual(['b1']);
    expect(box.querySelector('.pc-meta').textContent).toBe('레일');
    box.querySelector('[data-pc-vendor=""]').click();
    const cat = box.querySelector('#partCatalogCat');
    cat.value = '경첩';
    cat.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ids()).toEqual(['a1', 'a3']);
    const find = box.querySelector('#partCatalogFind');
    find.value = '15t용';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    await until(() => ids().length === 1);
    expect(ids()).toEqual(['a1']);
    const again = box.querySelector('#partCatalogFind');
    again.value = '없는 말';
    again.dispatchEvent(new Event('input', { bubbles: true }));
    await until(() => ids().length === 0);
    expect(box.textContent).toContain('여기에 맞는 상품이 없습니다.');
  });

  test('매입가 적기 · 비우기 · 숨기기 — 서버가 돌려준 줄로 바꾼다, 틀린 글은 보내지 않는다', async () => {
    const cat = CATALOG();
    const { box, calls } = await boot(HQ, (c) => {
      if (c.method === 'GET') return ok(cat);
      const body = JSON.parse(c.body);
      const it = cat.items.find((x) => `/parts/items/${x.id}` === c.path);
      return ok({ item: { ...it, ...body, buy_price_on: body.buy_price === null ? null : '2026-11-18' } });
    });
    const set = (id, value) => {
      const el = box.querySelector(`[data-pc-buy="${id}"]`);
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('a2', '180,000원');
    await until(() => box.querySelector('[data-pc-buy="a2"]').value === '180,000');
    expect(calls[1]).toMatchObject({ method: 'PATCH', path: '/parts/items/a2' });
    expect(JSON.parse(calls[1].body)).toEqual({ buy_price: 180000 });
    expect(box.querySelector('.pc-msg').textContent).toBe('저장했습니다.');
    set('a1', '');
    await until(() => calls.length === 3);
    expect(JSON.parse(calls[2].body)).toEqual({ buy_price: null });
    // 같은 값 · 틀린 글은 보내지 않는다
    set('a2', '180000');
    set('a2', '십만원');
    await tick(20);
    expect(calls).toHaveLength(3);
    expect(box.querySelector('.pc-err').textContent).toBe('매입가는 숫자(원)로 적습니다.');
    box.querySelector('[data-pc-toggle="a3"]').click();
    await until(() => calls.length === 4);
    expect(JSON.parse(calls[3].body)).toEqual({ active: true });
    await until(() => !box.querySelector('[data-pc-item="a3"]').classList.contains('is-off'));
  });

  test('고치기가 안 되면 서버 글을 적는다', async () => {
    const { box } = await boot(HQ, (c) => (c.method === 'GET' ? ok(CATALOG()) : { status: 403, body: { success: false, message: '카탈로그는 대표 · 실장만 고칩니다' } }));
    box.querySelector('[data-pc-toggle="a1"]').click();
    await until(() => box.querySelector('.pc-err'));
    expect(box.querySelector('.pc-err').textContent).toBe('카탈로그는 대표 · 실장만 고칩니다');
  });
});

describe('철물 · 부속 카탈로그 — 파일 올리기', () => {
  const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3));
  const fileItems = (n) =>
    Array.from({ length: n }, (_, i) => ({ vendor_item_no: `N${i + 1}`, category: '경첩', name: `파일 상품 ${i + 1}`, ref_price: 1000 + i, photo: `data:image/jpeg;base64,${JPEG}`, extra: '안 보내는 값' }));
  const fileText = (items, patch = {}) => JSON.stringify({ format: 'segan-part-catalog/1', vendor: { name: '가나 철물', site_url: 'https://parts.example.com' }, seen_on: '2026-11-18', items, ...patch });
  const pick = (box, text) => {
    const input = box.querySelector('#partCatalogFile');
    Object.defineProperty(input, 'files', { value: [new File([text], 'catalog.json', { type: 'application/json' })], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  test('파일 꼴 — 꼴 이름 · 공급 회사 · 상품이 있어야 한다, 사진 글은 jpeg · png · webp base64 만', () => {
    const M = mod();
    expect(M.fileOf('글')).toBeNull();
    expect(M.fileOf(JSON.stringify({ format: 'other', vendor: { name: '가' }, items: [{}] }))).toBeNull();
    expect(M.fileOf(fileText([]))).toBeNull();
    expect(M.fileOf(fileText(fileItems(1), { vendor: {} }))).toBeNull();
    const f = M.fileOf(fileText(fileItems(2), { seen_on: '어제' }));
    expect([f.vendor, f.seen_on, f.items.length]).toEqual([{ name: '가나 철물', site_url: 'https://parts.example.com' }, '', 2]);
    expect(M.importBodyOf(fileItems(1)[0])).toEqual({ vendor_item_no: 'N1', category: '경첩', name: '파일 상품 1', ref_price: 1000 });
    expect([...M.photoBytesOf(`data:image/jpeg;base64,${JPEG}`)]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(M.photoBytesOf('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(M.photoBytesOf('https://example.com/a.jpg')).toBeNull();
    expect([M.buyOf(''), M.buyOf(' 2,500원 '), M.buyOf('-1'), M.buyOf('100000001')]).toEqual([null, 2500, undefined, undefined]);
  });

  test('상품을 30개씩 보내고, 사진은 아직 없는 상품에만 하나씩 올린다', async () => {
    const items = fileItems(65);
    const { box, calls } = await boot(HQ, (c) => {
      if (c.method === 'GET') return ok(CATALOG());
      if (c.path === '/parts/import') {
        const body = JSON.parse(c.body);
        const ids = {};
        // N1 은 이미 사진이 있다
        body.items.forEach((it) => (ids[it.vendor_item_no] = { id: `id-${it.vendor_item_no}`, has_photo: it.vendor_item_no === 'N1' }));
        return ok({ added: body.items.length, updated: 0, same: 0, ids }, 201);
      }
      if (/^\/parts\/items\/id-N\d+\/photo$/.test(c.path)) return c.path.includes('id-N3/') ? { status: 422, body: { success: false } } : ok({ has_photo: true }, 201);
      return null;
    });
    pick(box, fileText(items));
    await until(() => box.querySelector('.pc-msg'));
    const imports = calls.filter((c) => c.path === '/parts/import');
    expect(imports.map((c) => JSON.parse(c.body).items.length)).toEqual([30, 30, 5]);
    const first = JSON.parse(imports[0].body);
    expect([first.vendor.name, first.seen_on, 'photo' in first.items[0], 'extra' in first.items[0]]).toEqual(['가나 철물', '2026-11-18', false, false]);
    const photos = calls.filter((c) => c.path.endsWith('/photo'));
    expect(photos).toHaveLength(64);
    expect(photos[0].path).toBe('/parts/items/id-N2/photo');
    expect(photos[0].headers['Content-Type']).toBe('application/octet-stream');
    expect([...photos[0].body]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    // 끝나면 다시 읽고 결과를 적는다
    expect(calls[calls.length - 1]).toMatchObject({ method: 'GET', path: '/parts/catalog' });
    expect(box.querySelector('.pc-msg').textContent).toBe('올렸습니다 — 새 상품 65 · 고침 0 · 그대로 0 · 사진 63 (사진 1개는 올리지 못했습니다 — 같은 파일을 다시 올리면 이어서 올립니다)');
  });

  test('묶음이 거절되면 멈추고 서버 글을 적는다 · 꼴이 아닌 파일은 보내지 않는다', async () => {
    const { box, calls } = await boot(HQ, (c) => (c.method === 'GET' ? ok(CATALOG()) : { status: 422, body: { success: false, message: '3번째 상품: 이름은 1 ~ 120자여야 합니다' } }));
    pick(box, fileText(fileItems(40)));
    await until(() => box.querySelector('.pc-err'));
    expect(box.querySelector('.pc-err').textContent).toBe('3번째 상품: 이름은 1 ~ 120자여야 합니다 (1번째 묶음부터 올리지 못했습니다)');
    expect(calls.filter((c) => c.path === '/parts/import')).toHaveLength(1);
    const n = calls.length;
    pick(box, '카탈로그가 아닌 글');
    await until(() => box.querySelector('.pc-err').textContent === '카탈로그 파일(.json)이 아닙니다.');
    expect(calls).toHaveLength(n);
  });
});

describe('철물 · 부속 카탈로그 — 마이페이지에 이어진 곳', () => {
  test('메뉴 줄 · 칸 · 스크립트 · 화면 정의 · 캐시 목록', () => {
    const html = read('segan/me.html');
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    const li = doc.querySelector('#meSubStock [data-me-item="part-catalog"]');
    expect(li.hidden).toBe(true);
    expect(li.querySelector('a').getAttribute('href')).toBe('#part-catalog');
    expect(li.querySelector('a').textContent).toBe('철물 · 부속 카탈로그');
    const box = doc.getElementById('partCatalog');
    expect(box.hidden).toBe(true);
    expect(box.closest('section').id).toBe('partner');
    expect(box.previousElementSibling.id).toBe('stockNeeds');
    expect(box.nextElementSibling.id).toBe('orders');
    expect(html).toMatch(/<script src="part-catalog\.js\?v=\d+" defer><\/script>/);
    const me = read('segan/me.js');
    expect(me).toContain("'part-catalog': {");
    expect(me).toContain("parts: ['partCatalog'],");
    expect(me).toContain("label: 'partCatalogTitle',");
    expect(me).toMatch(/case 'part-catalog':\s+return \(v\.hq \|\| v\.platform\) && available\(key\);/);
    expect(me).toContain('synced(Parts && Parts.load ? Parts.load(auth.sb, auth.session, me) : null),');
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'part-catalog.js'),");
    expect(read('segan/shell.css')).toContain('.pc-row {');
  });
});

describe('철물 · 부속 카탈로그 — 거래명세표에서 가져오기', () => {
  const SUPPLIERS = { suppliers: [{ key: 'n:마바상사', name: '(주)마바상사 <i>', biz_no: '1234567890', docs: 3, items: 42 }, { key: '', name: '열쇠 없는 줄' }] };

  test('단추를 누르면 장부의 파는 곳을 읽어 보여 준다 — 대표 · 실장만, 닫을 수 있다', async () => {
    const staff = await boot(HQ, () => ok(CATALOG(false)));
    expect(staff.box.querySelector('[data-pc-ledger]')).toBeNull();
    const { box, calls } = await boot(HQ, (c) => (c.path === '/parts/ledger-suppliers' ? ok(SUPPLIERS) : ok(CATALOG())));
    box.querySelector('[data-pc-ledger]').click();
    await until(() => box.querySelector('.pc-ledger'));
    expect(calls[1]).toMatchObject({ method: 'GET', path: '/parts/ledger-suppliers' });
    const rows = [...box.querySelectorAll('.pc-ledger li')];
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('span').textContent).toBe('(주)마바상사 <i> 사진 3장 · 품목 42개');
    expect(rows[0].querySelector('i')).toBeNull();
    expect(rows[0].querySelector('[data-pc-take]').getAttribute('data-pc-take')).toBe('n:마바상사');
    box.querySelector('[data-pc-ledger-close]').click();
    expect(box.querySelector('.pc-ledger')).toBeNull();
    // 읽힌 품목이 없으면 그렇게 적는다
    const none = await boot(HQ, (c) => (c.path === '/parts/ledger-suppliers' ? ok({ suppliers: [] }) : ok(CATALOG())));
    none.box.querySelector('[data-pc-ledger]').click();
    await until(() => none.box.querySelector('.pc-ledger'));
    expect(none.box.querySelector('.pc-ledger').textContent).toContain('장부에서 읽힌 품목이 없습니다.');
  });

  test('가져오기 — left 가 남으면 이어서 부르고, 끝나면 다시 읽어 결과를 적는다 · 거절되면 서버 글', async () => {
    let n = 0;
    const { box, calls } = await boot(HQ, (c) => {
      if (c.path === '/parts/ledger-suppliers') return ok(SUPPLIERS);
      if (c.path === '/parts/from-ledger') {
        n += 1;
        return ok({ vendor: { id: 'v-9', name: '마바 상사' }, added: n === 1 ? 12 : 0, updated: 30, same: n === 1 ? 0 : 30, left: n === 1 ? 5 : 0 }, 201);
      }
      return ok(CATALOG());
    });
    box.querySelector('[data-pc-ledger]').click();
    await until(() => box.querySelector('[data-pc-take]'));
    box.querySelector('[data-pc-take]').click();
    await until(() => box.querySelector('.pc-msg'));
    const posts = calls.filter((c) => c.path === '/parts/from-ledger');
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[0].body)).toEqual({ supplier_key: 'n:마바상사' });
    expect(calls[calls.length - 1]).toMatchObject({ method: 'GET', path: '/parts/catalog' });
    expect(box.querySelector('.pc-msg').textContent).toBe('가져왔습니다 — 마바 상사: 새 상품 12 · 매입가 고침 60 · 그대로 30');
    expect(box.querySelector('.pc-ledger')).toBeNull();

    const bad = await boot(HQ, (c) => {
      if (c.path === '/parts/ledger-suppliers') return ok(SUPPLIERS);
      if (c.path === '/parts/from-ledger') return { status: 404, body: { success: false, message: '장부에서 그 파는 곳의 품목을 찾지 못했습니다' } };
      return ok(CATALOG());
    });
    bad.box.querySelector('[data-pc-ledger]').click();
    await until(() => bad.box.querySelector('[data-pc-take]'));
    bad.box.querySelector('[data-pc-take]').click();
    await until(() => bad.box.querySelector('.pc-err'));
    expect(bad.box.querySelector('.pc-err').textContent).toBe('장부에서 그 파는 곳의 품목을 찾지 못했습니다');
    expect(bad.box.querySelector('.pc-ledger')).not.toBeNull();
  });
});
