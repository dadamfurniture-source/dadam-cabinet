/**
 * 작업 → 지시서를 여는 설계들 (읽기만 — 작업 · 수주 · 설계를 고치지 않는다)
 *
 *   작업자의 지시서 · 필수 확인은 그 작업의 설계로 찾는다:
 *     프로젝트 「작업 배정」의 작업(철거 · 재단 · 엣지 · 조립 — project_id, 일정 없음) → 그 팩토리가 그 프로젝트에 이은 설계 **모두**
 *       (설계 하나 = 품목 하나라 한 프로젝트에 설계가 여럿일 수 있다 — 작업 줄 하나에 그 지시서가 모두 붙는다)
 *     일정에서 생긴 작업(납품 · 설치 — schedule_id) → 그 일정의 설계 하나
 *     수주가 적힌 그 밖의 작업 → 그 수주의 설계 (예전 그대로)
 *   수주: 설계마다 가장 새 수주(취소 뺌). **수주가 없어도 프로젝트에 이은 설계면 연다** — 수주 전 작업.
 *     프로젝트에 잇지 않은 설계는 수주가 있을 때만 (예전 그대로).
 *   다른 팩토리의 설계는 넣지 않는다 (작업을 낸 팩토리 company_id 로 거른다).
 *
 * 작업자 화면에 보이는 설계 이름은 품목 이름뿐이다 (설계 이름에는 고객 이름이 들어 있을 수 있다).
 * 이 파일은 work/jobs.js 를 부르지 않는다 (jobs.js 가 이 파일을 부른다).
 */
import { selectMany, selectOne, NotFoundError } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { itemLabel } from '../templates/work-order.js';
import { DOC_TYPE_OF_ROLE, PACKS_OF_ROLE, ROLE_OF_JOB_KIND, assertDesignChecksDone } from './check-state.js';
import { assertUuid } from './validate.js';

/** 한 작업이 여는 설계 수 한도 — 한 프로젝트의 설계(품목) 수 */
export const JOB_DESIGN_MAX = 20;
const ORDER_COLS = 'id,order_no,customer_name,design_id,company_id';
const DESIGN_COLS = 'id,company_id,project_id';

/** 프로젝트 「작업 배정」의 작업인가 (프로젝트에 붙고 일정에서 생긴 것이 아니다) */
export const isProjectJob = (job) => !!(job && job.project_id && !job.schedule_id);

/**
 * 그 작업이 지시서를 여는 설계들 — { design: {id, company_id, project_id}, order: 수주 줄 | null }[]
 *   order 가 null 인 줄은 수주 전 작업이다 (프로젝트에 이은 설계).
 */
export async function sheetTargetsOf(env, job) {
  if (!job) return [];
  // 수주가 적힌 작업 (프로젝트 작업이 아닌 것) — 그 수주의 설계 (예전 그대로: 지시서의 주소는 수주가 작업을 낸 팩토리의 것일 때만 열린다)
  if (!isProjectJob(job) && job.order_id) {
    const order = await selectOne(env, 'orders', { id: `eq.${job.order_id}`, select: ORDER_COLS });
    if (!order) throw new NotFoundError('주문을 찾을 수 없습니다');
    return order.design_id ? [{ design: { id: order.design_id, company_id: order.company_id, project_id: null }, order }] : [];
  }
  if (!job.company_id) return [];
  const co = `eq.${job.company_id}`;
  let designs;
  if (isProjectJob(job)) {
    designs = (await selectMany(env, 'designs', { project_id: `eq.${job.project_id}`, company_id: co, select: DESIGN_COLS, order: 'created_at.asc', limit: String(JOB_DESIGN_MAX) })) || [];
  } else {
    const d = job.design_id ? await selectOne(env, 'designs', { id: `eq.${job.design_id}`, company_id: co, select: DESIGN_COLS }) : null;
    designs = d ? [d] : [];
  }
  if (!designs.length) return [];
  const orders = (await selectMany(env, 'orders', {
    design_id: `in.(${designs.map((d) => d.id).join(',')})`, company_id: co, status: 'neq.cancelled', select: ORDER_COLS, order: 'created_at.desc', limit: '100',
  })) || [];
  const newest = new Map();
  orders.forEach((o) => { if (!newest.has(o.design_id)) newest.set(o.design_id, o); });
  // 수주가 없으면 프로젝트에 이은 설계만
  return designs
    .map((design) => ({ design, order: newest.get(design.id) || null }))
    .filter((t) => t.order || t.design.project_id);
}

/**
 * 그 작업의 설계 하나 — designId 를 주면 그 설계(그 작업의 것이어야 한다), 없으면 첫 설계.
 * 열 설계가 없으면 404 (프로젝트 작업 = 「이은 설계가 없습니다」, 그 밖 = 「연결된 주문이 없습니다」).
 */
