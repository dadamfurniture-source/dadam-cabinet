// ═══════════════════════════════════════════════════════════════
// Prompt Builders - Unit Tests
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { buildClosedDoorPrompt } from '../../src/prompts/templates/closed-door.prompt.js';
import { buildOpenDoorPrompt } from '../../src/prompts/templates/open-door.prompt.js';
import { buildDesignToImagePrompt } from '../../src/prompts/templates/design-to-image.prompt.js';
import { buildStyleColorPrompt } from '../../src/prompts/templates/style-color.prompt.js';
import { buildChatSystemPrompt } from '../../src/prompts/templates/chat-system.prompt.js';
import { buildMaterialColorSection } from '../../src/prompts/sections/material-color.section.js';
import { getDefaultWallData } from '../../src/services/furniture-placement.service.js';

describe('buildClosedDoorPrompt', () => {
  it('should include category in prompt', () => {
    const prompt = buildClosedDoorPrompt({
      category: 'sink',
      style: 'modern',
      wallData: getDefaultWallData(),
      rules: { background: [], modules: [], doors: [], materials: [], materialKeywords: [] },
    });

    expect(prompt).toContain('KOREAN BUILT-IN KITCHEN');
    expect(prompt).toContain('PHOTO generation task');
  });

  it('should include user-selected style and color', () => {
    const prompt = buildClosedDoorPrompt({
      category: 'sink',
      style: 'modern minimal',
      wallData: getDefaultWallData(),
      rules: { background: [], modules: [], doors: [], materials: [], materialKeywords: [] },
      cabinetSpecs: { door_color_upper: '그레이' },
      styleKeywords: 'clean lines',
      colorPrompt: 'warm gray matte',
    });

    expect(prompt).toContain('modern minimal');
    expect(prompt).toContain('그레이');
    expect(prompt).toContain('warm gray matte');
    expect(prompt).toContain('clean lines');
  });

  it('should include utility placement when detected', () => {
    const wallData = getDefaultWallData();
    wallData.water_pipe_x = 900;
    wallData.exhaust_duct_x = 2700;

    const prompt = buildClosedDoorPrompt({
      category: 'sink',
      style: 'modern',
      wallData,
      rules: { background: [], modules: [], doors: [], materials: [], materialKeywords: [] },
    });

    expect(prompt).toContain('900mm');
    expect(prompt).toContain('2700mm');
    expect(prompt).toContain('배관 위치 기반');
  });

  it('should use calculated defaults when no pipes detected', () => {
    const prompt = buildClosedDoorPrompt({
      category: 'sink',
      style: 'modern',
      wallData: getDefaultWallData(),
      rules: { background: [], modules: [], doors: [], materials: [], materialKeywords: [] },
    });

    expect(prompt).toContain('계산된 기본 좌표');
  });

  it('should include module layout when provided', () => {
    const prompt = buildClosedDoorPrompt({
      category: 'sink',
      style: 'modern',
      wallData: getDefaultWallData(),
      rules: { background: [], modules: [], doors: [], materials: [], materialKeywords: [] },
      modules: {
        upper: [{ name: '상부장', width: 600 }, { name: '상부장', width: 900 }],
        lower: [{ name: '하부장', width: 600 }],
        upper_count: 2,
        lower_count: 1,
      },
    });

    expect(prompt).toContain('Upper cabinets: 2');
    expect(prompt).toContain('Lower cabinets: 1');
    expect(prompt).toContain('600mm');
  });

  it('should always include forbidden section', () => {
    const prompt = buildClosedDoorPrompt({
      category: 'sink',
      style: 'modern',
      wallData: getDefaultWallData(),
      rules: { background: [], modules: [], doors: [], materials: [], materialKeywords: [] },
    });

    expect(prompt).toContain('STRICTLY FORBIDDEN');
    expect(prompt).toContain('NO dimension labels');
  });
});

