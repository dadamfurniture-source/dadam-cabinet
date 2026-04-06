// ═══════════════════════════════════════════════════════════════
// Sink HITL Route — Phase 1 수집 API
// POST /api/sink-hitl/generate
// POST /api/sink-hitl/save-correction
// GET  /api/sink-hitl/stats
// GET  /api/sink-hitl/pairs
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import {
  GenerateRequestSchema,
  SaveCorrectionRequestSchema,
} from '../schemas/sink-hitl.schemas.js';
import { generateRandomSinkDesign } from '../services/sink-hitl-random.service.js';
import { computeSinkDiff } from '../services/sink-hitl-diff.service.js';
import {
  saveCase,
  savePair,
  getStats,
  newPairId,
  listPairs,
} from '../services/sink-hitl-storage.service.js';

const log = createLogger('route:sink-hitl');
const router = Router();

// ─── POST /api/sink-hitl/generate ───
router.post('/api/sink-hitl/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = GenerateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const design = generateRandomSinkDesign(parsed.data.env, parsed.data.seed);
    await saveCase(design);
    log.info({ id: design.id, lower: design.lower.length, upper: design.upper.length }, 'sink-hitl random generated');
    res.json({ success: true, design });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/sink-hitl/save-correction ───
router.post('/api/sink-hitl/save-correction', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = SaveCorrectionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const { generated, corrected, rating, comment } = parsed.data;
    const diffs = computeSinkDiff(generated, corrected);
    const pair = {
      pair_id: newPairId(),
      timestamp: new Date().toISOString(),
      generated,
      corrected,
      diffs,
      rating,
      comment,
    };
    const filepath = await savePair(pair);
    await saveCase({
      ...corrected,
      meta: { ...corrected.meta, generated_by: 'human-correction', parent_id: generated.id },
    });
    log.info({ pair_id: pair.pair_id, diff_count: diffs.length, rating }, 'sink-hitl pair saved');
    res.json({ success: true, pair_id: pair.pair_id, diff_count: diffs.length, filepath });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/sink-hitl/stats ───
router.get('/api/sink-hitl/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getStats();
    res.json({ success: true, ...stats });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/sink-hitl/pairs ───
router.get('/api/sink-hitl/pairs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const pairs = await listPairs();
    const items = pairs
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
    res.json({ success: true, total: pairs.length, items });
  } catch (e) {
    next(e);
  }
});

export default router;
