/**
 * 설계 스냅샷 — 1·2단계 동결.
 *
 * ★ design_items 를 읽지 않는다.
 *   persistence-init.js:1055 의 저장이 "design_items 전체 delete → insert" 이고
 *   트랜잭션이 아니라서, 중간에 실패하면 DB 상 아이템이 0행이 된다.
 *   그 상태를 읽어 동결하면 빈 BOM 으로 0원 확인서가 발행된다.
 *   그래서 클라이언트 메모리의 DadamAgent.exportDesign() 결과를 그대로 받는다.
 *
 * ★ BOM 도 서버가 계산하지 않는다.
 *   extractors.js 의 doorMatFor(:105-108) 는 window.DadamBomFinishColor 가 없으면
 *   조용히 MDF 로 폴백한다. Worker 에는 window 가 없으므로 모든 도어의 finishCode 가
 *   빈 문자열이 되고, 도어 마감 업차지가 예외 없이 전액 0원이 된다.
 *   서버는 계산자가 아니라 검증자 + 가격 결정자다.
 */

import {
  ValidationError,
  ConflictError,
  NotFoundError,
  DbError,
  assertDesignOwner,
  designTitleOf,
  insertOne,
  selectOne,
  selectMany,
} from './supabase.js';
import { snapshotHash } from './util/hash.js';
import { getActivePricebook, getPricebookById } from './pricing.js';
import { buildQuoteInputs } from './adapters.js';
import { calculateQuote, VALID_GRADES } from './quote.js';

const MAX_REV_RETRY = 3;

function resolveGrade(env, requested) {
  if (VALID_GRADES.includes(requested)) return requested;
  const fallback = env.DEFAULT_QUOTE_GRADE;
  return VALID_GRADES.includes(fallback) ? fallback : 'basic';
}

/** 숫자로 해석 가능한 양수인지. 문자열 치수("600")가 흔해서 느슨하게 받는다. */
function positiveNumber(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 클라이언트가 보낸 payload 를 검증한다.
 * 위조 방지가 목적이 아니라(브라우저가 BOM 정본이므로 무의미) 버그 조기 발견이 목적이다.
 */
export function validateSnapshotInput(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('요청 본문이 비어 있습니다');
  }

  const design = body.design;
  if (!design || typeof design !== 'object' || !Array.isArray(design.items)) {
    throw new ValidationError('design.items 배열이 필요합니다');
  }
  if (design.items.length === 0) {
    throw new ValidationError('설계에 품목이 없습니다. 상세설계를 먼저 완료해 주세요.');
  }

  const bom = body.bom;
  if (!bom || typeof bom !== 'object' || !Array.isArray(bom.materials)) {
    throw new ValidationError('bom.materials 배열이 필요합니다');
  }
  if (bom.materials.length === 0) {
    // extractors.js 는 sink/wardrobe/fridge 만 산출한다 (extractors.js:45-55).
    // 그 외 카테고리만 있는 설계는 여기서 걸린다 — 의도된 동작이므로 이유를 밝힌다.
    throw new ValidationError(
      'BOM 자재가 없습니다. 자재 산출은 싱크대·붙박이장·냉장고장만 지원합니다.',
    );
  }

  const badRows = [];
  bom.materials.forEach((m, i) => {
    const problems = [];
    if (!m || typeof m !== 'object') {
      badRows.push({ index: i, problems: ['자재 항목이 객체가 아님'] });
      return;
    }
    if (positiveNumber(m.w) === null) problems.push('w 가 양수가 아님');
    if (positiveNumber(m.h) === null) problems.push('h 가 양수가 아님');
    if (positiveNumber(m.qty) === null) problems.push('qty 가 양수가 아님');
    if (typeof m.material !== 'string' || !m.material) problems.push('material 이 비어 있음');
    if (problems.length) badRows.push({ index: i, part: m.part, problems });
  });

  if (badRows.length) {
    throw new ValidationError('BOM 자재 항목에 잘못된 값이 있습니다', badRows.slice(0, 20));
  }

  return { design, bom, hardware: body.hardware && typeof body.hardware === 'object' ? body.hardware : {} };
}

