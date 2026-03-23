// ═══════════════════════════════════════════════════════════════
// Direct Generate Route — n8n 없이 Gemini 직접 호출
// POST /api/generate
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { generateDirect } from '../services/direct-generation.service.js';

const log = createLogger('route:generate');
const router = Router();

router.post('/api/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;

    if (!body.room_image) {
      res.status(400).json({ success: false, error: 'room_image is required' });
      return;
    }

    const result = await generateDirect({
      roomImage: body.room_image,
      imageType: body.image_type || 'image/jpeg',
      category: body.category || 'sink',
      kitchenLayout: body.kitchen_layout,
      designStyle: body.design_style || 'modern-minimal',
      styleName: body.style_name,
      styleKeywords: body.style_keywords,
      styleMoodPrompt: body.style_mood_prompt,
      styleDoorColor: body.style_door_color,
      styleDoorHex: body.style_door_hex,
      styleDoorFinish: body.style_door_finish,
      styleCountertopPrompt: body.style_countertop_prompt,
      styleHandlePrompt: body.style_handle_prompt,
      styleAccentPrompt: body.style_accent_prompt,
    });

    res.json({
      success: true,
      generated_image: {
        background: result.backgroundImage,
        closed: result.closedImage,
        open: result.openImage,
      },
      wall_analysis: result.wallAnalysis,
      prompt_used: result.prompt,
      elapsed_ms: result.elapsed,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
