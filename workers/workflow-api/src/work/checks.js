/**
 * 작업자 꾸러미 · 필수 확인 (2026-11-04 사장님 「각 작업자에 작업지시서로 분배 · 작업자들에게 필수 확인사항도 포함」, 승인 계획 3-4)
 *
 * 작업자가 자기 역할의 작업지시서 꾸러미만 열고, 정본 목록(check-items.js — 발행 때 문서에 고정된 판)의 항목을 체크한다.
 * 체크는 DB 0035 work_checks 에 한 줄씩 쌓인다 (같은 칸의 마지막 줄이 지금 값).
 *
 *   공장 (재단 · 엣지 · 조립): 승인된 작업자 + 열린 공장 배정 (factory.js requireFactoryWorker). 주문은 배정된 생산 계획 주인의
 *     본사 수주만 (worker-access.js assertOwnHqOrder). 공정 → 역할 · 꾸러미: 재단 · 엣지 → cut · labels, 조립 → assembly.
 *     GET  /work/factory/orders/:orderId/pack?pack=   꾸러미 HTML (그 주문 설계의 마지막 작업지시서)
 *     GET  /work/factory/orders/:orderId/checks       내 역할 항목 · 칸 · 지금 값
 *     POST /work/factory/orders/:orderId/checks       체크 한 번
 *   설치 · 조립 작업(모집 · 초대로 맡은 일): 내 배정이 확정 이상이고 작업에 주문이 있을 때 (assignments.js loadMyAssignment).
 *     설치 → 시공 지시서 (주소 · 연락처는 열리지 않는다 — reveal.js SITE_NOTE), 조립 → 조립 꾸러미.
 *     GET  /work/assignments/:id/pack · GET|POST /work/assignments/:id/checks
 *   본사 · 업체: GET /orders/:orderId/checks — 설계를 볼 수 있는 사람이 역할 전부의 지금 값을 본다.
 *
 * 작업자 화면의 주문 이름은 가린 이름(홍*동 · 주문번호), 금액은 없다. 체크는 지금 문서 판에만 (새 판이 나오면 409 superseded).
 * 사진이 필수인 항목은 사진 올리기가 생길 때까지 체크할 수 없다 (v0 에는 없다). 0035 적용 전이면 409 db_pending.
 */
