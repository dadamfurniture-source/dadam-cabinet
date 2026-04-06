// ═══════════════════════════════════════════════════════════════
// Tool Adapter - Unit Tests (서비스 레이어 mock)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentSession } from '../../src/agent/types.js';

// 서비스 레이어 mock
vi.mock('../../src/services/wall-analysis.service.js', () => ({
  analyzeWall: vi.fn().mockResolvedValue({
    wall_width_mm: 3000,
    wall_height_mm: 2400,
    tile_type: 'white',
    confidence: 0.9,
    water_pipe_x: 500,
    exhaust_duct_x: null,
    gas_pipe_x: null,
    furniture_placement: { start_x: 0, end_x: 3000 },
  }),
}));

vi.mock('../../src/services/rag-search.service.js', () => ({
  searchAndClassifyRules: vi.fn().mockResolvedValue({
    rules: [{ content: 'test rule', rule_type: 'background' }],
    classified: {
      background: ['bg rule'],
      modules: ['mod rule'],
      doors: ['door rule'],
      materials: ['mat rule'],
    },
    triggers: ['sink', 'modern'],
  }),
}));

vi.mock('../../src/services/image-generation.service.js', () => ({
  generateClosedAndOpenDoorImages: vi.fn().mockResolvedValue({
    closedImage: 'base64closed',
    openImage: 'base64open',
  }),
}));

vi.mock('../../src/services/design-data.service.js', () => ({
  extractDesignData: vi.fn().mockReturnValue({
    category: 'sink',
    style: 'modern',
    wall: { width: 3000, height: 2400 },
    layout: {},
    cabinets: { upper: [{ id: 'u1' }], lower: [{ id: 'l1' }] },
    equipment: { water_pipe: {} },
    materials: { door: 'PET' },
  }),
}));

vi.mock('../../src/services/bom.service.js', () => ({
  generateBom: vi.fn().mockReturnValue({
    summary: {
      total_items: 10,
      total_panels: 5,
      total_hardware: 3,
      sheet_estimate: 2,
      categories: ['panel', 'hardware'],
    },
    items: [
      { id: 'p1', name: 'Side Panel', material: 'PB', width_mm: 600, height_mm: 720, quantity: 2, unit: 'ea' },
    ],
  }),
}));

vi.mock('../../src/services/drawing.service.js', () => ({
  generateDrawingData: vi.fn().mockReturnValue({
    common: {
      front_view: { doors: [{ id: 'd1' }], hardware: [{ id: 'h1' }] },
    },
    manufacturing: { panel_details: [{ id: 'pd1' }] },
    installation: { utilities: [{ id: 'u1' }] },
  }),
}));

vi.mock('../../src/services/svg-renderer.service.js', () => ({
  renderDrawingToSvg: vi.fn().mockReturnValue({
    front: '<svg>front</svg>',
    side: '',
    plan: '',
  }),
}));

vi.mock('../../src/clients/claude.client.js', () => ({
  claudeVisionAnalysis: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"placement": 8, "proportion": 7, "quality": 9, "completeness": 8, "overall": 8, "issues": [], "suggestions": []}' }],
  }),
  extractTextFromClaudeResponse: vi.fn().mockReturnValue(
    '{"placement": 8, "proportion": 7, "quality": 9, "completeness": 8, "overall": 8, "issues": [], "suggestions": []}'
  ),
}));

