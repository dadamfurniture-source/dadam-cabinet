/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0033_ledger_learning.sql 정적 시험 (DB 없이).
 *
 *   장부 사진 확인 힌트(거래처 기억은 올린 줄에서 그때그때) · 장부 알림 표 · 알림 훑기 · 잡기 · 국세청 기록 ·
 *   앱 알림 종류 ledger_notice — 모두 서버만.
 *   역할별 동작은 database/probes/0033-ledger-learning.json 이 실DB 트랜잭션에서 본다.
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
const S = read('0033_ledger_learning.sql');
const f = flat(S);
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, ''));

const FUNCTIONS = [
  ['ledger_biz_key', 'text'],
  ['ledger_name_key', 'text'],
  ['ledger_same_supplier', 'text, text, text, text'],
  ['ledger_try_date', 'text'],
  ['ledger_supplier_history', 'uuid'],
  ['ledger_doc_posted', 'uuid'],
  ['ledger_doc_items', 'uuid'],
  ['ledger_doc_signals', 'uuid'],
  ['ledger_review_hints', 'uuid, uuid[]'],
  ['ledger_notices_scan', ''],
  ['ledger_notices_claim', 'text, integer'],
  ['ledger_nts_due', 'integer, integer'],
  ['ledger_nts_record', 'jsonb'],
];

/** 함수 본문 */
function body(name) {
  const m = new RegExp(`FUNCTION public\\.${name}\\(.*?\\$function\\$(.*?)\\$function\\$`).exec(f);
  return m ? m[1] : null;
}

