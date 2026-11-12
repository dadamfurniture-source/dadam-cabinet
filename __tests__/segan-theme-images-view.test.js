/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「기준정보 › 참고 이미지」 (segan/theme-images-view.js + segan/me.html #themeImages)
 *
 *   누가    사이트 관리자(is_admin)만. 관리자가 아니면 칸을 열지 않는다
 *   데이터  Supabase 표 theme_images — PC 화면과 같은 조회로 읽기만 (화면을 열었을 때 처음 읽는다)
 *   화면    상태 단추 셋 · 테마 · 몇 장 · 사진 칸 · 더 보기 — 보기 · 찾기만 (2026-11-11 대표님 결정)
 *   업로드 · 확정 · 거절 · 숨기기 · 수정 · 삭제는 PC 화면(admin/reference-images.html)에 그대로 — 링크 하나
 *   제목 · 작가 · 주소는 모두 지어낸 것이다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const Ref = require('../js/reference-images.js');

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
  delete window.SeganThemeImagesView;
  (0, eval)(read('segan/theme-images-view.js'));
  return window.SeganThemeImagesView;
};

/** theme_images 한 줄 */
const ti = (id, status, theme, patch = {}) => ({
  id,
  status,
  theme,
  title: null,
  note: null,
  license: null,
  author: null,
  source_page: null,
  preview_url: 'https://outside.example.org/preview/' + id + '.jpg',
  download_url: 'https://outside.example.org/full/' + id + '.jpg',
  origin_url: null,
  thumb_path: status === 'approved' ? 'thumb/' + id + '.jpg' : null,
  full_path: null,
  is_active: true,
  colorfulness: 0.4,
  source: 'suggestion',
  created_at: '2026-11-01T00:00:00Z',
  ...patch,
});
const ROWS = () => [
  ti('a-1', 'approved', 'animal', {
    title: '예시 그림 1',
    note: '따뜻한 흙빛',
    license: 'CC0',
    author: '예시 작가',
    source_page: 'https://commons.example.org/wiki/a1',
  }),
  ti('a-2', 'approved', 'flower', { is_active: false, colorfulness: 0.1, source: 'upload' }),
  ti('a-3', 'approved', '원목', { title: '예시 원목', thumb_path: 'thumb/원목 3.jpg' }),
  ti('p-1', 'pending', 'animal', { title: '검토할 그림', license: 'Public domain' }),
  ti('r-1', 'rejected', 'ai', { source_page: 'javascript:alert(1)' }),
];
const many = (n) =>
  Array.from({ length: n }, (_, i) => ti('m-' + i, 'approved', i % 2 ? 'animal' : 'flower'));

