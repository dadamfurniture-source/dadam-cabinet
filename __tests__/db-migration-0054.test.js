/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0054_collection_drop_old_path_policies.sql 정적 시험 (DB 없이).
 *
 *   시공사례 사진(collection 버킷) 옛 경로 정책 셋을 거둔다 — 첫 칸 = 회원 id 를 보던
 *   collection_insert_own · collection_update_own · collection_delete_own (기준선).
 *   남는 넷: 읽기 collection_select_public · 관리자 지우기 collection_delete_admin (기준선),
 *            'p/' 넣기 collection_insert_photo · 주인 지우기 collection_delete_owner (0052).
 *   앱과 맞물리는 것: segan 은 'p/<uuid>' 로 올리고, 옛 경로로 올리는 mypage.html 은 _redirects 가 /segan/me 로 보낸다.
 *   역할별 동작은 database/probes/0054-collection-drop-old-path-policies.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'database', 'migrations');
const FILE = '0054_collection_drop_old_path_policies.sql';
const PROBE = 'database/probes/0054-collection-drop-old-path-policies.json';
const raw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
const noComments = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const f = flat(noComments(raw(`database/migrations/${FILE}`)));
const statements = f
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

const OLD = ['collection_insert_own', 'collection_update_own', 'collection_delete_own'];
const KEEP = {
  collection_delete_admin: 'DELETE:authenticated',
  collection_delete_owner: 'DELETE:authenticated',
  collection_insert_photo: 'INSERT:authenticated',
  collection_select_public: 'SELECT:public',
};
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const MIGRATIONS = fs
  .readdirSync(DIR)
  .filter((n) => /^\d{4}_.*\.sql$/.test(n))
  .sort();

/**
 * 마이그레이션을 차례로 따라가 collection 버킷 storage 정책을 모은다 (upTo 파일까지) → Map(이름 → 만든 문장)
 * 문장은 ; 로 나눈다 — 함수 본문 조각은 정책 문장 모양이 아니라 건너뛴다.
 */
function collectionPolicies(upTo) {
  const now = new Map();
  for (const n of MIGRATIONS.filter((x) => x <= upTo)) {
    for (const s of flat(noComments(raw(`database/migrations/${n}`))).split(';')) {
      const st = s.trim();
      const drop = /^DROP POLICY (?:IF EXISTS )?"?(collection_\w+)"? ON storage\.objects$/.exec(st);
      if (drop) now.delete(drop[1]);
      const make = /^CREATE POLICY "?(collection_\w+)"? ON storage\.objects /.exec(st);
      if (make) now.set(make[1], st);
    }
  }
  return now;
}
/** CREATE POLICY 문장 → '명령:역할' */
const cmdRole = (st) => {
  const m = / ON storage\.objects FOR (\w+) TO (\w+)/.exec(st);
  return m ? `${m[1]}:${m[2].toLowerCase()}` : null;
};

const PREV = MIGRATIONS[MIGRATIONS.indexOf(FILE) - 1];
const before = collectionPolicies(PREV);
const after = collectionPolicies(FILE);

