// ═══════════════════════════════════════════════════════════════
// SketchUp Route — POST /api/sketchup/build, GET /api/sketchup/ping
//
// W3-2: 디자이너 PC 의 mhyrr/sketchup-mcp 확장으로 CabinetPart 배열을
// 빌드하는 HTTP 진입점. MCP 도구 build_sketchup_scene 과 동일한
// zod 스키마를 공유하며, 빌드 코어 로직(builder/bridge)을 그대로 호출.
//
// 보안:
//   - requireAuth (JWT) — 모든 라우트
//   - sketchupRateLimit (5/min) — 디자이너 인터랙티브 빌드 빈도 기준
//   - host 기본값 127.0.0.1 — 의도하지 않은 외부 노출 방지
//   - eval_ruby allowlist 는 builder 의 evalRubySafe 가 유일 게이트웨이
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { sketchupRateLimit } from '../middleware/rate-limiter.js';
import { buildPlanFromParts } from '../services/sketchup-builder.service.js';
import { sendBatch, pingSketchup } from '../services/sketchup-mcp-bridge.service.js';
import { sketchupBuildSchema } from '../schemas/sketchup.schema.js';
import { createLogger } from '../utils/logger.js';
import { AppError, ValidationError } from '../utils/errors.js';
import type { CabinetPart } from '../types/planner.types.js';

const log = createLogger('route:sketchup');
const router = Router();

// ───────────────────────────────────────────────────────────────
// GET /api/sketchup/ping — mhyrr 확장 가용성 확인
// ───────────────────────────────────────────────────────────────

router.get(
  '/api/sketchup/ping',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const host = typeof req.query.host === 'string' ? req.query.host : undefined;
      const port = typeof req.query.port === 'string' ? Number(req.query.port) : undefined;
      const timeoutMs = typeof req.query.timeoutMs === 'string' ? Number(req.query.timeoutMs) : 3000;

      const start = Date.now();
      const probe = await pingSketchup({ host, port, timeoutMs });
      const rttMs = Date.now() - start;

      if (probe.ok) {
        res.status(200).json({
          ok: true,
          host: host ?? '127.0.0.1',
          port: port ?? 9876,
          rttMs,
        });
      } else {
        res.status(503).json({
          ok: false,
          error: probe.error?.message ?? 'SketchUp bridge unavailable',
          host: host ?? '127.0.0.1',
          port: port ?? 9876,
        });
      }
    } catch (e) {
      next(e);
    }
  },
);

// ───────────────────────────────────────────────────────────────
// POST /api/sketchup/build — 동기 빌드 (BatchSummary 반환)
// ───────────────────────────────────────────────────────────────

router.post(
  '/api/sketchup/build',
  requireAuth,
  sketchupRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. zod 입력 검증
      const parsed = sketchupBuildSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.message);
      }
      const input = parsed.data;

      // 2. (옵션) mhyrr 가용성 사전 확인
      if (input.ping) {
        const probe = await pingSketchup({
          host: input.host,
          port: input.port,
          timeoutMs: input.timeoutMs ?? 3000,
        });
        if (!probe.ok) {
          throw new AppError(
            `SketchUp bridge unavailable: ${probe.error?.message ?? 'unknown'}. mhyrr/sketchup-mcp extension running on ${input.host ?? '127.0.0.1'}:${input.port ?? 9876}?`,
            503,
            'SKETCHUP_UNAVAILABLE',
          );
        }
      }

      // 3. 빌드 명령 시퀀스 생성
      const plan = buildPlanFromParts(input.parts as CabinetPart[], {
        category: input.category,
        materialTone: input.materialTone,
        clearExisting: input.clearExisting,
        transactional: input.transactional,
      });

      if (plan.componentCount === 0) {
        throw new ValidationError(
          'No buildable parts after filtering (wireframe / essential=false / zero-dim)',
        );
      }

      // 4. 단일 TCP 연결로 순차 전송
      const batch = await sendBatch(plan.commands, {
        host: input.host,
        port: input.port,
        timeoutMs: input.timeoutMs,
        autoAbortOnFailure: input.transactional,
        stopOnFirstFailure: input.transactional,
      });

      const summary = {
        totalSent: batch.totalSent,
        successCount: batch.successCount,
        failures: batch.failures,
        durationMs: batch.durationMs,
        averageRttMs: batch.averageRttMs,
        aborted: batch.aborted,
      };

      log.info(
        {
          userId: req.user?.id,
          category: input.category,
          componentCount: plan.componentCount,
          summary,
        },
        'sketchup build request complete',
      );

      // 5. 빌드 중 실패 → 502 (요약 동봉)
      if (batch.failures.length > 0) {
        const firstFail = batch.failures[0];
        throw new AppError(
          `SketchUp build failed at command ${firstFail.index}: ${firstFail.error.message}`,
          502,
          'SKETCHUP_BUILD_FAILED',
        );
      }

      res.status(200).json({
        success: true,
        category: input.category,
        materialTone: input.materialTone,
        componentCount: plan.componentCount,
        transactional: input.transactional,
        clearExisting: input.clearExisting,
        summary,
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
