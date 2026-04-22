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

  if (category === 'fridge' || category === 'fridge_cabinet') {
    return `[TASK: Korean apartment fridge cabinet wall analysis — Gemini replaces Claude pre-analysis]
Analyze this photo for built-in fridge cabinet installation. Detect the target wall geometry AND whether it is a recessed alcove bay. Return JSON ONLY (no prose, no markdown):

{
  "wall_dimensions_mm": { "width": number, "height": number },
  "alcove_frame": {
    "present": boolean,
    "interior":    { "x_from_left_mm": number, "x_to_left_mm": number },
    "left_panel":  { "x_from_left_mm": number, "x_to_left_mm": number },
    "right_panel": { "x_from_left_mm": number, "x_to_left_mm": number },
    "top_bridge":  { "y_from_top_pct": number, "y_to_top_pct": number }
  },
  "existing_builtins_on_target_wall": ["string — items to demolish, e.g., 상단 행거, 기존 수납장, 중앙 파티션"],
  "confidence": "high" | "medium" | "low"
}

DEFINITIONS:
- "alcove" = 3-sided recessed bay in the wall (left vertical panel + right vertical panel + top header/bridge). The fridge is meant to sit INSIDE this bay.
- If the target wall is flat (no recess), set alcove_frame.present = false and put 0 for all interior/panel/bridge fields.
- If alcove is present, measure INTERIOR width between the inner faces of the left and right panels — this is the usable install width.

CALIBRATION (Korean apartments):
- Wall width: typically 2200-3600mm (conservative)
- Alcove interior width: typically 1800-3200mm
- Wall height: typically 2200-2400mm
- Door frame = 900mm, standard outlet plate = 70mm — use as scale references.

Return ONLY valid JSON. No text before or after.`;
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
