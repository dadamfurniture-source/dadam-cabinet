/**
 * 간편 플래너 지시서 미리보기 — POST /planner/preview
 *   (2026-11-20 사장님 「작업지시서 앱으로 보내기 로딩이 오래걸리는데 앱으로 보내기 전에 작업지시서 바로 확인 할 수 있도록 도면까지」 ·
 *    질문 창에서 고르심 「앱 지시서 그대로, 저장 없이」)
 *
 * 「앱으로 보내기」(planner-handoff.js receivePlannerDesign)와 같은 본문을 받아 같은 검사를 하고, 발행(documents.js docPayloadOf)과
 * 같은 칸으로 문서 하나를 **메모리에서** 만들어 인쇄 틀 그대로 그린다. 아무것도 저장하지 않는다 — 설계 · 동결본 · 문서 · 그림 줄 ·
 * 버킷 · 견적 계산 모두 없음. 그림은 본문의 SVG(ISO · 상판 탑뷰 · 배치 평면 · 속 구조)를 data: 주소로 싣는다 (3D 앞모습 PNG 도 오면 싣는다).
 * 앱에 이미 같은 플래너 설계가 있으면 그 현장 정보 · 일정 · 현장 사진을 읽기만 한다 (없으면 「미입력」 그대로).
 * 보내는 사람 · 등급 규칙은 보내기 · 발행과 같다 (senderCompanyOf · assertDocPlan).
 */
import { ValidationError } from './supabase.js';
import { validateSnapshotInput, deriveCounts, crossCheckSummary, validateCutPlan, validateAssembly } from './snapshots.js';
import { DOC_TYPES, assertDocPlan, docPayloadOf, renderDocument, SITE_ORDER_TYPES } from './documents.js';
import { senderCompanyOf, findDesign, duplicatePartIds, plannerRendersOf, REF_RE } from './planner-handoff.js';
import { itemUniqueIdOf, workOrderTotals } from './work-order-data.js';
import { normalizePack, WORK_ORDER_PACKS } from './templates/work-order.js';
import { getSiteInfo, listSchedulesForDoc } from './site-info.js';
import { loadCountertopContext } from './reports/outsource.js';
import { sitePhotosOf } from './work/job-sheet.js';

/** 미리보기로 그리는 문서 — 고객 확인서(금액 · 공유 링크)는 빼고 작업자 문서만 */
export const PREVIEW_DOC_TYPES = Object.freeze(DOC_TYPES.filter((t) => t !== 'customer_confirmation'));
const TITLE_MAX = 120;

