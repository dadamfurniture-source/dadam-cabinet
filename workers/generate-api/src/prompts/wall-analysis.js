/**
 * 벽 분석 프롬프트 (공통).
 * Step 1 에서 모든 카테고리가 같은 프롬프트로 Gemini Vision 에 벽 치수를 요청한다.
 * 카테고리별로 보정 로직이 다르면 여기에 categoryWallCorrection(category, wallW) 만 추가.
 */

export function buildWallAnalysisPrompt() {
  return `[TASK: Korean kitchen wall structure analysis]
Analyze this photo and extract as JSON:
- wall_dimensions_mm: { width, height } (estimate)
- utility_positions_mm: { water_supply_from_left, exhaust_duct_from_left }
- confidence: "high" | "medium" | "low"
Return ONLY valid JSON.`;
}
