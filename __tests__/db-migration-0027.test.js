/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0027_ledger_core.sql 정적 시험 (DB 없이).
 *
 *   회계장부 바탕 — 계정(국세청 서식 항목) · 원가 잇기 · 사진 문서 · 장부 줄 · 증빙 · 바꾼 기록 (모두 서버만),
 *   지우지 않는 장부 트리거, 거래처 사업자번호 · 원가 부가세 칸, 장부 합치기 · 사진 올리기 · 옮기기 · 고치기, 비공개 버킷.
 *   역할별 동작은 database/probes/0027-ledger-core.json 이 실DB 트랜잭션에서 본다.
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
const S = read('0027_ledger_core.sql');
const f = S.replace(/\s+/g, ' ');
// 함수 본문(plpgsql 의 BEGIN … END)은 빼고 본 맨 위 문장들
const top = S.replace(/\$function\$[\s\S]*?\$function\$/g, '');

const TABLES = [
  'ledger_accounts',
  'ledger_cost_accounts',
  'ledger_documents',
  'ledger_entries',
  'ledger_evidence',
  'ledger_events',
];
const EVIDENCE = [
  'tax_invoice',
  'invoice',
  'card',
  'cash_receipt',
  'simple_receipt',
  'statement',
  'other',
  'none',
];

