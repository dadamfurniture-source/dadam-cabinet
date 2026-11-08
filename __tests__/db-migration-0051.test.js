/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0051_collection_public_columns.sql 정적 시험 (DB 없이).
 *
 *   collection_posts 읽기를 칸 단위로 — 표 전체 SELECT 를 anon · authenticated 에서 거두고
 *     누구나       id · image_url · category · region · source · place_label · door_color · company_id · like_count · created_at
 *     로그인만 더  user_id · storage_path · generation_id · design_id · consent_training (본인 게시물 화면)
 *     서버만       title · description · item_unique_id · updated_at
 *   정책 · 넣기 · 고치기 · 지우기 권한 · 함수 · 트리거는 그대로.
 *   앱이 collection_posts 를 읽는 곳을 모두 훑어 칸이 모자라지 않은지 본다 (서버 워커는 service_role 이라 빼고):
 *     segan/collection.js · segan/make.js (로그인 없이도) · segan/activity.js · segan/renders.js (본인),
 *     사이트 ai-design.html · collection.html · mypage.html · my-designs.html (_redirects 로 앱에 넘어간 페이지)
 *   역할별 동작은 database/probes/0051-collection-public-columns.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'database', 'migrations');
const FILE = '0051_collection_public_columns.sql';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
const noComments = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const S = flat(noComments(read(`database/migrations/${FILE}`)));
const statements = S.split(';')
  .map((s) => s.trim())
  .filter(Boolean);

const PUBLIC = [
  'id',
  'image_url',
  'category',
  'region',
  'source',
  'place_label',
  'door_color',
  'company_id',
  'like_count',
  'created_at',
];
const OWNER = ['user_id', 'storage_path', 'generation_id', 'design_id', 'consent_training'];
const SERVER = ['title', 'description', 'item_unique_id', 'updated_at'];
// 0049(#1417 — 시공사례 사진 정보)가 더하는 칸. 그 파일이 이 저장소에 있으면 아래에서 그 파일과도 견준다
const FROM_0049 = ['place_label', 'door_color', 'company_id'];

/** 0000 기준선의 collection_posts 칸 + 뒤 마이그레이션이 ADD COLUMN 한 칸 */
function tableColumns() {
  const base = read('database/migrations/0000_baseline.sql');
  const m = /CREATE TABLE public\.collection_posts \(([\s\S]*?)\n\);/.exec(base);
  const cols = m[1]
    .split('\n')
    .map((l) => /^\s+(\w+) /.exec(l))
    .filter(Boolean)
    .map((x) => x[1]);
  const added = [];
  for (const f of fs.readdirSync(DIR).filter((n) => /^\d{4}_.*\.sql$/.test(n) && n !== FILE)) {
    const t = noComments(read(`database/migrations/${f}`));
    for (const a of t.matchAll(
      /ALTER TABLE public\.collection_posts ADD COLUMN (?:IF NOT EXISTS )?(\w+)/g
    ))
      added.push([f, a[1]]);
  }
  return { cols, added };
}

/** GRANT SELECT (칸…) ON TABLE public.collection_posts TO 역할… → { 역할: [칸…] } */
function grants() {
  const out = {};
  for (const s of statements) {
    const m = /^GRANT SELECT \(([^)]*)\) ON TABLE public\.collection_posts TO (.+)$/.exec(s);
    if (!m) continue;
    const cols = m[1].split(',').map((c) => c.trim());
    for (const r of m[2].split(',').map((x) => x.trim())) out[r] = (out[r] || []).concat(cols);
  }
  return out;
}

describe('0051 — collection_posts 칸 단위 읽기', () => {
  test('문장은 넷 — 표 SELECT 거두기 · 공개 칸 주기 · 로그인 칸 주기 · 표 설명, 트랜잭션 · 정책 · 지우기 없음', () => {
    expect(S).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(S).not.toMatch(
      /\b(POLICY|DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|FUNCTION|TRIGGER)\b/i
    );
    expect(statements).toHaveLength(4);
    expect(statements[0]).toBe(
      'REVOKE SELECT ON TABLE public.collection_posts FROM PUBLIC, anon, authenticated'
    );
    expect(statements[1]).toMatch(
      /^GRANT SELECT \(.*\) ON TABLE public\.collection_posts TO anon, authenticated$/
    );
    expect(statements[2]).toMatch(
      /^GRANT SELECT \(.*\) ON TABLE public\.collection_posts TO authenticated$/
    );
    expect(statements[3]).toMatch(/^COMMENT ON TABLE public\.collection_posts IS '.*\(0051\)'$/);
    // 표 전체 권한 · 다른 표 · service_role 은 건드리지 않는다
    expect(S).not.toMatch(/service_role/);
    expect(S).not.toMatch(/GRANT (ALL|SELECT ON)/);
    expect(S.match(/public\.\w+/g).every((t) => t === 'public.collection_posts')).toBe(true);
  });

  test('누구나 = 공개 10칸, 로그인 = 공개 + 본인 화면 5칸', () => {
    const g = grants();
    expect(Object.keys(g).sort()).toEqual(['anon', 'authenticated']);
    expect([...g.anon].sort()).toEqual([...PUBLIC].sort());
    expect([...g.authenticated].sort()).toEqual([...PUBLIC, ...OWNER].sort());
  });

  test('표의 칸은 모두 셋 중 하나 — 공개 · 로그인 · 서버만 (빠진 칸 · 없는 칸 없음)', () => {
    const { cols, added } = tableColumns();
    const all = [...new Set([...cols, ...added.map((a) => a[1]), ...FROM_0049])].sort();
    expect([...PUBLIC, ...OWNER, ...SERVER].sort()).toEqual(all);
    expect(cols).toEqual(expect.arrayContaining([...SERVER, ...OWNER]));
    // 0049 가 저장소에 있으면 — 그 파일이 더하는 칸이 바로 FROM_0049
    const f49 = fs.readdirSync(DIR).find((n) => n.startsWith('0049_'));
    if (f49) expect(added.filter((a) => a[0] === f49).map((a) => a[1])).toEqual(FROM_0049);
    // 다른 마이그레이션은 collection_posts 에 칸을 더하지 않았다 (더하면 여기서 GRANT 여부를 정해야 한다)
    expect(added.filter((a) => !a[0].startsWith('0049_'))).toEqual([]);
  });

  test('프로브의 권한 표 기대값 = 이 파일의 GRANT (칸 이름 차례)', () => {
    const probe = JSON.parse(read('database/probes/0051-collection-public-columns.json'));
    const check = probe.checks.find((c) => c.name.startsWith('권한 표'));
    const want = (cols) => [...cols].sort().join(',');
    expect(check.expect.service_role).toBe(
      `anon:false:${want(PUBLIC)} | authenticated:false:${want([...PUBLIC, ...OWNER])}`
    );
  });
});

