// ═══════════════════════════════════════════════════════════════
// Base HTTP Client - 재시도, 서킷브레이커, 타임아웃
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { ExternalApiError, TimeoutError } from '../utils/errors.js';

const log = createLogger('http-client');

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  retryableStatuses: number[];
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 30000;

const circuitBreakers = new Map<string, CircuitBreakerState>();

function getCircuitBreaker(service: string): CircuitBreakerState {
  if (!circuitBreakers.has(service)) {
    circuitBreakers.set(service, { failures: 0, lastFailure: 0, state: 'closed' });
  }
  return circuitBreakers.get(service)!;
}

function checkCircuitBreaker(service: string): void {
  const cb = getCircuitBreaker(service);

  if (cb.state === 'open') {
    if (Date.now() - cb.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
      cb.state = 'half-open';
      log.info({ service }, 'Circuit breaker half-open, allowing test request');
    } else {
      throw new ExternalApiError(service, 'Circuit breaker is open - service unavailable');
    }
  }
}

function recordSuccess(service: string): void {
  const cb = getCircuitBreaker(service);
  cb.failures = 0;
  cb.state = 'closed';
}

function recordFailure(service: string): void {
  const cb = getCircuitBreaker(service);
  cb.failures++;
  cb.lastFailure = Date.now();

  if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    cb.state = 'open';
    log.warn({ service, failures: cb.failures }, 'Circuit breaker opened');
  }
}

export async function fetchWithRetry(
  service: string,
  url: string,
  options: RequestInit & { timeout?: number },
  retryConfig: Partial<RetryConfig> = {}
): Promise<Response> {
  const config = { ...DEFAULT_RETRY, ...retryConfig };
  const timeout = options.timeout || 30000;

  checkCircuitBreaker(service);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(config.baseDelay * Math.pow(2, attempt - 1), config.maxDelay);
        const jitter = delay * (0.5 + Math.random() * 0.5);
        log.info({ service, attempt, delay: Math.round(jitter) }, 'Retrying request');
        await sleep(jitter);
      }

      const { timeout: _, ...fetchOptions } = options;
      const response = await fetch(url, {
        ...fetchOptions,
        signal: AbortSignal.timeout(timeout),
      });

      if (response.ok) {
        recordSuccess(service);
        return response;
      }

      if (config.retryableStatuses.includes(response.status) && attempt < config.maxRetries) {
        const errorText = await response.text().catch(() => 'unknown');
        log.warn({ service, status: response.status, attempt, errorText: errorText.substring(0, 200) }, 'Retryable error');
        lastError = new ExternalApiError(service, `HTTP ${response.status}: ${errorText.substring(0, 200)}`, response.status);
        recordFailure(service);
        continue;
      }

      // Non-retryable error
      const errorText = await response.text().catch(() => 'unknown');
      recordFailure(service);
      throw new ExternalApiError(service, `HTTP ${response.status}: ${errorText.substring(0, 500)}`, response.status);

    } catch (error) {
      if (error instanceof ExternalApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        lastError = new TimeoutError(service, timeout);
        recordFailure(service);
        if (attempt < config.maxRetries) continue;
        throw lastError;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      recordFailure(service);
      if (attempt < config.maxRetries) continue;
    }
  }

  throw lastError || new ExternalApiError(service, 'All retries exhausted');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 서킷브레이커 상태 조회 (헬스체크용)
export function getCircuitBreakerStatus(): Record<string, CircuitBreakerState> {
  const status: Record<string, CircuitBreakerState> = {};
  for (const [service, state] of circuitBreakers.entries()) {
    status[service] = { ...state };
  }
  return status;
}
