/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0029_ledger_extract.sql 정적 시험 (DB 없이).
 *
 *   사진 읽기 시도(ledger_extractions) · 고친 칸(ledger_extraction_feedback) · 국세청 사업자 상태 캐시(nts_business_status)
 *   — 모두 서버만. 시도는 running 으로 시작하고 끝나면 고치지 않고 지우지 않는다(트리거). 읽기 시작 · 다시 걸 사진 함수.
 *   역할별 동작은 database/probes/0029-ledger-extract.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const raw = fs
  .readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '0029_ledger_extract.sql'),
    'utf8'
  )
  .split('\r\n')
  .join('\n');
const S = raw
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const f = flat(S);
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, ''));

const TABLES = ['ledger_extractions', 'ledger_extraction_feedback', 'nts_business_status'];

/** CREATE TABLE … ( … ); 의 칸 이름 */
function columnsOf(table) {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\((.*?)\\);`).exec(f);
  return m
    ? m[1]
        .split(/,\s*(?![^()]*\))/)
        .map((s) => s.trim().split(' ')[0])
        .filter((c) => c && c !== 'CONSTRAINT')
    : null;
}

/** CHECK 안의 '이름'::text 들 */
function namesOf(constraint) {
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\((.*?)\\)\\s*[,;]`).exec(f);
  return m ? [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]) : null;
}

/** 함수 본문 */
function body(name) {
  const m = new RegExp(`FUNCTION public\\.${name}\\(.*?\\$function\\$(.*?)\\$function\\$`).exec(f);
  return m ? m[1] : null;
}

