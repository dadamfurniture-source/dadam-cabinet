/* global module */
/**
 * BOM 골든 픽스처 — `MaterialExtractor.extract()` · `HardwareExtractor.extract()` 의
 * 표준 3종(싱크·붙박이·냉장고) 입력.
 *
 * 계획 B0(docs/01-plan/detail-bom-deepening.plan.md §5): 현재 출력을 그대로 동결해
 * 이후 리팩터(B1 부재 식별자, B2 누락 자재 …)가 **무엇을 바꿨는지** diff 로 드러나게 한다.
 * 의도적으로 바꾸는 단계만 골든을 갱신하고, 그 갱신은 별도 커밋으로 분리한다
 * (`test-utils/planner-golden.js` 와 같은 원칙).
 *
 * 픽스처는 `DadamAgent.exportDesign()` 이 내는 `{ items:[{ categoryId, w,h,d, specs, modules }] }`
 * 모양 그대로다. 모듈 필드는 각 UI 가 실제로 만드는 것을 따랐다:
 *   - 싱크대   calc-engine.js `createModule` / ESSENTIAL_DEFS (type·pos·doorCount·isDrawer·isEL)
 *   - 붙박이장 ui-workspace.js `addWardrobeModule` (moduleType·upperH/lowerH·shelfCount*·isExternalDrawer)
 *   - 냉장고장 ui-fridge-el.js `addFridgeSideModule` (type: fridge|tall|homecafe)
 *
 * bom-protocol.md §3 의 부재표 가지가 하나씩은 걸리도록 모듈을 골랐다. 어느 가지를 위한
 * 모듈인지는 각 항목 옆에 적었다.
 */

/**
 * 싱크대 — 상부 3(2D·1D·후드) + 하부 6(개수대·서랍장·2D·EL·오픈·가스대), 목찬넬 손잡이, 좌측 휠라.
 *
 * 걸리는 가지:
 *   상부  W≥700 → 처짐방지 2 / W<700 → 1, 후드는 제외, 상몰딩 W>2000 → 2면(장)
 *   하부  개수대(type sink) → 선반 없음, W≥800 → 처짐방지 2,
 *         서랍장 800×서랍2 → 서랍 부재 + 하단보강(전후판 728>600) + 여닫이 도어 2 + 목찬넬,
 *         EL → 선반 없음 / 오픈(doorCount 0) → 선반·도어 없음, 가스대(type cook) → 몸통 없음,
 *         목찬넬 → 처짐방지 −70 + EP 목찬넬(전면·지면)
 */
const sink15 = {
  categoryId: 'sink',
  w: 4100, h: 2310, d: 650,
  specs: {
    layoutShape: 'I',
    bodyThickness: 15,
    lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12, moldingH: 60,
    upperDoorOverlap: 15,
    handle: '찬넬 (목찬넬)',
    finishLeftType: 'Filler', finishLeftWidth: 30,
    finishRightType: 'None', finishRightWidth: 0,
    doorColorUpper: '화이트', doorFinishUpper: '무광',
    doorColorLower: '화이트', doorFinishLower: '무광',
  },
  modules: [
    { id: 'u1', type: 'storage', name: '상부장(2D)', pos: 'upper', w: 900, h: 720, d: 295, doorCount: 2, is2door: true, isDrawer: false, isEL: false },
    { id: 'u2', type: 'storage', name: '상부장(1D)', pos: 'upper', w: 600, h: 720, d: 295, doorCount: 1, is2door: false, isDrawer: false, isEL: false },
    { id: 'u3', type: 'hood', name: '후드장', pos: 'upper', w: 800, h: 720, d: 295, isDrawer: false, isEL: false, isFixed: true },
    { id: 'u4', type: 'storage', name: '상부장(2D)', pos: 'upper', w: 1200, h: 720, d: 295, doorCount: 2, is2door: true, isDrawer: false, isEL: false },
    { id: 'l1', type: 'sink', name: '개수대', pos: 'lower', w: 1000, h: 708, d: 550, doorCount: 2, isDrawer: false, isEL: false, isFixed: true },
    { id: 'l2', type: 'storage', name: '서랍장', pos: 'lower', w: 800, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 2, isEL: false },
    { id: 'l3', type: 'storage', name: '하부장(2D)', pos: 'lower', w: 900, h: 708, d: 550, doorCount: 2, is2door: true, isDrawer: false, isEL: false },
    { id: 'l4', type: 'storage', name: 'EL장', pos: 'lower', w: 400, h: 708, d: 550, doorCount: 1, isDrawer: false, isEL: true },
    { id: 'l5', type: 'storage', name: '오픈장', pos: 'lower', w: 400, h: 708, d: 550, doorCount: 0, isDrawer: false, isEL: false, isOpen: true },
    { id: 'l6', type: 'cook', name: '가스대', pos: 'lower', w: 600, h: 708, d: 550, isDrawer: false, isEL: false, isFixed: true },
  ],
};