/** 그림 bytes → data: 주소 */
function dataUrlOf(r) {
  let bin = '';
  const bytes = r.bytes;
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${r.contentType};base64,${btoa(bin)}`;
}

/**
 * 본문 그림 → 발행의 collectRenders 와 같은 모양의 목록 + 경로 → 주소 (인쇄의 renderUrls 자리)
 * @returns {{ collect:function, urls:Map<string,string> }}
 */
export function previewRendersOf(renders) {
  const urls = new Map();
  const byKind = new Map();
  renders.forEach((r, k) => {
    const key = `${r.kind}|${r.item}`;
    if (byKind.has(key)) return; // 같은 품목 · 종류는 첫 장
    const path = `preview/${r.kind}/${r.item}/${k}.${r.ext}`;
    urls.set(path, dataUrlOf(r));
    byKind.set(key, { path, r });
  });
  const collect = (kind, items) => (Array.isArray(items) ? items : []).map((item, i) => {
    const uid = itemUniqueIdOf(item);
    const hit = uid !== null ? byKind.get(`${kind}|${uid}`) : null;
    const out = { item_index: i, item_unique_id: uid, path: hit ? hit.path : null, width: hit ? hit.r.width : null, height: hit ? hit.r.height : null, created_at: null };
    if (kind === 'inside' && hit && hit.r.meta) {
      out.view = hit.r.meta.view || null;
      out.boxes = Array.isArray(hit.r.meta.boxes) ? hit.r.meta.boxes : [];
    }
    return out;
  });
  return { collect, urls };
}

/** 맨 위 띠 — 미리보기라 발행되지 않았음을 종이에도 적는다 */
const BANNER = '<div style="position:sticky;top:0;z-index:9;background:#fbefd4;color:#6f4c0c;border-bottom:1px solid #d9c08a;padding:6px 12px;font:600 13px/1.5 system-ui,sans-serif">미리보기 — 저장 · 발행되지 않은 지시서입니다</div>';
export function withBanner(html) {
  const s = String(html || '');
  const at = s.search(/<body[^>]*>/i);
  if (at < 0) return BANNER + s;
  const end = s.indexOf('>', at) + 1;
  return s.slice(0, end) + BANNER + s.slice(end);
}

/**
 * @param {object} env
 * @param {{user:object, body:{doc_type:string, pack?:string, planner_design_id?:string, title:string, design:object, bom:object, hardware?:object, cutPlan?:object, renders?:object[], notes?:object}}} args
 * @returns {Promise<{doc_type:string, pack:string|null, html:string}>}
 */
export async function previewPlannerDoc(env, { user, body }) {
  const b = body || {};
  const docType = b.doc_type;
  if (!PREVIEW_DOC_TYPES.includes(docType)) throw new ValidationError(`doc_type 은 ${PREVIEW_DOC_TYPES.join(' · ')} 중 하나여야 합니다`, { field: 'doc_type' });
  const pack = docType === 'work_order' ? normalizePack(b.pack) : null;
  if (docType === 'work_order' && !pack) throw new ValidationError(`pack 은 ${Object.keys(WORK_ORDER_PACKS).join(', ')} 중 하나여야 합니다`, { field: 'pack' });
  const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, TITLE_MAX) : '';
  if (!title) throw new ValidationError('title(설계 이름)이 필요합니다');
  const ref = b.planner_design_id == null ? '' : String(b.planner_design_id);
  if (ref && !REF_RE.test(ref)) throw new ValidationError('planner_design_id 모양이 틀렸습니다');

  const companyId = await senderCompanyOf(env, user);
  await assertDocPlan(env, { company_id: companyId }, docType);

  // 보내기 · 동결과 같은 검사 (저장은 하지 않는다)
  const { design: designPayload, bom, hardware } = validateSnapshotInput(b);
  const dup = duplicatePartIds(bom.materials);
  if (dup.length) throw new ValidationError('BOM 부재 ID 가 겹칩니다', dup.slice(0, 20));
  crossCheckSummary(bom, deriveCounts(designPayload, bom));
  const cut = validateCutPlan(b.cutPlan !== undefined ? b.cutPlan : b.cut_plan, bom);
  validateAssembly(bom.assembly, bom);
  const { collect, urls } = previewRendersOf(plannerRendersOf(b.renders));

  // 앱에 이미 있는 같은 설계 — 현장 정보 · 일정 · 현장 사진만 읽는다 (없으면 미입력)
  let appDesign = null;
  if (ref) {
    try { appDesign = await findDesign(env, companyId, ref); } catch { appDesign = null; }
  }
  const designId = appDesign ? appDesign.id : null;
  let site = { site_info: null, schedules: [] };
  if (designId) {
    try { site = { site_info: await getSiteInfo(env, designId), schedules: await listSchedulesForDoc(env, designId) }; } catch { /* 읽지 못하면 미입력 */ }
  }

  const snapshot = {
    id: 'preview', design_id: designId, rev: 0, content_hash: null, design_title: title,
    design_payload: designPayload, bom_payload: bom, hardware_payload: hardware || null, quote_payload: null,
    cut_plan_payload: cut ? cut.cutPlan : null, sheet_count: cut ? cut.sheetCount : null,
  };
  const renderPayload = {
    quote: null, price_tier: 'customer', instructions: '', issued_by: user.email || null, preview: true,
    ...(await docPayloadOf(env, { docType, snapshot, designId, body: { notes: b.notes }, collect, site, prevRev: false })),
  };
  const doc = {
    id: 'preview', design_id: designId, snapshot_id: 'preview', doc_type: docType, rev: 0, doc_no: '미리보기', status: 'preview',
    title, customer_name: null, customer_name_masked: null, render_payload: renderPayload,
    totals: docType === 'work_order' ? workOrderTotals(snapshot, renderPayload.cut_plan) : {},
    created_at: new Date().toISOString(),
  };

  const needsTop = (docType === 'work_order' && (pack === 'top' || pack === 'all')) || (docType === 'installation_order' && !!renderPayload.drawing_version);
  const top = needsTop ? await loadCountertopContext(env, { doc, snapshot }) : null;
  const sitePhotos = docType === 'demolition_order' && designId ? await sitePhotosOf(env, { designId, companyId }) : null;
  const html = renderDocument(doc, snapshot, { toolbar: false, pack: pack || 'all', top, memo: '', sitePhotos, renderUrls: urls });
  return { doc_type: docType, pack, html: withBanner(html), site: !!(site.site_info), site_order: SITE_ORDER_TYPES.includes(docType) };
}
