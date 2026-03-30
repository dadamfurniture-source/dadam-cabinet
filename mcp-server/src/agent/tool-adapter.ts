// ═══════════════════════════════════════════════════════════════
// Tool Adapter - 도구 호출 → 기존 서비스 매핑 (thin adapter)
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { analyzeWall } from '../services/wall-analysis.service.js';
import { searchAndClassifyRules } from '../services/rag-search.service.js';
import { generateClosedAndOpenDoorImages } from '../services/image-generation.service.js';
import { extractDesignData } from '../services/design-data.service.js';
import { generateBom } from '../services/bom.service.js';
import { generateDrawingData } from '../services/drawing.service.js';
import { renderDrawingToSvg } from '../services/svg-renderer.service.js';
import { claudeVisionAnalysis, extractTextFromClaudeResponse } from '../clients/claude.client.js';
import { supabaseRpc } from '../clients/supabase.client.js';
import type { AgentSession, ToolExecutionResult, DesignState } from './types.js';
import type { Category, CabinetSpecs } from '../types/index.js';

const log = createLogger('tool-adapter');

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  session: AgentSession,
): Promise<ToolExecutionResult> {
  const start = Date.now();

  try {
    let result: unknown;

    switch (toolName) {
      case 'analyze_wall':
        result = await handleAnalyzeWall(input, session);
        break;
      case 'search_design_rules':
        result = await handleSearchDesignRules(input, session);
        break;
      case 'render_furniture':
        result = await handleRenderFurniture(input, session);
        break;
      case 'compute_layout':
        result = await handleComputeLayout(input, session);
        break;
      case 'generate_bom':
        result = await handleGenerateBom(session);
        break;
      case 'generate_drawing':
        result = await handleGenerateDrawing(input, session);
        break;
      case 'render_svg':
        result = await handleRenderSvg(input, session);
        break;
      case 'save_design':
        result = await handleSaveDesign(input, session);
        break;
      case 'search_options':
        result = await handleSearchOptions(input, session);
        break;
      case 'verify_image':
        result = await handleVerifyImage(input, session);
        break;
      default:
        return { success: false, data: null, error: `Unknown tool: ${toolName}` };
    }

    const duration = Date.now() - start;
    log.info({ tool: toolName, duration }, 'Tool executed');

    return { success: true, data: result };
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    log.error({ tool: toolName, duration, error: message }, 'Tool execution failed');
    return { success: false, data: null, error: message };
  }
}

// ─────────────────────────────────────────────────────────────────
// Tool Handlers
// ─────────────────────────────────────────────────────────────────

async function handleAnalyzeWall(
  input: Record<string, unknown>,
  session: AgentSession,
): Promise<unknown> {
  if (!session.roomImage) {
    throw new Error('세션에 방 사진이 없습니다. 먼저 방 사진을 업로드해주세요.');
  }

  if (session.designState.wallAnalysis) {
    return {
      message: '이미 분석된 벽 데이터를 반환합니다.',
      wall_analysis: session.designState.wallAnalysis,
    };
  }

  const provider = (input.provider as 'claude' | 'gemini') || 'claude';

  const wallData = await analyzeWall({
    image: session.roomImage,
    imageType: session.imageType || 'image/jpeg',
    provider,
  });

  session.designState.wallAnalysis = wallData;

  return {
    wall_width_mm: wallData.wall_width_mm,
    wall_height_mm: wallData.wall_height_mm,
    tile_type: wallData.tile_type,
    confidence: wallData.confidence,
    water_pipe_x: wallData.water_pipe_x,
    exhaust_duct_x: wallData.exhaust_duct_x,
    gas_pipe_x: wallData.gas_pipe_x,
    furniture_placement: wallData.furniture_placement,
  };
}

async function handleSearchDesignRules(
  input: Record<string, unknown>,
  session: AgentSession,
): Promise<unknown> {
  const category = input.category as string;
  const style = input.style as string;

  session.designState.category = category as Category;
  session.designState.style = style;

  const ragResult = await searchAndClassifyRules(category, style);
  session.designState.ragRules = ragResult.classified;

  return {
    total_rules: ragResult.rules.length,
    background_rules: ragResult.classified.background.length,
    module_rules: ragResult.classified.modules.length,
    door_rules: ragResult.classified.doors.length,
    material_rules: ragResult.classified.materials.length,
    triggers_used: ragResult.triggers,
  };
}

