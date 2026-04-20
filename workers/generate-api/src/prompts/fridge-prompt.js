/**
 * 냉장고장 전용 프롬프트
 *
 * 대상 category: 'fridge' | 'fridge_cabinet'
 *
 * 단계:
 *   Step 1.5 (pre-analysis, 냉장고장 전용): Claude Opus 4.7 가 방 사진을 분석해
 *     구조·장애물·재질·조명 힌트를 JSON 으로 추출. 실패해도 생성 파이프라인은 진행.
 *   Step 2 (닫힌 도어): Gemini. preAnalysis 결과를 [ROOM CONTEXT] 블록으로 프롬프트에 주입.
 *   Step 3 (열린 도어): Gemini.
 *
 * 다른 카테고리는 Claude 를 호출하지 않음. 이 파일만 수정해도 다른 카테고리 영향 없음.
 */

export const FRIDGE_CATEGORIES = ['fridge', 'fridge_cabinet'];

/** Pre-analysis 에 사용할 Claude 모델 ID. 바꾸려면 이 줄만 수정. */
export const FRIDGE_ANALYSIS_MODEL = 'claude-opus-4-7';

/**
 * Claude Opus 4.7 에게 방 사진을 분석시키는 프롬프트.
 * 반환 JSON 은 buildFridgeClosedPrompt 가 [ROOM CONTEXT] 블록으로 포맷해 Gemini 에 전달.
 */
export function buildFridgeAnalysisPrompt() {
  return `이 방 사진을 한국 아파트 냉장고장 빌트인 설치 관점에서 분석하세요.
다음 JSON 스키마만 반환하고 다른 설명은 붙이지 마세요:

{
  "floor": { "material": "string — 예: 오크 원목 / 월넛 / 대리석 타일 / 포세린 타일", "tone": "warm | cool | neutral" },
  "ceiling": { "type": "flat | molding | soffit | beam_exposed", "lighting": "string — 예: 다운라이트 4개 일렬" },
  "side_walls": { "color": "string", "notable_features": ["string, 예: 창문·문·콘센트 위치"] },
  "target_wall_obstructions": [
    { "type": "pillar | beam | window | door | outlet | niche | existing_cabinet", "side": "left | center | right", "note": "string" }
  ],
  "existing_fridge_visible": { "present": true_or_false, "side": "left | center | right | null", "approx_width_mm": number_or_null },
  "existing_built_ins_on_target_wall": ["string — 예: 상단 행거, 하단 수납장"],
  "style_character": "string — 짧게 (예: 모던 미니멀, 따뜻한 스칸디)",
  "design_hints_for_fridge_cabinet": "string — 기존 공간과 조화로운 냉장고장 톤·비례 한줄 제안",
  "special_considerations": ["string — 설치 시 주의점. 없으면 빈 배열"]
}

JSON 외 텍스트 금지. 확신 없으면 null 사용.`;
}

/** preAnalysis 객체를 Gemini 프롬프트에 삽입할 사람이 읽기 좋은 포맷으로 변환. */
function formatPreAnalysis(pa) {
  if (!pa || typeof pa !== 'object') return '';
  const lines = ['[ROOM CONTEXT FROM CLAUDE PRE-ANALYSIS — honor these when designing the fridge cabinet]'];
  if (pa.floor) lines.push(`- Floor: ${pa.floor.material || '?'} (${pa.floor.tone || '?'} tone)`);
  if (pa.ceiling) lines.push(`- Ceiling: ${pa.ceiling.type || '?'}${pa.ceiling.lighting ? ' — ' + pa.ceiling.lighting : ''}`);
  if (pa.side_walls) {
    const feats = Array.isArray(pa.side_walls.notable_features) && pa.side_walls.notable_features.length
      ? ' — features: ' + pa.side_walls.notable_features.join(', ')
      : '';
    lines.push(`- Side walls: ${pa.side_walls.color || '?'}${feats}`);
  }
  if (Array.isArray(pa.target_wall_obstructions) && pa.target_wall_obstructions.length) {
    lines.push(`- Target wall obstructions: ${pa.target_wall_obstructions.map((o) => `${o.type}@${o.side}${o.note ? ' (' + o.note + ')' : ''}`).join('; ')}`);
  }
  if (pa.existing_fridge_visible?.present) {
    const f = pa.existing_fridge_visible;
    lines.push(`- Existing fridge visible: side=${f.side || '?'}${f.approx_width_mm ? `, ~${f.approx_width_mm}mm wide` : ''} — try to keep this side/width`);
  }
  if (Array.isArray(pa.existing_built_ins_on_target_wall) && pa.existing_built_ins_on_target_wall.length) {
    lines.push(`- Existing built-ins to replace: ${pa.existing_built_ins_on_target_wall.join(', ')}`);
  }
  if (pa.style_character) lines.push(`- Style character: ${pa.style_character}`);
  if (pa.design_hints_for_fridge_cabinet) lines.push(`- Design hint: ${pa.design_hints_for_fridge_cabinet}`);
  if (Array.isArray(pa.special_considerations) && pa.special_considerations.length) {
    lines.push(`- Special considerations: ${pa.special_considerations.join('; ')}`);
  }
  return lines.join('\n');
}

export function buildFridgeClosedPrompt({ wallData, themeData, styleName, preAnalysis }) {
  const doorColor = themeData.style_door_color || 'white';
  const doorFinish = themeData.style_door_finish || 'matte';
  const contextBlock = preAnalysis ? `\n${formatPreAnalysis(preAnalysis)}\n` : '';
  return `Place ${doorColor} ${doorFinish} refrigerator surround cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Center opening for fridge, tall storage on sides, bridge above.
No visible handles. ${styleName}. Photorealistic. All doors closed.${contextBlock}`;
}

export function buildFridgeAltSpec() {
  return {
    inputKey: 'closed',
    prompt: `Using this closed-door fridge cabinet image, generate the SAME cabinet with doors OPEN.
RULES:
- SAME camera angle, lighting, background, furniture position, fridge position
- Open the cabinet doors to ~90 degrees showing interior shelving and pantry items
- Keep refrigerator itself unchanged
- Photorealistic quality
- Do NOT change any furniture structure or color`,
    metadata: { alt_style: { name: '내부 구조 (열린문)' } },
  };
}

export const __internals = { formatPreAnalysis };