/** 0 이상 유한수 (좌표). 문자열도 받는다. */
function nonNegativeNumber(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** `partId#k` → 자재 행 partId. 마지막 `#` 뒤가 숫자일 때만 떼어 낸다 (partId 자체에 `door#0` 처럼 `#` 이 있다). */
export function basePartId(instanceId) {
  const s = String(instanceId || '');
  const i = s.lastIndexOf('#');
  if (i < 0) return s;
  return /^\d+$/.test(s.slice(i + 1)) ? s.slice(0, i) : s;
}

/** 조각이 원판 위에서 차지하는 발자국 — rot 이면 h×w. */
function footprintOf(p) {
  const w = positiveNumber(p.w);
  const h = positiveNumber(p.h);
  if (w === null || h === null) return null;
  return p.rot ? { w: h, h: w } : { w, h };
}

/**
 * B4: 클라이언트가 보낸 재단 배치(cutPlan, nesting-engine.js 산출)를 검증한다.
 * 없으면 null — 배치는 선택 사항이다 (엔진이 없는 옛 캐시, 배치 대상이 없는 설계).
 *
 * 서버는 배치를 다시 계산하지 않는다(원판 규격·결 정보를 모른다). 대신 형태와
 * BOM 과의 정합만 본다:
 *   - 모양: version, sheets[], offcuts[] · 시트마다 no(고유)·material·size(양수)·parts[]
 *   - 조각마다 partId 가 bom.materials 에 있고, 행별 배치 개수 ≤ qty
 *   - 조각이 원판 안에 있고(rot 반영) 같은 시트의 조각끼리 겹치지 않는다
 * 통과하면 { cutPlan, sheetCount } 를 돌려준다. sheetCount = sheets.length (겹침 재단도 낱장으로 센다).
 */
export function validateCutPlan(cutPlan, bom) {
  if (cutPlan === undefined || cutPlan === null) return null;
  if (typeof cutPlan !== 'object' || Array.isArray(cutPlan)) {
    throw new ValidationError('cutPlan 은 객체여야 합니다');
  }
  if (cutPlan.version !== 1) {
    throw new ValidationError('cutPlan.version 은 1 이어야 합니다', { version: cutPlan.version });
  }
  if (!Array.isArray(cutPlan.sheets)) throw new ValidationError('cutPlan.sheets 배열이 필요합니다');
  if (cutPlan.offcuts !== undefined && !Array.isArray(cutPlan.offcuts)) {
    throw new ValidationError('cutPlan.offcuts 는 배열이어야 합니다');
  }

  // 자재 행 partId → qty. partId 가 없는 행은 엔진이 `row-<index>` 로 부른다.
  const materials = bom && Array.isArray(bom.materials) ? bom.materials : [];
  const qtyById = new Map();
  materials.forEach((m, i) => {
    if (!m || typeof m !== 'object') return;
    const id = m.partId != null && m.partId !== '' ? String(m.partId) : `row-${i}`;
    qtyById.set(id, (qtyById.get(id) || 0) + Math.round(positiveNumber(m.qty) || 0));
  });

  const problems = [];
  const seenNo = new Set();
  const placed = new Map();

  cutPlan.sheets.forEach((sheet, si) => {
    const tag = `sheets[${si}]`;
    if (!sheet || typeof sheet !== 'object') { problems.push(`${tag}: 객체가 아님`); return; }
    const no = Number(sheet.no);
    if (!Number.isInteger(no) || no <= 0) problems.push(`${tag}: no 가 양의 정수가 아님`);
    else if (seenNo.has(no)) problems.push(`${tag}: no ${no} 가 중복`);
    seenNo.add(no);
    if (typeof sheet.material !== 'string' || !sheet.material) problems.push(`${tag}: material 이 비어 있음`);
    const sw = sheet.size && positiveNumber(sheet.size.w);
    const sh = sheet.size && positiveNumber(sheet.size.h);
    if (!sw || !sh) { problems.push(`${tag}: size.w/h 가 양수가 아님`); return; }
    if (!Array.isArray(sheet.parts)) { problems.push(`${tag}: parts 배열이 없음`); return; }

    const rects = [];
    sheet.parts.forEach((p, pi) => {
      const ptag = `${tag}.parts[${pi}]`;
      if (!p || typeof p !== 'object') { problems.push(`${ptag}: 객체가 아님`); return; }
      if (typeof p.partId !== 'string' || !p.partId) { problems.push(`${ptag}: partId 가 비어 있음`); return; }
      const base = basePartId(p.partId);
      if (!qtyById.has(base)) { problems.push(`${ptag}: partId ${p.partId} 가 bom.materials 에 없음`); return; }
      placed.set(base, (placed.get(base) || 0) + 1);

      const f = footprintOf(p);
      const x = nonNegativeNumber(p.x);
      const y = nonNegativeNumber(p.y);
      if (!f) { problems.push(`${ptag}: w/h 가 양수가 아님`); return; }
      if (x === null || y === null) { problems.push(`${ptag}: x/y 가 0 이상이 아님`); return; }
      if (x + f.w > sw + 1e-6 || y + f.h > sh + 1e-6) {
        problems.push(`${ptag}: 원판(${sw}×${sh})을 벗어남 (${x}+${f.w}, ${y}+${f.h})`);
        return;
      }
      rects.push({ partId: p.partId, x, y, w: f.w, h: f.h });
    });

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          problems.push(`${tag}: ${a.partId} 와 ${b.partId} 가 겹침`);
        }
      }
    }
  });

  placed.forEach((n, id) => {
    const qty = qtyById.get(id) || 0;
    if (n > qty) problems.push(`partId ${id}: 배치 ${n}개 > 수량 ${qty}`);
  });

  if (problems.length) {
    throw new ValidationError('cutPlan 이 BOM 과 맞지 않습니다', problems.slice(0, 20));
  }

  return { cutPlan, sheetCount: cutPlan.sheets.length };
}

