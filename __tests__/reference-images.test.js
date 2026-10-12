/**
 * 참고 이미지 (연출컷 「테마」 탭) — DB·공용 모듈·관리자 화면.
 *
 * 왜: 테마 사진을 손님이 열 때마다 위키미디어에서 찾고 300장 채도를 재느라 ~45초 걸렸다.
 *   이제 미리 골라 Supabase 에 두고 읽기만 한다.
 *
 *   - database/reference-images.sql   표·버킷·RLS (소스 텍스트로 고정 — design-renders-sql.test.js 방식)
 *   - js/reference-images.js          공용 순수 함수 (추천 파일 검사·채도·크기)
 *   - admin/reference-images.html     관리자 화면 (업로드 → 사용 중, 추천 불러오기 → 검토 대기 → 확정)
 *
 * 서비스 롤 키를 쓰지 않는다 — 넣는 것은 늘 관리자 로그인(is_admin)이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');

const SQL = read('database/reference-images.sql');
const body = SQL.replace(/--[^\n]*/g, '');
const statements = body
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const R = require('../js/reference-images.js');
const PAGE = read('admin/reference-images.html');

describe('reference-images.sql — 표', () => {
  const table = statements.find((s) => /^CREATE TABLE/i.test(s));

  test('CREATE TABLE IF NOT EXISTS public.theme_images 하나', () => {
    expect(statements.filter((s) => /^CREATE TABLE/i.test(s))).toHaveLength(1);
    expect(table).toMatch(/^CREATE TABLE IF NOT EXISTS public\.theme_images/);
  });

  test('상태 셋 · 출처 둘 — 기본은 검토 대기', () => {
    expect(table).toMatch(/status\s+TEXT NOT NULL DEFAULT 'pending'\s+CHECK \(status IN \('pending', 'approved', 'rejected'\)\)/);
    expect(table).toMatch(/source\s+TEXT NOT NULL CHECK \(source IN \('upload', 'claude'\)\)/);
  });

  test('테마는 길이만 묶는다 (새 테마는 이름 그대로) — 모듈의 isValidTheme 와 같은 1~32', () => {
    expect(table).toMatch(/theme\s+TEXT NOT NULL CHECK \(char_length\(btrim\(theme\)\) BETWEEN 1 AND 32\)/);
  });

  test('검토용·복사용 주소를 따로 둔다 (원본은 수십 MB 일 수 있다)', () => {
    for (const c of ['origin_url', 'preview_url', 'download_url', 'source_page', 'author', 'license']) {
      expect(table).toMatch(new RegExp('\\n\\s*' + c + '\\s+TEXT'));
    }
  });

  test('사용 중인 사진은 반드시 우리 Storage 파일이 있다', () => {
    expect(table).toMatch(
      /CHECK \(status <> 'approved' OR \(storage_path IS NOT NULL AND thumb_path IS NOT NULL\)\)/,
    );
  });

  test('같은 원본은 한 번만 — 거절한 것도 남아 다시 추천되지 않는다', () => {
    const uniq = statements.find((s) => /^CREATE UNIQUE INDEX/i.test(s));
    expect(uniq).toMatch(/IF NOT EXISTS theme_images_origin_url_key\s+ON public\.theme_images \(origin_url\)\s+WHERE origin_url IS NOT NULL/);
  });

  test('연출컷 질의용 인덱스 (status, is_active, theme)', () => {
    const idx = statements.find((s) => /^CREATE INDEX/i.test(s));
    expect(idx).toMatch(/IF NOT EXISTS \w+\s+ON public\.theme_images \(status, is_active, theme\)/);
  });

  test('reference_images 는 벽 분석 few-shot 의 다른 표다 — 그 이름을 표로 쓰지 않는다', () => {
    // 2026-10-08: 처음 이 이름을 썼다가 IF NOT EXISTS 가 옛 표를 건너뛰고 인덱스에서 깨졌다
    expect(body).not.toMatch(/public\.reference_images|ON reference_images|'reference-images'/);
    expect(PAGE).not.toMatch(/from\('reference_images'\)/);
    expect(PAGE).toMatch(/from\('theme_images'\)/);
    expect(R.BUCKET).toBe('theme-images');
  });

  test('같은 이름의 다른 표가 있으면 인덱스 전에 분명한 메시지로 멈춘다', () => {
    const guard = body.indexOf('RAISE EXCEPTION');
    expect(guard).toBeGreaterThan(body.indexOf('CREATE TABLE IF NOT EXISTS public.theme_images'));
    expect(guard).toBeLessThan(body.indexOf('CREATE UNIQUE INDEX'));
    expect(body).toMatch(/table_name = 'theme_images' AND column_name = 'origin_url'/);
  });
});

