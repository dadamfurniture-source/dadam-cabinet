/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0073_band_stock.sql 정적 시험 (DB 없이).
 *
 *   밴드 재고 (2026-11-19 사장님 「빼기는 밴드 재고 운영, 60*2440의 밴드를 18개 기본 재고로 만들고 8개가 남으면 새로운 밴드재고 만들기로 요청」)
 *   — stock_items 에 밴드 품목(kind band · band_color), stock_band_requests 와 함수 셋(요청 · 만들었음 · 취소), 알림 종류 하나.
 *   값은 database/probes/0073-band-stock.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const flat = (s) =>
  s
    .split('\r\n')
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/^\s*--.*$/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
const f = flat(read('database', 'migrations', '0073_band_stock.sql'));
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
const FUNCS = [
  'stock_band_request(uuid, uuid, numeric, uuid)',
  'stock_band_make(uuid, uuid, uuid, uuid)',
  'stock_band_cancel(uuid, uuid, uuid)',
];
const kindsIn = (s) => [...s.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]);

describe('0073 — 밴드 재고', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기가 없다, 새 표는 하나', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.stock_band_requests',
    ]);
  });

  test('밴드 품목 — 종류 셋 · 색 칸은 밴드 품목에만 · 업체 · 색마다 하나', () => {
    expect(f).toContain(
      "ADD CONSTRAINT stock_items_kind_check CHECK (kind = ANY (ARRAY['board'::text, 'hardware'::text, 'band'::text]));"
    );
    expect(f).toContain('ALTER TABLE public.stock_items ADD COLUMN IF NOT EXISTS band_color text;');
    expect(f).toContain(
      "CHECK (((kind = 'band'::text) = (band_color IS NOT NULL)) AND (COALESCE(length(band_color), 0) <= 40))"
    );
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_items_band_color ON public.stock_items USING btree (company_id, band_color) WHERE (kind = 'band'::text);"
    );
  });

  test('요청 표 — 서버만 · 지우지 못함 · 번호는 업체마다 · 상태 셋 · 열린 요청은 품목마다 하나', () => {
    expect(f).not.toContain('CREATE POLICY');
    expect(f).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    expect(f).toContain('ALTER TABLE public.stock_band_requests ENABLE ROW LEVEL SECURITY;');
    expect(f).toContain('REVOKE ALL ON TABLE public.stock_band_requests FROM PUBLIC, anon, authenticated;');
    expect(f).toContain('REVOKE DELETE, TRUNCATE ON TABLE public.stock_band_requests FROM service_role;');
    expect(f).toContain('CONSTRAINT stock_band_requests_seq_key UNIQUE (company_id, seq)');
    expect(f).toContain(
      "CHECK (state = ANY (ARRAY['requested'::text, 'made'::text, 'cancelled'::text]))"
    );
    expect(f).toContain("CHECK ((state = 'requested'::text) = (closed_at IS NULL))");
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_band_requests_open ON public.stock_band_requests USING btree (item_id) WHERE (state = 'requested'::text);"
    );
    expect(f).toContain(
      'FOREIGN KEY (item_id, company_id) REFERENCES public.stock_items(id, company_id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      'FOREIGN KEY (sheet_item_id, company_id) REFERENCES public.stock_items(id, company_id) ON DELETE RESTRICT'
    );
  });

  test('함수 셋 — search_path 비움 · 정의자 권한 아님 · 서버만 부른다', () => {
    expect(f.match(/SET search_path TO ''/g)).toHaveLength(3);
    expect(f).not.toContain('SECURITY DEFINER');
    for (const fn of FUNCS) {
      expect(f).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`);
      expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
  });

  test('요청 — 쓰는 밴드 품목만 · 열린 요청이면 그것 · 업체마다 잠그고 번호 · 입고 예정을 늘린다', () => {
    expect(f).toContain(
      "PERFORM 1 FROM public.stock_items WHERE id = p_item AND company_id = p_company AND kind = 'band' AND active FOR UPDATE;"
    );
    expect(f).toMatch(/WHERE item_id = p_item AND state = 'requested'; IF FOUND THEN RETURN v_row;/);
    expect(f).toContain(
      "pg_advisory_xact_lock(pg_catalog.hashtextextended('stock_band_requests:' || p_company::text, 0))"
    );
    expect(f).toContain(
      'SET expected_qty = COALESCE(expected_qty, 0) + p_qty, expected_on = COALESCE(expected_on, current_date)'
    );
  });

  test('만들었음 · 취소 — 요청을 잠그고 끝난 것은 거절, 만들었음은 밴드 입고 + 원장 1장 출고(원장 품목만)', () => {
    expect(f.match(/WHERE id = p_request AND company_id = p_company FOR UPDATE/g)).toHaveLength(2);
    expect(f.match(/IF v_row\.state <> 'requested' THEN/g)).toHaveLength(2);
    expect(f).toContain("v_ref := 'BM-' || lpad(v_row.seq::text, 4, '0');");
    expect(f).toContain(
      "PERFORM public.stock_move(p_company, v_row.item_id, 'in', v_row.qty, v_ref, '밴드 만들기', p_actor);"
    );
    expect(f).toContain("AND kind = 'board';");
    expect(f).toContain(
      "PERFORM public.stock_move(p_company, p_sheet_item, 'out', 1, v_ref, '밴드 만들기', p_actor);"
    );
    expect(f).toContain('PERFORM public.stock_expected_take(p_company, v_row.item_id, v_row.qty);');
    expect(f).toContain("SET state = 'made', sheet_item_id = p_sheet_item, closed_at = now(), closed_by = p_actor");
    expect(f).toContain("SET state = 'cancelled', closed_at = now(), closed_by = p_actor");
  });

  test('알림 종류 — 0067 목록 그대로 + 맨 끝 stock_band_low (그 사이 번호는 목록을 바꾸지 않았다)', () => {
    const prev = read('database', 'migrations', '0067_planner_learning.sql');
    const before = kindsIn(/notification_outbox_kind_check CHECK \(([^;]+)\);/.exec(prev)[1]);
    const after = kindsIn(/notification_outbox_kind_check CHECK \(([^;]+)\);/.exec(f)[1]);
    expect(before).toHaveLength(24);
    expect(after).toEqual([...before, 'stock_band_low']);
    for (const n of ['0068_work_sheet_docs.sql', '0069_planner_genome_panel.sql', '0070_price_lists.sql', '0071_part_catalog.sql', '0072_work_orderless_render_kinds.sql']) {
      expect(read('database', 'migrations', n)).not.toContain('notification_outbox_kind_check');
    }
  });

  test('프로브 — 읽기 · 요청 · 만들었음 · 취소 · 거절 · 알림', () => {
    const probe = JSON.parse(read('database', 'probes', '0073-band-stock.json'));
    expect(probe.checks.length).toBe(24);
    expect(probe.title).toMatch(/0073 밴드 재고/);
    expect(probe.setup.join('\n')).toMatch(/stock_band_make\([\s\S]*stock_band_cancel\(/);
  });
});
