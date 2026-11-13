/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0050_production_requests.sql 정적 시험 (DB 없이).
 *
 *   2026-11-08 사장님 결정 (Manager 업체 제작 의뢰 — 본사가 팩토리를 추천하고 Manager 가 고른다):
 *   production_requests(의뢰) · production_recommendations(본사 추천) · 지킴이 둘 · 서버만 읽고 쓰기 · 앱 알림 종류 셋.
 *   값은 database/probes/0050-production-requests.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const S = fs
  .readFileSync(path.join(ROOT, 'database', 'migrations', '0050_production_requests.sql'), 'utf8')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
/** 함수 본문을 뺀 위 문장들 */
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

describe('0050 — Manager 업체 제작 의뢰', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기가 없다, 새 표는 둘, 0048 · 0049 객체를 쓰지 않는다', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.production_requests',
      'CREATE TABLE IF NOT EXISTS public.production_recommendations',
    ]);
    // 0048(AI 비서 안내 모드) · 0049(시공사례 정보) 가 만드는 것
    expect(f).not.toMatch(/assistant_guide|guide_on|collection_post|collection_likes|place_label/);
  });

  test('의뢰 — 상태 여덟 · 설계 하나 이상 · 같은 업체 설계 · 프로젝트(복합 FK, 지우지 못하게) · 열린 의뢰는 설계마다 하나', () => {
    expect(f).toContain(
      "CHECK (status = ANY (ARRAY['submitted'::text, 'recommending'::text, 'recommended'::text, 'chosen'::text, 'accepted'::text, 'declined'::text, 'expired'::text, 'cancelled'::text]))"
    );
    expect(f).toContain("status text DEFAULT 'submitted'::text NOT NULL");
    expect(f).toContain('CHECK ((draft_id IS NOT NULL) OR (design_id IS NOT NULL))');
    expect(f).toContain(
      'FOREIGN KEY (company_id, draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      'FOREIGN KEY (design_id, company_id) REFERENCES public.designs(id, company_id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      'FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      'FOREIGN KEY (factory_project_id, factory_company_id) REFERENCES public.projects(id, company_id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      'FOREIGN KEY (factory_company_id, factory_draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT'
    );
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS production_requests_one_open_draft ON public.production_requests USING btree (company_id, draft_id) WHERE ((draft_id IS NOT NULL) AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])))"
    );
    expect(f).toContain(
      'production_requests_one_open_design ON public.production_requests USING btree (design_id)'
    );
    // 고른 팩토리는 chosen · accepted · declined · expired 일 때만, 받은 프로젝트 · 설계 사본은 accepted 만
    expect(f).toContain(
      "((status = ANY (ARRAY['chosen'::text, 'accepted'::text, 'declined'::text, 'expired'::text])) = (factory_company_id IS NOT NULL)) AND (factory_project_id IS NULL OR status = 'accepted'::text) AND (factory_draft_id IS NULL OR status = 'accepted'::text)"
    );
    // 글자 수 — 서버 상수와 같다
    expect(f).toContain('length(note) BETWEEN 1 AND 1000');
    expect(f).toContain('length(hq_note) BETWEEN 1 AND 500');
    // 넘기기(0003 handed_over · origin_project_id)는 쓰지 않는다
    expect(top).not.toMatch(/handed_over|origin_project_id/);
  });

  test('의뢰 지킴이 — 정해진 차례로만, 차례는 추천할 때만, 고른 팩토리 · 프로젝트 · 설계 사본은 그때만, 끝난 의뢰는 사본 한 번만', () => {
    expect(f).toContain(
      "(OLD.status = 'submitted' AND NEW.status IN ('recommending', 'recommended', 'cancelled'))"
    );
    expect(f).toContain(
      "(OLD.status = 'recommending' AND NEW.status IN ('recommended', 'cancelled'))"
    );
    expect(f).toContain("(OLD.status = 'recommended' AND NEW.status IN ('chosen', 'cancelled'))");
    expect(f).toContain(
      "(OLD.status = 'chosen' AND NEW.status IN ('accepted', 'declined', 'expired', 'cancelled'))"
    );
    expect(f).toContain(
      "(OLD.status IN ('declined', 'expired') AND NEW.status IN ('recommended', 'cancelled'))"
    );
    expect(f).toContain("IF NOT (NEW.round > OLD.round AND NEW.status = 'recommended') THEN");
    expect(f).toContain("IF OLD.status IN ('accepted', 'cancelled') THEN");
    expect(f).toContain("NOT (OLD.status = 'accepted' AND OLD.factory_draft_id IS NULL)");
    expect(f).toContain('NEW.status_at := now();');
    expect(f).toContain('BEFORE UPDATE ON public.production_requests');
  });

  test('추천 — 차례마다 팩토리 · 순서 하나, 답 기다림은 의뢰에 하나, 답은 고른 줄만, 사유는 못 받음만', () => {
    expect(f).toContain(
      'production_recommendations_round_company ON public.production_recommendations USING btree (request_id, round, company_id)'
    );
    expect(f).toContain(
      'production_recommendations_round_rank ON public.production_recommendations USING btree (request_id, round, rank)'
    );
    expect(f).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS production_recommendations_one_open ON public.production_recommendations USING btree (request_id) WHERE (chosen AND (response IS NULL))'
    );
    expect(f).toContain(
      "(chosen AND response = ANY (ARRAY['accepted'::text, 'declined'::text, 'expired'::text, 'cancelled'::text]))"
    );
    expect(f).toContain(
      "CHECK (reason IS NULL OR (response = 'declined'::text AND length(reason) BETWEEN 1 AND 500))"
    );
    expect(f).toContain('CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200)');
    expect(f).toContain(
      'FOREIGN KEY (request_id) REFERENCES public.production_requests(id) ON DELETE CASCADE'
    );
  });

  test('추천 지킴이 — 새 추천은 다음 차례로만 · 고르기 · 답 없이, 고르면 +24시간(워커 ASSIGNMENT_TTL_HOURS 와 같다), 답은 한 번', () => {
    expect(f).toContain('IF v_round IS NULL OR NEW.round <= v_round THEN');
    expect(f).toContain(
      'IF NEW.chosen OR NEW.response IS NOT NULL OR NEW.reason IS NOT NULL OR NEW.responded_by IS NOT NULL THEN'
    );
    expect(f).toContain('NEW.chosen_at := now();');
    const ttl = /NEW\.expires_at := now\(\) \+ interval '(\d+) hours'/.exec(f);
    expect(ttl).not.toBeNull();
    const rules = read('workers', 'workflow-api', 'src', 'distribution', 'rules.js');
    expect(Number(ttl[1])).toBe(Number(/ASSIGNMENT_TTL_HOURS = (\d+)/.exec(rules)[1]));
    expect(f).toContain('NEW.responded_at := now();');
    expect(f).toContain('BEFORE INSERT OR UPDATE ON public.production_recommendations');
    expect(f.match(/SET search_path TO ''/g)).toHaveLength(2);
  });

  test('권한 — 둘 다 서버만 (정책 없음), 지우기 없음, 지킴이 함수는 아무도 못 부른다', () => {
    for (const t of ['production_requests', 'production_recommendations']) {
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(f).toContain(`GRANT SELECT, INSERT, UPDATE ON TABLE public.${t} TO service_role;`);
      expect(f).toContain(`REVOKE DELETE, TRUNCATE ON TABLE public.${t} FROM service_role;`);
    }
    expect(top).not.toMatch(/CREATE POLICY/);
    expect(top).not.toMatch(
      /GRANT [A-Z, ]+ ON TABLE public\.production_\w+ TO (authenticated|anon)/
    );
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.production_requests_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(f).toContain(
      'REVOKE ALL ON FUNCTION public.production_recommendations_guard() FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  test('앱 알림 종류 — 0045 목록 그대로 + 제작 의뢰 셋, 서버가 넣는 종류는 이 목록에 있거나 뒤 번호에서 더한 것', () => {
    const m = /notification_outbox_kind_check CHECK \(kind = ANY \(ARRAY\[(.*?)\]\)\)/.exec(f);
    const kinds = [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]);
    const prev = /notification_outbox_kind_check CHECK \(kind = ANY \(ARRAY\[(.*?)\]\)\)/.exec(
      read('database', 'migrations', '0045_as_requests.sql').replace(/\s+/g, ' ')
    );
    const before = [...prev[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]);
    expect(kinds).toEqual([
      ...before,
      'production_recommended',
      'production_offered',
      'production_answered',
    ]);
    expect(kinds.length).toBe(19);
    const msg = read('workers', 'workflow-api', 'src', 'push', 'messages.js');
    const names = [
      .../NOTIFICATION_KINDS = Object\.freeze\(\[([\s\S]*?)\]\)/
        .exec(msg)[1]
        .matchAll(/'([a-z_]+)'/g),
    ].map((x) => x[1]);
    // 뒤 번호 0053 이 제작 의뢰 거둠을, 0064 가 팩토리용 작업자 알림 셋을, 0067 이 점검 알림을 더한다 (db-migration-0053 · 0064 · 0067 시험이 본다)
    expect(names.filter((k) => !kinds.includes(k))).toEqual(['production_cancelled', 'work_link_request', 'work_reply', 'work_report', 'system_check_failed']);
  });

  test('프로브 — 서버만 읽기 · 쓰기, 설계 · 열린 의뢰 · 차례 · 기한 · 받기 · 다시 추천 · 알림 종류', () => {
    const probe = JSON.parse(read('database', 'probes', '0050-production-requests.json'));
    expect(probe.checks[0].expect).toEqual({ anon: 'deny', m_owner: 'deny', service_role: '3' });
    const byName = Object.fromEntries(probe.checks.map((c) => [c.name, c.expect]));
    expect(byName['고른 줄 — 기한은 고른 때 + 24시간 (트리거가 찍는다)']).toEqual({
      service_role: '86400',
    });
    expect(byName['못 받음 → 고른 팩토리를 비우고 다음 차례로 다시 추천']).toEqual({
      service_role: 'recommended/2/none',
    });
    expect(byName['지우기 없음 — 서버도 (의뢰)']).toEqual({ service_role: 'deny' });
    expect(probe.checks.length).toBe(35);
  });
});
