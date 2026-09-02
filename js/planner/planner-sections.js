// ============================================================
// P1: 섹션 정의 단일 정본 — planner-sections.js
//
// 두 HTML 이 `SECTION_CONFIG` 를 따로 갖고 있었고, 구조 단계에는
// "mockup-shell.html 과 동일" 이라고 적혀 있었다. **동일하지 않았다.**
// 실제 차이(추출하며 확인):
//   · 일반 8종(lower/upper/tall/fridge/sink/hood/refrigerator/dishwasher)
//     — fill·stroke·label 전부 일치. 진짜 중복이라 여기로 모았다.
//   · 마감재 3종(ep/molding/filler) — 색이 **다르다**. 구조 단계는 3D 에서
//     몸통과 구분하려고 더 어둡게 쓴다(ep 는 배치의 stroke 색을 fill 로 씀).
//     의도된 차이라 지우지 않고 SECTION_PALETTE_3D 로 **드러냈다.**
//   · wardrobe — 구조 단계에만 있다. 배치 단계는 이 키가 없어서
//     `if (!SECTION_CONFIG[m.section]) return;` 에 걸려 붙박이장 모듈을 버린다.
//     지금은 그게 맞다 — mockup-structure.html:2442 가 "wardrobe 카테고리는
//     mockup 에서 다른 section 사용 (추후 확장)" 이라고 못박고 있어
//     배치 단계가 wardrobe 사각형을 만드는 경로 자체가 없다.
//     배치 폭(w) 정본도 없다(data-constants.js 는 깊이 600·높이 2310 만 정의).
//     **값을 지어내지 않기 위해** 구조 전용으로 남긴다. 확장은 P11 에서.
//
// ⚠ SECTION_CONFIG 의 키는 단순한 조회 대상이 아니다. 네 곳에서
//     Array.from(g.classList).find(c => SECTION_CONFIG[c])
//   처럼 **클래스 이름 판별기**로 쓰인다(mockup-shell.html:2280,2285,2504,2542).
//   키를 늘리면 그 판별 결과가 달라진다. 추가는 언제나 의도적으로.
//
// ⚠ 클래식 스크립트라 최상위 const 가 전역 렉시컬 스코프에 들어간다.
//   인라인에서 재선언하면 SyntaxError 로 스크립트 전체가 죽는다.
// ============================================================

/**
 * 두 단계가 공유하는 섹션 정본.
 *   fill/stroke — 도면 색
 *   w/h         — 평면도 기본 폭 / **깊이** (h 는 높이가 아니다. 도면은 평면도라 W × D)
 *   moduleH     — 모듈 **전체 높이** (다리발/좌대 + 몸통 + 상판/상몰딩). 몸통 높이가 아니다.
 *   adjacent    — 인접 모듈에서 치수를 따오는 방식(마감재 전용)
 *
 * W9-20 / CD-1 — moduleH 를 몸통 높이로 착각하면 전 부재의 세로 치수가 틀어진다:
 *   하부장 870 = 다리발 150 + 몸통 708 + 상판 12
 *   상부장 780 = 몸통 720 + 상몰딩 60
 * BOM 은 몸통 높이를 쓰므로 브리지(ui-step1.js `_carcassHeight`)가 변환한다.
 * 예전 값 860/800 은 제조 표준(870/780)과 어긋나 있었다 — 플래너를 거치는 것만으로
 * 부재가 10·20mm 씩 틀리던 원인이다. 여기 숫자를 고칠 땐 반드시 근거 문서를 함께 갱신할 것.
 */
