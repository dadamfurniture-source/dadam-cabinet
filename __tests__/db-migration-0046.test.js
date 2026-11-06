/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0046_planner_drafts.sql 정적 시험 (DB 없이).
 *
 *   간편 플래너 웹판 저장소: planner_drafts(설계 초안 · 고친 차례 · 버리기 표시) · planner_draft_photos(설계 사진 · 지운 표시) ·
 *   planner_my_modules(내 모듈) · 비공개 사진 버킷 planner-photos. 셋 다 service_role 만.
 *   값은 database/probes/0046-planner-drafts.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '0046_planner_drafts.sql'), 'utf8')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
/** 함수 본문을 뺀 위 문장들 */
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');

describe('0046 — 간편 플래너 웹판 저장소', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기가 없다, 새 표는 셋', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.planner_drafts',
      'CREATE TABLE IF NOT EXISTS public.planner_draft_photos',
      'CREATE TABLE IF NOT EXISTS public.planner_my_modules',
    ]);
  });

  test('설계 초안 — 업체 · id 열쇠, id 모양 · 5MB · rev 1 부터, 사진은 같은 업체 설계(복합 FK)', () => {
    expect(f).toContain('CONSTRAINT planner_drafts_pkey PRIMARY KEY (company_id, id)');
    expect(f).toContain("CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9-]{3,80}$'::text)");
    expect(f).toContain('octet_length(model::text) <= 5242880');
    expect(f).toContain('CHECK (rev >= 1)');
    expect(f).toContain(
      'FOREIGN KEY (company_id, draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT'
    );
    expect(f).toContain("CHECK (id ~ '^my-[a-z0-9]{6,40}$'::text)");
  });

  test('지킴이 — 내용이 바뀌면 rev + 1, 버린 설계 · 사진 내용은 그대로, search_path 비움', () => {
    expect(f).toContain('NEW.model IS DISTINCT FROM OLD.model AND NEW.rev <> OLD.rev + 1');
    expect(f).toContain('NEW.model IS NOT DISTINCT FROM OLD.model AND NEW.rev <> OLD.rev');
    expect(f).toContain('IF OLD.discarded_at IS NOT NULL THEN');
    expect(f).toContain('BEFORE UPDATE ON public.planner_drafts');
    expect(f).toContain('BEFORE UPDATE ON public.planner_draft_photos');
    expect(f.match(/SET search_path TO ''/g)).toHaveLength(2);
  });

  test('권한 — 셋 다 서버만, 설계 · 사진은 지우기 없음, 내 모듈은 고치기 없음', () => {
    for (const t of ['planner_drafts', 'planner_draft_photos', 'planner_my_modules']) {
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
    }
    expect(f).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.planner_drafts TO service_role;');
    expect(f).toContain('REVOKE DELETE, TRUNCATE ON TABLE public.planner_drafts FROM service_role;');
    expect(f).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.planner_draft_photos TO service_role;');
    expect(f).toContain('REVOKE DELETE, TRUNCATE ON TABLE public.planner_draft_photos FROM service_role;');
    expect(f).toContain('GRANT SELECT, INSERT, DELETE ON TABLE public.planner_my_modules TO service_role;');
    expect(f).toContain('REVOKE UPDATE, TRUNCATE ON TABLE public.planner_my_modules FROM service_role;');
    expect(top).not.toMatch(/CREATE POLICY/);
  });

  test('비공개 사진 버킷 — 15MB · JPEG · PNG · WEBP, 정책 없음(서버만)', () => {
    expect(f).toContain(
      "VALUES ('planner-photos', 'planner-photos', false, 15728640, ARRAY['image/jpeg', 'image/png', 'image/webp'])"
    );
  });

  test('프로브 — 읽기 · 쓰기 · id · rev · 만든 사람 · 버린 설계 · 지우기 · 사진 · 내 모듈 · 버킷', () => {
    const probe = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'database', 'probes', '0046-planner-drafts.json'), 'utf8')
    );
    expect(probe.checks.length).toBe(18);
    expect(probe.checks[0].expect).toEqual({ anon: 'deny', x_owner: 'deny', service_role: '2' });
    expect(probe.checks.find((c) => c.name.startsWith('rev 를 건너뛰면')).expect).toEqual({ service_role: 'err:22023' });
    expect(probe.checks.find((c) => c.name.startsWith('버린 설계')).expect).toEqual({ service_role: 'err:22023' });
    expect(probe.checks.find((c) => c.name.startsWith('사진 버킷')).expect).toEqual({
      service_role: 'false/15728640/image/jpeg,image/png,image/webp',
    });
  });
});
