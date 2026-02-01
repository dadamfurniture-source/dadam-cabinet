// ═══════════════════════════════════════════════════════════════
// Gemini Image Generation Tool - AI 가구 이미지 생성
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import {
  geminiImageGeneration,
  extractImageFromGeminiResponse,
  extractTextFromGeminiResponse,
} from '../utils/api-client.js';

// ─────────────────────────────────────────────────────────────────
// Tool Definition
// ─────────────────────────────────────────────────────────────────

export const geminiImageTool = {
  name: 'gemini_generate_image',
  description: 'Gemini로 포토리얼리스틱 가구 이미지를 생성합니다. 방 사진을 참조하여 맞춤형 가구 렌더링을 생성합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string',
        description: '이미지 생성 프롬프트',
      },
      reference_image: {
        type: 'string',
        description: 'Base64 인코딩된 참조 이미지 (선택)',
      },
      image_type: {
        type: 'string',
        description: '참조 이미지 MIME 타입 (예: image/jpeg)',
        default: 'image/jpeg',
      },
    },
    required: ['prompt'],
  },
};

// ─────────────────────────────────────────────────────────────────
// Input Validation Schema
// ─────────────────────────────────────────────────────────────────

const inputSchema = z.object({
  prompt: z.string(),
  reference_image: z.string().optional(),
  image_type: z.string().optional().default('image/jpeg'),
});

// ─────────────────────────────────────────────────────────────────
// Tool Handler
// ─────────────────────────────────────────────────────────────────

export async function handleGeminiImage(args: unknown) {
  // 입력 검증
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid input: ${parsed.error.message}`,
        },
      ],
      isError: true,
    };
  }

  const { prompt, reference_image, image_type } = parsed.data;

  try {
    // Gemini Image Generation API 호출
    const response = await geminiImageGeneration(prompt, reference_image, image_type);

    // 이미지 추출
    const imageBase64 = extractImageFromGeminiResponse(response);
    const textResponse = extractTextFromGeminiResponse(response);

    if (!imageBase64) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'No image generated',
              text_response: textResponse,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            image: {
              base64: imageBase64,
              mime_type: 'image/png',
            },
            text_response: textResponse,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Image generation failed: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Prompt Templates
// ─────────────────────────────────────────────────────────────────

export const CLOSED_DOOR_PROMPT_TEMPLATE = `[TASK: KOREAN BUILT-IN KITCHEN RENDERING - PHOTOREALISTIC]

Generate a photorealistic image of Korean-style built-in kitchen furniture based on the uploaded construction/renovation room photo.

{{WALL_MEASUREMENTS}}

{{UTILITY_PLACEMENT}}

{{STYLE}}

{{MATERIAL_SPEC}}

{{BACKGROUND_RULES}}

{{MODULE_RULES}}

{{DOOR_SPECS}}

[CRITICAL REQUIREMENTS]
1. PHOTOREALISTIC quality - must look like a real photograph
2. EXACT camera angle from original photo - same perspective, same viewpoint
3. Furniture MUST fit within wall dimensions precisely
4. SINK at water supply location, COOKTOP at exhaust duct location - MANDATORY
5. ALL doors must be CLOSED (no open doors or drawers)
6. Background must show COMPLETED, FINISHED surfaces (no construction visible)
7. Natural lighting consistent with original photo
8. No people, pets, or moving objects

[OUTPUT]
- Single photorealistic image
- High resolution, professional interior design quality
- Magazine-worthy kitchen rendering
`;

export const OPEN_DOOR_PROMPT_TEMPLATE = `[TASK] 이 가구 이미지에서 모든 도어를 열린 상태로 변경하세요.

[CRITICAL - 절대 변경 금지]
- 도어 개수: 현재 이미지에 보이는 도어 개수 정확히 유지
- 도어 위치: 각 도어의 위치 그대로 유지
- 도어 크기/비율: 각 도어의 너비와 높이 비율 완전히 동일
- 도어 색상/재질: 변경 금지
- 가구 전체 크기와 형태: 변경 금지
- 카메라 앵글, 원근감, 시점: 완전히 동일
- 배경 (벽, 바닥, 천장, 조명): 동일

[변경할 것 - 도어 상태만]
- 각 여닫이 도어: 현재 위치에서 90도 바깥으로 회전하여 열림
- 각 서랍: 현재 위치에서 30-40% 당겨진 상태

[CRITICAL - 도어 구조 유지 규칙]
- 절대 도어를 추가하거나 제거하지 마세요
- 절대 도어를 합치거나 분할하지 마세요
- 닫힌 상태의 도어 분할선/경계선을 정확히 따르세요
- 각 도어는 독립적으로 열려야 합니다

[내부 수납물 - {{CATEGORY}}]
{{CONTENTS}}

[금지사항]
- 붙박이장에 식기류 금지 (옷만 표시)
- 싱크대에 의류 금지 (주방용품만 표시)

[출력 품질]
- 닫힌 이미지와 도어 구조 100% 일치
- 포토리얼리스틱 인테리어 사진 품질`;

// 카테고리별 내용물
export const CATEGORY_CONTENTS: Record<string, string> = {
  wardrobe: `- 행거에 걸린 셔츠, 블라우스, 재킷, 코트
- 접힌 스웨터, 니트, 티셔츠
- 청바지, 면바지 등 하의류
- 서랍 속 속옷, 양말 정리함
- 가방, 모자, 스카프 액세서리`,

  sink: `- 그릇, 접시, 밥공기, 국그릇
- 컵, 머그잔, 유리잔
- 냄비, 프라이팬, 조리도구
- 양념통, 오일병
- 도마, 주걱, 국자`,

  fridge: `- 커피머신, 전자레인지
- 토스터, 믹서기
- 식료품, 시리얼
- 컵, 머그잔`,

  vanity: `- 화장품, 스킨케어 제품
- 메이크업 브러시, 파우치
- 향수, 로션
- 헤어드라이어`,

  shoe: `- 운동화, 스니커즈
- 구두, 로퍼, 힐
- 샌들, 슬리퍼
- 부츠`,

  storage: `- 책, 잡지, 문서
- 수납박스, 바구니
- 이불, 침구류
- 여행가방`,
};
