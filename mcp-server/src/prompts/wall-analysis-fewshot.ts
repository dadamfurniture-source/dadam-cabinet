// ═══════════════════════════════════════════════════════════════
// Few-Shot Wall Analysis Prompt - 참조 이미지 기반 벽 분석 프롬프트
// ═══════════════════════════════════════════════════════════════

import type { ReferenceImage } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────
// Few-Shot 프롬프트 빌더
// ─────────────────────────────────────────────────────────────────

export function buildFewShotPrompt(
  referenceImages: ReferenceImage[],
  targetImageIndex: number
): string {
  // 참조 이미지 섹션 생성
  const refSection = referenceImages.map((ref, idx) => {
    const gt = ref.ground_truth as Record<string, unknown>;
    const gtStr = JSON.stringify(gt, null, 2);

    return `
[이미지 ${idx + 1}: ${ref.name}]
카테고리: ${ref.category}
시각적 특징: ${ref.visual_features.join(', ')}
${ref.description ? `설명: ${ref.description}` : ''}
정답(Ground Truth):
${gtStr}`;
  }).join('\n---');

  return `[TASK: WALL UTILITY DETECTION - FEW-SHOT LEARNING]

당신은 한국 주방 공사 현장의 벽면 사진을 분석하여 배관 및 설비 위치를 감지하는 AI입니다.
아래 참조 이미지들의 패턴을 학습한 후, TARGET IMAGE를 분석하세요.

═══════════════════════════════════════════════════════════════
참조 이미지 (REFERENCE IMAGES - 정답 예시)
═══════════════════════════════════════════════════════════════
${refSection}

═══════════════════════════════════════════════════════════════
분석 대상 이미지 (TARGET IMAGE - 이미지 ${targetImageIndex + 1})
═══════════════════════════════════════════════════════════════

위 참조 이미지들에서 학습한 시각적 패턴을 사용하여 TARGET IMAGE를 분석하세요.

═══════════════════════════════════════════════════════════════
[STEP 1: 기준벽 및 기준점(0mm) 설정]
═══════════════════════════════════════════════════════════════
기준점 설정 우선순위:
1순위: 벽이 없이 틔어져 있는 끝선 (개방된 공간 쪽)
2순위: 양쪽이 막혀 있다면 → 후드에서 먼 쪽 끝선을 기준점으로 설정

※ 해당 기준점을 0mm로 설정하고, 반대 방향으로 거리 측정

═══════════════════════════════════════════════════════════════
[STEP 2: 타일을 자(Ruler)로 활용한 치수 측정]
═══════════════════════════════════════════════════════════════
타일 종류별 크기 (가로×세로):
- Standard Wall (한국 표준): 300×600mm ★ 가장 일반적
- Subway Large: 100×300mm
- Porcelain Large: 600×1200mm

타일이 없는 경우 참조:
- 표준 문 너비: 900mm
- 표준 문 높이: 2100mm
- 콘센트 높이 (바닥에서): 300mm
- 한국 아파트 천장 높이: 2300-2400mm

═══════════════════════════════════════════════════════════════
[STEP 3: 배관 및 설비 감지 - 참조 이미지 패턴 사용]
═══════════════════════════════════════════════════════════════

★★★ 중요: 참조 이미지와 유사한 시각적 특징이 보이면 confidence를 "high"로 설정하세요.

>> 급수 배관 (WATER SUPPLY) - 참조 이미지 패턴 확인
- 빨간색/파란색 배관 (온수/냉수)
- 흰색/베이지색 분배기 박스와 밸브
- 위치: 벽 하단부, 바닥에서 200-500mm
→ 싱크볼은 반드시 이 위치에 설치

>> 배기 덕트 (EXHAUST DUCT) - 참조 이미지 패턴 확인
- 유연한 알루미늄/은색 덕트 파이프
- 벽의 원형 또는 사각형 구멍
- 위치: 벽 상단부, 바닥에서 1800-2200mm
→ 레인지후드와 쿡탑은 반드시 이 위치에 설치

>> 가스 배관 (GAS PIPE) - 참조 이미지 패턴 확인
- 노란색으로 도색된 금속 파이프
- 가스 밸브/콕
- 위치: 벽 중하단부
→ 가스 쿡탑 연결 지점

>> 전기 콘센트 (ELECTRICAL OUTLETS) - 참조 이미지 패턴 확인
- 흰색 플라스틱 콘센트
- 고전압 가전용 콘센트 (오븐, 식기세척기)

═══════════════════════════════════════════════════════════════
[STEP 4: OUTPUT JSON FORMAT]
═══════════════════════════════════════════════════════════════

{
  "reference_wall": {
    "origin_point": "open_edge 또는 far_from_hood",
    "origin_reason": "선택 이유 설명"
  },
  "tile_measurement": {
    "detected": true/false,
    "tile_type": "standard_wall/subway_large/porcelain_large 등",
    "tile_size_mm": { "width": 300, "height": 600 },
    "tile_count": { "horizontal": 10, "vertical": 4 }
  },
  "wall_dimensions_mm": { "width": 3000, "height": 2400 },
  "utility_positions": {
    "water_supply": {
      "detected": true/false,
      "confidence": "high/medium/low",
      "matched_reference": "참조 이미지와 일치하는 특징 설명",
      "from_origin_mm": 800,
      "from_origin_percent": 27,
      "from_floor_mm": 300,
      "description": "빨간/파란 분배기 박스, 밸브 있음"
    },
    "exhaust_duct": {
      "detected": true/false,
      "confidence": "high/medium/low",
      "matched_reference": "참조 이미지와 일치하는 특징 설명",
      "from_origin_mm": 2200,
      "from_origin_percent": 73,
      "from_floor_mm": 2000,
      "description": "알루미늄 플렉시블 덕트, 벽 우측 상단"
    },
    "gas_pipe": {
      "detected": true/false,
      "confidence": "high/medium/low",
      "matched_reference": "참조 이미지와 일치하는 특징 설명",
      "from_origin_mm": 2100,
      "from_origin_percent": 70,
      "from_floor_mm": 500,
      "description": "노란색 가스 파이프, 배기구 근처"
    },
    "electrical_outlets": [
      { "from_origin_mm": 300, "from_floor_mm": 300, "type": "standard" }
    ]
  },
  "furniture_placement": {
    "sink_position": "수도배관 위치 기준 center_at_800mm",
    "cooktop_position": "배기구 위치 기준 center_at_2200mm",
    "layout_direction": "sink_left_cooktop_right 또는 sink_right_cooktop_left"
  },
  "analysis_method": "few_shot",
  "reference_images_used": ${referenceImages.length},
  "confidence": "high/medium/low",
  "notes": "추가 관찰 사항"
}

═══════════════════════════════════════════════════════════════
[CRITICAL RULES]
═══════════════════════════════════════════════════════════════
1. 반드시 유효한 JSON만 출력. 추가 텍스트나 설명 없이 JSON만.
2. 참조 이미지와 유사한 시각적 특징이 있으면 confidence를 "high"로 설정.
3. 배관이 감지되지 않으면 detected: false로 설정하고 위치 값은 생략.
4. matched_reference에는 참조 이미지와 일치하는 구체적 특징을 기술.`;
}