export async function sheetTargetOf(env, job, rawDesignId) {
  const targets = await sheetTargetsOf(env, job);
  if (!targets.length) {
    throw new NotFoundError(isProjectJob(job) ? '이 프로젝트에 이은 설계가 없습니다' : '이 작업에는 연결된 주문이 없습니다');
  }
  if (rawDesignId === undefined || rawDesignId === null || rawDesignId === '') return targets[0];
  const id = assertUuid(rawDesignId, '설계 id');
  const hit = targets.find((t) => t.design.id === id);
  if (!hit) throw new NotFoundError('이 작업의 설계가 아닙니다');
  return hit;
}

/** 설계마다 품목 이름 (가장 새 동결본의 첫 품목 종류) — 같은 이름이 여럿이면 뒤에 번호. 못 읽으면 「설계 n」 */
export async function designLabels(env, designIds) {
  let rows = [];
  try {
    rows = (await selectMany(env, 'design_snapshots', {
      design_id: `in.(${designIds.join(',')})`,
      select: 'design_id,rev,category_id:design_payload->items->0->>categoryId,category:design_payload->items->0->>category',
      order: 'rev.desc',
      limit: '200',
    })) || [];
  } catch (e) {
    if (!isMissingRelation(e)) console.warn('[job-links] 품목 이름을 읽지 못했습니다:', e && e.message);
  }
  const first = new Map();
  rows.forEach((r) => { if (!first.has(r.design_id)) first.set(r.design_id, r); });
  const seen = new Map();
  return designIds.map((id, i) => {
    const r = first.get(id);
    // 품목 종류 이름만 쓴다 — 설계 · 품목에 사람이 적은 이름은 싣지 않는다
    const base = r && (r.category_id || r.category) ? itemLabel({ categoryId: r.category_id || undefined, category: r.category || undefined }, i) : `설계 ${i + 1}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} ${n}` : base;
  });
}

/**
 * 작업자 상세에 싣는 지시서 목록 — 설계마다 { design, label(품목 이름), state: 'issued' | 'none', doc_no, rev, packs }.
 *   지시서가 없는 종류(A/S)는 null. 확정된 배정에만 싣는다 (부르는 쪽이 가른다). 고객 정보는 없다.
 */
export async function workerSheetsOf(env, job) {
  const role = job ? ROLE_OF_JOB_KIND[job.kind] : null;
  if (!role) return null;
  let targets;
  try {
    targets = await sheetTargetsOf(env, job);
  } catch (e) {
    if (e instanceof NotFoundError) return [];
    throw e;
  }
  if (!targets.length) return [];
  const ids = targets.map((t) => t.design.id);
  const docType = DOC_TYPE_OF_ROLE[role];
  const [docs, labels] = await Promise.all([
    selectMany(env, 'design_documents', {
      design_id: `in.(${ids.join(',')})`, doc_type: `eq.${docType}`, superseded_by: 'is.null', status: 'neq.revoked', select: 'id,design_id,doc_no,rev', order: 'rev.desc', limit: '100',
    }),
    designLabels(env, ids),
  ]);
  const current = new Map();
  (docs || []).forEach((d) => { if (!current.has(d.design_id)) current.set(d.design_id, d); });
  return targets.map((t, i) => {
    const doc = current.get(t.design.id) || null;
    return { design: t.design.id, label: labels[i], state: doc ? 'issued' : 'none', doc_no: doc ? doc.doc_no : null, rev: doc ? doc.rev : null, packs: PACKS_OF_ROLE[role] };
  });
}

/** work_checks 에 작업 칸(job_id — DB 0072)이 있는가. 수주 없는 체크는 그 뒤에만 적힌다 */
async function orderlessChecksReady(env) {
  try {
    await selectMany(env, 'work_checks', { select: 'job_id', limit: '1' });
    return true;
  } catch (e) {
    if (isMissingRelation(e) || /42703|PGRST204/.test(String((e && e.message) || ''))) return false;
    throw e;
  }
}

/**
 * 완료 막기 — 그 작업이 여는 설계 모두에서 그 역할의 필수 확인이 끝나야 한다 (남았으면 409 checks_left — check-state.js).
 *   수주 전 작업은 DB 0072 전이면 막지 않는다 (체크를 적을 수 없다 — 「적용 전이면 막지 않는다」 원칙).
 */
export async function assertJobChecksDone(env, job) {
  const role = job ? ROLE_OF_JOB_KIND[job.kind] : null;
  if (!role) return;
  let targets;
  try {
    targets = await sheetTargetsOf(env, job);
  } catch (e) {
    if (e instanceof NotFoundError) return;
    throw e;
  }
  let ready = null;
  for (const t of targets) {
    try {
      await assertDesignChecksDone(env, { designId: t.design.id, role });
    } catch (e) {
      if (t.order || !(e && e.details && e.details.code === 'checks_left')) throw e;
      if (ready === null) ready = await orderlessChecksReady(env);
      if (ready) throw e;
    }
  }
}
