// ═══════════════════════════════════════════════════════════════
// bom-rules.defaults.test.ts — W7-4 도어 자재 단가 매트릭스
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  getDoorFinishPrice,
  buildDoorPricingMatrix,
  FINISH_BASE_PRICE,
  COLOR_PRICE_MULTIPLIER,
} from '../src/config/bom-rules.defaults';

describe('getDoorFinishPrice', () => {
  it('PET-OAK-M (PET 매트 + 오크) = 24000 × 1.00 = 24000', () => {
    expect(getDoorFinishPrice('PET-OAK-M')).toBe(24000);
  });

  it('PET-OAK-G (PET 광택 + 오크) = 26000', () => {
    expect(getDoorFinishPrice('PET-OAK-G')).toBe(26000);
  });

  it('MFB-WHT (MFB + 화이트) = 14000 × 0.95 = 13300', () => {
    expect(getDoorFinishPrice('MFB-WHT')).toBe(13300);
  });

  it('PNT-GRP-G (도장 유광 + 그라파이트) = 34000 × 1.05 = 35700', () => {
    expect(getDoorFinishPrice('PNT-GRP-G')).toBe(35700);
  });

  it('VNR-SAG (무늬목 + 세이지) = 38000 × 1.10 = 41800 (최고가)', () => {
    expect(getDoorFinishPrice('VNR-SAG')).toBe(41800);
  });

  it('MFB-WHT (MFB + 화이트) = 13300 (최저가군)', () => {
    expect(getDoorFinishPrice('MFB-WHT')).toBe(13300);
  });

  it('null / undefined / MDF-DEFAULT → null', () => {
    expect(getDoorFinishPrice(null)).toBeNull();
    expect(getDoorFinishPrice(undefined)).toBeNull();
    expect(getDoorFinishPrice('')).toBeNull();
    expect(getDoorFinishPrice('MDF-DEFAULT')).toBeNull();
  });

  it('알 수 없는 finish 코드 → null', () => {
    expect(getDoorFinishPrice('UNKNOWN-OAK-M')).toBeNull();
  });

  it('알 수 없는 color → multiplier 1.00 fallback', () => {
    expect(getDoorFinishPrice('MFB-XYZ')).toBe(14000); // base × 1.00
  });
});

describe('buildDoorPricingMatrix', () => {
  it('49 조합 모두 단가 산출', () => {
    const matrix = buildDoorPricingMatrix();
    expect(Object.keys(matrix).length).toBe(49);
  });

  it('단가 범위: 13300 (MFB-WHT/BLK) ~ 41800 (VNR-SAG)', () => {
    const matrix = buildDoorPricingMatrix();
    const prices = Object.values(matrix);
    expect(Math.min(...prices)).toBe(13300);
    expect(Math.max(...prices)).toBe(41800);
  });

  it('모든 단가 양의 정수', () => {
    const matrix = buildDoorPricingMatrix();
    for (const [code, price] of Object.entries(matrix)) {
      expect(price).toBeGreaterThan(0);
      expect(Number.isInteger(price)).toBe(true);
    }
  });

  it('VNR (무늬목) 7개 색상 모두 가장 비쌈 (color multiplier 영향 후)', () => {
    const matrix = buildDoorPricingMatrix();
    // VNR-SAG (41800) > PNT-SAG-G (37400) > VNR-CRM (38000) > ...
    expect(matrix['VNR-CRM']).toBeGreaterThan(matrix['PET-CRM-M']);
    expect(matrix['VNR-SAG']).toBeGreaterThan(matrix['VNR-WHT']);
  });
});

describe('상수 무결성', () => {
  it('FINISH_BASE_PRICE 7개 키 (toneSuffix 포함)', () => {
    const keys = Object.keys(FINISH_BASE_PRICE);
    expect(keys.length).toBe(7);
    expect(keys).toContain('PET-M');
    expect(keys).toContain('PET-G');
    expect(keys).toContain('MFB');
    expect(keys).toContain('LPM');
    expect(keys).toContain('PNT-M');
    expect(keys).toContain('PNT-G');
    expect(keys).toContain('VNR');
  });

  it('COLOR_PRICE_MULTIPLIER 7개 키 (W7-1 카탈로그와 1:1)', () => {
    const keys = Object.keys(COLOR_PRICE_MULTIPLIER);
    expect(keys.length).toBe(7);
    expect(keys).toEqual(['CRM', 'OAK', 'WNT', 'GRP', 'WHT', 'BLK', 'SAG']);
  });

  it('multiplier 범위 0.9 ~ 1.15', () => {
    for (const mult of Object.values(COLOR_PRICE_MULTIPLIER)) {
      expect(mult).toBeGreaterThanOrEqual(0.9);
      expect(mult).toBeLessThanOrEqual(1.15);
    }
  });
});