/** materials 로부터 파생값을 서버가 다시 계산한다. */
export function deriveCounts(design, bom) {
  const itemCount = design.items.length;
  const moduleCount = design.items.reduce(
    (sum, it) => sum + (Array.isArray(it.modules) ? it.modules.length : 0),
    0,
  );
  const panelCount = bom.materials.reduce((sum, m) => sum + (positiveNumber(m.qty) || 0), 0);
  return { itemCount, moduleCount, panelCount: Math.round(panelCount) };
}

/**
 * 클라이언트 summary 와 서버 재계산값을 대조한다.
 * 불일치는 extractors.js 의 materials 배열과 calculateSummary 가 어긋났다는 뜻이라
 * 조용히 넘기지 않고 409 로 세운다.
 */
/**
 * 자재 목록에서 자재·두께별 면적을 다시 계산한다.
 * `extractors.js` 의 `calculateSummary()` 와 같은 식이다.
 */
export function recomputeAreas(materials) {
  const out = {};
  for (const m of Array.isArray(materials) ? materials : []) {
    const key = `${m.material}_${m.thickness}`;
    const area = (Number(m.w) || 0) * (Number(m.h) || 0) * (Number(m.qty) || 0);
    out[key] = (out[key] || 0) + area;
  }
  return out;
}

/**
 * 클라이언트 summary 가 제 materials 와 맞는지 대조한다.
 *
 * ⚠️ panelCount 로 비교하면 안 된다. 단위가 다르다:
 *   summary.panelCount = ceil(면적 / 원판면적)  → **원판 장수**
 *   derived.panelCount = Σ qty                  → **부재 개수**
 * 예전 코드가 이 둘을 비교해서 실제 설계는 **하나도 동결되지 않았다**
 * (자재 45건짜리 설계에서 장수 8 vs 개수 82 → 409). 루프 1회 실주행에서 잡혔다.
 * 단위 테스트는 픽스처가 우연히 5=5 로 맞아 통과하고 있었다.
 *
 * 그래서 **면적**으로 본다. 면적은 materials 에서 바로 나오고 원판 규격에
 * 의존하지 않는다 — 서버는 클라이언트가 어떤 원판을 쓰는지 알 수 없다.
 */
export function crossCheckSummary(bom, derived) {
  const summary = bom.summary;
  if (!summary || typeof summary !== 'object') return; // summary 가 없으면 대조 생략

  const recomputed = recomputeAreas(bom.materials);
  const claimed = Object.values(summary).reduce((s, g) => s + (Number(g && g.totalArea) || 0), 0);
  const actual = Object.values(recomputed).reduce((s, a) => s + a, 0);

  // 면적을 안 실어 보내는 클라이언트도 있다 — 그 경우 대조를 생략한다
  if (claimed === 0) return;
  if (actual === 0) return;

  // 부동소수 누적 오차만 허용한다 (0.1%)
  const diff = Math.abs(claimed - actual);
  if (diff / actual > 0.001) {
    throw new ConflictError('BOM 자재 목록과 요약 집계가 일치하지 않습니다', {
      summary_total_area: Math.round(claimed),
      materials_total_area: Math.round(actual),
      panel_count: derived.panelCount,
      hint: 'extractors.js 의 materials 배열과 calculateSummary() 산출이 어긋났습니다',
    });
  }
}

