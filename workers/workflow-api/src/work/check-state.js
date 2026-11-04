/**
 * 작업자 필수 확인 — 칸 · 지금 값 · 완료 막기 (work/checks.js 화면 길과 factory.js · updates.js 완료 길이 같이 쓴다)
 *
 *   지금 문서: 설계의 문서 중 새 판에 밀리지 않고 회수되지 않은 마지막 rev (작업지시서 · 시공 지시서).
 *   칸: 원장(문서에 고정된 재단 배치) · 모듈(동결 설계, 도어 · 서랍) · 주문 — 항목 조건은 check-items.js itemApplies.
 *   지금 값: work_checks (DB 0035) 같은 칸의 마지막 줄.
 *   완료 막기 (2026-11-04 사장님 확정 「필수만 막음」, 목록 판 block 'must' — v1): 그 역할의 필수가 남았으면 409 checks_left.
 *     지시서가 없거나 · 목록이 막지 않는 판(v0)이거나 · 그 역할 항목이 없거나 · DB 0035 적용 전이면 막지 않는다.
 */
import { selectOne, selectMany, ConflictError, NotFoundError } from '../supabase.js';
import { checkListOfDoc, itemsFor, itemApplies, CHECK_ROLE_LABEL } from './check-items.js';
import { itemLabel } from '../templates/work-order.js';
import { isMissingRelation } from '../work-order-data.js';

/** 역할 → 여는 꾸러미 (작업지시서 ?pack=, 설치는 시공 지시서) */
export const PACKS_OF_ROLE = Object.freeze({ cut: ['cut', 'labels'], edge: ['cut', 'labels'], assembly: ['assembly'], install: ['install'] });
/** 역할 → 문서 종류 */
export const DOC_TYPE_OF_ROLE = Object.freeze({ cut: 'work_order', edge: 'work_order', assembly: 'work_order', install: 'installation_order' });

/** 설계의 지금 문서 */
export async function currentDoc(env, designId, docType) {
  return selectOne(env, 'design_documents', {
    design_id: `eq.${designId}`,
    doc_type: `eq.${docType}`,
    superseded_by: 'is.null',
    status: 'neq.revoked',
    order: 'rev.desc',
    select: '*',
  });
}

/** 주문 → 지금 문서 + 동결본 + 고정 목록 (없으면 NotFound) */
export async function docContext(env, order, docType) {
  const doc = order.design_id ? await currentDoc(env, order.design_id, docType) : null;
  if (!doc) throw new NotFoundError(docType === 'installation_order' ? '이 주문의 시공 지시서가 아직 없습니다' : '이 주문의 작업지시서가 아직 없습니다');
  const snapshot = await selectOne(env, 'design_snapshots', { id: `eq.${doc.snapshot_id}`, select: '*' });
  if (!snapshot) throw new NotFoundError('문서가 참조하는 스냅샷이 없습니다');
  return { doc, snapshot, list: checkListOfDoc(doc) };
}

/**
 * 체크하는 칸 — 범위마다 (원장 = 문서에 고정된 재단 배치의 원장, 모듈 = 동결 설계의 모듈, 주문 = 하나).
 * @returns {{scope_key:string, scope:string, label:string, module:object|null}[]}
 */
export function cellsOf(doc, snapshot, scope) {
  if (scope === 'order') return [{ scope_key: '', scope, label: '주문', module: null }];
  if (scope === 'sheet') {
    const rp = (doc && doc.render_payload) || {};
    const plan = rp.cut_plan !== undefined ? rp.cut_plan : snapshot && snapshot.cut_plan_payload;
    const sheets = plan && Array.isArray(plan.sheets) ? plan.sheets : [];
    return sheets.map((s) => ({ scope_key: `sheet:${s.no}`, scope, label: `원장 ${s.no} · ${s.material || ''} ${s.thickness || ''}T`.trim(), module: null }));
  }
  if (scope === 'module') {
    const items = (snapshot && snapshot.design_payload && Array.isArray(snapshot.design_payload.items)) ? snapshot.design_payload.items : [];
    return items.flatMap((item, i) => (Array.isArray(item.modules) ? item.modules : []).map((m, j) => ({
      scope_key: `module:${i}:${j}`, scope, label: `${itemLabel(item, i)} · ${j + 1} ${m.name || m.type || ''}`.trim(), module: m,
    })));
  }
  return [];
}

/** 역할 하나의 칸 × 항목 + 지금 값 (rows = work_checks 최신순) */
export function roleChecks(ctx, role, rows) {
  const latest = new Map();
  (rows || []).forEach((r) => {
    const k = `${r.role}|${r.scope_key}|${r.item_key}`;
    if (!latest.has(k)) latest.set(k, r);
  });
  const items = itemsFor(ctx.list, role);
  const scopes = [...new Set(items.map((x) => x.scope))];
  const cells = scopes.flatMap((scope) => cellsOf(ctx.doc, ctx.snapshot, scope).map((c) => ({
    scope_key: c.scope_key,
    label: c.label,
    items: items.filter((x) => x.scope === scope && itemApplies(x, c.module, ctx.snapshot)).map((x) => {
      const r = latest.get(`${role}|${c.scope_key}|${x.key}`);
      return { key: x.key, label: x.label, must: x.must, photo: x.photo, checked: !!(r && r.checked), at: r ? r.created_at : null, memo: r ? r.memo || null : null, photo_path: r && r.checked ? r.photo_path || null : null };
    }),
  }))).filter((c) => c.items.length);
  const all = cells.flatMap((c) => c.items);
  return {
    role,
    label: CHECK_ROLE_LABEL[role],
    packs: PACKS_OF_ROLE[role],
    cells,
    done: all.filter((x) => x.checked).length,
    total: all.length,
    must_left: all.filter((x) => x.must && !x.checked).length,
  };
}

/** 문서의 체크 줄 (최신순). DB 0035 적용 전이면 null */
export async function checkRows(env, documentId, roles) {
  try {
    return (await selectMany(env, 'work_checks', {
      document_id: `eq.${documentId}`,
      role: `in.(${roles.join(',')})`,
      order: 'created_at.desc',
      select: 'role,scope_key,item_key,checked,memo,photo_path,created_at',
      limit: '5000',
    })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

/**
 * 완료 막기 — 그 주문 · 역할의 필수가 남았으면 409 checks_left (목록 판이 block 'must' 일 때만).
 * @param {{orderId:string, role:string}} o role = cut | edge | assembly | install
 */
export async function assertChecksDone(env, { orderId, role }) {
  const docType = DOC_TYPE_OF_ROLE[role];
  if (!orderId || !docType) return;
  const order = await selectOne(env, 'orders', { id: `eq.${orderId}`, select: 'id,design_id' });
  if (!order || !order.design_id) return;
  const doc = await currentDoc(env, order.design_id, docType);
  if (!doc) return;
  const list = checkListOfDoc(doc);
  if (list.block !== 'must' || !itemsFor(list, role).length) return;
  const rows = await checkRows(env, doc.id, [role]);
  if (rows === null) return;
  const snapshot = await selectOne(env, 'design_snapshots', { id: `eq.${doc.snapshot_id}`, select: '*' });
  if (!snapshot) return;
  const left = roleChecks({ doc, snapshot, list }, role, rows).must_left;
  if (left > 0) throw new ConflictError(`필수 확인이 ${left}개 남았습니다 — 「필수 확인」에서 체크한 뒤 완료를 남겨 주세요`, { code: 'checks_left', left });
}
