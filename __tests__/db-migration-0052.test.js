/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0052_collection_anon_paths.sql 정적 시험 (DB 없이).
 *
 *   시공사례 사진(collection 버킷) 새 경로 — 공개 주소에 회원 id 가 없다:
 *     'p/<uuid>.(jpg|png)'  회원이 올린다 — 넣기 정책 collection_insert_photo (이름 모양 · owner_id = 본인)
 *     'ai/<uuid>.<확장자>'  서버가 올린다 — 트리거 trg_collection_posts_ai_owner 가 게시물 주인을 owner_id 로
 *     지우기 collection_delete_owner — 'p/' · 'ai/' 중 owner_id = 본인
 *   옛 '<user_id>/…' 정책은 그대로 (지금 앱이 쓴다). 탈퇴 정리 함수 collection_owned_objects 는 service_role 만.
 *   워커와 맞물리는 것: generate-api collectionPath → 'ai/<uuid>', account-api 가 부르는 함수 이름 · 칸 · 받는 경로 모양.
 *   역할별 동작은 database/probes/0052-collection-anon-paths.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const FILE = '0052_collection_anon_paths.sql';
const raw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
const noComments = (text) =>
  text
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const S = noComments(raw(`database/migrations/${FILE}`));
const f = flat(S);
/** 함수 본문을 뺀 위 문장들 */
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, '$function$ … $function$'));
const BASE = flat(noComments(raw('database/migrations/0000_baseline.sql')));

