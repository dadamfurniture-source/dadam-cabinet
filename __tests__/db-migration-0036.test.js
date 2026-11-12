/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0036_ledger_statements.sql 정적 시험 (DB 없이).
 *
 *   거래명세표 모아 붙이기 — 거래처 고르기 · 모아 둠(held) · 붙이기(supporting) · 맞춰 보기 · 다름 · 세금계산서 없음 알림 ·
 *   줄 취소 → 다시 모아 둠 · 힌트(invoice_mode) · 붙인 명세표 단가 변동 — 모두 서버만.
 *   역할별 동작은 database/probes/0036-ledger-statements.json 이 실DB 트랜잭션에서 본다.
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
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const S = read('0036_ledger_statements.sql');
const f = flat(S);
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, ''));
const S33 = flat(read('0033_ledger_learning.sql'));

const FUNCTIONS = [
  ['ledger_supplier_mode', 'uuid, text, text'],
  ['ledger_doc_supplier', 'uuid'],
  ['ledger_set_supplier_mode', 'uuid, uuid, uuid, text, text'],
  ['ledger_hold_documents', 'uuid, uuid, uuid[]'],
  ['ledger_unhold_documents', 'uuid, uuid, uuid[]'],
  ['ledger_held_documents', 'uuid'],
  ['ledger_supplier_entries', 'uuid, text, text, integer'],
  ['ledger_statements_compare', 'uuid, uuid[]'],
  ['ledger_attach_statements', 'uuid, uuid, uuid[]'],
  ['ledger_invoice_missing_scan', 'date'],
  ['ledger_doc_posted', 'uuid'],
  ['ledger_doc_signals', 'uuid'],
  ['ledger_notices_scan', ''],
];

/** 함수 본문 */
function body(text, name) {
  const m = new RegExp(`FUNCTION public\\.${name}\\(.*?\\$function\\$(.*?)\\$function\\$`).exec(
    text
  );
  return m ? m[1] : null;
}

