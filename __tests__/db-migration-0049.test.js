/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0049_collection_info.sql 정적 시험 (DB 없이).
 *
 *   시공사례 사진 정보: collection_posts 에 place_label · door_color · company_id (비어도 됨),
 *   지킴이(회원이 직접 쓸 때 업체 · 좋아요 수 · 출처는 서버 값, 장소는 region · category 로),
 *   좋아요는 본인 줄만(anon 권한 없음 · 고치기 없음), update_like_count 는 하는 일 그대로 search_path 비움,
 *   업체 이름(collection_post_companies — 본사 · 활동 중 협력업체 이름 · 종류만) · 내 좋아요(collection_my_likes).
 *   이름 글은 화면 글 그대로 (ai-design.html #doorColor · KINDS, segan/activity.html 구분).
 *   역할별 동작은 database/probes/0049-collection-info.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'database', 'migrations');
const FILE = '0049_collection_info.sql';
const raw = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').split('\r\n').join('\n');
const read = (name) =>
  raw(name)
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const S = read(FILE);
const f = flat(S);
/** 함수 본문을 뺀 위 문장들 */
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, '$function$ … $function$'));
const BASE = flat(read('0000_baseline.sql'));
const site = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 함수 머리 (CREATE OR REPLACE … AS $function$) 와 본문 */
function fn(text, name) {
  const m = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\((.*?)\\$function\\$(.*?)\\$function\\$`
  ).exec(text);
  return m ? { head: m[1], body: m[2] } : null;
}

/** CASE <식> WHEN 'a' THEN 'b' … END → { a: b } (첫 번째로 <식> 이 나오는 CASE) */
function casePairs(text, expr) {
  const at = text.indexOf(`CASE ${expr} `);
  if (at < 0) return null;
  const end = text.indexOf(' END', at);
  const out = {};
  for (const m of text.slice(at, end).matchAll(/WHEN '([^']+)' THEN '([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

describe('0049 — 시공사례 사진 정보 · 좋아요', () => {
  test('트랜잭션 문 · 표 지우기 · 새 표가 없다, 게시물 정책 · 권한은 건드리지 않는다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|DROP VIEW|TRUNCATE|DROP FUNCTION|CREATE TABLE|DELETE FROM)\b/i
    );
    expect(top).not.toMatch(/POLICY \w+ ON public\.collection_posts/);
    expect(top).not.toMatch(/ON TABLE public\.collection_posts/);
    expect(top).not.toMatch(/CREATE (OR REPLACE )?VIEW/);
  });

  test('칸 셋 — 비어도 되고(기본값 · NOT NULL 없음) 길이 제한, 업체는 companies (지워지면 비움)', () => {
    for (const col of ['place_label', 'door_color', 'company_id']) {
      const m = new RegExp(
        `ALTER TABLE public\\.collection_posts ADD COLUMN IF NOT EXISTS ${col} (\\w+);`
      ).exec(top);
      expect([col, m && m[1]]).toEqual([col, col === 'company_id' ? 'uuid' : 'text']);
    }
    expect(top).toContain(
      'CONSTRAINT collection_posts_place_label_check CHECK ((place_label IS NULL) OR ((char_length(place_label) >= 1) AND (char_length(place_label) <= 60)))'
    );
    expect(top).toContain(
      'CONSTRAINT collection_posts_door_color_check CHECK ((door_color IS NULL) OR ((char_length(door_color) >= 1) AND (char_length(door_color) <= 20)))'
    );
    expect(top).toContain(
      'CONSTRAINT collection_posts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL'
    );
    const adds = (top.match(/ADD CONSTRAINT \w+/g) || []).map((s) => s.split(' ').pop());
    const drops = (top.match(/DROP CONSTRAINT IF EXISTS \w+/g) || []).map((s) =>
      s.split(' ').pop()
    );
    expect(adds).toEqual(drops);
    expect(adds).toHaveLength(3);
    for (const name of adds)
      expect(top.indexOf(`DROP CONSTRAINT IF EXISTS ${name}`)).toBeLessThan(
        top.indexOf(`ADD CONSTRAINT ${name}`)
      );
  });

  test('좋아요 — 읽기 · 넣기 · 지우기 모두 본인 줄만 (TO authenticated), 0000 의 USING (true) 는 없어진다', () => {
    expect(BASE).toContain(
      'CREATE POLICY collection_likes_select ON public.collection_likes FOR SELECT TO PUBLIC USING (true);'
    );
    for (const [name, cmd, clause] of [
      ['collection_likes_select', 'SELECT', 'USING'],
      ['collection_likes_insert', 'INSERT', 'WITH CHECK'],
      ['collection_likes_delete', 'DELETE', 'USING'],
    ]) {
      const drop = `DROP POLICY IF EXISTS ${name} ON public.collection_likes;`;
      const create = `CREATE POLICY ${name} ON public.collection_likes FOR ${cmd} TO authenticated ${clause} ((user_id = (SELECT auth.uid())));`;
      expect(top).toContain(drop);
      expect(top).toContain(create);
      expect(top.indexOf(drop)).toBeLessThan(top.indexOf(create));
    }
    expect((top.match(/CREATE POLICY/g) || []).length).toBe(3);
    expect(f).not.toMatch(/USING \(true\)/);
    expect(top).toContain(
      'REVOKE ALL ON TABLE public.collection_likes FROM PUBLIC, anon, authenticated;'
    );
    expect(top).toContain(
      'GRANT SELECT, INSERT, DELETE ON TABLE public.collection_likes TO authenticated;'
    );
    expect(top).not.toMatch(/GRANT [^;]*\bUPDATE\b[^;]*ON TABLE public\.collection_likes/);
  });

  test('좋아요 수 트리거 함수 — 0000 본문 그대로 + search_path 비움 · public. · NULL 이면 0, 트리거는 그대로', () => {
    const now = fn(f, 'update_like_count');
    const was = fn(BASE, 'update_like_count');
    expect(was.head).toBe(') RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS ');
    expect(now.head).toBe(
      ") RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS "
    );
    const back = now.body
      .split('UPDATE public.collection_posts')
      .join('UPDATE collection_posts')
      .split('coalesce(like_count, 0)')
      .join('like_count');
    expect(back).toBe(was.body);
    expect(top).not.toMatch(/trigger_update_like_count/);
    expect(top).toContain(
      'REVOKE ALL ON FUNCTION public.update_like_count() FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(top).not.toMatch(/GRANT [^;]* ON FUNCTION public\.update_like_count/);
  });

  test('지킴이 — 회원이 직접 쓸 때만, 업체 · 좋아요 수 · 출처는 서버 값, 장소는 region · category 로', () => {
    const g = fn(f, 'collection_posts_info_guard');
    expect(g.head).toBe(") RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS ");
    expect(g.head).not.toMatch(/SECURITY DEFINER/);
    expect(g.body).toContain(
      "IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;"
    );
    expect(g.body).toContain('NEW.like_count := 0;');
    expect(g.body).toContain(
      "NEW.company_id := CASE WHEN current_user = 'authenticated' THEN public.collection_my_post_company(NEW.design_id) END;"
    );
    for (const pin of [
      'NEW.like_count := OLD.like_count;',
      'NEW.source := OLD.source;',
      'NEW.generation_id := OLD.generation_id;',
    ])
      expect(g.body).toContain(pin);
    expect(g.body).toContain('ELSE OLD.company_id');
    expect(g.body).toContain(
      'NEW.place_label := public.collection_place_label(NEW.region, NEW.category);'
    );
    expect(g.body).not.toMatch(/door_color/);
    expect(top).toContain(
      'CREATE TRIGGER trg_collection_posts_info_guard BEFORE INSERT OR UPDATE ON public.collection_posts FOR EACH ROW EXECUTE FUNCTION public.collection_posts_info_guard();'
    );
    expect(
      top.indexOf(
        'DROP TRIGGER IF EXISTS trg_collection_posts_info_guard ON public.collection_posts;'
      )
    ).toBeLessThan(top.indexOf('CREATE TRIGGER trg_collection_posts_info_guard'));
    expect(top).toContain(
      'REVOKE ALL ON FUNCTION public.collection_posts_info_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  test('업체 고르기 — 부른 사람 본인 설계 + 시공 완료 수주, 아니면 본인 active 업체 (본인 것만, 로그인만)', () => {
    const c = fn(f, 'collection_my_post_company');
    expect(c.head).toBe(
      "p_design uuid DEFAULT NULL::uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS "
    );
    expect(c.body).toContain('d.user_id = auth.uid()');
    expect(c.body).toContain(
      "EXISTS (SELECT 1 FROM public.orders o WHERE o.design_id = d.id AND o.status = 'completed')"
    );
    expect(c.body).toContain("m.user_id = auth.uid() AND m.status = 'active'");
    expect(c.body).not.toMatch(/p_user|generations/);
    expect(top).toContain(
      'GRANT EXECUTE ON FUNCTION public.collection_my_post_company(uuid) TO authenticated;'
    );
    expect(top).not.toMatch(
      /ON FUNCTION public\.collection_my_post_company\(uuid\) TO [^;]*\b(anon|service_role)\b/
    );
  });

  test('장소 표시 — region 은 한글 두 낱말까지, 구분 이름은 앱 select 글 그대로 (other 기타는 뺀다)', () => {
    const p = fn(f, 'collection_place_label');
    expect(p.head).toBe(
      "p_region text, p_category text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS "
    );
    expect(p.body).toContain("btrim(coalesce(p_region, '')) ~ '^[가-힣]{1,8}( [가-힣]{1,8})?$'");
    const pairs = casePairs(p.body, 'p_category');
    const html = site('segan/activity.html');
    const sel = /<select id="acCaseCategory">([\s\S]*?)<\/select>/.exec(html)[1];
    const options = Object.fromEntries(
      [...sel.matchAll(/<option value="(\w+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]])
    );
    expect(Object.keys(options)).toEqual(['kitchen', 'builtin', 'storage', 'interior', 'other']);
    const { other, ...rest } = options;
    expect(other).toBe('기타');
    expect(pairs).toEqual(rest);
    expect(top).toContain(
      'GRANT EXECUTE ON FUNCTION public.collection_place_label(text, text) TO authenticated, service_role;'
    );
  });

  test('업체 이름 — 게시물 id 로만 (앞 100개), 본사 · 활동 중 협력업체의 이름 · 종류만, 누구나', () => {
    const c = fn(f, 'collection_post_companies');
    expect(c.head).toBe(
      "p_post_ids uuid[]) RETURNS TABLE(post_id uuid, company_name text, company_kind text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS "
    );
    expect(c.body).toContain(
      'SELECT p.id, c.name, c.kind FROM public.collection_posts p JOIN public.companies c ON c.id = p.company_id'
    );
    expect(c.body).toContain('p.id = ANY (p_post_ids[1:100])');
    expect(c.body).toContain("c.kind IN ('hq', 'partner') AND c.status = 'active'");
    // 업체의 다른 칸(지역 · 등급 · 사업자 · 연락처)은 내지 않는다
    expect([...c.body.matchAll(/\bc\.(\w+)/g)].map((m) => m[1]).sort()).toEqual([
      'id',
      'kind',
      'kind',
      'name',
      'status',
    ]);
    expect(top).toContain(
      'GRANT EXECUTE ON FUNCTION public.collection_post_companies(uuid[]) TO anon, authenticated, service_role;'
    );
  });

  test('내 좋아요 — 부른 사람 줄만, 좋아한 때 최신순, 1~100개, 업체 이름은 같은 조건, 로그인만', () => {
    const c = fn(f, 'collection_my_likes');
    expect(c.head).toBe(
      "p_limit integer DEFAULT 30, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(post_id uuid, liked_at timestamp with time zone, image_url text, category text, source text, place_label text, door_color text, like_count integer, company_name text, company_kind text, created_at timestamp with time zone) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS "
    );
    expect(c.body).toContain('WHERE l.user_id = auth.uid()');
    expect(c.body).toContain('(p_before IS NULL OR l.created_at < p_before)');
    expect(c.body).toContain('ORDER BY l.created_at DESC NULLS LAST, l.id DESC');
    expect(c.body).toContain('LIMIT least(greatest(coalesce(p_limit, 30), 1), 100)');
    expect(c.body).toContain(
      "LEFT JOIN public.companies c ON c.id = p.company_id AND c.kind IN ('hq', 'partner') AND c.status = 'active'"
    );
    expect(c.body).not.toMatch(/p\.user_id|l\.user_id\s*=\s*p_/);
    expect(top).toContain(
      'GRANT EXECUTE ON FUNCTION public.collection_my_likes(integer, timestamp with time zone) TO authenticated, service_role;'
    );
    expect(top).not.toMatch(/ON FUNCTION public\.collection_my_likes[^;]* TO [^;]*\banon\b/);
  });

  test('함수는 모두 search_path 비움 · PUBLIC 회수, SECURITY DEFINER 는 업체 고르기 · 업체 이름 · 내 좋아요 · 좋아요 수만', () => {
    const heads = [
      ...f.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\((.*?)\$function\$/g),
    ].map((m) => [m[1], m[2]]);
    expect(heads.map(([n]) => n)).toEqual([
      'collection_place_label',
      'collection_my_post_company',
      'collection_posts_info_guard',
      'update_like_count',
      'collection_post_companies',
      'collection_my_likes',
    ]);
    for (const [name, head] of heads) {
      expect([name, /SET search_path TO ''/.test(head)]).toEqual([name, true]);
      expect(top).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`
        )
      );
    }
    expect(heads.filter(([, h]) => /SECURITY DEFINER/.test(h)).map(([n]) => n)).toEqual([
      'collection_my_post_company',
      'update_like_count',
      'collection_post_companies',
      'collection_my_likes',
    ]);
  });

  test('이름 글은 화면 글 그대로 — 문짝 색(ai-design.html #doorColor · prompts.js DOOR_COLORS) · 품목(KINDS)', () => {
    const html = site('ai-design.html');
    const sel = /<select id="doorColor">([\s\S]*?)<\/select>/.exec(html)[1];
    const doors = Object.fromEntries(
      [...sel.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]])
    );
    expect(casePairs(top, "g.options ->> 'door_color'")).toEqual(doors);
    const prompts = site('workers/generate-api/src/prompts.js');
    const keys = [
      .../export const DOOR_COLORS = Object\.freeze\(\[([\s\S]*?)\]\)/
        .exec(prompts)[1]
        .matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);
    expect(Object.keys(doors)).toEqual(keys);

    const kinds = {};
    for (const m of site('segan/make.js').matchAll(/\{ key: '(\w+)', label: '([^']+)' \}/g))
      kinds[m[1]] = m[2];
    const ai = {};
    for (const m of html.matchAll(/key: '(\w+)',\s*label: '([^']+)'/g)) ai[m[1]] = m[2];
    expect(ai).toEqual(kinds);
    expect(casePairs(top, 'g.category')).toEqual(kinds);
  });

  test('채우기 — 빈 칸만, 다른 값만 (다시 돌려도 된다), 업체 ② 는 게시물보다 먼저 생긴 구성원 줄만, 좋아요 수는 다시 센다', () => {
    const updates = top.match(/UPDATE public\.collection_posts p SET [^;]*;/g) || [];
    expect(updates).toHaveLength(4);
    expect(updates[0]).toContain(
      'SET place_label = coalesce(p.place_label, v.place_label), door_color = coalesce(p.door_color, v.door_color)'
    );
    expect(updates[0]).toContain("WHERE p2.source = 'ai_render'");
    expect(updates[0]).toContain(
      '((p.place_label IS NULL AND v.place_label IS NOT NULL) OR (p.door_color IS NULL AND v.door_color IS NOT NULL))'
    );
    expect(updates[1]).toContain("WHERE p.source = 'upload' AND p.place_label IS NULL");
    expect(updates[2]).toContain('WHERE p2.company_id IS NULL AND p2.user_id IS NOT NULL');
    expect(updates[2]).toContain('m.created_at <= p2.created_at');
    expect(updates[2]).toContain(
      "p2.source = 'upload' AND d.id = p2.design_id AND d.user_id = p2.user_id"
    );
    expect(updates[3]).toContain('SET like_count = v.n');
    expect(updates[3]).toContain('p.like_count IS DISTINCT FROM v.n');
    expect(top.match(/\bUPDATE public\.\w+/g)).toEqual(
      Array(4).fill('UPDATE public.collection_posts')
    );
  });

  test('개인 정보 — 상담 지역 · 거주지 · 주소 · 연락처를 읽지 않는다, generations.company_id 는 쓰지 않는다', () => {
    expect(f).not.toMatch(
      /public\.(consultations|profiles|customers|partners|partner_applications)\b/
    );
    expect(f).not.toMatch(/\b(sido|gugun|address|phone|business_number)\b/);
    expect(f).not.toMatch(/g\.company_id/);
  });

  test('머리말 — 무엇 · 어디서 오는지 · 지킴이 · 좋아요 · 채우기 · 0048 과 따로', () => {
    const head = raw(FILE)
      .split('\n')
      .filter((l) => l.startsWith('--'))
      .join('\n');
    expect(head).toMatch(/^-- 0049/m);
    expect(head).toMatch(/collection_post_companies/);
    expect(head).toMatch(/collection_my_likes/);
    expect(head).toMatch(/updated_at/);
    expect(head).toMatch(/0048 의 객체는 쓰지 않는다/);
    expect(head).toMatch(/다시 돌려도 된다/);
  });

  test('프로브 — 좋아요 본인 줄 · 지킴이 · 업체 이름 · 내 좋아요 · 권한', () => {
    const probe = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'database', 'probes', '0049-collection-info.json'), 'utf8')
    );
    expect(probe.checks).toHaveLength(23);
    const by = (start) => probe.checks.find((c) => c.name.startsWith(start));
    expect(by('좋아요 읽기').expect).toEqual({
      anon: 'deny',
      cust: '2',
      member: '0',
      other: '1',
      service_role: '3',
    });
    expect(by('업체 이름 — 본사 · 활동 중').expect).toEqual({ '*': 'partner:probe P,hq:hq' });
    expect(by('직접 올리기 — 보낸 업체').expect.member).toBe('true/0/인천 연수구 · 주방/오크');
    expect(by('고치기 — 자동 게시 행을').expect).toEqual({ cust: 'deny' });
    expect(by('권한').expect.service_role).toBe('true/false/true/false/false/false/false/true');
  });
});