import { selectOne, selectMany, insertOne, assertDesignAccess, ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../supabase.js';
import { requireFactoryWorker } from './factory.js';
import { loadMyAssignment } from './assignments.js';
import { assertOwnHqOrder } from '../production/worker-access.js';
import { workerOrderLabel, orderLabel } from '../production/redact.js';
import { COUNTED_STATUSES } from './reveal.js';
import { assertUuid } from './validate.js';
import { checkListOfDoc, itemsFor, itemApplies, CHECK_ROLES, CHECK_ROLE_LABEL } from './check-items.js';
import { renderWorkOrder, normalizePack, itemLabel } from '../templates/work-order.js';
import { renderInstallationOrder } from '../templates/installation-order.js';
import { isMissingRelation } from '../work-order-data.js';

/** 공장 공정 → 확인 역할 */
export const CHECK_ROLE_OF_FACTORY = Object.freeze({ cutter: 'cut', edge: 'edge', asm: 'assembly' });
/** 역할 → 여는 꾸러미 (작업지시서 ?pack=, 설치는 시공 지시서) */
export const PACKS_OF_ROLE = Object.freeze({ cut: ['cut', 'labels'], edge: ['cut', 'labels'], assembly: ['assembly'], install: ['install'] });
const MEMO_MAX = 300;

const dbPending = () => new ConflictError('DB 0035 적용 전입니다 — 필수 확인 기록은 적용 뒤에 됩니다', { code: 'db_pending' });

/** 설계의 지금 문서 (새 판에 밀리지 않고 회수되지 않은 것 중 마지막 rev) */
async function currentDoc(env, designId, docType) {
  return selectOne(env, 'design_documents', {
    design_id: `eq.${designId}`,
    doc_type: `eq.${docType}`,
    superseded_by: 'is.null',
    status: 'neq.revoked',
    order: 'rev.desc',
    select: '*',
  });
}

async function docContext(env, order, docType) {
  const doc = order.design_id ? await currentDoc(env, order.design_id, docType) : null;
  if (!doc) throw new NotFoundError(docType === 'installation_order' ? '이 주문의 시공 지시서가 아직 없습니다' : '이 주문의 작업지시서가 아직 없습니다');
  const snapshot = await selectOne(env, 'design_snapshots', { id: `eq.${doc.snapshot_id}`, select: '*' });
  if (!snapshot) throw new NotFoundError('문서가 참조하는 스냅샷이 없습니다');
  return { doc, snapshot, list: checkListOfDoc(doc) };
}

async function loadOrder(env, orderId) {
  const order = await selectOne(env, 'orders', { id: `eq.${orderId}`, select: 'id,order_no,customer_name,design_id,company_id' });
  if (!order) throw new NotFoundError('주문을 찾을 수 없습니다');
  return order;
}

/** 공장 작업자 + 내 계획의 주문 + 지금 작업지시서 */
async function factoryContext(env, user, rawOrderId) {
  const orderId = assertUuid(rawOrderId, '주문 id');
  const { worker, factory, roles } = await requireFactoryWorker(env, user);
  try {
    await assertOwnHqOrder(env, { user_id: factory.plan_user_id }, orderId);
  } catch (e) {
    if (e instanceof ValidationError) throw new NotFoundError('내 생산 계획의 주문이 아닙니다');
    throw e;
  }
  const order = await loadOrder(env, orderId);
  const ctx = await docContext(env, order, 'work_order');
  return { ...ctx, worker, order, roles: roles.map((r) => CHECK_ROLE_OF_FACTORY[r]).filter(Boolean) };
}

/** 설치 · 조립 작업의 내 배정 + 주문 + 지금 문서 */
async function assignmentContext(env, user, rawId) {
  const { worker, assignment, job } = await loadMyAssignment(env, user, rawId);
  if (!COUNTED_STATUSES.includes(assignment.status)) throw new ForbiddenError('확정된 배정에서만 지시서를 엽니다', 'not_confirmed');
  const role = job.kind === 'install' ? 'install' : job.kind === 'assembly' ? 'assembly' : null;
  if (!role) throw new NotFoundError('이 작업에는 작업지시서가 없습니다');
  if (!job.order_id) throw new NotFoundError('이 작업에는 연결된 주문이 없습니다');
  const order = await loadOrder(env, job.order_id);
  const ctx = await docContext(env, order, role === 'install' ? 'installation_order' : 'work_order');
  return { ...ctx, worker, order, roles: [role] };
}

/** 꾸러미 HTML — 내 역할의 꾸러미만, 작업자 보기 (가린 주문 이름 · 주소 · 연락처 없음) */
function packHtml(ctx, rawPack) {
  const allowed = ctx.roles.flatMap((r) => PACKS_OF_ROLE[r] || []);
  if (ctx.roles.includes('install')) {
    return renderInstallationOrder(ctx.doc, ctx.snapshot, { toolbar: true, worker: { orderLabel: workerOrderLabel(ctx.order) } });
  }
  const pack = rawPack ? normalizePack(rawPack) : allowed[0];
  if (!pack || allowed.indexOf(pack) < 0) throw new ForbiddenError('내 공정의 꾸러미만 엽니다', 'not_my_pack');
  return renderWorkOrder(ctx.doc, ctx.snapshot, { toolbar: true, pack, worker: { orderLabel: workerOrderLabel(ctx.order) } });
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
    items: items.filter((x) => x.scope === scope && itemApplies(x, c.module)).map((x) => {
      const r = latest.get(`${role}|${c.scope_key}|${x.key}`);
      return { key: x.key, label: x.label, must: x.must, photo: x.photo, checked: !!(r && r.checked), at: r ? r.created_at : null, memo: r ? r.memo || null : null };
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

async function checkRows(env, documentId, roles) {
  try {
    return (await selectMany(env, 'work_checks', {
      document_id: `eq.${documentId}`,
      role: `in.(${roles.join(',')})`,
      order: 'created_at.desc',
      select: 'role,scope_key,item_key,checked,memo,created_at',
      limit: '5000',
    })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

async function checksView(env, ctx, label) {
  const rows = await checkRows(env, ctx.doc.id, ctx.roles);
  return {
    order_label: label,
    document: { id: ctx.doc.id, doc_no: ctx.doc.doc_no, rev: ctx.doc.rev },
    list_version: ctx.list.version,
    db_ready: rows !== null,
    roles: ctx.roles.map((r) => roleChecks(ctx, r, rows || [])),
  };
}

/** 체크 한 번 — 지금 문서 판 · 내 역할 · 목록 항목 · 있는 칸만 */
async function addCheck(env, ctx, user, body) {
  const b = body || {};
  if (b.document_id !== ctx.doc.id) throw new ConflictError('작업지시서가 새 판으로 바뀌었습니다 — 다시 열어 주세요', { code: 'superseded', document_id: ctx.doc.id });
  if (ctx.roles.indexOf(b.role) < 0) throw new ForbiddenError('내 역할의 항목만 체크합니다', 'not_my_role');
  const item = itemsFor(ctx.list, b.role).find((x) => x.key === b.item_key);
  if (!item) throw new ValidationError('목록에 없는 항목입니다', { field: 'item_key' });
  const scopeKey = typeof b.scope_key === 'string' ? b.scope_key : '';
  const cell = cellsOf(ctx.doc, ctx.snapshot, item.scope).find((c) => c.scope_key === scopeKey);
  if (!cell || !itemApplies(item, cell.module)) throw new ValidationError('이 항목을 체크할 칸이 아닙니다', { field: 'scope_key' });
  if (typeof b.checked !== 'boolean') throw new ValidationError('checked 는 참 · 거짓이어야 합니다', { field: 'checked' });
  if (b.memo != null && (typeof b.memo !== 'string' || b.memo.length > MEMO_MAX)) throw new ValidationError(`메모는 ${MEMO_MAX}자까지입니다`, { field: 'memo' });
  if (item.photo === 'need' && b.checked) throw new ValidationError('사진이 필요한 항목입니다 — 사진 올리기가 생기면 체크할 수 있습니다', { field: 'photo' });
  try {
    await insertOne(env, 'work_checks', {
      company_id: ctx.order.company_id,
      order_id: ctx.order.id,
      document_id: ctx.doc.id,
      worker_id: ctx.worker ? ctx.worker.id : null,
      actor_user_id: user.id,
      role: b.role,
      scope_key: scopeKey,
      item_key: item.key,
      list_version: ctx.list.version,
      checked: b.checked,
      memo: b.memo ? b.memo.trim() || null : null,
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  return { role: b.role, scope_key: scopeKey, item_key: item.key, checked: b.checked };
}

// ── 라우트 함수 (env, { user, params, body, query }) ─────────────────

/** GET /work/factory/orders/:orderId/pack — HTML */
export async function factoryPack(env, { user, params, query }) {
  return packHtml(await factoryContext(env, user, params.orderId), query && query.pack);
}
/** GET /work/factory/orders/:orderId/checks */
export async function getFactoryChecks(env, { user, params }) {
  const ctx = await factoryContext(env, user, params.orderId);
  return checksView(env, ctx, workerOrderLabel(ctx.order));
}
/** POST /work/factory/orders/:orderId/checks */
export async function postFactoryCheck(env, { user, params, body }) {
  return addCheck(env, await factoryContext(env, user, params.orderId), user, body);
}
/** GET /work/assignments/:id/pack — HTML */
export async function assignmentPack(env, { user, params }) {
  return packHtml(await assignmentContext(env, user, params.id), null);
}
/** GET /work/assignments/:id/checks */
export async function getAssignmentChecks(env, { user, params }) {
  const ctx = await assignmentContext(env, user, params.id);
  return checksView(env, ctx, workerOrderLabel(ctx.order));
}
/** POST /work/assignments/:id/checks */
export async function postAssignmentCheck(env, { user, params, body }) {
  return addCheck(env, await assignmentContext(env, user, params.id), user, body);
}
/** GET /orders/:orderId/checks — 본사 · 업체: 설계를 볼 수 있는 사람이 역할 전부 (작업지시서 판 기준, 설치는 시공 지시서 판) */
export async function getOrderChecks(env, { user, params }) {
  const order = await loadOrder(env, assertUuid(params.orderId, '주문 id'));
  await assertDesignAccess(env, order.design_id, user);
  const out = { order_label: orderLabel(order), roles: [] };
  for (const [docType, roles] of [['work_order', CHECK_ROLES.filter((r) => r !== 'install')], ['installation_order', ['install']]]) {
    let ctx;
    try {
      ctx = { ...(await docContext(env, order, docType)), order, roles };
    } catch (e) {
      if (e instanceof NotFoundError) continue;
      throw e;
    }
    const view = await checksView(env, ctx, out.order_label);
    out.roles.push(...view.roles.map((r) => ({ ...r, document: view.document, list_version: view.list_version })));
    out.db_ready = view.db_ready;
  }
  return out;
}
