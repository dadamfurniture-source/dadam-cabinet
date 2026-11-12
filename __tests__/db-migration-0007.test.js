/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0007_company_read_rules.sql 정적 시험 (DB 없이).
 *
 *   회사 구성원 읽기 정책은 새로 더하기만 하고, 「본인」 정책 셋은 본사 행으로 좁힌다.
 *   keep_owner_links() 트리거: 회사 칸은 누구도, 프로젝트 · 고객 칸은 anon · authenticated 가 못 바꾼다.
 *   역할별 실제 동작은 rls-probe + database/probes/0003-company-tables.json 의 「0007:」 줄로 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0007_company_read_rules.sql');
/** 줄 주석을 뺀 본문 — 설명 글의 낱말로 시험이 통과하지 않게 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const BODY = /\$function\$[\s\S]*?\$function\$/g;
const STMTS = CODE.replace(BODY, '$function$')
  .replace(/\s+/g, ' ')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

/** CREATE POLICY 이름 · 표 · 명령 · 역할 · 나머지 */
const policies = STMTS.flatMap((s) => {
  const m = s.match(
    /^CREATE POLICY ("[^"]+"|\w+) ON public\.(\w+) FOR (SELECT|INSERT|UPDATE|DELETE) TO (\w+) (.+)$/
  );
  return m ? [{ name: m[1], table: m[2], cmd: m[3], to: m[4], rest: m[5] }] : [];
});
const policy = (name) => policies.find((p) => p.name === name);

const MEMBER_DIRECT = ['designs', 'orders', 'consultations'];
const MEMBER_VIA_DESIGN = [
  'design_snapshots',
  'design_documents',
  'design_schedules',
  'design_site_info',
  'design_renders',
  'design_items',
  'design_images',
  'planner_snapshots',
];
const MANAGER_VIA_ORDER = ['order_costs', 'order_payments'];
const MINE = 'company_id IN (SELECT public.my_company_ids())';

describe('0007 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(CODE.replace(BODY, '')).not.toMatch(
      /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im
    );
  });

  test('칸 · 표 · 권한을 바꾸지 않는다', () => {
    expect(CODE).not.toMatch(/\b(ALTER\s+TABLE|DROP\s+TABLE|GRANT|CASCADE|DISABLE)\b/i);
  });

  test('CREATE POLICY 마다 바로 앞에서 같은 이름 · 같은 표를 DROP IF EXISTS 한다', () => {
    for (const s of STMTS.filter((x) => x.startsWith('CREATE POLICY '))) {
      const p = policies.find((x) => s.startsWith(`CREATE POLICY ${x.name} ON public.${x.table} `));
      const prev = STMTS[STMTS.indexOf(s) - 1];
      expect(prev).toBe(`DROP POLICY IF EXISTS ${p.name} ON public.${p.table}`);
    }
  });
});

describe('0007 — 회사 구성원 읽기', () => {
  test('읽기 정책은 모두 SELECT · TO authenticated', () => {
    const reads = policies.filter((p) => /_(member|manager)_read$/.test(p.name));
    expect(reads.length).toBe(
      MEMBER_DIRECT.length + 1 + MEMBER_VIA_DESIGN.length + MANAGER_VIA_ORDER.length
    );
    for (const p of reads)
      expect([p.name, p.cmd, p.to]).toEqual([p.name, 'SELECT', 'authenticated']);
  });

  test('designs · orders · consultations — 내 회사 행', () => {
    for (const t of MEMBER_DIRECT) expect(policy(`${t}_member_read`).rest).toBe(`USING (${MINE})`);
  });

  test('generations — 내 회사 것 중 회사가 만들었거나 프로젝트에 이은 것만', () => {
    expect(policy('generations_member_read').rest).toBe(
      `USING (${MINE} AND (origin = 'company'::text OR project_id IS NOT NULL))`
    );
  });

  test('설계에 딸린 표 — 그 설계가 내 회사 것', () => {
    for (const t of MEMBER_VIA_DESIGN) {
      expect(policy(`${t}_member_read`).rest).toBe(
        `USING (EXISTS (SELECT 1 FROM public.designs d WHERE d.id = ${t}.design_id AND d.${MINE}))`
      );
    }
  });

  test('원가 · 수금 — 그 수주가 내 회사 것이고 owner · manager', () => {
    for (const t of MANAGER_VIA_ORDER) {
      expect(policy(`${t}_manager_read`).rest).toBe(
        `USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = ${t}.order_id AND o.company_id IN (SELECT public.my_company_ids(ARRAY['owner'::text, 'manager'::text]))))`
      );
    }
  });
});

