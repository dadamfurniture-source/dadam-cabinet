#!/usr/bin/env node
// ============================================================
// DB 스키마 덤프 — 라이브 DB 의 앱 객체를 SQL 로 찍는다 (행 데이터 없음).
//
// pg_dump 없이 Postgres 카탈로그와 pg_get_* 함수로 만든다. 같은 DB 를 두 번 찍으면 결과가 똑같다
// (이름 순 정렬 · 날짜 없음). 줄바꿈은 LF 로 맞춘다 (CRLF 로 저장된 함수 본문도 LF 로 나온다).
//
//   담는 것:   public 스키마 — 확장(CREATE EXTENSION IF NOT EXISTS), 타입(enum · domain · composite),
//              시퀀스, 테이블(열 · 기본값 · NOT NULL), 제약(CHECK · PK · UNIQUE · FK 와 ON DELETE),
//              인덱스, 뷰(security_invoker 같은 옵션), 함수(pg_get_functiondef — SECURITY DEFINER ·
//              search_path 포함), 트리거, RLS 켜짐, 정책, 권한(GRANT/REVOKE — PUBLIC · anon ·
//              authenticated · service_role), 설명(COMMENT), 퍼블리케이션 소속
//              public 밖에서 앱이 만든 것 — storage 버킷 정의(INSERT … ON CONFLICT), storage 정책,
//              Supabase 테이블(auth.users 등)에 걸린 public 함수 트리거, public 함수를 부르는 이벤트 트리거
//   빼는 것:   행 데이터 전부, Supabase 가 관리하는 스키마(auth · storage · realtime · vault ·
//              extensions …)의 자체 객체, 확장이 만든 객체(vector 의 타입 · 함수 등), 소유자(OWNER)
//
// 접속은 BEGIN READ ONLY 안에서만 하고 끝나면 ROLLBACK 한다. search_path 를 비워 모든 이름이
// 스키마까지 붙어 나오게 한다.
//
// 쓰는 법:
//   node scripts/db-dump-schema.mjs                         표준 출력으로
//   node scripts/db-dump-schema.mjs --out <파일>            파일로
//   node scripts/db-dump-schema.mjs --baseline --out <파일> 기준선 머리말(찍은 날짜)을 붙여서
//                                   [--taken YYYY-MM-DD]    날짜를 정해 주기 (기본: 오늘, 한국 시간)
// 접속값은 scripts/db-connect.mjs 참고. 객체 개수는 표준 오류로 찍는다.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './db-connect.mjs';

/** 확장이 만든 객체(pg_depend deptype 'e')가 아니다 */
const notExt = (catalog, alias) =>
  `not exists (select 1 from pg_depend e where e.classid = '${catalog}'::regclass and e.objid = ${alias}.oid and e.deptype = 'e')`;

