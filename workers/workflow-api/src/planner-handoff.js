/**
 * 간편 플래너 설계 받기 — POST /planner/designs (2026-11-04 사장님 「각 작업자에 작업지시서로 분배」, 승인 계획 3-2)
 *
 * 간편 플래너(dadam-planner-lite, 사장님 PC)가 설계 · BOM · 재단 배치를 보내면 앱 설계(designs, source 'planner-lite')를
 * 찾거나 만들고, 지금 동결 함수(createSnapshot) 그대로 동결본을 만든다. 그 뒤 확인서 → 고객 승인 → 수주 → 작업지시서 발행은
 * 지금 앱 흐름 그대로 (상세설계 화면과 같은 라우트).
 *
 *   누가: 본사 대표 · 실장 · 관리자 (본사 설정을 다루는 사람 — assertSettingsEditor) → 본사 설계,
 *         플래너를 쓰는 팩토리(Expert · Agent · MANAGER — planner-drafts.js plannerCompanyOf)의 대표 · 실장 → 그 팩토리 설계.
 *         아니면 403 not_planner_sender.
 *   설계 주인: 처음 보낸 사람 (생산 계획 · 공장 작업자는 그 사람의 본사 수주를 본다 — orders.js ownHqDesignIds).
 *   같은 플래너 설계 = 같은 앱 설계 (DB 0035 designs_source_ref_key). 동결본은 내용이 같으면 그대로 다시 쓴다 (snapshots.js 해시).
 *   판재 행 부재 ID(partId)가 겹치면 422 — 작업지시서 · 재단 배치가 행을 부재 ID 로 찾는다.
 *   DB 0035 적용 전이면 409 db_pending.
 *   정면 렌더 (2026-11-05 사장님 C 「플래너 3D 앞모습을 같이」): renders [{ item, png, width?, height? }] — item = 설계 품목 uniqueId,
 *     png = PNG base64 (data URL 가능). 버킷 renders · 표 design_renders (kind front) 에 넣는다 → 작업지시서 · 시공 지시서 발행 때 고정.
 *     못 넣은 렌더는 동결을 막지 않는다 (렌더 없이 발행 — 응답 renders_saved).
 *   ISO 도면 (2026-11-05 사장님 「도면 표현은 플래너의 도면을 거의 그대로 · 선 굵기 종류 · 치수 정확하게 · 정면도 말고 iso 뷰」):
 *     renders [{ item, kind: 'iso', svg }] — 플래너가 그린 SVG 그대로. 버킷 renders (image/svg+xml) · design_renders kind iso.
 *     스크립트 · 바깥 주소 · 이벤트 속성이 든 SVG 는 422 (서명 주소를 바로 열어도 안전하게).
 *   상판 탑뷰 (같은 날 — ㄱ · ㄷ자처럼 하부장이 두 벽 이상): renders [{ item, kind: 'plan', svg }] — 같은 검사 · design_renders kind plan.
 *     앱 상판 발주서가 코너 상판 그림으로 싣는다 (일자는 앱이 그린다).
 *   배치 평면 · 속 구조 정면도 (2026-11-19 사장님 「각 작업에 필요한 도면들」 — DB 0072):
 *     renders [{ item, kind: 'layout', svg }] — 설계에 하나 (벽 · 가전 자리. item 은 아무 품목). 철거 · 설치 지시서에 싣는다.
 *     renders [{ item, kind: 'inside', svg, view: { w, h }, boxes: [{ nos: [모듈 번호…], x, y, w, h }] }] — 벽(품목)마다 속 구조 정면도.
 *       boxes 는 그림(viewBox) 안에서 모듈이 놓인 네모 — 조립 지시서가 모듈마다 그 자리를 잘라 보인다. 있는 칸 design_renders.camera 에 적는다.
 *     DB 0072 전이면 이 두 종류만 빠진다 (renders_dropped 에 db_pending — 옛 종류는 그대로 들어간다).
 *   렌더마다 그 동결본의 해시를 같이 적는다 (camera.snapshot) — 발행 때 다른 판의 그림을 싣지 않는다 (work-order-data.js collectRenders).
 *   응답 renders_saved (넣은 수) · renders_dropped [{ item, kind, reason: upload_failed | save_failed | db_pending }] (못 넣은 것 — 동결은 그대로).
 *   조립 명세 (D): bom.assembly 는 createSnapshot 의 validateAssembly 를 그대로 거친다.
 * 숫자는 플래너(엔진)가 낸 BOM 그대로 — 여기서 다시 계산하지 않는다 (견적은 createSnapshot 이 활성 단가로).
 */
