/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0067_planner_learning.sql 정적 시험 (DB 없이).
 *
 *   간편 플래너 설계가 모여 검토되는 길: planner_draft_learn(학습 묶음 · 수집 표시) · planner_save_issues(저장 실패) ·
 *   planner_signals(화면 신호) · system_checks(점검 기록) · company_consents(업체 동의) — 다섯 다 service_role 만.
 *   dataset_reviews 에 등급 · 까닭 · 본 rev, 앱 알림 종류 하나(system_check_failed).
 *   값은 database/probes/0067-planner-learning.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const S = read('database', 'migrations', '0067_planner_learning.sql')
  .split('\r\n')
  .join('\n')
  .split('\n')
  .map((l) => l.replace(/^\s*--.*$/, ''))
  .join('\n');
const f = S.replace(/\s+/g, ' ').trim();
/** 함수 본문을 뺀 위 문장들 */
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
const kindsIn = (sql) => [...sql.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]);
const NEW_TABLES = [
  'planner_draft_learn',
  'planner_save_issues',
  'planner_signals',
  'system_checks',
  'company_consents',
];

describe('0067 — 간편 플래너 설계가 모여 검토되는 길', () => {
  test('트랜잭션 문 · 표 · 칸 지우기 · 행 넣기 · 고치기가 없다, 새 표는 다섯', () => {
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(top).not.toMatch(/(^|; )\s*(INSERT|UPDATE|DELETE)\b/i);
    expect(top.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual(
      NEW_TABLES.map((t) => `CREATE TABLE IF NOT EXISTS public.${t}`)
    );
  });

  test('있던 플래너 표 · 표본 표는 건드리지 않는다', () => {
    for (const t of [
      'planner_drafts',
      'planner_draft_photos',
      'planner_my_modules',
      'dataset_samples',
    ]) {
      expect(top).not.toContain(`ALTER TABLE public.${t} `);
      expect(top).not.toMatch(new RegExp(`ON public\\.${t}\\b`));
    }
    // 있던 검수 지킴이는 다시 만들지 않는다 (그 뒤에 도는 것을 하나 더한다)
    expect(f).not.toContain('FUNCTION public.apply_dataset_review()');
    expect(f).not.toContain('TRIGGER on_dataset_review_insert ON');
  });

  test('학습 묶음 — 같은 업체 설계(복합 FK) · 1MB · 지문 · 수집 표시 · pending 은 지문 차이', () => {
    expect(f).toContain('CONSTRAINT planner_draft_learn_pkey PRIMARY KEY (company_id, draft_id)');
    expect(f).toContain(
      'FOREIGN KEY (company_id, draft_id) REFERENCES public.planner_drafts(company_id, id) ON DELETE RESTRICT'
    );
    expect(f).toContain('octet_length(bundle::text) <= 1048576');
    expect(f).toContain("CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'::text)");
    expect(f).toContain(
      'pending boolean GENERATED ALWAYS AS (ingested_sha256 IS DISTINCT FROM bundle_sha256) STORED'
    );
    expect(f).toContain('(ingested_rev <= rev)');
    expect(f).toContain(
      'CREATE INDEX IF NOT EXISTS idx_planner_draft_learn_pending ON public.planner_draft_learn USING btree (updated_at) WHERE pending;'
    );
  });

  test('학습 묶음 지킴이 — rev 는 뒤로 안 감, 묶음이 바뀌면 지문도, 고친 때는 묶음이 바뀔 때만', () => {
    expect(f).toContain('IF NEW.rev < OLD.rev THEN');
    expect(f).toContain(
      'IF NEW.bundle IS DISTINCT FROM OLD.bundle AND NEW.bundle_sha256 IS NOT DISTINCT FROM OLD.bundle_sha256 THEN'
    );
    expect(f).toContain(
      'IF NEW.bundle_sha256 IS DISTINCT FROM OLD.bundle_sha256 OR NEW.rev <> OLD.rev THEN NEW.updated_at := now(); NEW.ingest_error := NULL; NEW.ingest_tries := 0; ELSE NEW.updated_at := OLD.updated_at; END IF;'
    );
    expect(f).toContain(
      'CREATE TRIGGER trg_planner_draft_learn_guard BEFORE UPDATE ON public.planner_draft_learn'
    );
  });

  test('저장 실패 — 글 칸이 없다 (단계 · 코드 · 상태뿐), 서버가 지울 수 있고 고치지는 못한다', () => {
    const body = /CREATE TABLE IF NOT EXISTS public\.planner_save_issues \((.*?)\); COMMENT/.exec(
      f
    )[1];
    const cols = body
      .split(/, (?=[a-z_]+ (?:uuid|text|integer|timestamp))/)
      .map((c) => c.trim().split(' ')[0])
      .filter((c) => c !== 'CONSTRAINT');
    expect(cols).toEqual([
      'id',
      'company_id',
      'user_id',
      'draft_id',
      'source',
      'stage',
      'code',
      'status',
      'rev',
      'created_at',
    ]);
    expect(f).toContain(
      "CHECK (stage = ANY (ARRAY['save'::text, 'learn'::text, 'photo'::text, 'open'::text]))"
    );
    expect(f).toContain("CHECK (code ~ '^[a-z0-9_]{1,40}$'::text)");
    expect(f).toContain(
      'GRANT SELECT, INSERT, DELETE ON TABLE public.planner_save_issues TO service_role;'
    );
    expect(f).toContain(
      'REVOKE UPDATE, TRUNCATE ON TABLE public.planner_save_issues FROM service_role;'
    );
  });

  test('점검 기록 — 매일 점검은 종류 · 날마다 한 줄, 매일 점검에는 누른 사람이 없다', () => {
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_system_checks_daily ON public.system_checks USING btree (kind, run_date) WHERE (cause = 'daily'::text);"
    );
    expect(f).toContain("CHECK ((cause = 'manual'::text) OR (run_by IS NULL))");
    expect(f).toContain("CHECK (cause = ANY (ARRAY['daily'::text, 'manual'::text]))");
  });

  test('권한 — 새 표 다섯은 서버만 · 정책 없음, 묶음은 지우기 없음, 신호 · 점검 · 동의는 쌓기만', () => {
    for (const t of NEW_TABLES) {
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
    }
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.planner_draft_learn TO service_role;'
    );
    expect(f).toContain(
      'REVOKE DELETE, TRUNCATE ON TABLE public.planner_draft_learn FROM service_role;'
    );
    for (const t of ['planner_signals', 'system_checks', 'company_consents']) {
      expect(f).toContain(`GRANT SELECT, INSERT ON TABLE public.${t} TO service_role;`);
      expect(f).toContain(
        `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.${t} FROM service_role;`
      );
    }
    expect(top).not.toMatch(/CREATE POLICY|DROP POLICY/);
    expect(f.match(/SET search_path TO ''/g)).toHaveLength(2);
    for (const fn of ['planner_draft_learn_guard', 'apply_dataset_review_grade']) {
      expect(f).toContain(
        `REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated, service_role;`
      );
    }
  });

  test('검토 등급 — 제외는 reject 일 때만, 까닭은 넷 · 보통 · 제외에만, 표본 attrs 에 적는다', () => {
    for (const col of [
      'grade text',
      "reasons text[] DEFAULT '{}'::text[] NOT NULL",
      'src_rev integer',
    ]) {
      expect(f).toContain(`ALTER TABLE public.dataset_reviews ADD COLUMN IF NOT EXISTS ${col};`);
    }
    expect(f).toContain(
      "CHECK ((grade IS NULL) OR ((grade = ANY (ARRAY['good'::text, 'normal'::text, 'exclude'::text])) AND ((grade = 'exclude'::text) = (verdict = 'reject'::text))))"
    );
    expect(f).toContain(
      "CHECK ((reasons <@ ARRAY['dimension'::text, 'incomplete'::text, 'photo_blur'::text, 'test'::text]) AND ((cardinality(reasons) = 0) OR (grade = ANY (ARRAY['normal'::text, 'exclude'::text]))))"
    );
    expect(f).toContain(
      "SET attrs = attrs || jsonb_build_object('grade', NEW.grade, 'grade_reasons', to_jsonb(NEW.reasons), 'reviewed_rev', NEW.src_rev)"
    );
    // 있던 지킴이(on_dataset_review_insert) 뒤에 돈다 — 같은 때의 지킴이는 이름 차례
    const name = /CREATE TRIGGER (\w+) AFTER INSERT ON public\.dataset_reviews/.exec(f)[1];
    expect(name > 'on_dataset_review_insert').toBe(true);
  });

  test('업체 동의 — 한 가지(플래너 사진 학습 제공), 쌓기만', () => {
    expect(f).toContain("CHECK (kind = ANY (ARRAY['planner_photo_learning'::text]))");
    expect(f).toContain("CHECK (terms_version ~ '^[0-9A-Za-z._-]{1,40}$'::text)");
  });

  test('앱 알림 종류 — 0064 목록 그대로 + system_check_failed', () => {
    const prev = read('database', 'migrations', '0064_worker_companies.sql');
    const before = kindsIn(/notification_outbox_kind_check CHECK \(([^;]+)\);/.exec(prev)[1]);
    const after = kindsIn(/notification_outbox_kind_check CHECK \(([^;]+)\);/.exec(f)[1]);
    expect(before).toHaveLength(23);
    expect(after).toEqual([...before, 'system_check_failed']);
    // 그 사이 번호가 이 목록을 바꾸지 않았다
    for (const n of ['0065_work_kinds_project_jobs.sql', '0066_work_delivery_company_notes.sql']) {
      expect(read('database', 'migrations', n)).not.toContain('notification_outbox_kind_check');
    }
    // 서버가 넣는 종류는 모두 이 목록 안에 있다
    const messages = read('workers', 'workflow-api', 'src', 'push', 'messages.js');
    const list = /export const NOTIFICATION_KINDS = Object\.freeze\(\[([^\]]+)\]\)/.exec(
      messages
    )[1];
    const inCode = [...list.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inCode.length).toBeGreaterThanOrEqual(23);
    for (const k of inCode) expect(after).toContain(k);
  });

  test('프로브 — 읽기 · 묶음 지킴이 · 실패 · 신호 · 점검 · 동의 · 등급 · 알림', () => {
    const probe = JSON.parse(read('database', 'probes', '0067-planner-learning.json'));
    expect(probe.checks.length).toBe(32);
    expect(probe.checks[0].expect).toEqual({ anon: 'deny', x_owner: 'deny', service_role: '3' });
    const of = (head) => probe.checks.find((c) => c.name.startsWith(head)).expect;
    expect(of('rev 는 뒤로')).toEqual({ service_role: 'err:22023' });
    expect(of('수집 표시만')).toEqual({ service_role: 'false/true/2' });
    expect(of('점검 — 매일 점검은 날마다')).toEqual({ service_role: 'err:23505' });
    expect(of('검토 등급 — 표본에 적힌다')).toEqual({
      service_role: 'normal/["photo_blur"]/3/false',
    });
    expect(of('앱 알림 종류')).toEqual({ service_role: '24' });
    // 칸은 하나씩 되돌려진다 — 바꾼 뒤의 모습을 읽는 칸은 한 문장(읽기)뿐이고, 바꾸기는 setup 에 있다
    for (const c of probe.checks) {
      expect(c.sql.split(';').filter((x) => x.trim()).length).toBe(1);
    }
    expect(probe.setup.filter((s) => /^UPDATE public\.planner_draft_learn/.test(s))).toHaveLength(
      3
    );
  });
});