const Q = {
  server: `select current_setting('server_version') as version`,

  allPrivs: `select
      array(select privilege_type from aclexplode(acldefault('r', 10::oid))) as r,
      array(select privilege_type from aclexplode(acldefault('s', 10::oid))) as s,
      array(select privilege_type from aclexplode(acldefault('f', 10::oid))) as f`,

  extensions: `select quote_ident(e.extname) as q, quote_ident(n.nspname) as schema, e.extversion as version
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname <> 'plpgsql'
    order by e.extname collate "C"`,

  enums: `select t.oid::regtype::text as q,
      array(select quote_literal(enumlabel) from pg_enum where enumtypid = t.oid order by enumsortorder) as labels
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e' and ${notExt('pg_type', 't')}
    order by t.typname collate "C"`,

  domains: `select t.oid::regtype::text as q, format_type(t.typbasetype, t.typtypmod) as base, t.typnotnull as notnull,
      t.typdefault as def,
      (select quote_ident(cn.nspname) || '.' || quote_ident(co.collname) from pg_collation co
         join pg_namespace cn on cn.oid = co.collnamespace
        where co.oid = t.typcollation and t.typcollation <> bt.typcollation) as coll,
      array(select 'CONSTRAINT ' || quote_ident(c.conname) || ' ' || pg_get_constraintdef(c.oid)
              from pg_constraint c where c.contypid = t.oid order by c.conname collate "C") as checks
    from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_type bt on bt.oid = t.typbasetype
    where n.nspname = 'public' and t.typtype = 'd' and ${notExt('pg_type', 't')}
    order by t.typname collate "C"`,

  composites: `select t.oid::regtype::text as q,
      array(select quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod)
              from pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped
             order by a.attnum) as cols
    from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_class c on c.oid = t.typrelid
    where n.nspname = 'public' and t.typtype = 'c' and c.relkind = 'c' and ${notExt('pg_type', 't')}
    order by t.typname collate "C"`,

  sequences: `select c.oid::regclass::text as q, format_type(s.seqtypid, null) as type, s.seqstart::text as start,
      s.seqincrement::text as inc, s.seqmin::text as min, s.seqmax::text as max, s.seqcache::text as cache,
      s.seqcycle as cycle,
      (select dc.oid::regclass::text || '.' || quote_ident(a.attname)
         from pg_depend d join pg_class dc on dc.oid = d.refobjid
         join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.refclassid = 'pg_class'::regclass
          and d.deptype = 'a') as owned_by
    from pg_sequence s join pg_class c on c.oid = s.seqrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and ${notExt('pg_class', 'c')}
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'i')
    order by c.relname collate "C"`,

  tables: `select c.oid::text as oid, c.oid::regclass::text as q, c.relkind, c.relpersistence, c.relispartition,
      c.relrowsecurity as rls, c.relforcerowsecurity as force_rls, c.reloptions
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and ${notExt('pg_class', 'c')}
    order by c.relname collate "C"`,

  columns: `select a.attrelid::text as relid, quote_ident(a.attname) as q, format_type(a.atttypid, a.atttypmod) as type,
      a.attnotnull as notnull, a.attidentity as identity, a.attgenerated as generated,
      pg_get_expr(d.adbin, d.adrelid) as def,
      exists(select 1 from pg_depend dp join pg_proc p on p.oid = dp.refobjid
               join pg_namespace pn on pn.oid = p.pronamespace
              where dp.classid = 'pg_attrdef'::regclass and dp.objid = d.oid
                and dp.refclassid = 'pg_proc'::regclass and pn.nspname = 'public') as def_late,
      (select quote_ident(cn.nspname) || '.' || quote_ident(co.collname) from pg_collation co
         join pg_namespace cn on cn.oid = co.collnamespace
        where co.oid = a.attcollation and a.attcollation <> t.typcollation) as coll
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
    order by c.relname collate "C", a.attnum`,

  constraints: `select c.oid::regclass::text as tq, quote_ident(co.conname) as q, co.contype, pg_get_constraintdef(co.oid) as def
    from pg_constraint co join pg_class c on c.oid = co.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and co.contype in ('c', 'p', 'u', 'x', 'f')
      and co.conislocal and ${notExt('pg_class', 'c')}
    order by c.relname collate "C", co.conname collate "C"`,

  indexes: `select pg_get_indexdef(i.indexrelid) as def
    from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'm') and ${notExt('pg_class', 'c')}
      and not exists (select 1 from pg_constraint co where co.conindid = i.indexrelid and co.conrelid = i.indrelid
                        and co.contype in ('p', 'u', 'x'))
    order by c.relname collate "C", ic.relname collate "C"`,

  views: `select c.oid::text as oid, c.oid::regclass::text as q, c.relname as name, c.relkind, c.reloptions,
      pg_get_viewdef(c.oid) as def
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm') and ${notExt('pg_class', 'c')}
    order by c.relname collate "C"`,

  functions: `select p.oid::text as oid, p.proname as name, p.oid::regprocedure::text as sig, p.prokind,
      case when p.prokind <> 'a' then pg_get_functiondef(p.oid) end as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and ${notExt('pg_proc', 'p')}
    order by p.proname collate "C", p.oid::regprocedure::text collate "C"`,

  // 뷰 · 함수 사이의 의존 (from 이 to 에 기댄다 → to 를 먼저 만든다). 양끝이 둘 다 덤프 대상일 때만 쓴다.
  routineDeps: `select 'c' || r.ev_class::text as from_key,
        case when d.refclassid = 'pg_class'::regclass then 'c' else 'p' end || d.refobjid::text as to_key
      from pg_rewrite r join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
     where d.refclassid in ('pg_class'::regclass, 'pg_proc'::regclass) and d.refobjid <> r.ev_class
    union
    select 'p' || d.objid::text,
        case when d.refclassid = 'pg_class'::regclass then 'c' else 'p' end || d.refobjid::text
      from pg_depend d
     where d.classid = 'pg_proc'::regclass and d.refclassid in ('pg_class'::regclass, 'pg_proc'::regclass)
       and d.objid <> d.refobjid
    union
    select 'p' || d.objid::text, 'c' || coalesce(nullif(t.typrelid, 0), et.typrelid)::text
      from pg_depend d join pg_type t on t.oid = d.refobjid left join pg_type et on et.oid = t.typelem
     where d.classid = 'pg_proc'::regclass and d.refclassid = 'pg_type'::regclass
       and coalesce(nullif(t.typrelid, 0), et.typrelid, 0) <> 0`,

  triggers: `select c.oid::regclass::text as tq, quote_ident(t.tgname) as q, pg_get_triggerdef(t.oid) as def, t.tgenabled as enabled
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname = 'public' and ${notExt('pg_class', 'c')}
    order by c.relname collate "C", t.tgname collate "C"`,

  // Supabase 가 관리하는 테이블(auth.users 등)에 앱이 건 트리거 — 함수가 public 에 있는 것
  foreignTriggers: `select c.oid::regclass::text as tq, quote_ident(t.tgname) as q, pg_get_triggerdef(t.oid) as def, t.tgenabled as enabled
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and n.nspname <> 'public' and pn.nspname = 'public'
    order by n.nspname collate "C", c.relname collate "C", t.tgname collate "C"`,

  policies: `select n.nspname as schema, c.oid::regclass::text as tq, quote_ident(pol.polname) as q, pol.polcmd as cmd,
      pol.polpermissive as permissive,
      array(select case when r = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(r)) end from unnest(pol.polroles) r) as roles,
      pg_get_expr(pol.polqual, pol.polrelid) as qual, pg_get_expr(pol.polwithcheck, pol.polrelid) as chk
    from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'storage')
    order by n.nspname collate "C", c.relname collate "C", pol.polname collate "C"`,

  relAcl: `select c.oid::regclass::text as q, c.relkind,
      case when x.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end as grantee,
      x.grantee = c.relowner as is_owner, x.privilege_type as priv, x.is_grantable as grantable
    from pg_class c join pg_namespace n on n.oid = c.relnamespace,
      aclexplode(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) x
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') and ${notExt('pg_class', 'c')}
    order by c.relname collate "C"`,

  colAcl: `select c.oid::regclass::text as q, quote_ident(a.attname) as col, a.attnum,
      case when x.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end as grantee,
      x.privilege_type as priv, x.is_grantable as grantable
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace,
      aclexplode(a.attacl) x
    where n.nspname = 'public' and a.attacl is not null and a.attnum > 0 and not a.attisdropped
      and ${notExt('pg_class', 'c')}
    order by c.relname collate "C", a.attnum`,

  procAcl: `select p.oid::regprocedure::text as sig, p.prokind,
      case when x.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(x.grantee)) end as grantee,
      x.grantee = p.proowner as is_owner, x.privilege_type as priv, x.is_grantable as grantable
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
      aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    where n.nspname = 'public' and ${notExt('pg_proc', 'p')}
    order by p.proname collate "C", p.oid::regprocedure::text collate "C"`,

  relComments: `select c.oid::regclass::text as tq, c.relkind, d.objsubid as sub,
      (select quote_ident(attname) from pg_attribute where attrelid = c.oid and attnum = d.objsubid) as col,
      quote_literal(d.description) as lit
    from pg_description d join pg_class c on d.classoid = 'pg_class'::regclass and c.oid = d.objoid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and ${notExt('pg_class', 'c')}
    order by c.relname collate "C", d.objsubid`,

  otherComments: `select * from (
      select 'FUNCTION ' || p.oid::regprocedure::text as target, quote_literal(d.description) as lit, 1 as grp,
             p.proname as k1, p.oid::regprocedure::text as k2
        from pg_description d join pg_proc p on d.classoid = 'pg_proc'::regclass and p.oid = d.objoid
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and ${notExt('pg_proc', 'p')}
      union all
      select 'CONSTRAINT ' || quote_ident(co.conname) || ' ON ' || c.oid::regclass::text, quote_literal(d.description), 2,
             c.relname, co.conname
        from pg_description d join pg_constraint co on d.classoid = 'pg_constraint'::regclass and co.oid = d.objoid
        join pg_class c on c.oid = co.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
      union all
      select 'TRIGGER ' || quote_ident(t.tgname) || ' ON ' || c.oid::regclass::text, quote_literal(d.description), 3,
             c.relname, t.tgname
        from pg_description d join pg_trigger t on d.classoid = 'pg_trigger'::regclass and t.oid = d.objoid
        join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
      union all
      select 'POLICY ' || quote_ident(pol.polname) || ' ON ' || c.oid::regclass::text, quote_literal(d.description), 4,
             c.relname, pol.polname
        from pg_description d join pg_policy pol on d.classoid = 'pg_policy'::regclass and pol.oid = d.objoid
        join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'storage')
      union all
      select (case when t.typtype = 'd' then 'DOMAIN ' else 'TYPE ' end) || t.oid::regtype::text, quote_literal(d.description), 5,
             t.typname, ''
        from pg_description d join pg_type t on d.classoid = 'pg_type'::regclass and t.oid = d.objoid
        join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and ${notExt('pg_type', 't')}
    ) x order by grp, k1 collate "C", k2 collate "C"`,

  publications: `select quote_ident(p.pubname) as pub, c.oid::regclass::text as tq,
      pr.prqual is not null as has_qual, pr.prattrs is not null as has_cols
    from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    order by p.pubname collate "C", c.relname collate "C"`,

  buckets: `select quote_literal(id) as id, quote_literal(name) as name, public::text as public,
      coalesce(file_size_limit::text, 'NULL') as size_limit,
      case when allowed_mime_types is null then 'NULL' else quote_literal(allowed_mime_types::text) || '::text[]' end as mimes
    from storage.buckets
    order by id collate "C"`,

  eventTriggers: `select quote_ident(e.evtname) as q, e.evtevent as event, e.evtenabled as enabled,
      array(select quote_literal(t) from unnest(e.evttags) t) as tags, p.oid::regproc::text as fn
    from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by e.evtname collate "C"`,

  // 이 덤프가 아직 다루지 않는 종류가 public 에 있으면 알린다
  unsupported: `select kind, count(*)::int as n from (
      select 'type ' || t.typtype::text as kind from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typtype in ('b', 'r', 'm') and ${notExt('pg_type', 't')}
         and t.typelem = 0 and t.typrelid = 0
      union all select 'aggregate' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'a' and ${notExt('pg_proc', 'p')}
      union all select 'relkind ' || c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('f', 'p') and ${notExt('pg_class', 'c')}
      union all select 'partition' from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relispartition
      union all select 'inheritance' from pg_inherits i join pg_class c on c.oid = i.inhrelid
        join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
      union all select 'rule' from pg_rewrite r join pg_class c on c.oid = r.ev_class
        join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and r.rulename <> '_RETURN'
      union all select 'operator' from pg_operator o join pg_namespace n on n.oid = o.oprnamespace
       where n.nspname = 'public' and ${notExt('pg_operator', 'o')}
      union all select 'statistics' from pg_statistic_ext s join pg_namespace n on n.oid = s.stxnamespace
       where n.nspname = 'public'
      union all select 'publication schema' from pg_publication_namespace pn join pg_namespace n on n.oid = pn.pnnspid
       where n.nspname = 'public'
      union all select 'replica identity' from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relreplident <> 'd'
    ) x group by kind order by kind collate "C"`,
};

