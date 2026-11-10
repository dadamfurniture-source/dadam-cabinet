/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0058_site_geo_as_visit.sql 정적 시험 (DB 없이).
 *
 *   설치 · A/S 지도 + 표 (2026-11-10 계획 3단계) —
 *     현장 정보(design_site_info)에 시도 · 구군 · 위도 · 경도 · 바꾼 주소 · 바꾼 때,
 *     A/S 접수(as_requests)에 방문 일정 한 줄(visit_schedule_id → design_schedules).
 *   정책 · 권한 · 지킴이 트리거는 건드리지 않는다.
 *   값은 database/probes/0058-site-geo-as-visit.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const noComments = (text) =>
  text
    .split('\r\n')
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/^\s*--.*$/, ''))
    .join('\n');
const f = noComments(read('database', 'migrations', '0058_site_geo_as_visit.sql'))
  .replace(/\s+/g, ' ')
  .trim();
const statements = f
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
/** COMMENT 문은 글자라 따로 본다 */
const ddl = statements.filter((s) => !s.startsWith('COMMENT ON COLUMN'));
const comments = statements.filter((s) => s.startsWith('COMMENT ON COLUMN'));

describe('0058 — 현장 좌표 + A/S 방문 일정 잇기', () => {
  test('문장 — 칸 더하기 · 제약 다시 걸기 · 고유 색인뿐 (다시 돌려도 된다)', () => {
    expect(ddl).toEqual([
      'ALTER TABLE public.design_site_info ADD COLUMN IF NOT EXISTS sido text, ADD COLUMN IF NOT EXISTS gugun text, ADD COLUMN IF NOT EXISTS lat double precision, ADD COLUMN IF NOT EXISTS lng double precision, ADD COLUMN IF NOT EXISTS geo_address text, ADD COLUMN IF NOT EXISTS geocoded_at timestamp with time zone',
      'ALTER TABLE public.design_site_info DROP CONSTRAINT IF EXISTS design_site_info_geo_chk',
      expect.stringMatching(
        /^ALTER TABLE public\.design_site_info ADD CONSTRAINT design_site_info_geo_chk CHECK \(/
      ),
      'ALTER TABLE public.as_requests ADD COLUMN IF NOT EXISTS visit_schedule_id uuid',
      'ALTER TABLE public.as_requests DROP CONSTRAINT IF EXISTS as_requests_visit_schedule_fkey',
      'ALTER TABLE public.as_requests ADD CONSTRAINT as_requests_visit_schedule_fkey FOREIGN KEY (visit_schedule_id) REFERENCES public.design_schedules(id) ON DELETE SET NULL',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_as_requests_visit_schedule ON public.as_requests USING btree (visit_schedule_id) WHERE (visit_schedule_id IS NOT NULL)',
    ]);
    expect(comments).toHaveLength(7);
  });

  test('트랜잭션 문 · 정책 · 권한 · 행 · 지우기는 없다', () => {
    const body = ddl.join('; ');
    expect(body).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(body).not.toMatch(/\bCONCURRENTLY\b/i);
    expect(body).not.toMatch(
      /\b(GRANT|REVOKE|POLICY|TRIGGER|FUNCTION|DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE|INSERT)\b/i
    );
    // 새 칸은 모두 비어도 된다 — 있는 줄을 건드리지 않는다
    expect(body).not.toMatch(/\b(text|uuid|precision|zone) NOT NULL\b/i);
    expect(body).not.toMatch(/\bDEFAULT\b/i);
  });

  test('좌표 제약 — 길이 · 둘 다 있거나 없음 · 대한민국 범위 · 바꾼 주소와 같이', () => {
    const chk = ddl[2];
    expect(chk).toContain('(COALESCE(length(sido), 0) <= 20)');
    expect(chk).toContain('(COALESCE(length(gugun), 0) <= 30)');
    expect(chk).toContain('(COALESCE(length(geo_address), 0) <= 200)');
    expect(chk).toContain('((lat IS NULL) = (lng IS NULL))');
    expect(chk).toContain(
      '((lat IS NULL) OR ((lat >= 32.5) AND (lat <= 39.5) AND (lng >= 124.0) AND (lng <= 132.5)))'
    );
    expect(chk).toContain('((lat IS NULL) OR (geo_address IS NOT NULL))');
  });

  test('앞 마이그레이션이 만든 것 위에 선다 — as_requests(0045) · design_schedules as_visit(바탕)', () => {
    expect(read('database', 'migrations', '0045_as_requests.sql')).toContain(
      'CREATE TABLE IF NOT EXISTS public.as_requests'
    );
    const base = read('database', 'migrations', '0000_baseline.sql');
    expect(base).toContain('CREATE TABLE public.design_site_info (');
    expect(base).toContain("'as_visit'::text");
    // 지킴이 트리거는 새 칸을 보지 않는다 — 서버가 방문 일정을 이을 수 있다
    expect(read('database', 'migrations', '0045_as_requests.sql')).not.toContain(
      'visit_schedule_id'
    );
  });

  test('프로브 — 읽기 규칙 그대로 · 좌표 제약 · 방문 일정(서버만 · 한 일정 한 접수 · 지워지면 비움)', () => {
    const probe = JSON.parse(read('database', 'probes', '0058-site-geo-as-visit.json'));
    expect(probe.title).toContain('database/migrations/0058_site_geo_as_visit.sql');
    const byName = Object.fromEntries(probe.checks.map((c) => [c.name, c.expect]));
    expect(probe.checks.length).toBe(17);
    expect(Object.keys(byName)).toHaveLength(17);

    expect(
      byName[
        '현장 좌표 읽기 — 그 업체 구성원 · 서버만 (남의 업체 · 고객 없음, 익명 deny) — 읽기 규칙 그대로'
      ]
    ).toEqual({
      x_staff: '시험시 시험구 37.5,127',
      service_role: '시험시 시험구 37.5,127',
      y_owner: '(없음)',
      customer: '(없음)',
      anon: 'deny',
    });
    expect(byName['구성원은 좌표를 직접 못 고친다 (쓰기 정책 없음 — 0줄)']).toEqual({
      x_staff: 'rows:0',
      y_owner: 'rows:0',
    });
    expect(byName['위도 · 경도는 둘 다 있거나 둘 다 없다 — 한쪽만 비우면 거절']).toEqual({
      service_role: 'err:23514',
    });
    expect(byName['대한민국 밖 좌표는 거절 (위도)']).toEqual({ service_role: 'err:23514' });
    expect(byName['대한민국 밖 좌표는 거절 (경도)']).toEqual({ service_role: 'err:23514' });
    expect(byName['좌표가 있으면 바꾼 주소 글자도 있어야 한다']).toEqual({
      service_role: 'err:23514',
    });
    expect(byName['고객 · 구성원은 방문 일정을 못 잇는다']).toEqual({
      customer: 'deny',
      x_staff: 'deny',
    });
    expect(byName['서버 — 방문 일정 잇기 (지킴이 트리거가 막지 않는다)']).toEqual({
      service_role: 'rows:1',
    });
    expect(byName['한 일정은 한 접수에만']).toEqual({ service_role: 'err:23505' });
    expect(byName['없는 일정은 못 잇는다']).toEqual({ service_role: 'err:23503' });
    expect(byName['일정이 지워지면 접수의 방문 일정 칸이 비워진다 (접수는 남는다)']).toEqual({
      service_role: 'true/requested',
    });

    // 시험 자료는 합성 — 실제 주소 · 이름 없음
    const text = JSON.stringify(probe);
    expect(text).not.toMatch(/서울|경기|부산|강남|010-/);
  });
});
