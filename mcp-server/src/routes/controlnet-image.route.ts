// ═══════════════════════════════════════════════════════════════
// ControlNet Image Route
// POST /webhook/controlnet-image
// 도면 데이터 기반 ControlNet 이미지 생성
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { validateCategory } from '../middleware/input-validator.js';
import { generateWithDrawingControlNet } from '../services/controlnet-generation.service.js';
import type { ControlNetType } from '../clients/replicate.client.js';

const log = createLogger('route:controlnet-image');
const router = Router();

router.post('/webhook/controlnet-image', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    const designData = body.design_data;
    const category = validateCategory(body.category);
    const style = body.style || 'modern';

    if (!designData) {
      res.status(400).json({
        success: false,
        error: 'design_data is required',
      });
      return;
    }

    log.info({ category, style }, 'Processing controlnet-image request');

    const result = await generateWithDrawingControlNet({
      designData,
      category,
      style,
      materialCode: body.material_code,
      additionalPrompt: body.additional_prompt,
      backgroundImage: body.background_image,
      promptStrength: body.prompt_strength,
      controlNetType: (body.controlnet_type || 'lineart') as ControlNetType,
      controlNetStrength: body.controlnet_strength,
      controlNetStart: body.controlnet_start,
      controlNetEnd: body.controlnet_end,
      loraWeights: body.lora_weights,
      loraScale: body.lora_scale,
      width: body.width,
      height: body.height,
      seed: body.seed,
    });

    res.json({
      success: true,
      message: 'ControlNet 이미지 생성 완료',
      category,
      style,
      generated_image: {
        base64: result.image,
        mime_type: 'image/png',
      },
      lineart_image: {
        base64: result.lineartImage,
        mime_type: 'image/png',
      },
      prompt: result.prompt,
      metadata: result.metadata,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