describe('0054 — collection 버킷 옛 경로 정책 거둠', () => {
  test('문장은 옛 정책 셋을 지우는 DROP POLICY IF EXISTS 셋뿐 — 만들기 · 트랜잭션 · 표 · 행 · 권한 · 함수 없음', () => {
    expect(PREV).toBe('0053_production_cancelled_notice.sql');
    expect(statements).toEqual(OLD.map((n) => `DROP POLICY IF EXISTS ${n} ON storage.objects`));
    expect(f).not.toMatch(
      /\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION|CREATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|FUNCTION|TRIGGER)\b/i
    );
    for (const keep of Object.keys(KEEP)) expect(f).not.toContain(keep);
  });

  test('지우는 셋은 기준선의 옛 경로 정책 — collection 버킷 · 첫 칸 = 본인 id, 0054 앞까지 그대로였다', () => {
    const base = collectionPolicies('0000_baseline.sql');
    for (const old of OLD) {
      expect(base.get(old)).toContain("bucket_id = 'collection'::text");
      expect(base.get(old)).toContain('(storage.foldername(name))[1] = (auth.uid())::text');
      expect(before.get(old)).toBe(base.get(old));
    }
    expect(cmdRole(base.get('collection_insert_own'))).toBe('INSERT:authenticated');
    expect(cmdRole(base.get('collection_update_own'))).toBe('UPDATE:authenticated');
    expect(cmdRole(base.get('collection_delete_own'))).toBe('DELETE:authenticated');
  });

  test('0054 뒤 collection 버킷 정책은 넷 — 읽기 · 관리자 지우기 (기준선), p/ 넣기 · 주인 지우기 (0052), 정의는 그대로', () => {
    expect([...before.keys()].sort(byName)).toEqual([...OLD, ...Object.keys(KEEP)].sort(byName));
    expect([...after.keys()].sort(byName)).toEqual(Object.keys(KEEP).sort(byName));
    for (const [name, want] of Object.entries(KEEP)) {
      expect([name, cmdRole(after.get(name))]).toEqual([name, want]);
      expect(after.get(name)).toBe(before.get(name));
    }
  });

  test('남는 회원 정책에 옛 경로가 없다 — 넣기는 p/<uuid> 한 칸 · owner_id = 본인, 지우기는 p | ai 중 owner_id = 본인, 고치기 없음', () => {
    expect(after.get('collection_insert_photo')).toContain(
      "name ~ '^p/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png)$' AND owner_id = ((SELECT auth.uid()))::text"
    );
    expect(after.get('collection_delete_owner')).toContain(
      "(storage.foldername(name))[1] IN ('p', 'ai') AND owner_id = ((SELECT auth.uid()))::text"
    );
    expect(after.get('collection_delete_admin')).toContain('public.is_admin()');
    for (const st of after.values()) {
      expect(st).not.toContain('(storage.foldername(name))[1] = (auth.uid())::text');
      expect(cmdRole(st)).not.toMatch(/^UPDATE:/);
    }
  });

  test('프로브의 정책 목록 기대값 = 0054 뒤 collection 정책 (이름:명령:역할), 프로브는 이 파일을 먼저 돌린다', () => {
    const probe = JSON.parse(raw(PROBE));
    expect(probe.title).toContain(`--migration database/migrations/${FILE}`);
    const check = probe.checks.find((c) => c.name.startsWith('collection 버킷 storage 정책'));
    const want = [...after.entries()]
      .map(([n, st]) => `${n}:${cmdRole(st)}`)
      .sort(byName)
      .join(' | ');
    expect(check.expect.service_role).toBe(want);
  });

  test('프로브 — 옛 경로 넣기 · 지우기는 회원 본인도 막히고, p/ 넣기 · 주인 지우기 · 관리자 지우기 · 읽기는 된다', () => {
    const probe = JSON.parse(raw(PROBE));
    const want = (prefix) => {
      const c = probe.checks.find((x) => x.name.startsWith(prefix));
      return c && c.expect;
    };
    expect(want("옛 경로 넣기 '<본인 id>/…'")).toEqual({ '*': 'deny' });
    expect(want("옛 경로 지우기 '<본인 id>/…'")).toEqual({ admin: 'rows:1', '*': 'rows:0' });
    expect(want('고치기')).toEqual({ service_role: 'rows:2', '*': 'rows:0' });
    expect(want("새 경로 넣기 'p/<uuid>.jpg'")).toEqual({ anon: 'deny', '*': 'ok' });
    expect(want("지우기 'p/…'")).toMatchObject({
      cust: 'rows:1',
      other: 'rows:0',
      admin: 'rows:1',
    });
    expect(want("지우기 'ai/…'")).toEqual({ cust: 'rows:1', other: 'rows:0' });
    expect(want('읽기')).toEqual({ '*': '3' });
    // 옛 경로 넣기는 그 폴더의 주인(cust)으로도 본다
    const oldInsert = probe.checks.find((x) => x.name.startsWith("옛 경로 넣기 '<본인 id>/…'"));
    expect(oldInsert.roles).toContain('cust');
    expect(oldInsert.sql).toContain("{{cust_user}}::text || '/'");
  });
});

describe('앱과 맞물리는 것', () => {
  const activity = raw('segan/activity.js');

  test("segan 시공사례 올리기는 'p/<uuid>.<jpg|png>' · upsert: false (고치기 정책 없이 된다)", () => {
    expect(activity).toContain("var path = 'p/' + crypto.randomUUID() + '.' + ext;");
    expect(activity).toMatch(/bucket\.upload\(path, blob, \{[^}]*upsert: false,/);
  });

  test("AI 연출컷 복사본은 서버가 'ai/<uuid>' 로 (generate-api)", () => {
    const gen = raw('workers/generate-api/src/collection-post.js');
    expect(gen).toContain("export const COLLECTION_AI_PREFIX = 'ai';");
    expect(gen).toContain(
      'return `${COLLECTION_AI_PREFIX}/${crypto.randomUUID()}.${extOf(mimeType)}`;'
    );
  });

  test('collection 버킷에 올리는 곳은 segan/activity.js 와 쓰지 않는 mypage.html 뿐 — mypage.html 은 _redirects 가 /segan/me 로 보낸다', () => {
    const scan = (dir, re) =>
      fs
        .readdirSync(path.join(ROOT, dir))
        .filter((n) => re.test(n))
        .map((n) => (dir === '.' ? n : `${dir}/${n}`));
    const files = [
      ...scan('segan', /\.js$/),
      ...scan('js', /\.js$/),
      ...scan('.', /\.html$/),
      ...scan('admin', /\.html$/),
    ];
    const uploaders = files
      .filter((rel) => {
        const t = raw(rel);
        return /\.upload\(/.test(t) && /(['"])collection\1/.test(t);
      })
      .sort(byName);
    expect(uploaders).toEqual(['mypage.html', 'segan/activity.js']);
    // mypage.html 에 남은 옛 경로 올리기 (0054 뒤로 막힌다 — 고치지 않는다)
    expect(raw('mypage.html')).toContain(
      "const path = currentUser.id + '/' + Date.now() + '-' + rand + '.' + ext;"
    );
    const redirects = raw('_redirects');
    expect(redirects).toMatch(/^\/mypage\.html\s+\/segan\/me\s+301$/m);
    expect(redirects).toMatch(/^\/mypage\s+\/segan\/me\s+301$/m);
  });
});