async function handleRenderFurniture(
  input: Record<string, unknown>,
  session: AgentSession,
): Promise<unknown> {
  const { wallAnalysis, ragRules } = session.designState;

  if (!wallAnalysis) {
    throw new Error('벽 분석 결과가 없습니다. 먼저 analyze_wall을 호출하세요.');
  }
  if (!ragRules) {
    throw new Error('설계 규칙이 없습니다. 먼저 search_design_rules를 호출하세요.');
  }
  if (!session.roomImage) {
    throw new Error('방 사진이 없습니다.');
  }

  const category = (input.category as string) || session.designState.category || 'sink';
  const style = (input.style as string) || session.designState.style || 'modern';
  const cabinetSpecs = (input.cabinet_specs as CabinetSpecs) || session.designState.cabinetSpecs || {};

  session.designState.category = category as Category;
  session.designState.style = style;
  session.designState.cabinetSpecs = cabinetSpecs;

  const { closedImage, openImage } = await generateClosedAndOpenDoorImages(
    {
      category,
      style,
      wallData: wallAnalysis,
      rules: ragRules,
      cabinetSpecs,
    },
    session.roomImage,
    session.imageType || 'image/jpeg',
  );

  session.designState.generatedImages = { closed: closedImage, open: openImage };

  return {
    closed_image_generated: true,
    open_image_generated: openImage !== null,
    message: '가구 이미지 생성 완료',
  };
}

async function handleComputeLayout(
  input: Record<string, unknown>,
  session: AgentSession,
): Promise<unknown> {
  const { wallAnalysis, ragRules } = session.designState;

  if (!wallAnalysis) {
    throw new Error('벽 분석 결과가 없습니다. 먼저 analyze_wall을 호출하세요.');
  }
  if (!ragRules) {
    throw new Error('설계 규칙이 없습니다. 먼저 search_design_rules를 호출하세요.');
  }

  const category = (input.category as string) || session.designState.category || 'sink';
  const style = (input.style as string) || session.designState.style || 'modern';
  const cabinetSpecs = (input.cabinet_specs as CabinetSpecs) || session.designState.cabinetSpecs;

  const designData = extractDesignData({
    category: category as Category,
    style,
    wallData: wallAnalysis,
    classified: ragRules,
    cabinetSpecs,
  });

  session.designState.designData = designData;

  return {
    category: designData.category,
    style: designData.style,
    wall: designData.wall,
    layout: designData.layout,
    upper_cabinets: designData.cabinets.upper.length,
    lower_cabinets: designData.cabinets.lower.length,
    equipment: Object.keys(designData.equipment),
    materials: designData.materials,
  };
}

async function handleGenerateBom(session: AgentSession): Promise<unknown> {
  const { designData } = session.designState;

  if (!designData) {
    throw new Error('설계 데이터가 없습니다. 먼저 compute_layout을 호출하세요.');
  }

  const bomResult = generateBom(designData);
  session.designState.bomResult = bomResult;

  return {
    total_items: bomResult.summary.total_items,
    total_panels: bomResult.summary.total_panels,
    total_hardware: bomResult.summary.total_hardware,
    sheet_estimate: bomResult.summary.sheet_estimate,
    categories: bomResult.summary.categories,
    items: bomResult.items.map(item => ({
      id: item.id,
      name: item.name,
      material: item.material,
      width_mm: item.width_mm,
      height_mm: item.height_mm,
      quantity: item.quantity,
      unit: item.unit,
    })),
  };
}

async function handleGenerateDrawing(
  input: Record<string, unknown>,
  session: AgentSession,
): Promise<unknown> {
  const { designData, bomResult } = session.designState;

  if (!designData) {
    throw new Error('설계 데이터가 없습니다. 먼저 compute_layout을 호출하세요.');
  }

  const drawingData = generateDrawingData(designData, bomResult, {
    include_manufacturing: input.include_manufacturing as boolean ?? true,
    include_installation: input.include_installation as boolean ?? true,
  });

  session.designState.drawingData = drawingData;

  return {
    front_view_doors: drawingData.common.front_view.doors.length,
    front_view_hardware: drawingData.common.front_view.hardware.length,
    panel_details: drawingData.manufacturing.panel_details.length,
    utilities: drawingData.installation.utilities.length,
    message: '도면 데이터 생성 완료',
  };
}

