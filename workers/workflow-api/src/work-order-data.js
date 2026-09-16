/**
 * 작업지시서 v2 — 발행 시점에 모아 `render_payload` 에 동결하는 자료 (B5).
 *
 * 문서는 동결된 인쇄물이다 (work-order.js 머리말, 불변조건 I3). 그래서 표지 렌더·색 스와치·
 * 재단 배치·이전 rev 차이는 **발행할 때** 한 번 모아 `design_documents.render_payload` 에 넣고,
 * 인쇄는 그 값만 읽는다. 나중에 렌더를 다시 찍거나 카탈로그 이름이 바뀌어도 이미 나간
 * 지시서는 그대로다. 서명 URL 만 인쇄 시점에 만든다 (storage.js — 만료되는 값이라 저장하지 않는다).
 *
 * 모으는 것:
 *   renders      design_renders 의 품목별 최신 kind='front' 행 (path·width·height). 없으면 path null
 *   swatches     materials[].finishCode 의 고유값 → materials 표 (color_name·color_hex·vendor_code·series·finish·tone)
 *   cut_plan     snapshot.cut_plan_payload 그대로 (없으면 null)
 *   parts_digest 자재 행의 식별·치수·수량·마감만 — 다음 rev 가 이 문서와 비교할 때 읽는다
 *   prev_rev     같은 설계의 직전 work_order 와의 차이 (partId 기준 added/removed/changed). 첫 발행이면 null
 *
 * 표·컬럼이 아직 없는 DB(design_renders 미적용, materials.series 미적용)에서도 발행이 멈추면 안 된다 —
 * 그 부분만 비우고 경고 로그를 남긴다.
 */

import { DbError, selectMany, selectOne } from './supabase.js';

export const WORK_ORDER_VERSION = 2;

export const SWATCH_COLUMNS = ['code', 'color_name', 'color_hex', 'vendor_code', 'series', 'finish', 'tone'];
const SWATCH_SELECT = SWATCH_COLUMNS.join(',');
const SWATCH_SELECT_NO_SERIES = SWATCH_COLUMNS.filter((c) => c !== 'series').join(',');

/** 표·컬럼이 없어서 난 오류인가 (PostgREST: 표 PGRST205/42P01, 컬럼 PGRST204/42703). */
export function isMissingRelation(err) {
  if (!(err instanceof DbError)) return false;
  return /PGRST20[45]|42P01|42703/.test(String(err.message || ''));
}

// ── 품목 · 자재 헬퍼 (순수) ──────────────────────────────────────

/** design_renders.item_unique_id 와 같은 규칙 — persistence-init.js 가 Math.floor(item.uniqueId) 로 저장한다. */
export function itemUniqueIdOf(item) {
  const raw = item && (item.uniqueId ?? item.unique_id);
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export function materialsOf(snapshot) {
  const rows = snapshot && snapshot.bom_payload && snapshot.bom_payload.materials;
  return Array.isArray(rows) ? rows.filter((m) => m && typeof m === 'object') : [];
}

export function hardwareOf(snapshot) {
  const rows = snapshot && snapshot.hardware_payload && snapshot.hardware_payload.hardware;
  return Array.isArray(rows) ? rows.filter((h) => h && typeof h === 'object') : [];
}

/** 자재 행의 partId. B1 이전 행은 nesting-engine 과 같은 `row-<index>`. */
export function partIdOf(row, index) {
  return row && row.partId != null && row.partId !== '' ? String(row.partId) : `row-${index}`;
}

/** 자재 행에서 고유 finishCode (빈 값 제외, 첫 등장 순). edgeCode 는 finishCode 의 부분집합이라 따로 안 센다. */
export function distinctFinishCodes(materials) {
  const seen = new Set();
  for (const m of materials || []) {
    const code = m && typeof m.finishCode === 'string' ? m.finishCode.trim() : '';
    if (code) seen.add(code);
  }
  return [...seen];
}

/** 자재 행 → rev 비교용 요약. */
export function partsDigest(materials) {
  return (materials || []).map((m, i) => ({
    partId: partIdOf(m, i),
    itemLabel: m.itemLabel || '',
    module: m.module || '',
    part: m.part || '',
    material: m.material || '',
    thickness: numOrNull(m.thickness),
    w: numOrNull(m.w),
    h: numOrNull(m.h),
    qty: numOrNull(m.qty),
    finishCode: m.finishCode || '',
  }));
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ── rev 차이 ─────────────────────────────────────────────────────

const DIFF_FIELDS = ['w', 'h', 'thickness', 'qty', 'finishCode', 'material'];

/**
 * 두 요약을 partId 로 맞춰 차이를 낸다.
 * partId 가 없는 옛 행(`row-N`)은 순번이 밀리면 전부 바뀐 것으로 보이므로
 * `품목/모듈/부품#k` 로 키를 만든다 (같은 모듈 안 같은 부품의 k 번째).
 */
export function diffParts(prevDigest, curDigest) {
  const keyed = (rows) => {
    const map = new Map();
    const seq = new Map();
    for (const r of rows || []) {
      let key = r.partId && !/^row-\d+$/.test(r.partId) ? r.partId : null;
      if (!key) {
        const base = `row:${r.itemLabel}/${r.module}/${r.part}`;
        const k = seq.get(base) || 0;
        seq.set(base, k + 1);
        key = `${base}#${k}`;
      }
      map.set(key, r);
    }
    return map;
  };
  const prev = keyed(prevDigest);
  const cur = keyed(curDigest);

  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, row] of cur) {
    const before = prev.get(key);
    if (!before) {
      added.push({ key, ...pick(row) });
      continue;
    }
    const changes = [];
    for (const f of DIFF_FIELDS) {
      const a = before[f] ?? null;
      const b = row[f] ?? null;
      if (a !== b) changes.push({ field: f, from: a, to: b });
    }
    if (changes.length) changed.push({ key, ...pick(row), changes });
  }
  for (const [key, row] of prev) {
    if (!cur.has(key)) removed.push({ key, ...pick(row) });
  }
  return { added, removed, changed };
}

