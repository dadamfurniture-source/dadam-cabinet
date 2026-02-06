// ═══════════════════════════════════════════════════════════════
// Request Logger Middleware - 요청 로깅
// ═══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';

const log = createLogger('http');

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    log.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
    }, `${req.method} ${req.path}`);
  });

  next();
}