async function nextRev(env, designId) {
  const rows = await selectMany(env, 'design_snapshots', {
    design_id: `eq.${designId}`,
    select: 'rev',
    order: 'rev.desc',
    limit: '1',
  });
  return rows && rows.length ? Number(rows[0].rev) + 1 : 1;
}

async function findByHash(env, designId, contentHash) {
  return selectOne(env, 'design_snapshots', {
    design_id: `eq.${designId}`,
    content_hash: `eq.${contentHash}`,
    select: '*',
  });
}

/**
 * 스냅샷 생성 (멱등).
 * 같은 내용이면 새 rev 를 만들지 않고 기존 스냅샷을 그대로 돌려준다.
 */
/**
 * B4 컬럼(cut_plan_payload · sheet_count)이 아직 없는 DB 인가.
 * database/workflow-cut-plan.sql 을 적용하기 전에도 스냅샷 생성·목록이 멈추지 않도록
 * 그 컬럼만 빼고 다시 시도한다. PostgREST 는 스키마 캐시에 없는 컬럼이면 PGRST204,
 * SELECT 에 없는 컬럼이면 42703 을 낸다.
 */
export const CUT_PLAN_COLUMNS = ['cut_plan_payload', 'sheet_count'];

export function isMissingCutPlanColumn(err) {
  if (!(err instanceof DbError)) return false;
  const msg = String(err.message || '');
  if (!/PGRST204|42703/.test(msg)) return false;
  return CUT_PLAN_COLUMNS.some((c) => msg.includes(c));
}

function withoutCutPlanColumns(row) {
  const out = { ...row };
  CUT_PLAN_COLUMNS.forEach((c) => { delete out[c]; });
  return out;
}

const LIST_SELECT_BASE =
  'id,rev,content_hash,design_title,item_count,module_count,panel_count,app_version,note,created_at';
const LIST_SELECT = `${LIST_SELECT_BASE},sheet_count`;

export async function createSnapshot(env, { designId, user, body }) {
  const design = await assertDesignOwner(env, designId, user.id);
  const { design: designPayload, bom, hardware } = validateSnapshotInput(body);

  const derived = deriveCounts(designPayload, bom);
  crossCheckSummary(bom, derived);

  // B4: 재단 배치 — 선택 사항. 있으면 BOM 과 맞는지 본다 (cutPlan 또는 cut_plan 키).
  const cut = validateCutPlan(body.cutPlan !== undefined ? body.cutPlan : body.cut_plan, bom);

  const contentHash = await snapshotHash(designPayload, bom);

  // 이미 같은 내용의 스냅샷이 있으면 재사용
  const existing = await findByHash(env, designId, contentHash);
  if (existing) return { snapshot: existing, reused: true };

  const title =
    (typeof body.title === 'string' && body.title.trim()) || designTitleOf(design);

  // 금액은 클라이언트가 보낸 값을 쓰지 않는다. 서버가 활성 단가로 계산한다.
  const pricebook = await getActivePricebook(env);
  const quote = calculateQuote(
    buildQuoteInputs(designPayload),
    pricebook,
    bom,
    resolveGrade(env, body.grade),
  );

  const row = {
    design_id: designId,
    content_hash: contentHash,
    created_by: user.id,
    app_version: designPayload.appVersion || null,
    design_title: title,
    design_payload: designPayload,
    bom_payload: bom,
    hardware_payload: hardware,
    quote_payload: quote,
    pricing_rule_set_id: pricebook.ruleSetId,
    item_count: derived.itemCount,
    module_count: derived.moduleCount,
    panel_count: derived.panelCount,
    note: typeof body.note === 'string' ? body.note : null,
    // B4: 배치가 없으면 NULL — "배치 안 함" 과 "0장" 을 구분한다
    cut_plan_payload: cut ? cut.cutPlan : null,
    sheet_count: cut ? cut.sheetCount : null,
  };

  // rev 는 동시 요청에서 충돌할 수 있다 (design_snapshots_rev_uniq).
  // 해시 충돌이면 다른 요청이 같은 내용을 먼저 넣은 것이므로 그 행을 돌려준다.
  let insertRow = row;
  for (let attempt = 0; attempt < MAX_REV_RETRY; attempt++) {
    insertRow.rev = await nextRev(env, designId);
    try {
      const created = await insertOne(env, 'design_snapshots', insertRow);
      return { snapshot: created, reused: false };
    } catch (err) {
      if (isMissingCutPlanColumn(err) && insertRow === row) {
        // workflow-cut-plan.sql 미적용 — 배치 없이 저장하고 로그로 알린다. 시도 횟수는 소모하지 않는다.
        console.warn('[snapshots] design_snapshots 에 cut_plan_payload/sheet_count 컬럼이 없습니다. database/workflow-cut-plan.sql 을 적용하세요. 배치 없이 저장합니다.');
        insertRow = withoutCutPlanColumns(row);
        attempt -= 1;
        continue;
      }
      if (!(err instanceof ConflictError)) throw err;
      const raced = await findByHash(env, designId, contentHash);
      if (raced) return { snapshot: raced, reused: true };
      // 내용은 다른데 rev 만 겹친 경우 → 다시 시도
    }
  }

  throw new ConflictError('스냅샷 리비전 채번에 반복 실패했습니다. 다시 시도해 주세요.');
}

