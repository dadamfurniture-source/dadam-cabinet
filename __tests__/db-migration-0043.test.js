/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0043_order_reports.sql 정적 시험 (DB 없이).
 *
 *   2026-11-06 사장님 결정 (작업 분배 ⑤ 완료 보고 — 수주에서 「설치 완료」 · 「A/S 완료」 + 사진, 본사는 기록만):
 *   order_reports 표(추가만) · 지킴이 · 구성원 읽기 정책 · 비공개 사진 버킷 order-report-photos.
 *   값은 database/probes/0043-order-reports.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '0043_order_reports.sql'), 'utf8')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
/** 함수 본문을 뺀 위 문장들 */
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');

describe('0043 — 수주 완료 보고', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기가 없다, 새 표는 하나', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual(['CREATE TABLE IF NOT EXISTS public.order_reports']);
  });

  test('종류 둘 · 메모 500자 · 사진 10장 · 같은 팩토리 수주(복합 FK)', () => {
    expect(f).toContain("CHECK (kind = ANY (ARRAY['install_done'::text, 'as_done'::text]))");
    expect(f).toContain('(note IS NULL) OR (length(note) <= 500)');
    expect(f).toContain('jsonb_array_length(photos) <= 10');
    expect(f).toContain('FOREIGN KEY (order_id, company_id) REFERENCES public.orders(id, company_id) ON DELETE RESTRICT');
  });

  test('추가만 — 서버는 SELECT · INSERT, 고치기 · 지우기 · 비우기는 아무도, 구성원은 읽기만(그 팩토리)', () => {
    expect(f).toContain('GRANT SELECT, INSERT ON TABLE public.order_reports TO service_role;');
    expect(f).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.order_reports FROM service_role;');
    expect(f).toContain('GRANT SELECT ON TABLE public.order_reports TO authenticated;');
    expect(f).toContain('USING (company_id IN (SELECT public.my_company_ids()))');
    expect(f).toContain('BEFORE UPDATE ON public.order_reports');
    expect(f).toContain("SET search_path TO ''");
  });

  test('비공개 사진 버킷 — 5MB · JPEG · PNG, 정책 없음(서버만)', () => {
    expect(f).toContain("VALUES ('order-report-photos', 'order-report-photos', false, 5242880, ARRAY['image/jpeg', 'image/png'])");
    expect(top).not.toMatch(/CREATE POLICY [^;]*ON storage\./);
  });

  test('프로브 — 읽기 · 쓰기 · 종류 · 사진 수 · 같은 팩토리 · 고치기 · 지우기 · 버킷', () => {
    const probe = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database', 'probes', '0043-order-reports.json'), 'utf8'));
    expect(probe.checks.map((c) => c.name.split(' — ')[0].split(' (')[0])).toEqual([
      '읽기',
      '구성원은 쓰지 못한다',
      '서버',
      '종류는 둘만',
      '사진 10장까지',
      '같은 팩토리 수주만',
      '고치기 · 지우기는 서버도 못 한다',
      '지우기도 못 한다',
      '사진 버킷',
    ]);
    expect(probe.checks[0].expect).toEqual({ x_owner: '1', y_owner: '0', anon: 'deny', service_role: '1' });
  });
});
