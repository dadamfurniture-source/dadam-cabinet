/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0045_as_requests.sql 정적 시험 (DB 없이).
 *
 *   2026-11-06 사장님 결정 (A/S 접수 묶음 — 앱 → 본사 기록 → 그 수주 팩토리 담당자(없으면 대표 · 실장), 48시간 늦으면 본사 알림,
 *   앱 상담으로 시작한 수주만): as_requests · 지킴이 · 읽기 정책 둘(고객 · 팩토리 구성원) · 비공개 사진 버킷.
 *   값은 database/probes/0045-as-requests.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '0045_as_requests.sql'), 'utf8')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');

describe('0045 — 고객 A/S 접수', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기가 없다, 새 표는 하나', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual(['CREATE TABLE IF NOT EXISTS public.as_requests']);
  });

  test('상태 넷 · 간 곳 셋(담당자 · 대표 · 실장 · 연계 MANAGER) · 담당자 칸은 간 곳과 같이 · 내용 1~1000자 · 사진 5장', () => {
    expect(f).toContain("CHECK (state = ANY (ARRAY['requested'::text, 'received'::text, 'done'::text, 'cancelled'::text]))");
    expect(f).toContain("CHECK (route = ANY (ARRAY['assignee'::text, 'owners'::text, 'manager'::text]))");
    expect(f).toContain("CHECK ((route = 'assignee'::text) = (assignee_id IS NOT NULL))");
    expect(f).toContain('CHECK (length(btrim(body)) BETWEEN 1 AND 1000)');
    expect(f).toContain('jsonb_array_length(photos) <= 5');
    expect(f).toContain('FOREIGN KEY (order_id, company_id) REFERENCES public.orders(id, company_id) ON DELETE RESTRICT');
    expect(f).toContain('FOREIGN KEY (done_report_id) REFERENCES public.order_reports(id)');
  });

  test('지킴이 — requested → received · cancelled, received → done 만, 때는 트리거가 찍는다', () => {
    expect(f).toContain("(OLD.state = 'requested' AND NEW.state IN ('received', 'cancelled'))");
    expect(f).toContain("(OLD.state = 'received' AND NEW.state = 'done')");
    expect(f).toContain("IF NEW.state = 'received' THEN NEW.received_at := now(); END IF;");
    expect(f).toContain('BEFORE UPDATE ON public.as_requests');
  });

  test('읽기 — 고객은 자기 것, 팩토리 구성원은 자기 팩토리 것 · 쓰기는 서버만 · 지우기 없음 · 48시간 알림 색인', () => {
    expect(f).toContain('USING (customer_user_id = (SELECT auth.uid()))');
    expect(f).toContain('USING (company_id IN (SELECT public.my_company_ids()))');
    expect(f).toContain('GRANT SELECT ON TABLE public.as_requests TO authenticated;');
    expect(f).toContain('REVOKE DELETE, TRUNCATE ON TABLE public.as_requests FROM service_role;');
    expect(f).toContain("WHERE ((state = 'requested'::text) AND (alerted_at IS NULL))");
  });

  test('앱 알림 종류 — 0033 목록 그대로 + as_request', () => {
    const m = /notification_outbox_kind_check CHECK \(kind = ANY \(ARRAY\[(.*?)\]\)\)/.exec(f);
    const kinds = [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]);
    expect(kinds.slice(-2)).toEqual(['ledger_notice', 'as_request']);
    expect(kinds.length).toBe(16);
    // 서버가 넣는 종류(workflow-api push/messages.js NOTIFICATION_KINDS)는 이 목록에 있거나, 뒤 번호(0050 제작 의뢰 셋)에서 더한 것이다 (db-migration-0050 시험이 본다)
    const msg = fs.readFileSync(path.join(__dirname, '..', 'workers', 'workflow-api', 'src', 'push', 'messages.js'), 'utf8');
    const names = [.../NOTIFICATION_KINDS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(msg)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(names.filter((k) => !kinds.includes(k))).toEqual(['production_recommended', 'production_offered', 'production_answered']);
    expect(names).toContain('as_request');
  });

  test('비공개 사진 버킷 as-request-photos', () => {
    expect(f).toContain("VALUES ('as-request-photos', 'as-request-photos', false, 5242880, ARRAY['image/jpeg', 'image/png'])");
  });

  test('프로브 — 읽기 둘 · 쓰기 막기 · 간 곳 · 내용 · 같은 팩토리 · 상태 차례 · 지우기 · 버킷', () => {
    const probe = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database', 'probes', '0045-as-requests.json'), 'utf8'));
    expect(probe.checks[0].expect).toEqual({ customer: '1', x_staff: '1', other: '0', y_owner: '0', anon: 'deny', service_role: '1' });
    expect(probe.checks.length).toBe(13);
  });
});
