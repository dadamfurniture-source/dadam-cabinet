// ═══════════════════════════════════════════════════════════════
// LoRA Training Routes
// ───────────────────────────────────────────────────────────────
// admin/gallery.html 에서 호출:
//   POST /api/lora/train      { category }   → 학습 시작 (관리자 전용)
//   GET  /api/lora/status?id=...             → 학습 진행 상태
//   GET  /api/lora/list?category=...         → 카테고리별 학습 모델 목록
//
// 학습은 백그라운드에서 폴링되며, 응답은 즉시 trainingId 반환.
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  startTrainingForCategory,
  listLoraModels,
  getLoraStatus,
} from '../services/lora-training.service.js';
import { ValidationError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('lora-route');
const router = Router();

const StartTrainingBody = z.object({
  category: z.string().min(1),
  steps: z.number().int().min(500).max(2500).optional(),
  resolution: z.union([z.literal(512), z.literal(768), z.literal(1024)]).optional(),
});

router.post('/api/lora/train', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = StartTrainingBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
    }
    if (!req.supabaseToken) throw new ValidationError('user token missing');

    log.info({ userId: req.user?.id, category: parsed.data.category }, '/api/lora/train');
    const result = await startTrainingForCategory(req.supabaseToken, parsed.data.category, {
      steps: parsed.data.steps,
      resolution: parsed.data.resolution,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

router.get('/api/lora/status', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.query.id || '');
    if (!id) throw new ValidationError('id required');
    if (!req.supabaseToken) throw new ValidationError('user token missing');

    const row = await getLoraStatus(req.supabaseToken, id);
    if (!row) {
      res.status(404).json({ success: false, error: 'not found' });
      return;
    }
    res.json({ success: true, data: row });
  } catch (e) {
    next(e);
  }
});

router.get('/api/lora/list', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const category = req.query.category ? String(req.query.category) : undefined;
    if (!req.supabaseToken) throw new ValidationError('user token missing');

    const rows = await listLoraModels(req.supabaseToken, category);
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

export default router;
