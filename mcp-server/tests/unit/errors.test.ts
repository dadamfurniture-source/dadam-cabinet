// ═══════════════════════════════════════════════════════════════
// Error Classes - Unit Tests
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  ExternalApiError,
  TimeoutError,
  NotFoundError,
  RateLimitError,
} from '../../src/utils/errors.js';

describe('AppError', () => {
  it('should create error with status code', () => {
    const err = new AppError('Test error', 500, 'TEST');

    expect(err.message).toBe('Test error');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('TEST');
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ValidationError', () => {
  it('should have 400 status code', () => {
    const err = new ValidationError('Invalid input');

    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('should include field name when provided', () => {
    const err = new ValidationError('must be a string', 'category');

    expect(err.message).toContain('category');
  });
});

describe('ExternalApiError', () => {
  it('should have 502 status code', () => {
    const err = new ExternalApiError('gemini', 'connection refused');

    expect(err.statusCode).toBe(502);
    expect(err.service).toBe('gemini');
    expect(err.message).toContain('gemini');
  });

  it('should include original status', () => {
    const err = new ExternalApiError('supabase', 'not found', 404);

    expect(err.originalStatus).toBe(404);
  });
});

describe('TimeoutError', () => {
  it('should have 504 status code', () => {
    const err = new TimeoutError('gemini', 120000);

    expect(err.statusCode).toBe(504);
    expect(err.service).toBe('gemini');
    expect(err.timeoutMs).toBe(120000);
    expect(err.message).toContain('120000ms');
  });
});

describe('NotFoundError', () => {
  it('should have 404 status code', () => {
    const err = new NotFoundError('Image');

    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('Image');
  });
});

describe('RateLimitError', () => {
  it('should have 429 status code', () => {
    const err = new RateLimitError();

    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('RATE_LIMIT');
  });
});