const PRIV_ORDER = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
  'USAGE',
  'EXECUTE',
];
const API_ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortRoles = (roles) =>
  [...roles].sort((a, b) => (a === 'PUBLIC' ? -1 : b === 'PUBLIC' ? 1 : cmp(a, b)));
const CMD = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' };
const ENABLE = { D: 'DISABLE', R: 'ENABLE REPLICA', A: 'ENABLE ALWAYS' };

/** reloptions ["security_invoker=on"] → WITH (security_invoker='on') */
function withOptions(reloptions) {
  if (!reloptions || !reloptions.length) return '';
  const parts = [...reloptions].sort(cmp).map((o) => {
    const i = o.indexOf('=');
    return i < 0 ? o : `${o.slice(0, i)}='${o.slice(i + 1).replace(/'/g, "''")}'`;
  });
  return ` WITH (${parts.join(', ')})`;
}

const stripSemi = (s) => s.trim().replace(/;\s*$/, '');

/**
 * 권한 줄 만들기. rows: 한 객체의 { grantee, is_owner, priv, grantable }.
 * 소유자 권한은 빼고, API 역할(과 실제로 받은 역할)에서 모두 거둔 뒤 받은 그대로 다시 준다.
 */
function grantLines(kind, target, rows, allPrivs) {
  const byGrantee = new Map();
  for (const r of rows) {
    if (r.is_owner) continue;
    if (!byGrantee.has(r.grantee)) byGrantee.set(r.grantee, { plain: new Set(), grant: new Set() });
    byGrantee.get(r.grantee)[r.grantable ? 'grant' : 'plain'].add(r.priv);
  }
  const revokeFrom = sortRoles(new Set([...API_ROLES, ...byGrantee.keys()]));
  const lines = [`REVOKE ALL ON ${kind} ${target} FROM ${revokeFrom.join(', ')};`];
  const privText = (set) => {
    if (allPrivs.length && allPrivs.every((p) => set.has(p)) && set.size === allPrivs.length)
      return 'ALL';
    return [...set].sort((a, b) => PRIV_ORDER.indexOf(a) - PRIV_ORDER.indexOf(b)).join(', ');
  };
  // 같은 권한 묶음을 받은 역할끼리 한 줄로
  const groups = new Map();
  for (const grantee of sortRoles(byGrantee.keys())) {
    const { plain, grant } = byGrantee.get(grantee);
    for (const [set, opt] of [
      [plain, ''],
      [grant, ' WITH GRANT OPTION'],
    ]) {
      if (!set.size) continue;
      const key = privText(set) + opt;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(grantee);
    }
  }
  for (const [key, grantees] of groups) {
    const opt = key.endsWith(' WITH GRANT OPTION') ? ' WITH GRANT OPTION' : '';
    const privs = opt ? key.slice(0, -opt.length) : key;
    lines.push(`GRANT ${privs} ON ${kind} ${target} TO ${grantees.join(', ')}${opt};`);
  }
  return lines;
}