/** CHECK (kind = ANY (ARRAY[...])) 안의 이름들 */
function kindsOf(text, constraint) {
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\((.*?)\\)\\s*[,;]`).exec(flat(text));
  return m ? [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]) : null;
}

describe('0033 — 장부 사진 확인 · 거래처 기억 · 장부 알림', () => {
  test('트랜잭션 문 · 지우기가 없고, 맨 위에서 넣는 행은 알림 커서 처음 값뿐', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DROP FUNCTION|CREATE POLICY)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(top.match(/(^|; )\s*INSERT INTO [^;]*;/g)).toEqual([
      "; INSERT INTO public.ledger_notice_cursor (kind, at) VALUES ('read', now()), ('post', now()) ON CONFLICT (kind) DO NOTHING;",
    ]);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.ledger_notices',
      'CREATE TABLE IF NOT EXISTS public.ledger_notice_cursor',
    ]);
    expect(top.match(/CREATE OR REPLACE FUNCTION public\.\w+/g)).toEqual([
      ...FUNCTIONS.slice(0, 9).map(([n]) => `CREATE OR REPLACE FUNCTION public.${n}`),
      'CREATE OR REPLACE FUNCTION public.ledger_notices_guard',
      ...FUNCTIONS.slice(9).map(([n]) => `CREATE OR REPLACE FUNCTION public.${n}`),
    ]);
    // 이미 있는 장부 표 · 함수는 건드리지 않는다
    expect(top).not.toMatch(
      /ALTER TABLE public\.(ledger_(?!notice)\w+|counterparties|order_costs)/
    );
    expect(f).not.toMatch(
      /FUNCTION public\.(ledger_post_document|ledger_book|ledger_extract_\w+)\(/
    );
    expect(f).not.toMatch(/SECURITY DEFINER/i);
  });

  test('다듬기 — 국세청 검증 숫자(1,3,7,1,3,7,1,3,5 + 9번째×5/10), 10자리일 때만 숫자로 · 상호 다듬기', () => {
    const b = body('ledger_biz_key');
    const weights = [...b.matchAll(/substr\(s\.d, (\d), 1\)::int \* (\d)/g)].map((m) => [
      +m[1],
      +m[2],
    ]);
    expect(weights).toEqual([
      [1, 1],
      [2, 3],
      [3, 7],
      [4, 1],
      [5, 3],
      [6, 7],
      [7, 1],
      [8, 3],
      [9, 5],
      [9, 5],
    ]);
    expect(b).toContain('% 10)) % 10 = substr(s.d, 10, 1)::int');
    // AND 는 차례를 지키지 않으니 CASE 안의 CASE 로
    expect(b).toMatch(/CASE WHEN s\.d ~ '\^\[0-9\]\{10\}\$' THEN CASE WHEN/);
    expect(body('ledger_name_key')).toContain(
      "regexp_replace(regexp_replace(lower(coalesce(p, '')), '주식회사|\\(주\\)|㈜', '', 'g'), '[^0-9a-z가-힣]', '', 'g')"
    );
    expect(body('ledger_same_supplier')).toContain(
      'CASE WHEN a_biz IS NOT NULL AND b_biz IS NOT NULL THEN a_biz = b_biz ELSE coalesce(a_name IS NOT NULL AND a_name = b_name, false) END'
    );
    for (const n of [
      'ledger_biz_key',
      'ledger_name_key',
      'ledger_same_supplier',
      'ledger_try_date',
    ])
      expect(f).toMatch(new RegExp(`FUNCTION public\\.${n}\\([^$]*?IMMUTABLE`));
  });

  test('거래처 기억 — 올린 값(취소 안 한 지출 · 자산 줄, 수주 원가)에서, 사진 쪽 번호는 검사 ok 일 때만', () => {
    const h = body('ledger_supplier_history');
    expect(h).toContain(
      "WHERE e.company_id = p_company AND e.voided_at IS NULL AND e.direction IN ('expense', 'asset_buy')"
    );
    expect(h).toContain('JOIN public.orders o ON o.id = c.order_id');
    expect(h).toContain('e.amount + e.vat_amount');
    const s = body('ledger_doc_signals');
    expect(s).toContain(
      "v_biz := CASE WHEN v_x.checks->>'biz_no' = 'ok' THEN public.ledger_biz_key(v_x.result->>'supplier_biz_no') END;"
    );
    expect(s).toContain('AND s.document_id IS DISTINCT FROM p_document');
    // 정해 둔 값
    for (const c of [
      'c_trust_posts constant integer := 3;',
      'c_large_min constant integer := 3;',
      'c_large_window constant integer := 6;',
      'c_large_ratio constant numeric := 2;',
      'c_evidence_min constant bigint := 30000;',
    ])
      expect(s).toContain(c);
    expect(s).toContain('WHERE t.ord <= c_trust_posts');
    expect(s).toContain('v_total > c_large_ratio * v_median');
    expect(s).toContain("v_ev IN ('simple_receipt', 'statement')");
    // 중복은 확인 기다림 · 올린 사진만 (돌려보냄 · 버림은 아니다)
    expect(s).toContain("d2.review_status IN ('pending', 'posted')");
    expect(body('ledger_review_hints')).toContain('cardinality(p_documents) > 100');
    expect(body('ledger_review_hints')).toContain(
      'WHERE d.company_id = p_company AND d.id = ANY (p_documents)'
    );
  });

  test('알림 표 — 종류 여섯, 급함은 종류로, 지우기 막음 · pushed_at · seen_at 만 한 번', () => {
    expect(kindsOf(S, 'ledger_notices_kind_check')).toEqual([
      'duplicate',
      'large_amount',
      'new_supplier',
      'supplier_status',
      'price_change',
      'evidence_risk',
    ]);
    expect(f).toContain(
      "CONSTRAINT ledger_notices_urgency_check CHECK (urgency = (CASE WHEN kind = ANY (ARRAY['duplicate'::text, 'large_amount'::text]) THEN 'now'::text ELSE 'digest'::text END))"
    );
    expect(f).toContain('CONSTRAINT ledger_notices_dedupe_key UNIQUE (company_id, dedupe_key)');
    // 원가 줄은 지우고 다시 쓰이므로 FK 를 두지 않는다
    expect(f).not.toMatch(/ledger_notices_cost_id_fkey/);
    const g = body('ledger_notices_guard');
    expect(g).toContain("IF TG_OP = 'DELETE' THEN RAISE EXCEPTION");
    expect(g).toContain(
      'IF OLD.pushed_at IS NOT NULL AND NEW.pushed_at IS DISTINCT FROM OLD.pushed_at THEN'
    );
    expect(g).toContain(
      'IF OLD.seen_at IS NOT NULL AND (NEW.seen_at, NEW.seen_by) IS DISTINCT FROM (OLD.seen_at, OLD.seen_by) THEN'
    );
    expect(f).toContain(
      'CREATE TRIGGER trg_ledger_notices_guard BEFORE UPDATE OR DELETE ON public.ledger_notices FOR EACH ROW EXECUTE FUNCTION public.ledger_notices_guard();'
    );
  });

  test('알림 훑기 — 1분 늦게, 첫 읽음만, 같은 알림은 하나, 커서는 같은 트랜잭션에서', () => {
    const b = body('ledger_notices_scan');
    expect(b).toContain("v_until timestamp with time zone := now() - interval '1 minute';");
    expect(b).toContain("FROM public.ledger_notice_cursor c WHERE c.kind = 'read' FOR UPDATE;");
    expect(b).toContain(
      "AND NOT EXISTS (SELECT 1 FROM public.ledger_extractions y WHERE y.document_id = x.document_id AND y.status = 'done' AND y.attempt < x.attempt)"
    );
    expect(b).toContain(
      "WHERE d.review_status = 'posted' AND d.decided_at > v_post AND d.decided_at <= v_until"
    );
    expect(b).toContain(
      "JOIN public.ledger_evidence ev ON ev.document_id = d.id AND ev.role = 'primary'"
    );
    const inserts = b.match(/INSERT INTO public\.ledger_notices[\s\S]*?;/g);
    expect(inserts).toHaveLength(6);
    for (const i of inserts) expect(i).toContain('ON CONFLICT (company_id, dedupe_key) DO NOTHING');
    expect(b).toContain(
      "UPDATE public.ledger_notice_cursor c SET at = v_read_to WHERE c.kind = 'read';"
    );
    expect(b).toContain(
      "UPDATE public.ledger_notice_cursor c SET at = v_post_to WHERE c.kind = 'post';"
    );
    // 증빙 경고는 올린 값으로 (증빙 없음 포함)
    expect(b).toContain("e.evidence_type IN ('simple_receipt', 'statement', 'none')");
    // 단가는 품목 합 검사 ok 인 사진끼리 (ledger_doc_items)
    expect(body('ledger_doc_items')).toContain("WHERE lx.checks->>'items' = 'ok'");
    const c = body('ledger_notices_claim');
    expect(c).toContain('FOR UPDATE SKIP LOCKED');
    expect(c).toContain('UPDATE public.ledger_notices n SET pushed_at = now()');
  });

  test('국세청 기록 — 휴업 · 폐업(처음 조회 포함) · 과세 유형이 바뀌면 그 번호를 쓴 업체에 알림', () => {
    const b = body('ledger_nts_record');
    expect(b).toContain(
      'IF public.ledger_biz_key(v_biz) IS DISTINCT FROM v_biz THEN RAISE EXCEPTION'
    );
    expect(b).toContain(
      "IF (v_status IN ('suspended', 'closed') AND (NOT v_had OR v_old.status IS DISTINCT FROM v_status)) OR (v_had AND v_old.tax_type IS NOT NULL AND v_tax IS NOT NULL AND v_old.tax_type <> v_tax) THEN"
    );
    expect(b).toContain('UPDATE public.counterparties cp SET nts_status = v_status');
    expect(body('ledger_nts_due')).toContain(
      'AND (s.biz_no IS NULL OR s.checked_at < now() - make_interval(days => p_stale_days))'
    );
  });

  test('plpgsql IF 조건 안에 CASE 를 두지 않는다 (조건을 첫 THEN 까지로 읽는다)', () => {
    for (const n of [
      'ledger_doc_signals',
      'ledger_notices_scan',
      'ledger_nts_record',
      'ledger_notices_claim',
    ]) {
      const conds = [...body(n).matchAll(/(?<!END )\bIF\b(.*?)\bTHEN\b/g)].map((m) => m[1]);
      expect(conds.length).toBeGreaterThan(0);
      for (const c of conds) expect(c).not.toMatch(/\bCASE\b/);
    }
  });

  test('앱 알림 종류 — 0030 목록 그대로 + ledger_notice', () => {
    const before = kindsOf(
      read('0030_push_ledger_assistant.sql'),
      'notification_outbox_kind_check'
    );
    expect(f).toContain('DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;');
    expect(kindsOf(S, 'notification_outbox_kind_check')).toEqual([...before, 'ledger_notice']);
    // 서버가 넣는 종류(push/messages.js)는 이 목록에 있거나, 뒤 번호(0045 as_request · 0050 제작 의뢰 셋 · 0053 제작 의뢰 거둠 · 0064 팩토리용 작업자 알림 셋)에서 더한 것이다 (db-migration-0045 · 0050 · 0053 · 0064 시험이 본다)
    const msg = fs.readFileSync(
      path.join(__dirname, '..', 'workers', 'workflow-api', 'src', 'push', 'messages.js'),
      'utf8'
    );
    const names = [
      .../NOTIFICATION_KINDS = Object\.freeze\(\[([\s\S]*?)\]\)/
        .exec(msg)[1]
        .matchAll(/'([a-z_]+)'/g),
    ].map((x) => x[1]);
    const all = kindsOf(S, 'notification_outbox_kind_check');
    expect(names.filter((k) => !all.includes(k))).toEqual(['as_request', 'production_recommended', 'production_offered', 'production_answered', 'production_cancelled', 'work_link_request', 'work_reply', 'work_report']);
    expect(names).toContain('ledger_notice');
  });

  test('권한 — RLS 켬 · 정책 없음, 표 · 함수 모두 서버만', () => {
    for (const t of ['ledger_notices', 'ledger_notice_cursor'])
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.ledger_notices TO service_role;'
    );
    expect(f).toContain(
      'GRANT SELECT, UPDATE ON TABLE public.ledger_notice_cursor TO service_role;'
    );
    expect(top).not.toMatch(/GRANT [^;]*\bTO (anon|authenticated|PUBLIC)\b/i);
    for (const [n, args] of FUNCTIONS) {
      expect(f).toContain(
        `REVOKE ALL ON FUNCTION public.${n}(${args}) FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${n}(${args}) TO service_role;`);
    }
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.ledger_notices_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
  });
});
