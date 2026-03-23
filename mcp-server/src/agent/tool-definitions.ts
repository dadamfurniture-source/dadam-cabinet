// ═══════════════════════════════════════════════════════════════
// Tool Definitions - 10개 Claude tool 스키마 정의
// ═══════════════════════════════════════════════════════════════

import type { ClaudeToolDefinition } from './types.js';

export const AGENT_TOOLS: ClaudeToolDefinition[] = [
  {
    name: 'analyze_wall',
    description: '방 사진을 분석하여 벽면 치수, 타일 정보, 배관 위치를 측정합니다. 방 사진이 세션에 있을 때만 호출하세요. 이미 분석 결과가 있으면 재호출하지 마세요.',
    input_schema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['claude', 'gemini'],
          description: '분석에 사용할 AI 프로바이더. 기본값: claude',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_design_rules',
    description: '가구 카테고리와 스타일에 맞는 설계 규칙을 RAG 검색합니다. 벽 분석 후, 이미지 생성 전에 호출하세요.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage'],
          description: '가구 카테고리',
        },
        style: {
          type: 'string',
          description: '디자인 스타일 (예: modern, classic, natural)',
        },
      },
      required: ['category', 'style'],
    },
  },
  {
    name: 'render_furniture',
    description: '벽 분석과 설계 규칙을 바탕으로 가구 이미지를 생성합니다(닫힌문 + 열린문). 벽 분석과 RAG 검색이 완료된 후에 호출하세요.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage'],
          description: '가구 카테고리',
        },
        style: {
          type: 'string',
          description: '디자인 스타일',
        },
        cabinet_specs: {
          type: 'object',
          description: '캐비닛 사양 오버라이드 (선택). door_color_upper, countertop_color 등',
        },
      },
      required: ['category', 'style'],
    },
  },
  {
    name: 'compute_layout',
    description: '벽 분석 + RAG 규칙 + 사양으로 구조화된 설계 데이터(캐비닛 배치, 치수, 자재)를 생성합니다.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage'],
          description: '가구 카테고리',
        },
        style: {
          type: 'string',
          description: '디자인 스타일',
        },
        cabinet_specs: {
          type: 'object',
          description: '캐비닛 사양 오버라이드 (선택)',
        },
      },
      required: ['category', 'style'],
    },
  },
  {
    name: 'generate_bom',
    description: '설계 데이터로부터 BOM(부품 목록)을 생성합니다. compute_layout 결과가 필요합니다.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'generate_drawing',
    description: '설계 데이터로부터 2D 도면 좌표 데이터를 생성합니다. compute_layout 결과가 필요합니다.',
    input_schema: {
      type: 'object',
      properties: {
        include_manufacturing: {
          type: 'boolean',
          description: '제작 도면 포함 여부. 기본: true',
        },
        include_installation: {
          type: 'boolean',
          description: '설치 도면 포함 여부. 기본: true',
        },
      },
      required: [],
    },
  },
  {
    name: 'render_svg',
    description: '도면 좌표 데이터를 SVG 이미지로 렌더링합니다. generate_drawing 결과가 필요합니다.',
    input_schema: {
      type: 'object',
      properties: {
        views: {
          type: 'array',
          items: { type: 'string', enum: ['front', 'side', 'plan', 'manufacturing', 'installation'] },
          description: '렌더링할 뷰 목록. 기본: 전체',
        },
      },
      required: [],
    },
  },
  {
    name: 'save_design',
    description: '현재 설계 결과를 Supabase에 저장합니다.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '설계 제목',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_options',
    description: '특정 항목에 대한 옵션을 RAG로 검색합니다 (예: 사용 가능한 상판 색상, 핸들 종류 등).',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '검색할 항목 (예: "countertop_color", "handle_type", "door_finish")',
        },
        category: {
          type: 'string',
          description: '가구 카테고리 필터',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'verify_image',
    description: '생성된 가구 이미지의 품질을 검증합니다. 배치 자연스러움, 비율 합리성, 아티팩트 여부를 평가합니다.',
    input_schema: {
      type: 'object',
      properties: {
        image_type: {
          type: 'string',
          enum: ['closed', 'open'],
          description: '검증할 이미지 유형. 기본: closed',
        },
      },
      required: [],
    },
  },
];

export function getToolDefinitions(): ClaudeToolDefinition[] {
  return AGENT_TOOLS;
}