/** 열 단위 권한: (역할, 권한) 마다 열 목록 한 줄 */
function columnGrantLines(target, rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.priv}\u0000${r.grantee}\u0000${r.grantable ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { ...r, cols: [] });
    groups.get(key).cols.push(r.col);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        PRIV_ORDER.indexOf(a.priv) - PRIV_ORDER.indexOf(b.priv) ||
        cmp(a.grantee, b.grantee) ||
        Number(a.grantable) - Number(b.grantable)
    )
    .map(
      (g) =>
        `GRANT ${g.priv} (${g.cols.join(', ')}) ON TABLE ${target} TO ${g.grantee}${g.grantable ? ' WITH GRANT OPTION' : ''};`
    );
}

/** 뷰 · 함수를 의존 순서로 (막힘 없는 것 중 함수 먼저, 그다음 이름 순) */
function orderRoutines(nodes, deps) {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const needs = new Map(nodes.map((n) => [n.key, new Set()]));
  for (const d of deps) {
    if (d.from_key !== d.to_key && byKey.has(d.from_key) && byKey.has(d.to_key))
      needs.get(d.from_key).add(d.to_key);
  }
  const rank = (n) => `${n.kindRank}\u0000${n.sortName}`;
  const done = new Set();
  const out = [];
  while (out.length < nodes.length) {
    const ready = nodes.filter(
      (n) => !done.has(n.key) && [...needs.get(n.key)].every((k) => done.has(k))
    );
    if (!ready.length) {
      const left = nodes.filter((n) => !done.has(n.key)).map((n) => n.label);
      throw new Error(`뷰 · 함수 의존이 돌고 돈다: ${left.join(', ')}`);
    }
    ready.sort((a, b) => cmp(rank(a), rank(b)));
    done.add(ready[0].key);
    out.push(ready[0]);
  }
  return out;
}

