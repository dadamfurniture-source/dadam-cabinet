// ═══════════════════════════════════════════════════════════════
// CORS Configuration Middleware - 환경별 CORS 설정
// ═══════════════════════════════════════════════════════════════

import cors from 'cors';

const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : null; // null = 전체 허용 (개발용)

export const corsMiddleware = cors({
  origin: ALLOWED_ORIGINS || true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
});
