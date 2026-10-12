/**
 * 공장 표준시간 — 작업지시서 꾸러미 머리의 "예상 시간" (계획 work-order-stage.plan.md §4.3).
 *
 * 값은 사장님이 2026-10-12 에 알려 주고 2026-10-13 에 확정한 가정이다. 발행할 때 이 객체를
 * `render_payload.labor` 로 동결한다 — 여기를 고쳐도 이미 나간 지시서의 시간은 바뀌지 않는다.
 * 동결값이 없는 옛 문서는 시간을 싣지 않는다 (지금 값으로 지어내지 않는다).
 */

export const LABOR_STANDARDS = Object.freeze({
  version: '2026-10-13',
  cutMinPerSheet: 7, // 원판 1장 재단 (몸통 PB · 뒷판, 밴드·처짐방지목 포함, 도어는 외주라 제외)
  edgeMinPerBodySheet: 15, // 몸통 PB 원판 1장 분량의 엣지
  assemblyMinPerCabinet: 12, // 조립 1인 1통
  assemblyMinPerDrawer: 12, // 서랍 1개 = 1통
  doorHangMinPerDoor: 1, // 도어 1짝 달기
  inspectPackMinPerCabinet: 5, // 완성 검수·포장 통당
});

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * 수량 → 분. std 가 없으면(옛 문서) null.
 * counts = { cutSheets, bodySheets, cabinets, drawers, doors }
 */
export function laborEstimate(std, counts) {
  if (!std || typeof std !== 'object') return null;
  const c = counts || {};
  return {
    cutMin: n(c.cutSheets) * n(std.cutMinPerSheet),
    edgeMin: n(c.bodySheets) * n(std.edgeMinPerBodySheet),
    assemblyMin:
      n(c.cabinets) * n(std.assemblyMinPerCabinet) +
      n(c.drawers) * n(std.assemblyMinPerDrawer) +
      n(c.doors) * n(std.doorHangMinPerDoor) +
      n(c.cabinets) * n(std.inspectPackMinPerCabinet),
  };
}

/** 분 → "약 3시간 19분" / "약 42분". */
export function fmtMinutes(min) {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return '-';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `약 ${r}분`;
  return r ? `약 ${h}시간 ${r}분` : `약 ${h}시간`;
}