/** CHECK 안의 '이름'::text 들 */
function namesOf(constraint) {
  const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\((.*?)\\)\\s*[,;]`).exec(f);
  return m ? [...m[1].matchAll(/'([a-z_/]+)'::text/g)].map((x) => x[1]) : null;
}

/** 함수 본문 */
function body(name) {
  const m = new RegExp(`FUNCTION public\\.${name}\\(.*?\\$function\\$(.*?)\\$function\\$`).exec(f);
  return m ? m[1] : null;
}

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

describe('0027 — 회계장부 바탕', () => {
  test('트랜잭션 문 · 표 · 칸 지우기가 없고, 맨 위 쓰기는 씨앗 둘 · 버킷 하나뿐', () => {
    expect(top).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
    const noRevoke = S.replace(/^\s*REVOKE[^;]*;/gim, '');
    expect(noRevoke).not.toMatch(/\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i);
    expect(top).not.toMatch(/^\s*(UPDATE|DELETE)\b/im);
    expect(top.match(/^[ \t]*INSERT INTO \S+/gim).map((l) => l.trim())).toEqual([
      'INSERT INTO public.ledger_accounts',
      'INSERT INTO public.ledger_cost_accounts',
      'INSERT INTO storage.buckets',
    ]);
  });

  test('표 6개 모두 RLS 켬 · 정책 없음 · anon · authenticated 권한 없음', () => {
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

  test('서버 권한 — 장부 줄 · 사진은 지우기 권한 없음, 기록은 읽기만', () => {
    const grants = Object.fromEntries(
      [...f.matchAll(/GRANT ([A-Z, ]+) ON TABLE public\.(\w+) TO service_role;/g)].map((m) => [
        m[2],
        m[1].split(', '),
      ])
    );
    expect(grants).toEqual({
      ledger_accounts: ['SELECT'],
      ledger_cost_accounts: ['SELECT'],
      ledger_documents: ['SELECT', 'INSERT', 'UPDATE'],
      ledger_entries: ['SELECT', 'INSERT', 'UPDATE'],
      ledger_evidence: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      ledger_events: ['SELECT'],
    });
  });

  test('계정 — 국세청 서식 항목 23개 그대로, 노무 · 외주 원가는 아직 잇지 않음', () => {
    const seed =
      /INSERT INTO public\.ledger_accounts \(code, name, grp, sort, note\) VALUES (.*?) ON CONFLICT/.exec(
        f
      )[1];
    const rows = [...seed.matchAll(/\('([a-z_.]+)', '([^']+)', '([a-z]+)', (\d+)/g)].map((m) => [
      m[1],
      m[2],
      m[3],
    ]);
    expect(rows.map((r) => r[1])).toEqual([
      '매출액',
      '기타',
      '상품매입',
      '재료비 매입',
      '노무비',
      '경비',
      '급료',
      '제세공과금',
      '임차료',
      '지급이자',
      '접대비',
      '기부금',
      '감가상각비',
      '차량유지비',
      '지급수수료',
      '소모품비',
      '복리후생비',
      '운반비',
      '광고선전비',
      '여비교통비',
      '기타',
      '유형자산',
      '무형자산',
    ]);
    const groups = rows.reduce((a, r) => ({ ...a, [r[2]]: (a[r[2]] || 0) + 1 }), {});
    expect(groups).toEqual({ income: 2, purchase: 2, manufacturing: 2, admin: 15, asset: 2 });
    for (const [code, , grp] of rows) expect(code.startsWith(`${grp}.`)).toBe(true);

    const map =
      /INSERT INTO public\.ledger_cost_accounts \(category, business_kind, account\) VALUES (.*?) ON CONFLICT/.exec(
        f
      )[1];
    const pairs = [...map.matchAll(/\('([a-z]+)', '([a-z]+)', '([a-z_.]+)'\)/g)].map((m) =>
      m.slice(1).join(' ')
    );
    expect(pairs).toEqual([
      'material manufacturing purchase.materials',
      'material retail purchase.goods',
      'hardware manufacturing purchase.materials',
      'hardware retail purchase.goods',
      'logistics any admin.freight',
      'other any admin.other',
    ]);
    for (const [code] of pairs.map((p) => [p.split(' ')[2]]))
      expect(rows.map((r) => r[0])).toContain(code);
  });

  test('이름 목록 — 방향 · 증빙 · 사진 상태 · 출처 · 기록', () => {
    expect(namesOf('ledger_entries_direction_check')).toEqual([
      'income',
      'expense',
      'asset_buy',
      'asset_sell',
    ]);
    expect(namesOf('ledger_entries_evidence_check')).toEqual(EVIDENCE);
    expect(namesOf('ledger_entries_source_check')).toEqual(['manual', 'photo', 'import']);
    expect(namesOf('ledger_documents_status_check')).toEqual([
      'pending',
      'posted',
      'returned',
      'rejected',
      'skipped_budget',
    ]);
    expect(namesOf('ledger_documents_mime_check')).toEqual(['image/jpeg', 'image/png']);
    expect(namesOf('ledger_events_table_check')).toEqual([
      'ledger_documents',
      'ledger_entries',
      'ledger_evidence',
      'order_costs',
      'order_payments',
    ]);
    // 원가 줄의 증빙 종류는 장부 줄과 같은 목록
    const cost = /CONSTRAINT order_costs_vat_check CHECK \((.*?)\);/.exec(f)[1];
    expect([...cost.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1])).toEqual(EVIDENCE);
  });

  test('한 돈은 한 표 — 장부 줄에 수주 칸이 없고, 원가 부가세는 비울 수 있다(옛 줄 미기재)', () => {
    expect(columnsOf('ledger_entries')).not.toContain('order_id');
    expect(f).toContain(
      'ALTER TABLE public.order_costs ADD COLUMN IF NOT EXISTS vat_amount bigint;'
    );
    expect(f).toContain(
      'ALTER TABLE public.order_costs ADD COLUMN IF NOT EXISTS evidence_type text;'
    );
    expect(f).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS ledger_documents_company_sha ON public.ledger_documents USING btree (company_id, sha256);'
    );
    expect(f).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS counterparties_company_biz_no ON public.counterparties USING btree (company_id, biz_no) WHERE (biz_no IS NOT NULL);'
    );
    // 올린 사람은 id 로만 — 계정을 지워도 남는다
    expect(f).not.toMatch(/ledger_documents_uploaded_by_fkey/);
  });

  test('지우지 않는 장부 — 장부 줄 · 사진 지키기, 원가 줄이 지워지면 사진은 pending', () => {
    expect(f).toContain(
      'CREATE TRIGGER trg_ledger_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ledger_entries FOR EACH ROW EXECUTE FUNCTION public.ledger_entries_guard();'
    );
    expect(f).toContain(
      'CREATE TRIGGER trg_ledger_documents_guard BEFORE UPDATE OR DELETE ON public.ledger_documents FOR EACH ROW EXECUTE FUNCTION public.ledger_documents_guard();'
    );
    expect(f).toContain(
      'CREATE TRIGGER trg_ledger_evidence_released AFTER DELETE ON public.ledger_evidence FOR EACH ROW EXECUTE FUNCTION public.ledger_evidence_released();'
    );
    const g = body('ledger_entries_guard');
    expect(g).toContain("ARRAY['voided_at', 'voided_by', 'void_reason']");
    expect(g).toContain('IF OLD.voided_at IS NOT NULL THEN');
    expect(g).toContain("(v_grp = 'asset' AND NEW.direction IN ('asset_buy', 'asset_sell'))");
    expect(f).toContain(
      'FOREIGN KEY (cost_id) REFERENCES public.order_costs(id) ON DELETE CASCADE'
    );
  });

  test('바꾼 기록 — 장부 표 셋과 원가 · 수금 줄, 바꾼 사람은 요청 머리 x-actor-id', () => {
    for (const t of [
      'ledger_documents',
      'ledger_entries',
      'ledger_evidence',
      'order_costs',
      'order_payments',
    ]) {
      expect(f).toMatch(
        new RegExp(
          `CREATE TRIGGER \\w+ AFTER INSERT OR UPDATE OR DELETE ON public\\.${t} FOR EACH ROW EXECUTE FUNCTION public\\.ledger_audit\\(\\);`
        )
      );
    }
    expect(body('ledger_actor')).toContain("->> 'x-actor-id'");
    expect(f).toMatch(/FUNCTION public\.ledger_audit\(\).*?SECURITY DEFINER SET search_path TO ''/);
  });

  test('함수 — 서버(service_role)만 부른다', () => {
    for (const sig of [
      'ledger_actor()',
      'ledger_book(uuid, date, date, boolean)',
      'ledger_post_document(uuid, uuid, jsonb)',
      'ledger_move_to_order(uuid, uuid, uuid, text, text)',
      'ledger_correct_entry(uuid, uuid, jsonb, text)',
    ]) {
      expect(f).toContain(
        `REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(f).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
    for (const sig of [
      'ledger_audit()',
      'ledger_entries_guard()',
      'ledger_documents_guard()',
      'ledger_evidence_released()',
    ]) {
      expect(f).toContain(
        `REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated, service_role;`
      );
      expect(f).not.toContain(`GRANT EXECUTE ON FUNCTION public.${sig}`);
    }
  });

  test('장부 합치기 — 일반과세 수금은 round(÷1.1) · 나머지, 낸 날 있는 원가만', () => {
    const b = body('ledger_book');
    expect(b).toContain(
      "CASE WHEN s.vat_type = 'general' THEN round(p.amount::numeric / 1.1)::bigint ELSE p.amount END"
    );
    expect(b).toContain(
      "CASE WHEN s.vat_type = 'general' THEN p.amount - round(p.amount::numeric / 1.1)::bigint END"
    );
    expect(b).toContain('p.paid_on BETWEEN p_from AND p_to');
    expect(b).toContain('c.spent_on BETWEEN p_from AND p_to');
    expect(b).toContain("m.business_kind IN (s.business_kind, 'any')");
    expect(b).toContain('(p_include_void OR e.voided_at IS NULL)');
  });

  test('사진 올리기 — pending 일 때만, 사진 줄을 잠그고 한 번', () => {
    const b = body('ledger_post_document');
    expect(b).toContain('FOR UPDATE');
    expect(b).toContain("IF v_doc.review_status <> 'pending' THEN");
    expect(b).toContain('o.company_id = v_doc.company_id');
    expect(b).toContain("SET review_status = 'posted'");
  });

  test('사진 버킷 — 비공개 · 5MB · JPEG/PNG, 버킷 정책 없음', () => {
    expect(f).toContain(
      "VALUES ('ledger-evidence', 'ledger-evidence', false, 5242880, ARRAY['image/jpeg', 'image/png'])"
    );
    expect(S).not.toMatch(/ON storage\.objects/i);
  });
});
