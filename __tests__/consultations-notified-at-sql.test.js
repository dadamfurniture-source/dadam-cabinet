/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0002_consultations_notified_at.sql 정적 시험 — DB 없이 돈다.
 *
 * 새 상담 Slack 알림(workers/workflow-api/src/consult-notify.js)이 쓰는 표시 칸 · 잡기 함수:
 *   - notified_at 칸 · 미알림 부분 인덱스 — 다시 돌려도 되는 꼴
 *   - 고객 INSERT 정책: 기준선(0000) 의 조건을 그대로 두고 notified_at IS NULL 만 더한다
 *   - claim_consultation_notices: 고르는 SELECT 는 FOR UPDATE SKIP LOCKED, service_role 만 부른다,
 *     돌려주는 칸에 개인정보(이름 · 이메일 · 연락처 · 제목 · 요청 내용 · 메모)가 없다
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));
const lf = (s) => s.replace(BOM_RE, '').replace(/\r\n?/g, '\n');
const read = (f) => lf(fs.readFileSync(path.join(DIR, f), 'utf8'));
/** 줄 주석을 뺀다 — 설명 글의 낱말로 시험이 통과하지 않게 */
const code = (sql) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

const FILE = '0002_consultations_notified_at.sql';
const SQL = code(read(FILE));
const BASE = read('0000_baseline.sql');
const FN = (SQL.match(
  /CREATE OR REPLACE FUNCTION public\.claim_consultation_notices[\s\S]*?\$function\$;/
) || [''])[0];
const SIG = 'public.claim_consultation_notices(timestamp with time zone, integer)';

/** CREATE POLICY "Users can insert consultations" … WITH CHECK (…); 의 괄호 안 */
function insertCheck(sql) {
  const m = sql.match(
    /CREATE POLICY "Users can insert consultations" ON public\.consultations\s+FOR INSERT\s+TO PUBLIC\s+WITH CHECK \(([\s\S]*?)\);/
  );
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

describe('0002 — notified_at 칸 · 인덱스', () => {
  test('칸과 부분 인덱스는 IF NOT EXISTS 로 더한다', () => {
    expect(SQL).toMatch(
      /ALTER TABLE public\.consultations ADD COLUMN IF NOT EXISTS notified_at timestamp with time zone;/
    );
    expect(SQL).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_consultations_unnotified ON public\.consultations USING btree \(created_at\) WHERE \(notified_at IS NULL\);/
    );
  });

  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    const outside = SQL.replace(/\$function\$[\s\S]*?\$function\$/g, '');
    expect(/^\s*(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/im.test(outside)).toBe(false);
  });
});

describe('0002 — 고객 INSERT 정책', () => {
  const before = insertCheck(BASE);
  const after = insertCheck(SQL);

  test('기준선(라이브) 조건 — (user_id IS NULL OR user_id = auth.uid()) AND consultation_generation_ok(generation_id)', () => {
    expect(before).toBe(
      '(((user_id IS NULL) OR (user_id = auth.uid())) AND public.consultation_generation_ok(generation_id))'
    );
  });

  test('새 정책 = 기준선 조건 그대로 + AND (notified_at IS NULL)', () => {
    expect(after).toBe(
      '(((user_id IS NULL) OR (user_id = auth.uid())) AND public.consultation_generation_ok(generation_id) AND (notified_at IS NULL))'
    );
    expect(after).toBe(`${before.slice(0, -1)} AND (notified_at IS NULL))`);
  });

  test('DROP POLICY IF EXISTS 다음 CREATE POLICY (다시 돌려도 된다)', () => {
    const drop = SQL.indexOf(
      'DROP POLICY IF EXISTS "Users can insert consultations" ON public.consultations;'
    );
    const create = SQL.indexOf('CREATE POLICY "Users can insert consultations"');
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
  });
});

describe('0002 — claim_consultation_notices', () => {
  test('고르는 SELECT 둘 다 notified_at IS NULL · FOR UPDATE SKIP LOCKED, 표시는 notified_at = now()', () => {
    expect(FN).not.toBe('');
    expect((FN.match(/FOR UPDATE SKIP LOCKED/g) || []).length).toBe(2);
    expect((FN.match(/WHERE \w+\.notified_at IS NULL/g) || []).length).toBe(2);
    expect((FN.match(/SET notified_at = now\(\)/g) || []).length).toBe(2);
    // 오래된(또는 시각이 빈) 행은 표시만, 창 안의 행은 상한을 두고 잡는다
    expect(FN).toMatch(/s\.created_at IS NULL OR s\.created_at < p_fresh_since/);
    expect(FN).toMatch(/f\.created_at >= p_fresh_since/);
    expect(FN).toMatch(/LIMIT least\(greatest\(coalesce\(p_limit, 20\), 1\), 50\)/);
  });

  test('SECURITY DEFINER 가 아니고 search_path 를 고정한다', () => {
    expect(FN).not.toMatch(/SECURITY DEFINER/i);
    expect(FN).toMatch(/SET search_path TO ''/);
  });

  test('service_role 만 부른다', () => {
    expect(SQL).toContain(
      `REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC, anon, authenticated, service_role;`
    );
    const grants =
      SQL.match(
        /GRANT EXECUTE ON FUNCTION public\.claim_consultation_notices\([^)]*\) TO [^;]+;/g
      ) || [];
    expect(grants).toEqual([`GRANT EXECUTE ON FUNCTION ${SIG} TO service_role;`]);
  });

  test('돌려주는 칸에 개인정보가 없다 — 알림에 쓰는 코드 칸만', () => {
    const keys = [...FN.matchAll(/'(\w+)', /g)].map((m) => m[1]);
    expect(keys).toEqual([
      'created_at',
      'consultation_type',
      'furniture_categories',
      'preferred_date',
      'preferred_time',
      'sido',
      'gugun',
      'consult_target',
      'has_generation',
      'category',
      'stale',
      'rows',
    ]);
    const returning = (FN.match(/RETURNING ([\s\S]*?)\n\s*\)/g) || []).join(' ');
    for (const col of [
      'name',
      'email',
      'phone',
      'title',
      'description',
      'admin_memo',
      'quote',
      'user_id',
    ])
      expect(returning).not.toMatch(new RegExp(`\\bc\\.${col}\\b`));
  });
});
