/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */
// ============================================================
// 설계 유전체 — 데이터 어댑터 (연구용, 2026-10-25)
//
//   fromSinkHitl(dir)      싱크 검토 케이스(docs/design-rules/sink-hitl/cases, git 밖 로컬 파일) → 유전체.
//                          108건은 무작위 생성기 출력(meta.generated_by = 'random')이다 — 사용자 패턴이 아니라
//                          생성기 구조를 되찾는지 보는 시험용. 사용자 구분이 없다.
//   fromSupabaseExport(f)  tools/genome/export.sql 로 내려받은 가명화 JSON → 플래너 설계 {user, id, modules, structures}
//
// 실제 고객 데이터는 저장소에 넣지 않는다 — 파일은 저장소 밖(C:\Users\hchan\dadam-research\genome\)에 둔다.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

/** 싱크 케이스의 모듈 하나 → 대립유전자 (경첩 정보가 없는 단순 스키마). */
function sinkAllele(m) {
  const n = m.kind === 'door' ? m.doorCount : m.kind === 'drawer' ? m.drawerCount : null;
  const role = m.type === 'lt' || m.type === 'blank' ? `:${m.type}` : '';
  const sig = `${m.kind}${n ? `:${n}` : ''}${role}`;
  return { type: sig, hinge: null, sig };
}

/** 앵커 — 가전 자리가 정하는 칸 (개수대 · 쿡탑 · 후드). 자동계산 전에 정해지므로 관측으로 둔다. */
const SINK_ANCHOR_TYPES = ['sink', 'cook', 'hood'];

function sinkLine(section, list) {
  let x = 0;
  const loci = (list || []).slice().sort((a, b) => a.idx - b.idx).map((m) => {
    const l = {
      x, W: m.width, ids: [`${section}-${m.idx}`], allele: sinkAllele(m),
      anchors: SINK_ANCHOR_TYPES.indexOf(m.type) >= 0 ? [m.type] : [],
    };
    l.fixed = l.anchors.length > 0;
    x += m.width;
    return l;
  });
  const sinkAt = loci.findIndex((l) => l.anchors.indexOf('sink') >= 0);
  loci.forEach((l, i) => { l.i = i; l.n = loci.length; l.fromSink = sinkAt >= 0 ? i - sinkAt : null; });
  return { key: `area-${section}-0`, section, loci };
}

/**
 * @param {string} dir cases 폴더
 * @returns {{genomes:object[], generatedBy:object}}
 */
function fromSinkHitl(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const generatedBy = {};
  const genomes = files.map((f) => {
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const by = (c.meta && c.meta.generated_by) || 'unknown';
    generatedBy[by] = (generatedBy[by] || 0) + 1;
    return {
      version: 1, user: null, id: c.id, weight: 1, t: c.timestamp, source: by,
      lines: [sinkLine('lower', c.lower), sinkLine('upper', c.upper)].filter((l) => l.loci.length),
      globals: {},
    };
  });
  return { genomes, generatedBy };
}

/** localStorage 값을 그대로 담은 칸은 문자열일 수 있다. */
function parseMaybe(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/**
 * export.sql 결과(JSON 배열) → 플래너 설계. 같은 (u, d, item) 의 행이 여럿이면 가장 늦게 저장한 것.
 * @param {string} file
 * @returns {object[]} {user, id, t, weight, modules, structures}
 */
function fromSupabaseExport(file) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const latest = new Map();
  rows.forEach((r) => {
    if (r.stage !== 'structure') return;
    const key = `${r.u}|${r.d}|${r.item}`;
    const prev = latest.get(key);
    if (!prev || String(r.updated_at) > String(prev.updated_at)) latest.set(key, r);
  });
  const out = [];
  latest.forEach((r) => {
    const p = parseMaybe(r.payload) || {};
    const mods = parseMaybe(p.modules);
    const structures = parseMaybe(p.structures) || {};
    const modules = Array.isArray(mods) ? mods : (mods && mods.modules) || [];
    if (!modules.length) return;
    out.push({ user: r.u, id: `${r.d}:${r.item}`, t: r.updated_at, weight: r.completed ? 2 : 1, modules, structures });
  });
  return out.sort((a, b) => (a.user < b.user ? -1 : a.user > b.user ? 1 : String(a.t) < String(b.t) ? -1 : 1));
}

module.exports = { fromSinkHitl, fromSupabaseExport, sinkAllele };