describe('buildOpenDoorPrompt', () => {
  it('should include category-specific contents for sink', () => {
    const prompt = buildOpenDoorPrompt('sink');

    expect(prompt).toContain('그릇');
    expect(prompt).toContain('냄비');
    expect(prompt).toContain('싱크볼 하부');
    expect(prompt).toContain('싱크볼, 수전, 쿡탑, 후드 위치: 변경 금지');
  });

  it('should include category-specific contents for wardrobe', () => {
    const prompt = buildOpenDoorPrompt('wardrobe');

    expect(prompt).toContain('셔츠');
    expect(prompt).toContain('행거');
    expect(prompt).not.toContain('싱크볼, 수전, 쿡탑');
  });

  it('should include forbidden items for each category', () => {
    const prompt = buildOpenDoorPrompt('sink');
    expect(prompt).toContain('의류, 옷 금지');

    const wardrobePrompt = buildOpenDoorPrompt('wardrobe');
    expect(wardrobePrompt).toContain('식기류, 주방용품 금지');
  });

  it('should fallback to storage for unknown category', () => {
    const prompt = buildOpenDoorPrompt('unknown');

    expect(prompt).toContain('수납박스');
  });

  it('should include door preservation rules', () => {
    const prompt = buildOpenDoorPrompt('sink');

    expect(prompt).toContain('도어 개수');
    expect(prompt).toContain('절대 변경 금지');
    expect(prompt).toContain('도어를 추가하거나 제거하지');
  });
});

describe('buildDesignToImagePrompt', () => {
  it('should include category', () => {
    const prompt = buildDesignToImagePrompt('sink', 'modern', {}, []);

    expect(prompt).toContain('SINK');
    expect(prompt).toContain('PHOTO generation task');
  });

  it('should include forbidden section', () => {
    const prompt = buildDesignToImagePrompt('wardrobe', 'classic', {}, []);

    expect(prompt).toContain('STRICTLY FORBIDDEN');
  });
});

describe('buildStyleColorPrompt', () => {
  it('should include style and color info', () => {
    const prompt = buildStyleColorPrompt(
      'modern-minimal',
      'clean, bright',
      'cozy warmth',
      'warm white matte'
    );

    expect(prompt).toContain('MODERN MINIMAL');
    expect(prompt).toContain('clean, bright');
    expect(prompt).toContain('cozy warmth');
    expect(prompt).toContain('warm white matte');
  });

  it('should include cabinet specs when provided', () => {
    const prompt = buildStyleColorPrompt(
      'modern',
      '',
      '',
      'white',
      { total_width_mm: 3600, countertop_color: 'Snow White' }
    );

    expect(prompt).toContain('3600mm');
    expect(prompt).toContain('Snow White');
  });
});

describe('buildChatSystemPrompt', () => {
  it('should include page context', () => {
    const prompt = buildChatSystemPrompt({ page: 'ai-design', itemCount: 5 });

    expect(prompt).toContain('ai-design');
    expect(prompt).toContain('5');
    expect(prompt).toContain('다담AI');
  });

  it('should include design data context', () => {
    const prompt = buildChatSystemPrompt({
      designData: { items: [1, 2, 3] },
    });

    expect(prompt).toContain('3개의 가구 아이템');
  });
});

describe('buildMaterialColorSection', () => {
  it('should return empty string when no materials', () => {
    const result = buildMaterialColorSection([], []);

    expect(result).toBe('');
  });

  it('should include material code and color info', () => {
    const materials = [
      {
        id: '1',
        rule_type: 'material' as const,
        content: 'Color: White Oak\nFinish: Matte\nRender: Natural wood grain',
        triggers: ['WO-001'],
      },
    ];

    const result = buildMaterialColorSection(materials, []);

    expect(result).toContain('WO-001');
    expect(result).toContain('White Oak');
    expect(result).toContain('Matte');
  });

  it('should include hex code from metadata', () => {
    const materials = [
      {
        id: '1',
        rule_type: 'material' as const,
        content: 'Color: Gray',
        triggers: ['GR-001'],
        metadata: { hex: '#808080' },
      },
    ];

    const result = buildMaterialColorSection(materials, []);

    expect(result).toContain('#808080');
  });

  it('should include material keywords', () => {
    const materialKeywords = [
      {
        id: '1',
        rule_type: 'material_keyword' as const,
        content: '화이트 무광 계열\n추천 코드: WM-001, WM-002',
      },
    ];

    const result = buildMaterialColorSection([], materialKeywords);

    expect(result).toContain('추천 옵션');
    expect(result).toContain('화이트 무광');
  });
});
