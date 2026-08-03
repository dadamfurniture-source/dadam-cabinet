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
  assertDesignOwner,
  designTitleOf,
  insertOne,
  selectOne,
  selectMany,
} from './supabase.js';
import { snapshotHash } from './util/hash.js';

const MAX_REV_RETRY = 3;

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
export function crossCheckSummary(bom, derived) {
  const summary = bom.summary;
  if (!summary || typeof summary !== 'object') return; // summary 가 없으면 대조 생략

  const summaryPanels = Object.values(summary).reduce(
    (sum, g) => sum + (Number(g && g.panelCount) || 0),
    0,
  );
  if (summaryPanels === 0) return; // 집계가 비어 있으면 대조 의미 없음

  if (Math.round(summaryPanels) !== derived.panelCount) {
    throw new ConflictError('BOM 자재 목록과 요약 집계가 일치하지 않습니다', {
      summary_panel_count: Math.round(summaryPanels),
      materials_panel_count: derived.panelCount,
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
export async function createSnapshot(env, { designId, user, body }) {
  const design = await assertDesignOwner(env, designId, user.id);
  const { design: designPayload, bom, hardware } = validateSnapshotInput(body);

  const derived = deriveCounts(designPayload, bom);
  crossCheckSummary(bom, derived);

  const contentHash = await snapshotHash(designPayload, bom);

  // 이미 같은 내용의 스냅샷이 있으면 재사용
  const existing = await findByHash(env, designId, contentHash);
  if (existing) return { snapshot: existing, reused: true };

  const title =
    (typeof body.title === 'string' && body.title.trim()) || designTitleOf(design);

  const row = {
    design_id: designId,
    content_hash: contentHash,
    created_by: user.id,
    app_version: designPayload.appVersion || null,
    design_title: title,
    design_payload: designPayload,
    bom_payload: bom,
    hardware_payload: hardware,
    quote_payload: null, // W11-3 에서 채운다
    item_count: derived.itemCount,
    module_count: derived.moduleCount,
    panel_count: derived.panelCount,
    note: typeof body.note === 'string' ? body.note : null,
  };

  // rev 는 동시 요청에서 충돌할 수 있다 (design_snapshots_rev_uniq).
  // 해시 충돌이면 다른 요청이 같은 내용을 먼저 넣은 것이므로 그 행을 돌려준다.
  for (let attempt = 0; attempt < MAX_REV_RETRY; attempt++) {
    row.rev = await nextRev(env, designId);
    try {
      const created = await insertOne(env, 'design_snapshots', row);
      return { snapshot: created, reused: false };
    } catch (err) {
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
  const rows = await selectMany(env, 'design_snapshots', {
    design_id: `eq.${designId}`,
    select:
      'id,rev,content_hash,design_title,item_count,module_count,panel_count,app_version,note,created_at',
    order: 'rev.desc',
    limit: String(n),
  });
  return rows || [];
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