async function handleRenderSvg(
  input: Record<string, unknown>,
  session: AgentSession,
): Promise<unknown> {
  const { drawingData } = session.designState;

  if (!drawingData) {
    throw new Error('도면 데이터가 없습니다. 먼저 generate_drawing을 호출하세요.');
  }

  const views = input.views as string[] | undefined;
  const svgOutput = renderDrawingToSvg(drawingData, {
    views: views as ('front' | 'side' | 'plan' | 'manufacturing' | 'installation')[] | undefined,
  });

  session.designState.svgOutput = svgOutput;

  return {
    rendered_views: Object.entries(svgOutput)
      .filter(([, svg]) => svg.length > 0)
      .map(([name]) => name),
    message: 'SVG 렌더링 완료',
  };
}

async function handleSaveDesign(
  input: Record<string, unknown>,
  session: AgentSession,
): Promise<unknown> {
  const { designData, generatedImages, bomResult } = session.designState;

  if (!designData) {
    throw new Error('저장할 설계 데이터가 없습니다.');
  }

  const title = (input.title as string) || `${designData.category} ${designData.style} 설계`;

  const result = await supabaseRpc('save_design', {
    p_title: title,
    p_category: designData.category,
    p_style: designData.style,
    p_design_data: designData,
    p_bom_data: bomResult || null,
    p_has_images: !!generatedImages,
  });

  return { saved: true, title, result };
}

async function handleSearchOptions(
  input: Record<string, unknown>,
  session: AgentSession,
): Promise<unknown> {
  const query = input.query as string;
  const category = (input.category as string) || session.designState.category || 'sink';

  const ragResult = await searchAndClassifyRules(category, query);

  return {
    query,
    results: ragResult.rules.slice(0, 10).map(rule => ({
      content: rule.content,
      type: rule.rule_type || rule.chunk_type,
    })),
    total: ragResult.rules.length,
  };
}

async function handleVerifyImage(
  input: Record<string, unknown>,
  session: AgentSession,
): Promise<unknown> {
  const { generatedImages } = session.designState;

  if (!generatedImages) {
    throw new Error('검증할 이미지가 없습니다. 먼저 render_furniture를 호출하세요.');
  }

  const imageType = (input.image_type as string) || 'closed';
  const image = imageType === 'open' ? generatedImages.open : generatedImages.closed;

  if (!image) {
    throw new Error(`${imageType} 이미지가 없습니다.`);
  }

  const verifyPrompt = `이 가구 디자인 이미지를 평가해주세요. 다음 기준으로 1-10 점수를 매겨주세요:
1. 가구 배치의 자연스러움 (벽면에 맞게 배치되었는지)
2. 비율의 합리성 (가구 크기가 공간에 적절한지)
3. 시각적 품질 (아티팩트, 왜곡 여부)
4. 전체적인 디자인 완성도

JSON 형식으로 응답: {"placement": 점수, "proportion": 점수, "quality": 점수, "completeness": 점수, "overall": 평균점수, "issues": ["문제1", ...], "suggestions": ["제안1", ...]}`;

  // Haiku 사용: 이미지 검증은 점수 매기기 + 이슈 나열로 비용 최적화
  // 이미지 매직 바이트로 mime type 자동 감지
  const mimeType = image.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
  const response = await claudeVisionAnalysis(image, mimeType, verifyPrompt, undefined, { model: 'haiku', max_tokens: 1024 });
  const text = extractTextFromClaudeResponse(response);

  if (!text) {
    return { verified: false, message: '이미지 검증에 실패했습니다.' };
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const evaluation = JSON.parse(jsonMatch[0]);
      return { verified: true, evaluation };
    }
  } catch {
    // JSON 파싱 실패 시 텍스트 반환
  }

  return { verified: true, evaluation_text: text };
}
