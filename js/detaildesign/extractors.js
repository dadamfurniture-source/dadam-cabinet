      // ============================================================
      // 자재 추출 클래스 (Material Extractor) V2.0
      // SKILL: material-extractor-v2.md 기반
      // ============================================================
      /**
       * W12-53: 멍장 모듈인가.
       *
       * 예전엔 id 를 `=== 'corner-blind-lower'` 로 **정확히** 비교했다. 코너가
       * 하나뿐인 ㄱ자에서는 맞았지만, ㄷ자는 한 단에 멍장이 둘이라 두 번째가 이
       * 가지에 안 걸린다. 그러면 도어가 **카카스 폭**으로 나가고(1133 → 1129)
       * 멍가림판이 통째로 빠진다 — 멍장 하나당 도어 700mm 과잉 + 2.7T 누락이라
       * 화면에는 아무 표시도 없는 오발주다.
       *
       * 접두어로 본다 — `corner-blind-lower`, `corner-blind-lower-2`,
       * `corner-blind-upper` …
       */
      function isBlindModule(mod, pos) {
        return String((mod && mod.id) || '').indexOf('corner-blind-' + pos) === 0;
      }

      // 2026-09-15: 서랍장·목찬넬·레일 규칙은 js/detaildesign/bom-drawer-rules.js 한 곳에 있다.
      //   브라우저(detaildesign.html)는 그 파일을 extractors.js 앞에 실어 전역 DadamDrawerRules 를 주고,
      //   Node 시험은 require 로 받는다. 규칙 숫자를 여기 다시 적지 않는다.
      const DrawerRules = (typeof DadamDrawerRules !== 'undefined') ? DadamDrawerRules
        : (typeof require === 'function' ? require('./bom-drawer-rules.js') : null);

      // 2026-09-16: 붙박이장 통 내부 구조(칸·칸막이·선반·옷봉) 규칙도 같은 방식으로 한 곳에 있다.
      //   js/detaildesign/bom-wardrobe-rules.js — 플래너도 같은 파일을 읽는다.
      const WardrobeRules = (typeof DadamWardrobeRules !== 'undefined') ? DadamWardrobeRules
        : (typeof require === 'function' ? require('./bom-wardrobe-rules.js') : null);
      /** 붙박이장 기본값 — 규칙 파일이 정본. 없으면(구형 로드) 문서값으로 버틴다. */
      const WR_DEFAULTS = (WardrobeRules && WardrobeRules.WARDROBE_RULES)
        || { DEFAULT_D: 620, DEFAULT_H: 2310, PEDESTAL_H: 60, MOLDING_H: 20 };

      // ============================================================
      // B1: 부재 식별자 (partId) · 슬롯 — 계획 §5 B1, bom-protocol.md §7-1
      //
      //   partId = `${itemIdx}-${moduleId}-${partKey}-${n}`
      //     itemIdx   design.items 의 순번 (BOM 이 안 나오는 품목도 센다 — 문서·플래너와 같은 번호)
      //     moduleId  플래너/상세설계 모듈 id (mod.id). 없으면 `${pos|type}-${idx}`.
      //               품목 단위 마감재(EP) 행은 'ep'. id 에 '-' 가 들어갈 수 있어 partId 를 쪼개 읽지 않는다.
      //     partKey   부재 종류의 안정된 키 (아래 표). 같은 종류가 한 모듈에 여럿이면 `#k` (0부터).
      //     n         같은 (품목, 모듈, partKey) 가 되풀이될 때의 순번 — 보통 0.
      //
      //   partKey 는 플래너 디테일 모델(js/planner/planner-finish.js plannerFinishPartKeyOf)의 키와
      //   **같은 이름**을 쓴다 — `door#1`, `drawer#0`, `body:left`, `shelf#…`, `kick`, `pedestal`, `molding`,
      //   `blind#0`, `blindfin#0`, `channel:…`. 다만 BOM 행은 수량으로 묶여 있어(측판 qty 2 = 좌+우) 한 행이
      //   플래너 부재 여러 개를 대표한다. 그래서 행 키는 `body:side` 처럼 묶음 이름이고, 부재 단위 지정은
      //   BOM_PART_KEY_ALIASES 로 그 행에 닿는다 (resolveFinish 참고).
      //
      //   slot 은 planner-finish.js 의 7 슬롯 + `back`(뒷판·서랍밑판 2.7T — 칠하지 않는다). slot 이 null 인
      //   행은 없다 — 표에 없는 부재 이름은 `part:<이름>` 키 + slot null 로 떨어지지만 시험이 그걸 막는다.
      // ============================================================
      const BOM_PART_DEFS = {
        // 몸통 (PB T) — 측판은 좌·우 한 행
        '측판':            { key: 'body:side',        slot: 'body' },
        '천판':            { key: 'body:top',         slot: 'body' },
        '지판':            { key: 'body:bottom',      slot: 'body' },
        '뒷판':            { key: 'back',             slot: 'back' },
        '선반':            { key: 'shelf',            slot: 'body', indexed: true },
        '밴드':            { key: 'body:band',        slot: 'body', indexed: true },
        '밴드(보강목)':    { key: 'body:band',        slot: 'body', indexed: true },
        '밴드(처짐방지)':  { key: 'body:brace',       slot: 'body', indexed: true },
        '경첩목대(앞다리)': { key: 'body:batten-front', slot: 'body' },
        '경첩목대(옆다리)': { key: 'body:batten-side',  slot: 'body' },
        // 전면 (MDF 18T)
        '도어':            { key: 'door',             slot: 'door', indexed: true },
        '서랍도어':        { key: 'drawer',           slot: 'drawerFront', indexed: true },
        // 서랍 상자 (PB T / 밑판 2.7T)
        '서랍전후판':      { key: 'drawerbox:fb',     slot: 'body' },
        '서랍측판':        { key: 'drawerbox:side',   slot: 'body' },
        '서랍밑판':        { key: 'drawerbox:bottom', slot: 'back' },
        '서랍 하단보강':   { key: 'drawerbox:brace',  slot: 'body' },
        '내부서랍 상판':   { key: 'innerdrawer:top',    slot: 'body' },
        '내부서랍 측판':   { key: 'innerdrawer:side',   slot: 'body' },
        '내부서랍 지판':   { key: 'innerdrawer:bottom', slot: 'body' },
        '내부서랍 밴드':   { key: 'innerdrawer:band',   slot: 'body' },
        '내부서랍 좌우몰딩': { key: 'innerdrawer:molding', slot: 'body' },
        '내부서랍 전면판': { key: 'innerdrawer:front',  slot: 'body' },
        // 2026-09-17: 붙박이장 통 내부 칸막이 (bom-wardrobe-rules.js dividersOf)
        //   중간칸막이 = 수평 판 (문서 §11 행), 세로칸막이 = 세로 판 (반 분할·옆 분할)
        '중간칸막이':      { key: 'divider:h',        slot: 'body' },
        '세로칸막이':      { key: 'divider:v',        slot: 'body' },
        // 손잡이 자리 (목찬넬)
        '목찬넬':          { key: 'channel:front',    slot: 'handle' },
        '목찬넬(전면)':    { key: 'channel:front',    slot: 'handle' },
        '목찬넬(지면)':    { key: 'channel:back',     slot: 'handle' },
        // 2026-09-15: 서랍장 중간 목찬넬 (따내기 90×40 = 전면판 72 + 지면판 18) — 모듈 폭, 모듈 단위 부재
        '목찬넬(중간 전면)': { key: 'channel:mid-front', slot: 'handle' },
        '목찬넬(중간 지면)': { key: 'channel:mid-back',  slot: 'handle' },
        // 마감재 — EP·몰딩·휠라·멍판
        '상몰딩':          { key: 'molding',          slot: 'finishing' },
        '좌측몰딩':        { key: 'molding:left',     slot: 'finishing' },
        '우측몰딩':        { key: 'molding:right',    slot: 'finishing' },
        '좌측몰딩 덧대':   { key: 'molding:left-pad', slot: 'finishing' },
        '우측몰딩 덧대':   { key: 'molding:right-pad', slot: 'finishing' },
        '몰딩(좌)':        { key: 'molding:left',     slot: 'finishing' },
        '몰딩(우)':        { key: 'molding:right',    slot: 'finishing' },
        '몰딩(코너1)':     { key: 'molding:corner1',  slot: 'finishing' },
        '몰딩(코너2)':     { key: 'molding:corner2',  slot: 'finishing' },
        '휠라(좌)':        { key: 'filler:left',      slot: 'finishing' },
        '휠라(우)':        { key: 'filler:right',     slot: 'finishing' },
        '휠라(코너1)':     { key: 'filler:corner1',   slot: 'finishing' },
        '휠라(코너2)':     { key: 'filler:corner2',   slot: 'finishing' },
        'EP(좌)':          { key: 'ep:left',          slot: 'finishing' },
        'EP(우)':          { key: 'ep:right',         slot: 'finishing' },
        '멍가림판':        { key: 'blind',            slot: 'finishing', indexed: true },
        '멍판 EP':         { key: 'blind',            slot: 'finishing', indexed: true },
        '휠라(멍판)':      { key: 'blindfin',         slot: 'finishing', indexed: true },
        '몰딩(멍판)':      { key: 'blindfin',         slot: 'finishing', indexed: true },
        // 상판 — 하부 라인 한 장 (P1-3, bom-protocol.md §2 두께 · §3-1 상판)
        '상판':            { key: 'top',              slot: 'top' },
        // 바닥 마감 — 걸레받이·좌대
        '걸레받이':        { key: 'kick',             slot: 'kick' },
        '좌대 걸레받이':   { key: 'kick',             slot: 'kick' },
        '좌대 전후':       { key: 'pedestal:fb',      slot: 'kick' },
        '좌대 측':         { key: 'pedestal:side',    slot: 'kick' },
        '좌대 중간보강':   { key: 'pedestal:brace',   slot: 'kick' },
      };

      /** 부재 이름 → {key, slot, indexed}. 표에 없으면 `part:<이름>` + slot null (시험이 잡는다). */
      function bomPartDefOf(part) {
        const def = BOM_PART_DEFS[part];
        if (def) return def;
        return { key: 'part:' + String(part || '').trim().replace(/\s+/g, '_'), slot: null, fallback: true };
      }

      // ============================================================
      // P1-1: 키큰장 단 판별 — 싱크대 하부 라인의 `type:'tall'` 모듈은 하부장이 아니다 (sink.md §5).
      //
      // 플래너 브리지(ui-step1.js _convertPlannerModules)는 키큰장 스택의 단(하부장·중간장·상부장)을
      // 각각 `pos:'lower', type:'tall'` 로 보내고, 단이 짊어진 부위를 `heightParts` 에 남긴다
      // (mockup-structure.html stackForArea: 맨 아래 단만 pedestalH, 맨 위 단만 moldingH, 중간은 둘 다 0).
      // 상세설계 화면의 키큰장(ui-workspace.js addTallModule)은 단이 없는 **한 장** — heightParts 가 없다.
      //
      //   'bottom'  좌대를 짊어진 단 — 목찬넬·좌대가 여기
      //   'middle'  좌대도 상몰딩도 없는 단 — 푸쉬 도어
      //   'top'     상몰딩을 짊어진 단 — 푸쉬 도어·상몰딩
      //   'single'  단 정보가 없는 통짜 키큰장 — 좌대·상몰딩 모두 (상세설계 화면 · 옛 저장 설계)
      //   null      키큰장이 아니다
      // 멍장 키큰장(corner-blind, blindKind 'tall')도 단이다 — 폭이 걸레받이에 세 번 더해지는 같은 결함이 있었다.
      // ============================================================
      function bomTallTierOf(mod) {
        if (!mod) return null;
        if (mod.type !== 'tall' && mod.blindKind !== 'tall') return null;
        const hp = mod.heightParts;
        if (!hp || typeof hp !== 'object') return 'single';
        const ped = parseFloat(hp.pedestalH);
        const mold = parseFloat(hp.moldingH);
        const hasPed = Number.isFinite(ped) && ped > 0;
        const hasMold = Number.isFinite(mold) && mold > 0;
        if (hasPed && hasMold) return 'single';
        if (hasPed) return 'bottom';
        if (hasMold) return 'top';
        return 'middle';
      }

      const BOM_TALL_TIER_LABEL = { bottom: '하부단', middle: '중간단', top: '상부단', single: '' };

      /** 키큰장 단이 목찬넬을 짊어지는가 — 바닥 단(하부단·통짜) + 목찬넬 손잡이 스펙. 도어 H·처짐방지·목찬넬 부재가 이걸 본다. */
      function bomTallTierHasChannel(tier, specs) {
        const grounded = tier === 'bottom' || tier === 'single';
        return grounded && String((specs && specs.handle) || '').includes('목찬넬');
      }

      // 키큰장 단의 도어 높이 (sink.md §5.1) — 목찬넬 단만 H−30 (목찬넬 틈, 하부장과 같다), 나머지(푸쉬)는 H−4 (도어 간격 4).
      // 자재 행(addTallTierParts)과 경첩 수(HardwareExtractor.extractHinges)가 **같은 함수**를 쓴다 — 경첩이 하부장 가정
      // (H−30)으로 도어 높이를 따로 셈해 푸쉬 단 경첩 수가 어긋나던 결함(bom-protocol.md §4-1).
      function bomTallTierDoorH(mod, tier, specs) {
        const H = parseFloat(mod && mod.h) || 0;
        return bomTallTierHasChannel(tier, specs) ? H - 30 : H - 4;
      }

      // ============================================================
      // B3: 단순 상자 카테고리 — 신발장·화장대·수납장·창고장 (simple-categories.md §6, 계획 §5 B3)
      //
      // 네 카테고리는 싱크대와 같은 **범용 워크스페이스**(상부 + 하부 2행 + 키큰장, simple-categories.md §3)를 쓰고
      // DEFAULT_SPECS(상부 720 · 하부 870 · 상몰딩 60 · 다리발 150 · 좌우 휠라 60, §2)를 그대로 상속한다. 모듈 모양도
      // 싱크대와 같다 — ui-workspace.js addStorageModule/addModuleAtGap/addTallModule 이 `pos upper|lower · type storage|tall ·
      // w/h/d · isDrawer/drawerCount · doorCount` 를 만들고, 플래너 브리지(ui-step1.js _convertPlannerModules)는 isOpen ·
      // shelfCount · heightParts 를 더한다. 그래서 몸통 부재표는 bom-protocol.md §3-1(싱크대 상부장·하부장)과
      // sink.md §5.1(키큰장 단, addTallTierParts 그대로)을 **준용**하고, 싱크대에만 있는 것(개수대·쿡탑·상판·코너 마감)은
      // 내지 않는다. 카테고리 차이는 아래 표의 상수뿐이라 추출기는 하나(extractSimpleBox)다.
      //
      //   label      품목 라벨 (data-constants.js CATEGORIES 의 name)
      //   defaultD   하부 모듈 깊이 폴백 — mod.d → item.d → 이 값 (simple-categories.md §1 기본 깊이)
      //   upperD     상부 모듈 깊이 폴백 (ui-workspace.js addStorageModule 의 295 — 싱크대와 같다)
      //   shelfSpace 선반 기본 개수 규칙 — 모듈에 shelfCount 가 없을 때. null 이면 싱크 규칙(상부 2 · 하부 1 · 키큰장 1).
      //              신발장은 플래너 선반 분배 규칙(js/planner/planner-engine.js calcDefaultShelves,
      //              MASTER_RULES.SHELF_SPACE_MIN/MAX_SHOE = 180~350)으로 몸통 H 에서 센다 — 얕은 칸이 촘촘한 장이라
      //              싱크 규칙(2/1)이면 칸이 대부분 비어 나간다 (simple-categories.md §5 "오픈선반").
      //
      // categoryId 는 data-constants.js CATEGORIES 의 id 그대로다 (`shoerack`·`vanity`·`storage`·`warehouse`).
      // 플래너 프리셋 이름 `shoe`(ui-step1.js fullHeightPresets · planner-engine.js section) 는 품목 id 가 아니라 여기 없다.
      // 문서(simple-categories.md)에 없는 값은 싱크·붙박이장 규칙을 빌리고 행 비고에 [확인 필요] 를 남긴다 — 목록은 §6.5.
      // ============================================================
      const BOM_SIMPLE_CATEGORY_RULES = {
        shoerack:  { label: '신발장', defaultD: 350, upperD: 295, shelfSpace: { min: 180, max: 350 } },
        vanity:    { label: '화장대', defaultD: 500, upperD: 295, shelfSpace: null },
        storage:   { label: '수납장', defaultD: 400, upperD: 295, shelfSpace: null },
        warehouse: { label: '창고장', defaultD: 450, upperD: 295, shelfSpace: null },
      };

      /** 문서에 없어 붙박이장 규칙을 빌린 행의 비고 — simple-categories.md §6.5 목록과 같은 문구. */
      const BOM_SIMPLE_NOTE_WARDROBE = '[확인 필요] simple-categories.md 에 없음 — 붙박이장 규칙 준용';
      /** 문서에 없어 싱크대 규칙을 빌린 행의 비고. */
      const BOM_SIMPLE_NOTE_SINK = '[확인 필요] simple-categories.md 에 없음 — 싱크대 규칙 준용';

      /** 서랍레일 길이 — 캐비닛 깊이별 (bom-protocol.md §4-2 · HardwareExtractor.extractRails 와 같은 문턱). */
      function bomSimpleRailLenOf(depth) {
        const d = parseFloat(depth) || 550;
        if (d <= 350) return 350;
        if (d <= 450) return 450;
        return 500;
      }

      /** 하부 모듈 깊이 — mod.d → item.d → 카테고리 기본 깊이 (simple-categories.md §1). 상부는 upperD. */
      function bomSimpleDepthOf(mod, pos, item, rules) {
        const md = parseFloat(mod && mod.d);
        if (Number.isFinite(md) && md > 0) return md;
        if (pos === 'upper') return rules.upperD;
        const id = parseFloat(item && item.d);
        return (Number.isFinite(id) && id > 0) ? id : rules.defaultD;
      }

      /**
       * 선반 기본 개수 — 모듈 shelfCount 가 없을 때.
       *   shelfSpace 있음(신발장)  planner-engine.js calcDefaultShelves 와 같은 식: 분배 공간 H/(n+1) 이 min~max 안에 들도록
       *   없음                    싱크 규칙 — 상부 2 (bom-protocol.md §3-1 상부장), 하부 1 (하부장), 키큰장 통짜 1 (sink.md §5.1)
       */
      function bomSimpleDefaultShelfCount(H, pos, rules) {
        const sp = rules && rules.shelfSpace;
        if (!sp) return pos === 'upper' ? 2 : 1;
        const h = parseFloat(H) || 0;
        let count = Math.max(0, Math.floor(h / sp.min) - 1);
        if (count === 0) return 0;
        if (h / (count + 1) > sp.max) count = Math.max(0, Math.ceil(h / sp.max) - 1);
        return count;
      }

      /**
       * 한 모듈이 내는 선반 수 — 자재 행(extractSimpleBox)과 선반 브라켓(HardwareExtractor.extractBrackets)이 **같은 함수**를 쓴다.
       *   shelfCount 가 숫자면 그대로 (0 이면 없음 — 플래너 브리지가 준다, 오픈 칸이라도 지정값이 있으면 낸다)
       *   아니면 서랍·EL·오픈(isOpen 또는 doorCount 0) 모듈은 0 (싱크 하부장 규칙), 그 밖은 기본 규칙(bomSimpleDefaultShelfCount)
       * @returns {{qty:number, defaulted:boolean}} defaulted = 기본 규칙으로 정했다 (행 비고에 [확인 필요] 를 남긴다)
       */
      function bomSimpleShelfQtyOf(mod, rules) {
        const m = mod || {};
        const raw = Number(m.shelfCount);
        if (Number.isFinite(raw)) return { qty: Math.max(0, Math.round(raw)), defaulted: false };
        const tier = bomTallTierOf(m);
        const pos = tier ? 'tall' : (m.pos === 'upper' ? 'upper' : 'lower');
        if (!tier) {
          const rawDoor = Number(m.doorCount);
          const open = !!m.isOpen || (Number.isFinite(rawDoor) && rawDoor === 0);
          if (m.isDrawer || m.isEL || open) return { qty: 0, defaulted: false };
        }
        return { qty: bomSimpleDefaultShelfCount(m.h, pos, rules), defaulted: true };
      }

      /** 도어 수 — 모듈 doorCount 가 숫자면 그대로(0 존중), 없으면 오픈은 0, 아니면 round(W/450) (붙박이장 규칙 준용 → 비고). */
      function bomSimpleDoorCountOf(mod, W) {
        const raw = Number(mod && mod.doorCount);
        if (Number.isFinite(raw)) return { count: Math.max(0, Math.round(raw)), defaulted: false };
        if (mod && mod.isOpen) return { count: 0, defaulted: false };
        return { count: Math.max(1, Math.round(W / 450)), defaulted: true };
      }

      /**
       * 한 모듈의 여닫이 도어 수·재단 높이 — 자재 행(extractSimpleBox)과 철물(HardwareExtractor 경첩·손잡이)이 같은 답을 낸다.
       *   상부장   bomSimpleDoorCountOf · H + overlap
       *   하부장   서랍장이면 서랍 아래 여닫이(hingeDoorH > 50 → round(W/450)) · 그 높이, 아니면 bomSimpleDoorCountOf · H − 30
       *   키큰장 단  doorCount 그대로 · bomTallTierDoorH (addTallTierParts 와 같다)
       * @returns {{count:number, doorH:number}}
       */
      function bomSimpleHingeDoorsOf(mod, specs) {
        const m = mod || {};
        const s = specs || {};
        const W = parseFloat(m.w) || 600;
        const tier = bomTallTierOf(m);
        if (tier) return { count: m.doorCount || 0, doorH: bomTallTierDoorH(m, tier, s) };
        if (m.pos === 'upper') {
          const overlap = parseFloat(s.upperDoorOverlap) || 15;
          const H = parseFloat(m.h) || (parseFloat(s.upperH) || 720) - overlap;
          return { count: bomSimpleDoorCountOf(m, W).count, doorH: H + overlap };
        }
        const H = parseFloat(m.h) || (parseFloat(s.lowerH) || 870) - (parseFloat(s.topThickness) || 12) - (parseFloat(s.sinkLegHeight) || 150);
        if (m.isDrawer) {
          const hingeDoorH = H - 220 * (m.drawerCount || 1) - 30;
          return { count: hingeDoorH > 50 ? Math.max(1, Math.round(W / 450)) : 0, doorH: hingeDoorH };
        }
        return { count: bomSimpleDoorCountOf(m, W).count, doorH: H - 30 };
      }

      // ============================================================
      // P1-3: 상판 마감 코드 — 품목 사양 `specs.topColor`(한글) → materials.code `TOP-*`.
      // 정본은 config-constants.js FurnitureOptionCatalog._LEGACY_CODE_MAP.countertop (database/materials-catalog-v2.sql
      // 시드와 같다). 그 파일이 없는 환경(Node 시험)용으로 같은 값을 폴백으로 둔다. 이미 코드면 그대로.
      // ============================================================
      const BOM_TOP_CODE_FALLBACK = { '스노우': 'TOP-SNW', '마블화이트': 'TOP-MWH', '그레이마블': 'TOP-GMB', '차콜': 'TOP-CHC' };

      function bomTopCodeOf(topColor) {
        const s = String(topColor || '').trim();
        if (!s) return '';
        if (/^TOP-/i.test(s)) return s.toUpperCase();
        const cat = (typeof window !== 'undefined' && window.FurnitureOptionCatalog
          && window.FurnitureOptionCatalog._LEGACY_CODE_MAP) || null;
        const map = (cat && cat.countertop) || BOM_TOP_CODE_FALLBACK;
        return map[s] || BOM_TOP_CODE_FALLBACK[s] || '';
      }

      // ============================================================
      // B1: 마감 코드 해석 — 디테일 모델(item.detail, 계획 §4.2) 을 읽는다.
      //
      // 정본 해석기는 js/planner/planner-finish.js `plannerFinishResolve` (부재 > 모듈 > 섹션 > 품목).
      // 상세설계 페이지는 그 파일을 extractors.js 앞에 싣는다 (detaildesign.html). 아래 내장판은 그 파일이
      // 없는 환경(Node 시험·옛 페이지)용이며 **같은 답**을 내야 한다 — bom-part-id.test.js 가 둘을 대조한다.
      // 여기 로직을 고치려면 planner-finish.js 를 먼저 고치고 옮겨 적는다.
      // ============================================================
      function bomFinishSectionGroup(section) {
        return (section === 'upper' || section === 'hood') ? 'upper' : 'lower';
      }

      function bomFinishEntry(v) {
        if (!v) return null;
        const code = typeof v === 'string' ? v : v.code;
        if (typeof code !== 'string' || !code.trim()) return null;
        return { code: code.trim() };
      }

      function bomFinishResolveEmbedded(detail, slot, moduleId, section, partKey) {
        if (!detail || !slot) return null;
        if (moduleId && partKey && detail.parts && detail.parts[moduleId]) {
          const e = bomFinishEntry(detail.parts[moduleId][partKey]);
          if (e) return { code: e.code, level: 'part' };
        }
        if (moduleId && detail.modules && detail.modules[moduleId]) {
          const e = bomFinishEntry(detail.modules[moduleId][slot]);
          if (e) return { code: e.code, level: 'module' };
        }
        if (section && detail.sections) {
          const g = bomFinishSectionGroup(section);
          const e = bomFinishEntry(detail.sections[g] && detail.sections[g][slot]);
          if (e) return { code: e.code, level: 'section' };
        }
        if (detail.item) {
          const e = bomFinishEntry(detail.item[slot]);
          if (e) return { code: e.code, level: 'item' };
        }
        return null;
      }

      /** item.detail 이 문자열(JSON)·객체·없음 어느 것이어도 객체 또는 null. 플래너 normalize 가 있으면 그것으로. */
      function bomDetailOf(raw) {
        let d = raw;
        if (typeof d === 'string') {
          try { d = JSON.parse(d); } catch (e) { d = null; }
        }
        if (!d || typeof d !== 'object') return null;
        if (typeof window !== 'undefined' && typeof window.plannerFinishNormalize === 'function') {
          return window.plannerFinishNormalize(d);
        }
        return d;
      }

      /**
       * BOM 행 하나가 플래너 부재 여럿을 대표하므로, 부재 단위 지정이 행에 닿도록 **후보 (moduleId, partKey)** 를 늘어놓는다.
       *   · 묶음 행 별칭: 측판(body:side) ← body:left / body:right
       *   · 양문·칸 접미: door#k ← door#k-0, door#k-1 (plannerFinishPartKeyOf 의 `-doorIdx`), shelf#k ← shelf#k-*
       *   · 플래너 셀 모듈: 상세설계가 플래너 모듈 X 의 칸 i 를 `planner-X-i` 모듈로 쪼갠다 (ui-step1.js _convertPlannerModules).
       *     그 행의 door#0 은 플래너에선 X 의 door#i (또는 door#i-*, 하단 서랍줄 drawer#bi) 다. 모듈 단위 지정도 X 에 있다.
       * 순서는 곧 우선순위다 — 같은 단계(level)면 앞선 후보가 이긴다.
       */
      const BOM_PART_KEY_ALIASES = { 'body:side': ['body:left', 'body:right'] };

      function bomFinishCandidates(detail, moduleId, partKey) {
        const out = [];
        const seen = {};
        const push = (mid, key) => {
          const k = `${mid} ${key}`;
          if (mid && key && !seen[k]) { seen[k] = 1; out.push({ moduleId: mid, partKey: key }); }
        };
        const prefixed = (mid, key) => {
          const parts = detail && detail.parts && detail.parts[mid];
          if (!parts) return;
          Object.keys(parts).forEach((k) => { if (k.indexOf(key + '-') === 0) push(mid, k); });
        };
        const expand = (mid, key) => {
          push(mid, key);
          (BOM_PART_KEY_ALIASES[key] || []).forEach((a) => push(mid, a));
          prefixed(mid, key);
        };
        expand(moduleId, partKey);
        const m = /^planner-(.+)-(\d+)$/.exec(String(moduleId || ''));
        if (m) {
          const base = m[1];
          const cell = m[2];
          const k = /^(door|drawer|shelf)#\d+$/.exec(partKey || '');
          if (k) {
            expand(base, `${k[1]}#${cell}`);
            if (k[1] === 'drawer') push(base, `drawer#b${cell}`);
          } else {
            expand(base, partKey);
          }
        }
        return out;
      }

      const BOM_FINISH_LEVEL_RANK = { part: 0, module: 1, section: 2, item: 3 };

      // ============================================================
      // B1: 엣지밴딩을 길이로 — bom-protocol.md §7-2
      //
      // 엣지 문자열(`4면`·`3면`·`2면(장)`·`2면(가로)`·`1면(전)`·`1면(장)`·`-`)은 그대로 두고(I4), 붙이는 변을
      // **기하로** 정한다: L/R 은 세로(h) 변, T/B 는 가로(w) 변. 길이는 그 변의 치수다.
      //   4면        네 변 전부
      //   3면        긴 변 하나 + 짧은 변 둘 — 측판이면 앞(L) + 위(T)·아래(B), 뒤는 벽·뒷판 쪽이라 안 붙인다
      //   2면(장)    긴 변 둘
      //   2면(가로)  가로 변 둘 (T·B) — 홈카페장 천·지·뒷판
      //   1면(전)·1면(장)·1면  긴 변 하나(전면)   [확인 필요] 좌대 측처럼 짧은 변이 앞인 부재는 길이가 조금 과하다
      //   - / 모르는 값  없음
      // 세로가 길면(h>w) 긴 변은 L/R, 아니면 T/B 다.
      //
      // toCNC() 의 1면·2면 열은 옛 관례(1면→L, 2면→w>h ? L,R : T,B) 그대로 둔다 — CNC 기종·파일 관례를 확인하기
      // 전엔 바꾸지 않는다 (§7 표에 차이를 적어 두었다). 이 함수는 길이·요약용이다.
      //
      // edgeT  두께: 도어·서랍전판(MDF 18T 전면) 1.0, 나머지 0.6 (§2 "도어 1mm / 본체 0.6mm").
      // edgeCode 밴드 색: 전면·마감재는 면과 같은 마감이라 그 행의 finishCode, 몸통·바닥·손잡이는 null.
      // ============================================================
      function bomEdgeSidesOf(edge, w, h) {
        const e = String(edge || '').trim();
        const tall = h > w;
        const sides = { L: false, R: false, T: false, B: false };
        if (e === '4면') {
          sides.L = sides.R = sides.T = sides.B = true;
        } else if (e === '3면') {
          if (tall) { sides.L = sides.T = sides.B = true; } else { sides.T = sides.L = sides.R = true; }
        } else if (e.indexOf('2면(가로)') === 0) {
          sides.T = sides.B = true;
        } else if (e.indexOf('2면') === 0) {
          if (tall) { sides.L = sides.R = true; } else { sides.T = sides.B = true; }
        } else if (e.indexOf('1면') === 0) {
          if (tall) sides.L = true; else sides.B = true;
        }
        return sides;
      }

      function bomEdgeLenOf(sides, w, h) {
        return Math.round((sides.L ? h : 0) + (sides.R ? h : 0) + (sides.T ? w : 0) + (sides.B ? w : 0));
      }

      function bomEdgeThicknessOf(slot) {
        return (slot === 'door' || slot === 'drawerFront') ? 1.0 : 0.6;
      }

      const BOM_EDGE_CODE_SLOTS = ['door', 'drawerFront', 'finishing'];

      class MaterialExtractor {
        // W12-1: 제조 표준은 data-constants.js 가 정본.
        // Jest/Node 에서는 그 파일이 로드되지 않으므로 같은 값을 폴백으로 둔다
        // (corner-engine.js 의 CORNER_* 폴백과 동일한 방식).
        constructor(config = {}) {
          this.PANEL_W = config.sheetW || (typeof SHEET_W !== 'undefined' ? SHEET_W : 1220);
          this.PANEL_H = config.sheetH || (typeof SHEET_H !== 'undefined' ? SHEET_H : 2440);
          this.T = config.thickness
            || (typeof BODY_THICKNESS_DEFAULT !== 'undefined' ? BODY_THICKNESS_DEFAULT : 15);
        }

        // ========================================
        // W12-1: 몸통 두께는 설계별 선택값 (15T 90% / 18T 가끔)
        // 천판·지판 폭이 W-2T 로 파생되므로 15T→W-30, 18T→W-36 이 된다.
        // 도어(MDF 18T)는 몸통 두께와 무관하며 여기를 따르지 않는다.
        // ========================================
        thicknessFor(specs) {
          const t = parseFloat((specs || {}).bodyThickness);
          return Number.isFinite(t) && t > 0 ? t : this.T;
        }

        // ========================================
        // 메인 추출 함수
        // ========================================
        extract(designData) {
          const materials = [];
          const items = designData.items || [];

          // ★ 같은 카테고리 아이템 카운트 (싱크대 2개 등)
          const categoryCounts = {};
          const categoryTotals = {};
          items.forEach(item => {
            const cat = item.categoryId || item.category;
            categoryTotals[cat] = (categoryTotals[cat] || 0) + 1;
          });

          dlog('[MaterialExtractor] 추출 시작, 아이템 수:', items.length, 'categoryTotals:', JSON.stringify(categoryTotals));

          items.forEach((item, itemIdx) => {
            // ★ categoryId 사용 (category가 아님!)
            const category = item.categoryId || item.category;
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
            // B1: 이 품목의 부재 식별 문맥 — add() 가 partId·slot 을 붙일 때 읽는다.
            this.beginItem(item, itemIdx);
            // ★ 같은 카테고리 2개 이상이면 #1, #2 접두사 부여
            const prefix = categoryTotals[category] > 1 ? `#${categoryCounts[category]} ` : '';
            // ★ 품목 라벨 (아이템 구분용)
            // B3: 단순 카테고리 라벨은 규칙표(BOM_SIMPLE_CATEGORY_RULES)에서 — 기존 셋은 그대로.
            const catNames = { sink: '싱크대', wardrobe: '붙박이장', fridge: '냉장고장' };
            const simpleRules = BOM_SIMPLE_CATEGORY_RULES[category] || null;
            const catName = catNames[category] || (simpleRules && simpleRules.label) || category;
            const itemLabel = item.labelName || `${prefix}${catName}`;
            const mods = item.modules || [];
            dlog(`[BOM-TRACE] === 아이템 처리: ${itemLabel} ===`);
            dlog(`[BOM-TRACE]   모듈 수: ${mods.length}`);
            dlog(`[BOM-TRACE]   상부장: ${mods.filter(m=>m.pos==='upper').length}개, 하부장: ${mods.filter(m=>m.pos==='lower').length}개`);
            dlog(`[BOM-TRACE]   모듈 상세:`, mods.map(m => `${m.pos}/${m.type}/${m.name}(${m.w})`));
            const beforeLen = materials.length;

            switch (category) {
              case 'sink':
                this.extractSink(item, materials, prefix);
                break;
              case 'wardrobe':
                this.extractWardrobe(item, materials, prefix);
                break;
              case 'fridge':
                this.extractFridge(item, materials, prefix);
                break;
              default:
                // B3: 신발장·화장대·수납장·창고장 — 같은 상자 규칙, 카테고리 상수만 다르다 (BOM_SIMPLE_CATEGORY_RULES)
                if (simpleRules) this.extractSimpleBox(item, materials, prefix, simpleRules);
                break;
            }
            // ★ 새로 추가된 자재에 품목 라벨 태깅
            for (let i = beforeLen; i < materials.length; i++) {
              materials[i].itemLabel = itemLabel;
            }
            this._ctx = null;
            dlog(`[BOM-TRACE]   → 추출된 자재: ${materials.length - beforeLen}개 (누적 ${materials.length}개)`);
          });

          dlog('[MaterialExtractor] 추출 완료, 자재 수:', materials.length, '전체 모듈 목록:', materials.map(m => m.module).filter((v,i,a) => a.indexOf(v)===i));

          return {
            materials,
            summary: this.calculateSummary(materials),
            // B1: 엣지밴딩 총길이 — 두께별 { '1': mm, '0.6': mm }. summary 옆에 두는 이유는 calculateEdgeBanding 주석.
            edgeBanding: this.calculateEdgeBanding(materials),
            extractDate: new Date().toISOString(),
          };
        }

        // ========================================
        // B1: 부재 식별 문맥 — extract() 가 품목마다, 각 추출기가 모듈 루프마다 세운다.
        //   add() 는 이 문맥으로 partId·slot 을 만든다. 문맥 없이 add() 를 부르면(외부 직접 호출)
        //   품목 0 · 모듈 'none' 으로 떨어져 행은 나오되 식별자만 밋밋하다.
        // ========================================
        beginItem(item, itemIdx) {
          this._ctx = {
            itemIdx: itemIdx | 0,
            item: item || {},
            specs: (item && item.specs) || {},
            // B1: 디테일 마감 모델 — DadamAgent.exportDesign() 이 item.detail 로 넘긴다 (D1). 없으면 null.
            detail: bomDetailOf(item && item.detail),
            mod: null,
            moduleId: 'none',
            section: null,
            seq: {},   // `${itemIdx}|${moduleId}|${kind}` → 다음 k, `…|${partKey}` → 다음 n
          };
          return this._ctx;
        }

        /** 모듈 루프 진입. section 은 'upper'|'lower'|'hood'|'wardrobe'|'tall'… (planner-finish 가 상/하 묶음으로 접는다). */
        beginModule(mod, idx, section) {
          const ctx = this._ctx || this.beginItem(null, 0);
          const m = mod || {};
          const sec = section || m.pos || m.type || null;
          ctx.mod = m;
          ctx.moduleId = (m.id !== undefined && m.id !== null && String(m.id) !== '')
            ? String(m.id)
            : `${sec || 'mod'}-${idx | 0}`;
          ctx.section = sec;
          return ctx;
        }

        /** 품목 단위 행(EP·마감재) — 모듈이 없다. moduleId 'ep'. */
        beginItemLevel(section) {
          const ctx = this._ctx || this.beginItem(null, 0);
          ctx.mod = null;
          ctx.moduleId = 'ep';
          ctx.section = section || null;
          return ctx;
        }

        /** 문맥 카운터 — 같은 키가 몇 번째인지. */
        _nextSeq(key) {
          const ctx = this._ctx;
          const n = ctx.seq[key] || 0;
          ctx.seq[key] = n + 1;
          return n;
        }

        // ========================================
        // B1: 디테일 모델에서 한 행의 마감 코드를 정한다 — 부재 > 모듈 > 섹션 > 품목 > null.
        //   planner-finish.js 가 실려 있으면 그 함수(window.plannerFinishResolve), 아니면 내장판.
        //   행이 대표하는 부재 후보(bomFinishCandidates)를 모두 물어 가장 센 단계를 고른다.
        // @returns {{code:string, level:string}|null}
        // ========================================
        resolveFinish(slot, moduleId, section, partKey) {
          const detail = this._ctx && this._ctx.detail;
          if (!detail || !slot) return null;
          const fn = (typeof window !== 'undefined' && typeof window.plannerFinishResolve === 'function')
            ? window.plannerFinishResolve
            : bomFinishResolveEmbedded;
          let best = null;
          bomFinishCandidates(detail, moduleId, partKey).forEach((c) => {
            const r = fn(detail, slot, c.moduleId, section, c.partKey);
            if (r && (!best || BOM_FINISH_LEVEL_RANK[r.level] < BOM_FINISH_LEVEL_RANK[best.level])) best = r;
          });
          return best;
        }

        /**
         * B1: 도어 마감의 마지막 폴백 — 품목 사양 specs.doorFinishUpper/Lower + doorColorUpper/Lower.
         * 상/하 묶음은 planner-finish 와 같은 규칙(upper·hood → Upper, 나머지 → Lower).
         * 한글 값('무광'·'화이트')은 기판을 몰라 MDF-DEFAULT(코드 없음)로 돌아온다 — bom-finish-color.js 가 정한다.
         */
        legacyDoorEntryFor(section) {
          const specs = (this._ctx && this._ctx.specs) || {};
          const sfx = bomFinishSectionGroup(section) === 'upper' ? 'Upper' : 'Lower';
          const finish = specs['doorFinish' + sfx];
          const color = specs['doorColor' + sfx];
          if (!finish && !color) return null;
          return { doorFinish: finish, doorColor: color };
        }

        // ========================================
        // 자재 추가 헬퍼 (W7-3: mod 옵셔널 — 도어/서랍도어 자동 자재 코드 매핑)
        // B1: 모든 행에 partId·slot 을 더한다 (기존 필드는 그대로 — I4).
        // ========================================
        add(arr, module, part, material, thickness, w, h, qty, edge, note = '', mod = null) {
          const ctx = this._ctx || this.beginItem(null, 0);
          const def = bomPartDefOf(part);
          const kindKey = `${ctx.itemIdx}|${ctx.moduleId}|${def.key}`;
          const partKey = def.indexed ? `${def.key}#${this._nextSeq(kindKey)}` : def.key;
          const n = this._nextSeq(`${kindKey}|${partKey}|n`);
          const partId = `${ctx.itemIdx}-${ctx.moduleId}-${partKey}-${n}`;
          const slot = def.slot;

          let finishCode = '';
          // B1: 디테일 모델(item.detail) 이 가장 세다 — 어느 단계(부재/모듈/섹션/품목)든. 뒷판(back)은 칠하지 않는다.
          const resolved = (slot && slot !== 'back') ? this.resolveFinish(slot, ctx.moduleId, ctx.section, partKey) : null;
          if (part === '도어' || part === '서랍도어') {
            // 도어/서랍도어 우선순위: 디테일 모델 > 모듈 doorFinish/doorColor(doorMaterialCode) > 품목 사양 상/하 값
            // 코드가 정해지면 자재(PET/MFB…)·비고(라벨)도 카탈로그에서 따라온다 (W7-3 방식 그대로).
            let dm = null;
            if (resolved) {
              dm = this.doorMatFor({ doorMaterialCode: resolved.code });
              finishCode = resolved.code; // 카탈로그가 모르는 코드라도 지정값은 버리지 않는다
            } else if (mod) {
              dm = this.doorMatFor(mod);
            }
            if (!dm || !dm.code) {
              const legacy = finishCode ? null : this.legacyDoorEntryFor(ctx.section);
              if (legacy) dm = this.doorMatFor(legacy);
            }
            if (dm && dm.code) {
              material = dm.material;
              finishCode = finishCode || dm.code;
              if (!note) note = dm.note;
            }
          } else if (resolved) {
            // 몸통·상판·손잡이·마감재·걸레받이: 디테일 모델이 정한 때만 코드. 자재·비고는 그대로.
            finishCode = resolved.code;
          } else if (slot === 'top') {
            // P1-3: 상판은 디테일 모델이 없으면 품목 사양 topColor 의 카탈로그 코드(TOP-*)로 떨어진다.
            finishCode = bomTopCodeOf(ctx.specs.topColor);
          }
          const W = Math.round(w);
          const H = Math.round(h);
          const edges = bomEdgeSidesOf(edge, W, H);
          arr.push({
            module,
            part,
            material,
            thickness,
            w: W,
            h: H,
            qty,
            edge,
            note,
            // W7-3: 도어 자재 코드 (예: 'PET-OAK-M'). 비 도어 또는 finish/color 없으면 빈 문자열.
            finishCode,
            // B1: 부재 식별자 + 슬롯 (bom-protocol.md §7-1)
            partId,
            slot,
            // B1: 엣지밴딩 — 변·길이(장당 mm)·두께·밴드 마감 (bom-protocol.md §7-2). 문자열 edge 는 그대로.
            edges,
            edgeLen: bomEdgeLenOf(edges, W, H),
            edgeT: bomEdgeThicknessOf(slot),
            edgeCode: (BOM_EDGE_CODE_SLOTS.indexOf(slot) >= 0 && finishCode) ? finishCode : null,
          });
        }

        // ========================================
        // W12-61: 멍장 정면 부재 (멍가림판 · 경첩목대 · 멍판 마감재)
        //
        // 멍 폭(blindZoneW)은 corner.md §3.3 대로 세 조각을 품는다:
        //
        //     멍 W = 인접 상판 D − 물끊기 10 + 마감재 자리 60 + 목대 15
        //     ├─ 멍가림판 2.7T MDF ─────────────┤├목대┤
        //     ├── 보이는 MDF ──┤├─ 마감재 150 ─┤
        //
        // 두 가지를 헷갈리기 쉬워 여기 적어 둔다.
        //   · **목대 15 는 뺀다.** 멍판은 목대 앞에서 끝난다 — 목대는 도어 경첩이
        //     물리는 구조재이고 이미 아래에서 따로 발주된다. 안 빼면 15 과다 재단.
        //   · **마감재 60 은 안 뺀다.** 마감재는 멍판을 대체하지 않고 그 **위에**
        //     붙는다. 그래서 마감재 재단이 자리(60)보다 넓은 150 이다 —
        //     접착면 90 을 멍판 위로 문다 (W12-72: 100 → 150). 빼면 마감재가 뜬다.
        //
        // 마감재 종류는 멍장이 속한 라인 마감을 따라온다 (mod.blindFinishType).
        // ========================================
        /** 2026-09-13: 멍장 선반이 목대(ㄱ자, 앞선에서 75) 뒤에서 끝나도록 줄일 깊이. 멍장이 아니면 0. */
        /**
         * 2026-09-15: 서랍장 전면 목록 → 레이아웃.
         *   서랍 단수  mod.drawerCount (1~4, 넘치면 규칙이 자른다)
         *   도어       mod.doorCount>0 이면 맨 위에 도어 한 칸 (mod.drawerLayout='all' 이면 서랍만)
         *   전면 높이  mod.drawerFronts[i] > (도어형이면) mod.drawerHeight > 규칙 기본 200 > 균등
         *   레일       mod.drawerRail 'under'(기본) | 'ball'
         */
        /**
         * 2026-09-15: 서랍 규칙 블록 — 플래너 구조의 `drawer` {rail, sakuri, boxT} 가 브리지를 타고 mod.drawer 로 온다.
         *   옛 평면 필드(drawerRail·drawerSakuri·drawerBoxT)도 읽는다. boxT 0 이면 몸통 두께.
         */
        drawerRulesOf(mod, T) {
          const d = (mod && mod.drawer) || {};
          const railRaw = d.rail || mod.drawerRail;
          const sakuri = d.sakuri != null ? !!d.sakuri : !!mod.drawerSakuri;
          const boxT = Number(d.boxT) || Number(mod.drawerBoxT) || T;
          // 2026-09-16: 전면 등급 — 서랍마다 소·중·대. 도어 등급은 따로 (기본 대).
          const grades = Array.isArray(d.grades) ? d.grades : null;
          return {
            rail: DrawerRules ? DrawerRules.railKeyOf(railRaw) : 'under', sakuri, boxT,
            grades, doorGrade: d.doorGrade || null,
          };
        }

        drawerLayoutOf(mod, H, T) {
          if (!DrawerRules) throw new Error('bom-drawer-rules.js 가 실리지 않았다 — extractors.js 앞에 넣는다');
          const R = DrawerRules.DRAWER_RULES;
          const n = Math.max(1, parseInt(mod.drawerCount, 10) || 1);
          const doorCount = mod.doorCount || 0;
          const layoutKind = mod.drawerLayout === 'all' ? 'all' : (mod.drawerLayout === 'doorTop' || doorCount > 0 ? 'doorTop' : 'all');
          const explicit = Array.isArray(mod.drawerFronts) ? mod.drawerFronts.map(Number) : null;
          const fronts = [];
          if (layoutKind === 'doorTop') fronts.push({ kind: 'door' });
          for (let i = 0; i < n; i++) {
            let h = null;
            if (explicit && explicit[i] > 0) h = explicit[i];
            else if (layoutKind === 'doorTop') h = Number(mod.drawerHeight) > 0 ? Number(mod.drawerHeight) : R.FRONT_DEFAULT_H;
            fronts.push({ kind: 'drawer', h });
          }
          const rules = this.drawerRulesOf(mod, T);
          // 2026-09-16: 전면 배분식 — 배치(영역) 높이를 알면 그것으로 전면을 나눈다 (사장님 확정식).
          //   (배치 H − 상판) − 받침보정 − 30 × 목찬넬 개수 를 버줌(소1 중2 대2)으로 나눈다.
          //   `areaH` 는 브리지가 넘긴다. 없으면 모듈 전체 높이(totalH) 로 떨어지고, 그것도 없으면
          //   옛 경로(전면별 고정 높이)를 그대로 쓴다 — 골든 픽스처가 그 경우다.
          const areaH = Number(mod.areaH) > 0 ? Number(mod.areaH) : (Number(mod.totalH) || 0);
          if (areaH > 0) {
            const hp = (mod.heightParts && typeof mod.heightParts === 'object') ? mod.heightParts : {};
            const graded = fronts.map((fr, i) => ({
              kind: fr.kind,
              grade: fr.kind === 'door'
                ? (rules.doorGrade || undefined)
                : ((rules.grades && rules.grades[layoutKind === 'doorTop' ? i - 1 : i]) || undefined),
            }));
            return DrawerRules.layoutByGrades({
              areaH, topT: hp.topT, legH: hp.legH, pedestalH: hp.pedestalH,
              T, fronts: graded, rail: rules.rail,
            });
          }
          return DrawerRules.layoutDrawerModule({ H, T, fronts, rail: rules.rail });
        }

        /**
         * 2026-09-15: 서랍장 부재 — 전면(도어·서랍도어), 박스(크기별 묶음), 우라, 하단보강, 중간 목찬넬.
         *   박스 치수는 레일 종류가 정한다 (DrawerRules.drawerBoxDims): 앞뒷판 가로 = W − 2몸통T − (볼레일 14×2 | 언더 12) − 2서랍T,
         *   측판 길이 = 레일 규격(≤ D − 50 최대) (언더는 −10), 사쿠리면 앞뒷판 높이 −18, 우라 = 외경 −1 (사쿠리면 앞뒷판 + 20).
         *   mod.drawerBoxT 서랍 자재 두께(기본 몸통 T) · mod.drawerSakuri 측판 사쿠리 여부.
         */
        addDrawerModuleParts(materials, modLabel, mod, W, T, doorCount, L, modD) {
          const R = DrawerRules.DRAWER_RULES;
          // 전면 — 위에서 아래로. 도어는 doorCount 장이 가로로 나뉜다. 같은 높이의 서랍도어는 한 행(수량)으로 묶는다.
          const drawerFrontRows = [];
          L.fronts.forEach((f) => {
            // 2026-09-15: 최소 전면 높이 미만은 부재로 내지 않는다 (옛 규칙 `hingeDoorH > 50`)
            if (f.h < R.MIN_FRONT_H) return;
            if (f.kind === 'door') {
              const dc = Math.max(1, doorCount || 1);
              this.add(materials, modLabel, '도어', 'MDF', 18, Math.floor(W / dc) - 4, f.h, dc, '4면', '', mod);
            } else {
              const row = drawerFrontRows.find((r) => r.h === f.h);
              if (row) row.qty += 1; else drawerFrontRows.push({ h: f.h, qty: 1 });
            }
          });
          drawerFrontRows.forEach((r) => {
            this.add(materials, modLabel, '서랍도어', 'MDF', 18, W - 4, r.h, r.qty, '4면', '', mod);
          });
          // 박스 — 같은 크기끼리 묶는다 (앞뒷판·측판은 서랍당 2장). 치수는 레일 종류·깊이·자재 두께로.
          const rules = this.drawerRulesOf(mod, T);
          const drawerT = rules.boxT;
          const sakuri = rules.sakuri;
          const dimsOf = (boxH) => DrawerRules.drawerBoxDims({ W, D: modD, bodyT: T, drawerT, rail: L.rail, boxH, sakuri });
          const groups = [];
          L.boxes.forEach((b) => {
            let g = groups.find((x) => x.size === b.size);
            if (!g) { g = { size: b.size, h: b.h, count: 0, fits: true }; groups.push(g); }
            g.count += 1;
            if (!b.fits) g.fits = false;
          });
          let bottomW = 0, bottomD = 0, brace = false, sideL = 0;
          const railName = R.RAIL_CLEARANCE[L.rail].name;
          groups.forEach((g) => {
            const d = dimsOf(g.h);
            if (d.warnings.length) dlog(`[Drawer] ${modLabel}: ${d.warnings.join(' / ')}`);
            const note = `${R.BOX_LABEL[g.size]} 박스${g.fits ? '' : ' (레일 여유 부족)'}`;
            this.add(materials, modLabel, '서랍전후판', 'PB', drawerT, d.fbW, d.fbH, g.count * 2, '1면(장)',
              `${note}${sakuri ? ' · 사쿠리 −' + R.BOX_SAKURI_FB_MINUS : ''}`);
            this.add(materials, modLabel, '서랍측판', 'PB', drawerT, d.sideL, d.sideH, g.count * 2, '1면(장)',
              `${note} · ${railName} ${d.railLength}${sakuri ? ' · 사쿠리' : ''}`);
            bottomW = d.bottomW; bottomD = d.bottomD; brace = d.brace; sideL = d.sideL;
          });
          const n = L.boxes.length;
          if (n > 0) {
            this.add(materials, modLabel, '서랍밑판', 'MDF', 2.7, bottomW, bottomD, n, '-', sakuri ? '우라 · 사쿠리 홈' : '우라');
            if (brace) {
              this.add(materials, modLabel, '서랍 하단보강', 'PB', drawerT, sideL, R.BOX_BRACE_H, n, '2면(장)');
            }
          }
          // 중간 목찬넬 — 따내기 90×40 자리를 채우는 ㄴ자 두 장, 모듈 폭
          if (L.midCount > 0) {
            this.add(materials, modLabel, '목찬넬(중간 전면)', 'MDF', R.CHANNEL_T, R.CHANNEL_MID_FACE_H, W, L.midCount, '2면(장)',
              `중간 따내기 ${R.CHANNEL_MID_NOTCH_H}×${R.CHANNEL_BASE_W}`);
            this.add(materials, modLabel, '목찬넬(중간 지면)', 'MDF', R.CHANNEL_T, R.CHANNEL_BASE_W, W, L.midCount, '2면(장)');
          }
        }

        blindShelfCut(mod, pos) {
          if (!isBlindModule(mod, pos)) return 0;
          return typeof CORNER_HINGE_BATTEN_DEPTH !== 'undefined' ? CORNER_HINGE_BATTEN_DEPTH : 75;
        }

        /**
         * 멍장 도어 재단 폭 — corner.md §3.5.1 · 2026-09-15 결정 "멍장 도어는 목대를 덮는다".
         *
         *   도어 자리 = doorW + 목대 15   (정면 셀 `[멍 = 멍W−15][도어 = 도어W+15]`)
         *   도어 재단 = 도어 자리 − 갭 4 = **doorW + 11**
         *
         * 경첩목대는 모듈 안쪽의 구조재라 정면에 드러나지 않는다 — 마감재 다음은 바로 도어다.
         * 예전(P2 #652 까지)엔 도어가 목대 **옆**에 앉는다고 보고 doorW − 4 로 냈다 (411 → 407).
         * 이제 411 → 422. corner-engine.js `blindDoorPartW` 와 같은 식이다 (브라우저 전역이 없을 때를
         * 위해 여기서도 계산한다). doorW 가 없는 옛 저장 설계는 카카스 W − 4 그대로다 — 목대를 더하면
         * 카카스보다 넓은 도어가 나간다.
         */
        blindDoorPartW(mod, W) {
          const battenT = typeof CORNER_HINGE_BATTEN_T !== 'undefined' ? CORNER_HINGE_BATTEN_T : 15;
          const doorW = parseFloat(mod.doorW);
          if (!Number.isFinite(doorW) || doorW <= 0) return W - 4;
          return doorW + battenT - 4;
        }

        addBlindFrontParts(materials, modLabel, mod, H) {
          const coverT = typeof CORNER_BLIND_COVER_T !== 'undefined' ? CORNER_BLIND_COVER_T : 2.7;
          const battenT = typeof CORNER_HINGE_BATTEN_T !== 'undefined' ? CORNER_HINGE_BATTEN_T : 15;
          const battenLeg = typeof CORNER_HINGE_BATTEN_LEG !== 'undefined' ? CORNER_HINGE_BATTEN_LEG : 60;
          // W12-72: 정본 data-constants.js CORNER_FINISH_PART_W = 150. 폴백이 100 에 남아 있어
          //   브라우저(150)와 Node 시험·옛 저장 설계(100)가 갈렸다 — 같은 값으로 맞춘다 (계획 B0).
          const finPartW = typeof CORNER_FINISH_PART_W !== 'undefined' ? CORNER_FINISH_PART_W : 150;
          const finSeatW = 60; // 마감재 자리 — 멍 공식의 60 (corner.md §3.3). 재단 폭에서 이걸 뺀 만큼이 멍판 위 겹침이다.

          const zoneW = parseFloat(mod.blindZoneW) || 0;
          const coverW = Math.max(0, zoneW - battenT);
          // W12-65: 키큰장 멍장 — 멍 구간이 바닥부터 천장까지 통으로 드러나는 큰 면이라
          //   2.7T 가림판 대신 **멍판 EP 18T** 로 덮는다. 폭은 가림판과 같은 규칙
          //   (멍 − 목대 15: 경첩이 목대에 물려야 한다), 높이는 장 전체(좌대 포함),
          //   단이 셋이라도 가리는 면은 하나라 **한 번만** 낸다. EP 는 이미 마감된 판이라
          //   멍판 마감재 150 도 없다. 경첩목대는 단마다 나온다 (아래 공통).
          const isTall = mod.blindKind === 'tall';
          if (isTall) {
            if (mod.blindEpOnce) {
              const epW = parseFloat(mod.blindEpW) || coverW;
              const epH = parseFloat(mod.blindEpH) || H;
              this.add(materials, modLabel, '멍판 EP', 'MDF', 18, epW, epH, 1, '4면',
                       '키큰장 멍 구간 EP — 멍 폭 − 목대 15 · 장 높이 전체 (corner.md §3.9)');
            }
          } else {
            this.add(materials, modLabel, '멍가림판', 'MDF', coverT, coverW, H, 1, '-',
                     '멍 가림 MDF — 멍 폭 − 목대 (corner.md §3.5)');
          }
          // W12-54: 경첩 목대 — 멍 폭에 15T 가 들어가 있으므로 자재표에도 나온다.
          // 2026-09-13: **ㄱ자** 목대 — 앞다리 60(정면과 나란히, 멍판 뒤) + 옆다리 60(도어 쪽 끝,
          //   깊이 방향) 모두 15T × 몸통 H. 앞선에서 15 + 60 = 75 만 들어간다 (corner.md §3.5).
          //   멍장 하나에 한 벌 — 하부·상부·키큰장 단 모두 같다.
          const battenQty = 1;
          this.add(materials, modLabel, '경첩목대(앞다리)', 'PB', battenT, battenLeg, H, battenQty, '-',
                   'ㄱ자 경첩목대 앞다리 60×15T — 멍판 바로 뒤 (corner.md §3.5)');
          this.add(materials, modLabel, '경첩목대(옆다리)', 'PB', battenT, battenLeg, H, battenQty, '-',
                   'ㄱ자 경첩목대 옆다리 60×15T — 도어 쪽 끝, 앞선에서 75 (corner.md §3.5)');
          // W12-61: 멍판 마감재 — 멍장 도어 바로 옆, 멍가림판 위에 붙는다.
          //   'None' 을 명시한 경우에만 뺀다. 미지정이면 휠라로 떨어진다(§3.3) —
          //   자리 60 은 이미 멍 폭에 있어서, 안 내면 그 자리가 MDF 로 발주된다.
          const finType = isTall ? 'None' : (mod.blindFinishType || 'Filler');
          if (finType !== 'None' && coverW > 0) {
            const finW = parseFloat(mod.blindFinishW) || finPartW;
            const finName = finType === 'Molding' ? '몰딩(멍판)' : '휠라(멍판)';
            this.add(materials, modLabel, finName, 'MDF', 18, finW, H, 1, '4면',
                     `멍판 마감재 — 자리 ${finSeatW} + 멍판 위 겹침 ${finW - finSeatW} (corner.md §3.3)`);
          }
        }

        // ========================================
        // W7-3: 도어 모듈 → 자재 정보 매핑
        // bom-finish-color.js 가 로드되면 finish/color → 자재 코드, 아니면 default MDF
        // ========================================
        doorMatFor(mod) {
          if (typeof window === 'undefined' || !window.DadamBomFinishColor) {
            return { material: 'MDF', code: '', label: '', note: '' };
          }
          const r = window.DadamBomFinishColor.resolveDoorMaterial(mod || {});
          return {
            material: r.material,
            code: r.code === 'MDF-DEFAULT' ? '' : r.code,
            label: r.label,
            note: r.label && r.code !== 'MDF-DEFAULT' ? r.label : '',
          };
        }

        // ========================================
        // P1-1: 키큰장 단 부재표 (sink.md §5) — 싱크대 하부 라인의 `type:'tall'` 모듈.
        //
        // 하부장 루프가 단을 하부장으로 재단하던 결함: 중간장·상부장 도어가 H−30(목찬넬 틈)으로 나가고, 선반 0 인
        // 단에 선반 1 이 강제되고, 걸레받이·목찬넬 폭에 세 단의 폭이 다 더해졌다(600×3 → 라인보다 1200 김).
        // 단별 규칙은 3D(mockup-structure.html defaultHandleType · stackForArea)와 같다:
        //   몸통     하부장과 같다 — 측판 3면 D×H · 지판 (W−2T)×D · 밴드 70×(W−2T) 2 · 뒷판 2.7T (W−2T)×(H−T) · 처짐방지 70
        //   선반     shelfCount 그대로 (0 이면 없음). 단 정보가 없는 통짜 키큰장은 1 [확인 필요]
        //   도어     하부단·통짜 + 목찬넬 손잡이 → H−30 (목찬넬 틈, 하부장과 같다) / 그 밖(푸쉬) → H−4 (도어 간격 4)
        //   목찬넬   하부단·통짜 + 목찬넬 손잡이 → 전면 52×W · 지면 40×W 를 그 단에 (라인 걸레받이·목찬넬 폭에서는 뺀다)
        //   좌대     하부단·통짜 — wardrobe.md 좌대 상자(전후 2 · 측 2 · W≥700 중간보강 1) + 좌대 걸레받이 MDF 18T
        //            [확인 필요] sink.md §5 는 높이 60 만 정한다. 상자 구성은 붙박이장 규칙을 빌렸다
        //   상몰딩   상부단·통짜 — MDF 18T · moldingH × W 를 그 단에 (상부 라인 상몰딩과 별개 — 높이가 다르다)
        // 걸레받이는 없다 — 다리발이 아니라 좌대가 받친다.
        // ========================================
        addTallTierParts(materials, prefix, mod, tier, specs) {
          const T = this.thicknessFor(specs);
          const hp = (mod.heightParts && typeof mod.heightParts === 'object') ? mod.heightParts : {};
          const n = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? x : d; };
          const W = parseFloat(mod.w) || 600;
          // 몸통 높이 — 브리지가 좌대·상몰딩을 이미 뺀 값 (ui-step1.js _carcassHeight), 상세설계 화면도 같다 (addTallModule)
          const H = parseFloat(mod.h) || 0;
          const modD = parseFloat(mod.d) || 550;
          const tierLabel = BOM_TALL_TIER_LABEL[tier] || '';
          const modLabel = `${prefix}${mod.name || '키큰장'}${tierLabel ? `(${tierLabel})` : ''}`;
          const grounded = tier === 'bottom' || tier === 'single';   // 바닥에 닿는 단 — 좌대·목찬넬
          const crowned = tier === 'top' || tier === 'single';       // 천장에 닿는 단 — 상몰딩
          const channelHere = bomTallTierHasChannel(tier, specs);

          // 몸통 — 하부장과 같다 (사쿠리 없음)
          this.add(materials, modLabel, '측판', 'PB', T, modD, H, 2, '3면');
          this.add(materials, modLabel, '지판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
          this.add(materials, modLabel, '밴드', 'PB', T, 70, W - T * 2, 2, '2면(장)');
          this.add(materials, modLabel, '뒷판', 'MDF', 2.7, W - T * 2, H - T, 1, '-');
          const bandH = channelHere ? H - T * 2 - 70 : H - T * 2;
          this.add(materials, modLabel, '밴드(처짐방지)', 'PB', T, 70, bandH, W >= 800 ? 2 : 1, '2면(장)');
          // 선반 — 단이 가진 만큼 (하부장 규칙 "서랍·EL·오픈 아니면 1" 을 타지 않는다)
          const rawShelf = Number(mod.shelfCount);
          const shelfQty = Number.isFinite(rawShelf) ? Math.max(0, Math.round(rawShelf)) : 1;
          if (shelfQty > 0) {
            this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - T - this.blindShelfCut(mod, 'lower'), shelfQty, '1면(전)');
          }
          // 도어 — 목찬넬 단만 H−30, 나머지는 푸쉬 H−4 (bomTallTierDoorH — 경첩 수도 같은 높이를 본다)
          const doorH = bomTallTierDoorH(mod, tier, specs);
          if (isBlindModule(mod, 'lower')) {
            const blindDoorW = this.blindDoorPartW(mod, W); // doorW + 11 — 도어가 목대를 덮는다 (corner.md §3.5.1)
            this.add(materials, modLabel, '도어', 'MDF', 18, blindDoorW, doorH, mod.doorCount || 1, '4면', '멍장 도어(도어폭 기준) — 목대를 덮는다: doorW + 15 − 4 (corner.md §3.5.1)', mod);
            this.addBlindFrontParts(materials, modLabel, mod, H);
          } else {
            const doorCount = mod.doorCount || 0;
            if (doorCount > 0) {
              const doorW = Math.floor(W / doorCount) - 4;
              this.add(materials, modLabel, '도어', 'MDF', 18, doorW, doorH, doorCount, '4면', '', mod);
            }
          }
          // 목찬넬 — 하부단 폭으로 그 단에 (3D 도 모듈마다 모듈 폭으로 그린다)
          if (channelHere) {
            this.add(materials, modLabel, '목찬넬(전면)', 'MDF', 18, 52, W, 1, '2면(장)');
            this.add(materials, modLabel, '목찬넬(지면)', 'MDF', 18, 40, W, 1, '2면(장)');
          }
          // 좌대 — 스택에 한 벌, 바닥 단에 (sink.md §5 좌대 60 · 상자 구성은 wardrobe.md)
          if (grounded) {
            const pedestalH = n(hp.pedestalH, n(specs.wardrobePedestal, 60));
            if (pedestalH > 0) {
              const pedNote = '[확인 필요] 키큰장 좌대 상자 — wardrobe.md 좌대 규칙을 빌림 (sink.md §5 는 높이 60 만)';
              const pedLabel = `${modLabel}-좌대`;
              this.add(materials, pedLabel, '좌대 전후', 'PB', T, W - T * 2, pedestalH, 2, '1면(전)', pedNote);
              this.add(materials, pedLabel, '좌대 측', 'PB', T, modD - T * 2 - 5, pedestalH, 2, '1면(전)', pedNote);
              if (W >= 700) {
                this.add(materials, pedLabel, '좌대 중간보강', 'PB', T, modD - T * 2 - 5 - 30, pedestalH, 1, '1면(전)', pedNote);
              }
              this.add(materials, pedLabel, '좌대 걸레받이', 'MDF', 18, pedestalH, W, 1, '2면(장)', pedNote);
            }
          }
          // 상몰딩 — 스택 맨 위 단에 한 장 (sink.md §5 상몰딩 60)
          if (crowned) {
            const moldingH = n(hp.moldingH, n(specs.moldingH, 60));
            if (moldingH >= 20) {
              this.add(materials, modLabel, '상몰딩', 'MDF', 18, moldingH, W, 1, W > 2000 ? '2면(장)' : '4면');
            }
          }
        }

        // ========================================
        // 싱크대 자재 추출
        // ========================================
        extractSink(item, materials, prefix = '') {
          const specs = item.specs || {};
          const T = this.thicknessFor(specs);
          const defaultUpperD = 295; // 상부장 기본 깊이
          const defaultLowerD = 550; // 하부장 기본 깊이
          const isWoodChannel = (specs.handle || '').includes('목찬넬');
          const legH = specs.sinkLegHeight || 150;
          // W12-61: 멍장 정면 부재(멍가림판·목대·마감재) 치수는 addBlindFrontParts 로 모았다.

          // ===== 상부장 모듈 =====
          const upperModules = (item.modules || []).filter((m) => m.pos === 'upper' && m.type !== 'hood');
          dlog('[Sink] 상부장 모듈:', upperModules.length);

          upperModules.forEach((mod, idx) => {
            this.beginModule(mod, idx, 'upper');
            // ★ 모듈 치수가 BOM의 근거
            const W = parseFloat(mod.w) || 600;
            const H = parseFloat(mod.h) || specs.upperH || 720;
            const modD = parseFloat(mod.d) || defaultUpperD;
            const name = mod.name || `${W}/${mod.doorCount || 1}도어`;
            const modLabel = `${prefix}상부장-${name}`;

            // 측판 2개 (사쿠리홈)
            this.add(materials, modLabel, '측판', 'PB', T, modD, H, 2, '3면', 'sakuri(15→3mm)');
            // 천판 (사쿠리 반영 D-18)
            this.add(materials, modLabel, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
            // 지판 (사쿠리 반영 D-18)
            this.add(materials, modLabel, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
            // 뒷판 (사쿠리홈에 끼움 W-20)
            this.add(materials, modLabel, '뒷판', 'MDF', 2.7, W - 20, H - 1, 1, '-');
            // 밴드(보강목) 2개
            this.add(materials, modLabel, '밴드(보강목)', 'PB', T, W - T * 2, 70, 2, '2면(장)');
            // 밴드(처짐방지목) - W>=700이면 2개
            const bandQty = W >= 700 ? 2 : 1;
            this.add(materials, modLabel, '밴드(처짐방지)', 'PB', T, 70, H - T * 2, bandQty, '2면(장)');
            // 선반 2개 (사쿠리 반영 D-34). 2026-09-13: 멍장은 ㄱ자 목대 깊이 75 만큼 짧다 (corner.md §3.5)
            this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - 34 - this.blindShelfCut(mod, 'upper'), 2, '1면(전)');
            // 도어 (H + overlap)
            // W11-13: 미지정(undefined)과 0 을 구분한다.
            //   기존 저장 설계는 doorCount 를 안 넣고 폴백 1 에 의존하므로 그대로 1.
            //   플래너 변환 모듈은 오픈 구간에 0 을 명시하는데, `|| 1` 이면
            //   0 이 falsy 라 도어가 1장 생겨 없는 도어가 발주된다.
            //   (하부장 루프는 이미 `mod.doorCount || 0` 으로 0 을 존중한다)
            const rawDoorCount = Number(mod.doorCount);
            const doorCount = Number.isFinite(rawDoorCount) ? rawDoorCount : 1;
            if (isBlindModule(mod, 'upper')) {
              // W10-4: 상부 멍장 — 도어는 doorW 기준 (카카스 W면 오발주), 멍 가림판 신규 (design §6)
              const overlap = parseFloat(specs.upperDoorOverlap) || 15;
              const blindDoorW = this.blindDoorPartW(mod, W); // doorW + 11 — 도어가 목대를 덮는다 (corner.md §3.5.1)
              this.add(materials, modLabel, '도어', 'MDF', 18, blindDoorW, H + overlap, mod.doorCount || 1, '4면', '멍장 도어(도어폭 기준) — 목대를 덮는다: doorW + 15 − 4 (corner.md §3.5.1)', mod);
              this.addBlindFrontParts(materials, modLabel, mod, H);
            } else if (doorCount > 0) {
              const overlap = parseFloat(specs.upperDoorOverlap) || 15;
              const doorW = Math.floor(W / doorCount) - 4;
              this.add(materials, modLabel, '도어', 'MDF', 18, doorW, H + overlap, doorCount, '4면', '', mod);
            }
          });

          // ===== 하부장 모듈 =====
          const lowerModules = (item.modules || []).filter((m) => m.pos === 'lower' && m.type !== 'cook');
          dlog('[Sink] 하부장 모듈:', lowerModules.length);

          lowerModules.forEach((mod, idx) => {
            // P1-1: 키큰장 단은 하부장 규칙을 타지 않는다 — 단별 부재표로 따로 낸다 (sink.md §5).
            const tallTier = bomTallTierOf(mod);
            if (tallTier) {
              this.beginModule(mod, idx, 'tall');
              this.addTallTierParts(materials, prefix, mod, tallTier, specs);
              return;
            }
            this.beginModule(mod, idx, 'lower');
            // ★ 모듈 치수가 BOM의 근거
            const W = parseFloat(mod.w) || 600;
            const topT = parseFloat(specs.topThickness) || 12;
            const H = parseFloat(mod.h) || (specs.lowerH || 870) - topT - legH;
            const modD = parseFloat(mod.d) || defaultLowerD;
            const name = mod.name || `${W}/${mod.doorCount || 1}도어`;
            const modLabel = `${prefix}하부장-${name}`;
            const isDrawer = mod.isDrawer || false;
            const isEL = mod.isEL || false;
            const isOpen = mod.isOpen || false;

            // 2026-09-15: 서랍장은 전면·목찬넬·존·박스를 먼저 푼다 — 측판 비고(따내기)와 아래 부재가 같은 답을 쓴다.
            const drawerLayout = isDrawer ? this.drawerLayoutOf(mod, H, T) : null;
            if (drawerLayout && drawerLayout.warnings.length) {
              dlog(`[Drawer] ${modLabel}: ${drawerLayout.warnings.join(' / ')}`);
            }

            // 측판 2개 (하부장: 사쿠리 없음). 목찬넬이면 따내기 가공을 비고로 적는다 (치수는 그대로 — 따냄은 가공).
            const sideNote = (isWoodChannel && DrawerRules) ? DrawerRules.notchNote(drawerLayout) : '';
            this.add(materials, modLabel, '측판', 'PB', T, modD, H, 2, '3면', sideNote);
            // 지판 (하부장: 사쿠리 없음, D 그대로)
            this.add(materials, modLabel, '지판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
            // 밴드 2개
            this.add(materials, modLabel, '밴드', 'PB', T, 70, W - T * 2, 2, '2면(장)');
            // 뒷판 (하부장: 사쿠리 없음)
            this.add(materials, modLabel, '뒷판', 'MDF', 2.7, W - T * 2, H - T, 1, '-');
            // 밴드(처짐방지목) - 목찬넬이면 -70, W>=800이면 2개
            const bandH = isWoodChannel ? H - T * 2 - 70 : H - T * 2;
            const bandQty = W >= 800 ? 2 : 1;
            this.add(materials, modLabel, '밴드(처짐방지)', 'PB', T, 70, bandH, bandQty, '2면(장)');
            // 선반 (서랍/EL/오픈장 없으면 1개, 하부장: 사쿠리 없음)
            if (!isDrawer && !isEL && !isOpen && mod.type !== 'sink') {
              // 2026-09-13: 멍장은 ㄱ자 목대 깊이 75 만큼 짧다 (corner.md §3.5)
              this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - T - this.blindShelfCut(mod, 'lower'), 1, '1면(전)');
            }
            // 도어 (H - 30)
            const doorCount = mod.doorCount || 0;
            if (isBlindModule(mod, 'lower')) {
              // W10-4: 하부 멍장 — 도어는 doorW 기준 (카카스 W면 오발주), 멍 가림판 신규 (design §6)
              const blindDoorW = this.blindDoorPartW(mod, W); // doorW + 11 — 도어가 목대를 덮는다 (corner.md §3.5.1)
              this.add(materials, modLabel, '도어', 'MDF', 18, blindDoorW, H - 30, mod.doorCount || 1, '4면', '멍장 도어(도어폭 기준) — 목대를 덮는다: doorW + 15 − 4 (corner.md §3.5.1)', mod);
              this.addBlindFrontParts(materials, modLabel, mod, H);
            } else if (isDrawer) {
              // ★ 2026-09-15: 서랍장 — 규칙은 bom-drawer-rules.js (도면 "서랍장 목찬넬 구조 도면").
              //   전면(위→아래): doorCount>0 이면 [도어, 서랍×n] — 플래너 doorTopDrawerBottom 과 같은 그림.
              //   예전엔 서랍을 위에 220 피치로 쌓고 남는 높이를 여닫이 도어로 냈다 — 2단부터 몸통이 안 맞았다
              //   (전면 합 H−50, 3단은 68 짜리 도어, 4단은 몸통 초과). 지금은 전면 합 = H 로 닫힌다.
              //   서랍 박스는 존(위·아래 따내기 사이)에 레일 여유를 빼고 들어가는 가장 큰 크기(대·중·소).
              //   목찬넬은 전면과 1:1 이 아니라 최소 수 — 중간 목찬넬만 모듈 부재(전면판 72·지면판 40 × W).
              //   상단 목찬넬은 그대로 EP(effectiveW 연속).
              this.addDrawerModuleParts(materials, modLabel, mod, W, T, doorCount, drawerLayout, modD);
            } else if (doorCount > 0) {
              const doorW = Math.floor(W / doorCount) - 4;
              this.add(materials, modLabel, '도어', 'MDF', 18, doorW, H - 30, doorCount, '4면', '', mod);
            }
          });

          // ===== EP (마감재) =====
          const epLabel = `${prefix}EP`;
          // P1-1: 키큰장 단은 라인 폭에 넣지 않는다 — 스택 세 단의 폭이 다 더해져 걸레받이·목찬넬이 1200 길었다.
          //   키큰장은 좌대가 받치므로 걸레받이 구간이 아니고, 목찬넬은 하부단이 제 폭으로 따로 낸다 (addTallTierParts).
          const lineLowerModules = lowerModules.filter((m) => !bomTallTierOf(m));
          const totalLowerW = lineLowerModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
          const totalUpperW = upperModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
          // 하부 모듈이 하나도 없는 옛 저장 설계만 품목 폭 − 좌우 마감 120 으로 떨어진다. 키큰장만 있는 라인은 0 — 걸레받이가 없다.
          const effectiveW = lowerModules.length ? totalLowerW : item.w - 120;
          const moldingH = parseFloat(specs.moldingH) || 60;
          const lowerH = (specs.lowerH || 870) - legH;
          const totalH = parseFloat(item.h) || 2310;

          // 상몰딩 (moldingH >= 20이면 산출) — 상부 라인 위에 얹히므로 섹션 'upper'
          // P1-2: 상부장이 없으면 없다. 예전엔 `totalUpperW || effectiveW` 로 하부 폭에 떨어져 없는 상몰딩이 나갔다.
          //   키큰장 상부단의 상몰딩은 그 단이 따로 낸다 (addTallTierParts).
          this.beginItemLevel('upper');
          if (moldingH >= 20 && totalUpperW > 0) {
            const moldingW = totalUpperW;
            const moldingEdge = moldingW > 2000 ? '2면(장)' : '4면';
            this.add(materials, epLabel, '상몰딩', 'MDF', 18, moldingH, moldingW, 1, moldingEdge);
          }

          // 걸레받이 — 여기부터 하부 라인 마감
          this.beginItemLevel('lower');
          if (effectiveW > 0) {
            this.add(materials, epLabel, '걸레받이', 'MDF', 18, effectiveW, legH - 5, 1, '2면(장)');
          }

          // 목찬넬
          if (isWoodChannel && effectiveW > 0) {
            this.add(materials, epLabel, '목찬넬(전면)', 'MDF', 18, 52, effectiveW, 1, '2면(장)');
            this.add(materials, epLabel, '목찬넬(지면)', 'MDF', 18, 40, effectiveW, 1, '2면(장)');
          }

          // P1-3: 상판 — 하부 라인에 한 장 (3D addTopPanel 도 배치 공간 단위 한 장이다 · W12-38).
          //   두께 = specs.topThickness (bom-protocol.md §2: 인조대리석 12/50 · 도어자재 18). 자재는 두께로 가른다 —
          //   18 이면 도어자재(MDF), 아니면 인조대리석. 마감 코드는 디테일 모델 top 슬롯 > specs.topColor 의 TOP-* (add()).
          //   폭 = 하부 라인 폭 + 좌·우 마감 폭 (상판은 마감재 위를 지나간다 — 3D 는 영역 전폭 그대로). 깊이 = 품목 깊이(배치 깊이).
          //   [확인 필요] 오버행·물끊기·개수대/쿡탑 타공은 규칙이 없다 (계획 B2).
          //   **품목당 한 장**이다 — 사용자 결정 2026-09-15. 3D 가 배치 공간(런)마다 한 장 그리는 것은 표시용 단순화이고,
          //   ㄱ·ㄷ자도 발주는 폭 합 한 장이다 (scene-bom-ledger.md §4 항목 3 · 허용 목록 `ep|top` 은 의도된 차이로 남는다).
          //   쿡탑장(type cook)은 몸통을 안 내지만 상판은 그 위를 지나가므로 폭에 넣는다 (걸레받이 effectiveW 는 예전대로 뺀다).
          const topLineW = (item.modules || [])
            .filter((m) => m.pos === 'lower' && !bomTallTierOf(m))
            .reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0)
            || (lowerModules.length ? 0 : effectiveW);
          if (topLineW > 0) {
            const topT = parseFloat(specs.topThickness) || 12;
            const topD = parseFloat(item.d) || 650;
            const finW = (type, w) => (type && type !== 'None' ? (parseFloat(w) || 0) : 0);
            const topW = topLineW + finW(specs.finishLeftType, specs.finishLeftWidth) + finW(specs.finishRightType, specs.finishRightWidth);
            const topMaterial = topT === 18 ? 'MDF' : '인조대리석';
            this.add(materials, `${prefix}상판`, '상판', topMaterial, topT, topW, topD, 1,
                     topMaterial === 'MDF' ? '1면(전)' : '-',
                     '[확인 필요] 오버행·타공 규칙 없음 — 하부 라인 한 장(좌·우 마감 폭 포함)');
          }

          // 좌측 마감 (몰딩/휠라/EP)
          if (specs.finishLeftType !== 'None' && specs.finishLeftWidth > 0) {
            const finishName = specs.finishLeftType === 'Filler' ? '휠라(좌)' : specs.finishLeftType === 'EP' ? 'EP(좌)' : '몰딩(좌)';
            this.add(materials, epLabel, finishName, 'MDF', 18, specs.finishLeftWidth, totalH - legH, 1, '4면');
          }
          // 우측 마감 (몰딩/휠라/EP)
          if (specs.finishRightType !== 'None' && specs.finishRightWidth > 0) {
            const finishName = specs.finishRightType === 'Filler' ? '휠라(우)' : specs.finishRightType === 'EP' ? 'EP(우)' : '몰딩(우)';
            this.add(materials, epLabel, finishName, 'MDF', 18, specs.finishRightWidth, totalH - legH, 1, '4면');
          }

          // W10-4: 코너 마감 (몰딩/휠라) — ㄱ자/ㄷ자, 기존 finish 체계 (design §6)
          const layoutShape = specs.lowerLayoutShape || specs.layoutShape || 'I';
          if (layoutShape !== 'I' && specs.finishCorner1Type !== 'None' && parseFloat(specs.finishCorner1Width) > 0) {
            const c1Name = specs.finishCorner1Type === 'Filler' ? '휠라(코너1)' : '몰딩(코너1)';
            this.add(materials, epLabel, c1Name, 'MDF', 18, parseFloat(specs.finishCorner1Width), totalH - legH, 1, '4면');
          }
          if (layoutShape === 'U' && specs.finishCorner2Type !== 'None' && parseFloat(specs.finishCorner2Width) > 0) {
            const c2Name = specs.finishCorner2Type === 'Filler' ? '휠라(코너2)' : '몰딩(코너2)';
            this.add(materials, epLabel, c2Name, 'MDF', 18, parseFloat(specs.finishCorner2Width), totalH - legH, 1, '4면');
          }
        }

        // ========================================
        // 붙박이장 자재 추출
        // ========================================
        extractWardrobe(item, materials, prefix = '') {
          const specs = item.specs || {};
          const T = this.thicknessFor(specs);
          // 2026-09-16: 기본값을 여기 베껴 두지 않는다 — 깊이는 620 으로 바뀌었고(#670),
          //   상몰딩 기본은 문서·DEFAULT_SPECS 가 20 인데 여기만 15 라 specs 가 빈 품목에서
          //   몸통이 5mm 높게 잡혔다. 둘 다 규칙 파일(bom-wardrobe-rules.js)을 읽는다.
          const D = parseFloat(item.d) || WR_DEFAULTS.DEFAULT_D;
          const pedestalH = parseFloat(specs.wardrobePedestal) || WR_DEFAULTS.PEDESTAL_H;
          const moldingH = parseFloat(specs.wardrobeMoldingH) || WR_DEFAULTS.MOLDING_H;
          const totalH = parseFloat(item.h) || WR_DEFAULTS.DEFAULT_H;
          const bodyH = totalH - pedestalH - moldingH;

          dlog('[Wardrobe] ===== 붙박이장 자재 추출 시작 =====');
          dlog('[Wardrobe] item: w=%s, h=%s, d=%s, bodyH=%s', item.w, item.h, item.d, bodyH);

          // ★ 붙박이장 모듈만 필터 (pos=wardrobe 또는 W6-7 V2 pos=tall)
          const modules = (item.modules || []).filter(m => m.pos === 'wardrobe' || m.pos === 'tall');

          dlog('[Wardrobe] 모듈 수:', modules.length);

          if (modules.length === 0) {
            console.warn('[Wardrobe] ⚠️ 모듈이 없습니다!');
            return;
          }

          let totalW = 0;

          modules.forEach((mod, idx) => {
            this.beginModule(mod, idx, mod.pos || 'wardrobe');
            // 2026-09-17: 통 구조 블록이 있으면 칸막이·선반을 **칸에서** 낸다 (옛 선반수 필드보다 정확하다).
            //   블록이 없는 옛 설계는 예전 그대로 shelfCount* 를 쓴다.
            const wrBlock = (WardrobeRules && mod.wardrobe) ? WardrobeRules.normalizeBlock(mod.wardrobe) : null;
            const wrLayout = (wrBlock && (wrBlock.preset || wrBlock.cells))
              ? WardrobeRules.layoutWardrobeModule({
                W: parseFloat(mod.w) || WR_DEFAULTS.SAMPLE_CELL_W,
                D: parseFloat(mod.d) || D,
                T,
                bodyH,
                preset: wrBlock.preset,
                cells: wrBlock.cells,
                drawers: wrBlock.drawers,
                externalDrawer: wrBlock.externalDrawer,
              })
              : null;
            const modType = mod.moduleType || 'long';
            const isDivided = modType === 'short' || modType === 'shelf';
            const rawName = mod.name || `${idx + 1}번`;
            const name = `${prefix}${rawName}`;

            // ★ 모듈 치수가 BOM의 근거
            const W = parseFloat(mod.w) || 900;
            const modD = parseFloat(mod.d) || D;
            const drawerCount = mod.drawerCount || 0;
            const isExternalDrawer = mod.isExternalDrawer || false;
            const doorCount = mod.doorCount || Math.max(1, Math.round(W / 450));

            totalW += W;

            if (isDivided) {
              // ===== 상하분리형 (short/shelf): 상부장·하부장 각각 독립 캐비닛 =====
              const DRAWER_MOD_H = 350;
              const externalDrawerH = (isExternalDrawer && drawerCount > 0) ? drawerCount * DRAWER_MOD_H : 0;
              const availableH = bodyH - externalDrawerH;
              const upperH = parseFloat(mod.upperH) || Math.floor(availableH / 2);
              const lowerH = parseFloat(mod.lowerH) || Math.floor(availableH / 2);

              dlog(`[Wardrobe] 모듈 ${name}: type=${modType}, W=${W}, upperH=${upperH}, lowerH=${lowerH}, D=${modD}, doors=${doorCount}, extDrawerH=${externalDrawerH}`);

              // --- 상부장 ---
              this.add(materials, `${name}-상부장`, '측판', 'PB', T, modD, upperH, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${name}-상부장`, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
              this.add(materials, `${name}-상부장`, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
              this.add(materials, `${name}-상부장`, '뒷판', 'MDF', 2.7, W - 20, upperH - 1, 1, '-');
              const shelfUpper = wrLayout ? 0 : (mod.shelfCountUpper || 0);
              if (shelfUpper > 0) {
                this.add(materials, `${name}-상부장`, '선반', 'PB', T, W - T * 2, modD - 18 - 70, shelfUpper, '1면(전)');
              }

              // --- 하부장 ---
              this.add(materials, `${name}-하부장`, '측판', 'PB', T, modD, lowerH, 2, '3면');
              this.add(materials, `${name}-하부장`, '천판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
              this.add(materials, `${name}-하부장`, '지판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
              this.add(materials, `${name}-하부장`, '뒷판', 'MDF', 2.7, W - T * 2, lowerH - T, 1, '-');
              const shelfLower = wrLayout ? 0 : (mod.shelfCountLower || 0);
              if (shelfLower > 0) {
                this.add(materials, `${name}-하부장`, '선반', 'PB', T, W - T * 2, modD - T, shelfLower, '1면(전)');
              }

              // 서랍
              if (drawerCount > 0) {
                const drawerFBW = isExternalDrawer ? W - 30 - 42 : W - 30 - 42 - 120;
                if (isExternalDrawer) {
                  // 외부 서랍 모듈 본체 (별도 제작)
                  const drawerModH = drawerCount * DRAWER_MOD_H;
                  this.add(materials, `${name}-서랍모듈`, '측판', 'PB', T, modD, drawerModH, 2, '3면', 'sakuri(15→3mm)');
                  this.add(materials, `${name}-서랍모듈`, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
                  this.add(materials, `${name}-서랍모듈`, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
                  this.add(materials, `${name}-서랍모듈`, '뒷판', 'MDF', 2.7, W - 20, drawerModH - 1, 1, '-');
                  this.add(materials, `${name}-서랍모듈`, '밴드', 'PB', T, W - T * 2, 70, 2, '2면(장)');
                  // 외부 서랍 자재
                  this.add(materials, `${name}-서랍모듈`, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍밑판', 'MDF', 2.7, W - 30 - 13, 449, drawerCount, '-');
                } else {
                  // 내부 서랍 자재 (전후판 -120 추가)
                  this.add(materials, `${name}`, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍밑판', 'MDF', 2.7, W - 30 - 13, 449, drawerCount, '-');
                  // 내부 서랍모듈 프레임 (모듈 기준 엣지)
                  this.add(materials, `${name}`, '내부서랍 상판', 'PB', T, W - 30, 520, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 측판', 'PB', T, 350, 500, 2, '3면');
                  this.add(materials, `${name}`, '내부서랍 지판', 'PB', T, W - 30 - 120, 500, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 밴드', 'PB', T, W - 30 - 120, 70, 2, '2면(장)');
                  this.add(materials, `${name}`, '내부서랍 좌우몰딩', 'PB', T, 350, 60, 2, '2면(장)');
                  this.add(materials, `${name}`, '내부서랍 전면판', 'PB', T, W - 30 - 120 - 6, 298, 1, '4면');
                }
                // 서랍 전후판 가로 600 초과 시 하단 보강재
                const bogangModule = isExternalDrawer ? `${name}-서랍모듈` : `${name}`;
                if (drawerFBW > 600) {
                  this.add(materials, bogangModule, '서랍 하단보강', 'PB', T, 440, 60, drawerCount, '2면(장)');
                }
              }

              // 도어 (좌대+bodyH-20 통일 — 짧은옷/긴옷 모두 동일 높이)
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                const doorH = pedestalH + bodyH - 20;
                if (isExternalDrawer && drawerCount > 0) {
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, doorH - drawerCount * DRAWER_MOD_H, doorCount, '4면', '', mod);
                  // 외부 서랍 도어 (목찬넬, 서랍수별 높이)
                  const drawerDoorW = W - 4;
                  const drawerModTotal = drawerCount * DRAWER_MOD_H + pedestalH;
                  let drawerDoorH, drawerDoorQty;
                  if (drawerCount === 1) {
                    drawerDoorH = drawerModTotal - 30 - 20;
                    drawerDoorQty = 1;
                  } else if (drawerCount === 2) {
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30) / 2);
                    drawerDoorQty = 2;
                  } else {
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30 - 30) / 3);
                    drawerDoorQty = 3;
                  }
                  this.add(materials, `${name}-서랍모듈`, '서랍도어', 'MDF', 18, drawerDoorW, drawerDoorH, drawerDoorQty, '4면', '', mod);
                } else {
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, doorH, doorCount, '4면', '', mod);
                }
              }

            } else {
              // ===== 긴옷(long): 단일 캐비닛 =====
              const DRAWER_MOD_H_LONG = 350;
              const externalDrawerH = (isExternalDrawer && drawerCount > 0) ? drawerCount * DRAWER_MOD_H_LONG : 0;
              const modH = (parseFloat(mod.h) || bodyH) - externalDrawerH;

              dlog(`[Wardrobe] 모듈 ${name}: type=${modType}, W=${W}, H=${modH}, D=${modD}, doors=${doorCount}, extDrawerH=${externalDrawerH}`);

              this.add(materials, `${name}`, '측판', 'PB', T, modD, modH, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${name}`, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
              this.add(materials, `${name}`, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
              this.add(materials, `${name}`, '뒷판', 'MDF', 2.7, W - 20, modH - 1, 1, '-');

              const shelfCount = wrLayout ? 0 : (mod.shelfCount || 1);
              if (shelfCount > 0) {
                this.add(materials, `${name}`, '선반', 'PB', T, W - T * 2, modD - 18 - 70, shelfCount, '1면(전)');
              }
              if (drawerCount > 0) {
                const drawerFBW = isExternalDrawer ? W - 30 - 42 : W - 30 - 42 - 120;
                if (isExternalDrawer) {
                  // 외부 서랍 모듈 본체 (별도 제작)
                  const drawerModH = drawerCount * DRAWER_MOD_H_LONG;
                  this.add(materials, `${name}-서랍모듈`, '측판', 'PB', T, modD, drawerModH, 2, '3면', 'sakuri(15→3mm)');
                  this.add(materials, `${name}-서랍모듈`, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
                  this.add(materials, `${name}-서랍모듈`, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
                  this.add(materials, `${name}-서랍모듈`, '뒷판', 'MDF', 2.7, W - 20, drawerModH - 1, 1, '-');
                  this.add(materials, `${name}-서랍모듈`, '밴드', 'PB', T, W - T * 2, 70, 2, '2면(장)');
                  // 외부 서랍 자재
                  this.add(materials, `${name}-서랍모듈`, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍밑판', 'MDF', 2.7, W - 30 - 13, 449, drawerCount, '-');
                } else {
                  // 내부 서랍 자재 (전후판 -120 추가)
                  this.add(materials, `${name}`, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍밑판', 'MDF', 2.7, W - 30 - 13, 449, drawerCount, '-');
                  // 내부 서랍모듈 프레임 (모듈 기준 엣지)
                  this.add(materials, `${name}`, '내부서랍 상판', 'PB', T, W - 30, 520, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 측판', 'PB', T, 350, 500, 2, '3면');
                  this.add(materials, `${name}`, '내부서랍 지판', 'PB', T, W - 30 - 120, 500, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 밴드', 'PB', T, W - 30 - 120, 70, 2, '2면(장)');
                  this.add(materials, `${name}`, '내부서랍 좌우몰딩', 'PB', T, 350, 60, 2, '2면(장)');
                  this.add(materials, `${name}`, '내부서랍 전면판', 'PB', T, W - 30 - 120 - 6, 298, 1, '4면');
                }
                // 서랍 전후판 가로 600 초과 시 하단 보강재
                const bogangModule = isExternalDrawer ? `${name}-서랍모듈` : `${name}`;
                if (drawerFBW > 600) {
                  this.add(materials, bogangModule, '서랍 하단보강', 'PB', T, 440, 60, drawerCount, '2면(장)');
                }
              }

              // 도어 (좌대+bodyH-20 통일 — 짧은옷/긴옷 모두 동일 높이)
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                const doorH = pedestalH + bodyH - 20;
                if (isExternalDrawer && drawerCount > 0) {
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, doorH - drawerCount * DRAWER_MOD_H_LONG, doorCount, '4면', '', mod);
                  // 외부 서랍 도어 (목찬넬, 서랍수별 높이)
                  const drawerDoorW = W - 4;
                  const drawerModTotal = drawerCount * DRAWER_MOD_H_LONG + pedestalH;
                  let drawerDoorH, drawerDoorQty;
                  if (drawerCount === 1) {
                    drawerDoorH = drawerModTotal - 30 - 20;
                    drawerDoorQty = 1;
                  } else if (drawerCount === 2) {
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30) / 2);
                    drawerDoorQty = 2;
                  } else {
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30 - 30) / 3);
                    drawerDoorQty = 3;
                  }
                  this.add(materials, `${name}-서랍모듈`, '서랍도어', 'MDF', 18, drawerDoorW, drawerDoorH, drawerDoorQty, '4면', '', mod);
                } else {
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, doorH, doorCount, '4면', '', mod);
                }
              }
            }

            // 2026-09-17: 통 구조에서 나오는 부재 — 칸막이(세로·수평)와 칸마다의 선반.
            //   몸통이 둘이면 그 몸통 이름으로 나눠 붙인다 (상부장·하부장 자재와 같은 묶음).
            if (wrLayout) {
              const cabs = WardrobeRules.cabinetsOf(wrLayout);
              cabs.forEach((car, ci) => {
                const label = cabs.length > 1
                  ? `${name}-${ci === 0 ? '하부장' : '상부장'}`
                  : `${name}`;
                WardrobeRules.partsOf({ dividers: car.dividers, shelves: car.shelves, T })
                  .forEach((row) => {
                    this.add(materials, label, row.part, row.material, row.t,
                      row.w, row.h, row.qty, row.edge, row.note || '');
                  });
              });
            }
          });

          dlog('[Wardrobe] 모듈 합계 너비:', totalW);

          // ===== EP (마감재) =====
          this.beginItemLevel('wardrobe');
          const finishLeftType = specs.finishLeftType || 'Molding';
          const finishLeftW = parseFloat(specs.finishLeftWidth) || 60;
          const finishRightType = specs.finishRightType || 'Molding';
          const finishRightW = parseFloat(specs.finishRightWidth) || 60;

          // 몰딩 EP 세로 고정 2440, 초과 시 2장
          const EP_H = 2440;
          const epQty = (len) => len > EP_H ? 2 : 1;

          // 상몰딩 — 규칙 파일이 정한다 (moldingPartFor).
          //   60 이상은 몰딩 폭 그대로, 60 미만은 마감재 스위치를 켤 때 60×18T MDF 로 낸다.
          //   2026-09-17: 붙박이장 기본 상몰딩 20 은 여태 아무 부재도 안 나왔다 — 그 자리를 막는 방법이다.
          const moldingRow = WardrobeRules && WardrobeRules.moldingPartFor
            ? WardrobeRules.moldingPartFor({
              moldingH, totalW,
              finish: WardrobeRules.moldingFinishOn(specs.wardrobeMoldingFinish),
            })
            : (moldingH >= 60 && totalW > 0
              ? { part: '상몰딩', material: 'MDF', t: 18, w: moldingH, h: EP_H, qty: epQty(totalW), edge: '2면(장)', note: '' }
              : null);
          if (moldingRow) {
            this.add(materials, 'EP', moldingRow.part, moldingRow.material, moldingRow.t,
              moldingRow.w, moldingRow.h, moldingRow.qty, moldingRow.edge, moldingRow.note || '');
          }

          // 좌측 몰딩
          if (finishLeftType !== 'None' && finishLeftW > 0) {
            this.add(materials, 'EP', '좌측몰딩', 'MDF', 18, finishLeftW, EP_H, epQty(bodyH), '2면(장)');
            if (finishLeftW >= 20) {
              this.add(materials, 'EP', '좌측몰딩 덧대', 'MDF', 18, 30, EP_H, epQty(bodyH), '2면(장)');
            }
          }

          // 우측 몰딩
          if (finishRightType !== 'None' && finishRightW > 0) {
            this.add(materials, 'EP', '우측몰딩', 'MDF', 18, finishRightW, EP_H, epQty(bodyH), '2면(장)');
            if (finishRightW >= 20) {
              this.add(materials, 'EP', '우측몰딩 덧대', 'MDF', 18, 30, EP_H, epQty(bodyH), '2면(장)');
            }
          }

          // 좌대 EP (전면 걸레받이)
          if (pedestalH > 0 && totalW > 0) {
            this.add(materials, 'EP', '좌대 걸레받이', 'MDF', 18, pedestalH, EP_H, epQty(totalW), '2면(장)');
          }

          // 외부 서랍 목찬넬 EP — 모듈에 딸린 손잡이 자리라 모듈 문맥으로 센다
          modules.forEach((mod, idx) => {
            const drawerCount = mod.drawerCount || 0;
            const isExternalDrawer = mod.isExternalDrawer || false;
            if (!isExternalDrawer || drawerCount <= 0) return;
            this.beginModule(mod, idx, mod.pos || 'wardrobe');
            const modW = parseFloat(mod.w) || 900;
            if (drawerCount === 1) {
              this.add(materials, 'EP', '목찬넬', 'MDF', 18, 100, modW, 1, '2면(장)');
            } else if (drawerCount === 2) {
              this.add(materials, 'EP', '목찬넬', 'MDF', 18, 120, modW, 1, '2면(장)');
            } else if (drawerCount >= 3) {
              this.add(materials, 'EP', '목찬넬', 'MDF', 18, 100, modW, 1, '2면(장)');
              this.add(materials, 'EP', '목찬넬', 'MDF', 18, 120, modW, 1, '2면(장)');
            }
          });

          // 좌대 (모듈별 본체)
          if (pedestalH > 0) {
            modules.forEach((mod, idx) => {
              this.beginModule(mod, idx, mod.pos || 'wardrobe');
              const modW = parseFloat(mod.w) || 900;
              const modD = parseFloat(mod.d) || D;
              const pName = `${prefix}${mod.name || `${idx + 1}번`}`;
              this.add(materials, `${pName}-좌대`, '좌대 전후', 'PB', T, modW - 30, pedestalH, 2, '1면(전)');
              this.add(materials, `${pName}-좌대`, '좌대 측', 'PB', T, modD - 35, pedestalH, 2, '1면(전)');
              if (modW >= 700) {
                this.add(materials, `${pName}-좌대`, '좌대 중간보강', 'PB', T, modD - 35 - 30, pedestalH, 1, '1면(전)');
              }
            });
          }

          dlog('[Wardrobe] ===== 추출 완료, 자재 수:', materials.length, '=====');
        }

        // ========================================
        // 냉장고장 자재 추출
        // ========================================
        extractFridge(item, materials, prefix = '') {
          const specs = item.specs || {};
          const T = this.thicknessFor(specs);
          const modules = item.modules || [];

          dlog('[Fridge] 모듈:', modules.length);

          if (modules.length === 0) return;

          modules.forEach((mod, idx) => {
            const modType = mod.type || '';
            if (modType === 'fridge') return; // 냉장고 자체는 제외
            this.beginModule(mod, idx, modType || null);

            // ★ 모듈 치수가 BOM의 근거
            const W = parseFloat(mod.w) || 600;
            const H = parseFloat(mod.h) || 2000;
            const D = parseFloat(mod.d) || specs.fridgeModuleD || 550;
            const name = mod.name || modType;

            dlog(`[Fridge] 모듈: ${modType}, W=${W}, H=${H}, D=${D}`);

            // 키큰장 (tall) — PB 구조
            const pf = prefix; // 같은 카테고리 복수 아이템 구분용
            if (modType === 'tall') {
              this.add(materials, `${pf}키큰장`, '측판', 'PB', T, D, H, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${pf}키큰장`, '천판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}키큰장`, '지판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}키큰장`, '뒷판', 'MDF', 2.7, W - 20, H - 1, 1, '-');
              this.add(materials, `${pf}키큰장`, '선반', 'PB', T, W - T * 2, D - 34, 3, '1면(전)');
              const doorCount = mod.doorCount || 1;
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                this.add(materials, `${pf}키큰장`, '도어', 'MDF', 18, doorW, H + 20, doorCount, '4면', '', mod);
              }
            }
            // 홈카페장 (homecafe) - 오픈장 규칙: MDF 18T 전체
            else if (modType === 'homecafe') {
              this.add(materials, `${pf}홈카페장`, '측판', 'MDF', 18, D + 20, H, 2, '3면');
              this.add(materials, `${pf}홈카페장`, '천판', 'MDF', 18, W - 36, D, 1, '2면(가로)');
              this.add(materials, `${pf}홈카페장`, '지판', 'MDF', 18, W - 36, D, 1, '2면(가로)');
              this.add(materials, `${pf}홈카페장`, '뒷판', 'MDF', 18, W - 36, H, 1, '2면(가로)'); // 18T!
              this.add(materials, `${pf}홈카페장`, '선반', 'MDF', 18, W - 36, D - 15, 2, '1면(전)');
              const doorCount = mod.doorCount || 1;
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                this.add(materials, `${pf}홈카페장`, '도어', 'MDF', 18, doorW, H + 20, doorCount, '4면', '', mod);
              }
            }
            // 상부장 (upper) — PB 구조
            else if (modType === 'upper') {
              this.add(materials, `${pf}냉장고상부장`, '측판', 'PB', T, D, H, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${pf}냉장고상부장`, '천판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}냉장고상부장`, '지판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}냉장고상부장`, '뒷판', 'MDF', 2.7, W - 20, H - 1, 1, '-');
              const doorCount = mod.doorCount || 1;
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                this.add(materials, `${pf}냉장고상부장`, '도어', 'MDF', 18, doorW, H + 20, doorCount, '4면', '', mod);
              }
            }
            // 하부장 (lower) — PB 구조
            else if (modType === 'lower') {
              this.add(materials, `${pf}냉장고하부장`, '측판', 'PB', T, D, H, 2, '3면');
              this.add(materials, `${pf}냉장고하부장`, '천판', 'PB', T, W - T * 2, D, 1, '1면(전)');
              this.add(materials, `${pf}냉장고하부장`, '지판', 'PB', T, W - T * 2, D, 1, '1면(전)');
              this.add(materials, `${pf}냉장고하부장`, '뒷판', 'MDF', 2.7, W - T * 2, H - T, 1, '-');
              const doorCount = mod.doorCount || 1;
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                this.add(materials, `${pf}냉장고하부장`, '도어', 'MDF', 18, doorW, H - 30, doorCount, '4면', '', mod);
              }
            }
            // EL장 (el) — PB 구조 (뒷판만)
            else if (modType === 'el') {
              this.add(materials, `${pf}EL장`, '측판', 'PB', T, D, H, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${pf}EL장`, '천판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}EL장`, '지판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}EL장`, '뒷판', 'MDF', 2.7, W - 20, H - 1, 1, '-');
            }
          });
        }

        // ========================================
        // B3: 단순 상자 카테고리 자재 추출 — 신발장·화장대·수납장·창고장 (simple-categories.md §6)
        //
        // 싱크대 추출기(extractSink)의 상부장·하부장·키큰장 단·EP 뼈대를 그대로 따르되, 싱크대에만 있는 것은 뺀다:
        //   개수대(type sink)·쿡탑(type cook)·후드(type hood) 가지 — 이 워크스페이스는 만들지 않는다 (타입 선택은 isSink 만)
        //   상판 — 규칙 없음 [확인 필요] (하부 모듈 h 가 lowerH − topT − legH 라 상판 두께 자리는 비어 있다)
        //   코너 마감 — simple-categories.md §3 은 I자뿐이다
        // 다른 점은 카테고리 상수(rules)와 아래 셋뿐이다:
        //   깊이     mod.d → item.d → rules.defaultD (싱크는 550 고정 폴백)
        //   선반 수  mod.shelfCount 를 존중, 없으면 기본 규칙(bomSimpleShelfQtyOf — 신발장은 180~350 분배)
        //   서랍 상자 깊이가 550 이 아니므로 레일 길이(§4-2)로 환산 — 측판 = 레일 − 60, 밑판 = 측판 + 9 (싱크 D550: 440·449)
        // 부재표는 simple-categories.md §6.1~6.4, 빌린 규칙 목록은 §6.5.
        // ========================================
        extractSimpleBox(item, materials, prefix = '', rules) {
          const specs = item.specs || {};
          const T = this.thicknessFor(specs);
          const isWoodChannel = (specs.handle || '').includes('목찬넬');
          const legH = parseFloat(specs.sinkLegHeight) || 150;
          const overlap = parseFloat(specs.upperDoorOverlap) || 15;
          const topT = parseFloat(specs.topThickness) || 12;
          const doorNote = `${BOM_SIMPLE_NOTE_WARDROBE} (doorCount 미지정 → round(W/450))`;
          const shelfNote = rules.shelfSpace
            ? `[확인 필요] shelfCount 미지정 — 신발장 선반 분배 ${rules.shelfSpace.min}~${rules.shelfSpace.max} (planner-engine.js) 준용`
            : `${BOM_SIMPLE_NOTE_SINK} (shelfCount 미지정 → 상부 2 · 하부 1)`;

          dlog(`[SimpleBox:${rules.label}] 모듈:`, (item.modules || []).length);

          // ===== 상부장 모듈 — bom-protocol.md §3-1 상부장 (사쿠리) =====
          const upperModules = (item.modules || []).filter((m) => m.pos === 'upper');
          upperModules.forEach((mod, idx) => {
            this.beginModule(mod, idx, 'upper');
            const W = parseFloat(mod.w) || 600;
            const H = parseFloat(mod.h) || (parseFloat(specs.upperH) || 720) - overlap;
            const modD = bomSimpleDepthOf(mod, 'upper', item, rules);
            const door = bomSimpleDoorCountOf(mod, W);
            const name = mod.name || `${W}/${door.count}도어`;
            const modLabel = `${prefix}상부장-${name}`;

            this.add(materials, modLabel, '측판', 'PB', T, modD, H, 2, '3면', 'sakuri(15→3mm)');
            this.add(materials, modLabel, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
            this.add(materials, modLabel, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
            this.add(materials, modLabel, '뒷판', 'MDF', 2.7, W - 20, H - 1, 1, '-');
            this.add(materials, modLabel, '밴드(보강목)', 'PB', T, W - T * 2, 70, 2, '2면(장)');
            this.add(materials, modLabel, '밴드(처짐방지)', 'PB', T, 70, H - T * 2, W >= 700 ? 2 : 1, '2면(장)');
            const shelf = bomSimpleShelfQtyOf(mod, rules);
            if (shelf.qty > 0) {
              this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - 34, shelf.qty, '1면(전)', shelf.defaulted ? shelfNote : '');
            }
            if (door.count > 0) {
              const doorW = Math.floor(W / door.count) - 4;
              this.add(materials, modLabel, '도어', 'MDF', 18, doorW, H + overlap, door.count, '4면', door.defaulted ? doorNote : '', mod);
            }
          });

          // ===== 하부장 모듈 — bom-protocol.md §3-1 하부장 (사쿠리 없음) · 키큰장 단은 sink.md §5.1 =====
          const lowerModules = (item.modules || []).filter((m) => m.pos === 'lower');
          lowerModules.forEach((mod, idx) => {
            const tallTier = bomTallTierOf(mod);
            if (tallTier) {
              this.beginModule(mod, idx, 'tall');
              // 선반 기본값만 카테고리 규칙으로 — addTallTierParts 는 shelfCount 가 없으면 1 (sink.md §5.1 통짜) 로 본다
              const shelf = bomSimpleShelfQtyOf(mod, rules);
              const tierMod = shelf.defaulted ? { ...mod, shelfCount: shelf.qty } : mod;
              this.addTallTierParts(materials, prefix, tierMod, tallTier, specs);
              return;
            }
            this.beginModule(mod, idx, 'lower');
            const W = parseFloat(mod.w) || 600;
            const H = parseFloat(mod.h) || (parseFloat(specs.lowerH) || 870) - topT - legH;
            const modD = bomSimpleDepthOf(mod, 'lower', item, rules);
            const door = bomSimpleDoorCountOf(mod, W);
            const name = mod.name || `${W}/${door.count}도어`;
            const modLabel = `${prefix}하부장-${name}`;
            const isDrawer = !!mod.isDrawer;

            this.add(materials, modLabel, '측판', 'PB', T, modD, H, 2, '3면');
            this.add(materials, modLabel, '지판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
            this.add(materials, modLabel, '밴드', 'PB', T, 70, W - T * 2, 2, '2면(장)');
            this.add(materials, modLabel, '뒷판', 'MDF', 2.7, W - T * 2, H - T, 1, '-');
            const bandH = isWoodChannel ? H - T * 2 - 70 : H - T * 2;
            this.add(materials, modLabel, '밴드(처짐방지)', 'PB', T, 70, bandH, W >= 800 ? 2 : 1, '2면(장)');
            const shelf = bomSimpleShelfQtyOf(mod, rules);
            if (shelf.qty > 0) {
              this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - T, shelf.qty, '1면(전)', shelf.defaulted ? shelfNote : '');
            }

            if (isDrawer) {
              // 서랍장 — 싱크 하부장 서랍 규칙(서랍 220 · 상자 180 · 1개면 전판 250 · 아래 여닫이 도어 · 목찬넬 120)을 깊이만 환산해 준용
              const drawerCount = mod.drawerCount || 1;
              const drawerH = 220;
              const totalDrawerH = drawerH * drawerCount;
              const hingeDoorH = H - totalDrawerH - 30;
              const railLen = bomSimpleRailLenOf(modD);
              const boxD = railLen - 60;       // 싱크 D550 → 레일 500 → 측판 440
              const bottomD = boxD + 9;        //                       → 밑판 449
              const boxNote = `${BOM_SIMPLE_NOTE_SINK} (D${modD} → 레일 ${railLen}: 측판 ${boxD} · 밑판 ${bottomD})`;
              const drawerFBW = W - 30 - 42;
              this.add(materials, modLabel, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)', boxNote);
              this.add(materials, modLabel, '서랍측판', 'PB', T, boxD, 180, drawerCount * 2, '1면(장)', boxNote);
              this.add(materials, modLabel, '서랍밑판', 'MDF', 2.7, W - 30 - 13, bottomD, drawerCount, '-', boxNote);
              if (drawerFBW > 600) {
                this.add(materials, modLabel, '서랍 하단보강', 'PB', T, boxD, 60, drawerCount, '2면(장)', boxNote);
              }
              const drawerDoorW = W - 4;
              const drawerDoorH = drawerCount === 1 ? 250 : Math.floor((totalDrawerH - 20) / drawerCount);
              this.add(materials, modLabel, '서랍도어', 'MDF', 18, drawerDoorW, drawerDoorH, drawerCount, '4면', '', mod);
              if (hingeDoorH > 50) {
                const hingeDoorCount = Math.max(1, Math.round(W / 450));
                const hingeDoorW = Math.floor(W / hingeDoorCount) - 4;
                this.add(materials, modLabel, '도어', 'MDF', 18, hingeDoorW, hingeDoorH, hingeDoorCount, '4면', '', mod);
              }
              this.add(materials, modLabel, '목찬넬', 'MDF', 18, 120, W, 1, '2면(장)');
            } else if (door.count > 0) {
              const doorW = Math.floor(W / door.count) - 4;
              this.add(materials, modLabel, '도어', 'MDF', 18, doorW, H - 30, door.count, '4면', door.defaulted ? doorNote : '', mod);
            }
          });

          // ===== EP (마감재) — 싱크대 EP 준용 (상판·코너 마감 없음) =====
          const epLabel = `${prefix}EP`;
          const lineLowerModules = lowerModules.filter((m) => !bomTallTierOf(m));
          const effectiveW = lineLowerModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
          const totalUpperW = upperModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
          const moldingH = parseFloat(specs.moldingH) || 60;
          const totalH = parseFloat(item.h) || 2310;

          // 상몰딩 — 상부장이 있을 때만 (P1-2 와 같다). 키큰장 상부단 상몰딩은 그 단이 낸다.
          this.beginItemLevel('upper');
          if (moldingH >= 20 && totalUpperW > 0) {
            this.add(materials, epLabel, '상몰딩', 'MDF', 18, moldingH, totalUpperW, 1, totalUpperW > 2000 ? '2면(장)' : '4면');
          }

          // 걸레받이·목찬넬 — 다리발 위 하부 라인 폭 (키큰장 단은 좌대가 받치므로 뺀다). 하부장이 없으면 없다.
          this.beginItemLevel('lower');
          if (effectiveW > 0) {
            this.add(materials, epLabel, '걸레받이', 'MDF', 18, effectiveW, legH - 5, 1, '2면(장)');
          }
          if (isWoodChannel && effectiveW > 0) {
            this.add(materials, epLabel, '목찬넬(전면)', 'MDF', 18, 52, effectiveW, 1, '2면(장)');
            this.add(materials, epLabel, '목찬넬(지면)', 'MDF', 18, 40, effectiveW, 1, '2면(장)');
          }

          // 좌·우 마감 — simple-categories.md §2: 기본 좌/우 모두 Filler 60. 타입·폭이 비어 있으면 그 기본값.
          const finishOf = (type, width) => {
            const t = type || 'Filler';
            const w = parseFloat(width);
            return { type: t, w: Number.isFinite(w) ? w : 60 };
          };
          const left = finishOf(specs.finishLeftType, specs.finishLeftWidth);
          if (left.type !== 'None' && left.w > 0) {
            const finishName = left.type === 'Filler' ? '휠라(좌)' : left.type === 'EP' ? 'EP(좌)' : '몰딩(좌)';
            this.add(materials, epLabel, finishName, 'MDF', 18, left.w, totalH - legH, 1, '4면');
          }
          const right = finishOf(specs.finishRightType, specs.finishRightWidth);
          if (right.type !== 'None' && right.w > 0) {
            const finishName = right.type === 'Filler' ? '휠라(우)' : right.type === 'EP' ? 'EP(우)' : '몰딩(우)';
            this.add(materials, epLabel, finishName, 'MDF', 18, right.w, totalH - legH, 1, '4면');
          }
        }

        // ========================================
        // 요약 계산
        // ========================================
        calculateSummary(materials) {
          const summary = {};
          materials.forEach((m) => {
            const key = `${m.material}_${m.thickness}`;
            if (!summary[key]) {
              summary[key] = { material: m.material, thickness: m.thickness, totalArea: 0, panelCount: 0 };
            }
            summary[key].totalArea += m.w * m.h * m.qty;
          });

          const panelArea = this.PANEL_W * this.PANEL_H;
          Object.values(summary).forEach((s) => {
            s.panelCount = Math.ceil(s.totalArea / panelArea);
          });

          return summary;
        }

        // ========================================
        // B1: 엣지밴딩 총길이(mm) — 두께별. { '1': Σ 전면 edgeLen×qty, '0.6': Σ 나머지 }.
        //   summary 안에 넣지 않는다: ai-design-report.js(:72, :2839)·워커 snapshots.js 가 summary 값을
        //   전부 `{material, thickness, totalArea, panelCount}` 로 순회해 표를 그리므로 다른 모양의 키가
        //   들어가면 깨진 행이 생긴다. extract() 결과의 형제 키 `edgeBanding` 으로 둔다 (add-only).
        // ========================================
        calculateEdgeBanding(materials) {
          const out = {};
          materials.forEach((m) => {
            const t = String(m.edgeT != null ? m.edgeT : bomEdgeThicknessOf(m.slot));
            const len = (Number(m.edgeLen) || 0) * (Number(m.qty) || 0);
            out[t] = (out[t] || 0) + len;
          });
          return out;
        }

        // ========================================
        // CSV 출력
        // ========================================
        toCSV(materials) {
          let csv = '모듈,부품,자재,두께,가로,세로,수량,엣지,비고\n';
          materials.forEach((m) => {
            csv += `${m.module},${m.part},${m.material},${m.thickness},${m.w},${m.h},${m.qty},${m.edge},${m.note || ''}\n`;
          });
          return csv;
        }

        // ========================================
        // CNC 출력
        // ========================================
        toCNC(materials) {
          let csv = '품목,자재,두께,가로,세로,수량,엣지L,엣지R,엣지T,엣지B\n';
          materials.forEach((m) => {
            let el = 0,
              er = 0,
              et = 0,
              eb = 0;
            if (m.edge === '4면') {
              el = er = et = eb = 1;
            } else if (m.edge === '3면') {
              // B1: 측판 3면 — 이 가지가 없어서 측판이 CNC 에 엣지 0,0,0,0 으로 나갔다 (골든 cncHead 2행).
              //   앞(L) + 위(T) + 아래(B). 뒤(R)는 벽·뒷판 쪽이라 안 붙인다. 1면(전)=L 인 이 표의 관례를 따른다.
              el = et = eb = 1;
            } else if (m.edge.includes('2면')) {
              if (m.w > m.h) {
                el = er = 1;
              } else {
                et = eb = 1;
              }
            } else if (m.edge.includes('1면')) {
              el = 1;
            }
            csv += `${m.part},${m.material},${m.thickness},${m.w},${m.h},${m.qty},${el},${er},${et},${eb}\n`;
          });
          return csv;
        }
      }

      // ============================================================
      // 부자재 추출 클래스 (Hardware Extractor) v1.0
      // ============================================================
      class HardwareExtractor {
        constructor() {
          this.hingeRules = { 900: 2, 1600: 3, 9999: 4 }; // 높이별 경첩 수
        }

        extract(designData) {
          const hardware = [];
          const items = designData.items || [];

          // 품목 라벨 생성 (MaterialExtractor와 동일 로직 — B3 단순 카테고리 라벨은 규칙표에서)
          const catNames = { sink: '싱크대', wardrobe: '붙박이장', fridge: '냉장고장' };
          const categoryTotals = {};
          const categoryCounts = {};
          items.forEach(item => {
            const cat = item.categoryId || item.category;
            categoryTotals[cat] = (categoryTotals[cat] || 0) + 1;
          });

          items.forEach((item) => {
            const category = item.categoryId || item.category;
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
            const prefix = categoryTotals[category] > 1 ? `#${categoryCounts[category]} ` : '';
            const simpleRules = BOM_SIMPLE_CATEGORY_RULES[category] || null;
            const catName = catNames[category] || (simpleRules && simpleRules.label) || category;
            const itemLabel = item.labelName || `${prefix}${catName}`;
            const beforeLen = hardware.length;

            this.extractHinges(item, hardware);
            this.extractRails(item, hardware);
            this.extractWardrobeRods(item, hardware);
            this.extractHandles(item, hardware);
            this.extractLegs(item, hardware);
            this.extractBrackets(item, hardware);
            this.extractOthers(item, hardware);

            // 새로 추가된 부자재에 품목 라벨 태깅
            for (let i = beforeLen; i < hardware.length; i++) {
              hardware[i].itemLabel = itemLabel;
            }
          });

          return {
            hardware,
            summary: this.calculateSummary(hardware),
            extractDate: new Date().toISOString(),
          };
        }

        // 경첩 수 계산 — bom-protocol.md §4-1 · ACTIVE_RULES.md §9.1: ≤900 → 2구, 901~1600 → 3구, 1601+ → 4구.
        //   문턱은 **재단 도어 높이**(자재 행의 h) 기준이다 — 몸통 H 가 아니다.
        getHingeCount(doorH) {
          if (doorH <= 900) return 2;
          if (doorH <= 1600) return 3;
          return 4;
        }

        // 보링 위치 계산
        getBoringPositions(doorH) {
          const count = this.getHingeCount(doorH);
          if (count === 2) return [110, doorH - 110];
          if (count === 3) return [110, Math.round(doorH / 2), doorH - 110];
          return [110, Math.round(doorH / 3), Math.round((doorH * 2) / 3), doorH - 110];
        }

        // 경첩 추출
        extractHinges(item, hardware) {
          const specs = item.specs || {};
          // B3: 단순 카테고리는 도어 수·높이를 자재 행(extractSimpleBox)과 같은 식으로 센다 — doorCount 가 없는 모듈(round(W/450))과
          //   서랍장 아래 여닫이 도어가 자재 행엔 있는데 경첩엔 없던 어긋남을 막는다. 키큰장 단은 아래 공통 경로(bomTallTierDoorH).
          const simpleRules = BOM_SIMPLE_CATEGORY_RULES[item.categoryId || item.category];
          (item.modules || []).forEach((mod) => {
            let doorCount = mod.doorCount || 0;
            let simpleDoorH = null;
            if (simpleRules && (mod.pos === 'upper' || mod.pos === 'lower')) {
              const d = bomSimpleHingeDoorsOf(mod, specs);
              doorCount = d.count;
              simpleDoorH = d.doorH;
            }
            if (doorCount === 0) return;

            // 도어 높이 = 자재 행이 낸 재단 도어 높이와 같아야 한다 (bom-protocol.md §4-1).
            //   상부   H + 내림(overlap)
            //   하부   H − 30 (목찬넬 틈)
            //   키큰장 단(싱크 하부 라인 `type:'tall'`, sink.md §5.1)  bomTallTierDoorH — 목찬넬 단 H−30 / 푸쉬 단 H−4.
            //          예전엔 `pos lower → H−30` 으로 떨어져 푸쉬 단(H−4)의 경첩 수·보링이 자재 행과 어긋났다
            //          (몸통 H 905~930 · 1605~1630 구간에서 도어마다 경첩 한 개가 빠진다).
            //   그 밖(붙박이·냉장고장 — pos 없음)  H 그대로 (예전과 같다)
            let doorH;
            const upperOverlap = parseFloat(specs.upperDoorOverlap) || 15;
            const tallTier = mod.pos === 'lower' ? bomTallTierOf(mod) : null;
            if (tallTier) doorH = bomTallTierDoorH(mod, tallTier, specs);
            else if (mod.pos === 'upper') doorH = (mod.h || specs.upperH - upperOverlap) + upperOverlap;
            else if (mod.pos === 'lower') doorH = (mod.h || (specs.lowerH || 870) - (parseFloat(specs.topThickness) || 12) - (parseFloat(specs.sinkLegHeight) || 150)) - 30;
            else doorH = mod.h || 700;
            if (simpleDoorH !== null) doorH = simpleDoorH; // B3 서랍장 여닫이 도어 — 자재 행의 hingeDoorH

            const hingesPerDoor = this.getHingeCount(doorH);
            const boring = this.getBoringPositions(doorH);

            hardware.push({
              category: '경첩',
              item: '문주 110도 약압 경첩',
              manufacturer: '문주',
              spec: `${hingesPerDoor}구`,
              qty: hingesPerDoor * doorCount,
              unit: 'EA',
              note: `${mod.name || mod.type} (보링: ${boring.join(', ')})`,
            });
          });
        }

        /**
         * 옷봉 — 2026-09-17 새로 낸다.
         *
         * 그때까지 옷봉은 **도면에만** 있었다. 자재·철물 어디에도 없어 발주 목록에서 통째로 빠졌고,
         * 붙박이장에서 그건 빠뜨리면 안 되는 물건이다. 규격은 사장님 확정 — 크롬 25파이 + 원형소켓 2EA,
         * 길이는 칸 내경 폭 − 5 (양쪽 소켓 자리).
         *
         * 칸 구조(mod.wardrobe)가 있으면 규칙 파일이 칸마다 낸다 — 반 분할 통은 봉이 둘, 길이도 반이다.
         * 없는 옛 설계는 통 하나를 한 칸으로 보고 옛 필드로 개수만 센다:
         *   긴옷(long)은 옷봉 1개 자동(ui-workspace 의 "옷봉 1개 자동 설치"), 나머지는 상·하 옷봉 수의 합.
         */
        extractWardrobeRods(item, hardware) {
          const category = item.categoryId || item.category;
          if (category !== 'wardrobe' || !WardrobeRules) return;
          const R = WardrobeRules.WARDROBE_RULES;
          const specs = item.specs || {};
          const bodyT = parseFloat(specs.bodyThickness);
          const T = Number.isFinite(bodyT) && bodyT > 0 ? bodyT : R.PANEL_T;
          const lengths = [];
          (item.modules || []).forEach((mod) => {
            if (mod.pos !== 'wardrobe' && mod.pos !== 'tall') return;
            const W = parseFloat(mod.w) || R.SAMPLE_CELL_W;
            const block = WardrobeRules.normalizeBlock(mod.wardrobe || null);
            if (block.preset || block.cells) {
              const L = WardrobeRules.layoutWardrobeModule({
                W, T, D: parseFloat(mod.d) || parseFloat(item.d) || R.DEFAULT_D,
                totalH: parseFloat(item.h) || R.DEFAULT_H,
                pedestalH: parseFloat(specs.wardrobePedestal),
                moldingH: parseFloat(specs.wardrobeMoldingH),
                preset: block.preset, cells: block.cells, drawers: block.drawers,
              });
              (L.rods || []).forEach((r) => lengths.push(r.length));
              return;
            }
            const modType = mod.moduleType || 'long';
            const n = modType === 'long'
              ? 1
              : (parseInt(mod.rodCountUpper, 10) || 0) + (parseInt(mod.rodCountLower, 10) || 0);
            for (let i = 0; i < n; i++) lengths.push(WardrobeRules.rodLengthFor(W - 2 * T));
          });
          WardrobeRules.rodHardwareFor(lengths).forEach((row) => hardware.push({
            category: '옷봉',
            item: row.name,
            manufacturer: '',
            spec: row.spec,
            qty: row.qty,
            unit: row.unit,
            note: row.note,
          }));
        }

        // 레일 추출
        extractRails(item, hardware) {
          const category = item.categoryId || item.category;

          // 붙박이장: 모듈별 drawerCount 기준
          if (category === 'wardrobe') {
            (item.modules || []).forEach((mod) => {
              const drawerCount = mod.drawerCount || 0;
              if (drawerCount <= 0) return;
              hardware.push({
                category: '레일',
                item: '문주 언더레일',
                manufacturer: '문주',
                spec: '450mm',
                qty: drawerCount,
                unit: 'SET',
                note: mod.name || mod.type,
              });
            });
            return;
          }

          // B3: 단순 카테고리 — 자재 행(extractSimpleBox)과 같은 깊이 폴백으로 레일 길이를 정하고, 서랍 **개수**만큼 센다.
          //   (아래 기타 경로는 모듈당 1 SET 로 과소 — 싱크는 골든에 묶여 있어 그대로 두고(계획 B2), 새 카테고리만 맞춘다)
          const simpleRules = BOM_SIMPLE_CATEGORY_RULES[category];
          if (simpleRules) {
            (item.modules || []).forEach((mod) => {
              if (!mod.isDrawer || mod.pos !== 'lower' || bomTallTierOf(mod)) return;
              const depth = bomSimpleDepthOf(mod, 'lower', item, simpleRules);
              hardware.push({
                category: '레일',
                item: '소프트클로즈 서랍레일',
                manufacturer: '블룸',
                spec: `${bomSimpleRailLenOf(depth)}mm`,
                qty: mod.drawerCount || 1,
                unit: 'SET',
                note: mod.name || mod.type,
              });
            });
            return;
          }

          // 기타 카테고리 — 2026-09-15: 레일은 단수만큼, 종류는 mod.drawer.rail (댐핑 언더레일 기본 · 댐핑 볼레일)
          (item.modules || []).forEach((mod) => {
            if (!mod.isDrawer) return;
            const depth = mod.d || 550;
            // 2026-09-15: 레일 길이 = 규격(250~500) 중 깊이 − 50 이하의 최대 (bom-drawer-rules.js railLengthFor)
            const R = DrawerRules ? DrawerRules.DRAWER_RULES : null;
            const railKey = DrawerRules ? DrawerRules.railKeyOf((mod.drawer && mod.drawer.rail) || mod.drawerRail) : 'under';
            const railName = R ? R.RAIL_CLEARANCE[railKey].name : '소프트클로즈 서랍레일';
            let railLength = DrawerRules ? DrawerRules.railLengthFor(depth) : null;
            if (railLength === null) railLength = R ? R.RAIL_LENGTHS[0] : 250;
            const maxN = R ? R.MAX_COUNT : 4;
            const qty = Math.min(maxN, Math.max(1, parseInt(mod.drawerCount, 10) || 1));

            hardware.push({
              category: '레일',
              item: railName,
              manufacturer: '블룸',
              spec: `${railLength}mm`,
              qty,
              unit: 'SET',
              note: `${mod.name || mod.type}${railKey === 'ball' && R ? ` · 두께 ${R.RAIL_CLEARANCE.ball.thickness}` : ''}`,
            });
          });
        }

        // 손잡이 추출
        extractHandles(item, hardware) {
          const specs = item.specs || {};
          const category = item.categoryId || item.category;
          let totalDoors = 0;
          // B3: 단순 카테고리는 자재 도어 행과 같은 수(bomSimpleHingeDoorsOf — 경첩과 같은 함수)로 센다.
          const simpleRules = BOM_SIMPLE_CATEGORY_RULES[category];
          (item.modules || []).forEach((mod) => {
            if (simpleRules && (mod.pos === 'upper' || mod.pos === 'lower')) totalDoors += bomSimpleHingeDoorsOf(mod, specs).count;
            else totalDoors += mod.doorCount || 0;
          });

          if (totalDoors === 0) return;

          // 붙박이장: handleType (push/smartbar/round)
          if (category === 'wardrobe') {
            const ht = specs.handleType || 'push';
            const nameMap = { push: '푸쉬', smartbar: '스마트바', round: '라운드' };
            // 푸쉬: 도어당 1EA, 스마트바: 모듈당 1EA, 라운드: 모듈당 1EA
            const totalModules = (item.modules || []).length;
            const qty = ht === 'push' ? totalDoors : totalModules;
            hardware.push({
              category: '손잡이',
              item: nameMap[ht] || ht,
              manufacturer: '-',
              spec: ht === 'smartbar' ? '30mm' : '-',
              qty: qty,
              unit: 'EA',
              note: item.category,
            });
          } else {
            // 기타 카테고리
            const handleType = specs.handle || '찬넬';
            hardware.push({
              category: '손잡이',
              item: handleType.includes('스마트바')
                ? '스마트바'
                : handleType.includes('목찬넬')
                  ? '목찬넬'
                  : handleType,
              manufacturer: '-',
              spec: '-',
              qty: handleType.includes('스마트바') ? (item.modules || []).length : totalDoors,
              unit: 'EA',
              note: item.category,
            });
          }
        }

        // 다리발 추출
        extractLegs(item, hardware) {
          const category = item.categoryId || item.category;
          // B3: 단순 카테고리도 다리발 150 위에 선다 (simple-categories.md §2). 키큰장 단은 좌대가 받치므로 뺀다
          //   (싱크는 골든에 묶여 있어 그대로 — 키큰장 단도 세는 옛 셈이 남아 있다).
          const simple = !!BOM_SIMPLE_CATEGORY_RULES[category];
          if (category !== 'sink' && !simple) return;
          const specs = item.specs || {};
          const legH = specs.sinkLegHeight || 150;
          let totalLegs = 0;

          (item.modules || [])
            .filter((m) => m.pos === 'lower' && !(simple && bomTallTierOf(m)))
            .forEach((mod) => {
              const w = mod.w || 600;
              if (w <= 600) totalLegs += 4;
              else if (w <= 900) totalLegs += 6;
              else totalLegs += 8;
            });

          if (totalLegs > 0) {
            hardware.push({
              category: '다리발',
              item: '조절 다리발',
              manufacturer: '-',
              spec: `${legH}mm`,
              qty: totalLegs,
              unit: 'EA',
              note: '하부장',
            });
          }
        }

        // 선반 브라켓 추출
        extractBrackets(item, hardware) {
          let shelfCount = 0;
          // B3: 단순 카테고리는 자재 행과 같은 함수(bomSimpleShelfQtyOf)로 센다 — shelfCount 지정·신발장 분배 규칙이 브라켓에도 닿는다.
          const simpleRules = BOM_SIMPLE_CATEGORY_RULES[item.categoryId || item.category];
          (item.modules || []).forEach((mod) => {
            if (simpleRules) {
              if (mod.pos === 'upper' || mod.pos === 'lower') shelfCount += bomSimpleShelfQtyOf(mod, simpleRules).qty;
              return;
            }
            if (mod.pos === 'upper' && mod.type !== 'hood') shelfCount += 2;
            else if (mod.pos === 'lower' && !mod.isDrawer && mod.type !== 'sink' && mod.type !== 'cook')
              shelfCount += 1;
          });

          if (shelfCount > 0) {
            hardware.push({
              category: '브라켓',
              item: '선반 브라켓 (핀타입)',
              manufacturer: '-',
              spec: 'Φ5mm',
              qty: shelfCount * 4,
              unit: 'EA',
              note: `선반 ${shelfCount}개 × 4`,
            });
          }
        }

        // 기타 부자재
        extractOthers(item, hardware) {
          // 도어 댐퍼 미사용 (사내 규정)
        }

        // 요약
        calculateSummary(hardware) {
          const summary = {};
          hardware.forEach((h) => {
            if (!summary[h.category]) summary[h.category] = 0;
            summary[h.category] += h.qty;
          });
          return summary;
        }

        // CSV 생성
        toCSV(hardware) {
          let csv = '분류,품목,제조사,스펙,수량,단위,비고\n';
          hardware.forEach((h) => {
            csv += `${h.category},${h.item},${h.manufacturer},${h.spec},${h.qty},${h.unit},${h.note}\n`;
          });
          return csv;
        }
      }

      // ============================================================
      // 도면 시각화 클래스 (Drawing Visualizer) v1.0
      // ============================================================
      class DrawingVisualizer {
        // 원판 규격은 data-constants.js SHEET_W/H 가 정본 — MaterialExtractor 와 같은 폴백 방식 (계획 B0)
        constructor() {
          this.PANEL_W = typeof SHEET_W !== 'undefined' ? SHEET_W : 1220;
          this.PANEL_H = typeof SHEET_H !== 'undefined' ? SHEET_H : 2440;
          this.KERF = 4;
        }

        // 재단 도면 생성
        generateCuttingLayout(materials, mode = 'material') {
          const groups = this.groupByMaterial(materials);
          const panels = {};

          Object.keys(groups).forEach((key) => {
            panels[key] = this.packParts(groups[key], mode);
          });

          return panels;
        }

        // 자재별 그룹화
        groupByMaterial(materials) {
          const groups = {};
          materials.forEach((m) => {
            const key = `${m.material}_${m.thickness}T`;
            if (!groups[key]) groups[key] = [];
            for (let i = 0; i < m.qty; i++) {
              groups[key].push({ ...m, qty: 1 });
            }
          });
          return groups;
        }

        // Bin Packing
        packParts(parts, mode) {
          const sorted = [...parts].sort((a, b) => b.w * b.h - a.w * a.h);
          const panels = [];
          let panelId = 1;

          sorted.forEach((part) => {
            let placed = false;
            for (const panel of panels) {
              if (this.tryPlace(panel, part)) {
                placed = true;
                break;
              }
            }
            if (!placed) {
              const newPanel = this.createPanel(panelId++);
              this.tryPlace(newPanel, part);
              panels.push(newPanel);
            }
          });

          return panels;
        }

        createPanel(id) {
          return {
            id,
            w: this.PANEL_W,
            h: this.PANEL_H,
            parts: [],
            freeRects: [{ x: 0, y: 0, w: this.PANEL_W, h: this.PANEL_H }],
          };
        }

        tryPlace(panel, part) {
          const orientations = [
            { w: part.w, h: part.h, rotated: false },
            { w: part.h, h: part.w, rotated: true },
          ];

          for (const orient of orientations) {
            for (let i = 0; i < panel.freeRects.length; i++) {
              const rect = panel.freeRects[i];
              if (orient.w + this.KERF <= rect.w && orient.h + this.KERF <= rect.h) {
                const placed = {
                  ...part,
                  x: rect.x,
                  y: rect.y,
                  w: orient.w,
                  h: orient.h,
                  rotated: orient.rotated,
                };
                panel.parts.push(placed);
                this.splitRect(panel, rect, orient.w, orient.h);
                return true;
              }
            }
          }
          return false;
        }

        splitRect(panel, rect, usedW, usedH) {
          const idx = panel.freeRects.indexOf(rect);
          panel.freeRects.splice(idx, 1);

          const rightW = rect.w - usedW - this.KERF;
          if (rightW > 100) {
            panel.freeRects.push({ x: rect.x + usedW + this.KERF, y: rect.y, w: rightW, h: rect.h });
          }

          const bottomH = rect.h - usedH - this.KERF;
          if (bottomH > 100) {
            panel.freeRects.push({ x: rect.x, y: rect.y + usedH + this.KERF, w: usedW, h: bottomH });
          }

          panel.freeRects.sort((a, b) => b.w * b.h - a.w * a.h);
        }

        getEfficiency(panel) {
          const used = panel.parts.reduce((sum, p) => sum + p.w * p.h, 0);
          return ((used / (panel.w * panel.h)) * 100).toFixed(1);
        }

        // SVG 생성
        generateSVG(panel, matKey, scale = 0.25) {
          const svgW = Math.round(this.PANEL_W * scale);
          const svgH = Math.round(this.PANEL_H * scale);
          const eff = this.getEfficiency(panel);

          let svg = `<svg width="${svgW + 40}" height="${svgH + 60}" viewBox="0 0 ${svgW + 40} ${svgH + 60}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .panel { fill: #f5f5f5; stroke: #333; stroke-width: 2; }
        .part { fill: #e3f2fd; stroke: #1976d2; stroke-width: 1; }
        .door { fill: #fff3e0; stroke: #f57c00; stroke-width: 1; }
        .back { fill: #f3e5f5; stroke: #7b1fa2; stroke-width: 1; }
        .label { font-family: Arial; font-size: 9px; fill: #333; }
        .dim { font-family: Arial; font-size: 7px; fill: #666; }
        .title { font-family: Arial; font-size: 11px; font-weight: bold; fill: #333; }
      </style>
      <text x="20" y="18" class="title">패널 #${panel.id} (${matKey}) - 효율: ${eff}%</text>
      <rect x="20" y="30" width="${svgW}" height="${svgH}" class="panel"/>`;

          panel.parts.forEach((part) => {
            const x = Math.round(part.x * scale) + 20;
            const y = Math.round(part.y * scale) + 30;
            const w = Math.round(part.w * scale);
            const h = Math.round(part.h * scale);
            const cls = part.part.includes('도어') ? 'door' : part.part.includes('뒷판') ? 'back' : 'part';

            svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}"/>`;
            svg += `<text x="${x + w / 2}" y="${y + h / 2 - 4}" class="label" text-anchor="middle">${part.part}</text>`;
            svg += `<text x="${x + w / 2}" y="${y + h / 2 + 8}" class="dim" text-anchor="middle">${part.w}×${part.h}</text>`;
            if (part.rotated) svg += `<text x="${x + 3}" y="${y + 12}" class="dim">↻</text>`;
          });

          svg += `</svg>`;
          return svg;
        }

        // HTML 리포트 생성
        generateReport(panelGroups) {
          let html = `<div style="font-family:Arial;padding:20px;">
      <h2 style="color:#1976d2;">🪵 재단 도면</h2>
      <p>생성일: ${new Date().toLocaleString('ko-KR')}</p>`;

          let totalPanels = 0;
          Object.keys(panelGroups).forEach((key) => {
            const panels = panelGroups[key];
            totalPanels += panels.length;
            html += `<h3>${key}: ${panels.length}장</h3>`;
            panels.forEach((panel) => {
              html += `<div style="margin:10px 0;border:1px solid #ddd;padding:10px;border-radius:8px;">`;
              html += this.generateSVG(panel, key);
              html += `<p style="font-size:12px;color:#666;">부품 ${panel.parts.length}개</p></div>`;
            });
          });

          html += `<h3>총 패널: ${totalPanels}장</h3></div>`;
          return html;
        }
      }

      // ============================================================
      // 전역 인스턴스 생성
      // ============================================================
      const materialExtractor = new MaterialExtractor();
      const hardwareExtractor = new HardwareExtractor();
      const drawingVisualizer = new DrawingVisualizer();

      // DadamAgent에 추출 기능 추가 (W10-4: Jest/Node 환경 가드 — jsdom은 window만 있고 DadamAgent 없음)
      if (typeof window !== 'undefined' && window.DadamAgent) {
        window.DadamAgent.extractMaterials = function () {
          const design = window.DadamAgent.exportDesign();
          return materialExtractor.extract(design);
        };

        window.DadamAgent.extractHardware = function () {
          const design = window.DadamAgent.exportDesign();
          return hardwareExtractor.extract(design);
        };

        window.DadamAgent.generateDrawings = function (mode = 'material') {
          const design = window.DadamAgent.exportDesign();
          const matResult = materialExtractor.extract(design);
          return drawingVisualizer.generateCuttingLayout(matResult.materials, mode);
        };
      }
      // W10-4: Jest 단위 테스트용 CommonJS 이중 노출 (__tests__/extractors-corner.test.js)
      // B1: HardwareExtractor·DrawingVisualizer 도 내보낸다 — 골든 도우미(test-utils/bom-golden/golden.js)가
      //     이 둘을 얻으려고 소스를 Function 으로 평가하던 우회를 없앨 수 있다.
      if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
          MaterialExtractor, HardwareExtractor, DrawingVisualizer,
          // B1 도우미 — 시험이 표·해석기를 직접 본다
          BOM_PART_DEFS, bomPartDefOf,
          BOM_PART_KEY_ALIASES, bomFinishResolveEmbedded, bomFinishCandidates, bomDetailOf,
          bomEdgeSidesOf, bomEdgeLenOf, bomEdgeThicknessOf,
          // B3 단순 카테고리 — 규칙표·선반/도어/깊이/레일 도우미 (bom-golden-simple.test.js)
          BOM_SIMPLE_CATEGORY_RULES, bomSimpleShelfQtyOf, bomSimpleDefaultShelfCount, bomSimpleDoorCountOf,
          bomSimpleHingeDoorsOf, bomSimpleDepthOf, bomSimpleRailLenOf,
        };
      }

