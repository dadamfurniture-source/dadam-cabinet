// ═══════════════════════════════════════════════════════════════
// Security Headers Middleware - 보안 HTTP 헤더 설정
// ═══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // 브라우저 MIME 스니핑 방지
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 클릭재킹 방지
  res.setHeader('X-Frame-Options', 'DENY');

  // XSS 필터 활성화
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // 서버 정보 은닉
  res.removeHeader('X-Powered-By');

  // Referrer 정보 최소화
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // HTTPS 강제 (프로덕션)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}
