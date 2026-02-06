// ═══════════════════════════════════════════════════════════════
// Health Check Route
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import { getCircuitBreakerStatus } from '../clients/base-http.client.js';

const router = Router();

router.get('/health', (_req, res) => {
  const circuitBreakers = getCircuitBreakerStatus();

  res.json({
    status: 'ok',
    server: 'dadam-api',
    timestamp: new Date().toISOString(),
    dependencies: circuitBreakers,
  });
});

export default router;