/**
 * 같은 설계, 몸통 18T. 골든 diff 가 `W−2T` 파생(W−30 → W−36)·뒷판·선반 깊이 등
 * 두께에서 파생되는 값만 바뀌고 도어(MDF 18T)는 그대로임을 보여 준다 (W12-1).
 */
const sink18 = {
  ...sink15,
  specs: { ...sink15.specs, bodyThickness: 18 },
  modules: sink15.modules.map((m) => ({ ...m })),
};

/**
 * 붙박이장 — 짧은옷(short) + 긴옷(long, 외부서랍 2) + 선반형(shelf, 내부서랍 1), 상몰딩 60, 좌측 몰딩.
 *
 * 걸리는 가지:
 *   short  상·하부장 분리, doorCount 미지정 → round(W/450)=2, 하부 선반 1
 *   long   단일 캐비닛, 외부서랍 2 → 서랍모듈 본체 + 서랍도어 2장 + EP 목찬넬 120 + 하단보강(828>600),
 *          도어 높이 = 좌대+bodyH−20 − 서랍 700
 *   shelf  upperH/lowerH 미지정 → floor(bodyH/2), 내부서랍 1 → 내부서랍 프레임 9종, 상·하 선반 2
 *   EP     상몰딩 60(≥60 산출), 좌측몰딩 60 + 덧대 30, 우측 None, 좌대 걸레받이, 모듈별 좌대(중간보강 W≥700)
 */
const wardrobe = {
  categoryId: 'wardrobe',
  w: 2700, h: 2400, d: 600,
  specs: {
    bodyThickness: 15,
    wardrobePedestal: 60, wardrobeMoldingH: 60,
    handleType: 'push',
    finishLeftType: 'Molding', finishLeftWidth: 60,
    finishRightType: 'None', finishRightWidth: 0,
  },
  modules: [
    { id: 'w1', type: 'wardrobe', name: '짧은옷(2단)', pos: 'wardrobe', w: 900, h: 2280, upperH: 1140, lowerH: 1140, d: 600, moduleType: 'short', isDivided: true, drawerCount: 0, shelfCount: 0, shelfCountUpper: 0, shelfCountLower: 1, rodCountUpper: 1, rodCountLower: 1, hasMirror: false, isExternalDrawer: false },
    { id: 'w2', type: 'wardrobe', name: '긴옷', pos: 'wardrobe', w: 900, h: 2280, d: 600, moduleType: 'long', isDivided: false, doorCount: 2, drawerCount: 2, shelfCount: 1, shelfCountUpper: 0, shelfCountLower: 0, rodCountUpper: 1, rodCountLower: 0, hasMirror: false, isExternalDrawer: true },
    { id: 'w3', type: 'wardrobe', name: '선반형', pos: 'wardrobe', w: 900, h: 2280, d: 600, moduleType: 'shelf', isDivided: true, doorCount: 2, drawerCount: 1, shelfCount: 0, shelfCountUpper: 2, shelfCountLower: 2, rodCountUpper: 0, rodCountLower: 0, hasMirror: false, isExternalDrawer: false },
  ],
};

