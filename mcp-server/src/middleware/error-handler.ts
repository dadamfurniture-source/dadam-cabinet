// ═══════════════════════════════════════════════════════════════
// Error Handler Middleware - AppError → HTTP 상태 코드 매핑
// ═══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('error-handler');

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    log.warn({
      code: err.code,
      status: err.statusCode,
      message: err.message,
    }, 'Operational error');

    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
    return;
  }

  // 예상치 못한 에러
  log.error({ err }, 'Unexpected error');

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}