const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

/**
 * 접속한 client 로 덤프한다. 읽기 전용 트랜잭션을 스스로 열고 ROLLBACK 한다.
 * @returns {Promise<{ body: string, counts: Record<string, number>, version: string, warnings: string[] }>}
 */
export async function dumpSchema(client) {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query(`select set_config('search_path', '', true)`);
    const R = {};
    for (const [name, sql] of Object.entries(Q)) R[name] = (await client.query(sql)).rows;
    return build(R);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
}

function build(R) {
  const version = R.server[0].version;
  const allPrivs = R.allPrivs[0];
  const warnings = R.unsupported.map((u) => `덤프가 다루지 않는 객체: ${u.kind} × ${u.n}`);
  const out = [];
  const counts = {};
  const section = (title) =>
    out.push('', `-- ${'-'.repeat(60)}`, `-- ${title}`, `-- ${'-'.repeat(60)}`, '');

  out.push('SET check_function_bodies = false;', 'SET client_min_messages = warning;');

  section('확장');
  for (const e of R.extensions)
    out.push(`CREATE EXTENSION IF NOT EXISTS ${e.q} WITH SCHEMA ${e.schema}; -- ${e.version}`);
  counts.extensions = R.extensions.length;

  if (R.enums.length || R.domains.length || R.composites.length) {
    section('타입');
    for (const t of R.enums) out.push(`CREATE TYPE ${t.q} AS ENUM (${t.labels.join(', ')});`);
    for (const t of R.composites)
      out.push(`CREATE TYPE ${t.q} AS (\n    ${t.cols.join(',\n    ')}\n);`);
    for (const d of R.domains) {
      let s = `CREATE DOMAIN ${d.q} AS ${d.base}`;
      if (d.coll) s += ` COLLATE ${d.coll}`;
      if (d.def != null) s += ` DEFAULT ${d.def}`;
      if (d.notnull) s += ' NOT NULL';
      for (const c of d.checks) s += `\n    ${c}`;
      out.push(`${s};`);
    }
  }
  counts.types = R.enums.length + R.domains.length + R.composites.length;

  section('시퀀스');
  for (const s of R.sequences) {
    out.push(
      `CREATE SEQUENCE ${s.q}\n    AS ${s.type}\n    START WITH ${s.start}\n    INCREMENT BY ${s.inc}\n` +
        `    MINVALUE ${s.min}\n    MAXVALUE ${s.max}\n    CACHE ${s.cache}${s.cycle ? '\n    CYCLE' : ''};`
    );
  }
  counts.sequences = R.sequences.length;

  section('테이블');
  const colsByRel = groupBy(R.columns, 'relid');
  const lateDefaults = [];
  for (const t of R.tables) {
    if (t.relkind === 'p' || t.relispartition)
      warnings.push(`파티션 테이블은 단순 테이블로 찍힌다: ${t.q}`);
    const cols = (colsByRel.get(t.oid) || []).map((c) => {
      let s = `    ${c.q} ${c.type}`;
      if (c.coll) s += ` COLLATE ${c.coll}`;
      if (c.generated === 's') s += ` GENERATED ALWAYS AS (${c.def}) STORED`;
      else if (c.identity === 'a') s += ' GENERATED ALWAYS AS IDENTITY';
      else if (c.identity === 'd') s += ' GENERATED BY DEFAULT AS IDENTITY';
      else if (c.def != null && !c.def_late) s += ` DEFAULT ${c.def}`;
      if (c.def != null && c.def_late && !c.generated) {
        lateDefaults.push(`ALTER TABLE ONLY ${t.q} ALTER COLUMN ${c.q} SET DEFAULT ${c.def};`);
      }
      if (c.notnull) s += ' NOT NULL';
      return s;
    });
    const unlogged = t.relpersistence === 'u' ? 'UNLOGGED ' : '';
    out.push(
      `CREATE ${unlogged}TABLE ${t.q} (\n${cols.join(',\n')}\n)${withOptions(t.reloptions)};`,
      ''
    );
  }
  if (out[out.length - 1] === '') out.pop();
  counts.tables = R.tables.length;

  const owned = R.sequences.filter((s) => s.owned_by);
  if (owned.length) {
    section('시퀀스 소유 열');
    for (const s of owned) out.push(`ALTER SEQUENCE ${s.q} OWNED BY ${s.owned_by};`);
  }

  section('함수 · 뷰 (의존 순서)');
  const nodes = [
    ...R.functions.map((f) => ({
      key: `p${f.oid}`,
      kindRank: 0,
      sortName: f.sig,
      label: f.sig,
      f,
    })),
    ...R.views.map((v) => ({ key: `c${v.oid}`, kindRank: 1, sortName: v.q, label: v.q, v })),
  ];
  for (const n of orderRoutines(nodes, R.routineDeps)) {
    if (n.f) {
      if (!n.f.def) {
        warnings.push(`집계 함수는 찍지 못한다: ${n.f.sig}`);
        continue;
      }
      out.push(`${stripSemi(n.f.def)};`, '');
    } else {
      const v = n.v;
      const head = v.relkind === 'm' ? 'CREATE MATERIALIZED VIEW' : 'CREATE VIEW';
      const tail = v.relkind === 'm' ? '\n  WITH NO DATA' : '';
      out.push(`${head} ${v.q}${withOptions(v.reloptions)} AS\n${stripSemi(v.def)}${tail};`, '');
    }
  }
  if (out[out.length - 1] === '') out.pop();
  counts.functions = R.functions.filter((f) => f.def).length;
  counts.views = R.views.length;

  if (lateDefaults.length) {
    section('public 함수를 쓰는 열 기본값');
    out.push(...lateDefaults);
  }

  section('제약 (CHECK · PRIMARY KEY · UNIQUE)');
  const nonFk = R.constraints.filter((c) => c.contype !== 'f');
  for (const c of nonFk) out.push(`ALTER TABLE ONLY ${c.tq}\n    ADD CONSTRAINT ${c.q} ${c.def};`);
  section('외래 키');
  const fks = R.constraints.filter((c) => c.contype === 'f');
  for (const c of fks) out.push(`ALTER TABLE ONLY ${c.tq}\n    ADD CONSTRAINT ${c.q} ${c.def};`);
  counts.constraints = R.constraints.length;
  counts.foreign_keys = fks.length;

  section('인덱스');
  for (const i of R.indexes) out.push(`${i.def};`);
  counts.indexes = R.indexes.length;

  section('트리거');
  for (const t of R.triggers) {
    out.push(`${t.def};`);
    if (ENABLE[t.enabled]) out.push(`ALTER TABLE ${t.tq} ${ENABLE[t.enabled]} TRIGGER ${t.q};`);
  }
  counts.triggers = R.triggers.length;

  section('행 수준 보안 (RLS)');
  for (const t of R.tables) {
    if (t.rls) out.push(`ALTER TABLE ${t.q} ENABLE ROW LEVEL SECURITY;`);
    if (t.force_rls) out.push(`ALTER TABLE ${t.q} FORCE ROW LEVEL SECURITY;`);
  }
  counts.rls_tables = R.tables.filter((t) => t.rls).length;

  const policyLines = (p) => {
    let s = `CREATE POLICY ${p.q} ON ${p.tq}`;
    if (!p.permissive) s += '\n    AS RESTRICTIVE';
    s += `\n    FOR ${CMD[p.cmd]}`;
    s += `\n    TO ${sortRoles(p.roles).join(', ')}`;
    if (p.qual != null) s += `\n    USING (${p.qual})`;
    if (p.chk != null) s += `\n    WITH CHECK (${p.chk})`;
    return `${s};`;
  };
  section('정책 (public)');
  const pubPolicies = R.policies.filter((p) => p.schema === 'public');
  for (const p of pubPolicies) out.push(policyLines(p));
  counts.policies = pubPolicies.length;

  section('권한 (테이블 · 뷰 · 시퀀스)');
  const relKind = { S: 'SEQUENCE' };
  for (const [q, rows] of groupBy(R.relAcl, 'q')) {
    const kind = relKind[rows[0].relkind] || 'TABLE';
    out.push(...grantLines(kind, q, rows, rows[0].relkind === 'S' ? allPrivs.s : allPrivs.r));
  }
  if (R.colAcl.length) {
    section('권한 (열 단위)');
    for (const [q, rows] of groupBy(R.colAcl, 'q')) out.push(...columnGrantLines(q, rows));
  }
  section('권한 (함수)');
  for (const [sig, rows] of groupBy(R.procAcl, 'sig')) {
    out.push(
      ...grantLines(rows[0].prokind === 'p' ? 'PROCEDURE' : 'FUNCTION', sig, rows, allPrivs.f)
    );
  }

  if (R.relComments.length || R.otherComments.length) {
    section('설명 (COMMENT)');
    const relWord = {
      r: 'TABLE',
      p: 'TABLE',
      v: 'VIEW',
      m: 'MATERIALIZED VIEW',
      S: 'SEQUENCE',
      i: 'INDEX',
    };
    for (const c of R.relComments) {
      if (c.sub > 0) out.push(`COMMENT ON COLUMN ${c.tq}.${c.col} IS ${c.lit};`);
      else if (relWord[c.relkind])
        out.push(`COMMENT ON ${relWord[c.relkind]} ${c.tq} IS ${c.lit};`);
    }
    for (const c of R.otherComments) out.push(`COMMENT ON ${c.target} IS ${c.lit};`);
  }
  counts.comments = R.relComments.length + R.otherComments.length;

  if (R.publications.length) {
    section('퍼블리케이션 소속');
    for (const p of R.publications) {
      if (p.has_qual || p.has_cols)
        warnings.push(`퍼블리케이션 행 필터 · 열 목록은 찍지 않는다: ${p.pub} ${p.tq}`);
      out.push(`ALTER PUBLICATION ${p.pub} ADD TABLE ${p.tq};`);
    }
  }

  section('storage 버킷');
  for (const b of R.buckets) {
    out.push(
      `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)\n` +
        `VALUES (${b.id}, ${b.name}, ${b.public}, ${b.size_limit}, ${b.mimes})\n` +
        `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,\n` +
        `    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;`
    );
  }
  counts.buckets = R.buckets.length;

  section('정책 (storage)');
  const stPolicies = R.policies.filter((p) => p.schema === 'storage');
  for (const p of stPolicies) out.push(policyLines(p));
  counts.storage_policies = stPolicies.length;

  section('Supabase 관리 테이블에 건 트리거 (public 함수)');
  for (const t of R.foreignTriggers) {
    out.push(`${t.def};`);
    if (ENABLE[t.enabled]) out.push(`ALTER TABLE ${t.tq} ${ENABLE[t.enabled]} TRIGGER ${t.q};`);
  }
  counts.foreign_triggers = R.foreignTriggers.length;

  if (R.eventTriggers.length) {
    section('이벤트 트리거 (public 함수)');
    for (const e of R.eventTriggers) {
      let s = `CREATE EVENT TRIGGER ${e.q} ON ${e.event}`;
      if (e.tags && e.tags.length) s += `\n    WHEN TAG IN (${e.tags.join(', ')})`;
      out.push(`${s}\n    EXECUTE FUNCTION ${e.fn}();`);
      if (ENABLE[e.enabled]) out.push(`ALTER EVENT TRIGGER ${e.q} ${ENABLE[e.enabled]};`);
    }
  }
  counts.event_triggers = R.eventTriggers.length;

  const body = `${out.join('\n')}\n`.replace(/\r\n?/g, '\n');
  return { body, counts, version, warnings };
}

