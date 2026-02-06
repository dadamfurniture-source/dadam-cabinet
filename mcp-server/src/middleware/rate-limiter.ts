// ═══════════════════════════════════════════════════════════════
// Rate Limiter Middleware - 요청 빈도 제한
// ═══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';
import { RateLimitError } from '../utils/errors.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

export function rateLimit(name: string, maxRequests: number, windowMs: number) {
  if (!stores.has(name)) {
    stores.set(name, new Map());
  }
  const store = stores.get(name)!;

  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();

    const entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count++;

    if (entry.count > maxRequests) {
      next(new RateLimitError(`Rate limit exceeded: ${maxRequests} requests per ${windowMs / 1000}s`));
      return;
    }

    next();
  };
}

// 사전 정의된 리미터
export const interiorRateLimit = rateLimit('interior', 5, 60000);    // 5 req/min
export const chatRateLimit = rateLimit('chat', 20, 60000);           // 20 req/min
export const themeRateLimit = rateLimit('theme', 10, 60000);         // 10 req/min
