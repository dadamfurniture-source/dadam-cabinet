// ═══════════════════════════════════════════════════════════════
// Auth Middleware - Supabase JWT 검증 (GoTrue API)
// ═══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';
import { getConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { AuthenticationError } from '../utils/errors.js';
import type { AuthUser } from '../types/index.js';

const log = createLogger('auth');

// Express Request에 user/supabaseToken 추가
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      supabaseToken?: string;
    }
  }
}

/**
 * GoTrue API로 Supabase JWT를 검증하고 사용자 정보를 반환
 */
async function verifySupabaseToken(token: string): Promise<AuthUser> {
  const config = getConfig();

  const response = await fetch(`${config.supabase.url}/auth/v1/user`, {
    headers: {
      'apikey': config.supabase.anonKey,
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    log.warn({ status: response.status, error: errorText }, 'Token verification failed');
    throw new AuthenticationError('Invalid or expired token');
  }

  const userData = await response.json() as {
    id: string;
    email?: string;
    role?: string;
  };

  return {
    id: userData.id,
    email: userData.email || '',
    role: userData.role || 'authenticated',
  };
}

/**
 * Bearer 토큰을 Authorization 헤더에서 추출
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

/**
 * 인증 필수 미들웨어 — 토큰 없거나 무효하면 401
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new AuthenticationError('Authorization header required');
    }

    req.user = await verifySupabaseToken(token);
    req.supabaseToken = token;
    log.debug({ userId: req.user.id }, 'Authenticated');
    next();
  } catch (error) {
    next(error instanceof AuthenticationError ? error : new AuthenticationError());
  }
}

/**
 * 인증 선택 미들웨어 — 토큰 있으면 검증, 없으면 anonymous 통과
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (token) {
      req.user = await verifySupabaseToken(token);
      req.supabaseToken = token;
      log.debug({ userId: req.user.id }, 'Authenticated (optional)');
    }
    next();
  } catch {
    // 토큰 무효해도 anonymous로 통과
    next();
  }
}

