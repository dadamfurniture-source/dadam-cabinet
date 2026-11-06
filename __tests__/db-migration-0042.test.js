/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0042_project_assignee.sql 정적 시험 (DB 없이).
 *
 *   2026-11-06 사장님 결정 (작업 분배 ① Expert · Agent 모두 ② 프로젝트에 한 명 ③ 대표 · 실장 · 직원 모두):
 *   projects 담당자 칸 셋 · 지킴이 트리거(그 업체의 지금 구성원만) · 색인 · 승인 카드 종류 project_assign.
 *   값은 database/probes/0042-project-assignee.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const S = fs
  .readFileSync(path.join(__dirname, '..', 'database', 'migrations', '0042_project_assignee.sql'), 'utf8')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
/** 함수 본문을 뺀 위 문장들 (plpgsql 의 BEGIN · INSERT 글자가 섞이지 않게) */
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');

describe('0042 — 프로젝트 담당자', () => {
  test('트랜잭션 문 · 표 만들기 · 지우기 · 정책 · 행 바꾸기가 없다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(CREATE TABLE|DROP TABLE|DROP COLUMN|TRUNCATE|DROP FUNCTION|CREATE POLICY|GRANT)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
  });

  test('projects 칸 셋 — 담당자 · 정한 때 · 정한 사람, 사람이 지워지면 비운다', () => {
    expect(f.match(/ADD COLUMN IF NOT EXISTS \w+ [a-z ]+;/g)).toEqual([
      'ADD COLUMN IF NOT EXISTS assignee_id uuid;',
      'ADD COLUMN IF NOT EXISTS assigned_at timestamp with time zone;',
      'ADD COLUMN IF NOT EXISTS assigned_by uuid;',
    ]);
    expect(f).toContain('FOREIGN KEY (assignee_id) REFERENCES auth.users(id) ON DELETE SET NULL');
    expect(f).toContain('FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL');
    expect(f.match(/ALTER TABLE public\.(\w+)/g).every((x) => /projects|assistant_actions/.test(x))).toBe(true);
  });

  test('지킴이 — 그 업체의 지금 구성원만(23514), 바뀔 때 assigned_at, 담당자 칸이 바뀔 때만 돈다', () => {
    expect(f).toContain("m.company_id = NEW.company_id AND m.user_id = NEW.assignee_id AND m.status = 'active'");
    expect(f).toContain("USING ERRCODE = '23514'");
    expect(f).toContain('NEW.assigned_at := now();');
    expect(f).toContain('BEFORE INSERT OR UPDATE OF assignee_id ON public.projects');
    expect(f).toContain("SET search_path TO ''");
    expect(f).toContain('REVOKE ALL ON FUNCTION public.projects_assignee_guard() FROM PUBLIC, anon, authenticated, service_role;');
  });

  test('승인 카드 종류 — 0041 여덟 + project_assign + 초안', () => {
    const m = /assistant_actions_kind_check CHECK \(kind = ANY \(ARRAY\[(.*?)\]\)\)/.exec(f);
    expect([...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1])).toEqual([
      'consult_accept',
      'consult_decline',
      'order_status',
      'ledger_post',
      'project_create',
      'design_link',
      'payment_received',
      'cost_add',
      'project_assign',
      'draft',
    ]);
  });

  test('프로브 — 직원 · 비우기 · 만들 때 대표는 그대로, 나간 사람 · 남의 업체 사람은 거절, 구성원은 0줄, 카드 종류', () => {
    const probe = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database', 'probes', '0042-project-assignee.json'), 'utf8'));
    expect(probe.checks.map((c) => Object.values(c.expect)[0])).toEqual([
      'true/true/true',
      'err:23514',
      'err:23514',
      'none',
      'true',
      'err:23514',
      'rows:0',
      'project_assign',
    ]);
  });
});
