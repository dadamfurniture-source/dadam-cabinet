/**
 * 한국 표준 캐비닛 모듈 규격
 * 출처: 한샘 리즈하임, LX Z:IN, 업계 공통 규격
 */

// 표준 모듈 너비 (mm) — 스냅 대상
export const STANDARD_MODULE_WIDTHS = [300, 400, 450, 500, 600, 700, 800, 900];

// 모듈 타입별 최소 너비 (mm)
export const MIN_MODULE_WIDTHS: Record<string, number> = {
  sink: 800,
  cooktop: 600,
  drawer: 400,
  door: 300,
};

// 모듈 타입별 고정 너비 (mm) — 견적 산출 기준
export const FIXED_MODULE_WIDTHS: Record<string, number> = {
  sink: 1000,    // 개수대 가로 너비
  cooktop: 600,  // 쿡탑/후드장
};

// 표준 치수 (mm)
export const CABINET_DIMENSIONS = {
  lower: { depth: 600, height: 870 },   // 상판 포함
  upper: { depth: 350, height: 720 },   // 표준
  upper_tall: { depth: 350, height: 900 },
  gap: { min: 650, max: 750 },          // 상하 간격
};

/**
 * 원시 너비를 가장 가까운 표준 모듈 너비로 스냅
 */
export function snapToStandard(rawWidth: number): number {
  return STANDARD_MODULE_WIDTHS.reduce((best, std) =>
    Math.abs(std - rawWidth) < Math.abs(best - rawWidth) ? std : best
  );
}

/**
 * 모듈 타입에 따른 최소 너비 제약 적용
 */
export function enforceMinWidth(width: number, type: string): number {
  const min = MIN_MODULE_WIDTHS[type] || MIN_MODULE_WIDTHS.door;
  return Math.max(width, min);
}

/**
 * 스냅된 모듈 배열의 합을 벽 너비에 맞춰 보정
 * 가장 큰 모듈(sink/cooktop 제외)에서 차이 흡수
 */
export function adjustToWallWidth(
  modules: Array<{ width: number; type: string }>,
  wallW: number,
): Array<{ width: number; type: string }> {
  const total = modules.reduce((s, m) => s + m.width, 0);
  const diff = wallW - total;
  if (diff === 0 || modules.length === 0) return modules;

  // 차이 흡수 대상: sink/cooktop 아닌 가장 큰 모듈, 없으면 가장 큰 모듈
  const flexibles = modules
    .map((m, i) => ({ ...m, idx: i }))
    .filter(m => m.type !== 'sink' && m.type !== 'cooktop');

  const target = flexibles.length > 0
    ? flexibles.reduce((a, b) => a.width > b.width ? a : b)
    : modules.reduce((a, b, i) => (a as any).width > b.width ? a : { ...b, idx: i }, { ...modules[0], idx: 0 } as any);

  const result = [...modules];
  const adjusted = result[target.idx].width + diff;
  // 보정 후에도 최소 300mm 유지
  result[target.idx] = {
    ...result[target.idx],
    width: Math.max(300, adjusted),
  };
  return result;
}
