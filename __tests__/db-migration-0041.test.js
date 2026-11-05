/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0041_assistant_actions.sql 정적 시험 (DB 없이).
 *
 *   AI 비서 승인 카드 표(assistant_actions) — 종류 · 상태 · 지킴이 트리거 · 서버만 · 대화와 함께 지움 · 24시간 기한.
 *   두 번 실행 막기 키 — projects(업체) · order_payments · order_costs(수주) 안에서 하나. 기록 종류 action.
 *   역할별 동작은 database/probes/0041-assistant-actions.json 이 실DB 트랜잭션에서 본다.
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
const S = read('0041_assistant_actions.sql');
const f = flat(S);
const top = flat(S.replace(/\$function\$[\s\S]*?\$function\$/g, ''));
const guard = (() => {
  const m = /FUNCTION public\.assistant_actions_guard\(\).*?\$function\$(.*?)\$function\$/.exec(f);
  return m ? m[1] : '';
})();

describe('0041 — 승인 카드 · 두 번 실행 막기 키', () => {
  test('트랜잭션 문 · 지우기 · 정책 · 행 바꾸기가 없다, 새 표는 하나', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DROP FUNCTION|CREATE POLICY)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.assistant_actions',
    ]);
  });

  test('카드 종류 — 정한 여덟 + 초안, 문서 발행은 없다', () => {
    const m = /assistant_actions_kind_check CHECK \(kind = ANY \(ARRAY\[(.*?)\]\)\)/.exec(top);
    expect([...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1])).toEqual([
      'consult_accept',
      'consult_decline',
      'order_status',
      'ledger_post',
      'project_create',
      'design_link',
      'payment_received',
      'cost_add',
      'draft',
    ]);
    expect(top).not.toMatch(/document/);
  });

  test('상태 — 정한 여덟, 초안은 늘 draft, 기한 기본 24시간', () => {
    const m = /assistant_actions_state_check CHECK \(state = ANY \(ARRAY\[(.*?)\]\)\)/.exec(top);
    expect([...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1])).toEqual([
      'proposed',
      'running',
      'done',
      'failed',
      'unknown',
      'rejected',
      'expired',
      'draft',
    ]);
    expect(top).toContain(
      "CONSTRAINT assistant_actions_draft_check CHECK ((kind = 'draft'::text) = (state = 'draft'::text))"
    );
    expect(top).toContain(
      "expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL"
    );
  });

  test('지킴이 — 만든 칸은 그대로, proposed → running · rejected · expired, running → done · failed · unknown 만', () => {
    for (const col of [
      'id',
      'company_id',
      'conversation_id',
      'user_id',
      'kind',
      'params',
      'expect',
      'card',
      'created_at',
      'expires_at',
    ])
      expect(guard).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`);
    expect(guard).toContain(
      "IF NOT ((OLD.state = 'proposed' AND NEW.state IN ('running', 'rejected', 'expired')) OR (OLD.state = 'running' AND NEW.state IN ('done', 'failed', 'unknown'))) THEN"
    );
    expect(guard).toContain('NEW.decided_at := now();');
    expect(guard).toContain('NEW.finished_at := now();');
    expect(top).toContain(
      'CREATE TRIGGER trg_assistant_actions_guard BEFORE UPDATE ON public.assistant_actions FOR EACH ROW EXECUTE FUNCTION public.assistant_actions_guard();'
    );
  });

  test('서버만 — RLS 켬 · 정책 없음 · service_role 읽기 · 넣기 · 고치기만, 대화 · 계정과 함께 지움', () => {
    expect(top).toContain('ALTER TABLE public.assistant_actions ENABLE ROW LEVEL SECURITY;');
    expect(top).toContain(
      'REVOKE ALL ON TABLE public.assistant_actions FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(top).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.assistant_actions TO service_role;'
    );
    expect(top).not.toMatch(/TO (anon|authenticated)\b/);
    expect(top).toContain('REFERENCES public.assistant_conversations(id) ON DELETE CASCADE');
    expect(top).toContain('REFERENCES auth.users(id) ON DELETE CASCADE');
  });

  test('두 번 실행 막기 키 — 프로젝트는 업체, 수금 · 원가는 수주 안에서 하나 (ledger_entries 와 같은 모양)', () => {
    for (const t of ['projects', 'order_payments', 'order_costs']) {
      expect(top).toContain(
        `ALTER TABLE public.${t} ADD COLUMN IF NOT EXISTS idempotency_key text;`
      );
      expect(top).toContain(
        `CHECK ((idempotency_key IS NULL) OR (length(idempotency_key) BETWEEN 1 AND 200))`
      );
    }
    expect(top).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS projects_company_idem ON public.projects USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);'
    );
    expect(top).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS order_payments_order_idem ON public.order_payments USING btree (order_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);'
    );
    expect(top).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS order_costs_order_idem ON public.order_costs USING btree (order_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);'
    );
  });

  test('기록 종류 — 0026 다섯 + action', () => {
    const m = /assistant_audit_kind_check CHECK \(kind = ANY \(ARRAY\[(.*?)\]\)\)/.exec(top);
    expect([...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1])).toEqual([
      'turn',
      'tool',
      'blocked',
      'error',
      'setting',
      'action',
    ]);
  });

  test('프로브 협력업체는 등급이 있다 (companies_partner_plan_check)', () => {
    const probe = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'database', 'probes', '0041-assistant-actions.json'),
        'utf8'
      )
    );
    const rows = probe.setup
      .join('\n')
      .matchAll(/\(\{\{(company_\w+)\}\}, '(\w+)', '[^']*', ([^,]+), '(\w+)'\)/g);
    expect([...rows].map(([, id, kind, plan, status]) => [id, kind, plan, status])).toEqual([
      ['company_x', 'partner', "'agent'", 'active'],
      ['company_y', 'partner', "'expert'", 'active'],
    ]);
  });
});