/**
 * 마이페이지를 띄운다 (기본 = 사이트 관리자인 본사 구성원, 참고 이미지 화면)
 * opts.table(n) 로 표 답을 바꾼다 ({ data, error } — n = 몇 번째 읽기인가) · opts.gate = 읽기를 붙잡아 둘 약속
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    hash: '#ref-images',
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
    'SeganGalleryView',
    'SeganThemeImagesView',
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
        const q = { table, select: null, eq: [], order: null, range: null, writes: [] };
        const answer = async () => {
          if (table !== 'theme_images') return { data: [], error: null };
          calls.table.push(q);
          const n = calls.table.length;
          if (opts.gate) await opts.gate;
          if (opts.table) {
            const r = await opts.table(n);
            if (r instanceof Error) throw r;
            return r;
          }
          return { data: ROWS(), error: null };
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
          order: (k, o) => {
            q.order = [k, o];
            return chain;
          },
          range: (a, b) => {
            q.range = [a, b];
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
    'segan/theme-images-view.js',
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
const box = () => $('themeImagesBody');
const q = (sel) => box().querySelector(sel);
const qa = (sel) => [...box().querySelectorAll(sel)];
const part = (name) => q(`[data-tv="${name}"]`);
const tab = (k) => q(`[data-act="status"][data-status="${k}"]`);
const tiles = () => qa('li[data-tv-row]');
const ids = () => tiles().map((li) => li.getAttribute('data-tv-row'));
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const pickTheme = (value) => {
  $('tvTheme').value = value;
  $('tvTheme').dispatchEvent(new Event('change', { bubbles: true }));
};

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 시공사례 다음의 제 칸 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('themeImages');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('SECTION');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.classList.contains('me-screen')).toBe(true);
    expect(el.previousElementSibling.id).toBe('galleryView');
    expect(el.getAttribute('aria-labelledby')).toBe('themeImagesTitle');
    expect(text(doc.getElementById('themeImagesTitle'))).toBe('참고 이미지');
    expect(doc.getElementById('themeImagesBody').parentElement).toBe(el);
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['theme-images-view.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('theme-images-view.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'theme-images-view.js')");
  });

  test('메뉴 — 기준정보 아래 앱 화면 줄, 바로 다음에 관리자 PC 화면 줄 (둘 다 처음엔 감춘다)', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const li = doc.querySelector('li[data-me-item="ref-images"]');
    expect(li).not.toBeNull();
    expect(li.closest('ul').id).toBe('meSubMaster');
    expect(li.hasAttribute('hidden')).toBe(true);
    const a = li.querySelector('a');
    expect(a.getAttribute('href')).toBe('#ref-images');
    expect(a.getAttribute('data-me-go')).toBe('ref-images');
    expect(text(a)).toBe('참고 이미지');
    const pc = li.nextElementSibling;
    expect(pc.getAttribute('data-me-item')).toBe('hq-refs');
    expect(pc.hasAttribute('hidden')).toBe(true);
    expect(pc.hasAttribute('data-need')).toBe(false);
    expect(pc.querySelector('a').getAttribute('href')).toBe('../admin/reference-images.html');
    expect(pc.querySelector('a').hasAttribute('data-desktop-tab')).toBe(true);
  });

  test('버킷 · 테마 · 상태 이름은 공용 규칙(js/reference-images.js) · PC 화면과 같다', () => {
    const T = mod();
    const pc = read('admin/reference-images.html');
    expect(T.BUCKET).toBe(Ref.BUCKET);
    expect(T.THEMES).toEqual(Ref.THEMES.map((t) => [t.key, t.label]));
    for (const [key, name] of T.STATUSES) {
      expect(pc).toMatch(new RegExp(`data-tab="${key}"[^>]*>${name} <span`));
    }
    expect(T.STATUSES.map((s) => s[0])).toEqual(['approved', 'pending', 'rejected']);
    expect(pc).toContain('r.colorfulness < 0.18');
    expect(T.GRAY_BELOW).toBe(0.18);
    for (const key of [
      'themeAll',
      'hidden',
      'gray',
      'upload',
      'source',
      'emptyPending',
      'emptyRejected',
    ]) {
      expect(pc).toContain(T.TEXT[key]);
    }
    expect(pc).toContain(".from('theme_images')");
    expect(pc).toContain('.range(0, 4999)');
  });

  test('보기만 한다 — 표 · 저장소에 쓰지 않고, 바깥에서 사진을 받지 않고, 기기에 남기지 않는다', () => {
    const code = read('segan/theme-images-view.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/\.(insert|update|delete|upsert|remove|upload)\(/);
    expect(code).not.toMatch(/\.storage\b/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/preview_url|download_url|origin_url/); // 바깥 미리보기 주소는 읽지도 않는다
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
  });

  test('사진 칸 링크 스타일은 바로 아래 링크에만 — 설명 속 「출처」 링크가 상자로 그려지지 않는다', () => {
    const css = read('segan/shell.css');
    expect(css).toMatch(/\n\.gv-tile > a\s*\{/);
    expect(css).not.toMatch(/\n\.gv-tile a\s*\{/);
    const rules = css.match(/(^|\n)\.tv[-\s][^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(4);
    expect(rules.join('\n')).not.toMatch(/box-shadow|border-radius/);
  });
});

describe('순수 함수', () => {
  test('themeLabel · rowOf — 새 테마는 키 그대로. id 가 없거나 모르는 상태면 버린다. 출처는 https 만', () => {
    const T = mod();
    expect(T.themeLabel('animal')).toBe('동물');
    expect(T.themeLabel('원목')).toBe('원목');
    expect(T.themeLabel(null)).toBe('');
    expect(T.rowOf(null)).toBeNull();
    expect(T.rowOf({ id: 'x', status: 'draft' })).toBeNull();
    expect(T.rowOf({ status: 'approved' })).toBeNull();
    const rows = ROWS().map(T.rowOf);
    expect(rows[0]).toEqual({
      id: 'a-1',
      status: 'approved',
      theme: 'animal',
      title: '예시 그림 1',
      note: '따뜻한 흙빛',
      license: 'CC0',
      author: '예시 작가',
      sourcePage: 'https://commons.example.org/wiki/a1',
      thumbPath: 'thumb/a-1.jpg',
      active: true,
      gray: false,
      upload: false,
    });
    expect(rows[1]).toMatchObject({ active: false, gray: true, upload: true });
    expect(rows[4].sourcePage).toBe(''); // javascript: 주소
  });

  test('counts · themeKeys · visible', () => {
    const T = mod();
    const rows = ROWS().map(T.rowOf);
    expect(T.counts(rows)).toEqual({ approved: 3, pending: 1, rejected: 1 });
    expect(T.counts([])).toEqual({ approved: 0, pending: 0, rejected: 0 });
    expect(T.themeKeys(rows)).toEqual([
      'animal',
      'flower',
      'nature',
      'product',
      'painting',
      'ai',
      '원목',
    ]);
    expect(T.visible(rows, 'approved', '').map((r) => r.id)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(T.visible(rows, 'approved', '원목').map((r) => r.id)).toEqual(['a-3']);
    expect(T.visible(rows, 'pending', 'flower')).toEqual([]);
  });

  test('thumbUrl · badgesOf · countText — 썸네일은 사용 중인 사진만, 경로 조각마다 인코딩', () => {
    const T = mod();
    window.DADAM_CONFIG = { supabase: { url: 'https://example.supabase.co/' } };
    const rows = ROWS().map(T.rowOf);
    expect(T.thumbUrl(rows[0])).toBe(
      'https://example.supabase.co/storage/v1/object/public/theme-images/thumb/a-1.jpg'
    );
    expect(T.thumbUrl(rows[2])).toBe(
      'https://example.supabase.co/storage/v1/object/public/theme-images/thumb/' +
        encodeURIComponent('원목 3.jpg')
    );
    expect(T.thumbUrl(rows[3])).toBe(''); // 검토 대기
    expect(T.thumbUrl({ ...rows[3], thumbPath: 'thumb/x.jpg' })).toBe(''); // 경로가 있어도 확정 전이면 그리지 않는다
    window.DADAM_CONFIG = {};
    expect(T.thumbUrl(rows[0])).toBe('');
    expect(T.badgesOf(rows[0])).toEqual([]);
    expect(T.badgesOf(rows[1])).toEqual(['숨김', '무채색', '업로드']);
    expect(T.badgesOf({ ...rows[3], active: false })).toEqual([]); // 숨김은 사용 중인 사진에만
    expect(T.countText(30, 37)).toBe('보이는 30장 / 전체 37장');
    expect(T.countText(5, 5)).toBe('5장');
    expect(T.countText(0, 0)).toBe('0장');
  });
});

describe('화면', () => {
  test('관리자가 화면을 열면 — PC 화면과 같은 조회로 한 번 읽어 「사용 중」 사진을 그린다 (읽기만)', async () => {
    const calls = await load();
    expect(calls.table.length).toBe(1);
    expect(calls.table[0]).toEqual({
      table: 'theme_images',
      select: '*',
      eq: [],
      order: ['created_at', { ascending: false }],
      range: [0, 4999],
      writes: [],
    });
    expect(seen('themeImages')).toBe(true);
    expect(qa('[data-act="status"]').map(text)).toEqual(['사용 중 3', '검토 대기 1', '거절됨 1']);
    expect(tab('approved').getAttribute('aria-pressed')).toBe('true');
    expect(text(part('count'))).toBe('3장');
    expect(ids()).toEqual(['a-1', 'a-2', 'a-3']);
    const [a, b, c] = tiles();
    expect(text(a.querySelector('b'))).toBe('동물');
    expect(a.querySelectorAll('.gv-badge').length).toBe(0);
    expect([...a.querySelectorAll('small')].map(text)).toEqual([
      '예시 그림 1',
      '따뜻한 흙빛',
      'CC0 · 예시 작가 · 출처',
    ]);
    expect([...b.querySelectorAll('.gv-badge')].map(text)).toEqual(['숨김', '무채색', '업로드']);
    expect(b.classList.contains('tv-off')).toBe(true);
    expect(a.classList.contains('tv-off')).toBe(false);
    expect(text(c.querySelector('b'))).toBe('원목'); // 새 테마는 이름 그대로
    expect([...$('tvTheme').options].map(text)).toEqual([
      '전체 테마',
      '동물',
      '꽃',
      '자연',
      '제품',
      '회화',
      'AI 디자인',
      '원목',
    ]);
    expect(menu('ref-images').hidden).toBe(false);
    expect(menu('hq-refs').hidden).toBe(true);
  });

  test('사진 — 사용 중인 사진은 우리 저장소 썸네일. 출처는 새 탭 링크 (참조자 안 보냄)', async () => {
    await load();
    const img = tiles()[0].querySelector('img');
    expect(img.getAttribute('src')).toBe(
      'https://example.supabase.co/storage/v1/object/public/theme-images/thumb/a-1.jpg'
    );
    expect(img.getAttribute('alt')).toBe('예시 그림 1 참고 이미지 1');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(tiles()[1].querySelector('img').getAttribute('alt')).toBe('꽃 참고 이미지 2'); // 제목이 없으면 테마 이름
    const src = tiles()[0].querySelector('.gv-cap a');
    expect(src.getAttribute('href')).toBe('https://commons.example.org/wiki/a1');
    expect(src.getAttribute('target')).toBe('_blank');
    expect(src.getAttribute('rel')).toBe('noopener noreferrer');
    expect(tiles()[1].querySelector('.gv-cap a')).toBeNull();
  });

  test('검토 대기 · 거절됨 — 바깥 미리보기를 그리지 않고 글로만 적는다', async () => {
    const calls = await load();
    await press(tab('pending'));
    expect(calls.table.length).toBe(1); // 서버에 다시 묻지 않는다
    expect(tab('pending').getAttribute('aria-pressed')).toBe('true');
    expect(ids()).toEqual(['p-1']);
    expect(text(part('count'))).toBe('1장');
    expect(q('img')).toBeNull();
    expect(text(q('.tv-nopic'))).toBe('사진은 확정한 뒤 우리 저장소에 들어옵니다');
    expect(box().innerHTML).not.toContain('outside.example.org');
    await press(tab('rejected'));
    expect(ids()).toEqual(['r-1']);
    expect(q('img')).toBeNull();
    expect(q('.gv-cap a')).toBeNull(); // javascript: 출처는 링크로 만들지 않는다
    expect(box().innerHTML).not.toContain('javascript:');
  });

  test('PC 화면 링크 — 확정 · 수정은 PC 관리 화면에서. 고치는 단추가 없다', async () => {
    await load();
    const a = part('pc');
    expect(a.getAttribute('href')).toBe('../admin/reference-images.html');
    expect(a.hasAttribute('data-desktop-tab')).toBe(true);
    expect(qa('button').map((b) => b.getAttribute('data-act'))).toEqual([
      'status',
      'status',
      'status',
    ]);
    expect(qa('input').length).toBe(0);
  });

  test('마이페이지 다른 화면에 있을 때는 읽지 않는다 — 들어오면 그때 한 번 읽는다', async () => {
    const calls = await load({ hash: '' });
    expect(calls.table.length).toBe(0);
    expect(menu('ref-images').hidden).toBe(false);
    window.location.hash = '#ref-images';
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(calls.table.length).toBe(1);
    expect(seen('themeImages')).toBe(true);
    window.location.hash = '#gallery-list';
    window.dispatchEvent(new Event('hashchange'));
    window.location.hash = '#ref-images';
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(calls.table.length).toBe(1);
  });

  test('제목 · 설명 · 테마 이름은 글자 그대로 그린다', async () => {
    const rows = ROWS();
    rows[0].title = '<img src=x onerror=1>';
    rows[0].note = '<script>x</script>';
    rows[0].theme = '<b>테마</b>';
    rows[0].thumb_path = null;
    await load({ table: () => ({ data: rows, error: null }) });
    expect(tiles()[0].querySelector('img')).toBeNull();
    expect(q('script')).toBeNull();
    expect(text(tiles()[0].querySelector('b'))).toBe('<b>테마</b>');
    expect(text(tiles()[0].querySelector('.tv-title'))).toBe('<img src=x onerror=1>');
    expect([...$('tvTheme').options].map((o) => o.value)).toContain('<b>테마</b>');
  });

  test('비었을 때 — 상태마다 안내 글', async () => {
    await load({ table: () => ({ data: [], error: null }) });
    expect(qa('[data-act="status"]').map(text)).toEqual(['사용 중 0', '검토 대기 0', '거절됨 0']);
    expect(text(part('count'))).toBe('0장');
    expect(text(part('empty'))).toBe('아직 사용 중인 사진이 없습니다.');
    await press(tab('pending'));
    expect(text(part('empty'))).toBe('검토할 추천이 없습니다.');
    await press(tab('rejected'));
    expect(text(part('empty'))).toBe('거절한 사진이 없습니다.');
  });
});

describe('테마 · 더 보기', () => {
  test('테마 고르기 — 서버에 묻지 않고 거른다. 상태를 바꿔도 고른 테마는 남는다', async () => {
    const calls = await load();
    pickTheme('원목');
    expect(ids()).toEqual(['a-3']);
    expect($('tvTheme').value).toBe('원목');
    pickTheme('animal');
    expect(ids()).toEqual(['a-1']);
    await press(tab('pending'));
    expect($('tvTheme').value).toBe('animal');
    expect(ids()).toEqual(['p-1']);
    pickTheme('');
    expect(ids()).toEqual(['p-1']);
    expect(calls.table.length).toBe(1);
  });

  test('더 보기 — 한 번에 PAGE 장, 남은 수를 적고 이어 붙인다. 상태 · 테마를 바꾸면 처음부터', async () => {
    const T0 = mod();
    const n = T0.PAGE + 12;
    await load({ table: () => ({ data: many(n), error: null }) });
    const T = window.SeganThemeImagesView;
    expect(tiles().length).toBe(T.PAGE);
    expect(text(part('count'))).toBe(`보이는 ${T.PAGE}장 / 전체 ${n}장`);
    expect(text(q('[data-act="more"]'))).toBe('더 보기 (남은 12장)');
    await press(q('[data-act="more"]'));
    expect(tiles().length).toBe(n);
    expect(q('[data-act="more"]')).toBeNull();
    expect(text(part('count'))).toBe(`${n}장`);
    expect(document.activeElement).toBe(tiles()[T.PAGE]);
    pickTheme('animal');
    expect(tiles().length).toBe(n / 2);
    pickTheme('');
    expect(tiles().length).toBe(T.PAGE);
  });

  test('읽는 동안 — 단추 · 고르는 칸을 잠그고 「불러오는 중」', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const calls = await load({ gate });
    expect(text(part('loading'))).toBe('불러오는 중…');
    expect(box().getAttribute('aria-busy')).toBe('true');
    expect(qa('button, select').every((el) => el.disabled)).toBe(true);
    expect(qa('[data-act="status"]').map(text)).toEqual(['사용 중', '검토 대기', '거절됨']); // 장수는 읽은 뒤에
    release();
    await flush();
    await flush();
    expect(calls.table.length).toBe(1);
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(tiles().length).toBe(3);
  });
});

describe('못 읽을 때', () => {
  test('표가 오류를 주면 — 그 자리에 글과 「다시 읽기」. 다시 읽으면 사진이 나온다', async () => {
    const calls = await load({
      table: (n) =>
        n === 1
          ? { data: null, error: { message: 'relation does not exist' } }
          : { data: ROWS(), error: null },
    });
    expect(seen('themeImages')).toBe(true);
    expect(text(part('failed'))).toBe('불러오지 못했습니다. (relation does not exist)');
    expect(tiles().length).toBe(0);
    await press(q('[data-act="retry"]'));
    expect(calls.table.length).toBe(2);
    expect(part('failed')).toBeNull();
    expect(tiles().length).toBe(3);
  });

  test('끊기거나 이상한 답 — 기본 글', async () => {
    for (const first of [() => new Error('offline'), () => ({ data: 'x', error: null })]) {
      await load({ table: () => first() });
      expect(text(part('failed'))).toBe('불러오지 못했습니다.');
    }
  });
});

describe('안 보이는 때', () => {
  test('관리자가 아닌 사람 · 로그인하지 않은 사람 — 칸을 열지 않고 표도 읽지 않는다. 메뉴 줄 둘 다 없다', async () => {
    for (const o of [{ isAdmin: false }, { session: null }]) {
      const calls = await load(o);
      expect(calls.table.length).toBe(0);
      expect(seen('themeImages')).toBe(false);
      expect(box().innerHTML).toBe('');
      expect(menu('ref-images').hidden).toBe(true);
      expect(menu('hq-refs').hidden).toBe(true);
    }
  }, 20000);
});
