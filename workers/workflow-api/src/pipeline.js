/**
 * 프로젝트 한 길 — 프로젝트의 「지금 단계」(step)와 「다음 할 일」(next)을 한 곳에서 정한다.
 * (2026-11-21 대표님 승인 계획 — 상담 → 설계 → 견적 → 계약 → 생산 → 설치 → A/S 가 단추 하나씩으로 이어지게)
 *
 * 순수 함수 둘뿐이다 — DB 를 읽지 않는다. 값(facts)은 부르는 쪽이 모아 넘긴다
 * (업체 프로젝트 목록 company-projects.js · 받은 일 company-inbox.js · 프로젝트 한 건).
 * 프로젝트 줄 · 「새로 생긴 일」 표 · 프로젝트 창이 같은 판정을 쓰므로 서로 어긋나지 않는다.
 *
 * 정한 것
 *   차례      설계 먼저 — 상담 → 실측 → 설계 → 견적(= 고객 확인서) → 계약(수주 · 계약금) → 생산 → 설치 → 끝(A/S)
 *   실측      상담 다음 · 설계 앞 (2026-11-21 대표님 「실측 일정을 잡아야 하고 설계 전에 이루어져야 함」 — 뒤 공정 2차).
 *             설계가 아직 없는 프로젝트는 「실측 일정 잡기」 → 「실측 완료 처리」 뒤에야 「설계 시작」이 다음 할 일이 된다.
 *             이미 설계(초안 포함)가 있는 프로젝트는 그대로 둔다 — 실측 단계로 되돌리지 않는다.
 *             DB 0079 전(visit_ready 가 아님)이면 지금처럼 상담 다음이 바로 「설계 시작」이다.
 *   막지 않는다 다음 할 일은 「추천」이다. 새로 막는 조건은 없다 — 지금 서버가 막는 것(승인된 확인서만 수주가 된다 등)만 그대로.
 *   직책 그대로 대표 · 실장만 하는 일(앱으로 보내기 · 입금 적기 · 제작 의뢰 …)은 allowed 로 알린다 — 화면이 「대표 · 실장이 합니다」를 적는다.
 *   단계 규칙   projects.js projectStage(상담 · 연출컷 · 설계 · 견적 · 수주 · 시공 완료) 위에 얹는다:
 *              연출컷만 있는 프로젝트는 지금처럼 「설계」, 플래너에 저장만 한 설계(초안)도 「설계」,
 *              팩토리가 받은 제작 의뢰로 생긴 프로젝트는 「생산」, 수주가 완료되면 「끝」(예전 메뉴는 설치에 계속 쌓였다).
 *
 * facts (모르는 값은 null · false · 0 으로 둔다)
 *   id · status(projects.status) · created_at · stage(projectStage)
 *   hold_until  보류(status on_hold)를 다시 볼 날 'YYYY-MM-DD' | null
 *   factory     다담 공장 · Expert · Agent 업체 (아니면 Manager 등급 = 가구설계 영업 사원 — 생산은 제작 의뢰로 넘긴다)
 *   born        팩토리가 받은 제작 의뢰로 생긴 프로젝트 (production_requests.factory_project_id)
 *   draft       이 프로젝트에 이어진 가장 새 플래너 초안 { id, created_by, updated_at } | null
 *   designs     이 프로젝트에 이어진 앱 설계 수 (앱으로 보낸 설계)
 *   quote       가장 새 살아 있는 고객 확인서(거두지 않았고 새 판에 밀리지 않은 것)
 *               { id, created_at, expires_at, first_viewed_at, view_count, decision, decided_at } | null
 *   order       가장 새 취소 아닌 수주 { id, status, ordered_at, delivered_at, completed_at } | null
 *   dead_order  승인된 그 확인서의 수주가 취소됐다 (다시 만들 수 없다 — 문서 하나에 수주 하나)
 *   deposit     'paid'(계약금 줄이 입금됨) | 'unpaid'(계약금 줄이 있는데 아직) | null(계약금 줄이 없다)
 *   balance     'paid' | 'unpaid'(완료된 수주에 아직 안 받은 잔금 줄이 있다) | null(잔금 줄이 없다 — 묻지 않는다)
 *   request     Manager 업체의 가장 새 제작 의뢰(거둔 것 빼고) { id, status, status_at } | null
 *   pending     대표 승인을 기다리는 수주 요청 { order_id, kind } | null (걸려 있는 동안 수주 상태를 못 바꾼다)
 *   as_open     처리 중인 A/S 접수 수
 *   visit_ready 실측 일정 표가 있다 (DB 0079) — 아니면 실측 단계 없이 지금처럼
 *   visit       지금의 실측 { id, status: scheduled | done, scheduled_at, done_at } | null (취소한 것은 없는 것)
 *   assignee_id 그 프로젝트의 담당자 (실측은 대표 · 실장 · 담당자가 잡고 끝낸다)
 * viewer { role: owner | manager | staff | null, user_id }
 */

