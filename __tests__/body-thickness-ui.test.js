/**
 * W12-1b: 몸통 두께 선택 UI 계약 테스트.
 *
 * BOM 엔진은 `specs.bodyThickness` 를 읽어 15T/18T 를 파생하지만
 * (__tests__/bom-body-thickness.test.js), 화면에 고를 수단이 없으면
 * 그 기능은 데이터 계층에만 존재하고 실제로는 쓸 수 없다.
 *
 * ui-workspace.js 는 DOM 없이 실행할 수 없는 전역 스크립트라
 * 소스 텍스트로 배선을 고정한다 — 컨트롤이 조용히 사라지는 것을 막는 목적이다.
 */
const fs = require('fs');
const path = require('path');

const UI = fs.readFileSync(path.join(__dirname, '../js/detaildesign/ui-workspace.js'), 'utf8');
const CONSTANTS = fs.readFileSync(path.join(__dirname, '../js/detaildesign/data-constants.js'), 'utf8');

describe('몸통 두께 선택 컨트롤', () => {
  test('치수 섹션에 bodyThickness 셀렉트가 배선돼 있다', () => {
    expect(UI).toMatch(/updateSpecValue\(\$\{uid\},'bodyThickness',this\.value\)/);
    expect(UI).toMatch(/몸통 두께/);
  });

  test('선택지를 정본 상수에서 만든다 (하드코딩 목록 아님)', () => {
    // 옵션을 손으로 적어두면 data-constants 와 갈라진다
    expect(UI).toMatch(/BODY_THICKNESS_OPTIONS/);
  });

  test('미설정 설계는 기본 두께가 선택된 상태로 보인다', () => {
    // 기존 저장 설계에는 bodyThickness 가 없다 — 셀렉트가 빈 채로 보이면 안 됨
    expect(UI).toMatch(/parseFloat\(item\.specs\.bodyThickness\)\s*\|\|\s*BODY_THICKNESS_DEFAULT/);
  });

  test('레이아웃 재계산 대상에 넣지 않는다', () => {
    // 두께는 부재 치수만 바꾸고 모듈 배치는 바꾸지 않는다.
    // syncModuleHeights 목록에 들어가면 두께만 바꿔도 모듈 높이가 재동기화된다.
    const m = UI.match(/item\.categoryId === 'sink' && \[([^\]]+)\]\.includes\(field\)/);
    expect(m).not.toBeNull();
    expect(m[1]).not.toMatch(/bodyThickness/);
  });
});

describe('정본 상수', () => {
  test('DEFAULT_SPECS 에 bodyThickness 기본값이 있다', () => {
    expect(CONSTANTS).toMatch(/bodyThickness:\s*15/);
  });

  test('선택 가능한 두께는 15T / 18T', () => {
    expect(CONSTANTS).toMatch(/BODY_THICKNESS_OPTIONS\s*=\s*\[15,\s*18\]/);
  });

  test('도어 MDF 두께는 몸통과 별개 상수로 유지된다', () => {
    expect(CONSTANTS).toMatch(/DOOR_MDF_THICKNESS\s*=\s*18/);
  });
});