describe('reference-images.sql — 권한', () => {
  test('RLS 켬 · 손님은 사용 중이면서 숨기지 않은 것만 읽는다', () => {
    expect(body).toMatch(/ALTER TABLE public\.theme_images ENABLE ROW LEVEL SECURITY/);
    const p = statements.find((s) => /^CREATE POLICY "theme_images_public_read"/.test(s));
    expect(p).toMatch(/FOR SELECT/);
    expect(p).toMatch(/USING \(status = 'approved' AND is_active\)/);
  });

  test('쓰기는 관리자(is_admin)만 — USING · WITH CHECK 둘 다', () => {
    const p = statements.find((s) => /^CREATE POLICY "theme_images_admin_all"/.test(s));
    expect(p).toMatch(/FOR ALL\s+TO authenticated/);
    expect(p).toMatch(/USING \(public\.is_admin\(\)\)\s+WITH CHECK \(public\.is_admin\(\)\)/);
    // 표에 다른 쓰기 정책은 없다
    const tablePolicies = statements.filter((s) => /^CREATE POLICY [^\n]+ON public\.theme_images/.test(s));
    expect(tablePolicies).toHaveLength(2);
  });

  test('버킷은 공개 읽기 · 올리기/덮어쓰기/지우기는 관리자만', () => {
    expect(body).toMatch(/INSERT INTO storage\.buckets \(id, name, public\)\s+VALUES \('theme-images', 'theme-images', TRUE\)\s+ON CONFLICT \(id\) DO UPDATE SET public = TRUE/);
    const obj = statements.filter((s) => /^CREATE POLICY "theme_images_obj_/.test(s));
    expect(obj).toHaveLength(4);
    const read = obj.find((s) => /_obj_read"/.test(s));
    expect(read).toMatch(/FOR SELECT\s+USING \(bucket_id = 'theme-images'\)/);
    for (const kind of ['insert', 'update', 'delete']) {
      const p = obj.find((s) => new RegExp('_obj_' + kind + '"').test(s));
      expect(p).toMatch(new RegExp('FOR ' + kind.toUpperCase() + '\\s+TO authenticated'));
      expect(p).toMatch(/bucket_id = 'theme-images' AND public\.is_admin\(\)/);
    }
  });

  test('두 번 돌려도 안전 — 정책마다 DROP IF EXISTS 가 앞선다, 파괴 문장 없음', () => {
    const names = [...body.matchAll(/CREATE POLICY "([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBe(6);
    for (const n of names) {
      const drop = body.indexOf('DROP POLICY IF EXISTS "' + n + '"');
      expect(drop).toBeGreaterThanOrEqual(0);
      expect(drop).toBeLessThan(body.indexOf('CREATE POLICY "' + n + '"'));
    }
    expect(body).not.toMatch(/DROP\s+(TABLE|BUCKET|INDEX|FUNCTION)/i);
    expect(body).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  });

  test('모듈의 버킷 이름과 같다', () => {
    expect(SQL).toContain("'" + R.BUCKET + "'");
  });
});

describe('js/reference-images.js — 순수 함수', () => {
  test('기본 테마 여섯 — 연출컷 화면의 갈래 그대로', () => {
    expect(R.THEMES.map((t) => t.key)).toEqual(['animal', 'flower', 'nature', 'product', 'painting', 'ai']);
    expect(R.themeLabel('flower')).toBe('꽃');
    expect(R.themeLabel('원목')).toBe('원목'); // 새 테마는 이름이 곧 키
    expect(R.themeLabel('x', { x: '엑스' })).toBe('엑스');
  });

  test('isValidTheme — 1~32자, 슬래시·제어문자 막음', () => {
    expect(R.isValidTheme('animal')).toBe(true);
    expect(R.isValidTheme('원목')).toBe(true);
    expect(R.isValidTheme('  원목  ')).toBe(true);
    expect(R.isValidTheme('')).toBe(false);
    expect(R.isValidTheme('   ')).toBe(false);
    expect(R.isValidTheme(null)).toBe(false);
    expect(R.isValidTheme('a'.repeat(32))).toBe(true);
    expect(R.isValidTheme('a'.repeat(33))).toBe(false);
    expect(R.isValidTheme('a/b')).toBe(false);
    expect(R.isValidTheme('a' + String.fromCharCode(10) + 'b')).toBe(false);
  });

  test('채도 — 회색은 무채색, 빨강은 색감', () => {
    const fill = (rgb, n) => {
      const a = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) a.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
      return a;
    };
    const gray = R.colorfulnessFromRGBA(fill([128, 128, 128], 16));
    expect(gray).toEqual({ score: 0, colorful: false });
    const red = R.colorfulnessFromRGBA(fill([220, 30, 30], 16));
    expect(red.colorful).toBe(true);
    expect(red.score).toBeCloseTo(0.864, 3);
    // 대부분 회색이어도 선명한 화소가 25% 넘으면 색감
    const mix = new Uint8ClampedArray(16 * 4);
    mix.set(fill([128, 128, 128], 12), 0);
    mix.set(fill([0, 200, 0], 4), 12 * 4);
    const m = R.colorfulnessFromRGBA(mix);
    expect(m.colorful).toBe(true);
    expect(R.colorfulnessFromRGBA(new Uint8ClampedArray(0))).toEqual({ score: 0, colorful: false });
  });

  test('크기 — 줄이기만 하고 키우지 않는다', () => {
    expect(R.fitLongEdge(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(R.fitLongEdge(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 });
    expect(R.fitLongEdge(800, 600, 1600)).toEqual({ w: 800, h: 600 });
    expect(R.fitWidth(1600, 1200, 320)).toEqual({ w: 320, h: 240 });
    expect(R.fitWidth(200, 100, 320)).toEqual({ w: 200, h: 100 });
    expect(R.FULL_LONG_EDGE).toBe(1600);
    expect(R.THUMB_WIDTH).toBe(320);
  });

  test('경로 — 행 id 하나에 원본·썸네일', () => {
    expect(R.pathsFor('abc')).toEqual({ full: 'abc/full.jpg', thumb: 'abc/thumb.jpg' });
  });
});

describe('validateSuggestions — Claude 추천 파일', () => {
  const item = (o) => Object.assign({
    theme: 'flower',
    title: '튤립',
    note: '빨강·초록 대비',
    origin_url: 'https://upload.wikimedia.org/a.jpg',
    preview_url: 'https://upload.wikimedia.org/thumb/a.jpg/320px-a.jpg',
    download_url: 'https://upload.wikimedia.org/thumb/a.jpg/1280px-a.jpg',
    source_page: 'https://commons.wikimedia.org/wiki/File:a.jpg',
    author: '누군가',
    license: 'CC0',
  }, o);
  const file = (items) => ({ format: R.SUGGESTION_FORMAT, items });

  test('형식이 다르거나 비면 통째로 거절', () => {
    expect(R.validateSuggestions(null).ok).toBe(false);
    expect(R.validateSuggestions({ items: [item()] }).ok).toBe(false);
    expect(R.validateSuggestions({ format: 'other', items: [item()] }).ok).toBe(false);
    expect(R.validateSuggestions(file([])).ok).toBe(false);
    expect(R.validateSuggestions(file('x')).ok).toBe(false);
  });

  test('맞는 항목은 DB 행 모양으로 정리해 돌려준다', () => {
    const v = R.validateSuggestions(file([item()]));
    expect(v.ok).toBe(true);
    expect(v.skipped).toEqual([]);
    expect(v.items).toEqual([{
      theme: 'flower',
      title: '튤립',
      note: '빨강·초록 대비',
      origin_url: 'https://upload.wikimedia.org/a.jpg',
      preview_url: 'https://upload.wikimedia.org/thumb/a.jpg/320px-a.jpg',
      download_url: 'https://upload.wikimedia.org/thumb/a.jpg/1280px-a.jpg',
      source_page: 'https://commons.wikimedia.org/wiki/File:a.jpg',
      author: '누군가',
      license: 'CC0',
    }]);
  });

  test('상태·출처·파일 경로 같은 값은 파일에서 받지 않는다', () => {
    const v = R.validateSuggestions(file([item({ status: 'approved', source: 'upload', storage_path: 'x', id: 'y', is_active: false })]));
    const keys = Object.keys(v.items[0]);
    for (const k of ['status', 'source', 'storage_path', 'thumb_path', 'id', 'is_active', 'created_by', 'reviewed_by']) {
      expect(keys).not.toContain(k);
    }
  });

  test('항목별로 건너뛴다 — 이유와 순번을 남긴다', () => {
    const v = R.validateSuggestions(file([
      item({ origin_url: 'https://x/1.jpg' }),
      item({ origin_url: 'https://x/2.jpg', theme: '' }),
      item({ origin_url: 'http://x/3.jpg' }),
      item({ origin_url: 'https://x/4.jpg', license: 'CC BY-SA 4.0' }),
      item({ origin_url: 'https://x/5.jpg', license: '' }),
      item({ origin_url: 'https://x/1.jpg' }),          // 파일 안 중복
      item({ origin_url: 'https://x/known.jpg' }),      // DB 에 이미
      null,
      item({ origin_url: 'https://x/9.jpg', license: 'Public domain' }),
    ]), new Set(['https://x/known.jpg']));
    expect(v.ok).toBe(true);
    expect(v.items.map((i) => i.origin_url)).toEqual(['https://x/1.jpg', 'https://x/9.jpg']);
    expect(v.skipped.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(v.skipped.find((s) => s.index === 3).reason).toMatch(/라이선스/);
    expect(v.skipped.find((s) => s.index === 5).reason).toMatch(/이미 있는/);
    expect(v.skipped.find((s) => s.index === 6).reason).toMatch(/이미 있는/);
  });

  test('부가 주소는 https 만 — 아니면 비운다 (javascript: 같은 것)', () => {
    const v = R.validateSuggestions(file([item({
      preview_url: 'javascript:alert(1)',
      download_url: 'http://x/a.jpg',
      source_page: 'data:text/html,hi',
    })]));
    expect(v.items[0].preview_url).toBeNull();
    expect(v.items[0].download_url).toBeNull();
    expect(v.items[0].source_page).toBeNull();
  });

  test('길이를 자른다 — 제목 120 · 설명 200 (생성 프롬프트에 그대로 간다) · 작가 200', () => {
    const v = R.validateSuggestions(file([item({ title: 't'.repeat(300), note: 'n'.repeat(900), author: 'a'.repeat(400) })]));
    expect(v.items[0].title).toHaveLength(120);
    expect(v.items[0].note).toHaveLength(200);
    expect(v.items[0].author).toHaveLength(200);
  });

  test('known 은 배열로도 받는다', () => {
    const v = R.validateSuggestions(file([item()]), ['https://upload.wikimedia.org/a.jpg']);
    expect(v.items).toHaveLength(0);
    expect(v.skipped).toHaveLength(1);
  });
});

describe('admin/reference-images.html — 관리자 화면', () => {
  const script = PAGE.slice(PAGE.lastIndexOf('<script>'));

  test('공용 모듈과 관리자 판정을 싣는다', () => {
    expect(PAGE).toContain('<script src="../js/config.js"></script>');
    expect(PAGE).toContain('<script src="../js/admin-access.js"></script>');
    expect(PAGE).toContain('<script src="../js/reference-images.js"></script>');
    expect(script).toMatch(/window\.AdminAccess \? await window\.AdminAccess\.isAdmin\(sb\) : false/);
    expect(script).toMatch(/if \(!isAdmin\) \{ showAccessDenied\(\); return; \}/);
  });

  test('서비스 롤 키는 어디에도 없다 — 익명 키 + 관리자 세션', () => {
    expect(PAGE).not.toMatch(/service_role|serviceRole|SERVICE_ROLE/);
    expect(script).toMatch(/createClient\(url, anonKey\)/);
  });

  test('업로드는 곧바로 사용 중 · 추천 불러오기는 검토 대기(source claude)', () => {
    expect(script).toMatch(/status: 'approved', source: 'upload'/);
    expect(script).toMatch(/Object\.assign\(\{ status: 'pending', source: 'claude' \}, it\)/);
  });

  test('추천 파일은 validateSuggestions 를 거치고, 이미 있는 원본(거절 포함)을 건너뛴다', () => {
    expect(script).toMatch(/new Set\(S\.rows\.map\(\(r\) => r\.origin_url\)\.filter\(Boolean\)\)/);
    expect(script).toMatch(/R\.validateSuggestions\(json, known\)/);
  });

  test('확정은 원본을 받아 우리 Storage 에 복사한 뒤 approved 로 바꾼다', () => {
    const fn = script.slice(script.indexOf('async function approveOne'), script.indexOf('async function setStatus'));
    expect(fn).toMatch(/r\.download_url \|\| r\.origin_url/);
    expect(fn.indexOf('uploadPair(r.id')).toBeGreaterThan(0);
    expect(fn.indexOf("status: 'approved'")).toBeGreaterThan(fn.indexOf('uploadPair(r.id'));
    expect(fn).toMatch(/storage_path: p\.full, thumb_path: p\.thumb/);
  });

  test('업로드가 DB 에서 실패하면 올린 파일을 지운다', () => {
    expect(script).toMatch(/if \(error\) \{ await removePair\(id\); throw new Error\(error\.message\); \}/);
  });

  test('파일에서 온 주소는 https 만 화면에 넣는다', () => {
    expect(script).toMatch(/function safeUrl\(u\)/);
    expect(script).toMatch(/safeUrl\(r\.preview_url \|\| r\.download_url \|\| r\.origin_url\)/);
    expect(script).toMatch(/const src = safeUrl\(r\.source_page\)/);
  });

  test('무채색 표시 문턱이 모듈의 채도 문턱(0.18)과 같다', () => {
    expect(script).toMatch(/r\.colorfulness < 0\.18/);
    const mod = read('js/reference-images.js');
    expect(mod).toMatch(/score >= 0\.18/);
  });

  test('사용 중·검토 대기 카드에 「수정」 — 거절된 카드에는 없다', () => {
    const fn = script.slice(script.indexOf('function cardHTML'), script.indexOf('function renderBulk'));
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).toMatch(/const editBtn = '<button class="btn btn-light" data-act="edit"/);
    const pending = fn.slice(fn.indexOf("if (r.status === 'pending')"), fn.indexOf("} else if (r.status === 'approved')"));
    const approved = fn.slice(fn.indexOf("} else if (r.status === 'approved')"), fn.indexOf('} else {'));
    const rejected = fn.slice(fn.indexOf('} else {'), fn.indexOf('return '));
    expect(pending).toContain('editBtn');
    expect(approved).toContain('editBtn');
    expect(rejected).not.toContain('editBtn');
    expect(script).toMatch(/else if \(t\.dataset\.act === 'edit'\) openEdit\(id\);/);
  });

  test('수정은 테마·이름·설명만 바꾼다 — 상태·파일은 건드리지 않는다, 설명은 200자', () => {
    const fn = script.slice(script.indexOf('async function submitEdit'), script.indexOf('// ── 확정 · 거절'));
    expect(fn.length).toBeGreaterThan(100);
    const patch = fn.slice(fn.indexOf('const patch = {'), fn.indexOf('};', fn.indexOf('const patch = {')));
    expect(patch).toMatch(/theme: theme\.trim\(\)/);
    expect(patch).toMatch(/title: \$\('edTitle'\)\.value\.trim\(\)\.slice\(0, 120\) \|\| null/);
    expect(patch).toMatch(/note: \$\('edNote'\)\.value\.trim\(\)\.slice\(0, 200\) \|\| null/);
    expect(patch).not.toMatch(/status|storage_path|thumb_path|is_active/);
    expect(fn).toMatch(/R\.isValidTheme\(theme\)/);
    expect(fn).toMatch(/sb\.from\('theme_images'\)\.update\(patch\)\.eq\('id', editId\)/);
    expect(PAGE).toMatch(/<textarea id="edNote" rows="4" maxlength="200"/);
  });

  test('업로드에도 설명 칸 — 행에 note 로 들어간다', () => {
    expect(PAGE).toMatch(/<textarea id="upNote" rows="3" maxlength="200"/);
    expect(script).toMatch(/const note = \$\('upNote'\)\.value\.trim\(\)\.slice\(0, 200\);/);
    expect(script).toMatch(/note: note \|\| null,/);
  });
});

describe('ai-design.html — 테마는 DB(theme_images)만, 위키미디어 실시간 경로는 없다', () => {
  const STUDIO = read('ai-design.html');
  const SEG = STUDIO.slice(
    STUDIO.indexOf('// 테마 사진은 우리 DB(theme_images)에서 읽는다'),
    STUDIO.indexOf('function pickHTML(r)'),
  );

  function fakeSb(rows, error) {
    const calls = [];
    const chain = {
      select: (c) => (calls.push(['select', c]), chain),
      eq: (k, v) => (calls.push(['eq', k, v]), chain),
      limit: (n) => (calls.push(['limit', n]), Promise.resolve({ data: error ? null : rows, error: error || null })),
    };
    return {
      calls,
      from: (t) => (calls.push(['from', t]), chain),
      storage: { from: (b) => ({ getPublicUrl: (p) => ({ data: { publicUrl: 'https://cdn/' + b + '/' + p } }) }) },
    };
  }

  /** 화면 코드 그대로 돌린다 — 그리기는 가짜로 받아 순서를 남긴다 */
  function boot(sb) {
    const log = [];
    const S = { themeAll: [], themeLoaded: false };
    const api = new Function(
      'sb', 'window', 'S', 'shuffle', 'renderTheme', 'fillGrids', 'console',
      SEG + '\nreturn { loadDbThemes: loadDbThemes, loadThemes: loadThemes };',
    )(
      sb,
      { DadamRefImages: R },
      S,
      (l) => l,
      () => log.push(['render', S.themeAll.length, S.themeLoaded]),
      () => {},
      { warn: () => log.push(['warn']) },
    );
    return { api, S, log };
  }
  const rows = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: 'id' + i, theme: i % 2 ? 'flower' : '원목', thumb_path: 'id' + i + '/thumb.jpg', note: i % 2 ? '오렌지 가죽' : null }));

  test('구간을 찾는다 (마커가 살아 있다)', () => {
    expect(SEG.length).toBeGreaterThan(200);
    expect(SEG).toMatch(/async function loadDbThemes/);
    expect(SEG).toMatch(/async function loadThemes/);
  });

  test('사용 중·보이는 것만, 썸네일을 공개 주소로 — 키는 th- 로 시작해 생성 때 theme 역할이 된다', async () => {
    const sb = fakeSb(rows(2).concat([{ id: 'nofile', theme: 'animal', thumb_path: null }]));
    const { api } = boot(sb);
    const list = await api.loadDbThemes();
    expect(sb.calls).toEqual([
      ['from', 'theme_images'],
      ['select', 'id, theme, thumb_path, note'],
      ['eq', 'status', 'approved'],
      ['eq', 'is_active', true],
      ['limit', 2000],
    ]);
    expect(list).toEqual([
      { key: 'th-db-id0', src: 'https://cdn/theme-images/id0/thumb.jpg', label: '원목', note: '' },
      { key: 'th-db-id1', src: 'https://cdn/theme-images/id1/thumb.jpg', label: '꽃', note: '오렌지 가죽' },
    ]);
    // 생성 때 역할을 가르는 규칙 그대로
    expect(STUDIO).toMatch(/var theme = \/\^th-\/\.test\(p\.key\);/);
    expect(STUDIO).toMatch(/role: theme \? 'theme' : 'style'/);
    list.forEach((r) => expect(/^th-/.test(r.key)).toBe(true));
  });

  test('테마 사진의 설명은 고를 때 같이 담기고, 생성 요청에 테마일 때만 실린다', () => {
    expect(STUDIO).toMatch(/S\.picks\.push\(\{ key: src\.key, src: src\.src, label: src\.label, note: src\.note \|\| '' \}\)/);
    expect(STUDIO).toMatch(/if \(theme && p\.note\) ref\.note = p\.note;/);
  });

  test('DB 사진만 한 번 그린다 — 몇 장이든', async () => {
    for (const n of [1, 30]) {
      const { api, S, log } = boot(fakeSb(rows(n)));
      await api.loadThemes();
      expect(log).toEqual([['render', n, true]]);
      expect(S.themeAll).toHaveLength(n);
    }
  });

  test('표가 없거나 막혀도 멈추지 않는다 — 테마만 비고 「아직 준비된 테마 이미지가 없습니다」', async () => {
    const { api, S, log } = boot(fakeSb(null, { message: 'relation "theme_images" does not exist' }));
    await api.loadThemes();
    expect(log).toEqual([['warn'], ['render', 0, true]]);
    expect(S.themeAll).toEqual([]);
    expect(STUDIO).toMatch(/\? S\.themeLoaded\s+\? '아직 준비된 테마 이미지가 없습니다'\s+: '불러오는 중…'/);
  });

  test('Supabase 가 없어도(오프라인 등) 멈추지 않는다', async () => {
    const { api, log } = boot(null);
    await api.loadThemes();
    expect(log).toEqual([['render', 0, true]]);
  });

  test('위키미디어 실시간 경로는 걷어냈다 — 검색·채도 측정·덧붙이기 모두', () => {
    expect(STUDIO).not.toMatch(/commons\.wikimedia\.org|wikimedia/i);
    expect(STUDIO).not.toMatch(/loadWikimediaThemes|fetchThemeQuery|keepColorful|themeIsColorful|THEME_DB_ENOUGH|THEME_FREE|themeMore/);
    expect(STUDIO).not.toMatch(/퍼블릭 도메인 · CC0 만 씁니다/);
  });

  test('테마는 시공사례를 기다리지 않는다 — 시작할 때 바로, loadGallery 안에서는 부르지 않는다', () => {
    const gallery = STUDIO.slice(STUDIO.indexOf('async function loadGallery'), STUDIO.indexOf('function caseByKind'));
    expect(gallery.length).toBeGreaterThan(100);
    expect(gallery).not.toMatch(/loadThemes\(\)/);
    const init = STUDIO.indexOf('// 테마는 시공사례·세션을 기다리지 않고 바로 시작한다');
    expect(init).toBeGreaterThan(0);
    expect(STUDIO.indexOf('loadThemes();', init)).toBeLessThan(STUDIO.indexOf('await sb.auth.getSession()', init));
    expect(STUDIO.indexOf('loadThemes();', init)).toBeLessThan(STUDIO.indexOf('await loadGallery();', init));
  });

  test('공용 모듈을 싣는다', () => {
    expect(STUDIO).toContain('<script src="js/reference-images.js"></script>');
  });
});

describe('ai-design.html — FURNITURE 품목은 잘리지 않는다', () => {
  const STUDIO = read('ai-design.html');
  const STYLE = STUDIO.slice(STUDIO.indexOf('<style>'), STUDIO.indexOf('</style>'));
  const rule = (sel) => {
    const i = STYLE.indexOf(sel + ' {');
    return i < 0 ? '' : STYLE.slice(i, STYLE.indexOf('}', i));
  };

  test('5열 · 높이 고정 해제 · 넘침 보이기 — 공용 .v5-foot-row 의 86px + overflow:hidden 이 셋째 줄을 잘랐다', () => {
    const k = rule('#kinds');
    expect(k).toMatch(/grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
    expect(k).toMatch(/height: auto/);
    expect(k).toMatch(/min-height: 86px/);
    expect(k).toMatch(/overflow: visible/);
  });

  test('품목 수는 5열 두 줄(10칸)에 들어간다 — 더 늘리면 이 격자를 다시 정한다', () => {
    const kinds = STUDIO.slice(STUDIO.indexOf('var KINDS = ['), STUDIO.indexOf('];', STUDIO.indexOf('var KINDS = [')));
    const n = (kinds.match(/key: '/g) || []).length;
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(10);
  });

  test('글자 20% 키우고 굵게 — 칩 11.5→13.8px · 라벨 11→13.2px, 500', () => {
    const chip = rule('#kinds .v5-chip');
    expect(chip).toMatch(/font-size: 13\.8px/);
    expect(chip).toMatch(/font-weight: 500/);
    expect(chip).toMatch(/min-height: 38px/); // 38 × 2 + 9 = 85 ≤ 86 — 오른쪽 카드 하단 바와 높이가 같다
    const label = rule('.v5-slot-foot .v5-foot-label');
    expect(label).toMatch(/font-size: 13\.2px/);
    expect(label).toMatch(/font-weight: 500/);
  });

  test('공용 CSS 는 건드리지 않는다 (my-designs 도 .v5-chip 을 쓴다)', () => {
    const css = read('css/dadam-v5.css');
    expect(css).toMatch(/\.v5-chip \{[^}]*font-size: 11\.5px/);
    expect(css).toMatch(/\.v5-foot-row \{[^}]*height: 86px;[^}]*overflow: hidden;/);
  });
});

describe('ai-design.html — ③ 상세 요청 (AI 대화)', () => {
  const STUDIO = read('ai-design.html');
  const SEG = STUDIO.slice(STUDIO.indexOf('// ③ 상세 요청 — AI 와 대화하며'), STUDIO.indexOf('        function bind() {'));

  /** 화면 코드 그대로 — DOM 은 필요한 칸만 가짜로 */
  function boot({ signedIn = false, aiReply = null, store = {} } = {}) {
    const el = () => ({
      innerHTML: '', textContent: '', value: '', disabled: false, placeholder: '',
      scrollTop: 0, scrollHeight: 100, classList: { toggle() {} }, focus() {}, addEventListener() {},
    });
    const els = { chatLog: el(), chatCount: el(), state3: el(), no3: el(), chatSend: el(), chatInput: el(), chatReset: el() };
    const S = { kind: 'sink', chat: [], chatBusy: false, chatHinted: false, signedIn };
    const fetches = [];
    const ss = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
    };
    const api = new Function(
      'S', '$', 'esc', 'KINDS', 'sb', 'fetch', 'API_BASE', 'authHeaders', 'sessionStorage',
      SEG + '\nreturn { sendChat, customerRequest, renderChat, loadChat, bindChat, CHAT_MAX_TURNS, CHAT_LOCAL_QUESTIONS, CHAT_DONE };',
    )(
      S,
      (id) => els[id],
      (s) => String(s),
      [{ key: 'sink', label: '싱크대' }],
      {},
      async (url, init) => {
        fetches.push({ url, body: JSON.parse(init.body) });
        return { ok: !!aiReply, json: async () => ({ success: true, reply: aiReply }) };
      },
      'https://gen.example',
      async () => ({ Authorization: 'Bearer t' }),
      ss,
    );
    return { api, S, els, fetches, store };
  }
  const say = async (b, text) => {
    b.els.chatInput.value = text;
    await b.api.sendChat();
  };

  test('구간을 찾는다', () => {
    expect(SEG.length).toBeGreaterThan(500);
    expect(SEG).toMatch(/async function sendChat/);
  });

  test('로그인 전: 준비된 질문으로 잇고, 로그인 안내는 한 번만 — 서버는 부르지 않는다', async () => {
    const b = boot();
    await say(b, '잘 부탁해요');
    await say(b, '음');
    expect(b.fetches).toHaveLength(0);
    const Q = b.api.CHAT_LOCAL_QUESTIONS.map((x) => x.q);
    const ai = b.S.chat.filter((m) => m.role === 'ai').map((m) => m.text);
    expect(ai[0]).toContain(Q[0]);
    expect(ai[0]).toContain('로그인하면');
    expect(ai[1]).toBe('좋아요. ' + Q[1]);
    expect(b.els.chatCount.textContent).toBe('2개');
    expect(b.els.state3.textContent).toBe('반영됨');
  });

  test('준비된 질문은 손님이 이미 말한 주제를 건너뛰고, 다 채우면 생성 안내', async () => {
    const b = boot();
    const Q = b.api.CHAT_LOCAL_QUESTIONS.map((x) => x.q);
    await say(b, '도어는 무광 화이트, 상판은 밝은 대리석'); // 도어·상판을 말했다 → 수납을 묻는다
    expect(b.S.chat[1].text).toContain(Q[2]);
    await say(b, '냉장고 옆 키큰장');
    expect(b.S.chat[3].text).toBe('좋아요. ' + Q[3]);
    await say(b, '따뜻한 느낌');
    expect(b.S.chat[5].text).toBe(b.api.CHAT_DONE);
    await say(b, '그 밖엔 없어요');
    expect(b.S.chat[7].text).toBe(b.api.CHAT_DONE);
  });

  test('로그인 후: /api/chat 에 품목과 대화를 보내고 답을 붙인다. 실패하면 준비된 질문', async () => {
    const b = boot({ signedIn: true, aiReply: '좋아요. 조명은 어떤가요?' });
    await say(b, '오크 도어');
    expect(b.fetches).toEqual([{ url: 'https://gen.example/api/chat', body: { category: 'sink', messages: [{ role: 'me', text: '오크 도어' }] } }]);
    expect(b.S.chat[1]).toEqual({ role: 'ai', text: '좋아요. 조명은 어떤가요?' });

    const c = boot({ signedIn: true, aiReply: null });
    await say(c, '오크 도어');
    expect(c.S.chat[1].text).toBe('좋아요. ' + c.api.CHAT_LOCAL_QUESTIONS[1].q); // 도어는 말했으니 다음 주제
    expect(c.S.chat[1].text).not.toContain('로그인하면');
  });

  test('생성에 싣는 것은 손님 글뿐 — 쓴 순서대로, 1200자까지', async () => {
    const b = boot();
    await say(b, '도어는 무광 화이트');
    await say(b, '상판은 대리석');
    expect(b.api.customerRequest()).toBe('도어는 무광 화이트\n상판은 대리석');
    expect(STUDIO).toMatch(/customer_request: customerRequest\(\) \|\| undefined,/);
    const d = boot();
    for (let i = 0; i < 4; i++) await say(d, String(i).repeat(500));
    expect(d.api.customerRequest().length).toBe(1200);
  });

  test('빈 글·500자 넘는 글·12번째 넘는 글', async () => {
    const b = boot();
    await say(b, '   ');
    expect(b.S.chat).toHaveLength(0);
    await say(b, 'x'.repeat(800));
    expect(b.S.chat[0].text).toHaveLength(500);
    for (let i = 0; i < 20; i++) await say(b, 'm' + i);
    expect(b.S.chat.filter((m) => m.role === 'me')).toHaveLength(b.api.CHAT_MAX_TURNS);
    expect(b.els.chatSend.disabled).toBe(true);
    expect(b.els.chatInput.disabled).toBe(true);
  });

  test('로그인하러 나갔다 와도 남는다 (sessionStorage) — 깨진 값은 버린다', async () => {
    const store = {};
    const b = boot({ store });
    await say(b, '도어는 오크');
    const c = boot({ store });
    c.api.loadChat();
    expect(c.api.customerRequest()).toBe('도어는 오크');
    const d = boot({ store: { 'dadam.studio.chat.v1': '[{"role":"x","text":"a"},{"role":"me","text":""},{"role":"me","text":"ok"}' } });
    d.api.loadChat();
    expect(d.S.chat).toEqual([]);
    const e = boot({ store: { 'dadam.studio.chat.v1': '[{"role":"x","text":"a"},{"role":"me","text":""},{"role":"me","text":"ok"}]' } });
    e.api.loadChat();
    expect(e.S.chat).toEqual([{ role: 'me', text: 'ok' }]);
  });

  test('첫 인사에 품목 이름 — 품목을 바꾸면 다시 그린다', () => {
    const b = boot();
    b.api.renderChat();
    expect(b.els.chatLog.innerHTML).toContain('싱크대 연출컷');
    expect(STUDIO).toMatch(/renderKinds\(\);\s+renderChat\(\); \/\/ 첫 인사에 품목 이름이 들어간다/);
  });

  test('한글 조합 중의 Enter 는 보내지 않는다 · Shift+Enter 는 줄바꿈', () => {
    expect(SEG).toMatch(/e\.key === 'Enter' && !e\.shiftKey && !e\.isComposing && e\.keyCode !== 229/);
  });

  test('화면: 두 카드 아래, 생성 버튼 위에 넓게', () => {
    const cols = STUDIO.indexOf('<div class="v5-cols">');
    const chat = STUDIO.indexOf('id="chatSlot"');
    const run = STUDIO.indexOf('<div class="v5-run">');
    expect(cols).toBeGreaterThan(0);
    expect(chat).toBeGreaterThan(cols);
    expect(run).toBeGreaterThan(chat);
    expect(STUDIO).toMatch(/<textarea\s+id="chatInput"\s+rows="2"\s+maxlength="500"/);
  });
});

describe('관리자 사이드바', () => {
  const pages = fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => f.endsWith('.html'));

  test.each(pages)('%s — 「참고 이미지」 링크가 학습 데이터셋 앞에 하나', (f) => {
    const src = read('admin/' + f);
    const nav = src.slice(src.indexOf('<ul class="nav-menu">'), src.indexOf('</ul>', src.indexOf('<ul class="nav-menu">')));
    const links = nav.match(/href="reference-images\.html"/g) || [];
    expect(links).toHaveLength(1);
    expect(nav.indexOf('href="reference-images.html"')).toBeLessThan(nav.indexOf('href="dataset.html"'));
  });
});
