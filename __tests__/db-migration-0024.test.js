/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0024_factory_workers.sql 정적 시험 (DB 없이).
 *
 *   공장 작업자를 계정으로 — 작업자 종류에 재단(cutting) · 엣지(edge), 공장 배정 표(factory_workers, 서버만),
 *   기록의 작업자 칸(production_worklogs.worker_id). 작업(모집) 종류는 그대로.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0024 확인이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (name) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'database', 'migrations', name), 'utf8')
    .split('\r\n')
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const S = read('0024_factory_workers.sql');
const f = S.replace(/\s+/g, ' ');
const OLD = ['install', 'as', 'assembly'];

/** CHECK (… <@ ARRAY[...]) 안의 이름들 */
function arrayOf(text, constraint) {
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\(\\(?(.*?)\\)\\)?\\s*[,;]`).exec(
    text.replace(/\s+/g, ' ')
  );
  return m ? [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]) : null;
}

describe('0024 — 공장 작업자 계정', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 고치기가 없다', () => {
    expect(S).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    // REVOKE DELETE, TRUNCATE … 는 권한 회수라 뺀다
    const noRevoke = S.replace(/^\s*REVOKE[^;]*;/gim, '');
    expect(noRevoke).not.toMatch(/\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(S).not.toMatch(/^\s*(INSERT|UPDATE)\b/im);
  });

  test('작업자 · 초대 종류 — 지금 셋 그대로 + 재단 · 엣지, 작업(모집) 종류는 손대지 않는다', () => {
    const base = read('0000_baseline.sql');
    expect(arrayOf(base, 'workers_kinds_chk')).toEqual(OLD);
    expect(arrayOf(base, 'worker_invites_kinds_chk')).toEqual(OLD);
    for (const c of ['workers_kinds_chk', 'worker_invites_kinds_chk']) {
      expect(f).toContain(`DROP CONSTRAINT IF EXISTS ${c};`);
      expect(arrayOf(S, c)).toEqual([...OLD, 'cutting', 'edge']);
    }
    expect(S).not.toMatch(/work_jobs/);
  });

  test('공장 배정 — 작업자마다 열린 배정 하나 · 링크는 한 번만 · 서버만 읽고 쓴다(지우기 없음)', () => {
    expect(f).toContain('CREATE TABLE IF NOT EXISTS public.factory_workers (');
    expect(f).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS factory_workers_one_open ON public.factory_workers USING btree (worker_id) WHERE (ended_at IS NULL);'
    );
    expect(f).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS factory_workers_link_once ON public.factory_workers USING btree (link_id) WHERE (link_id IS NOT NULL);'
    );
    expect(f).toContain('FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE');
    expect(f).toContain(
      'FOREIGN KEY (link_id) REFERENCES public.production_worker_links(id) ON DELETE SET NULL'
    );
    expect(f).toContain('ALTER TABLE public.factory_workers ENABLE ROW LEVEL SECURITY;');
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.factory_workers FROM PUBLIC, anon, authenticated;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.factory_workers TO service_role;'
    );
    expect(f).toContain(
      'REVOKE DELETE, TRUNCATE ON TABLE public.factory_workers FROM service_role;'
    );
    // 화면이 직접 읽는 정책은 없다
    expect(S).not.toMatch(/CREATE POLICY/i);
    expect(S).not.toMatch(/GRANT [A-Z, ]+ ON TABLE public\.factory_workers TO authenticated/i);
  });

  test('기록의 작업자 칸 — 작업자가 지워지면 비운다', () => {
    expect(f).toContain(
      'ALTER TABLE public.production_worklogs ADD COLUMN IF NOT EXISTS worker_id uuid;'
    );
    expect(f).toContain(
      'ADD CONSTRAINT production_worklogs_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE SET NULL;'
    );
  });
});