vi.mock('../../src/clients/supabase.client.js', () => ({
  supabaseRpc: vi.fn().mockResolvedValue({ id: 'design-123' }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { executeTool } from '../../src/agent/tool-adapter.js';

function createMockSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'test-session-id',
    messages: [],
    designState: {},
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

describe('Tool Adapter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('executeTool routing', () => {
    it('should return error for unknown tool', async () => {
      const session = createMockSession();
      const result = await executeTool('unknown_tool', {}, session);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });

    it('should route analyze_wall correctly', async () => {
      const session = createMockSession({
        roomImage: 'base64image',
        imageType: 'image/jpeg',
      });

      const result = await executeTool('analyze_wall', {}, session);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('wall_width_mm', 3000);
      expect(session.designState.wallAnalysis).toBeDefined();
    });

    it('should fail analyze_wall without room image', async () => {
      const session = createMockSession();
      const result = await executeTool('analyze_wall', {}, session);

      expect(result.success).toBe(false);
      expect(result.error).toContain('방 사진');
    });

    it('should return cached wall analysis if exists', async () => {
      const cachedWall = { wall_width_mm: 2500 };
      const session = createMockSession({
        roomImage: 'base64image',
        designState: { wallAnalysis: cachedWall as any },
      });

      const result = await executeTool('analyze_wall', {}, session);

      expect(result.success).toBe(true);
      expect((result.data as any).wall_analysis).toEqual(cachedWall);
    });

    it('should route search_design_rules correctly', async () => {
      const session = createMockSession();
      const result = await executeTool(
        'search_design_rules',
        { category: 'sink', style: 'modern' },
        session,
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('total_rules', 1);
      expect(session.designState.category).toBe('sink');
      expect(session.designState.ragRules).toBeDefined();
    });

    it('should route render_furniture correctly', async () => {
      const session = createMockSession({
        roomImage: 'base64image',
        designState: {
          wallAnalysis: { wall_width_mm: 3000 } as any,
          ragRules: { background: [], modules: [], doors: [], materials: [] },
        },
      });

      const result = await executeTool('render_furniture', { category: 'sink', style: 'modern' }, session);

      expect(result.success).toBe(true);
      expect((result.data as any).closed_image_generated).toBe(true);
      expect(session.designState.generatedImages).toBeDefined();
    });

    it('should fail render_furniture without prerequisites', async () => {
      const session = createMockSession();
      const result = await executeTool('render_furniture', {}, session);

      expect(result.success).toBe(false);
      expect(result.error).toContain('벽 분석');
    });

    it('should route compute_layout correctly', async () => {
      const session = createMockSession({
        designState: {
          wallAnalysis: { wall_width_mm: 3000 } as any,
          ragRules: { background: [], modules: [], doors: [], materials: [] },
        },
      });

      const result = await executeTool('compute_layout', { category: 'sink', style: 'modern' }, session);

      expect(result.success).toBe(true);
      expect(session.designState.designData).toBeDefined();
    });

    it('should route generate_bom correctly', async () => {
      const session = createMockSession({
        designState: {
          designData: { category: 'sink' } as any,
        },
      });

      const result = await executeTool('generate_bom', {}, session);

      expect(result.success).toBe(true);
      expect((result.data as any).total_items).toBe(10);
      expect(session.designState.bomResult).toBeDefined();
    });

    it('should fail generate_bom without design data', async () => {
      const session = createMockSession();
      const result = await executeTool('generate_bom', {}, session);

      expect(result.success).toBe(false);
      expect(result.error).toContain('설계 데이터');
    });

    it('should route generate_drawing correctly', async () => {
      const session = createMockSession({
        designState: {
          designData: { category: 'sink' } as any,
        },
      });

      const result = await executeTool('generate_drawing', {}, session);

      expect(result.success).toBe(true);
      expect(session.designState.drawingData).toBeDefined();
    });

    it('should route render_svg correctly', async () => {
      const session = createMockSession({
        designState: {
          drawingData: { common: {} } as any,
        },
      });

      const result = await executeTool('render_svg', {}, session);

      expect(result.success).toBe(true);
      expect(session.designState.svgOutput).toBeDefined();
    });

    it('should route save_design correctly', async () => {
      const session = createMockSession({
        designState: {
          designData: { category: 'sink', style: 'modern' } as any,
        },
      });

      const result = await executeTool('save_design', { title: 'Test Design' }, session);

      expect(result.success).toBe(true);
      expect((result.data as any).saved).toBe(true);
    });

    it('should route search_options correctly', async () => {
      const session = createMockSession();
      const result = await executeTool('search_options', { query: 'door handle' }, session);

      expect(result.success).toBe(true);
      expect((result.data as any).query).toBe('door handle');
    });

    it('should route verify_image correctly', async () => {
      const session = createMockSession({
        designState: {
          generatedImages: { closed: 'base64closed', open: null },
        },
      });

      const result = await executeTool('verify_image', { image_type: 'closed' }, session);

      expect(result.success).toBe(true);
      expect((result.data as any).verified).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should catch service errors and return failure', async () => {
      const { analyzeWall } = await import('../../src/services/wall-analysis.service.js');
      (analyzeWall as any).mockRejectedValueOnce(new Error('API timeout'));

      const session = createMockSession({
        roomImage: 'base64image',
        imageType: 'image/jpeg',
      });

      const result = await executeTool('analyze_wall', {}, session);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API timeout');
    });
  });
});