/** 함수 머리 (CREATE OR REPLACE … AS $function$) 와 본문 */
function fn(name) {
  const m = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\((.*?)\\$function\\$(.*?)\\$function\\$`
  ).exec(f);
  return m ? { head: m[1], body: m[2].trim() } : null;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const INSERT_NAME = `^p/${UUID}\\.(jpg|png)$`;

describe('0052 — collection 버킷 새 경로 (회원 id 없음)', () => {
  test('트랜잭션 문 · 표 지우기 · 파일 지우기가 없다, 게시물 표의 정책 · 권한은 건드리지 않는다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|DROP VIEW|DROP FUNCTION|TRUNCATE|DELETE FROM|CREATE TABLE|ALTER TABLE)\b/i
    );
    expect(top).not.toMatch(/POLICY \w+ ON public\./);
    expect(top).not.toMatch(/ON TABLE /);
    expect(top).not.toMatch(/storage\.buckets/);
  });

  test('storage 정책 — 새 넣기 · 지우기 둘만 만들고, 옛 다섯은 그대로 둔다', () => {
    const made = [...top.matchAll(/CREATE POLICY (\w+) ON storage\.objects/g)].map((m) => m[1]);
    const dropped = [...top.matchAll(/DROP POLICY IF EXISTS (\w+) ON storage\.objects/g)].map(
      (m) => m[1]
    );
    expect(made).toEqual(['collection_insert_photo', 'collection_delete_owner']);
    expect(dropped).toEqual(made);
    for (const name of made)
      expect(top.indexOf(`DROP POLICY IF EXISTS ${name} `)).toBeLessThan(
        top.indexOf(`CREATE POLICY ${name} `)
      );
    // 옛 정책(첫 칸 = 본인 id)은 기준선에 있고, 이 파일은 손대지 않는다 — 앱이 새 경로로 바꾼 뒤 다음 번호에서 거둔다
    for (const old of [
      'collection_insert_own',
      'collection_update_own',
      'collection_delete_own',
      'collection_select_public',
      'collection_delete_admin',
    ]) {
      expect(BASE).toContain(`CREATE POLICY ${old} ON storage.objects`);
      expect(top).not.toContain(old + ' ');
    }
  });

  test('넣기 — TO authenticated, collection 버킷 · p/<uuid 소문자>.(jpg|png) · owner_id = 본인', () => {
    expect(f).toContain(
      `CREATE POLICY collection_insert_photo ON storage.objects FOR INSERT TO authenticated WITH CHECK ( bucket_id = 'collection' AND name ~ '${INSERT_NAME}' AND owner_id = ((SELECT auth.uid()))::text );`
    );
    const re = new RegExp(INSERT_NAME);
    const id = crypto.randomUUID();
    const ok = [`p/${id}.jpg`, `p/${id}.png`];
    const no = [
      `p/${id.toUpperCase()}.jpg`,
      `p/${id}.webp`,
      `p/${id}.jpeg`,
      `p/${id}/x.jpg`,
      `p/${id}`,
      `ai/${id}.png`,
      `${id}/${Date.now()}-abc.jpg`,
      `x/p/${id}.jpg`,
    ];
    for (const n of ok) expect([n, re.test(n)]).toEqual([n, true]);
    for (const n of no) expect([n, re.test(n)]).toEqual([n, false]);
  });

  test('지우기 — TO authenticated, collection 버킷 · 첫 칸 p | ai · owner_id = 본인 (경로로 주인을 정하지 않는다)', () => {
    expect(f).toContain(
      "CREATE POLICY collection_delete_owner ON storage.objects FOR DELETE TO authenticated USING ( bucket_id = 'collection' AND (storage.foldername(name))[1] IN ('p', 'ai') AND owner_id = ((SELECT auth.uid()))::text );"
    );
    expect(top).not.toMatch(/CREATE POLICY \w+ ON storage\.objects FOR (UPDATE|SELECT)/);
  });

  test('AI 연출컷 복사본 주인 트리거 — ai_render 게시물이 가리키는 ai/ 파일, 주인이 빈 것만 · 함수는 아무도 못 부른다', () => {
    const g = fn('collection_posts_ai_owner');
    expect(g.head).toBe(
      ") RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS "
    );
    expect(g.body).toBe(
      "BEGIN UPDATE storage.objects o SET owner_id = NEW.user_id::text WHERE o.bucket_id = 'collection' AND o.name = NEW.storage_path AND o.owner_id IS NULL; RETURN NULL; END;"
    );
    expect(top).toContain(
      'REVOKE ALL ON FUNCTION public.collection_posts_ai_owner() FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(top).not.toMatch(/GRANT [^;]* ON FUNCTION public\.collection_posts_ai_owner/);
    const drop = 'DROP TRIGGER IF EXISTS trg_collection_posts_ai_owner ON public.collection_posts;';
    const create =
      "CREATE TRIGGER trg_collection_posts_ai_owner AFTER INSERT OR UPDATE OF storage_path ON public.collection_posts FOR EACH ROW WHEN (((new.source = 'ai_render'::text) AND (new.user_id IS NOT NULL) AND (new.storage_path ~~ 'ai/%'::text))) EXECUTE FUNCTION public.collection_posts_ai_owner();";
    expect(top).toContain(drop);
    expect(top).toContain(create);
    expect(top.indexOf(drop)).toBeLessThan(top.indexOf(create));
    // ai_render 행은 서버만 넣고, 회원은 고치지 못한다 — 기준선 정책 · 0049 지킴이가 그대로다
    expect(BASE).toContain(
      "CREATE POLICY collection_posts_insert ON public.collection_posts FOR INSERT TO PUBLIC WITH CHECK (((auth.uid() = user_id) AND (source = 'upload'::text) AND (generation_id IS NULL)));"
    );
    expect(flat(noComments(raw('database/migrations/0049_collection_info.sql')))).toContain(
      'NEW.source := OLD.source;'
    );
  });

  test('채우기 — 이미 있는 ai/ 복사본 중 주인이 빈 것만 게시물 주인으로', () => {
    const updates = top.match(/UPDATE storage\.objects [^;]*;/g) || [];
    expect(updates).toEqual([
      "UPDATE storage.objects o SET owner_id = p.user_id::text FROM public.collection_posts p WHERE p.source = 'ai_render' AND p.user_id IS NOT NULL AND p.storage_path LIKE 'ai/%' AND o.bucket_id = 'collection' AND o.name = p.storage_path AND o.owner_id IS NULL;",
    ]);
    expect(top).not.toMatch(/UPDATE public\./);
  });

  test('탈퇴 정리 함수 collection_owned_objects — 회원이 주인인 p/ · ai/ 경로만, service_role 만', () => {
    const g = fn('collection_owned_objects');
    expect(g.head).toBe(
      "p_user_id uuid) RETURNS TABLE(path text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS "
    );
    expect(g.body).toBe(
      "SELECT o.name FROM storage.objects o WHERE o.bucket_id = 'collection' AND o.owner_id = p_user_id::text AND (storage.foldername(o.name))[1] IN ('p', 'ai') ORDER BY o.name;"
    );
    expect(top).toContain(
      'REVOKE ALL ON FUNCTION public.collection_owned_objects(uuid) FROM PUBLIC, anon, authenticated, service_role;'
    );
    const grants = top.match(/GRANT [^;]*;/g) || [];
    expect(grants).toEqual([
      'GRANT EXECUTE ON FUNCTION public.collection_owned_objects(uuid) TO service_role;',
    ]);
  });

  test('프로브의 정책 목록 기대값 = 기준선의 collection 정책 + 이 파일의 둘', () => {
    const probe = JSON.parse(raw('database/probes/0052-collection-anon-paths.json'));
    const check = probe.checks.find((c) => c.name.startsWith('collection 버킷 storage 정책'));
    const all = [
      ...(BASE + ' ' + top).matchAll(
        /CREATE POLICY (collection_\w+) ON storage\.objects FOR (\w+) TO (\w+)/g
      ),
    ].map((m) => `${m[1]}:${m[2]}:${m[3].toLowerCase()}`);
    const want = [...new Set(all)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(' | ');
    expect(check.expect.service_role).toBe(want);
  });
});

describe('워커와 맞물리는 것', () => {
  const gen = raw('workers/generate-api/src/collection-post.js');
  const purge = raw('workers/account-api/src/storage-purge.js');
  const wd = raw('workers/account-api/src/withdrawal.js');

  test('generate-api — AI 연출컷 복사본은 ai/<무작위 UUID> (회원 id · 연출컷 id 를 넣지 않는다)', () => {
    expect(gen).toContain("export const COLLECTION_AI_PREFIX = 'ai';");
    expect(gen).toContain(
      'return `${COLLECTION_AI_PREFIX}/${crypto.randomUUID()}.${extOf(mimeType)}`;'
    );
    expect(gen).not.toMatch(/\/gen-\$\{/);
  });

  test('account-api — 이 함수를 p_user_id 로 부르고 path 칸을 읽는다, 받는 경로 모양은 지우기 정책의 첫 칸과 같다', () => {
    expect(wd).toContain(
      "rest(env, 'rpc/collection_owned_objects', 'POST', { p_user_id: userId })"
    );
    expect(wd).toContain('rows.map((r) => r && r.path)');
    expect(purge).toContain('export const OWNED_PATH_RE = /^(p|ai)\\/[^/]+$/;');
    const folders = /\(storage\.foldername\(name\)\)\[1\] IN \(([^)]*)\)/.exec(top)[1];
    expect(folders).toBe("'p', 'ai'");
  });
});
