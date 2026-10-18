/**
 * 스냅샷(BOM + 재단 배치) → 사람별 작업량.
 *
 * 생산 계획의 입력. 사람마다 자기 담당만 한다 (2026-10-13 대표 확정):
 *   재단 기사  = 작업지시 확인·자재 피킹 + 원판 재단 (PB·뒷판)
 *   알바(엣지) = PB 원판 엣지밴딩
 *   조립 기사  = 통 조립 + 서랍 + 선반·다리발·옷봉 + 도어 검수·달기 + 완성 검수·포장
 * 보링 공정은 없고, 상차는 시공 기사(설치 외주) 몫이라 여기에 넣지 않는다.
 *
 * 작업 수는 BOM 에서 센다:
 *   통   = `…-body:side-N` 부재 행 수 (붙박이장 상·하 분할은 통 2개)
 *   서랍 = 철물 '레일' 수량
 *   도어 = 자재 부품명에 '도어'가 든 행 수량 (서랍도어 포함)
 *   원판 = cutPlan.summary.sheetsByMaterial (없으면 면적 ÷ 원판 ÷ 수율)
 *   엣지 면 = PB 행의 붙일 변(edges L·R·T·B, 옛 행은 edge '4면' 등) × 수량
 */

import { DEFAULT_STANDARDS } from './standards.js';

const SHEET_AREA_M2 = 1.22 * 2.44;
const FALLBACK_YIELD = 0.75;

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

const isPb = (m) => String(m.material || '').toUpperCase().startsWith('PB');
const isBack = (m) => String(m.material || '').toUpperCase() === 'MDF' && num(m.thickness) > 0 && num(m.thickness) < 5;

/** 엣지 면 정보가 없는 옛 BOM — PB 1장당 평균 면 수 (대표 구성 20건 평균 91면 ÷ 5.5장, 2026-10-18) */
const FALLBACK_FACES_PER_PB_SHEET = 17;

/** 부재 1장의 엣지 면 수 — edges 객체 우선, 없으면 옛 문자열 '4면'·'2면(장)' 의 숫자. */
export function edgeFacesOfRow(m) {
  if (m && m.edges && typeof m.edges === 'object') {
    return ['L', 'R', 'T', 'B'].filter((k) => m.edges[k]).length;
  }
  const hit = /^([1-4])면/.exec(String((m && m.edge) || '').trim());
  return hit ? Number(hit[1]) : 0;
}

/** PB 행의 엣지 면 합계. 어느 PB 행에도 면 정보가 없으면 null (옛 BOM). */
export function edgeFaces(materials) {
  const pb = (materials || []).filter(isPb);
  const known = pb.some((m) => (m.edges && typeof m.edges === 'object') || /^[1-4]면/.test(String(m.edge || '').trim()));
  if (!known) return null;
  return pb.reduce((s, m) => s + edgeFacesOfRow(m) * num(m.qty), 0);
}

/** 재단 배치 요약에서 자체 재단하는 원판 장수. 도어(MDF 18T)는 외주라 세지 않는다. */
function sheetsFromCutPlan(cutPlan) {
  const by = cutPlan && cutPlan.summary && cutPlan.summary.sheetsByMaterial;
  if (!by || typeof by !== 'object') return null;
  let pb = 0;
  let back = 0;
  for (const [key, n] of Object.entries(by)) {
    const [mat, t] = String(key).split('_');
    if (String(mat).toUpperCase().startsWith('PB')) pb += num(n);
    else if (String(mat).toUpperCase() === 'MDF' && num(t) > 0 && num(t) < 5) back += num(n);
  }
  return { pb, back };
}

function sheetsFromArea(materials) {
  const area = (pred) => materials.filter(pred).reduce((s, m) => s + (num(m.w) * num(m.h) * num(m.qty)) / 1e6, 0);
  const sheets = (a) => (a > 0 ? Math.ceil(a / (SHEET_AREA_M2 * FALLBACK_YIELD)) : 0);
  return { pb: sheets(area(isPb)), back: sheets(area(isBack)) };
}

/**
 * BOM 행에서 작업 수를 센다.
 * @param {{materials?: Array, hardware?: Array}} bom  스냅샷 bom_payload
 * @param {Object|null} cutPlan  스냅샷 cut_plan_payload
 */
export function countWork(bom, cutPlan) {
  const materials = Array.isArray(bom && bom.materials) ? bom.materials : [];
  const hardware = Array.isArray(bom && bom.hardware) ? bom.hardware : [];
  const hw = (cat) => hardware.filter((h) => h && h.category === cat).reduce((s, h) => s + num(h.qty), 0);
  const qtyOf = (re) => materials.filter((m) => re.test(String(m.part || ''))).reduce((s, m) => s + num(m.qty), 0);

  const sheets = sheetsFromCutPlan(cutPlan) || sheetsFromArea(materials);
  const boxes = materials.filter((m) => /-body:side-\d+$/.test(String(m.partId || ''))).length;
  const faces = edgeFaces(materials);

  return {
    sheetsPB: sheets.pb,
    sheetsBack: sheets.back,
    edgeFaces: faces === null ? Math.round(sheets.pb * FALLBACK_FACES_PER_PB_SHEET) : faces,
    edgeFacesSource: faces === null ? 'estimate' : 'bom',
    boxes,
    drawers: hw('레일'),
    doors: qtyOf(/도어/),
    shelves: qtyOf(/^선반/),
    legs: hw('다리발'),
    rods: hw('옷봉'),
    sheetSource: sheetsFromCutPlan(cutPlan) ? 'cutPlan' : 'area',
  };
}

/**
 * 작업 수 × 표준시간 = 사람별 초.
 * 조립은 도어가 와야 하는 몫(doorPart)을 따로 둔다 — 도어 외주 납기를 기다려야 하기 때문이다.
 */
export function workloadFromCounts(c, standards = DEFAULT_STANDARDS) {
  const s = standards;
  const cutter = (c.sheetsPB + c.sheetsBack) > 0 ? s.cutPerJob + (c.sheetsPB + c.sheetsBack) * s.cutPerSheet : 0;
  const faces = Number.isFinite(c.edgeFaces) ? c.edgeFaces : Math.round(c.sheetsPB * FALLBACK_FACES_PER_PB_SHEET);
  const edge = faces * s.edgePerFace;
  const asmMain = c.boxes * s.asmPerBox + c.drawers * s.asmPerDrawer + c.shelves * s.asmPerShelf + c.legs * s.asmPerLeg + c.rods * s.asmPerRod;
  const doorPart = c.doors * s.asmPerDoor + c.boxes * s.packPerBox;
  return { cutter, edge, asmMain, doorPart, asm: asmMain + doorPart, counts: c.edgeFaces === faces ? c : { ...c, edgeFaces: faces } };
}

/** 스냅샷 한 개 → 사람별 작업량(초). */
export function workloadFromSnapshot(snapshot, standards = DEFAULT_STANDARDS) {
  const counts = countWork(snapshot && snapshot.bom_payload, snapshot && snapshot.cut_plan_payload);
  return workloadFromCounts(counts, standards);
}
