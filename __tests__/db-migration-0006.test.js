/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0006_owner_columns.sql 정적 시험 (DB 없이).
 *
 *   기존 다섯 표에 company_id(기본 본사) · project_id 칸, 같은 회사끼리만 잇는 복합 FK.
 *   정책 · 트리거 · 함수는 건드리지 않는다. 다시 돌려도 되게 제약은 지우고 다시 만든다 —
 *   UNIQUE (id, company_id) 는 그것을 기대는 FK 를 먼저 지워야 지워진다.
 *   역할별 실제 동작은 rls-probe + database/probes/0003-company-tables.json 의 「0006:」 줄로 본다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\r\n').join('\n');
const SQL = read('0006_owner_columns.sql');
const T0003 = read('0003_company_tables.sql');
/** 줄 주석을 뺀 본문 — 설명 글의 낱말로 시험이 통과하지 않게 */
const CODE = SQL.split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const STMTS = CODE.replace(/\s+/g, ' ')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

const COLUMNS = {
  designs: ['company_id', 'project_id'],
  orders: ['company_id', 'project_id'],
  consultations: ['company_id', 'customer_id', 'project_id'],
  generations: ['company_id', 'project_id', 'origin'],
  work_jobs: ['company_id'],
};

/** [표, 제약 이름, 문장 위치] */
const drops = STMTS.flatMap((s, i) => {
  const m = s.match(/^ALTER TABLE public\.(\w+) DROP CONSTRAINT IF EXISTS (\w+)$/);
  return m ? [[m[1], m[2], i]] : [];
});
const adds = STMTS.flatMap((s, i) => {
  const m = s.match(/^ALTER TABLE public\.(\w+) ADD CONSTRAINT (\w+) (.+)$/);
  return m ? [[m[1], m[2], i, m[3]]] : [];
});
const addOf = (name) => adds.find((a) => a[1] === name);
const dropAt = (name) => drops.find((d) => d[1] === name)?.[2] ?? -1;

describe('0006 — 형식', () => {
  test('트랜잭션 문이 없다 (도구가 감싼다)', () => {
    expect(CODE).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/im);
  });

  test('정책 · 트리거 · 함수 · 표 · 칸 지우기를 하지 않는다', () => {
    expect(CODE).not.toMatch(
      /\b(POLICY|TRIGGER|FUNCTION|REVOKE|DROP\s+TABLE|DROP\s+COLUMN|CASCADE)\b/i
    );
  });

  test('ALTER TABLE · CREATE INDEX · GRANT 문만 있다', () => {
    for (const s of STMTS)
      expect(s).toMatch(/^(ALTER TABLE public\.\w+ |CREATE INDEX IF NOT EXISTS |GRANT )/);
  });
});

describe('0006 — 칸', () => {
  const added = {};
  const noIfNotExists = [];
  for (const s of STMTS) {
    const m = s.match(/^ALTER TABLE public\.(\w+) ADD COLUMN (IF NOT EXISTS )?(\w+) (.+)$/);
    if (!m) continue;
    if (!m[2]) noIfNotExists.push(`${m[1]}.${m[3]}`);
    (added[m[1]] ||= {})[m[3]] = m[4];
  }

  test('ADD COLUMN 은 모두 IF NOT EXISTS', () => {
    expect(noIfNotExists).toEqual([]);
  });

  test('표마다 더하는 칸이 정해진 것뿐', () => {
    expect(Object.fromEntries(Object.entries(added).map(([t, c]) => [t, Object.keys(c)]))).toEqual(
      COLUMNS
    );
  });

  test('company_id 는 NOT NULL, 기본값 본사', () => {
    for (const t of Object.keys(COLUMNS)) {
      expect([t, added[t].company_id]).toEqual([t, 'uuid NOT NULL DEFAULT public.hq_company_id()']);
    }
  });

  test('project_id · customer_id 는 비울 수 있다, origin 은 기본 customer', () => {
    for (const [t, cols] of Object.entries(added)) {
      for (const c of ['project_id', 'customer_id'])
        if (cols[c]) expect([t, c, cols[c]]).toEqual([t, c, 'uuid']);
    }
    expect(added.generations.origin).toBe("text NOT NULL DEFAULT 'customer'::text");
    expect(addOf('generations_origin_check')[3]).toBe(
      "CHECK (origin = ANY (ARRAY['customer'::text, 'company'::text]))"
    );
  });
});

