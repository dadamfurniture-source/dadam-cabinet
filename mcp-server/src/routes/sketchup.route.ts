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
import { MHYRR_TOOLS } from '../constants/sketchup.js';

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

      // 3. 빌드 명령 시퀀스 생성 (W4-4: V2 only, W4-5: applyRotation/applyMaterial 옵션)
      const plan = buildPlanFromParts(input.parts, {
        category: input.category,
        materialTone: input.materialTone,
        clearExisting: input.clearExisting,
        transactional: input.transactional,
        applyRotation: input.applyRotation,
        applyMaterial: input.applyMaterial,
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

// ───────────────────────────────────────────────────────────────
// POST /api/sketchup/build/stream — SSE 진행률 스트림 (W3-3)
//
// 이벤트 6종:
//   build_started: { componentCount, transactional, clearExisting }
//   command_sent:  { index, tool, name? }
//   command_ack:   { index, ok, durationMs, error? }
//   aborted:       { failedIndex, reason }
//   complete:      BatchSummary
//   error:         { code, message }
//
// 클라이언트 단절 처리:
//   req.on('close') → AbortController.abort() → sendBatch 가 다음 명령 전에
//   ABORT_OP 발사 후 종료. 트랜잭션은 SketchUp 측에서 깔끔히 롤백.
// ───────────────────────────────────────────────────────────────

interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

router.post(
  '/api/sketchup/build/stream',
  requireAuth,
  sketchupRateLimit,
  async (req: Request, res: Response, _next: NextFunction) => {
    // 1. zod 입력 검증 — SSE 헤더 보내기 전이라 4xx 응답 가능
    const parsed = sketchupBuildSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: parsed.error.message,
        code: 'VALIDATION_ERROR',
      });
      return;
    }
    const input = parsed.data;

    // 2. SSE 헤더 (agent/chat 패턴 일치)
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendSSE = (event: SSEEvent) => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      } catch {
        // 클라이언트 단절 — 무시
      }
    };

    // 3. 클라이언트 단절 → AbortController 로 sendBatch 에 cancel 전파
    // Express 5: req 'close' 는 request body 소비 완료 직후 발화하므로
    // SSE 같은 long-lived 응답에서는 부적합. res 'close' 가 실제 응답 stream 종료
    // 시점(정상 res.end() 또는 클라이언트 단절)에 발화하므로, mainDone 플래그로
    // 정상 종료 케이스만 추가 가드.
    const ac = new AbortController();
    let mainDone = false;
    const onResClose = () => {
      if (!mainDone) ac.abort();
    };
    res.once('close', onResClose);

    try {
      // 4. (옵션) ping
      if (input.ping) {
        const probe = await pingSketchup({
          host: input.host,
          port: input.port,
          timeoutMs: input.timeoutMs ?? 3000,
        });
        if (!probe.ok) {
          sendSSE({
            event: 'error',
            data: {
              code: 'SKETCHUP_UNAVAILABLE',
              message: probe.error?.message ?? 'SketchUp bridge unavailable',
            },
          });
          return;
        }
      }

      // 5. 빌드 명령 시퀀스 (W4-4: V2 only, W4-5: applyRotation/applyMaterial 옵션)
      const plan = buildPlanFromParts(input.parts, {
        category: input.category,
        materialTone: input.materialTone,
        clearExisting: input.clearExisting,
        transactional: input.transactional,
        applyRotation: input.applyRotation,
        applyMaterial: input.applyMaterial,
      });

      if (plan.componentCount === 0) {
        sendSSE({
          event: 'error',
          data: {
            code: 'VALIDATION_ERROR',
            message: 'No buildable parts after filtering (wireframe / essential=false / zero-dim)',
          },
        });
        return;
      }

      sendSSE({
        event: 'build_started',
        data: {
          componentCount: plan.componentCount,
          transactional: input.transactional,
          clearExisting: input.clearExisting,
        },
      });

      // 6. sendBatch + progress 콜백 → SSE 이벤트로 변환
      let abortedEmitted = false;
      const batch = await sendBatch(
        plan.commands,
        {
          host: input.host,
          port: input.port,
          timeoutMs: input.timeoutMs,
          autoAbortOnFailure: input.transactional,
          stopOnFirstFailure: input.transactional,
          signal: ac.signal,
          emitMetrics: true,
        },
        {
          onSent: (index, cmd) => {
            const name =
              cmd.tool === MHYRR_TOOLS.CREATE_COMPONENT
                ? (cmd.arguments.name as string | undefined) ?? null
                : null;
            sendSSE({ event: 'command_sent', data: { index, tool: cmd.tool, name } });
          },
          onResult: (index, result, durationMs) => {
            sendSSE({
              event: 'command_ack',
              data: {
                index,
                ok: result.ok,
                durationMs,
                error: result.ok ? undefined : result.error,
              },
            });
            // 실패 시 (autoAbort 가 발동되는 케이스) — aborted 이벤트 1회만
            if (!result.ok && input.transactional && !abortedEmitted) {
              abortedEmitted = true;
              sendSSE({
                event: 'aborted',
                data: {
                  failedIndex: index,
                  reason: result.error?.message ?? 'command failed',
                },
              });
            }
          },
        },
      );

      // 7. 클라이언트 cancel 케이스 — aborted 이벤트 + 종료
      if (ac.signal.aborted && !abortedEmitted) {
        sendSSE({
          event: 'aborted',
          data: { failedIndex: -1, reason: 'client_disconnect' },
        });
      }

      sendSSE({
        event: 'complete',
        data: {
          totalSent: batch.totalSent,
          successCount: batch.successCount,
          failures: batch.failures,
          durationMs: batch.durationMs,
          averageRttMs: batch.averageRttMs,
          aborted: batch.aborted,
        },
      });

      log.info(
        {
          userId: req.user?.id,
          category: input.category,
          componentCount: plan.componentCount,
          successCount: batch.successCount,
          aborted: batch.aborted,
          clientAborted: ac.signal.aborted,
        },
        'sketchup build stream complete',
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error({ error: message }, 'sketchup build stream error');
      sendSSE({
        event: 'error',
        data: { code: 'SKETCHUP_INTERNAL_ERROR', message },
      });
    } finally {
      mainDone = true;
      res.off('close', onResClose);
      if (!res.writableEnded) res.end();
    }
  },
);

export default router;