/**
 * 앱이 collection_posts 를 읽는 곳 — .from('collection_posts') 부터 문장 끝(;)까지.
 * 읽는 칸 = select 의 칸 + eq · neq · in · lt · gt · order 로 거르는 칸 (넣기 · 고치기의 값은 읽기가 아니다).
 */
const READERS = [
  'segan/collection.js',
  'segan/make.js',
  'segan/activity.js',
  'segan/renders.js',
  'ai-design.html',
  'collection.html',
  'mypage.html',
  'my-designs.html',
];
/** 로그인 없이도 도는 곳 — user_id 로 거르지 않는 질의는 공개 칸만 */
const PUBLIC_PAGES = ['segan/collection.js', 'segan/make.js', 'ai-design.html', 'collection.html'];

function chains(file) {
  const text = read(file);
  const out = [];
  let at = text.indexOf(".from('collection_posts')");
  while (at >= 0) {
    const end = text.indexOf(';', at);
    const chain = text.slice(at, end < 0 ? undefined : end);
    const cols = new Set();
    for (const m of chain.matchAll(/\.select\(([^)]*)\)/g)) {
      const arg = m[1].trim();
      const lits = [...arg.matchAll(/'([^']*)'/g)].map((x) => x[1]);
      if (!lits.length && /^\w+$/.test(arg)) {
        const v = new RegExp(`var ${arg} = '([^']*)'`).exec(text);
        if (v) lits.push(v[1]);
      }
      for (const l of lits) for (const c of l.split(',')) if (c.trim()) cols.add(c.trim());
    }
    for (const m of chain.matchAll(/\.(?:eq|neq|in|lt|lte|gt|gte|is|order)\(\s*'(\w+)'/g))
      cols.add(m[1]);
    out.push({ chain, cols: [...cols], owner: /\.eq\(\s*'user_id'/.test(chain) });
    at = text.indexOf(".from('collection_posts')", at + 1);
  }
  return out;
}

describe('앱이 읽는 칸 — 0051 뒤에도 모자라지 않다', () => {
  test('읽는 곳 목록 — segan 넷 · 사이트 넷 (그 밖의 저장소 화면 · js 는 collection_posts 를 읽지 않는다)', () => {
    const scan = (dir, re) =>
      fs
        .readdirSync(path.join(ROOT, dir))
        .filter((n) => re.test(n))
        .map((n) => (dir === '.' ? n : `${dir}/${n}`))
        .filter((f) => /\.from\('collection_posts'\)/.test(read(f)));
    const found = [
      ...scan('segan', /\.js$/),
      ...scan('.', /\.html$/),
      ...scan('admin', /\.html$/),
      ...scan('js', /\.js$/),
    ].sort();
    expect(found).toEqual([...READERS].sort());
  });

  test.each(READERS)('%s — 로그인한 사람이 읽는 칸은 모두 받는다', (file) => {
    const allowed = new Set([...PUBLIC, ...OWNER]);
    for (const c of chains(file)) {
      const missing = c.cols.filter((x) => !allowed.has(x));
      expect([file, c.chain.slice(0, 80), missing]).toEqual([file, c.chain.slice(0, 80), []]);
    }
  });

  test('로그인 없이도 도는 질의(user_id 로 거르지 않는 것)는 공개 칸만 — 사이트 collection.html 의 storage_path 하나만 예외', () => {
    const extra = [];
    for (const file of PUBLIC_PAGES)
      for (const c of chains(file).filter(
        (x) => !x.owner && !/\.(delete|update|insert)\(/.test(x.chain)
      ))
        for (const col of c.cols) if (!PUBLIC.includes(col)) extra.push(`${file}:${col}`);
    // 사이트 collection.html 은 관리자 「내리기」 용으로 storage_path 를 함께 묻는다 — 로그인 전에는 실패하고
    // 칸을 줄인 질의(id · image_url · created_at)로 그린다. 그 주소는 _redirects 로 앱(segan/collection)에 넘어간다
    expect([...new Set(extra)]).toEqual(['collection.html:storage_path']);
    expect(read('_redirects')).toMatch(/\n\/collection\.html\s+\/segan\/collection\s+301/);
  });

  test('본인 게시물 화면은 user_id 로 거른다 (activity · renders · make 결과 관리)', () => {
    for (const file of ['segan/activity.js', 'segan/renders.js', 'segan/make.js']) {
      const own = chains(file).filter((c) => c.owner);
      expect([file, own.length > 0]).toEqual([file, true]);
      for (const c of own) expect(c.cols).toContain('user_id');
    }
  });
});
