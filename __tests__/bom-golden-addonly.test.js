/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, process */
/**
 * B1: 골든 갱신이 **필드 추가만**임을 증명한다 (불변조건 I4, 계획 §5 B1 "완료: 골든 갱신 diff 가 필드 추가만").
 *
 * 기준: `test-utils/bom-golden/base-b0.digest.json` — B0 골든(#633)을 B1 이 더한 키를 뺀 모양으로 깎아 sha256 한 것.
 * 현재 골든을 같은 방식으로 깎아 다이제스트가 같으면, 옛 키·값은 하나도 바뀌지 않았다. 여기에 더해
 * 자재 행 키 집합이 정확히 "B0 키 ∪ B1 키" 이고 새 키가 모든 행에 있음을 본다.
 *
 * 값이 의도적으로 바뀌는 단계(B2 누락 자재 …)는 그 PR 에서 기준을 다시 굳힌다:
 *   UPDATE_BASE_DIGEST=1 npx jest __tests__/bom-golden-addonly.test.js
 *   (PowerShell: $env:UPDATE_BASE_DIGEST=1; npx jest __tests__/bom-golden-addonly.test.js)
 * 그리고 커밋 메시지에 어느 값이 왜 바뀌었는지 적는다. 조용히 통과하는 길은 없다.
 */
const fs = require('fs');
const {
  goldenPath, stripToBase, digestOf, readBaseDigest, writeBaseDigest,
  MATERIAL_ROW_KEYS_B0, NEW_ROW_KEYS_B1,
} = require('../test-utils/bom-golden/golden');

const NAMES = ['sink15', 'sink18', 'sinkCorner', 'wardrobe', 'fridge'];

if (process.env.UPDATE_BASE_DIGEST === '1') {
  writeBaseDigest(NAMES);
}

describe('BOM 골든 — B0 대비 필드 추가만 (add-only)', () => {
  const base = readBaseDigest();

  test('기준 다이제스트 파일이 있고 다섯 픽스처를 다 덮는다', () => {
    expect(base).not.toBeNull();
    expect(Object.keys(base.digests).sort()).toEqual([...NAMES].sort());
    expect(base.baseRowKeys).toEqual(MATERIAL_ROW_KEYS_B0);
    expect(base.strippedKeys).toEqual(NEW_ROW_KEYS_B1);
  });

  test.each(NAMES)('%s: 새 키·edgeBanding·cncHead 를 빼면 B0 골든과 바이트 단위로 같다', (name) => {
    const golden = JSON.parse(fs.readFileSync(goldenPath(name), 'utf8'));
    expect(digestOf(stripToBase(golden))).toBe(base.digests[name]);
  });

  test.each(NAMES)('%s: 자재 행 키 = B0 키 ∪ B1 키, 새 키는 모든 행에', (name) => {
    const golden = JSON.parse(fs.readFileSync(goldenPath(name), 'utf8'));
    const want = [...MATERIAL_ROW_KEYS_B0, ...NEW_ROW_KEYS_B1].sort();
    expect(golden.materials.length).toBeGreaterThan(0);
    golden.materials.forEach((row) => {
      expect(Object.keys(row).sort()).toEqual(want);
      expect(typeof row.partId).toBe('string');
      expect(typeof row.slot).toBe('string');
      expect(Object.keys(row.edges).sort()).toEqual(['B', 'L', 'R', 'T']);
      expect(typeof row.edgeLen).toBe('number');
      expect([0.6, 1]).toContain(row.edgeT);
      expect(row.edgeCode === null || typeof row.edgeCode === 'string').toBe(true);
    });
    // 골든 픽스처는 디테일 모델이 없다 → 새 finishCode 경로는 값을 바꾸지 않는다 (edgeCode 도 전부 null)
    golden.materials.forEach((row) => expect(row.edgeCode).toBeNull());
    expect(Object.keys(golden.edgeBanding).sort()).toEqual(['0.6', '1']);
  });

  test('summary 는 여전히 자재_두께 그룹만이다 (edgeBanding 은 형제 키)', () => {
    NAMES.forEach((name) => {
      const golden = JSON.parse(fs.readFileSync(goldenPath(name), 'utf8'));
      Object.entries(golden.summary).forEach(([key, s]) => {
        expect(key).toBe(`${s.material}_${s.thickness}`);
        expect(Object.keys(s).sort()).toEqual(['material', 'panelCount', 'thickness', 'totalArea']);
      });
    });
  });
});
