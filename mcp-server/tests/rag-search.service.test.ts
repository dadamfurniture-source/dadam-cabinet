import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/clients/supabase.client.js', () => ({
  searchRagRules: vi.fn(),
}));

vi.mock('../src/cache/rag-cache.js', () => ({
  getCachedRagResults: vi.fn(() => null),
  setCachedRagResults: vi.fn(),
}));

import { searchAndClassifyRules } from '../src/services/rag-search.service.js';
import { searchRagRules } from '../src/clients/supabase.client.js';
import { getCachedRagResults, setCachedRagResults } from '../src/cache/rag-cache.js';

const mockSearch = vi.mocked(searchRagRules);
const mockGetCache = vi.mocked(getCachedRagResults);
const mockSetCache = vi.mocked(setCachedRagResults);

describe('searchAndClassifyRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCache.mockReturnValue(null);
  });

  it('returns classified rules on successful search', async () => {
    const mockRules = [
      { id: '1', rule_type: 'background' as const, content: 'Clean walls' },
      { id: '2', rule_type: 'module' as const, content: 'Standard 600mm' },
    ];
    mockSearch.mockResolvedValue(mockRules);

    const result = await searchAndClassifyRules('sink', 'modern');

    expect(result.rules).toEqual(mockRules);
    expect(result.triggers.length).toBeGreaterThan(0);
    expect(result.classified).toBeDefined();
    expect(mockSetCache).toHaveBeenCalledOnce();
  });

  it('returns cached results when available', async () => {
    const cachedRules = [
      { id: '1', rule_type: 'material' as const, content: 'White matte' },
    ];
    mockGetCache.mockReturnValue(cachedRules);

    const result = await searchAndClassifyRules('sink', 'modern');

    expect(result.rules).toEqual(cachedRules);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('returns empty rules when search fails', async () => {
    mockSearch.mockRejectedValue(new Error('DB connection failed'));

    const result = await searchAndClassifyRules('sink', 'modern');

    expect(result.rules).toEqual([]);
    expect(result.classified).toBeDefined();
  });

  it('throws ValidationError for empty category', async () => {
    await expect(searchAndClassifyRules('', 'modern'))
      .rejects.toThrow('카테고리가 비어있습니다');
  });

  it('throws ValidationError for empty style', async () => {
    await expect(searchAndClassifyRules('sink', ''))
      .rejects.toThrow('스타일이 비어있습니다');
  });

  it('passes limit to search function', async () => {
    mockSearch.mockResolvedValue([]);

    await searchAndClassifyRules('sink', 'modern', 10);

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ limit_count: 10 }),
    );
  });
});
