// ═══════════════════════════════════════════════════════════════
// Interior Route - 방 사진 → AI 가구 설계
// POST /webhook/dadam-interior-v4
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { validateCategory, validateBase64Image, validateMimeType } from '../middleware/input-validator.js';
import type { Category } from '../types/index.js';
import { searchAndClassifyRules } from '../services/rag-search.service.js';
import { analyzeWall } from '../services/wall-analysis.service.js';
import { generateClosedAndOpenDoorImages } from '../services/image-generation.service.js';
import { extractDesignData } from '../services/design-data.service.js';

const log = createLogger('route:interior');
const router = Router();

router.post('/webhook/dadam-interior-v4', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;

    // 1. 입력 검증 및 파싱
    const category = validateCategory(body.category) as Category;
    const style = body.design_style || body.style || 'modern';
    const roomImage = validateBase64Image(body.room_image, 'room_image');
    const imageType = validateMimeType(body.image_type);

    const styleKeywords = body.style_keywords || '';
    const styleAtmosphere = body.style_atmosphere || '';
    const colorName = body.color_name || '';
    const colorPrompt = body.color_prompt || '';

    const cabinetSpecs = body.cabinet_specs || {};
    const modules = body.modules || {};

    // 테마/컬러 정보를 cabinetSpecs에 병합
    if (colorName) {
      cabinetSpecs.door_color_upper = colorName;
      cabinetSpecs.door_color_lower = colorName;
    }

    log.info({ category, style, colorName }, 'Processing interior design request');

    // 2. RAG 검색
    const ragResult = await searchAndClassifyRules(category, style);

    // 3. 벽 분석
    const wallData = await analyzeWall({ image: roomImage, imageType });

    // 4. 이미지 생성 (닫힌문 + 열린문)
    const { closedImage, openImage } = await generateClosedAndOpenDoorImages(
      {
        category,
        style,
        wallData,
        rules: ragResult.classified,
        cabinetSpecs,
        modules,
        styleKeywords,
        styleAtmosphere,
        colorPrompt,
      },
      roomImage,
      imageType
    );

    // 5. 구조화된 설계 데이터 추출
    const designData = extractDesignData({
      category,
      style,
      wallData,
      classified: ragResult.classified,
      cabinetSpecs,
      modules,
    });

    // 6. 응답 (ai-design.html 호환 형식)
    res.json({
      success: true,
      message: '이미지 생성 완료',
      category,
      style,
      rag_rules_count: ragResult.rules.length,
      generated_image: {
        closed: {
          base64: closedImage,
          mime_type: 'image/png',
        },
        open: openImage ? {
          base64: openImage,
          mime_type: 'image/png',
        } : null,
        // 레거시 호환
        base64: closedImage,
        mime_type: 'image/png',
      },
      design_data: designData,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
