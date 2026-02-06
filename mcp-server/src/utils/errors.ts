// ═══════════════════════════════════════════════════════════════
// Error Classes - 구조화된 에러 계층
// ═══════════════════════════════════════════════════════════════

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super(
      field ? `Validation failed for '${field}': ${message}` : message,
      400,
      'VALIDATION_ERROR',
    );
  }
}

export class ExternalApiError extends AppError {
  public readonly service: string;
  public readonly originalStatus?: number;

  constructor(service: string, message: string, originalStatus?: number) {
    super(`${service} API error: ${message}`, 502, 'EXTERNAL_API_ERROR');
    this.service = service;
    this.originalStatus = originalStatus;
  }
}

export class TimeoutError extends AppError {
  public readonly service: string;
  public readonly timeoutMs: number;

  constructor(service: string, timeoutMs: number) {
    super(`${service} timed out after ${timeoutMs}ms`, 504, 'TIMEOUT_ERROR');
    this.service = service;
    this.timeoutMs = timeoutMs;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT');
  }
}