describe('0006 — 제약', () => {
  test('ADD CONSTRAINT 마다 앞에서 같은 표 · 같은 이름을 DROP IF EXISTS 한다', () => {
    for (const [table, name, at] of adds) {
      const d = drops.find((x) => x[1] === name);
      expect([name, d && d[0], d && d[2] < at]).toEqual([name, table, true]);
    }
  });

  test('company_id 는 모두 companies 를 가리킨다', () => {
    for (const t of Object.keys(COLUMNS)) {
      expect(addOf(`${t}_company_id_fkey`)[3]).toBe(
        'FOREIGN KEY (company_id) REFERENCES public.companies(id)'
      );
    }
  });

  test('복합 FK — 같은 회사끼리만, 지울 때 동작', () => {
    const fk = (name) => addOf(name)[3];
    expect(fk('designs_project_fkey')).toBe(
      'FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE SET NULL (project_id)'
    );
    expect(fk('orders_design_company_fkey')).toBe(
      'FOREIGN KEY (design_id, company_id) REFERENCES public.designs(id, company_id) ON DELETE RESTRICT'
    );
    expect(fk('orders_project_fkey')).toBe(
      'FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE RESTRICT'
    );
    expect(fk('consultations_customer_fkey')).toBe(
      'FOREIGN KEY (customer_id, company_id) REFERENCES public.customers(id, company_id) ON DELETE SET NULL (customer_id)'
    );
    expect(fk('consultations_project_fkey')).toBe(
      'FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE SET NULL (project_id)'
    );
    expect(fk('generations_project_fkey')).toBe(
      'FOREIGN KEY (project_id, company_id) REFERENCES public.projects(id, company_id) ON DELETE SET NULL (project_id)'
    );
  });

  test('복합 FK 가 가리키는 UNIQUE (id, company_id) 가 있다', () => {
    expect(addOf('projects_id_company_id_key')[3]).toBe('UNIQUE (id, company_id)');
    expect(addOf('designs_id_company_id_key')[3]).toBe('UNIQUE (id, company_id)');
    expect(T0003).toMatch(/CONSTRAINT customers_id_company_id_key UNIQUE \(id, company_id\)/);
  });

  test('UNIQUE 를 지우기 전에 그것을 기대는 FK 를 먼저 지운다 (다시 돌릴 때)', () => {
    const projectFks = adds.filter((a) =>
      / REFERENCES public\.projects\(id, company_id\)/.test(a[3])
    );
    const designFks = adds.filter((a) =>
      / REFERENCES public\.designs\(id, company_id\)/.test(a[3])
    );
    expect(projectFks.length).toBe(4);
    expect(designFks.length).toBe(1);
    for (const [, name] of projectFks)
      expect(dropAt(name)).toBeLessThan(dropAt('projects_id_company_id_key'));
    for (const [, name] of designFks)
      expect(dropAt(name)).toBeLessThan(dropAt('designs_id_company_id_key'));
    // 다시 만들 때는 UNIQUE 가 먼저
    for (const [, , at] of [...projectFks, ...designFks]) {
      expect(at).toBeGreaterThan(addOf('projects_id_company_id_key')[2]);
      expect(at).toBeGreaterThan(addOf('designs_id_company_id_key')[2]);
    }
  });
});

describe('0006 — 권한 · 색인', () => {
  test('GRANT 는 generations 새 칸 셋의 SELECT 를 authenticated 에만', () => {
    expect(STMTS.filter((s) => s.startsWith('GRANT '))).toEqual([
      'GRANT SELECT (company_id, project_id, origin) ON public.generations TO authenticated',
    ]);
  });

  test('표마다 company_id 색인, 프로젝트 · 고객 칸은 부분 색인', () => {
    const idx = STMTS.filter((s) => s.startsWith('CREATE INDEX'));
    for (const t of Object.keys(COLUMNS)) {
      expect(idx).toContain(
        `CREATE INDEX IF NOT EXISTS idx_${t}_company ON public.${t} USING btree (company_id, created_at DESC)`
      );
      for (const c of COLUMNS[t].filter((x) => x === 'project_id' || x === 'customer_id')) {
        const short = c.replace('_id', '');
        expect(idx).toContain(
          `CREATE INDEX IF NOT EXISTS idx_${t}_${short} ON public.${t} USING btree (${c}) WHERE (${c} IS NOT NULL)`
        );
      }
    }
  });
});
