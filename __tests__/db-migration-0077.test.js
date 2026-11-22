/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0077_business_cert_trial.sql 정적 시험 (DB 없이).
 *
 *   사업자등록증 등록 시 첫 달 무료 (2026-11-21 대표님 계획 승인 — 새 업체 · 모든 등급 / 카드 먼저 · 30일 뒤 자동 결제 /
 *   자동 확인 + 의심 건 본사 검토 / 사업자번호당 1회 · 계속사업자만)
 *   — 표 business_certificates · trial_grants, companies 칸 셋, 알림 종류 셋, 비공개 버킷 business-certs.
 *   값은 database/probes/0077-business-cert-trial.json 이 실DB 트랜잭션에서 본다.
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
const f = flat(read('database', 'migrations', '0077_business_cert_trial.sql'));
const kindsIn = (s) => [...s.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]);
const tableOf = (name) =>
  new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\((.*?)\\); COMMENT ON TABLE`).exec(
    f
  )[1];

describe('0077 — 사업자등록증 · 첫 달 무료', () => {
  test('트랜잭션 문 · 지우기 · 행 바꾸기가 없다, 새 표는 둘', () => {
    expect(f).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(f).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE public|DROP FUNCTION)\b/i);
    expect(f).not.toMatch(/(^|; )\s*(UPDATE|DELETE)\b/i);
    expect(f.match(/CREATE TABLE IF NOT EXISTS public\.\w+/g)).toEqual([
      'CREATE TABLE IF NOT EXISTS public.business_certificates',
      'CREATE TABLE IF NOT EXISTS public.trial_grants',
    ]);
  });

  test('business_certificates — 상태 다섯, 번호는 숫자 10자리, 통과 · 검토 줄에는 번호가 있다, 한 사람에게 살아 있는 줄은 하나', () => {
    const t = tableOf('business_certificates');
    expect(
      kindsIn(/business_certificates_status_check CHECK \(([^)]+\)[^)]*)\)/.exec(t)[1])
    ).toEqual(['uploaded', 'verified', 'review', 'rejected', 'superseded']);
    expect(t).toContain(
      "CONSTRAINT business_certificates_biz_no_check CHECK ((biz_no IS NULL) OR (biz_no ~ '^[0-9]{10}$'))"
    );
    expect(t).toContain(
      "CONSTRAINT business_certificates_confirmed_check CHECK ((status <> ALL (ARRAY['verified'::text, 'review'::text])) OR (biz_no IS NOT NULL))"
    );
    // 사진은 jpeg · png, 5MB — 버킷과 같다
    expect(t).toContain("CHECK (mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text]))");
    expect(t).toContain('CHECK (size_bytes BETWEEN 1 AND 5242880)');
    expect(t).toContain('FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(f).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS business_certificates_one_live_per_user ON public.business_certificates USING btree (user_id) WHERE (status = ANY (ARRAY['uploaded'::text, 'verified'::text, 'review'::text]));"
    );
  });

  test('trial_grants — 사업자번호 유니크(번호당 1회) · 회원 · 업체 · 구독이 지워져도 번호는 남는다', () => {
    const t = tableOf('trial_grants');
    expect(t).toContain('CONSTRAINT trial_grants_biz_no_key UNIQUE (biz_no)');
    expect(t).toContain("CONSTRAINT trial_grants_biz_no_check CHECK (biz_no ~ '^[0-9]{10}$')");
    expect(t).toContain('biz_no text NOT NULL');
    expect(kindsIn(/trial_grants_plan_check CHECK \(([^)]+\)[^)]*)\)/.exec(t)[1])).toEqual([
      'manager',
      'expert',
      'agent',
    ]);
    for (const col of ['certificate_id', 'user_id', 'company_id', 'subscription_id']) {
      expect(t).toMatch(
        new RegExp(`FOREIGN KEY \\(${col}\\) REFERENCES [a-z_.]+\\(id\\) ON DELETE SET NULL`)
      );
    }
    expect(t).not.toMatch(/ON DELETE CASCADE/);
  });

  test('두 표 모두 서버만 — RLS 켬, 회원 권한 없음, 정책 없음', () => {
    for (const name of ['business_certificates', 'trial_grants']) {
      expect(f).toContain(`ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(`REVOKE ALL ON TABLE public.${name} FROM PUBLIC, anon, authenticated;`);
    }
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.business_certificates TO service_role;'
    );
    // 무료 준 기록은 구독 저장을 되돌릴 때 서버가 지울 수 있어야 한다
    expect(f).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trial_grants TO service_role;'
    );
    expect(f).not.toMatch(/CREATE POLICY/);
    expect(f).not.toMatch(/TO (anon|authenticated)\b/);
  });

  test('companies — 사업자번호 · 대표자 · 확인한 때 칸 (비어도 된다)', () => {
    for (const col of [
      'biz_no text',
      'representative_name text',
      'biz_verified_at timestamp with time zone',
    ]) {
      expect(f).toContain(`ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS ${col};`);
    }
    expect(f).toContain("((biz_no IS NULL) OR (biz_no ~ '^[0-9]{10}$'))");
  });

  test('알림 종류 — 0074 목록 그대로 + 맨 끝 셋 (그 사이 번호는 목록을 바꾸지 않았다)', () => {
    const prev = read('database', 'migrations', '0074_band_stock.sql');
    const before = kindsIn(/notification_outbox_kind_check CHECK \(([^;]+)\);/.exec(prev)[1]);
    const after = kindsIn(/notification_outbox_kind_check CHECK \(([^;]+)\);/.exec(f)[1]);
    expect(before).toHaveLength(25);
    expect(after).toEqual([...before, 'trial_ending', 'biz_cert_review', 'biz_cert_decided']);
    for (const n of ['0075_collection_hq_pick.sql', '0076_collection_seed_ai_photos.sql']) {
      expect(read('database', 'migrations', n)).not.toContain('notification_outbox_kind_check');
    }
  });

  test('업체 없이 넣을 수 있는 종류 — 0023 목록 그대로 + 검토 결과 (올린 사람에게 업체가 아직 없다)', () => {
    const prev = read('database', 'migrations', '0023_work_notifications.sql');
    const before = kindsIn(/notification_outbox_company_check CHECK \(([^;]+)\);/.exec(prev)[1]);
    const after = kindsIn(/notification_outbox_company_check CHECK \(([^;]+)\);/.exec(f)[1]);
    expect(after).toEqual([...before, 'biz_cert_decided']);
  });

  test('버킷 business-certs — 비공개 · 5MB · jpeg · png, 정책 없음', () => {
    expect(f).toContain(
      "VALUES ('business-certs', 'business-certs', false, 5242880, ARRAY['image/jpeg', 'image/png']) ON CONFLICT (id) DO UPDATE"
    );
    expect(f).not.toMatch(/storage\.objects/);
  });

  test('구독 상태 trialing 은 기준선부터 있다 — 이 파일은 subscriptions 를 건드리지 않는다', () => {
    expect(read('database', 'migrations', '0000_baseline.sql')).toMatch(
      /subscriptions_status_check CHECK \(\(status = ANY \(ARRAY\['active'::text, 'past_due'::text, 'cancelled'::text, 'trialing'::text\]\)\)\)/
    );
    expect(f).not.toMatch(/ALTER TABLE public\.subscriptions/);
  });

  test('프로브 — 서버만 읽는다 · 번호당 1회 · 한 사람 한 줄 · 알림 종류', () => {
    const probe = JSON.parse(read('database', 'probes', '0077-business-cert-trial.json'));
    expect(probe.title).toMatch(/0077 사업자등록증/);
    expect(probe.checks.length).toBeGreaterThanOrEqual(6);
  });
});

