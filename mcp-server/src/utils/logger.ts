// ═══════════════════════════════════════════════════════════════
// Structured Logger - pino 기반 구조화 로깅
// ═══════════════════════════════════════════════════════════════

import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
});

// 서비스별 child logger 생성
export function createLogger(module: string) {
  return logger.child({ module });
}