// ─────────────────────────────────────────════════════════════────
// Zero-Shot 폴백 프롬프트 (참조 이미지 없을 때)
// ─────────────────────────────────────────────────────────────────

export const WALL_ANALYSIS_ZERO_SHOT_PROMPT = `[TASK: KOREAN KITCHEN WALL STRUCTURE & UTILITY ANALYSIS]

═══════════════════════════════════════════════════════════════
[STEP 1: 기준벽 및 기준점(0mm) 설정]
═══════════════════════════════════════════════════════════════
기준점 설정 우선순위:
1순위: 벽이 없이 틔어져 있는 끝선 (개방된 공간 쪽)
2순위: 양쪽이 막혀 있다면 → 후드에서 먼 쪽 끝선을 기준점으로 설정

※ 해당 기준점을 0mm로 설정하고, 반대 방향으로 거리 측정

═══════════════════════════════════════════════════════════════
[STEP 2: 타일을 자(Ruler)로 활용한 치수 측정]
═══════════════════════════════════════════════════════════════
타일 종류별 크기 (가로×세로):
- Standard Wall (한국 표준): 300×600mm ★ 가장 일반적
- Subway Large: 100×300mm
- Porcelain Large: 600×1200mm

═══════════════════════════════════════════════════════════════
[STEP 3: 배관 및 설비 위치 식별]
═══════════════════════════════════════════════════════════════

>> 급수 배관 (WATER SUPPLY)
- 빨간색/파란색 배관 (온수/냉수)
- 흰색/베이지색 분배기 박스와 밸브
- 위치: 벽 하단부, 바닥에서 200-500mm

>> 배기 덕트 (EXHAUST DUCT)
- 유연한 알루미늄/은색 덕트 파이프
- 벽의 원형 또는 사각형 구멍
- 위치: 벽 상단부, 바닥에서 1800-2200mm

>> 가스 배관 (GAS PIPE)
- 노란색으로 도색된 금속 파이프
- 가스 밸브/콕
- 위치: 벽 중하단부

>> 전기 콘센트 (ELECTRICAL OUTLETS)
- 흰색 플라스틱 콘센트
- 고전압 가전용 콘센트

═══════════════════════════════════════════════════════════════
[OUTPUT JSON FORMAT]
═══════════════════════════════════════════════════════════════

{
  "reference_wall": {
    "origin_point": "open_edge 또는 far_from_hood",
    "origin_reason": "선택 이유 설명"
  },
  "tile_measurement": {
    "detected": true/false,
    "tile_type": "standard_wall",
    "tile_size_mm": { "width": 300, "height": 600 },
    "tile_count": { "horizontal": 10, "vertical": 4 }
  },
  "wall_dimensions_mm": { "width": 3000, "height": 2400 },
  "utility_positions": {
    "water_supply": {
      "detected": true/false,
      "from_origin_mm": 800,
      "from_floor_mm": 300,
      "description": "설명"
    },
    "exhaust_duct": {
      "detected": true/false,
      "from_origin_mm": 2200,
      "from_floor_mm": 2000,
      "description": "설명"
    },
    "gas_pipe": {
      "detected": true/false,
      "from_origin_mm": 2100,
      "from_floor_mm": 500,
      "description": "설명"
    },
    "electrical_outlets": []
  },
  "furniture_placement": {
    "sink_position": "center_at_Xmm",
    "cooktop_position": "center_at_Xmm",
    "layout_direction": "sink_left_cooktop_right"
  },
  "analysis_method": "zero_shot",
  "confidence": "medium",
  "notes": "관찰 사항"
}

CRITICAL: 반드시 유효한 JSON만 출력. 추가 텍스트 없이 JSON만.`;
