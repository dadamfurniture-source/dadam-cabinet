// ═══════════════════════════════════════════════════════════════
// Memory Cache - Unit Tests
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryCache } from '../../src/cache/memory-cache.js';

describe('MemoryCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should store and retrieve values', () => {
    const cache = new MemoryCache<string>(60000);

    cache.set('key1', 'value1');

    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for missing keys', () => {
    const cache = new MemoryCache<string>(60000);

    expect(cache.get('missing')).toBeUndefined();
  });

  it('should return undefined for expired entries', () => {
    const cache = new MemoryCache<string>(100);

    cache.set('key1', 'value1');

    // Fast-forward time
    vi.useFakeTimers();
    vi.advanceTimersByTime(200);

    expect(cache.get('key1')).toBeUndefined();

    vi.useRealTimers();
  });

  it('should check if key exists', () => {
    const cache = new MemoryCache<string>(60000);

    cache.set('key1', 'value1');

    expect(cache.has('key1')).toBe(true);
    expect(cache.has('missing')).toBe(false);
  });

  it('should delete entries', () => {
    const cache = new MemoryCache<string>(60000);

    cache.set('key1', 'value1');
    cache.delete('key1');

    expect(cache.get('key1')).toBeUndefined();
  });

  it('should clear all entries', () => {
    const cache = new MemoryCache<string>(60000);

    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });

  it('should evict oldest entry when max size reached', () => {
    const cache = new MemoryCache<string>(60000, 2);

    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3'); // Should evict key1

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBe('value2');
    expect(cache.get('key3')).toBe('value3');
  });

  it('should report correct size after eviction', () => {
    const cache = new MemoryCache<string>(60000, 5);

    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    expect(cache.size).toBe(2);
  });
});