/** 지금 단계 — 왼쪽 메뉴 줄 · 단계 띠가 쓰는 값 (done = 끝난 것, 세지 않는다) */
export const STEPS = Object.freeze(['consult', 'measure', 'design', 'quote', 'contract', 'make', 'install', 'done']);
export const STEP_LABEL = Object.freeze({
  consult: '상담',
  measure: '실측',
  design: '설계',
  quote: '견적',
  contract: '계약',
  make: '생산',
  install: '설치',
  done: '끝',
});

/** 다음 할 일 글 (key → 화면 글). 화면은 이 글을 그대로 적는다 */
export const NEXT_LABEL = Object.freeze({
  approve: '요청 승인 · 반려',
  approval: '대표 승인 기다림',
  measure_plan: '실측 일정 잡기',
  measure_wait: '실측 예정',
  measure_done: '실측 완료 처리',
  design_start: '설계 시작',
  design: '설계 이어서',
  quote: '견적 내기',
  customer: '고객 답 기다림',
  requote_expired: '견적 기한 지남 — 다시 내기',
  requote_rejected: '설계 고쳐 다시 견적',
  order: '계약 만들기',
  order_dead: '취소된 계약 — 계약 화면에서 확인',
  deposit: '계약금 입금 적기',
  produce: '생산 시작',
  request: '제작 의뢰 보내기',
  hq: '본사 추천 기다림',
  choose: '팩토리 고르기',
  factory: '팩토리 답 기다림',
  factory_design: '받은 설계 열기',
  make: '생산 화면 열기',
  deliver: '배송으로 넘기기',
  complete: '설치 완료 처리',
  balance: '잔금 입금 적기',
  hold_due: '보류 — 다시 볼 날입니다',
  as: 'A/S 접수 보기',
});

const MONEY_ROLES = ['owner', 'manager']; // 대표 · 실장 (supabase.js MONEY_ROLES 와 같다 — 등급 Manager 와 다른 말이다)
/** 본사 차례인 제작 의뢰 상태 (production-requests/common.js HQ_TURN 과 같다) */
const REQUEST_HQ_TURN = ['submitted', 'recommending', 'declined', 'expired'];

/** 보류 — 살아 있는 프로젝트다. 단계는 멈춘 자리 그대로 두고(어디서 멈췄는지 보이게) 다음 할 일만 없앤다 */
const HELD = 'on_hold';
const KST_MS = 9 * 3600 * 1000;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const str = (v) => (typeof v === 'string' && v ? v : null);
/** 한국 날짜 'YYYY-MM-DD' */
const kstDay = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10);

/**
 * 지금 단계.
 * 위에서부터 먼저 맞는 것 — 끝남 · 수주 상태 · 받은 제작 의뢰 · 견적 · 설계 · 실측 · 상담.
 */
export function stepOf(facts) {
  const f = obj(facts) || {};
  if (f.status && f.status !== 'active' && f.status !== HELD) return 'done';
  const order = obj(f.order);
  if (order) {
    if (order.status === 'completed') return 'done';
    if (order.status === 'delivered') return 'install';
    if (order.status === 'in_production') return 'make';
    // 접수 — 영업 사원(Manager 업체)이 제작 의뢰를 냈으면 생산으로 넘어간 것으로 본다
    return !f.factory && obj(f.request) ? 'make' : 'contract';
  }
  if (f.stage === 'installed') return 'done';
  if (f.born) return 'make';
  if (obj(f.quote) || f.stage === 'quote') return 'quote';
  if (f.designs > 0 || obj(f.draft) || f.stage === 'design' || f.stage === 'render') return 'design';
  // 실측 — 일정을 잡았거나 끝냈으면 「실측」 (설계가 생기면 위에서 「설계」로 넘어간다)
  if (f.visit_ready && obj(f.visit)) return 'measure';
  return 'consult';
}