import {
  selectOne,
  insertOne,
  insertMany,
  hqCompanyId,
  ValidationError,
  ForbiddenError,
  ConflictError,
} from './supabase.js';
import { assertSettingsEditor } from './production/service.js';
import { createSnapshot } from './snapshots.js';
import { isMissingRelation } from './work-order-data.js';
import { uploadObject, RENDERS_BUCKET } from './storage.js';
import { plannerCompanyOf } from './planner-drafts.js';

/** 한 번에 받는 렌더 — 벽(품목)마다 정면 PNG + ISO SVG + 속 구조 정면도 SVG, 설계에 상판 탑뷰 · 배치 평면. PNG 는 장마다 4MB · SVG 는 2MB 까지 */
export const RENDER_MAX = 24;
/** 플래너가 그려 보내는 SVG 종류 */
const SVG_KINDS = Object.freeze(['iso', 'plan', 'layout', 'inside']);
/** DB 0072 부터 받는 종류 (design_renders_kind_check) */
const NEW_KINDS = Object.freeze(['layout', 'inside']);
/** 속 구조 정면도의 모듈 상자 수 · 한 상자에 든 모듈 번호 수 (단 묶음 · 하부장 위 수납장은 번호가 여럿) */
export const INSIDE_BOX_MAX = 200;
const INSIDE_BOX_NOS_MAX = 20;
const KIND_NAME = Object.freeze({ front: '정면 렌더', iso: 'ISO 도면', plan: '상판 탑뷰', layout: '배치 평면', inside: '속 구조 정면도' });
export const RENDER_MAX_BYTES = 4 * 1024 * 1024;
export const ISO_MAX_BYTES = 2 * 1024 * 1024;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * 플래너 ISO SVG 검사 — 그림 요소만. 스크립트 · foreignObject · on* 속성 · 바깥 href · javascript: · DOCTYPE/ENTITY · @import 는 막는다
 * (img 로만 싣지만 서명 주소를 브라우저로 바로 열 수도 있다). 통과하면 그대로 돌려준다.
 */
