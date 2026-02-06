// ═══════════════════════════════════════════════════════════════
// Design-to-Image Route
// POST /webhook/design-to-image
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { validateCategory } from '../middleware/input-validator.js';
import { generateDesignImage } from '../services/image-generation.service.js';

const log = createLogger('route:design-to-image');
const router = Router();

router.post('/webhook/design-to-image', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    const designData = body.design_data || body;
    const items = body.items || designData.items || [];
    const style = body.style || body.design_style || 'modern minimal';
    const category = validateCategory(body.category || items[0]?.categoryId);
    const cabinetSpecs = body.cabinet_specs || {};

    log.info({ category, style }, 'Processing design-to-image request');

    const image = await generateDesignImage(category, style, cabinetSpecs, items);

    res.json({
      success: true,
      message: '이미지 생성 완료',
      category,
      style,
      generated_image: {
        base64: image,
        mime_type: 'image/png',
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
