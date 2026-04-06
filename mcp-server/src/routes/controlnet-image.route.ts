// ═══════════════════════════════════════════════════════════════
// ControlNet Image Route
// POST /webhook/controlnet-image
// 도면 데이터 기반 ControlNet 이미지 생성
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { validateCategory } from '../middleware/input-validator.js';
import { generateRateLimit } from '../middleware/rate-limiter.js';
import { generateWithAutoLora, generateABTest } from '../services/controlnet-generation.service.js';
import type { ControlNetType } from '../clients/replicate.client.js';
import type { KitchenLayoutType } from '../types/index.js';

const log = createLogger('route:controlnet-image');
const router = Router();

router.post('/webhook/controlnet-image', generateRateLimit, async (req: Request, res: Response, next: NextFunction) => {
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

    const inputParams = {
      designData,
      category,
      style,
      kitchenLayout: body.kitchen_layout as KitchenLayoutType | undefined,
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
      enableVerification: body.enable_verification ?? false,
      verificationThreshold: body.verification_threshold,
      maxRetries: body.max_retries,
    };

    // LoRA 자동 매칭 포함 생성
    const result = await generateWithAutoLora(inputParams);

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
      verification: result.verification || null,
      metadata: result.metadata,
    });
  } catch (error) {
    next(error);
  }
});

// ─── A/B 테스트: ControlNet vs Gemini 비교 ───
router.post('/webhook/controlnet-abtest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    const designData = body.design_data;
    const category = validateCategory(body.category);
    const style = body.style || 'modern';

    if (!designData) {
      res.status(400).json({ success: false, error: 'design_data is required' });
      return;
    }

    log.info({ category, style }, 'Processing A/B test request');

    const result = await generateABTest({
      designData,
      category,
      style,
      kitchenLayout: body.kitchen_layout as KitchenLayoutType | undefined,
      materialCode: body.material_code,
      additionalPrompt: body.additional_prompt,
      backgroundImage: body.background_image,
      controlNetType: (body.controlnet_type || 'lineart') as ControlNetType,
      controlNetStrength: body.controlnet_strength,
      width: body.width,
      height: body.height,
      seed: body.seed,
    });

    res.json({
      success: true,
      message: 'A/B 테스트 완료',
      controlnet: {
        image: { base64: result.controlnet.image, mime_type: 'image/png' },
        lineart: { base64: result.controlnet.lineartImage, mime_type: 'image/png' },
        prompt: result.controlnet.prompt,
        metadata: result.controlnet.metadata,
      },
      gemini: result.gemini ? {
        image: { base64: result.gemini.image, mime_type: 'image/png' },
        prompt: result.gemini.prompt,
      } : null,
      comparison: result.comparison,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