function pick(r) {
  return {
    partId: r.partId,
    itemLabel: r.itemLabel,
    module: r.module,
    part: r.part,
    w: r.w,
    h: r.h,
    thickness: r.thickness,
    qty: r.qty,
    finishCode: r.finishCode,
    material: r.material,
  };
}

// ── 보링 (경첩 비고 파싱) ────────────────────────────────────────

/**
 * extractors.js `extractHinges` 가 쓰는 비고 `${모듈명} (보링: 110, 400, 690)` 을 읽는다.
 * 구조화 필드 `boring`(배열)이 있으면 그것을 우선한다. 못 읽으면 null.
 */
export function parseBoringNote(row) {
  if (!row) return null;
  if (Array.isArray(row.boring) && row.boring.length) {
    const positions = row.boring.map(Number).filter((n) => Number.isFinite(n));
    if (positions.length) return { moduleName: String(row.module || row.moduleName || '').trim(), positions };
  }
  const note = typeof row.note === 'string' ? row.note : '';
  const m = note.match(/^(.*?)\s*\(\s*보링\s*:\s*([^)]*)\)/);
  if (!m) return null;
  const positions = m[2]
    .split(/[,\s]+/)
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n));
  if (!positions.length) return null;
  return { moduleName: m[1].trim(), positions };
}

/** 보링 위치는 [110, …, H−110] 이다 (getBoringPositions). 양 끝이 110 이면 도어 높이를 되돌린다. */
export function doorHeightFromBoring(positions) {
  if (!positions || positions.length < 2) return null;
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first !== 110) return null;
  return last + 110;
}

/**
 * 자재 행의 `module` 라벨(`#1 하부장-개수대`, `상부장-후드장`, `키큰장(상단)`)에서
 * 모듈 이름만 남긴다 — 경첩 비고의 `mod.name` 과 맞추기 위해.
 */
export function moduleNameOf(label) {
  let s = String(label || '').trim();
  s = s.replace(/^#\d+\s+/, '');
  s = s.replace(/^(상부장|하부장)-/, '');
  s = s.replace(/\([^)]*\)\s*$/, '');
  return s.trim();
}

/** 경첩 행이 가리키는 도어 자재 행들 (품목 라벨 + 모듈 이름으로 맞춘다). */
export function doorRowsForHinge(materials, hingeRow) {
  const parsed = parseBoringNote(hingeRow);
  if (!parsed) return [];
  const name = parsed.moduleName;
  return (materials || [])
    .map((m, i) => ({ row: m, index: i }))
    .filter(({ row }) => {
      const isDoor = row.slot === 'door' || row.part === '도어';
      if (!isDoor) return false;
      if (hingeRow.itemLabel && row.itemLabel && hingeRow.itemLabel !== row.itemLabel) return false;
      return name !== '' && moduleNameOf(row.module) === name;
    });
}

// ── DB 조회 (발행 시점) ──────────────────────────────────────────

/** 품목별 최신 정면 렌더. 표가 없으면 전부 path null. */
export async function collectRenders(env, designId, items) {
  const list = Array.isArray(items) ? items : [];
  const out = list.map((item, i) => ({
    item_index: i,
    item_unique_id: itemUniqueIdOf(item),
    path: null,
    width: null,
    height: null,
    created_at: null,
  }));
  const ids = [...new Set(out.map((r) => r.item_unique_id).filter((v) => v !== null))];
  if (ids.length === 0) return out;

  let rows;
  try {
    rows = await selectMany(env, 'design_renders', {
      design_id: `eq.${designId}`,
      item_unique_id: `in.(${ids.join(',')})`,
      kind: 'eq.front',
      select: 'item_unique_id,path,width,height,created_at',
      order: 'created_at.desc',
      limit: String(Math.max(50, ids.length * 5)),
    });
  } catch (err) {
    if (!isMissingRelation(err)) throw err;
    console.warn('[work-order] design_renders 표가 없습니다. database/design-renders.sql 을 적용하세요. 렌더 없이 발행합니다.');
    return out;
  }

  const latest = new Map();
  for (const r of rows || []) {
    const key = Number(r.item_unique_id);
    if (!latest.has(key)) latest.set(key, r);
  }
  for (const r of out) {
    const hit = r.item_unique_id !== null ? latest.get(r.item_unique_id) : null;
    if (!hit || !hit.path) continue;
    r.path = hit.path;
    r.width = numOrNull(hit.width);
    r.height = numOrNull(hit.height);
    r.created_at = hit.created_at || null;
  }
  return out;
}