describe('0007 — 본인 정책은 본사 행으로', () => {
  const HQ = 'company_id = (SELECT public.hq_company_id())';

  test('designs 넣기 — 본인 + 본사 + 프로젝트 비움', () => {
    const p = policy('"Users can create own designs"');
    expect([p.cmd, p.to, p.rest]).toEqual([
      'INSERT',
      'PUBLIC',
      `WITH CHECK ((auth.uid() = user_id) AND ${HQ} AND project_id IS NULL)`,
    ]);
  });

  test('designs 고치기 — 본인 + 본사 (WITH CHECK 없이 USING 이 새 행도 본다)', () => {
    const p = policy('"Users can update own designs"');
    expect([p.cmd, p.to, p.rest]).toEqual([
      'UPDATE',
      'PUBLIC',
      `USING ((auth.uid() = user_id) AND ${HQ})`,
    ]);
  });

  test('consultations 넣기 — 기존 조건 그대로 + 본사 + 고객 · 프로젝트 비움', () => {
    const p = policy('"Users can insert consultations"');
    expect([p.cmd, p.to]).toEqual(['INSERT', 'PUBLIC']);
    expect(p.rest).toBe(
      `WITH CHECK ((((user_id IS NULL) OR (user_id = auth.uid())) AND public.consultation_generation_ok(generation_id) AND (notified_at IS NULL)) AND ${HQ} AND customer_id IS NULL AND project_id IS NULL)`
    );
  });

  test('본인 정책은 이 셋만 다시 만든다', () => {
    expect(policies.filter((p) => p.name.startsWith('"')).map((p) => p.name)).toEqual([
      '"Users can create own designs"',
      '"Users can update own designs"',
      '"Users can insert consultations"',
    ]);
  });
});

describe('0007 — keep_owner_links()', () => {
  const fn = SQL.match(
    /CREATE OR REPLACE FUNCTION public\.keep_owner_links\(\)[\s\S]*?\$function\$;/
  )[0];

  test('트리거 함수, SECURITY DEFINER 아님 (current_user 가 부른 역할이어야 한다)', () => {
    expect(fn).toMatch(/RETURNS trigger/);
    expect(fn).not.toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path TO 'public'/);
  });

  test('회사 칸은 누구도, 프로젝트 · 고객 칸은 anon · authenticated 가 못 바꾼다', () => {
    expect(fn).toMatch(
      /IF NEW\.company_id IS DISTINCT FROM OLD\.company_id THEN\s+RAISE EXCEPTION/
    );
    expect(fn).toMatch(/current_user IN \('anon', 'authenticated'\)/);
    for (const c of ['project_id', 'customer_id']) {
      expect(fn).toContain(
        `(to_jsonb(NEW) ->> '${c}') IS DISTINCT FROM (to_jsonb(OLD) ->> '${c}')`
      );
    }
    expect(fn.match(/USING ERRCODE = '42501'/g)).toHaveLength(2);
  });

  test('직접 부를 수 없고, designs · consultations 에 BEFORE UPDATE 로 건다', () => {
    expect(STMTS).toContain(
      'REVOKE ALL ON FUNCTION public.keep_owner_links() FROM PUBLIC, anon, authenticated, service_role'
    );
    for (const t of ['designs', 'consultations']) {
      const drop = STMTS.indexOf(`DROP TRIGGER IF EXISTS trg_${t}_keep_owner_links ON public.${t}`);
      const create = STMTS.indexOf(
        `CREATE TRIGGER trg_${t}_keep_owner_links BEFORE UPDATE ON public.${t} FOR EACH ROW EXECUTE FUNCTION public.keep_owner_links()`
      );
      expect([t, drop > -1, create > drop]).toEqual([t, true, true]);
    }
  });
});