/**
 * 냉장고장 — 냉장고(제외) + 키큰장 + 홈카페장 + 상부장 + 하부장 + EL장.
 *
 * 현재 UI(`addFridgeSideModule`)는 tall·homecafe 만 만들지만 `extractFridge` 는
 * upper·lower·el 가지도 갖고 있어(옛 저장 설계·플래너 변환) 부재표(§3-3) 전 가지를 한 번씩 건다.
 *   fridge   몸통 없음(제외)
 *   tall     PB 표준 + 선반 3 + 도어 H+20
 *   homecafe 전체 MDF 18T, 측판 D+20, 뒷판 18T, 선반 2, 천·지판 2면(가로)
 *   upper    PB 표준(선반 없음), 도어 H+20
 *   lower    사쿠리 없음(천·지판 D 그대로, 뒷판 W−2T×H−T), 도어 H−30
 *   el       뒷판까지만(도어·선반 없음)
 */
const fridge = {
  categoryId: 'fridge',
  w: 3300, h: 2290, d: 700,
  specs: {
    bodyThickness: 15,
    fridgeModuleD: 700, fridgeMoldingH: 60, fridgePedestal: 60,
    fridgeUpperH: 400, fridgeMiddleH: 973, fridgeLowerH: 797,
  },
  modules: [
    { id: 'r1', modelId: 'lg-500', type: 'fridge', name: 'LG 단독 500L', w: 700, h: 1850, d: 730, order: 2 },
    { id: 'r2', type: 'tall', name: '키큰장', order: 1, w: 600, h: 2290, d: 700, doorCount: 1, doorType: 'swing', lowerType: 'default', isFixed: false, isEL: false },
    { id: 'r3', type: 'homecafe', name: '홈카페장', order: 3, w: 900, h: 2290, d: 700, doorCount: 2, doorType: 'swing', lowerType: 'default', isFixed: false, isEL: false },
    { id: 'r4', type: 'upper', name: '냉장고상부장', order: 4, w: 700, h: 400, d: 700, doorCount: 1 },
    { id: 'r5', type: 'lower', name: '냉장고하부장', order: 5, w: 500, h: 797, d: 700, doorCount: 1 },
    { id: 'r6', type: 'el', name: 'EL장', order: 6, w: 600, h: 973, d: 700 },
  ],
};

/**
 * ㄱ자 싱크대 멍장 — 하부·상부 멍장(id `corner-blind-*`) + 코너 마감(몰딩 60).
 * 멍판 마감재 폭 `blindFinishW` 를 **일부러 안 준다** → 추출기 폴백(`CORNER_FINISH_PART_W`)이
 * 걸린다. 지금 플래너는 150 을 명시해 보내지만(ui-step1.js `blindFinishW: partW`), 옛 저장
 * 설계와 Node 시험은 이 폴백 경로를 탄다 — 정본(data-constants.js:89)과 어긋나면 여기서 드러난다.
 * 치수는 corner.md §3 확정 예시(extractors-corner.test.js): 하부 멍 665 + 도어 411, 상부 멍 345 + 도어 445.
 *   하부 멍장 Filler → 휠라(멍판) / 상부 멍장 Molding → 몰딩(멍판) / 멍장 선반은 목대 75 만큼 짧다
 */
const sinkCorner = {
  categoryId: 'sink',
  w: 1970, h: 2310, d: 650,
  specs: {
    bodyThickness: 15,
    lowerLayoutShape: 'L', upperLayoutShape: 'L',
    lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12, moldingH: 60,
    upperDoorOverlap: 15,
    handle: '찬넬',
    finishLeftType: 'None', finishRightType: 'None',
    finishCorner1Type: 'Molding', finishCorner1Width: 60,
  },
  modules: [
    { id: 'corner-blind-lower', type: 'storage', name: 'LT망장', pos: 'lower', w: 1076, h: 708, d: 650, doorCount: 1, doorW: 411, blindZoneW: 665, blindFinishType: 'Filler', blindKind: 'std' },
    { id: 'lc1', type: 'storage', name: '수납장', pos: 'lower', w: 411, h: 708, d: 650, doorCount: 1, isDrawer: false, isEL: false },
    { id: 'lc2', type: 'sink', name: '개수대', pos: 'lower', w: 1000, h: 708, d: 650, doorCount: 2, isDrawer: false, isEL: false, isFixed: true },
    { id: 'corner-blind-upper', type: 'storage', name: 'LT망장', pos: 'upper', w: 790, h: 720, d: 295, doorCount: 1, doorW: 445, blindZoneW: 345, blindFinishType: 'Molding', blindKind: 'std' },
    { id: 'uc1', type: 'storage', name: '상부장', pos: 'upper', w: 600, h: 720, d: 295, doorCount: 1, isDrawer: false, isEL: false },
  ],
};