/** finishCode → 카탈로그 행. 모르는 코드는 hex null, 이름 = 코드. */
export async function collectSwatches(env, materials) {
  const codes = distinctFinishCodes(materials);
  const byCode = new Map();
  if (codes.length) {
    const query = (select) => ({
      code: `in.(${codes.map((c) => `"${c.replace(/"/g, '')}"`).join(',')})`,
      select,
      limit: String(Math.max(50, codes.length)),
    });
    let rows = null;
    try {
      rows = await selectMany(env, 'materials', query(SWATCH_SELECT));
    } catch (err) {
      if (!isMissingRelation(err)) throw err;
      try {
        rows = await selectMany(env, 'materials', query(SWATCH_SELECT_NO_SERIES));
      } catch (err2) {
        if (!isMissingRelation(err2)) throw err2;
        console.warn('[work-order] materials 카탈로그 컬럼이 없습니다. database/materials-catalog-v2.sql 을 적용하세요. 코드만 싣습니다.');
      }
    }
    for (const r of rows || []) if (r && r.code) byCode.set(String(r.code), r);
  }
  return codes.map((code) => {
    const r = byCode.get(code);
    return {
      code,
      known: Boolean(r),
      color_name: (r && r.color_name) || code,
      color_hex: normalizeHex(r && r.color_hex),
      vendor_code: (r && r.vendor_code) || null,
      series: (r && r.series) || null,
      finish: (r && r.finish) || null,
      tone: (r && r.tone) || null,
    };
  });
}

/** '#rrggbb' 만 통과 — 문서에 그대로 style 로 들어가므로 엄격히 본다. */
export function normalizeHex(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

/**
 * 같은 설계의 직전 work_order (rev 가장 높은 것). 발행 전에 부른다.
 * 요약이 없는 v1 문서면 그 문서의 스냅샷에서 자재를 읽어 요약한다.
 */
export async function collectPrevRev(env, designId, curDigest) {
  const prev = await selectOne(env, 'design_documents', {
    design_id: `eq.${designId}`,
    doc_type: 'eq.work_order',
    select: 'id,rev,doc_no,snapshot_id,render_payload',
    order: 'rev.desc',
  });
  if (!prev) return null;

  let prevDigest = Array.isArray(prev.render_payload && prev.render_payload.parts_digest)
    ? prev.render_payload.parts_digest
    : null;
  let snapshotRev = null;
  if (!prevDigest) {
    const snap = await selectOne(env, 'design_snapshots', {
      id: `eq.${prev.snapshot_id}`,
      select: 'rev,bom_payload',
    });
    prevDigest = partsDigest(materialsOf(snap));
    snapshotRev = snap ? snap.rev : null;
  }

  return {
    document_id: prev.id,
    rev: prev.rev,
    doc_no: prev.doc_no,
    snapshot_rev: snapshotRev,
    diff: diffParts(prevDigest, curDigest),
  };
}

/** 발행 시 render_payload 에 합칠 v2 필드 전부. */
export async function gatherWorkOrderPayload(env, { designId, snapshot }) {
  const design = (snapshot && snapshot.design_payload) || {};
  const items = Array.isArray(design.items) ? design.items : [];
  const materials = materialsOf(snapshot);
  const digest = partsDigest(materials);

  const [renders, swatches, prevRev] = await Promise.all([
    collectRenders(env, designId, items),
    collectSwatches(env, materials),
    collectPrevRev(env, designId, digest),
  ]);

  const cutPlan = snapshot && snapshot.cut_plan_payload ? snapshot.cut_plan_payload : null;

  return {
    work_order_version: WORK_ORDER_VERSION,
    renders,
    swatches,
    cut_plan: cutPlan,
    parts_digest: digest,
    prev_rev: prevRev,
  };
}

/** 문서 totals 에 더할 수량 — 시트 수(배치 있을 때)와 라벨 수(Σ qty). */
export function workOrderTotals(snapshot, cutPlan) {
  const materials = materialsOf(snapshot);
  const labelCount = materials.reduce((s, m) => s + Math.max(0, Math.round(numOrNull(m.qty) || 0)), 0);
  const sheetCount = cutPlan && Array.isArray(cutPlan.sheets)
    ? cutPlan.sheets.length
    : (snapshot && Number.isFinite(Number(snapshot.sheet_count)) && snapshot.sheet_count !== null
      ? Number(snapshot.sheet_count)
      : null);
  return { sheet_count: sheetCount, label_count: labelCount };
}
