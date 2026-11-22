/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach, jest, __dirname, window, localStorage, sessionStorage, Storage */
/**
 * segan/source.js — 유입 경로 (2026-11-23 「사이트 새는 곳 막기」 묶음 3, DB 0080).
 *   처음 들어온 곳 하나만 90일 — 꼬리표(utm_*) 또는 바깥 사이트 호스트. 상담 줄에 columns(), 가입한 사람 줄에 claim().
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = read('segan/source.js');
const DAY = 864e5;

function load() {
  delete window.SeganSource;
  (0, eval)(SRC);
  return window.SeganSource;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('담기 — 처음 들어온 곳 하나만', () => {
  test('꼬리표가 있으면 셋을 담고, 뒤에 다른 꼬리표로 와도 바꾸지 않는다', () => {
    const S = load();
    expect(
      S.remember(
        '?utm_source=instagram&utm_medium=social&utm_campaign=tones',
        '',
        'dadamfurniture.com'
      )
    ).toBe(true);
    expect(S.remember('?utm_source=threads', '', 'dadamfurniture.com')).toBe(false);
    expect(S.columns()).toEqual({
      inflow_source: 'instagram',
      inflow_medium: 'social',
      inflow_campaign: 'tones',
    });
  });

  test('꼬리표가 없으면 바깥 사이트 호스트만 (주소 전체 · 경로 · 검색어는 담지 않는다)', () => {
    const S = load();
    S.remember(
      '',
      'https://search.naver.com/search.naver?query=%EB%A7%9E%EC%B6%A4%EA%B0%80%EA%B5%AC',
      'dadamfurniture.com'
    );
    expect(S.columns()).toEqual({ inflow_referrer: 'search.naver.com' });
    expect(localStorage.getItem(S.KEY)).not.toContain('query');
  });

  test.each([
    ['같은 사이트에서 옮겨 다님', 'https://dadamfurniture.com/segan/blog'],
    ['다담 하위 주소', 'https://www.dadamfurniture.com/'],
    ['미리보기 주소 자기 자신', 'https://agent-x.dadam-cabinet.pages.dev/segan/'],
    ['앞 사이트 없음', ''],
    ['이상한 앞 주소', 'not a url'],
  ])('담지 않는다 — %s', (_, ref) => {
    const S = load();
    expect(
      S.remember(
        '',
        ref,
        ref.includes('pages.dev') ? 'agent-x.dadam-cabinet.pages.dev' : 'dadamfurniture.com'
      )
    ).toBe(false);
    expect(S.columns()).toEqual({});
  });

  test('90일이 지나면 없는 것으로 보고 새로 담는다', () => {
    const S = load();
    localStorage.setItem(S.KEY, JSON.stringify({ source: 'old', at: Date.now() - 91 * DAY }));
    expect(S.read()).toBeNull();
    expect(S.remember('?utm_source=new', '', 'dadamfurniture.com')).toBe(true);
    expect(S.columns()).toEqual({ inflow_source: 'new' });
  });

  test('제어 문자는 빼고, 꼬리표는 100자 · 호스트는 200자까지', () => {
    const S = load();
    S.remember(
      '?utm_source=' + encodeURIComponent('ig\u0000\u0007') + '&utm_campaign=' + 'c'.repeat(150),
      '',
      'x'
    );
    expect(S.columns()).toEqual({ inflow_source: 'ig', inflow_campaign: 'c'.repeat(100) });
  });

  test('실리면 지금 주소 · 앞 사이트로 바로 담는다', () => {
    window.history.replaceState(null, '', '/segan/?utm_source=kakao&utm_medium=cpc');
    load();
    expect(window.SeganSource.columns()).toEqual({ inflow_source: 'kakao', inflow_medium: 'cpc' });
    window.history.replaceState(null, '', '/');
  });

  test('저장소가 막힌 기기 — 오류 없이 넘어간다', () => {
    const S = load();
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(S.remember('?utm_source=x', '', 'y')).toBe(false);
    set.mockRestore();
  });
});

describe('가입 유입 — claim(sb, session)', () => {
  const UID = '11111111-1111-4111-8111-111111111111';
  const SESSION = { user: { id: UID } };
  function fakeSb(row, opts = {}) {
    const calls = { select: 0, update: [] };
    const sb = {
      from: (table) => {
        expect(table).toBe('profiles');
        const q = { filters: [] };
        const chain = {
          select: (cols) => {
            calls.select++;
            q.cols = cols;
            return chain;
          },
          update: (v) => {
            q.update = v;
            return chain;
          },
          eq: (c, v) => {
            q.filters.push(['eq', c, v]);
            return chain;
          },
          is: (c, v) => {
            q.filters.push(['is', c, v]);
            return chain;
          },
          maybeSingle: async () => ({ data: row, error: opts.readError || null }),
          then: (res, rej) => {
            calls.update.push({ value: q.update, filters: q.filters });
            return Promise.resolve({ error: opts.writeError || null }).then(res, rej);
          },
        };
        return chain;
      },
    };
    return { sb, calls };
  }

  test('담은 뒤에 가입했고 비어 있으면 한 번 채운다 (inflow_at 이 비었을 때만 고친다)', async () => {
    const S = load();
    S.remember('?utm_source=instagram&utm_campaign=tones', '', 'x', Date.now() - 60000);
    const { sb, calls } = fakeSb({ inflow_at: null, created_at: new Date().toISOString() });
    expect(await S.claim(sb, SESSION)).toBe(true);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].value).toMatchObject({
      inflow_source: 'instagram',
      inflow_campaign: 'tones',
    });
    expect(Date.parse(calls.update[0].value.inflow_at)).not.toBeNaN();
    expect(calls.update[0].filters).toEqual([
      ['eq', 'id', UID],
      ['is', 'inflow_at', null],
    ]);
    // 같은 탭에서는 다시 묻지 않는다
    expect(await S.claim(sb, SESSION)).toBe(false);
    expect(calls.select).toBe(1);
  });

  test.each([
    ['담기 전에 가입한 오래된 회원', { inflow_at: null, created_at: '2026-01-01T00:00:00Z' }],
    ['이미 채운 회원', { inflow_at: '2026-11-01T00:00:00Z', created_at: new Date().toISOString() }],
    ['회원 줄을 못 읽음', null],
  ])('채우지 않는다 — %s', async (_, row) => {
    const S = load();
    S.remember('?utm_source=instagram', '', 'x', Date.now() - 60000);
    const { sb, calls } = fakeSb(row);
    expect(await S.claim(sb, SESSION)).toBe(false);
    expect(calls.update).toHaveLength(0);
  });

  test('담은 값 · 로그인 · 클라이언트가 없으면 묻지도 않는다', async () => {
    const S = load();
    const { sb, calls } = fakeSb({ inflow_at: null, created_at: new Date().toISOString() });
    expect(await S.claim(sb, SESSION)).toBe(false);
    S.remember('?utm_source=instagram', '', 'x');
    expect(await S.claim(sb, null)).toBe(false);
    expect(await S.claim(null, SESSION)).toBe(false);
    expect(calls.select).toBe(0);
  });
});

describe('싣는 곳 · 쓰는 곳', () => {
  const PAGES = [
    'index',
    'make',
    'collection',
    'consult',
    'about',
    'plans',
    'blog',
    'blog-materials',
    'blog-edge-finish',
    'blog-hardware',
    'blog-kitchen-appliances',
    'blog-drawer-rails',
    'blog-hinges',
  ];

  test.each(PAGES)('%s.html — 공개 화면은 motion.js 바로 앞에 source.js (defer)', (p) => {
    const html = read(`segan/${p}.html`);
    expect(html).toMatch(
      /<script src="source\.js\?v=\d+" defer><\/script>\s*<script src="motion\.js\?v=\d+"><\/script>/
    );
  });

  test('로그인 뒤 화면에는 싣지 않는다', () => {
    const others = fs
      .readdirSync(path.join(ROOT, 'segan'))
      .filter((n) => n.endsWith('.html') && !PAGES.includes(n.replace(/\.html$/, '')));
    expect(others.length).toBeGreaterThan(5);
    for (const n of others)
      expect([n, read(`segan/${n}`).includes('source.js')]).toEqual([n, false]);
  });

  test('상담 두 줄(연출컷 · 일반)에 유입 칸을 붙이고, 연출컷 상담 여닫기 칸(NEW_COLUMNS)에는 넣지 않는다', () => {
    const c = read('segan/consult.js').replace(/\r\n/g, '\n');
    expect(c.match(/\},\s*inflow\(\)\s*\);/g)).toHaveLength(2);
    const cols = c.match(/var NEW_COLUMNS =[^;]*;/)[0];
    expect(cols).not.toMatch(/inflow/);
    expect(c).toContain('window.SeganSource.claim(C.sb, C.session)');
    expect(read('segan/make.js')).toContain('window.SeganSource.claim(S.sb, S.session)');
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'source.js')");
  });
});