// ============================================================
// B3: 단순 상자 카테고리 4종 (simple-categories.md §6) — 싱크대와 같은 범용 워크스페이스라 모듈 모양은
// ui-workspace.js addStorageModule/addModuleAtGap(pos upper|lower · type storage · w/h/d · isDrawer/drawerCount ·
// doorCount 는 팝업에서 고른 때만) · addTallModule(type tall, doorCount 1) 을 따랐고, 플래너 브리지가 더하는
// isOpen · shelfCount · heightParts 도 한 번씩 건다. 부재표 가지는 extractSimpleBox 주석과 같다.
// ============================================================

/**
 * 신발장 — 상부 2 + 하부 3(일반·서랍장·오픈선반), 목찬넬, 좌우 휠라 60, 깊이 350.
 *
 * 걸리는 가지:
 *   u1  doorCount 미지정 → round(900/450)=2 [확인 필요], shelfCount 미지정 → 신발장 분배 180~350: 705 → 2 [확인 필요]
 *   u2  doorCount 1 · shelfCount 3 명시 → 비고 없음
 *   l1  doorCount 미지정 → 2, 선반 분배 708 → 2, W≥800 → 처짐방지 2 (목찬넬 −70)
 *   l2  서랍장 500×서랍2, D350 → 레일 350: 측판 290·밑판 299, 전후판 428 ≤ 600 → 하단보강 없음,
 *       여닫이 도어 708−440−30=238 > 50 → 1장, 목찬넬 120
 *   l3  오픈(doorCount 0 · isOpen) 인데 shelfCount 3 명시 → 선반 3, 도어 없음
 *   EP  상몰딩 1500(≤2000 → 4면), 걸레받이 1800×145, 목찬넬 전면·지면, 휠라 좌·우
 *   철물 다리발 6+4+4, 레일 350 ×2, 브라켓 (2+3+2+0+3)×4, 경첩은 자재 행의 도어 수·높이와 같은 셈
 */
const shoerack = {
  categoryId: 'shoerack',
  w: 1800, h: 2310, d: 350,
  specs: {
    layoutShape: 'I',
    bodyThickness: 15,
    lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12, moldingH: 60,
    upperDoorOverlap: 15,
    handle: '찬넬 (목찬넬)',
    finishLeftType: 'Filler', finishLeftWidth: 60,
    finishRightType: 'Filler', finishRightWidth: 60,
    doorColorUpper: '화이트', doorFinishUpper: '무광',
    doorColorLower: '화이트', doorFinishLower: '무광',
  },
  modules: [
    { id: 'u1', type: 'storage', name: '상부장', pos: 'upper', w: 900, h: 705, d: 295, isDrawer: false, isEL: false, isFixed: false },
    { id: 'u2', type: 'storage', name: '상부장', pos: 'upper', w: 600, h: 705, d: 295, doorCount: 1, shelfCount: 3, isDrawer: false, isEL: false, isFixed: false },
    { id: 'l1', type: 'storage', name: '하부장', pos: 'lower', w: 900, h: 708, d: 350, isDrawer: false, isEL: false, isFixed: false },
    { id: 'l2', type: 'storage', name: '서랍장', pos: 'lower', w: 500, h: 708, d: 350, isDrawer: true, drawerCount: 2, isEL: false, isFixed: false },
    { id: 'l3', type: 'storage', name: '오픈선반', pos: 'lower', w: 400, h: 708, d: 350, doorCount: 0, isOpen: true, shelfCount: 3, isDrawer: false, isEL: false },
  ],
};