/** 일반 덤프 머리말 (날짜 없음 — 두 번 찍어도 같다) */
export function dumpHeader(version) {
  return [
    '-- ============================================================',
    '-- 라이브 DB 스키마 덤프 (스키마만 · 행 데이터 없음)',
    `-- scripts/db-dump-schema.mjs 가 만든다 · PostgreSQL ${version}`,
    '-- ============================================================',
    '',
    '',
  ].join('\n');
}

/** 기준선 머리말 */
export function baselineHeader(version, taken) {
  return [
    '-- ============================================================',
    '-- 0000_baseline.sql — DB 번호 마이그레이션의 출발점 (기준선)',
    '--',
    `-- 찍은 날: ${taken} (라이브 DB, PostgreSQL ${version})`,
    '-- 만든 도구: node scripts/db-dump-schema.mjs --baseline',
    '--',
    '-- 이 파일은 찍은 날의 스키마를 그대로 다시 만든다 (스키마만 · 행 데이터 없음 · storage 버킷 정의는 담음).',
    '-- 빈 Supabase 프로젝트(auth · storage 스키마가 이미 있는 상태)에 postgres 역할로 돌린다고 보고 쓴다.',
    '-- 소유자(OWNER) 문은 없다. CRLF 로 저장된 함수 본문은 LF 로 적혀 있다.',
    '--',
    '-- 라이브 DB 에는 돌리지 않는다 — `node scripts/db-migrate.mjs --baseline-mark` 로 「적용됨」만 적는다.',
    '-- 이후 DB 변경은 모두 database/migrations/ 의 다음 번호 파일로 한다 (database/migrations/README.md).',
    '-- 적용됨으로 적은 뒤에는 고치지 않는다 (체크섬이 바뀌면 db-migrate 가 멈춘다).',
    '-- ============================================================',
    '',
    '',
  ].join('\n');
}