/** 플래너로 가는 글표 — 초안이 있으면 그 초안, 없으면 프로젝트 번호로 새 설계 */
function plannerGo(f) {
  const draft = obj(f.draft);
  if (draft && str(draft.id)) return `planner?draft=${draft.id}`;
  return str(f.id) ? `planner?project=${f.id}` : 'p-design';
}

/**
 * 다음 할 일 — { key, label, go, act?, wait, since, allowed, views? } | null(할 일 없음 — 끝난 프로젝트).
 *   go      어디로 — 화면 이름(p-quote · p-make · p-contract · p-as · p-design) · planner?project=<id> · planner?draft=<id> · order:<수주 id> ·
 *           sheet(그 프로젝트의 창 — 보류를 다시 볼 날) · visit(그 프로젝트 줄의 실측 칸).
 *           주소는 화면이 만든다 (서버는 앱 주소를 모른다).
 *   act     그 자리에서 하는 일 — { kind: 'order', document_id } (계약 만들기 = POST /documents/:id/order) ·
 *           { kind: 'visit_done' } (실측 완료 처리 = PATCH /company/projects/:id/visit)
 *   at      그 일의 날짜 · 시각 (실측 예정 · 실측 완료 처리 — 화면이 「실측 11.25 14:00 예정」을 적는다)
 *   wait    남(고객 · 대표 · 본사 · 팩토리)을 기다리는 중 — 단추가 아니라 글로 적는다
 *   since   이 상태가 시작된 때 (모르면 null) — 화면이 「N일째」를 적는다
 *   allowed 보는 사람이 할 수 있나 — 아니면 「대표 · 실장이 합니다」 (wait 이면 뜻 없음)
 */