export function safeIsoSvg(raw, i = 0) {
  const svg = typeof raw === 'string' ? raw.trim() : '';
  const at = `renders[${i}].svg`;
  if (!svg) throw new ValidationError(`${at} 가 비었습니다`);
  if (new TextEncoder().encode(svg).length > ISO_MAX_BYTES) throw new ValidationError(`${at} 가 ${ISO_MAX_BYTES / 1024 / 1024}MB 를 넘습니다`);
  if (!/^(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) throw new ValidationError(`${at} 는 <svg> … </svg> 여야 합니다`);
  const bad = [
    [/<script/i, 'script'], [/<foreignObject/i, 'foreignObject'], [/<!(DOCTYPE|ENTITY)/i, 'DOCTYPE'],
    [/\son[a-z]+\s*=/i, '이벤트 속성'], [/javascript:/i, 'javascript:'], [/@import/i, '@import'],
    [/href\s*=\s*(?!\s)(?!["']?#)/i, '바깥 href'], [/url\(\s*(?!\s)(?!['"]?#)/i, '바깥 url()'],
    [/<(iframe|embed|object|image|audio|video)\b/i, '그림 밖 요소'],
  ].find(([re]) => re.test(svg));
  if (bad) throw new ValidationError(`${at} 에 쓸 수 없는 것이 있습니다 (${bad[1]})`);
  return svg;
}

/** 속 구조 정면도의 그림 크기 · 모듈 상자 — 모양이 틀리면 422. 숫자는 그림(viewBox) 단위 */
function insideMetaOf(r, i) {
  const at = `renders[${i}]`;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const vw = num(r.view && r.view.w);
  const vh = num(r.view && r.view.h);
  if (!(vw > 0) || !(vh > 0) || vw > 1e6 || vh > 1e6) throw new ValidationError(`${at}.view 는 { w, h } (양수) 여야 합니다`);
  const list = r.boxes === undefined || r.boxes === null ? [] : r.boxes;
  if (!Array.isArray(list) || list.length > INSIDE_BOX_MAX) throw new ValidationError(`${at}.boxes 는 ${INSIDE_BOX_MAX}개까지 배열이어야 합니다`);
  const boxes = list.map((b, k) => {
    const nos = b && Array.isArray(b.nos) ? b.nos : null;
    if (!nos || !nos.length || nos.length > INSIDE_BOX_NOS_MAX || nos.some((n) => !Number.isInteger(n) || n < 1 || n > 500)) {
      throw new ValidationError(`${at}.boxes[${k}].nos 는 모듈 번호(1 ~ 500) 배열이어야 합니다`);
    }
    const x = num(b.x);
    const y = num(b.y);
    const w = num(b.w);
    const h = num(b.h);
    if (!(x >= 0) || !(y >= 0) || !(w > 0) || !(h > 0) || x + w > vw + 0.5 || y + h > vh + 0.5) {
      throw new ValidationError(`${at}.boxes[${k}] 는 그림 안의 네모 { x, y, w, h } 여야 합니다`);
    }
    return { nos: nos.slice(), x, y, w, h };
  });
  return { view: { w: vw, h: vh }, boxes };
}

/** 본문 renders → [{ item, kind, bytes, contentType, ext, width, height, meta? }] — 모양이 틀리면 422 (동결 전에 거른다) */
export function plannerRendersOf(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > RENDER_MAX) throw new ValidationError(`renders 는 ${RENDER_MAX}장까지 배열이어야 합니다`);
  return list.map((r, i) => {
    const item = Number(r && r.item);
    if (!Number.isInteger(item) || item < 1 || item > 1e9) throw new ValidationError(`renders[${i}].item 은 품목 uniqueId (양의 정수) 여야 합니다`);
    const dim = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 20000 ? Number(v) : null);
    if (SVG_KINDS.includes(r.kind)) {
      const svg = safeIsoSvg(r.svg, i);
      const out = { item, kind: r.kind, bytes: new TextEncoder().encode(svg), contentType: 'image/svg+xml', ext: 'svg', width: dim(r.width), height: dim(r.height) };
      return r.kind === 'inside' ? { ...out, meta: insideMetaOf(r, i) } : out;
    }
    if (r.kind !== undefined && r.kind !== null && r.kind !== 'front') throw new ValidationError(`renders[${i}].kind 는 front · iso · plan · layout · inside 중 하나여야 합니다`);
    const b64 = String((r && r.png) || '').replace(/^data:image\/png;base64,/, '');
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new ValidationError(`renders[${i}].png 는 PNG base64 여야 합니다`);
    const bin = atob(b64);
    if (bin.length > RENDER_MAX_BYTES) throw new ValidationError(`renders[${i}] 가 ${RENDER_MAX_BYTES / 1024 / 1024}MB 를 넘습니다`);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    if (!PNG_SIG.every((v, k) => bytes[k] === v)) throw new ValidationError(`renders[${i}].png 가 PNG 가 아닙니다`);
    return { item, kind: 'front', bytes, contentType: 'image/png', ext: 'png', width: dim(r.width), height: dim(r.height) };
  });
}

/**
 * 렌더를 버킷 · design_renders 에 — 못 넣은 것은 건너뛴다 (동결은 이미 끝났다).
 *   올리기는 장마다, 줄 넣기는 묶어서 한 번에 (바깥 호출 수) — 새 종류(layout · inside)는 DB 0072 전이면 거절되므로 따로 묶는다 (옛 종류가 같이 빠지지 않게).
 *   contentHash = 이 렌더와 같이 온 동결본의 해시 — camera.snapshot 에 적어 발행 때 판을 맞춘다.
 * @returns {Promise<{saved:number, dropped:{item:number, kind:string, reason:string}[]}>}
 */
async function saveRenders(env, designId, renders, contentHash) {
  const dropped = [];
  const ready = [];
  const stamp = Date.now();
  for (const [k, r] of renders.entries()) {
    const path = `${designId}/${r.item}/${r.kind}-${stamp}-${k}.${r.ext}`;
    try {
      await uploadObject(env, RENDERS_BUCKET, path, r.bytes, r.contentType);
      ready.push({
        r,
        row: { design_id: designId, item_unique_id: r.item, kind: r.kind, path, width: r.width, height: r.height, camera: { source: PLANNER_SOURCE, snapshot: contentHash || null, ...(r.meta || {}) } },
      });
    } catch (e) {
      console.warn(`[planner-handoff] ${KIND_NAME[r.kind]}을 올리지 못했습니다 — 없이 발행합니다:`, e && e.message);
      dropped.push({ item: r.item, kind: r.kind, reason: 'upload_failed' });
    }
  }
  let saved = 0;
  for (const group of [ready.filter((x) => !NEW_KINDS.includes(x.r.kind)), ready.filter((x) => NEW_KINDS.includes(x.r.kind))]) {
    if (!group.length) continue;
    try {
      await insertMany(env, 'design_renders', group.map((x) => x.row));
      saved += group.length;
    } catch (e) {
      // 새 종류를 DB 가 아직 모른다 (0072 전 — design_renders_kind_check 23514)
      const pending = NEW_KINDS.includes(group[0].r.kind) && /23514/.test(String((e && e.message) || ''));
      console.warn(`[planner-handoff] 그림 ${group.length}장을 적지 못했습니다 — 없이 발행합니다:`, e && e.message);
      group.forEach((x) => dropped.push({ item: x.r.item, kind: x.r.kind, reason: pending ? 'db_pending' : 'save_failed' }));
    }
  }
  return { saved, dropped };
}

export const PLANNER_SOURCE = 'planner-lite';
export const REF_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
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

/**
 * 설계를 넣을 업체 — 본사 대표 · 실장 · 관리자면 본사, 플래너를 쓰는 팩토리의 대표 · 실장이면 그 팩토리.
 * 본사 직원 · 팩토리 직원 · 플래너를 못 쓰는 팩토리는 403 not_planner_sender.
 */
export async function senderCompanyOf(env, user) {
  const hq = await hqCompanyId(env);
  try {
    await assertSettingsEditor(env, user, hq);
    return hq;
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
  }
  let sender = null;
  try {
    const { company, canManage } = await plannerCompanyOf(env, user);
    if (company.kind === 'partner' && canManage) sender = company;
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
  }
  // Manager 팩토리도 보낸다 — 고객 확인서를 내려고 (2026-11-20 사장님 「확인서 열어 두기」). 지시서 · 미리보기의 등급은
  // 문서마다 documents.js DOC_PLANS 가 본다 (확인서 Manager 이상 · 작업지시서 · 설치 · 철거 · 납품 Expert 이상)
  if (sender) return sender.id;
  throw new ForbiddenError(
    '플래너 설계는 본사 대표 · 실장 · 관리자, Manager · Expert · Agent 팩토리 대표 · 실장이 보냅니다',
    'not_planner_sender'
  );
}

/** 같은 출처 · 같은 id 의 앱 설계 (없으면 null) */
export async function findDesign(env, hq, ref) {
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

  const companyId = await senderCompanyOf(env, user);

  const dup = duplicatePartIds(b.bom && b.bom.materials);
  if (dup.length) throw new ValidationError('BOM 부재 ID 가 겹칩니다', dup.slice(0, 20));
  const renders = plannerRendersOf(b.renders);

  let design = await findDesign(env, companyId, ref);
  let created = false;
  if (!design) {
    const items = b.design && Array.isArray(b.design.items) ? b.design.items : [];
    try {
      design = await insertOne(env, 'designs', {
        name,
        user_id: user.id,
        company_id: companyId,
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
      design = await findDesign(env, companyId, ref); // 같은 설계를 동시에 보냈다 — 먼저 만든 것을 쓴다
      if (!design) throw e;
    }
  }

  const { snapshot, reused } = await createSnapshot(env, {
    designId: design.id,
    user,
    body: { design: b.design, bom: b.bom, hardware: b.hardware, cutPlan: b.cutPlan, title: name, grade: b.grade },
  });
  const rendered = renders.length ? await saveRenders(env, design.id, renders, snapshot.content_hash) : { saved: 0, dropped: [] };
  // 동결본에 실린 재단 방식 (플래너가 고른 것 — 없으면 null). 방식이나 배치가 바뀌면 새 판이다 (snapshots.js)
  const cutPlan = snapshot.cut_plan_payload;
  const cutStrategy = cutPlan && typeof cutPlan.strategy === 'string' ? cutPlan.strategy : null;
  return { design_id: design.id, created, snapshot_id: snapshot.id, rev: snapshot.rev, reused: !!reused, renders_saved: rendered.saved, renders_dropped: rendered.dropped, cut_strategy: cutStrategy };
}