/** 목록 — payload 는 제외한다 (아이템이 많으면 수 MB). */
export async function listSnapshots(env, { designId, user, limit = 20 }) {
  await assertDesignOwner(env, designId, user.id);
  const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const query = (select) => ({
    design_id: `eq.${designId}`,
    select,
    order: 'rev.desc',
    limit: String(n),
  });
  try {
    const rows = await selectMany(env, 'design_snapshots', query(LIST_SELECT));
    return rows || [];
  } catch (err) {
    if (!isMissingCutPlanColumn(err)) throw err;
    // B4 컬럼 미적용 DB — sheet_count 없이 목록을 낸다
    const rows = await selectMany(env, 'design_snapshots', query(LIST_SELECT_BASE));
    return rows || [];
  }
}

/** 단건 — payload 포함. */
export async function getSnapshot(env, { snapshotId, user }) {
  const snapshot = await selectOne(env, 'design_snapshots', {
    id: `eq.${snapshotId}`,
    select: '*',
  });
  if (!snapshot) throw new NotFoundError('스냅샷을 찾을 수 없습니다');
  await assertDesignOwner(env, snapshot.design_id, user.id);
  return snapshot;
}

/**
 * 견적 재계산 미리보기 — 저장하지 않는다.
 * 등급을 바꿔가며 금액을 비교하는 용도.
 *
 * 문서 발행 시에는 스냅샷에 핀으로 박힌 rule set 을 그대로 쓰지만,
 * 미리보기는 현재 활성 세트로 계산한다(단가 변경 반영 확인용).
 */
export async function previewQuote(env, { snapshotId, user, grade, useActiveRules = false }) {
  const snapshot = await getSnapshot(env, { snapshotId, user });

  const pricebook =
    useActiveRules || !snapshot.pricing_rule_set_id
      ? await getActivePricebook(env)
      : await getPricebookById(env, snapshot.pricing_rule_set_id);

  const quote = calculateQuote(
    buildQuoteInputs(snapshot.design_payload),
    pricebook,
    snapshot.bom_payload,
    resolveGrade(env, grade),
  );

  return {
    snapshot_id: snapshot.id,
    rev: snapshot.rev,
    quote,
    stored_pricing_rule_set_id: snapshot.pricing_rule_set_id,
    used_pricing_rule_set_id: pricebook.ruleSetId,
  };
}

/**
 * 최신 스냅샷의 content_hash.
 * 문서 목록에 stale 배지를 붙일 때 쓴다.
 */
export async function latestHash(env, designId) {
  const rows = await selectMany(env, 'design_snapshots', {
    design_id: `eq.${designId}`,
    select: 'content_hash,rev',
    order: 'rev.desc',
    limit: '1',
  });
  return rows && rows.length ? rows[0].content_hash : null;
}