/**
 * 화장대 — 몸통 18T, 손잡이 '찬넬'(목찬넬 아님), 우측 마감 None, 깊이 500.
 *
 * 걸리는 가지:
 *   18T  W−2T = W−36, 뒷판 (W−36)×(H−18), 도어는 그대로 18T MDF
 *   목찬넬 아님 → 처짐방지 −70 없음, EP 목찬넬 없음, 서랍장 목찬넬 120 은 서랍 규칙이라 그대로
 *   u2  shelfCount 0 명시 → 선반 없음 (기본 2 를 타지 않는다)
 *   l1  서랍장 800×서랍3, D500 → 레일 500: 측판 440·밑판 449 (싱크와 같다), 전후판 722 > 600 → 하단보강,
 *       여닫이 도어 708−660−30=18 ≤ 50 → 없음
 *   l2  doorCount 1, shelfCount 미지정 → 싱크 규칙 하부 1 [확인 필요]
 *   EP  우측 None → 휠라(우) 없음
 *   [확인 필요] 거울장·상판은 규칙이 없어 내지 않는다 (simple-categories.md §6.5)
 */
const vanity = {
  categoryId: 'vanity',
  w: 1400, h: 2310, d: 500,
  specs: {
    layoutShape: 'I',
    bodyThickness: 18,
    lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12, moldingH: 60,
    upperDoorOverlap: 15,
    handle: '찬넬',
    finishLeftType: 'Filler', finishLeftWidth: 60,
    finishRightType: 'None', finishRightWidth: 0,
    doorColorUpper: '화이트', doorFinishUpper: '무광',
    doorColorLower: '화이트', doorFinishLower: '무광',
  },
  modules: [
    { id: 'u1', type: 'storage', name: '상부장', pos: 'upper', w: 800, h: 705, d: 295, doorCount: 2, isDrawer: false, isEL: false, isFixed: false },
    { id: 'u2', type: 'storage', name: '상부장', pos: 'upper', w: 600, h: 705, d: 295, doorCount: 1, shelfCount: 0, isDrawer: false, isEL: false, isFixed: false },
    { id: 'l1', type: 'storage', name: '서랍장', pos: 'lower', w: 800, h: 708, d: 500, isDrawer: true, drawerCount: 3, isEL: false, isFixed: false },
    { id: 'l2', type: 'storage', name: '하부장', pos: 'lower', w: 600, h: 708, d: 500, doorCount: 1, isDrawer: false, isEL: false, isFixed: false },
  ],
};

/**
 * 수납장 — 통짜 키큰장 + 하부 2 + 상부 2, 목찬넬, 좌우 휠라, 깊이 400.
 *
 * 걸리는 가지:
 *   t1  통짜 키큰장(heightParts 없음 → 'single'): 좌대 상자 + 상몰딩 + 목찬넬 그 단에, shelfCount 4 명시,
 *       도어 2 · H−30 (목찬넬 단). 라인 폭(걸레받이·목찬넬)에서 뺀다
 *   l2  서랍장 900×서랍1, D400 → 레일 450: 측판 390·밑판 399, 전후판 828 > 600 → 하단보강,
 *       서랍 1개 → 전판 250, 여닫이 도어 708−220−30=458 → 2장
 *   l1·u1·u2  doorCount 2 명시, shelfCount 미지정 → 싱크 규칙(상부 2·하부 1) [확인 필요]
 *   EP  상몰딩 1800 ≤ 2000 → 4면, 걸레받이 1800(키큰장 600 제외)
 *   철물 다리발은 키큰장 단을 뺀다 (좌대), 레일 450 ×1
 */
