/**
 * 벽면 분석 프롬프트 + 카테고리별 벽 폭 보정
 *
 * 여러 카테고리가 공유하는 "카메라 사진 → 벽 치수 추정" 단계는 그대로 공통으로 남기되,
 * 카테고리마다 렌즈 왜곡 보정 강도가 달라서 분기 로직은 여기에 격리한다.
 * 싱크대는 600mm 모듈 수학에 민감하므로 어떤 보정도 적용하지 않는다.
 */

export function buildWallAnalysisPrompt(category) {
  if (category === 'wardrobe') {
    return `Analyze this Korean apartment room photo for built-in wardrobe installation.

CALIBRATION — Use these KNOWN Korean apartment features as size references:
- Standard door frame: 900mm wide × 2100mm tall (most common reference)
- Light switch / outlet plate: 70mm wide × 120mm tall
- Ceiling height: typically 2300-2400mm
- Standard room door: use as PRIMARY scale reference

TASK:
1. Identify any visible doors, door frames, outlets, or light switches
2. Use them as scale reference to calculate the target wall width in mm
3. Korean apartment rooms typically have walls 1800-5000mm wide. Be conservative.

Return JSON only:
{"wall_dimensions_mm":{"width":number,"height":number},"reference_used":"door_frame"|"outlet"|"ceiling"|"none","confidence":"high"|"medium"|"low"}`;
  }

  return `[TASK: Korean kitchen wall structure analysis]
Analyze this photo and extract as JSON:
- wall_dimensions_mm: { width, height } (estimate)
- utility_positions_mm: { water_supply_from_left, exhaust_duct_from_left }
- confidence: "high" | "medium" | "low"
Return ONLY valid JSON.`;
}

/**
 * AI 가 추정한 벽 폭에 카테고리별 보정을 적용한다.
 * - wardrobe: 렌즈 왜곡 15% 과대측정을 보정 + 1800~5000mm 클램핑
 * - 그 외: 보정 없음 (싱크대/파우더/냉장고장/신발장 등은 모듈 치수 기반 계산이라 원본 유지)
 */
export function applyWallWidthCorrection(category, wallW) {
  if (category === 'wardrobe') {
    const corrected = Math.round(wallW * 0.85);
    return Math.max(1800, Math.min(5000, corrected));
  }
  return wallW;
}
