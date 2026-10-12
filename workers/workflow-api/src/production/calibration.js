/**
 * 실측 기록 → 표준시간 보정 제안 (순수 함수).
 *
 * 작업자가 남긴 (공정, 수량, 분) 을 공정별로 합쳐 "1단위에 실제 몇 초" 를 낸다.
 *   재단 cutter → cutPerSheet      (원판 1장)
 *   엣지 edge   → edgePerPbSheet   (PB 1장)
 *   조립 asm    → asmPerBox · asmPerDrawer (통·서랍 1개 — 대표 확정: 서랍 = 통 1개)
 * 표본이 적으면(minUnits 미만) 제안하지 않는다. 한두 번의 특이값으로 표준을 흔들지 않기 위해서다.
 */

export const ROLE_STANDARD = {
  cutter: ['cutPerSheet'],
  edge: ['edgePerPbSheet'],
  asm: ['asmPerBox', 'asmPerDrawer'],
};

const ROLE_LABEL = { cutter: '재단 (원판 1장)', edge: '엣지 (PB 1장)', asm: '조립 (통·서랍 1개)' };

/** 10초 단위로 반올림 — 표준시간을 초 단위까지 흔들 이유가 없다. */
const round10 = (s) => Math.max(10, Math.round(s / 10) * 10);

/**
 * @param {Array<{role, units, minutes}>} logs
 * @param {Object} standards  현재 표준 (초)
 * @param {{minUnits?: number}} [opts]
 */
export function calibrate(logs, standards, opts = {}) {
  const minUnits = opts.minUnits ?? 10;
  const out = [];
  for (const role of Object.keys(ROLE_STANDARD)) {
    const rows = (logs || []).filter((l) => l && l.role === role && Number(l.units) > 0 && Number(l.minutes) > 0);
    const units = rows.reduce((s, l) => s + Number(l.units), 0);
    const seconds = rows.reduce((s, l) => s + Number(l.minutes) * 60, 0);
    const key = ROLE_STANDARD[role][0];
    const current = Number(standards[key]);
    const measured = units > 0 ? seconds / units : null;
    const enough = units >= minUnits;
    out.push({
      role,
      label: ROLE_LABEL[role],
      keys: ROLE_STANDARD[role],
      records: rows.length,
      units,
      current,
      measured: measured === null ? null : Math.round(measured),
      suggested: enough && measured !== null ? round10(measured) : null,
      diffPct: measured === null || !current ? null : Math.round((measured / current - 1) * 100),
      enough,
      minUnits,
    });
  }
  return out;
}

/** 보정 제안을 설정 저장 본문(standards 일부)으로 바꾼다. roles 를 주면 그 공정만. */
export function calibrationPatch(result, roles) {
  const pick = new Set(roles && roles.length ? roles : result.map((r) => r.role));
  const standards = {};
  for (const r of result) {
    if (!pick.has(r.role) || r.suggested === null) continue;
    for (const k of r.keys) standards[k] = r.suggested;
  }
  return { standards };
}
