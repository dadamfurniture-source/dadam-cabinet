#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, process, console, fetch */
// ============================================================
// 설계 유전체 — 가명화 내보내기 (서비스 키, 읽기 전용, 2026-10-25)
//
// export.sql 과 같은 결과를 SQL Editor 없이 만든다. Supabase REST 로 **읽기만** 한다:
//   planner_snapshots  design_id · item_unique_id · stage · is_autosave · updated_at · payload  (stage = structure)
//   designs            id · user_id                      ← 이름·제목 칸은 요청하지 않는다
//   orders             design_id                         (status = completed)
// user_id · design_id · item_unique_id 는 실행마다 새로 만든 임의 소금으로 SHA-256 한다.
// 소금은 메모리에만 있고 저장·출력하지 않는다 → 같은 실행 안에서만 서로 이어진다.
// 결과는 저장소 밖 파일에만 쓰고, 화면에는 개수만 찍는다.
//
//   node tools/genome/fetch-supabase.js --env <mcp-server/.env> --out <C:\Users\hchan\dadam-research\genome\export.json>
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PAGE = 200;

/** KEY=VALUE 줄만 읽는다 (값은 출력하지 않는다). */
function readEnv(file) {
  const env = {};
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
  return env;
}

async function rest(base, key, table, query) {
  // 새 비밀 키(sb_secret_)는 JWT 가 아니다 — apikey 헤더로만 보낸다. 예전 JWT 키만 Bearer 를 같이 보낸다.
  const headers = { apikey: key, Accept: 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${base}/rest/v1/${table}?${query}`, { headers });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function pages(base, key, table, query) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest(base, key, table, `${query}&limit=${PAGE}&offset=${offset}`);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function main(envFile, outFile) {
  const env = readEnv(envFile);
  const base = (env.SUPABASE_URL || '').replace(/\/$/, '');
  // 2026-10-23 부터 예전 JWT 키(anon · service_role)는 막혔다 — 새 비밀 키를 SUPABASE_SECRET_KEY 에 둔다
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('SUPABASE_URL · SUPABASE_SECRET_KEY 가 없습니다');
  const salt = crypto.randomBytes(32).toString('hex');
  const h = (v) => crypto.createHash('sha256').update(salt + String(v)).digest('hex');

  const snaps = await pages(base, key, 'planner_snapshots',
    'select=design_id,item_unique_id,stage,is_autosave,updated_at,payload&stage=eq.structure&order=updated_at.asc');
  const ids = [...new Set(snaps.map((s) => s.design_id))];
  const owner = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = await rest(base, key, 'designs', `select=id,user_id&id=in.(${chunk.join(',')})`);
    rows.forEach((r) => owner.set(r.id, r.user_id));
  }
  const done = new Set((await pages(base, key, 'orders', 'select=design_id&status=eq.completed')).map((r) => r.design_id));

  const rows = snaps.filter((s) => owner.get(s.design_id)).map((s) => ({
    u: h(owner.get(s.design_id)),
    d: h(s.design_id),
    item: h(s.item_unique_id),
    stage: s.stage,
    is_autosave: s.is_autosave,
    updated_at: s.updated_at,
    payload: s.payload,
    completed: done.has(s.design_id),
  }));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(rows));

  const perUser = new Map();
  rows.forEach((r) => perUser.set(r.u, (perUser.get(r.u) || new Set()).add(`${r.d}|${r.item}`)));
  const counts = [...perUser.values()].map((s) => s.size).sort((a, b) => a - b);
  return {
    snapshots: snaps.length,
    rows: rows.length,
    designs: ids.length,
    users: perUser.size,
    completedDesigns: new Set(rows.filter((r) => r.completed).map((r) => r.d)).size,
    itemsPerUser: counts.length ? { min: counts[0], median: counts[Math.floor(counts.length / 2)], max: counts.at(-1) } : null,
    usersWith2plus: counts.filter((c) => c >= 2).length,
  };
}

module.exports = { main, readEnv };

if (require.main === module) {
  const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
  if (!arg('env') || !arg('out')) {
    console.error('사용법: node tools/genome/fetch-supabase.js --env <mcp-server/.env> --out <저장소 밖 export.json>');
    process.exit(1);
  }
  main(arg('env'), arg('out'))
    .then((s) => console.log(JSON.stringify(s)))
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
