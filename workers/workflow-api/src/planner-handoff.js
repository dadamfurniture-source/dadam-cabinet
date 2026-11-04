/**
 * 간편 플래너 설계 받기 — POST /planner/designs (2026-11-04 사장님 「각 작업자에 작업지시서로 분배」, 승인 계획 3-2)
 *
 * 간편 플래너(dadam-planner-lite, 사장님 PC)가 설계 · BOM · 재단 배치를 보내면 앱 설계(designs, source 'planner-lite')를
 * 찾거나 만들고, 지금 동결 함수(createSnapshot) 그대로 동결본을 만든다. 그 뒤 확인서 → 고객 승인 → 수주 → 작업지시서 발행은
 * 지금 앱 흐름 그대로 (상세설계 화면과 같은 라우트).
 *
 *   누가: 본사 대표 · 실장 · 관리자 (본사 설정을 다루는 사람 — assertSettingsEditor). 아니면 403 not_planner_sender.
 *   설계 주인: 처음 보낸 사람 (생산 계획 · 공장 작업자는 그 사람의 본사 수주를 본다 — orders.js ownHqDesignIds).
 *   같은 플래너 설계 = 같은 앱 설계 (DB 0035 designs_source_ref_key). 동결본은 내용이 같으면 그대로 다시 쓴다 (snapshots.js 해시).
 *   판재 행 부재 ID(partId)가 겹치면 422 — 작업지시서 · 재단 배치가 행을 부재 ID 로 찾는다.
 *   DB 0035 적용 전이면 409 db_pending.
 * 숫자는 플래너(엔진)가 낸 BOM 그대로 — 여기서 다시 계산하지 않는다 (견적은 createSnapshot 이 활성 단가로).
 */
import {
  selectOne,
  insertOne,
  hqCompanyId,
  ValidationError,
  ForbiddenError,
  ConflictError,
} from './supabase.js';
import { assertSettingsEditor } from './production/service.js';
import { createSnapshot } from './snapshots.js';
import { isMissingRelation } from './work-order-data.js';

export const PLANNER_SOURCE = 'planner-lite';
const REF_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const NAME_MAX = 120;

const dbPending = () => new ConflictError('DB 0035 적용 전입니다 — 사장님이 database/migrations/0035 를 적용하면 플래너 설계를 받습니다', { code: 'db_pending' });

/** 판재 행 부재 ID 가 겹치는 것 (비어 있는 ID 는 createSnapshot 이 따로 본다) */
export function duplicatePartIds(materials) {
  const seen = new Set();
  const dup = new Set();
  (Array.isArray(materials) ? materials : []).forEach((m) => {
    const id = m && m.partId != null && m.partId !== '' ? String(m.partId) : null;
    if (!id) return;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  });
  return [...dup];
}

/** 같은 출처 · 같은 id 의 앱 설계 (없으면 null) */
async function findDesign(env, hq, ref) {
  try {
    return await selectOne(env, 'designs', {
      company_id: `eq.${hq}`,
      source: `eq.${PLANNER_SOURCE}`,
      source_ref: `eq.${ref}`,
      select: 'id,user_id,name',
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
}

/**
 * @param {object} env
 * @param {{user:{id:string}, body:{planner_design_id:string, title:string, design:object, bom:object, hardware?:object, cutPlan?:object, grade?:string}}} args
 * @returns {Promise<{design_id:string, created:boolean, snapshot_id:string, rev:number, reused:boolean}>}
 */
export async function receivePlannerDesign(env, { user, body }) {
  const b = body || {};
  const ref = String(b.planner_design_id || '');
  if (!REF_RE.test(ref)) throw new ValidationError('planner_design_id 가 필요합니다 (영문 · 숫자 · _ . : - 128자까지)');
  const name = typeof b.title === 'string' ? b.title.trim().slice(0, NAME_MAX) : '';
  if (!name) throw new ValidationError('title(설계 이름)이 필요합니다');

  const hq = await hqCompanyId(env);
  try {
    await assertSettingsEditor(env, user, hq);
  } catch (e) {
    if (e instanceof ForbiddenError) throw new ForbiddenError('플래너 설계는 본사 대표 · 실장 · 관리자만 보냅니다', 'not_planner_sender');
    throw e;
  }

  const dup = duplicatePartIds(b.bom && b.bom.materials);
  if (dup.length) throw new ValidationError('BOM 부재 ID 가 겹칩니다', dup.slice(0, 20));

  let design = await findDesign(env, hq, ref);
  let created = false;
  if (!design) {
    const items = b.design && Array.isArray(b.design.items) ? b.design.items : [];
    try {
      design = await insertOne(env, 'designs', {
        name,
        user_id: user.id,
        company_id: hq,
        status: 'draft',
        app_version: PLANNER_SOURCE,
        total_items: items.length,
        total_modules: items.reduce((s, it) => s + (Array.isArray(it && it.modules) ? it.modules.length : 0), 0),
        source: PLANNER_SOURCE,
        source_ref: ref,
      });
      created = true;
    } catch (e) {
      if (isMissingRelation(e)) throw dbPending();
      if (!(e instanceof ConflictError)) throw e;
      design = await findDesign(env, hq, ref); // 같은 설계를 동시에 보냈다 — 먼저 만든 것을 쓴다
      if (!design) throw e;
    }
  }

  const { snapshot, reused } = await createSnapshot(env, {
    designId: design.id,
    user,
    body: { design: b.design, bom: b.bom, hardware: b.hardware, cutPlan: b.cutPlan, title: name, grade: b.grade },
  });
  return { design_id: design.id, created, snapshot_id: snapshot.id, rev: snapshot.rev, reused: !!reused };
}