/** CHECK (x = ANY (ARRAY[...])) 안의 이름들 */
function listOf(text, constraint) {
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\((.*?)\\)\\s*;`).exec(text);
  return m ? [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]) : null;
}

describe('0036 — 거래명세표 모아 붙이기', () => {
  test('트랜잭션 문 · 지우기 · 정책이 없고, 새 표는 거래처 고르기 하나', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DROP FUNCTION|CREATE POLICY)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.ledger_supplier_modes',
    ]);
    expect(top.match(/CREATE OR REPLACE FUNCTION public\.\w+/g)).toEqual([
      ...FUNCTIONS.slice(0, 9).map(([n]) => `CREATE OR REPLACE FUNCTION public.${n}`),
      'CREATE OR REPLACE FUNCTION public.ledger_entry_void_release',
      ...FUNCTIONS.slice(9).map(([n]) => `CREATE OR REPLACE FUNCTION public.${n}`),
    ]);
    // 이미 있는 장부 핵심 함수는 그대로 (올리기 · 장부 · 고치기)
    expect(f).not.toMatch(
      /FUNCTION public\.(ledger_post_document|ledger_book|ledger_correct_entry|ledger_extract_\w+)\(/
    );
  });

  test('사진 상태에 held 를 더하고, 알림 종류에 둘을 더한다 (급함 규칙은 그대로 — 둘 다 아침 묶음)', () => {
    expect(listOf(top, 'ledger_documents_status_check')).toEqual([
      'pending',
      'posted',
      'returned',
      'rejected',
      'skipped_budget',
      'held',
    ]);
    expect(listOf(top, 'ledger_notices_kind_check')).toEqual([
      'duplicate',
      'large_amount',
      'new_supplier',
      'supplier_status',
      'price_change',
      'evidence_risk',
      'statement_mismatch',
      'invoice_missing',
    ]);
    // 0033 의 종류 여섯을 하나도 빼지 않는다
    const old = [
      .../CONSTRAINT ledger_notices_kind_check CHECK \((.*?)\)\s*,/
        .exec(S33)[1]
        .matchAll(/'([a-z_]+)'::text/g),
    ].map((x) => x[1]);
    for (const k of old) expect(listOf(top, 'ledger_notices_kind_check')).toContain(k);
    expect(top).not.toMatch(/ledger_notices_urgency_check/);
  });

  test('거래처 고르기 표 — 열쇠는 b+번호 또는 n+상호 열쇠, 둘 중 하나만 고름, 서버만', () => {
    expect(f).toContain(
      "CONSTRAINT ledger_supplier_modes_mode_check CHECK (mode = ANY (ARRAY['separate'::text, 'statement_only'::text]))"
    );
    expect(f).toContain(
      "CONSTRAINT ledger_supplier_modes_key_check CHECK (supplier_key = coalesce('b' || biz_no, 'n' || name_key))"
    );
    expect(f).toContain(
      'CONSTRAINT ledger_supplier_modes_pkey PRIMARY KEY (company_id, supplier_key)'
    );
    expect(f).toContain('ALTER TABLE public.ledger_supplier_modes ENABLE ROW LEVEL SECURITY;');
    expect(f).toContain(
      'REVOKE ALL ON TABLE public.ledger_supplier_modes FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.ledger_supplier_modes TO service_role;'
    );
    // 같은 거래처 규칙 · 다듬기는 0033 그대로 쓴다
    expect(body(f, 'ledger_supplier_mode')).toContain(
      'public.ledger_same_supplier(p_biz, p_name_key, m.biz_no, m.name_key)'
    );
    expect(body(f, 'ledger_doc_supplier')).toContain(
      "CASE WHEN x.checks->>'biz_no' = 'ok' THEN public.ledger_biz_key(x.result->>'supplier_biz_no') END"
    );
  });

  test('함수는 모두 서버만 (REVOKE 넷 · service_role EXECUTE), 트리거 함수는 아무도 못 부름', () => {
    for (const [n, args] of FUNCTIONS) {
      expect(f).toContain(
        `REVOKE ALL ON FUNCTION public.${n}(${args}) FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${n}(${args}) TO service_role;`);
    }
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.ledger_entry_void_release() FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.ledger_entry_void_release/);
    expect(f).not.toMatch(/TO (anon|authenticated)\b/);
  });

  test('고르기 — statement_only 면 그 거래처 held → pending, separate 면 후보만 (모아 두기는 사람이)', () => {
    const b = body(f, 'ledger_set_supplier_mode');
    expect(b).toContain(
      "IF p_mode = 'statement_only' THEN UPDATE public.ledger_documents d SET review_status = 'pending'"
    );
    expect(b).toContain("d2.review_status = 'held'");
    expect(b).toContain("d.review_status = 'pending' AND s.evidence_type = 'statement'");
    expect(b).not.toMatch(/review_status = 'held',/);
    expect(body(f, 'ledger_hold_documents')).toContain(
      "SET review_status = 'held', decided_by = p_actor, decided_at = now(), decision_reason = NULL WHERE d.company_id = p_company AND d.id = ANY (p_documents) AND d.review_status = 'pending';"
    );
    expect(body(f, 'ledger_unhold_documents')).toContain(
      "WHERE d.company_id = p_company AND d.id = ANY (p_documents) AND d.review_status = 'held';"
    );
  });

  test('맞춰 보기 — 공급가 합(같아야) · 아니면 합계(장 수만큼), 그 줄과 같은 업체 사진만, 쓰지 않는다', () => {
    const b = body(f, 'ledger_statements_compare');
    expect(f).toMatch(
      /FUNCTION public\.ledger_statements_compare\(p_entry uuid, p_documents uuid\[\]\) RETURNS jsonb LANGUAGE plpgsql STABLE/
    );
    expect(b).toContain(
      "IF v_supply_n = v_n AND v_e.vat_amount > 0 THEN v_basis := 'supply'; v_statements := v_supply; v_invoice := v_e.amount; v_tolerance := 0;"
    );
    expect(b).toContain(
      "ELSE v_basis := 'total'; v_statements := CASE WHEN v_total_n = v_n THEN v_total END; v_invoice := v_e.amount + v_e.vat_amount; v_tolerance := v_n;"
    );
    expect(b).toContain('abs(v_statements - v_invoice) <= v_tolerance');
    expect(b).toContain(
      'JOIN public.ledger_documents d ON d.id = u.id AND d.company_id = v_e.company_id'
    );
    expect(b).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  test('붙이기 — 모두 붙일 수 있을 때만(같은 업체 · held · pending), supporting 으로, 다르면 알림 하나', () => {
    const b = body(f, 'ledger_attach_statements');
    expect(b).toContain("d.company_id = v_e.company_id AND d.review_status IN ('held', 'pending')");
    expect(b).toContain("RETURN jsonb_build_object('ok', false, 'reason', 'not_attachable'");
    expect(b).toContain(
      "SELECT v_e.company_id, u, v_e.id, NULL, 'supporting', p_actor FROM unnest(v_ids) u;"
    );
    expect(b).toContain(
      "SET review_status = 'posted', decided_by = p_actor, decided_at = now(), decision_reason = NULL WHERE d.id = ANY (v_ids);"
    );
    expect(b).toContain(
      "IF v_cmp->>'match' = 'false' THEN INSERT INTO public.ledger_notices (company_id, kind, urgency, entry_id, data, dedupe_key) VALUES (v_e.company_id, 'statement_mismatch', 'digest'"
    );
    expect(b).toContain(
      "'stm:' || v_e.id || ':' || (v_cmp->>'n')) ON CONFLICT (company_id, dedupe_key) DO NOTHING;"
    );
    expect(b).toContain('cardinality(p_documents) NOT BETWEEN 1 AND 100');
  });

  test('줄 취소 — 커밋 때(고치기는 증빙을 새 줄로 옮긴 뒤) 남은 supporting 을 풀고 held 로', () => {
    expect(f).toContain(
      'CREATE CONSTRAINT TRIGGER trg_ledger_entries_void_release AFTER UPDATE ON public.ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_entry_void_release();'
    );
    const b = body(f, 'ledger_entry_void_release');
    expect(b).toContain('IF NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN');
    // 상태를 먼저 held 로 — 연결을 지울 때 ledger_evidence_released 가 pending 으로 돌리지 않게
    expect(b.indexOf("SET review_status = 'held'")).toBeLessThan(
      b.indexOf('DELETE FROM public.ledger_evidence')
    );
    expect(b).toContain(
      "DELETE FROM public.ledger_evidence ev WHERE ev.entry_id = NEW.id AND ev.role = 'supporting';"
    );
    expect(f).toMatch(
      /FUNCTION public\.ledger_entry_void_release\(\) RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''/
    );
  });

  test('세금계산서 없음 — 그 달(읽은 날짜 · 없으면 올린 날) 모아 둔 명세표, 거래처 · 달마다 하나', () => {
    const b = body(f, 'ledger_invoice_missing_scan');
    expect(b).toContain("v_from := date_trunc('month', p_month)::date;");
    expect(b).toContain("WHERE d.review_status = 'held'");
    expect(b).toContain(
      "coalesce(s.issue_date, (d.created_at AT TIME ZONE 'Asia/Seoul')::date) >= v_from"
    );
    expect(b).toContain("'inv:' || g.k || ':' || to_char(v_from, 'YYYY-MM')");
    expect(b).toContain("'invoice_missing', 'digest'");
    expect(b).toContain('ON CONFLICT (company_id, dedupe_key) DO NOTHING;');
  });

  test('힌트 · 훑기는 0033 본문 그대로 + 바꾼 곳만', () => {
    const s35 = body(f, 'ledger_doc_signals');
    const s33 = body(S33, 'ledger_doc_signals');
    expect(s35).toContain(
      'v_mode := public.ledger_supplier_mode(v_doc.company_id, v_biz, v_name);'
    );
    expect(s35).toContain(
      "'supplier_key', coalesce('b' || v_biz, 'n' || v_name), 'invoice_mode', v_mode,"
    );
    expect(s35).toContain(
      "'evidence_risk', coalesce(v_total > c_evidence_min AND v_ev IN ('simple_receipt', 'statement') AND NOT (v_ev = 'statement' AND v_mode IS NOT DISTINCT FROM 'separate'), false),"
    );
    const strip35 = s35
      .replace(' v_mode text;', '')
      .replace(' v_mode := public.ledger_supplier_mode(v_doc.company_id, v_biz, v_name);', '')
      .replace(
        " 'supplier_key', coalesce('b' || v_biz, 'n' || v_name), 'invoice_mode', v_mode,",
        ''
      )
      .replace(" AND NOT (v_ev = 'statement' AND v_mode IS NOT DISTINCT FROM 'separate')", '');
    expect(strip35).toBe(s33);

    const n35 = body(f, 'ledger_notices_scan');
    const n33 = body(S33, 'ledger_notices_scan');
    expect(n35.split("ev.role IN ('primary', 'supporting')").length - 1).toBe(1);
    expect(n35.split("e2.role IN ('primary', 'supporting')").length - 1).toBe(1);
    expect(
      n35
        .split("ev.role IN ('primary', 'supporting')")
        .join("ev.role = 'primary'")
        .split("e2.role IN ('primary', 'supporting')")
        .join("e2.role = 'primary'")
    ).toBe(n33);

    const p = body(f, 'ledger_doc_posted');
    expect(p.split("ev.role IN ('primary', 'supporting')").length - 1).toBe(2);
    expect(p).toContain('ORDER BY s.prim DESC LIMIT 1');
  });

  test('프로브 사진의 sha256 은 16진수 64자 (ledger_documents_sha_check)', () => {
    const probe = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'probes', '0036-ledger-statements.json'),
      'utf8'
    );
    const shas = [...probe.matchAll(/repeat\('(.)', (\d+)\)/g)];
    expect(shas.length).toBe(7);
    for (const [, ch, n] of shas) {
      expect(ch).toMatch(/^[0-9a-f]$/);
      expect(n).toBe('64');
    }
  });
});
