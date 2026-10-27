/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0003_company_tables.sql 정적 시험 (DB 없이).
 * 역할별 실제 동작은 scripts/rls-probe.mjs + database/probes/0003-company-tables.json 으로 본다 (라이브, ROLLBACK).
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'database', 'migrations', '0003_company_tables.sql');
const SQL = fs.readFileSync(FILE, 'utf8').split('\r\n').join('\n');
/** 줄 주석을 뺀 본문 (함수 본문 안에도 -- 주석은 없다) */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const TABLES = ['companies', 'company_members', 'customers', 'projects', 'company_events'];
const FUNCS = ['hq_company_id', 'my_company_ids', 'is_company_member', 'my_customer_ids'];

const policies = [
  ...CODE.matchAll(/CREATE POLICY (\w+) ON public\.(\w+)\s+FOR (\w+)\s+TO ([^\n]+)\n([\s\S]*?);/g),
].map((m) => ({
  name: m[1],
  table: m[2],
  cmd: m[3],
  roles: m[4].trim(),
  body: m[5].replace(/\s+/g, ' ').trim(),
  at: m.index,
}));
const tableBody = (t) => {
  const m = CODE.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(([\\s\\S]*?)\\n\\);`)
  );
  return m ? m[1] : '';
};

describe('0003 — 형식', () => {
  test('트랜잭션 문이 없다', () => {
    expect(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\s*;/im.test(CODE)).toBe(false);
  });

  test('다시 돌려도 된다 — 표 · 인덱스 IF NOT EXISTS, 정책 · 트리거는 DROP IF EXISTS 다음 CREATE', () => {
    for (const t of TABLES)
      expect([t, CODE.includes(`CREATE TABLE IF NOT EXISTS public.${t} (`)]).toEqual([t, true]);
    expect(CODE.match(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)).toBeNull();
    for (const p of policies) {
      const drop = CODE.lastIndexOf(`DROP POLICY IF EXISTS ${p.name} ON public.${p.table};`, p.at);
      expect([p.name, drop >= 0]).toEqual([p.name, true]);
    }
    for (const m of CODE.matchAll(/CREATE TRIGGER (\w+) [^\n]* ON public\.(\w+) /g)) {
      expect([m[1], CODE.includes(`DROP TRIGGER IF EXISTS ${m[1]} ON public.${m[2]};`)]).toEqual([
        m[1],
        true,
      ]);
    }
  });

  test('기존 표는 건드리지 않는다 — ALTER · 정책 · 칸 추가는 새 표에만', () => {
    for (const m of CODE.matchAll(/ALTER TABLE (?:ONLY )?public\.(\w+)/g))
      expect(TABLES).toContain(m[1]);
    for (const m of CODE.matchAll(/(?:DROP|CREATE) POLICY (?:IF EXISTS )?\w+ ON (\w+)\.(\w+)/g)) {
      expect([m[1], TABLES.includes(m[2])]).toEqual(['public', true]);
    }
    expect(/ADD COLUMN/i.test(CODE)).toBe(false);
    expect(/\btier\b/i.test(CODE)).toBe(false); // expert · agent 회원을 회사로 바꾸지 않는다
  });
});

describe('0003 — 표 정의', () => {
  test('companies: kind hq|partner, 본사 하나, plan 은 파트너만 expert|agent, status 6가지, partner_id → partners', () => {
    const t = tableBody('companies');
    expect(t).toMatch(/kind = ANY \(ARRAY\['hq'::text, 'partner'::text\]\)/);
    expect(t).toMatch(
      /plan IS NULL OR \(kind = 'partner'::text AND plan = ANY \(ARRAY\['expert'::text, 'agent'::text\]\)\)/
    );
    expect(t).toMatch(
      /status = ANY \(ARRAY\['applied'::text, 'meeting'::text, 'active'::text, 'held'::text, 'suspended'::text, 'closed'::text\]\)/
    );
    expect(t).toMatch(/FOREIGN KEY \(partner_id\) REFERENCES public\.partners\(id\)/);
    expect(CODE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS companies_one_hq ON public\.companies USING btree \(kind\) WHERE \(kind = 'hq'::text\);/
    );
  });

  test('company_members: owner|manager|staff, active|removed, 한 사람은 한 회사에서만 active', () => {
    const t = tableBody('company_members');
    expect(t).toMatch(/role = ANY \(ARRAY\['owner'::text, 'manager'::text, 'staff'::text\]\)/);
    expect(t).toMatch(/status = ANY \(ARRAY\['active'::text, 'removed'::text\]\)/);
    expect(CODE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS company_members_one_active_company ON public\.company_members USING btree \(user_id\) WHERE \(status = 'active'::text\);/
    );
  });

  test('customers: 회사별, user_id 는 비어도 된다, (id, company_id) 유니크 — 연락처로 잇는 문장이 없다', () => {
    const t = tableBody('customers');
    expect(t).toMatch(/\n\s+company_id uuid NOT NULL,/);
    expect(t).toMatch(/\n\s+user_id uuid,/);
    expect(t).toMatch(/CONSTRAINT customers_id_company_id_key UNIQUE \(id, company_id\)/);
    expect(/UPDATE public\.customers/i.test(CODE)).toBe(false);
    expect(/phone\s*=/i.test(CODE)).toBe(false);
  });

  test('projects: 복합 FK (customer_id, company_id), status 4가지, 넘기기는 origin_project_id 한 번', () => {
    const t = tableBody('projects');
    expect(t).toMatch(
      /FOREIGN KEY \(customer_id, company_id\) REFERENCES public\.customers\(id, company_id\)/
    );
    expect(t).toMatch(
      /status = ANY \(ARRAY\['active'::text, 'closed'::text, 'cancelled'::text, 'handed_over'::text\]\)/
    );
    expect(t).toMatch(/FOREIGN KEY \(origin_project_id\) REFERENCES public\.projects\(id\)/);
    expect(CODE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS projects_origin_once ON public\.projects USING btree \(origin_project_id\)/
    );
  });

  test('company_events: 추가만 — UPDATE · DELETE 권한 · 정책 없음, service_role 도 회수', () => {
    expect(CODE).toMatch(/GRANT SELECT, INSERT ON TABLE public\.company_events TO authenticated;/);
    expect(CODE).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public\.company_events FROM service_role;/
    );
    expect(
      policies.filter((p) => p.table === 'company_events' && /UPDATE|DELETE|ALL/.test(p.cmd))
    ).toEqual([]);
    const t = tableBody('company_events');
    expect(/\b(name|phone|email|address)\b/.test(t)).toBe(false);
  });
});

describe('0003 — 함수', () => {
  test.each(FUNCS)(
    '%s: SECURITY DEFINER · STABLE · search_path public, PUBLIC 회수, anon · authenticated 실행',
    (fn) => {
      const def = CODE.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${fn}\\(([^)]*)\\)([\\s\\S]*?)AS \\$function\\$`
        )
      );
      expect(def).not.toBeNull();
      expect(def[2]).toMatch(/STABLE SECURITY DEFINER/);
      expect(def[2]).toMatch(/SET search_path TO 'public'/);
      expect(CODE).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC`)
      );
      expect(CODE).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO anon, authenticated`)
      );
    }
  );

  test('my_company_ids · is_company_member 는 active 구성원만, 역할로 거를 수 있다', () => {
    for (const fn of ['my_company_ids', 'is_company_member']) {
      const body = CODE.match(
        new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`)
      )[1];
      expect(body).toMatch(/m\.status = 'active'/);
      expect(body).toMatch(/m\.user_id = auth\.uid\(\)/);
      expect(body).toMatch(/p_roles IS NULL OR m\.role = ANY \(p_roles\)/);
    }
  });
});

describe('0003 — RLS', () => {
  test('새 표 모두 RLS 켬, anon 권한 없음', () => {
    for (const t of TABLES)
      expect(CODE).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    expect(CODE).toMatch(
      /REVOKE ALL ON TABLE public\.companies, public\.company_members, public\.customers, public\.projects, public\.company_events FROM PUBLIC, anon, authenticated;/
    );
    expect(
      /GRANT [^;]* TO [^;]*\banon\b[^;]*;/.test(
        CODE.replace(/GRANT EXECUTE ON FUNCTION[^;]*;/g, '')
      )
    ).toBe(false);
  });

  test('정책은 모두 authenticated 에만, 함수 · auth.uid() 는 (SELECT …) 로 감싼다', () => {
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      expect([p.name, p.roles]).toEqual([p.name, 'authenticated']);
      const bare = p.body
        .replace(/\(SELECT public\.is_admin\(\)\)/g, '')
        .replace(/IN \(SELECT public\.my_company_ids\(\)\)/g, '')
        .replace(/IN \(SELECT public\.my_customer_ids\(\)\)/g, '')
        .replace(/\(SELECT auth\.uid\(\)\)/g, '');
      expect([p.name, /is_admin|my_company_ids|my_customer_ids|auth\.uid/.test(bare)]).toEqual([
        p.name,
        false,
      ]);
    }
  });

  test('쓰기 정책(INSERT · UPDATE · DELETE)은 관리자만', () => {
    const writes = policies.filter((p) => p.cmd !== 'SELECT');
    expect(writes.length).toBeGreaterThan(0);
    for (const p of writes) {
      expect([p.name, /_admin_(insert|update|delete)$/.test(p.name)]).toEqual([p.name, true]);
      expect([
        p.name,
        p.body
          .replace(/\(SELECT public\.is_admin\(\)\)/g, 'X')
          .replace(/USING|WITH CHECK|\(|\)|X|\s/g, ''),
      ]).toEqual([p.name, '']);
    }
  });

  test('읽기: 구성원 · 고객 본인 · 관리자, 고객 · 프로젝트 관리자 읽기 바로 위에 TODO', () => {
    const reads = policies
      .filter((p) => p.cmd === 'SELECT')
      .map((p) => p.name)
      .sort();
    expect(reads).toEqual(
      [
        'companies_admin_read',
        'companies_member_read',
        'company_events_admin_read',
        'company_events_member_read',
        'company_members_admin_read',
        'company_members_member_read',
        'company_members_own_read',
        'customers_admin_read',
        'customers_member_read',
        'customers_self_read',
        'projects_admin_read',
        'projects_customer_read',
        'projects_member_read',
      ].sort()
    );
    for (const name of ['customers_admin_read', 'projects_admin_read']) {
      const at = SQL.indexOf(`DROP POLICY IF EXISTS ${name} ON`);
      const before = SQL.slice(Math.max(0, at - 300), at);
      expect([name, /TODO:.*파트너/.test(before)]).toEqual([name, true]);
    }
  });
});

describe('0003 — 시드', () => {
  test("본사 '다담가구' 하나 — 없을 때만", () => {
    expect(CODE).toMatch(
      /INSERT INTO public\.companies \(kind, name, status\)\nSELECT 'hq', '다담가구', 'active'\nWHERE NOT EXISTS \(SELECT 1 FROM public\.companies WHERE kind = 'hq'\);/
    );
  });

  test('본사 owner 는 super_admin 이 정확히 한 명일 때 그 계정만 — 이메일을 적지 않는다', () => {
    const seed = CODE.slice(CODE.indexOf('INSERT INTO public.company_members'));
    expect(seed).toMatch(/a\.role = 'super_admin'/);
    expect(seed).toMatch(
      /\(SELECT count\(\*\) FROM public\.admin_roles WHERE role = 'super_admin'\) = 1/
    );
    expect(seed).toMatch(/'owner', 'active'/);
    expect(/@/.test(CODE)).toBe(false);
  });
});
