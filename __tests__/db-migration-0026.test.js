/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0026_assistant_core.sql 정적 시험 (DB 없이).
 *
 *   AI 비서 바탕 — 전체 스위치 · 업체 설정 · 대화 · 메시지 · 사용량 · 기록 · 플레이북 (모두 서버만),
 *   company_entitled · assistant_budget_reserve · assistant_budget_settle.
 *   역할별 동작은 database/probes/0003-company-tables.json 의 0026 확인이 실DB 트랜잭션에서 본다.
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
const S = read('0026_assistant_core.sql');
const f = S.replace(/\s+/g, ' ');

const TABLES = [
  'assistant_global',
  'assistant_settings',
  'assistant_conversations',
  'assistant_messages',
  'assistant_usage',
  'assistant_audit',
  'assistant_playbooks',
];

/** CHECK 안의 '이름'::text 들 */
function namesOf(constraint) {
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\((.*?)\\)\\s*[,;]`).exec(f);
  return m ? [...m[1].matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]) : null;
}

/** 함수 본문 ($function$ … $function$) */
function body(name) {
  const m = new RegExp(`FUNCTION public\\.${name}\\(.*?\\$function\\$(.*?)\\$function\\$`).exec(f);
  return m ? m[1] : null;
}

describe('0026 — AI 비서 바탕', () => {
  test('트랜잭션 문 · 표 · 칸 지우기가 없고, 맨 위 쓰기는 전체 스위치 한 줄뿐', () => {
    // 함수 본문(plpgsql 의 BEGIN … END)은 빼고 본다
    const top = S.replace(/\$function\$[\s\S]*?\$function\$/g, '');
    expect(top).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    const noRevoke = S.replace(/^\s*REVOKE[^;]*;/gim, '');
    expect(noRevoke).not.toMatch(/\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i);
    expect(top).not.toMatch(/^\s*(UPDATE|DELETE)\b/im);
    expect(top.match(/^[ \t]*INSERT\b.*$/gim).map((l) => l.trim())).toEqual([
      'INSERT INTO public.assistant_global (id) VALUES (true) ON CONFLICT (id) DO NOTHING;',
    ]);
  });

  test('표 7개 모두 RLS 켬 · 정책 없음 · anon · authenticated 권한 없음', () => {
    for (const t of TABLES) {
      expect(f).toContain(`CREATE TABLE IF NOT EXISTS public.${t} (`);
      expect(f).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(f).toContain(
        `REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated, service_role;`
      );
    }
    expect(S).not.toMatch(/CREATE POLICY/i);
    expect(S).not.toMatch(/GRANT[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/i);
  });

  test('서버 권한 — 사용량은 읽기만, 메시지 · 기록 · 플레이북은 고치지 않음, 기록은 지우지 않음', () => {
    const grants = Object.fromEntries(
      [...f.matchAll(/GRANT ([A-Z, ]+) ON TABLE public\.(\w+) TO service_role;/g)].map((m) => [
        m[2],
        m[1].split(', '),
      ])
    );
    expect(grants).toEqual({
      assistant_global: ['SELECT', 'UPDATE'],
      assistant_settings: ['SELECT', 'INSERT', 'UPDATE'],
      assistant_conversations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      assistant_messages: ['SELECT', 'INSERT', 'DELETE'],
      assistant_usage: ['SELECT'],
      assistant_audit: ['SELECT', 'INSERT'],
      assistant_playbooks: ['SELECT', 'INSERT'],
    });
  });

  test('이름 목록 — 목적 · 메시지 역할 · 기록 종류 · 플레이북', () => {
    expect(namesOf('assistant_usage_purpose_check')).toEqual(['chat', 'brief', 'extract']);
    expect(namesOf('assistant_messages_role_check')).toEqual(['user', 'assistant']);
    expect(namesOf('assistant_audit_kind_check')).toEqual([
      'turn',
      'tool',
      'blocked',
      'error',
      'setting',
    ]);
    expect(namesOf('assistant_playbooks_key_check')).toEqual([
      'consult',
      'accounting',
      'dispatch',
      'usage',
    ]);
  });

  test('업체 설정 — 기본은 꺼짐 · 한도 없음(비우면 쓸 수 없음) · 사진 읽기 몫 0', () => {
    expect(f).toContain('enabled boolean DEFAULT false NOT NULL');
    expect(f).toContain('trial boolean DEFAULT false NOT NULL');
    expect(f).toContain('monthly_limit_micros bigint,');
    expect(f).toContain('extract_floor_micros bigint DEFAULT 0 NOT NULL');
    expect(f).toContain('CONSTRAINT assistant_global_one_row CHECK (id)');
  });

  test('대화는 계정과 함께 지우고, 메시지는 대화와 함께 · 기록은 대화에 잇지 않는다', () => {
    expect(f).toContain(
      'CONSTRAINT assistant_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
    );
    expect(f).toContain(
      'CONSTRAINT assistant_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.assistant_conversations(id) ON DELETE CASCADE'
    );
    expect(f).not.toMatch(/assistant_audit_conversation_id_fkey/);
    expect(f).toContain('CONSTRAINT assistant_usage_key UNIQUE (reservation_key)');
  });

  test('함수 셋 — 서버(service_role)만 부른다', () => {
    for (const sig of [
      'company_entitled(uuid, text, uuid)',
      'assistant_budget_reserve(uuid, text, text, bigint, uuid, text)',
      'assistant_budget_settle(uuid, bigint, jsonb)',
    ]) {
      expect(f).toContain(
        `REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
  });

  test('자격 — 비서는 업체 켬 + 전체 스위치, 장부는 등급이 내려가도 read', () => {
    const b = body('company_entitled');
    expect(b).toContain("co.status = 'active'");
    expect(b).toContain("(co.kind = 'partner' AND co.plan = 'agent') OR coalesce(s.trial, false)");
    expect(b).toContain("cm.status = 'active'");
    expect(b).toContain('base AND enabled');
    expect(b).toContain('g.assistant_on');
    expect(b).toContain(
      "WHEN p_feature = 'ledger' THEN CASE WHEN (SELECT base FROM c) THEN 'full' ELSE 'read' END"
    );
  });

  test('예산 잡기 — 업체 줄을 먼저 잠그고, 같은 키는 그 줄, 대화는 사진 읽기 몫을 남김', () => {
    const b = body('assistant_budget_reserve');
    expect(f).toMatch(
      /FUNCTION public\.assistant_budget_reserve\(.*?SECURITY DEFINER SET search_path TO ''/
    );
    const lock = b.indexOf('FOR UPDATE');
    const key = b.indexOf('u.reservation_key = p_key');
    expect(lock).toBeGreaterThan(0);
    expect(key).toBeGreaterThan(lock);
    expect(b).toContain("date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')");
    expect(b).toContain(
      "CASE WHEN p_purpose = 'extract' THEN 0 ELSE greatest(v_set.extract_floor_micros - v_extract_used, 0) END"
    );
    expect(b).toContain('v_used + v_floor + p_micros > v_set.monthly_limit_micros');
    expect(b).toContain("CASE WHEN p_purpose = 'extract' THEN 'ledger' ELSE 'assistant' END");
  });

  test('정산 — 한 번만', () => {
    const b = body('assistant_budget_settle');
    expect(f).toMatch(
      /FUNCTION public\.assistant_budget_settle\(.*?SECURITY DEFINER SET search_path TO ''/
    );
    expect(b).toContain('WHERE u.id = p_id AND u.settled_at IS NULL');
    expect(f).toContain(
      'CONSTRAINT assistant_usage_settled_check CHECK ((settled_at IS NULL) = (cost_micros IS NULL))'
    );
  });
});