const storage = {
  categoryId: 'storage',
  w: 2400, h: 2310, d: 400,
  specs: {
    layoutShape: 'I',
    bodyThickness: 15,
    lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12, moldingH: 60,
    upperDoorOverlap: 15,
    handle: '찬넬 (목찬넬)',
    finishLeftType: 'Filler', finishLeftWidth: 60,
    finishRightType: 'Filler', finishRightWidth: 60,
    doorColorUpper: '화이트', doorFinishUpper: '무광',
    doorColorLower: '화이트', doorFinishLower: '무광',
  },
  modules: [
    { id: 't1', type: 'tall', name: '키큰장(TL)', pos: 'lower', w: 600, h: 2190, d: 400, doorCount: 2, shelfCount: 4, elCount: 0, isDrawer: false, isEL: false, isFixed: false },
    { id: 'l1', type: 'storage', name: '하부장', pos: 'lower', w: 900, h: 708, d: 400, doorCount: 2, isDrawer: false, isEL: false, isFixed: false },
    { id: 'l2', type: 'storage', name: '서랍장', pos: 'lower', w: 900, h: 708, d: 400, isDrawer: true, drawerCount: 1, isEL: false, isFixed: false },
    { id: 'u1', type: 'storage', name: '상부장', pos: 'upper', w: 900, h: 705, d: 295, doorCount: 2, isDrawer: false, isEL: false, isFixed: false },
    { id: 'u2', type: 'storage', name: '상부장', pos: 'upper', w: 900, h: 705, d: 295, doorCount: 2, isDrawer: false, isEL: false, isFixed: false },
  ],
};

/**
 * 창고장 — 플래너 브리지 모양의 키큰장 3단 스택 + 하부 1 + 상부 1, 좌측 몰딩·우측 EP 20, 깊이 450.
 *
 * 걸리는 가지:
 *   planner-x-0/1/2  heightParts 로 하부단(좌대·목찬넬·H−30)·중간단(H−4)·상부단(상몰딩·H−4) 이 갈린다 (sink.md §5.1),
 *                    shelfCount 1/2/0 명시 (0 은 선반 없음)
 *   l1  1200×2D, D450 그대로(mod.d 없음 → item.d 450), shelfCount 미지정 → 1 [확인 필요]
 *   u1  1200×2D, shelfCount 1 명시
 *   EP  몰딩(좌) 60 · EP(우) 20 · 걸레받이 1200(스택 800 제외)
 *   철물 경첩은 단별 도어 H(bomTallTierDoorH), 다리발은 스택을 뺀 1200 → 8
 */
const warehouse = {
  categoryId: 'warehouse',
  w: 2000, h: 2310, d: 450,
  specs: {
    layoutShape: 'I',
    bodyThickness: 15,
    lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12, moldingH: 60,
    upperDoorOverlap: 15,
    handle: '찬넬 (목찬넬)',
    finishLeftType: 'Molding', finishLeftWidth: 60,
    finishRightType: 'EP', finishRightWidth: 20,
    doorColorUpper: '화이트', doorFinishUpper: '무광',
    doorColorLower: '화이트', doorFinishLower: '무광',
  },
  modules: [
    { id: 'planner-x-0', type: 'tall', name: '키큰장', pos: 'lower', w: 800, h: 750, totalH: 810, heightParts: { pedestalH: 60, moldingH: 0 }, d: 450, doorCount: 2, is2door: true, shelfCount: 1 },
    { id: 'planner-x-1', type: 'tall', name: '키큰장', pos: 'lower', w: 800, h: 780, totalH: 780, heightParts: { pedestalH: 0, moldingH: 0 }, d: 450, doorCount: 2, is2door: true, shelfCount: 2 },
    { id: 'planner-x-2', type: 'tall', name: '키큰장', pos: 'lower', w: 800, h: 600, totalH: 660, heightParts: { pedestalH: 0, moldingH: 60 }, d: 450, doorCount: 2, is2door: true, shelfCount: 0 },
    { id: 'l1', type: 'storage', name: '하부장', pos: 'lower', w: 1200, h: 708, doorCount: 2, isDrawer: false, isEL: false, isFixed: false },
    { id: 'u1', type: 'storage', name: '상부장', pos: 'upper', w: 1200, h: 705, d: 295, doorCount: 2, shelfCount: 1, isDrawer: false, isEL: false, isFixed: false },
  ],
};

const FIXTURES = { sink15, sink18, sinkCorner, wardrobe, fridge, shoerack, vanity, storage, warehouse };

/** 추출기 입력(`exportDesign()` 모양). 픽스처를 깊은 복사해 추출기가 원본을 건드려도 서로 새지 않게 한다. */
function designOf(fixture) {
  return { appVersion: 'golden', items: [JSON.parse(JSON.stringify(fixture))] };
}

module.exports = { FIXTURES, sink15, sink18, sinkCorner, wardrobe, fridge, shoerack, vanity, storage, warehouse, designOf };