export function nextStep(facts, viewer, nowMs = Date.now()) {
  const f = obj(facts) || {};
  const v = obj(viewer) || {};
  const manage = MONEY_ROLES.includes(v.role);

  const make = (key, go, extra = {}) => ({
    key,
    label: NEXT_LABEL[key],
    go,
    wait: false,
    since: null,
    allowed: true,
    ...extra,
  });

  // 보류 — 할 일은 없다. 다시 볼 날(한국 날짜)이 됐으면 그것만 알린다 (프로젝트 창에서 다시 진행 · 계속 보류)
  if (f.status === HELD) {
    const until = str(f.hold_until);
    return until && until <= kstDay(nowMs) ? make('hold_due', 'sheet', { since: until }) : null;
  }
  if (f.status && f.status !== 'active') return null;

  // 0) 대표 승인이 걸려 있으면 그것부터 — 걸려 있는 동안 수주 상태를 아무도 못 바꾼다
  const pending = obj(f.pending);
  if (pending && str(pending.order_id)) {
    const go = `order:${pending.order_id}`;
    return v.role === 'owner'
      ? make('approve', go, { since: str(pending.created_at) })
      : make('approval', go, { wait: true, since: str(pending.created_at), allowed: false });
  }

  // 1) 수주가 있다 — 계약 · 생산 · 설치
  const order = obj(f.order);
  if (order && str(order.id)) {
    const go = `order:${order.id}`;
    if (order.status === 'completed' || f.stage === 'installed') {
      // 고객이 기다리는 A/S 가 먼저다
      if (f.as_open > 0 && f.factory) return make('as', 'p-as');
      // 설치는 끝났는데 안 받은 잔금 줄이 남았다 — 수주 창의 수금 칸으로 (2026-11-21 뒤 공정. 잔금 줄이 없으면 묻지 않는다)
      if (f.balance === 'unpaid') return make('balance', go, { since: str(order.completed_at), allowed: manage });
      return null;
    }
    if (order.status === 'delivered') return make('complete', go, { since: str(order.delivered_at) });
    if (order.status === 'in_production') return make('deliver', go);
    // 접수(confirmed)
    const request = !f.factory ? obj(f.request) : null;
    // 영업 사원 — 본사 추천이 왔으면 고르기가 먼저다 (답 기한이 있다)
    if (request && request.status === 'recommended')
      return make('choose', 'p-make', { since: str(request.status_at), allowed: manage });
    if (f.deposit !== 'paid')
      return make('deposit', go, { since: str(order.ordered_at), allowed: manage });
    if (f.factory) return make('produce', go);
    if (!request) return make('request', 'p-make', { allowed: manage });
    if (request.status === 'chosen')
      return make('factory', 'p-make', { wait: true, since: str(request.status_at), allowed: false });
    if (request.status === 'accepted') return make('produce', go, { since: str(request.status_at) });
    if (REQUEST_HQ_TURN.includes(request.status))
      return make('hq', 'p-make', { wait: true, since: str(request.status_at), allowed: false });
    return make('request', 'p-make', { allowed: manage });
  }

  // 2) 팩토리가 받은 제작 의뢰로 생긴 프로젝트 — 받은 설계를 열어 앱으로 보내고(지시서), 생산 화면으로
  if (f.born) {
    if (!(f.designs > 0)) return make('factory_design', plannerGo(f), { allowed: manage });
    return make('make', 'p-make');
  }

  // 3) 견적(고객 확인서)이 나갔다
  const quote = obj(f.quote);
  if (quote && str(quote.id)) {
    if (quote.decision === 'approved') {
      if (f.dead_order)
        return make('order_dead', 'p-contract', { wait: true, since: str(quote.decided_at), allowed: false });
      return make('order', 'p-quote', {
        act: { kind: 'order', document_id: quote.id },
        since: str(quote.decided_at),
      });
    }
    if (quote.decision === 'rejected')
      return make('requote_rejected', plannerGo(f), { since: str(quote.decided_at), allowed: manage });
    const expires = Date.parse(quote.expires_at);
    if (Number.isFinite(expires) && expires <= nowMs)
      return make('requote_expired', plannerGo(f), { since: str(quote.expires_at), allowed: manage });
    return make('customer', 'p-quote', {
      wait: true,
      since: str(quote.created_at),
      allowed: false,
      views: Number.isInteger(quote.view_count) && quote.view_count > 0 ? quote.view_count : 0,
    });
  }

  // 4) 앱으로 보낸 설계가 있다 — 견적(확인서)을 낸다. 플래너 설계면 그 초안, 아니면(PC 상세설계) 설계 화면
  if (f.designs > 0) {
    const draft = obj(f.draft);
    return make('quote', draft ? plannerGo(f) : 'p-design', { allowed: manage });
  }

  // 5) 플래너에 저장만 한 설계 — 이어서 (고치는 것은 만든 사람 · 대표 · 실장)
  const draft = obj(f.draft);
  if (draft && str(draft.id)) {
    const mine = !!v.user_id && draft.created_by === v.user_id;
    return make('design', plannerGo(f), { since: str(draft.updated_at), allowed: manage || mine });
  }

  // 6) 아직 설계가 없다 — 실측부터 (2026-11-21 대표님 「실측 일정을 잡아야 하고 설계 전에 이루어져야 함」).
  //    실측을 끝내야 「설계 시작」이 다음 할 일이 된다. 실측은 대표 · 실장 · 그 프로젝트의 담당자가 잡고 끝낸다
  if (f.visit_ready) {
    const visit = obj(f.visit);
    const can = manage || (!!v.user_id && f.assignee_id === v.user_id);
    if (!visit) return make('measure_plan', 'visit', { since: str(f.created_at), allowed: can });
    if (visit.status !== 'done') {
      const at = str(visit.scheduled_at);
      const when = Date.parse(at || '');
      // 실측 날(한국 날짜) 전에는 기다림 — 그날부터 「실측 완료 처리」
      if (Number.isFinite(when) && kstDay(when) > kstDay(nowMs))
        return make('measure_wait', 'visit', { wait: true, allowed: false, at });
      return make('measure_done', 'visit', {
        act: { kind: 'visit_done' },
        since: at,
        allowed: can,
        at,
      });
    }
    return make('design_start', plannerGo(f), { since: str(visit.done_at) });
  }

  // 7) 실측 단계가 아직 없다 (DB 0079 전) — 설계 시작 (플래너가 이 프로젝트로 열린다)
  return make('design_start', plannerGo(f), { since: str(f.created_at) });
}
