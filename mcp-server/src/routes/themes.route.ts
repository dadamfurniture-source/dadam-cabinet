// ═══════════════════════════════════════════════════════════════
// Themes Route - 테마 갤러리 API
// GET /api/themes/images, POST /api/themes/generate
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { searchInteriorImages, getCategoryQuery } from '../clients/unsplash.client.js';
import { generateStyleColorImage } from '../services/image-generation.service.js';

const log = createLogger('route:themes');
const router = Router();

router.get('/api/themes/images', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const perPage = parseInt(req.query.per_page as string) || 20;
    const query = (req.query.query as string) || 'korean interior kitchen';
    const category = req.query.category as string;

    const searchQuery = category ? getCategoryQuery(category) : query;

    log.info({ searchQuery, page, perPage }, 'Searching theme images');

    const result = await searchInteriorImages(searchQuery, page, perPage);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api/themes/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    const style = body.style || 'modern-minimal';
    const styleKeywords = body.styleKeywords || '';
    const styleAtmosphere = body.styleAtmosphere || '';
    const colorPrompt = body.colorPrompt || 'pure white matte finish';
    const cabinetSpecs = body.cabinetSpecs || {};

    log.info({ style }, 'Generating theme-based image');

    const generatedImage = await generateStyleColorImage(
      style, styleKeywords, styleAtmosphere, colorPrompt, cabinetSpecs
    );

    res.json({
      success: true,
      generatedImage: {
        base64: generatedImage,
        mimeType: 'image/png',
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
