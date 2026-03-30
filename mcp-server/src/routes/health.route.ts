// ═══════════════════════════════════════════════════════════════
// Health Check Route - 프로덕션 모니터링용
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import { getCircuitBreakerStatus } from '../clients/base-http.client.js';
import { getSessionCount } from '../agent/session-store.js';

const router = Router();
const startedAt = Date.now();

router.get('/health', (_req, res) => {
  const circuitBreakers = getCircuitBreakerStatus();
  const memUsage = process.memoryUsage();

  res.json({
    status: 'ok',
    server: 'dadam-api',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    memory: {
      rss_mb: Math.round(memUsage.rss / 1024 / 1024),
      heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
    },
    active_sessions: getSessionCount(),
    dependencies: circuitBreakers,
  });
});

export default router;