const PLANNER_SECTIONS = {
  lower:   { fill: '#b8956c', stroke: '#6a4b2a', w: 2400, h: 650, label: '하부장',  moduleH: 870  },
  upper:   { fill: '#7c9c8f', stroke: '#3d5750', w: 2400, h: 320, label: '상부장',  moduleH: 780  },
  tall:    { fill: '#9c6e7c', stroke: '#5c3848', w: 600,  h: 650, label: '키큰장',  moduleH: 2300 },
  fridge:  { fill: '#a0a8b0', stroke: '#4a525a', w: 720,  h: 700, label: '냉장고장', moduleH: 2300 },
  // W9-41: 가전 4종 (빌트인) — 가구 모듈처럼 도면에 배치
  // W9-42: 분배기/후드/식세기 기본값 조정 + 냉장고는 모달로 모델 선택
  sink:         { fill: '#b0b8c0', stroke: '#5a626a', w: 700, h: 400, label: '분배기',     moduleH: 500  },
  hood:         { fill: '#6a727a', stroke: '#2a3238', w: 300, h: 300, label: '후드',       moduleH: 300  },
  refrigerator: { fill: '#c8ced4', stroke: '#5a626a', w: 720, h: 700, label: '냉장고',     moduleH: 1870 },
  dishwasher:   { fill: '#9ca4ac', stroke: '#5a626a', w: 600, h: 650, label: '식기세척기', moduleH: 820  },
  // EP 측판: W=인접 모듈 깊이 (650 default) · H=인접 모듈 전체높이 (870 default)
  //
  // W12-19: **부재와 공간이 다른 값이다.**
  //   h      = 18  — 실제 부재 두께 (18T MDF). BOM·3D 가 쓴다.
  //   spaceW = 20  — 공간 설계에서 잡아 두는 폭. 실제 설치 여유 2mm 를 포함한다.
  //                  `design_rules 'EP기본값' 20mm` 과 `door.md FINISH_TYPES
  //                  기본 너비 20mm` 가 이 값이다.
  // 모듈 폭을 줄일 때는 spaceW(20), 판을 그릴 때는 h(18) 를 쓴다.
  // 몰딩·휠라는 폭 60 이 부재이자 공간이라 둘이 같다.
  ep:      { fill: '#d4c5a0', stroke: '#7a6a45', w: 650,  h: 18,  spaceW: 20, label: 'EP',    moduleH: 870, adjacent: 'depthAndHeight' },
  // 몰딩: W=60 · 두께 18T · H=인접 모듈 높이
  molding: { fill: '#c8b896', stroke: '#7a6a45', w: 60,   h: 18,  label: '몰딩',   moduleH: 870, adjacent: 'heightOnly' },
  // 휠라 (filler): W=60 · 두께 18T · H=인접 모듈 높이
  filler:  { fill: '#c8b896', stroke: '#7a6a45', w: 60,   h: 18,  label: '휠라',   moduleH: 870, adjacent: 'heightOnly' },
  // W12-62: 비움 — **부재 없이 자리만 비워 두는 마감**. 벽 여유처럼 폭은 잡되
  //   판이 서지 않으므로 BOM 에 자재가 나오지 않는다 (noPart).
  //   기본 50 이지만 다른 마감재와 달리 **모듈마다 폭을 고칠 수 있다** —
  //   비우는 이유(벽 기울기·의도한 틈)가 현장마다 다르기 때문이다.
  gap:     { fill: '#d8d2c4', stroke: '#8a8378', w: 50,   h: 0,   label: '비움',   moduleH: 870, adjacent: 'heightOnly', noPart: true, editableW: true },
};

/**
 * 마감재 섹션 목록 — **여기가 정본이다.**
 * 예전엔 이 배열이 여섯 군데에 손으로 적혀 있어서, 새 마감재를 넣으면 어느 한 곳이
 * 빠진 채로 굴러갔다 (배치 목록에 마감재가 뜨거나, 저장이 마감재를 모듈로 읽거나).
 */
const FINISHING_SECTIONS = ['ep', 'molding', 'filler', 'gap'];

/**
 * 구조 단계(3D·정면도) 마감재 색 덮어쓰기.
 * 평면 배치에서는 마감재를 옅게 칠해 몸통 위에 겹쳐 보이게 하지만,
 * 3D 에서는 같은 색이면 몸통에 묻혀버려 더 어둡게 쓴다. 의도된 차이다.
 */
const SECTION_PALETTE_3D = {
  ep:      { fill: '#7a6a45', stroke: '#1a0f00' },
  molding: { fill: '#5a4d2f', stroke: '#1a0f00' },
  filler:  { fill: '#8a7858', stroke: '#1a0f00' },
  gap:     { fill: '#6e685c', stroke: '#1a0f00' },
};

/** 구조 단계에만 존재하는 섹션. 위 주석의 wardrobe 설명 참고. */
const STRUCTURE_ONLY_SECTIONS = {
  wardrobe: { fill: '#8c8a6e', stroke: '#4e4c38', label: '붙박이장' },
};

/**
 * 페이지별 SECTION_CONFIG 를 만든다. 정본 객체를 공유하지 않도록 항상 새 객체를 준다
 * (한 페이지에서의 수정이 다른 정의로 새지 않게).
 * @param {object} [extra]    이 페이지에만 있는 섹션
 * @param {object} [palette]  섹션별 색 덮어쓰기
 */
function buildSectionConfig(extra, palette) {
  const out = {};
  Object.keys(PLANNER_SECTIONS).forEach((k) => { out[k] = Object.assign({}, PLANNER_SECTIONS[k]); });
  if (extra) Object.keys(extra).forEach((k) => { out[k] = Object.assign({}, out[k], extra[k]); });
  if (palette) Object.keys(palette).forEach((k) => { if (out[k]) Object.assign(out[k], palette[k]); });
  return out;
}

if (typeof window !== 'undefined') {
  window.PLANNER_SECTIONS = PLANNER_SECTIONS;
  window.SECTION_PALETTE_3D = SECTION_PALETTE_3D;
  window.STRUCTURE_ONLY_SECTIONS = STRUCTURE_ONLY_SECTIONS;
  window.FINISHING_SECTIONS = FINISHING_SECTIONS;
  window.buildSectionConfig = buildSectionConfig;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_SECTIONS, SECTION_PALETTE_3D, STRUCTURE_ONLY_SECTIONS, FINISHING_SECTIONS, buildSectionConfig,
  };
}
