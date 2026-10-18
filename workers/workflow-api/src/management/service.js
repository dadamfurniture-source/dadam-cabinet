/**
 * 경영 대시보드 — DB 를 읽어 summary.js 에 넘긴다.
 *
 * **관리자만** 본다. 수주는 설계 주인 기준이 아니라 회사 전체다 (작업 지시 보고 보관함과
 * 같은 방식). 상담은 고객이 남긴 것이라 건수만 읽는다 — 이름 · 연락처는 싣지 않는다.
 */
import { selectMany, selectOne, ForbiddenError } from '../supabase.js';
import { isAdmin } from '../reports/admin.js';
import { mergeSettings, kstDate } from '../production/service.js';
import { buildManagementSummary, prevMonthOf } from './summary.js';

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * 경영 숫자에 쓰는 설정. 보는 사람이 저장한 생산 설정이 있으면 그것,
 * 없으면 가장 최근에 저장된 생산 설정(사장님 것)을 쓴다 — 직원 관리자가 열어도
 * 월 고정비가 기본값으로 떨어지지 않게.
 */
export async function businessSettings(env, user) {
  const mine = await selectOne(env, 'production_settings', { user_id: `eq.${user.id}`, select: 'settings' });
  if (mine) return { ...mergeSettings(mine.settings), source: 'mine' };
  const latest = await selectOne(env, 'production_settings', { select: 'settings', order: 'updated_at.desc' });
  if (latest) return { ...mergeSettings(latest.settings), source: 'latest' };
  return { ...mergeSettings(null), source: 'default' };
}

export async function getManagementSummary(env, { user, month }) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('경영 대시보드는 관리자만 볼 수 있습니다');
  const m = MONTH_RE.test(String(month || '')) ? month : kstDate().slice(0, 7);
  const since = `${prevMonthOf(m)}-01T00:00:00+09:00`;

  const [orders, documents, consultations, generations, designs, settings] = await Promise.all([
    selectMany(env, 'orders', {
      select: 'id,order_no,design_id,snapshot_id,customer_name,contract_amount,status,ordered_at',
      ordered_at: `gte.${since}`,
      order: 'ordered_at.desc',
      limit: '1000',
    }),
    // 코호트는 설계에 확인서가 '처음' 나간 달로 묶는다 — 그래서 기간을 자르지 않고 읽는다
    selectMany(env, 'design_documents', {
      select: 'design_id,doc_type,status,decision,created_at,first_viewed_at,decided_at',
      doc_type: 'eq.customer_confirmation',
      order: 'created_at.asc',
      limit: '5000',
    }),
    // 상담은 건수와 '누가' 만 — 이름 · 연락처는 읽지 않는다
    selectMany(env, 'consultations', { select: 'created_at,user_id', created_at: `gte.${since}`, limit: '5000' }).catch(() => null),
    // 연출컷도 상태 · 사람 · 시각만 — 이미지 · 입력은 읽지 않는다
    selectMany(env, 'generations', { select: 'id,user_id,status,created_at', created_at: `gte.${since}`, limit: '5000' }).catch(() => null),
    // 연출컷에서 시작한 설계 — 연출컷보다 늦게 생기므로 같은 기간으로 충분하다
    selectMany(env, 'designs', { select: 'id,generation_id', generation_id: 'not.is.null', created_at: `gte.${since}`, limit: '5000' }).catch(() => []),
    businessSettings(env, user),
  ]);

  const list = orders || [];
  let snaps = [];
  if (list.length) {
    const ids = [...new Set(list.map((o) => o.snapshot_id).filter(Boolean))];
    if (ids.length) {
      snaps = (await selectMany(env, 'design_snapshots', { id: `in.(${ids.join(',')})`, select: 'id,quote_payload', limit: '1000' })) || [];
    }
  }
  return buildManagementSummary({
    orders: list,
    snapshotsById: new Map(snaps.map((s) => [s.id, s])),
    documents: documents || [],
    consultations,
    generations,
    designs: designs || [],
    settings,
    month: m,
  });
}
