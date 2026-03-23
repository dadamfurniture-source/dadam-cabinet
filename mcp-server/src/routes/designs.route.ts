// ═══════════════════════════════════════════════════════════════
// Designs Route - 디자인 CRUD API
// GET/POST/PATCH/DELETE /api/designs
// POST /api/designs/:id/items
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import {
  listDesigns, getDesign, createDesign, updateDesign, deleteDesign,
  replaceDesignItems, getDesignItems,
} from '../clients/supabase-user.client.js';
import type { DesignItemCreateInput } from '../types/index.js';

const log = createLogger('route:designs');
const router = Router();

const VALID_CATEGORIES = ['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage'];

// ─── GET /api/designs ───
router.get('/api/designs', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const designs = await listDesigns(req.supabaseToken!);
    res.json({ success: true, data: designs });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/designs/:id ───
router.get('/api/designs/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const design = await getDesign(req.supabaseToken!, req.params.id);
    const items = await getDesignItems(req.supabaseToken!, req.params.id);
    res.json({ success: true, data: { ...design, items } });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/designs ───
router.post('/api/designs', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, status, total_items, total_modules, app_version } = req.body;

    if (!name) throw new ValidationError('name is required', 'name');

    const design = await createDesign(req.supabaseToken!, {
      name,
      description: description || null,
      status: status || 'draft',
      total_items: total_items || 0,
      total_modules: total_modules || 0,
      app_version: app_version || null,
      user_id: req.user!.id,
    });

    log.info({ designId: design.id, userId: req.user!.id }, 'Design created');
    res.status(201).json({ success: true, data: design });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/designs/:id ───
router.patch('/api/designs/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const { name, description, status, total_items, total_modules, estimated_price, final_price, customer_satisfaction, app_version } = req.body;

    const updateInput: Record<string, unknown> = {};
    if (name !== undefined) updateInput.name = name;
    if (description !== undefined) updateInput.description = description;
    if (status !== undefined) updateInput.status = status;
    if (total_items !== undefined) updateInput.total_items = total_items;
    if (total_modules !== undefined) updateInput.total_modules = total_modules;
    if (estimated_price !== undefined) updateInput.estimated_price = estimated_price;
    if (final_price !== undefined) updateInput.final_price = final_price;
    if (customer_satisfaction !== undefined) updateInput.customer_satisfaction = customer_satisfaction;
    if (app_version !== undefined) updateInput.app_version = app_version;

    const design = await updateDesign(req.supabaseToken!, req.params.id, updateInput);
    log.info({ designId: design.id }, 'Design updated');
    res.json({ success: true, data: design });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /api/designs/:id ───
router.delete('/api/designs/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    await deleteDesign(req.supabaseToken!, req.params.id);
    log.info({ designId: req.params.id }, 'Design deleted');
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/designs/:id/items (전체 교체) ───
router.post('/api/designs/:id/items', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      throw new ValidationError('items must be an array', 'items');
    }

    // 각 item에 category 필수
    for (const item of items) {
      if (!item.category || !VALID_CATEGORIES.includes(item.category)) {
        throw new ValidationError(`item category must be one of: ${VALID_CATEGORIES.join(', ')}`, 'category');
      }
    }

    const result = await replaceDesignItems(req.supabaseToken!, req.params.id, items as DesignItemCreateInput[]);
    log.info({ designId: req.params.id, count: result.length }, 'Design items replaced');
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