describe('0029 — 사진 읽기', () => {
  test('트랜잭션 문 · 지우기가 없고, 맨 위에서 행을 쓰지 않는다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(flat(S.replace(/REVOKE[^;]*;/gi, ''))).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|TRUNCATE)\b/i
    );
    expect(top).not.toMatch(/(^|; )\s*(INSERT|UPDATE|DELETE)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual(
      TABLES.map((t) => `CREATE TABLE IF NOT EXISTS public.${t}`)
    );
    expect(top.match(/CREATE OR REPLACE FUNCTION public\.\w+/g)).toEqual([
      'CREATE OR REPLACE FUNCTION public.ledger_extractions_guard',
      'CREATE OR REPLACE FUNCTION public.ledger_extract_begin',
      'CREATE OR REPLACE FUNCTION public.ledger_extract_due',
    ]);
    // 이미 있는 표 · 함수는 건드리지 않는다
    expect(top).not.toMatch(/ALTER TABLE public\.(ledger_documents|ledger_entries|counterparties)/);
    expect(top).not.toMatch(/FUNCTION public\.(ledger_post_document|company_entitled)\b/);
  });

  test('읽기 시도 칸 — 카드번호 · 고객 · 주소 · 전화 칸이 없다', () => {
    expect(columnsOf('ledger_extractions')).toEqual([
      'id',
      'document_id',
      'company_id',
      'attempt',
      'status',
      'model',
      'schema_version',
      'result',
      'checks',
      'usage',
      'cost_micros',
      'error',
      'started_at',
      'finished_at',
    ]);
    expect(namesOf('ledger_extractions_status_check')).toEqual([
      'running',
      'done',
      'failed',
      'refused',
      'skipped_budget',
    ]);
    expect(f).toContain(
      'CONSTRAINT ledger_extractions_attempt_check CHECK (attempt BETWEEN 1 AND 5)'
    );
    expect(f).toContain(
      "CONSTRAINT ledger_extractions_finished_check CHECK ((status = 'running'::text) = (finished_at IS NULL))"
    );
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS ledger_extractions_one_running ON public.ledger_extractions USING btree (document_id) WHERE (status = 'running'::text);"
    );
  });

  test('시도 트리거 — 지우기 막음 · running 으로만 넣음 · 끝난 시도 고정 · 끝난 때 적기', () => {
    const g = body('ledger_extractions_guard');
    expect(g).toContain("IF TG_OP = 'DELETE' THEN RAISE EXCEPTION");
    expect(g).toContain(
      "IF NEW.status <> 'running' OR NEW.finished_at IS NOT NULL THEN RAISE EXCEPTION"
    );
    expect(g).toContain(
      '(NEW.id, NEW.document_id, NEW.company_id, NEW.attempt, NEW.started_at) IS DISTINCT FROM (OLD.id, OLD.document_id, OLD.company_id, OLD.attempt, OLD.started_at)'
    );
    expect(g).toContain("IF OLD.status <> 'running' THEN RAISE EXCEPTION");
    expect(g).toContain(
      "IF NEW.status <> 'running' AND NEW.finished_at IS NULL THEN NEW.finished_at := now();"
    );
    expect(f).toContain(
      'CREATE TRIGGER trg_ledger_extractions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ledger_extractions FOR EACH ROW EXECUTE FUNCTION public.ledger_extractions_guard();'
    );
  });

  test('고친 칸 · 사업자 상태', () => {
    expect(columnsOf('ledger_extraction_feedback')).toEqual([
      'id',
      'company_id',
      'document_id',
      'extraction_id',
      'target',
      'fields',
      'changed_count',
      'created_by',
      'created_at',
    ]);
    expect(f).toContain('CONSTRAINT ledger_extraction_feedback_document_key UNIQUE (document_id)');
    expect(namesOf('ledger_extraction_feedback_target_check')).toEqual([
      'entry',
      'order_cost',
      'attach',
    ]);
    expect(columnsOf('nts_business_status')).toEqual([
      'biz_no',
      'status',
      'tax_type',
      'closed_on',
      'checked_at',
    ]);
    // counterparties.nts_status (0027) 와 같은 네 가지
    expect(namesOf('nts_business_status_status_check')).toEqual([
      'active',
      'suspended',
      'closed',
      'unregistered',
    ]);
    expect(f).toContain("CONSTRAINT nts_business_status_biz_check CHECK (biz_no ~ '^[0-9]{10}$')");
  });

  test('읽기 시작 — 사진 줄을 잠그고 확인 기다리는 사진만, 도는 것 · 읽은 것 · 거절 · 한도 · 최대 시도는 막는다', () => {
    const b = body('ledger_extract_begin');
    expect(b).toContain('FROM public.ledger_documents d WHERE d.id = p_document FOR UPDATE;');
    expect(b).toContain(
      "IF v_doc.review_status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_pending'"
    );
    expect(b).toContain("IF v_last.status = 'running' THEN");
    expect(b).toContain("IF v_last.status = 'done' THEN");
    expect(b).toContain(
      "IF v_last.status IN ('refused', 'skipped_budget') AND NOT coalesce(p_again, false) THEN"
    );
    expect(b).toContain(
      'v_cap := CASE WHEN coalesce(p_again, false) THEN 5 ELSE p_max_attempts END;'
    );
    expect(b).toContain("VALUES (v_doc.id, v_doc.company_id, v_attempt, 'running')");
    // IF 조건 안에 CASE … THEN 을 두지 않는다 (plpgsql 이 조건을 첫 THEN 까지로 읽는다)
    const conds = [...b.matchAll(/(?<!END )\bIF\b(.*?)\bTHEN\b/g)].map((m) => m[1]);
    expect(conds.length).toBeGreaterThan(5);
    for (const c of conds) expect(c).not.toMatch(/\bCASE\b/);
  });

  test('다시 걸 사진 — 멈춘 시도를 failed(stuck)로 닫고, 시도 없음 · 실패(최대 아래)만, 오래된 것부터', () => {
    const b = body('ledger_extract_due');
    expect(b).toContain(
      "UPDATE public.ledger_extractions x SET status = 'failed', error = 'stuck' WHERE x.status = 'running' AND x.started_at < now() - make_interval(secs => p_stuck_sec);"
    );
    expect(b).toContain("WHERE d.review_status = 'pending'");
    expect(b).toContain(
      "AND (lx.status IS NULL OR (lx.status = 'failed' AND lx.attempt < p_max_attempts))"
    );
    expect(b).toContain('ORDER BY d.created_at LIMIT p_limit;');
  });

  test('권한 — RLS 켬 · 정책 없음, 서버만 (시도는 지우기 없음 · 고친 칸은 넣기만)', () => {
    expect(top).not.toMatch(/CREATE POLICY/i);
    for (const t of TABLES)
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.ledger_extractions TO service_role;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT ON TABLE public.ledger_extraction_feedback TO service_role;'
    );
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.nts_business_status TO service_role;'
    );
    expect(top).not.toMatch(/GRANT [^;]*\bTO (anon|authenticated|PUBLIC)\b/i);
    for (const fn of [
      'ledger_extract_begin(uuid, integer, boolean)',
      'ledger_extract_due(integer, integer, integer, integer)',
    ]) {
      expect(f).toContain(
        `REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.ledger_extractions_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
  });
});
