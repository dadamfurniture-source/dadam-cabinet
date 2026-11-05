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
 *   정면 렌더 (2026-11-05 사장님 C 「플래너 3D 앞모습을 같이」): renders [{ item, png, width?, height? }] — item = 설계 품목 uniqueId,
 *     png = PNG base64 (data URL 가능). 버킷 renders · 표 design_renders (kind front) 에 넣는다 → 작업지시서 · 시공 지시서 발행 때 고정.
 *     못 넣은 렌더는 동결을 막지 않는다 (렌더 없이 발행 — 응답 renders_saved).
 *   조립 명세 (D): bom.assembly 는 createSnapshot 의 validateAssembly 를 그대로 거친다.
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
import { uploadObject, RENDERS_BUCKET } from './storage.js';

/** 한 번에 받는 정면 렌더 — 벽(품목) 수만큼, 장마다 4MB 까지 */
export const RENDER_MAX = 8;
export const RENDER_MAX_BYTES = 4 * 1024 * 1024;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 본문 renders → [{ item, bytes, width, height }] — 모양이 틀리면 422 (동결 전에 거른다) */
export function plannerRendersOf(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > RENDER_MAX) throw new ValidationError(`renders 는 ${RENDER_MAX}장까지 배열이어야 합니다`);
  return list.map((r, i) => {
    const item = Number(r && r.item);
    if (!Number.isInteger(item) || item < 1 || item > 1e9) throw new ValidationError(`renders[${i}].item 은 품목 uniqueId (양의 정수) 여야 합니다`);
    const b64 = String((r && r.png) || '').replace(/^data:image\/png;base64,/, '');
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new ValidationError(`renders[${i}].png 는 PNG base64 여야 합니다`);
    const bin = atob(b64);
    if (bin.length > RENDER_MAX_BYTES) throw new ValidationError(`renders[${i}] 가 ${RENDER_MAX_BYTES / 1024 / 1024}MB 를 넘습니다`);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    if (!PNG_SIG.every((v, k) => bytes[k] === v)) throw new ValidationError(`renders[${i}].png 가 PNG 가 아닙니다`);
    const dim = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 20000 ? Number(v) : null);
    return { item, bytes, width: dim(r.width), height: dim(r.height) };
  });
}

/** 렌더를 버킷 · design_renders 에 — 못 넣은 것은 건너뛴다 (동결은 이미 끝났다) */
async function saveRenders(env, designId, renders) {
  let saved = 0;
  for (const [k, r] of renders.entries()) {
    const path = `${designId}/${r.item}/front-${Date.now()}-${k}.png`;
    try {
      await uploadObject(env, RENDERS_BUCKET, path, r.bytes, 'image/png');
      await insertOne(env, 'design_renders', { design_id: designId, item_unique_id: r.item, kind: 'front', path, width: r.width, height: r.height });
      saved += 1;
    } catch (e) {
      console.warn('[planner-handoff] 정면 렌더를 넣지 못했습니다 — 렌더 없이 발행합니다:', e && e.message);
    }
  }
  return saved;
}

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
  const renders = plannerRendersOf(b.renders);

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
  const rendersSaved = renders.length ? await saveRenders(env, design.id, renders) : 0;
  return { design_id: design.id, created, snapshot_id: snapshot.id, rev: snapshot.rev, reused: !!reused, renders_saved: rendersSaved };
}