/** 맨 앞 BOM (U+FEFF) */
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));

/** 덤프 파일에서 머리말(맨 앞의 주석 · 빈 줄)을 뺀 본문 — 라이브와 기준선을 견줄 때 */
export function dumpBody(text) {
  const lines = text.replace(BOM_RE, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('--'))) i++;
  return lines.slice(i).join('\n');
}

function seoulDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function main(argv) {
  const opt = { out: null, baseline: false, taken: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opt.out = argv[++i];
    else if (a === '--baseline') opt.baseline = true;
    else if (a === '--taken') opt.taken = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'node scripts/db-dump-schema.mjs [--out <파일>] [--baseline [--taken YYYY-MM-DD]]'
      );
      return 0;
    } else throw new Error(`모르는 인자: ${a}`);
  }
  if (opt.taken && !/^\d{4}-\d{2}-\d{2}$/.test(opt.taken)) throw new Error('--taken 은 YYYY-MM-DD');

  const client = await connect();
  let result;
  try {
    result = await dumpSchema(client);
  } finally {
    await client.end();
  }
  const header = opt.baseline
    ? baselineHeader(result.version, opt.taken || seoulDate())
    : dumpHeader(result.version);
  const text = `${header}${result.body}`;
  if (opt.out) {
    fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
    fs.writeFileSync(opt.out, text, 'utf8');
    console.error(`썼다: ${opt.out} (${Buffer.byteLength(text)} 바이트)`);
  } else {
    process.stdout.write(text);
  }
  console.error(
    '객체 수: ' +
      Object.entries(result.counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
  );
  for (const w of result.warnings) console.error(`주의: ${w}`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`실패: ${err.message}`);
      process.exit(1);
    }
  );
}
