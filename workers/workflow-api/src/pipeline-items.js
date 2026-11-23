/**
 * 품목 줄 — 한 프로젝트에 품목 설계가 여럿일 때의 「지금 단계 · 다음 할 일」.
 * (2026-11-23 대표님 「워크플로우를 현재 변경된 프로젝트 지정에 맞게 변경」 — 플래너에서 한 프로젝트에 품목마다 설계를 하나씩 두게 됐다)
 *
 * 대표님이 정한 것 (2026-11-23)
 *   · 프로젝트의 단계 · 다음 할 일 = **가장 늦은 품목** 것. 모든 품목이 끝나야 프로젝트가 끝난다.
 *   · 견적 · 계약은 품목마다 따로 (지금 구조 그대로) — 품목마다 「견적 내기」 · 「계약 만들기」가 빠짐없이 뜬다.
 *
 * 품목 줄(track) 하나 = 플래너 초안 ↔ 앱 설계 ↔ 그 설계의 가장 새 견적 ↔ 그 설계의 가장 새 취소 아닌 수주 (+ 그 수주의 계약금 · 잔금 · 승인 요청 · A/S).
 * 줄마다 pipeline.js 의 stepOf · nextStep 을 **그대로** 쓴다 — 단계 · 다음 할 일의 규칙은 한 곳에만 있다.
 * 여기는 줄들에서 프로젝트 값을 고를 뿐이다. 순수 함수 — DB 를 읽지 않는다 (값은 company-pipeline.js 가 모은다).
 */

import { STEPS, STEP_LABEL, nextStep, stepOf } from './pipeline.js';

/** 프로젝트 줄에 싣는 품목 수 */
export const ITEMS_MAX = 12;
/** 플래너 품목 이름 (플래너 js/model.js ITEMS · itemName 과 같다) */
export const PLANNER_ITEM_LABEL = Object.freeze({
  sink: '싱크대',
  island: '아일랜드',
  shoerack: '신발장',
  vanity: '화장대',
  storage: '수납장',
  wardrobe: '붙박이장',
  fridge: '냉장고장',
  fridge_reform: '냉장고장(리폼)',
});
/** 대표 승인 — 걸려 있는 동안 수주 상태를 아무도 못 바꾼다 (pipeline.js nextStep 0 번) */
const APPROVAL_KEYS = ['approve', 'approval'];
const SEP = ' · ';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * 품목 줄의 이름 — 플래너가 붙인 이름(「프로젝트 이름 · 붙박이장 안방」)의 끝 조각, 아니면 품목 이름, 그것도 모르면 설계 이름.
 * @param {{ item?: string, name?: string, designName?: string }} t  item = 플래너 품목 id · name = 초안 이름 · designName = 앱 설계 이름
 */
export function trackLabelOf(t) {
  const o = t || {};
  const item = PLANNER_ITEM_LABEL[o.item] || '';
  for (const name of [str(o.name), str(o.designName)]) {
    const cut = name.lastIndexOf(SEP);
    const tail = cut >= 0 ? name.slice(cut + SEP.length).trim() : '';
    if (tail && item && tail.indexOf(item) === 0) return tail;
    // 품목을 모르는 설계(상세설계에서 온 것) — 끝 조각이 플래너 품목 이름으로 시작하면 그것
    if (tail && !item && Object.values(PLANNER_ITEM_LABEL).some((l) => tail.indexOf(l) === 0)) return tail;
  }
  return item || str(o.designName) || str(o.name) || '설계';
}

/** 같은 이름이 둘 이상이면 둘째부터 번호를 붙인다 (「붙박이장」 · 「붙박이장 2」) — 차례는 받은 그대로 */
export function numberLabels(labels) {
  const seen = new Map();
  return labels.map((label) => {
    const n = (seen.get(label) || 0) + 1;
    seen.set(label, n);
    return n > 1 ? `${label} ${n}` : label;
  });
}

/**
 * 품목 줄마다 단계 · 다음 할 일을 내고, 프로젝트 값을 고른다.
 * @param {object} base    프로젝트 값 — pipeline.js facts 가운데 프로젝트에 붙는 것 (id · status · hold_until · created_at · factory ·
 *                         visit_ready · visit · assignee_id). 줄마다 다른 값은 tracks 가 준다
 * @param {Array<{ key: string, label: string, touched?: string, draft_id?: string|null, design_id?: string|null, born?: boolean,
 *                 draft?: object|null, design?: boolean, quote?: object|null, order?: object|null, dead_order?: boolean,
 *                 deposit?: string|null, balance?: string|null, request?: object|null, pending?: object|null, as_open?: number }>} tracks
 *   만든 차례대로 (품목 단추와 같은 차례). touched = 그 줄을 마지막으로 만진 때 — 같은 단계의 줄이 여럿이면 가장 최근에 만진 줄이 앞선다
 * @returns {{ step: string, next: object|null, items: Array, lead: object|null }}
 *   items [{ key, label, step, step_label, next, draft_id, design_id, order_id }] · lead = 프로젝트 값을 낸 줄 (머문 날을 그 줄로 잰다)
 */
export function itemsOf(base, tracks, viewer, nowMs = Date.now()) {
  const list = (Array.isArray(tracks) ? tracks : []).map((t) => {
    const facts = {
      ...base,
      // 줄의 값은 줄에서만 — 프로젝트 전체의 옛 단계(stage)로 넘겨짚지 않는다
      stage: '',
      born: t.born === true,
      draft: t.draft || null,
      designs: t.design ? 1 : 0,
      quote: t.quote || null,
      order: t.order || null,
      dead_order: t.dead_order === true,
      deposit: t.deposit || null,
      balance: t.balance || null,
      request: t.request || null,
      pending: t.pending || null,
      as_open: t.as_open || 0,
    };
    return { track: t, step: stepOf(facts), next: nextStep(facts, viewer, nowMs) };
  });
  const many = list.length > 1;
  const tag = (row) => (row.next && many ? { ...row.next, item: row.track.label } : row.next);
  const items = list.slice(0, ITEMS_MAX).map((row) => ({
    key: row.track.key,
    label: row.track.label,
    step: row.step,
    step_label: STEP_LABEL[row.step],
    next: row.next,
    draft_id: row.track.draft_id || null,
    design_id: row.track.design_id || null,
    order_id: row.track.order && row.track.order.id ? row.track.order.id : null,
  }));
  if (!list.length) return { step: null, next: null, items, lead: null };

  // 끝나지 않은 줄을 늦은 차례로 — 같은 단계면 가장 최근에 만진 줄부터 (하던 일을 이어서)
  const live = list
    .filter((r) => r.step !== 'done')
    .sort((a, b) => STEPS.indexOf(a.step) - STEPS.indexOf(b.step) || String(b.track.touched || '').localeCompare(String(a.track.touched || '')));
  const step = live.length ? live[0].step : 'done';
  // 대표 승인이 걸린 줄이 있으면 그것부터 (어느 줄이든)
  const approval = list.find((r) => r.next && APPROVAL_KEYS.includes(r.next.key));
  // 가장 늦은 줄의 다음 할 일 — 그 줄에 없으면 다음으로 늦은 줄, 모두 끝났으면 끝난 줄에 남은 일(A/S · 잔금)
  const pick = approval || live.find((r) => r.next) || list.find((r) => r.next) || null;
  return { step, next: pick ? tag(pick) : null, items, lead: (pick || live[0] || list[0]).track };
}