describe('0077 — 서버가 넣는 알림 종류', () => {
  const messages = read('workers', 'workflow-api', 'src', 'push', 'messages.js');
  const sender = read('workers', 'workflow-api', 'src', 'push', 'sender.js');
  const listOf = (src, name) =>
    [
      ...new RegExp(`${name} = Object\\.freeze\\(\\[([^\\]]+)\\]\\)`)
        .exec(src)[1]
        .matchAll(/'([a-z_]+)'/g),
    ].map((x) => x[1]);

  test('코드 목록 = 0077 목록 (차례만 다름) · 맨 끝 셋이 이 차례', () => {
    const after = kindsIn(/notification_outbox_kind_check CHECK \(([^;]+)\);/.exec(f)[1]);
    // 뒤 번호 0082 가 A/S 팩토리 · 설치 날 변경 요청 둘을 맨 끝에 더한다 (db-migration-0082 시험이 본다)
    const LATER = ['as_factory', 'install_change'];
    const all = listOf(messages, 'NOTIFICATION_KINDS');
    expect(all.slice(-2)).toEqual(LATER);
    const inCode = all.filter((k) => !LATER.includes(k));
    expect(inCode).toHaveLength(28);
    expect([...inCode].sort()).toEqual([...after].sort());
    expect(inCode.slice(-3)).toEqual(['trial_ending', 'biz_cert_review', 'biz_cert_decided']);
    expect(after.slice(-3)).toEqual(inCode.slice(-3));
  });

  test('업체 없이 넣는 종류 — 서버 목록(업체 신청 · 작업자 넷 · 검토 결과)이 0077 의 company_check 와 같다', () => {
    const inDb = kindsIn(/notification_outbox_company_check CHECK \(([^;]+)\);/.exec(f)[1]);
    expect(listOf(messages, 'PERSON_NOTIFICATION_KINDS')).toEqual(['biz_cert_decided']);
    expect([
      'partner_application',
      ...listOf(messages, 'WORK_NOTIFICATION_KINDS'),
      ...listOf(messages, 'PERSON_NOTIFICATION_KINDS'),
    ]).toEqual(inDb);
  });

  test('보낼 때 규칙 — 무료 종료는 활동 중인 업체의 대표 · 검토 알림은 대표 · 실장, 정지돼도 가는 종류는 그대로', () => {
    expect(listOf(sender, 'OWNER_ACTIVE_KINDS')).toEqual(['trial_ending']);
    expect(listOf(sender, 'REVIEWER_KINDS')).toEqual(['biz_cert_review']);
    expect(listOf(sender, 'OWNER_KINDS')).toEqual(['billing_failed', 'company_suspended']);
  });

  test('넣는 곳 — 검토 알림 · 검토 결과는 account-api (무료 종료는 payments-api 가 넣는다)', () => {
    const outbox = read('workers', 'account-api', 'src', 'push-outbox.js');
    expect(outbox).toContain("kind: 'biz_cert_review'");
    expect(outbox).toContain("kind: 'biz_cert_decided'");
    expect(outbox).not.toContain("kind: 'trial_ending'");
  });
});
