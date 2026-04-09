// ═══════════════════════════════════════════════════════════════
// Sink HITL Route — 학습 + 피드백 + AI 설계 API
// POST /api/sink-hitl/generate          — 랜덤 설계 생성
// POST /api/sink-hitl/generate-ai       — AI(Claude) 설계 생성
// POST /api/sink-hitl/save-correction   — pair 저장
// POST /api/sink-hitl/mine-rules        — 규칙 마이닝
// GET  /api/sink-hitl/stats             — 통계
// GET  /api/sink-hitl/pairs             — pair 목록
// GET  /api/sink-hitl/rules             — 학습된 규칙 목록
// GET  /api/sink-hitl/feedback-summary  — 피드백 대시보드
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import {
  GenerateRequestSchema,
  SaveCorrectionRequestSchema,
  SinkEnvSchema,
} from '../schemas/sink-hitl.schemas.js';
import { generateRandomSinkDesign } from '../services/sink-hitl-random.service.js';
import { generateAIDesign } from '../services/sink-hitl-ai-design.service.js';
import { computeSinkDiff } from '../services/sink-hitl-diff.service.js';
import {
  saveCase,
  savePair,
  getStats,
  newPairId,
  listPairs,
  getPairCount,
  getAllRules,
} from '../services/sink-hitl-storage.service.js';
import { mineRules, getFeedbackSummary } from '../services/sink-hitl-rule-mining.service.js';

const log = createLogger('route:sink-hitl');
const router = Router();

// ─── POST /api/sink-hitl/generate (랜덤) ───
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

// ─── POST /api/sink-hitl/generate-ai (AI 설계) ───
router.post('/api/sink-hitl/generate-ai', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = SinkEnvSchema.safeParse(req.body.env ?? req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const design = await generateAIDesign(parsed.data);
    await saveCase(design);
    log.info(
      { id: design.id, generated_by: design.meta.generated_by, lower: design.lower.length, upper: design.upper.length },
      'sink-hitl AI generated',
    );
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

    // 1. corrected case 저장
    await saveCase({
      ...corrected,
      meta: { ...corrected.meta, generated_by: 'human-correction', parent_id: generated.id },
    });

    // 2. pair 저장
    await savePair(pair);

    log.info({ pair_id: pair.pair_id, diff_count: diffs.length, rating }, 'sink-hitl pair saved');

    // 3. 자동 규칙 마이닝 (pair 10개 이상이면)
    let autoMined = false;
    try {
      const pairCount = await getPairCount();
      if (pairCount >= 10 && pairCount % 5 === 0) {
        // 매 5개 pair마다 규칙 갱신
        log.info({ pairCount }, 'Auto-triggering rule mining');
        await mineRules();
        autoMined = true;
      }
    } catch (mineErr) {
      log.warn({ error: mineErr }, 'Auto rule mining failed (non-critical)');
    }

    res.json({
      success: true,
      pair_id: pair.pair_id,
      diff_count: diffs.length,
      auto_mined: autoMined,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/sink-hitl/mine-rules ───
router.post('/api/sink-hitl/mine-rules', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await mineRules();
    res.json({ success: true, ...result });
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
    const pairs = await listPairs(limit);
    const items = pairs
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
    res.json({ success: true, total: pairs.length, items });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/sink-hitl/rules ───
router.get('/api/sink-hitl/rules', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rules = await getAllRules();
    res.json({ success: true, total: rules.length, rules });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/sink-hitl/feedback-summary ───
router.get('/api/sink-hitl/feedback-summary', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await getFeedbackSummary();
    res.json({ success: true, ...summary });
  } catch (e) {
    next(e);
  }
});

export default router;
