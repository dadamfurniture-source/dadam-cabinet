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

      // 2026-10-19 (CAD 베타 PR3): 몸통 판재 숫자(뒷판·사쿠리·밴드·처짐방지목·천지판/선반 깊이)는
      //   js/detaildesign/assembly-rules.js 한 표에 있다. 조립 명세(bom-assembly.js)도 같은 표를 읽는다.
      //   규칙 표 없이 BOM 을 내지 않는다 — 폴백 숫자를 두지 않는다 (detaildesign.html 이 이 파일보다 먼저 싣는다).
      const AsmRules = (typeof DadamAssemblyRules !== 'undefined') ? DadamAssemblyRules
        : (typeof require === 'function' ? require('./assembly-rules.js') : null);
      const ASM = AsmRules.CARCASS;

      // 2026-09-16: 붙박이장 통 내부 구조(칸·칸막이·선반·옷봉) 규칙도 같은 방식으로 한 곳에 있다.
      //   js/detaildesign/bom-wardrobe-rules.js — 플래너도 같은 파일을 읽는다.
      const WardrobeRules = (typeof DadamWardrobeRules !== 'undefined') ? DadamWardrobeRules
        : (typeof require === 'function' ? require('./bom-wardrobe-rules.js') : null);
      /** 붙박이장 기본값 — 규칙 파일이 정본. 없으면(구형 로드) 문서값으로 버틴다. */
      // 2026-10-20: 밥솥장 규칙 — js/detaildesign/bom-rice-cabinet-rules.js (플래너와 같은 파일, 오픈장 규칙 다음에 싣는다).
      const RiceRules = (typeof DadamRiceCabinetRules !== 'undefined') ? DadamRiceCabinetRules
        : (typeof require === 'function' ? require('./bom-rice-cabinet-rules.js') : null);
      // 2026-10-20: 홈카페장 규칙 — js/detaildesign/bom-homecafe-rules.js (fridge.md §11 부재표, 플래너와 같은 파일).
      const HomecafeRules = (typeof DadamHomecafeRules !== 'undefined') ? DadamHomecafeRules
        : (typeof require === 'function' ? require('./bom-homecafe-rules.js') : null);
      // 2026-10-20: EL장 모듈 타입 — js/detaildesign/bom-el-rules.js (도어 종류만, 치수 [확인 필요]).
      const ElRules = (typeof DadamElRules !== 'undefined') ? DadamElRules
        : (typeof require === 'function' ? require('./bom-el-rules.js') : null);
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
        // 2026-10-25 사장님: 밥솥장 슬라이딩 선반 (bom-rice-cabinet-rules.js shelfPartsOf) — 몸통 · 오픈장과 같은 색
        '밥솥장 선반':      { key: 'rice:shelf',        slot: 'body' },
        '밥솥장 보강목':    { key: 'rice:batten',       slot: 'body' },
        '밥솥장 마이다':    { key: 'rice:front',        slot: 'body' },
        '밥솥장 추가 목대': { key: 'rice:hinge-batten', slot: 'body' },
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

      /** 2026-10-20: 아일랜드 몸통 깊이는 사장님 값 대기 — 측판 비고에 붙인다 (extract 'island'). */
      const BOM_ISLAND_DEPTH_NOTE = '[확인 필요] 아일랜드 몸통 깊이';
      /** 2026-10-20: 도어교체 품목이 내는 판 — 도어·서랍 전면 (extract 'door'). */
      const BOM_DOOR_ONLY_SLOTS = ['door', 'drawerFront'];

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

      // 2026-10-24 사장님 (키큰장 조합) "싱크 서랍장 규칙 그대로": 키큰장 서랍은 **바닥에 닿는 단**(하부단 · 통짜)에만 —
      //   단 몸통이 하부장 몸통 자리다. 중간 · 상부 단의 서랍은 규칙이 없다 (부재를 내지 않고 측판 비고에 남긴다).
      function bomTallDrawerTier(mod) {
        const tier = bomTallTierOf(mod);
        return !!(mod && mod.isDrawer && (tier === 'bottom' || tier === 'single'));
      }
      const BOM_TALL_DRAWER_TIER_NOTE = '[확인 필요] 키큰장 서랍은 맨 아래 단만 — 이 단의 서랍 전면·박스는 내지 않는다 (sink.md §5.1)';

      // 2026-10-25 사장님: 밥솥장 슬라이딩 선반 언더레일 길이 — 서랍과 같은 규칙 (모듈 깊이 − 50 이하의 최대 규격, 모자라면 가장 짧은 규격).
      //   자재 행(선반 D = 레일 − 10)과 철물 행(레일 1 SET)이 같은 함수를 쓴다.
      function bomRiceRailLengthOf(mod) {
        const D = parseFloat(mod && mod.d) || 0;
        const len = DrawerRules ? DrawerRules.railLengthFor(D) : null;
        if (len !== null && len !== undefined) return len;
        return DrawerRules ? DrawerRules.DRAWER_RULES.RAIL_LENGTHS[0] : 250;
      }

      // ============================================================
      // 걸레받이 나누기 — 2026-10-20 사장님 카드 「꺾임에서 나누기」.
      //   벽마다 한 장. 원판 긴 변(SHEET_H 2440)을 넘는 벽은 그 길이 단위로 더 나눈다 (ㄱ자면 최소 2장).
      //   예전엔 라인 폭 합을 한 장으로 냈다 — ㄱ자 4161×145 한 장은 원판에 안 들어간다.
      //   벽 = 하부 라인 모듈의 앞면 방향(_place.front, ui-step1 _plannerPlaceOf). 자리가 없는 옛 설계는 한 벽.
      //   걸레받이카바 개수는 그대로다 — 전체 길이(조각 길이 × 수량 합)로 센다.
      // ============================================================
      function bomKickWallLensOf(modules) {
        const order = [];
        const sum = {};
        (modules || []).forEach((m) => {
          const front = m && m._place && Array.isArray(m._place.front) ? m._place.front.join(',') : '-';
          if (!(front in sum)) { sum[front] = 0; order.push(front); }
          sum[front] += parseFloat(m && m.w) || 0;
        });
        return order.map((k) => sum[k]).filter((w) => w > 0);
      }

      /** 벽 하나를 원판 긴 변 단위로 자른 조각 길이들 (앞에서부터 unit, 끝에 나머지) */
      function bomKickPiecesOf(wallLen, unit) {
        const out = [];
        let rest = Math.round(Number(wallLen) || 0);
        const u = Number(unit) > 0 ? Number(unit) : rest;
        while (rest > u) { out.push(u); rest -= u; }
        if (rest > 0) out.push(rest);
        return out;
      }

      /**
       * 벽 길이들 → [[길이, 벽 수]] 긴 것부터 — 같은 길이의 벽은 한 행에 수량으로 (걸레받이 addKickBoards 와 같은 꼴).
       *   2026-10-25 사장님 확정 (ㄱ자 하부 목찬넬): "보통 벽마다 한장씩, 두장으로 나뉨." — 상판은 품목당 한 장 (2026-10-26, extractSink 상판 주석).
       *   벽은 걸레받이와 같다 (bomKickWallLensOf — 하부 모듈 앞면 방향 _place.front, 자리가 없는 옛 설계는 한 벽).
       */
      function bomWallLenQtyOf(lens) {
        const qty = new Map();
        (lens || []).forEach((len) => {
          const k = Math.round(Number(len) || 0);
          if (k > 0) qty.set(k, (qty.get(k) || 0) + 1);
        });
        return [...qty.entries()].sort((a, b) => b[0] - a[0]);
      }

      /** 키큰장 단의 상몰딩 높이 — 단이 짊어진 값(heightParts.moldingH), 없으면 품목 상몰딩(specs.moldingH), 없으면 60 (sink.md §5) */
      function bomTallMoldingHOf(mod, specs) {
        const hp = (mod && mod.heightParts && typeof mod.heightParts === 'object') ? mod.heightParts : {};
        const n = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? x : d; };
        return n(hp.moldingH, n(specs && specs.moldingH, 60));
      }

      /** 싱크대 규칙(extractSink)으로 상부 라인 상몰딩을 내는 품목 — sinkMoldingPlanOf 가 이 품목만 계획한다 */
      const BOM_SINK_MOLDING_CATEGORIES = ['sink', 'island', 'custom', 'door', 'fridge'];

      /**
       * 싱크 상몰딩 — 벽마다 한 장 (bomSinkMoldingPlanOf). 사장님 확정 셋:
       *   2026-10-26 "상부장이 있다면 위에는 상몰딩이 있다고 보면됨. 가능한 이어지게." — 한 벽의 가장 바깥 상부장 두 끝 사이가 한 장이다.
       *     상부 모듈 폭 합(후드 자리 type hood 포함 — 2026-10-25 "후드라고 해서 구별 하지 않음")에 그 벽 상부장 사이 빈 자리(빈 벽 · 창문)를
       *     더한다. 바깥 상부장 밖으로는 늘리지 않는다.
       *   2026-10-26 "벽을 기준으로 나눠야함." — 상부장이 두 벽(ㄱ자 상부)에 걸치면 목찬넬처럼 벽마다 한 장. 벽 = 모듈 앞면 방향
       *     _place.front (걸레받이 · 목찬넬 bomKickWallLensOf 와 같다), 모서리는 그 자리에 선 모듈(멍장)의 벽 몫.
       *   2026-10-26 "깊이가 다르면 따로 함." — 빈 자리에 키큰장이 서 있으면 깊이(mod.d)가 다를 때 잇지 않는다 — 키큰장 상부단이
       *     제 상몰딩을 따로 낸다 (addTallTierParts, sink.md §5.1). 깊이가 같으면 그 키큰장 위까지 이어 한 장이고, 그 키큰장 상부단은
       *     상몰딩을 따로 내지 않는다 (addTallMoldingPart). 한 장이 곧게 지나가야 하므로 앞면 · 윗면 높이 · 몰딩 높이도 같을 때만 잇는다 —
       *     깊이만 같고 이 셋 중 하나가 다르면 정해지지 않았으므로 예전처럼 따로 (사장님께 여쭐 것).
       *   2026-10-26 사장님 확정 — "깊이가 같은 키큰장이 상부장 사이가 아니라 줄 끝에 붙어 있으면, 상몰딩을 그 키큰장 위까지 이을까요?"
       *     "잇는다." — 가장 바깥 상부장의 시작 · 끝에 붙은(1mm 안) 키큰장 스택도 같은 검사(깊이 · 앞면 · 윗면 높이 · 몰딩 높이)를 지나면
       *     그 폭만큼 늘려 한 장이고 joinedTalls 에 든다. 그 스택에 또 붙은 스택도 같은 검사로 이어간다.
       *     줄 끝에서 떨어져 선 스택 · 다른 벽 · 깊이가 다른 스택은 잇지 않는다 (예전과 같다). 상부장이 없는 벽은 그대로 (상몰딩이 없다).
       *   벽 위 자리 = _place 중심을 진행 방향(run)에 투영, 앞면 = 중심을 앞면 방향에 투영 + 깊이 / 2, 윗면 = z0 + h.
       *   키큰장 단은 브리지가 스택 바닥(z0 0)에 싣는다 — 스택 윗면 = 같은 자리 단 높이 합. 1mm 안은 같다 (조립 명세 runsOf 의 '붙어 있다'와 같은 허용).
       *   모듈 하나라도 자리(_place)가 없으면(상세설계 화면 · 옛 payload) 벽 · 사이를 알 수 없어 폭 합 한 장 (예전과 같다).
       * @param {object[]} uppers  상부 라인 모듈 (pos upper, 후드 자리 포함)
       * @param {object[]} talls   키큰장 단 모듈 (bomTallTierOf — 상자 모듈 단도 넣는다)
       * @param {object} specs     품목 스펙 (상몰딩 높이)
       * @returns {{lens:number[], joinedTalls:string[]}}  lens = 벽마다 길이 (벽 순서), joinedTalls = 이어 한 장이 된 키큰장 스택의 단 id 전부
       */
      function bomSinkMoldingPlanOf(uppers, talls, specs) {
        const widthOf = (m) => parseFloat(m && m.w) || 0;
        const ups = uppers || [];
        const sum = ups.reduce((s, m) => s + widthOf(m), 0);
        const placed = (m) => {
          const p = m && m._place;
          return !!p && Array.isArray(p.run) && Array.isArray(p.front)
            && Number.isFinite(Number(p.cx)) && Number.isFinite(Number(p.cy));
        };
        if (!ups.length || !ups.every(placed)) return { lens: sum > 0 ? [Math.round(sum)] : [], joinedTalls: [] };
        const same = (a, b) => Math.abs(a - b) <= 1;
        const epH = parseFloat(specs && specs.moldingH) || 60;
        const wallOf = (m) => m._place.front.join(',');
        const segOf = (m) => {
          const p = m._place;
          const c = Number(p.cx) * Number(p.run[0]) + Number(p.cy) * Number(p.run[1]);
          return {
            m, a: c - widthOf(m) / 2, b: c + widthOf(m) / 2,
            d: parseFloat(m.d) || 0,
            front: Number(p.cx) * Number(p.front[0]) + Number(p.cy) * Number(p.front[1]) + (Number(p.d) || 0) / 2,
            top: (Number(p.z0) || 0) + (Number(p.h) || 0),
          };
        };
        const walls = new Map();
        ups.forEach((m) => {
          if (!walls.has(wallOf(m))) walls.set(wallOf(m), []);
          walls.get(wallOf(m)).push(segOf(m));
        });
        const lens = [];
        const joinedTalls = [];
        walls.forEach((segs, wall) => {
          // 그 벽의 키큰장 스택 — 같은 자리(진행 방향 두 끝)의 단 묶음, 상몰딩은 맨 위 단(상부단 · 통짜)이 짊어진다
          const stacks = [];
          (talls || []).filter((t) => placed(t) && wallOf(t) === wall).map(segOf).forEach((t) => {
            const st = stacks.find((x) => same(x.a, t.a) && same(x.b, t.b));
            if (st) st.tiers.push(t); else stacks.push({ a: t.a, b: t.b, tiers: [t] });
          });
          /** 키큰장 스택이 상부장들(us)과 한 장으로 곧게 이어지는가 — 깊이 · 앞면 · 윗면 높이 · 몰딩 높이가 모두 같다 */
          const matches = (st, us) => {
            const crown = st.tiers.find((t) => { const tier = bomTallTierOf(t.m); return tier === 'top' || tier === 'single'; });
            if (!crown) return false;
            const stackTop = st.tiers.reduce((s, t) => s + (Number(t.m._place.h) || 0), 0);
            return us.every((u) => same(crown.d, u.d) && same(crown.front, u.front) && same(stackTop, u.top))
              // 몰딩 높이 — 2026-10-26 사장님 "하나의 품목에 상몰딩의 높이가 다른 경우는 없음." 검사는 그대로 둔다 (다른 값이 오면 예전처럼 따로)
              && epH >= 20 && Math.abs(bomTallMoldingHOf(crown.m, specs) - epH) < 0.5;
          };
          /** 깊이가 같은 키큰장 스택을 이어 한 장으로 — 양옆 상부장과 맞고(matches), 스택이 빈 자리 안에 있을 때만 */
          const joinable = (st, left, right, g0, g1) => !(st.a < g0 - 1 || st.b > g1 + 1) && matches(st, [left, right]);
          const join = (st) => st.tiers.forEach((t) => joinedTalls.push(String(t.m.id)));
          segs.sort((x, y) => x.a - y.a);
          let len = segs.reduce((s, g) => s + widthOf(g.m), 0);
          let last = segs[0];
          segs.slice(1).forEach((g) => {
            const g0 = last.b, g1 = g.a;
            if (g1 - g0 > 1) {
              const inGap = stacks.filter((st) => st.a < g1 - 1 && st.b > g0 + 1);
              if (inGap.every((st) => joinable(st, last, g, g0, g1))) {
                len += g1 - g0;
                inGap.forEach(join);
              }
            }
            if (g.b > last.b) last = g;
          });
          // 2026-10-26 사장님 확정 "잇는다." — 줄 끝(가장 바깥 상부장의 끝 · 시작)에 붙은 키큰장 스택도 그 폭만큼 잇는다.
          //   비교는 그 끝 상부장과 (빈 자리와 같은 matches). 이은 스택 끝에 또 붙은 스택도 이어간다 (dir +1 = 끝 쪽, −1 = 시작 쪽)
          const used = new Set();
          const touchingAt = (at, dir, ref) => stacks.find((s) => !used.has(s) && same(dir > 0 ? s.a : s.b, at) && matches(s, [ref])) || null;
          [[last, 1], [segs[0], -1]].forEach(([ref, dir]) => {
            let at = dir > 0 ? ref.b : ref.a;
            for (let st = touchingAt(at, dir, ref); st; st = touchingAt(at, dir, ref)) {
              used.add(st);
              len += st.b - st.a;
              at = dir > 0 ? st.b : st.a;
              join(st);
            }
          });
          lens.push(Math.round(len));
        });
        return { lens: lens.filter((l) => l > 0), joinedTalls };
      }

      /** 싱크 상몰딩 길이 합 — 벽마다 길이(bomSinkMoldingPlanOf)를 더한 값 */
      function bomSinkMoldingLenOf(uppers, talls, specs) {
        return bomSinkMoldingPlanOf(uppers, talls, specs).lens.reduce((s, l) => s + l, 0);
      }

      /** 키큰장 단이 목찬넬을 짊어지는가 — 바닥 단(하부단·통짜) + 목찬넬 손잡이 스펙. 도어 H·처짐방지·목찬넬 부재가 이걸 본다. */
      function bomTallTierHasChannel(tier, specs) {
        const grounded = tier === 'bottom' || tier === 'single';
        return grounded && String((specs && specs.handle) || '').includes('목찬넬');
      }

      /**
       * 처짐방지목(밴드(처짐방지)) — **폭 문턱을 넘는 모듈에만 1장, 모듈 중앙**. 2026-09-19 사장님 확정.
       *
       *   상부장            W ≥ 700 → 1장, 미만 → 없음
       *   하부장·키큰장 단  W ≥ 800 → 1장, 미만 → 없음
       *
       * 문턱은 **장수**가 아니라 **들어가느냐 마느냐**의 조건이다. 도어 분배가 350~600 이라 문턱을 넘는
       * 모듈은 전부 양문이므로, 이 규칙은 "양문이면 도어 두 장이 맞닿는 가운데 한 장" 과 같은 말이다.
       * 단문 모듈(400·600 …)에는 들어가지 않는다.
       *
       * 그때까지는 문턱 **이상이면 2장, 미만이면 1장** 이었다. 그래서 단문에도 한 장이 나갔고, 양문에는
       * 두 장이 나가 3D 가 그 둘을 폭의 1/3·2/3 — 도어 한 장씩의 가운데 뒤 — 에 세웠다. 양문 캐비닛에서
       * 세로 부재가 설 자리는 가운데 한 곳뿐이라 실물에 없는 그림이었다 (원장 P2-6 이 자리를
       * `[확인 필요] 실제 조립 위치` 로 남겨 둔 곳이다 — scene-bom-ledger.md §4 항목 6).
       *
       * 자리(중앙)는 BOM 이 정하지 않는다 — 3D(`mockup-structure.html addBraces`)가 같은 결정을 그린다.
       */
      // 문턱(상부 700 · 하부 800)과 판정은 assembly-rules.js (CARCASS.BRACE_W_MIN_*, braceQtyOf).
      const bomBraceQtyOf = AsmRules.braceQtyOf;
      /**
       * 2026-10-25 사장님 D2 (b): **전부 서랍인 서랍장**(위 칸도 서랍)에는 처짐방지목을 넣지 않는다.
       *   처짐방지목은 양문 두 장이 맞닿는 가운데 뒤에 서는 부재인데, 서랍장에는 맞닿는 도어가 없고 앞선 가운데에
       *   세우면 서랍 박스를 막는다. 위 도어 + 아래 서랍은 그대로 (자리는 D2 의 남은 질문).
       * @param {object|null} layout  drawerLayoutOf 결과
       */
      const bomAllDrawers = (layout) => !!(layout && layout.fronts && layout.fronts.length && layout.fronts[0].kind === 'drawer');
      /** 2026-10-25 사장님: 위 도어 + 아래 서랍은 두 몸통 — 서랍 모듈 행의 module 이름 (붙박이장 `-서랍모듈` 과 같은 꼴) */
      const bomDrawerModLabel = (modLabel, layout) => (layout && layout.split ? `${modLabel}-서랍모듈` : modLabel);

      // 2026-10-19: 기둥·배관 따내기 비고 — "따내기 좌측판 80×350 뒤·아래". 위치 말은 플래너 따내기 칸
      //   (js/planner/planner-cutout.js PLANNER_CUTOUT_PANELS) 과 같다. 판에서 본 격자 열·행이다.
      const BOM_CUTOUT_PANELS = {
        left: { label: '좌측판', cols: ['뒤', '가운데', '앞'], rows: ['아래', '가운데', '위'] },
        right: { label: '우측판', cols: ['뒤', '가운데', '앞'], rows: ['아래', '가운데', '위'] },
        top: { label: '천판', cols: ['좌', '가운데', '우'], rows: ['뒤', '가운데', '앞'] },
        bottom: { label: '지판', cols: ['좌', '가운데', '우'], rows: ['뒤', '가운데', '앞'] },
      };
      function bomCutoutNoteOf(c) {
        const P = c && BOM_CUTOUT_PANELS[c.panel];
        const col = P && P.cols[Number(c.col)];
        const row = P && P.rows[Number(c.row)];
        if (!P || !col || !row || !(Number(c.w) > 0) || !(Number(c.h) > 0)) return '';
        return `따내기 ${P.label} ${Number(c.w)}×${Number(c.h)} ${col}·${row}`;
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
      // 2026-10-13 사장님: 선반 기본 개수는 플래너 규칙(calcDefaultShelves)과 같다 — 상부장 2, 그 밖은 칸 간격
      //   일반 300~450 · 신발장 150~300 (예전 신발장 180~350, 나머지는 싱크 규칙 하부 1 · 키큰장 1 을 빌렸다).
      const BOM_SHELF_SPACE_GENERAL = { min: 300, max: 450 };
      const BOM_UPPER_SHELF_COUNT = 2;
      const BOM_SIMPLE_CATEGORY_RULES = {
        shoerack:  { label: '신발장', defaultD: 350, upperD: 295, shelfSpace: { min: 150, max: 300 } },
        vanity:    { label: '화장대', defaultD: 500, upperD: 295, shelfSpace: BOM_SHELF_SPACE_GENERAL },
        storage:   { label: '수납장', defaultD: 400, upperD: 295, shelfSpace: BOM_SHELF_SPACE_GENERAL },
        warehouse: { label: '창고장', defaultD: 450, upperD: 295, shelfSpace: BOM_SHELF_SPACE_GENERAL },
        // 2026-10-20 TV장 — 깊이 400 사장님 확정(결정 카드). 선반 칸 간격은 수납장 규칙 준용 [확인 필요] (simple-categories.md §1)
        tvcabinet: { label: 'TV장', defaultD: 400, upperD: 295, shelfSpace: BOM_SHELF_SPACE_GENERAL },
      };

      /**
       * 도어 수 기본값 — 2026-10-13 사장님: 플래너와 같게. 도어 한 장 최대 600 (MASTER_RULES.DOOR_W_MAX) —
       *   600 이하 1장, 넘으면 600 을 안 넘게 나눈다 (W700 → 2, W1300 → 3). 예전엔 붙박이장 규칙 round(W/450).
       */
      const BOM_DOOR_W_MAX = 600;
      /** 경첩 — 2026-10-13 사장님: 여닫이 도어 폭이 이 값을 넘으면 높이로 센 개수에 1개 더. */
      const BOM_HINGE_WIDE_DOOR_W = 600;
      /** 걸레받이카바(18T) 투명 — 2026-10-13 사장님: 한 개 2400mm, 걸레받이 전체 길이로 센다. */
      const BOM_KICK_COVER_LEN = 2400;
      /** 서랍 밑판 — 2026-10-13 사장님: 우라 3T (예전 MDF 2.7T). 싱크·간단 카테고리·붙박이장 서랍 모두. */
      const BOM_DRAWER_BOTTOM_T = 3;
      /** 몸통 뒷판 — 2026-10-18 사장님: 우라 MDF 3T (예전 2.7T). 서랍 밑판과 같은 판 (홈카페장 18T 통판은 따로). */
      const BOM_BACK_PANEL_T = ASM.BACK_PANEL_T;
      /**
       * 뒷판 크기는 **측판 사쿠리**가 정한다 (2026-10-19 사장님 — 모든 모듈 공통).
       *   사쿠리 있음  측판 홈(15→3mm)에 끼운다 → (W − 20) × (H − 1)   좌우 10씩 홈 속
       *   사쿠리 없음  측판 뒤끝에 덮어 붙인다 → (W − 1) × (H − 1)    측판 깊이를 먹지 않는다
       * 예전 하부장(사쿠리 없음)은 (W − 2T) × (H − T) 로 측판 사이에 끼우는 크기였다 — 실제 조립(뒤에 덮음)과 달라
       * 900 하부장에서 폭 29 · 높이 14 가 모자랐다. 홈카페장·오픈장 18T 통판 뒷판은 구조재라 이 규칙 밖이다.
       */
      // 숫자(W − 20 · W − 1 · H − 1)와 계산은 assembly-rules.js (CARCASS.BACK_*, backPanelSize).
      const bomBackPanelSize = AsmRules.backPanelSize;
      /** 상판 두께 — 2026-10-18 사장님: 12 · 50T (인조대리석). data-constants.js TOP_THICKNESS_OPTIONS 와 같다. */
      const BOM_TOP_THICKNESS_OPTIONS = [12, 50];
      /** 상판 재질별 두께 — 2026-10-18 사장님 Q8 (상판 발주 요청서). data-constants.js TOP_MATERIALS 와 같다. 첫 재질이 기본. */
      const BOM_TOP_MATERIALS = { '인조대리석': [12, 50], '엔지니어드 스톤': [12, 20], '세라믹': [12] };
      function bomDoorCountByWidth(W) {
        return Math.max(1, Math.ceil((parseFloat(W) || 0) / BOM_DOOR_W_MAX));
      }

      /** 문서에 없어 붙박이장 규칙을 빌린 행의 비고 — simple-categories.md §6.5 목록과 같은 문구. */
      const BOM_SIMPLE_NOTE_WARDROBE = '[확인 필요] simple-categories.md 에 없음 — 붙박이장 규칙 준용';
      /** 문서에 없어 싱크대 규칙을 빌린 행의 비고. */
      const BOM_SIMPLE_NOTE_SINK = '[확인 필요] simple-categories.md 에 없음 — 싱크대 규칙 준용';

      /**
       * 서랍레일 길이 — bom-protocol.md §4-2 "모듈 깊이 − 50 이하의 최대 규격" (bom-drawer-rules.js railLengthFor).
       * 2026-10-13: 간단 카테고리만 폐기된 깊이 구간표(≤350→350, ≤450→450, 그 밖 500)를 쓰고 있어 깊이 400 장에
       *   450 레일(몸통보다 긴 레일)이 나갔다. 싱크·냉장고장과 같은 규칙으로 맞춘다. 거래명세서에도 550 레일은 없다 — 500 이 끝.
       */
      function bomSimpleRailLenOf(depth) {
        const d = parseFloat(depth) || 550;
        const len = DrawerRules ? DrawerRules.railLengthFor(d) : null;
        if (len !== null) return len;
        return DrawerRules ? DrawerRules.DRAWER_RULES.RAIL_LENGTHS[0] : 250;
      }

      /**
       * 플랩 가스쇼바 — 2026-10-13 사장님 결정. 도어당 양쪽 1개씩, 규격은 도어 무게로 자동.
       *   규격은 거래명세서에서 산 것만: 1kg 고정형(5182-17) · 5kg MJG180-50 · 7kg 180-70 · 9kg MJG250-90.
       *   도어 무게 = 폭 × 높이 × 18T × MDF 밀도 750kg/m³. 쪽당 규격 ≥ 도어 무게 중 가장 약한 것.
       */
      const BOM_GAS_STRUT_PER_DOOR = 2;
      const BOM_DOOR_MDF_T = 18;
      const BOM_MDF_DENSITY = 750;   // kg/m³
      const BOM_GAS_STRUTS = [
        { kg: 1, model: '고정형 1kg' },
        { kg: 5, model: 'MJG180-50' },
        { kg: 7, model: '180-70' },
        { kg: 9, model: 'MJG250-90' },
      ];
      function bomGasStrutFor(doorW, doorH) {
        const weight = (Math.max(0, doorW) / 1000) * (Math.max(0, doorH) / 1000) * (BOM_DOOR_MDF_T / 1000) * BOM_MDF_DENSITY;
        const pick = BOM_GAS_STRUTS.find((g) => g.kg >= weight);
        const g = pick || BOM_GAS_STRUTS[BOM_GAS_STRUTS.length - 1];
        return { kg: g.kg, model: g.model, weight, over: !pick };
      }

      /**
       * 좌대 상자 — 2026-10-13 사장님 확정. 키큰장 단(싱크대·간단 카테고리 하부 라인)과 붙박이장이 같은 규칙을 쓴다.
       *   좌대 전후  W (모듈 W) × 좌대 H × 2
       *   좌대 측    (D − 80) × 좌대 H × 2
       *   중간보강   (D − 80) × 좌대 H × 1 — W ≥ 700 일 때만
       */
      const BOM_PEDESTAL_D_SETBACK = 80;
      const BOM_PEDESTAL_BRACE_W_MIN = 700;

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
        // 플래너 calcDefaultShelves 와 같다 — 상부장은 2, 그 밖은 칸 간격 규칙
        if (pos === 'upper') return BOM_UPPER_SHELF_COUNT;
        const sp = (rules && rules.shelfSpace) || BOM_SHELF_SPACE_GENERAL;
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

      /** 도어 수 — 모듈 doorCount 가 숫자면 그대로(0 존중), 없으면 오픈은 0, 아니면 bomDoorCountByWidth (플래너와 같다 → 비고). */
      function bomSimpleDoorCountOf(mod, W) {
        const raw = Number(mod && mod.doorCount);
        if (Number.isFinite(raw)) return { count: Math.max(0, Math.round(raw)), defaulted: false };
        if (mod && mod.isOpen) return { count: 0, defaulted: false };
        return { count: bomDoorCountByWidth(W), defaulted: true };
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
          // 2026-10-22: 싱크 서랍 규칙 — 도어는 doorCount 가 있을 때만 그 수 (레이아웃 [도어, 서랍×n]). 서랍장 전면은 마이다라
          //   경첩은 bomIsMaidaModule 이 먼저 거르고, 손잡이 수만 여기서 센다 (싱크 extractHandles 의 mod.doorCount 와 같다).
          return { count: m.doorCount || 0, doorH: null };
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

      /**
       * 붙박이장 통의 여닫이 도어 — 수와 재단 높이. extractWardrobe 의 도어 행과 **같은 식**이다 (두 갈래 모두):
       *   수   mod.doorCount, 없으면 max(1, round(W/450))
       *   높이 좌대 + 몸통(item.h − 좌대 − 상몰딩) − 20, 외부 서랍이 있으면 − 단수 × 350
       * 2026-10-13 (B4): 경첩이 이 값을 쓴다. 예전엔 mod.h(2280) 로 세서 외부 서랍 위 1620 도어에 2170 보링이 나갔고,
       *   doorCount 가 없는 통(짧은옷 기본형)은 도어 2장이 자재에 있는데 경첩이 0 이었다.
       * 붙박이장 통이 아니면 null.
       */
      function bomWardrobeDoorOf(item, mod) {
        const category = item && (item.categoryId || item.category);
        if (category !== 'wardrobe' || !mod || (mod.pos !== 'wardrobe' && mod.pos !== 'tall')) return null;
        const specs = item.specs || {};
        const pedestalH = parseFloat(specs.wardrobePedestal) || WR_DEFAULTS.PEDESTAL_H;
        const moldingH = parseFloat(specs.wardrobeMoldingH) || WR_DEFAULTS.MOLDING_H;
        const totalH = parseFloat(item.h) || WR_DEFAULTS.DEFAULT_H;
        const bodyH = totalH - pedestalH - moldingH;
        const W = parseFloat(mod.w) || 900;
        const drawerCount = mod.drawerCount || 0;
        const external = mod.isExternalDrawer && drawerCount > 0 ? drawerCount * 350 : 0;
        // 2026-10-20 (도어 1580): 외부 서랍 위 도어는 몸통 − 서랍모듈H (extractWardrobe 와 같은 식)
        return { count: mod.doorCount || Math.max(1, Math.round(W / 450)), h: external ? bodyH - external : pedestalH + bodyH - 20 };
      }

      /**
       * 냉장고장 모듈의 여닫이 도어 — extractFridge 도어 행과 같은 식. 키큰장·홈카페장·상부장 H + 20, 하부장 H − 30,
       * 수는 mod.doorCount 없으면 1. 그 밖 타입(EL장·냉장고 자리)은 null — 경첩은 예전 경로(리프트업 등 제 철물)를 탄다.
       * 2026-10-13 (B4): 예전엔 mod.h 그대로 세서 보링이 도어보다 20 짧은 높이 기준이었다.
       */
      function bomFridgeDoorOf(item, mod) {
        const category = item && (item.categoryId || item.category);
        // 2026-10-24: 플래너 모듈(pos 있음)은 싱크대 규칙이다 (fridge.md 머리 — 자재 행도 extractSink). 이 표는 예전 화면의 type 모듈만.
        //   예전엔 플래너 냉장고장 품목의 키큰장 단(type 'tall', pos 'lower')도 여기서 H + 20 으로 셈해 자재 행(단 규칙 H − 4)과 어긋났다.
        if (category !== 'fridge' || !mod || mod.pos) return null;
        const t = mod.type || '';
        if (t !== 'tall' && t !== 'homecafe' && t !== 'upper' && t !== 'lower') return null;
        const H = parseFloat(mod.h) || 2000;
        return { count: mod.doorCount || 1, h: t === 'lower' ? H - 30 : H + 20 };
      }

      /**
       * 서랍장 모듈 — 전면이 전부 "마이다"라 보링하지 않는다 (2026-10-18 사장님: "서랍 도어는 마이다라고 해서 보링을 하지 않음",
       * 맨 위 칸 전면까지 전부). 하부 라인의 서랍장(싱크·단순 카테고리)이 해당한다. 키큰장 단은 제 규칙(bomTallTierDoorH)을 탄다.
       * 자재 행은 그대로(도어·서랍도어) — 경첩·보링만 내지 않는다.
       */
      function bomIsMaidaModule(mod) {
        // 2026-10-24: 키큰장 서랍 단(맨 아래 단)도 싱크 서랍장과 같다 — 전면이 서랍 레이아웃이다
        return Boolean(mod && mod.isDrawer && mod.pos === 'lower' && (!bomTallTierOf(mod) || bomTallDrawerTier(mod)));
      }

      /** 경첩 컵 사이 최소 간격(mm) — 이보다 가까우면 비고에 [확인 필요] (끝 110 규칙이 짧은 도어에서 무너진다). */
      const BOM_HINGE_MIN_GAP = 100;

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
          // 2026-10-24 D9: 발행 전 확인창에 띄울 알림 (마감재 없음 등) — bom-preflight.js opts.notices 가 오류로 올린다
          this._notices = [];

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
            // 2026-10-26 사장님 확정: 싱크 상몰딩 계획(벽마다 · 빈 자리 건너 · 깊이가 같은 키큰장은 이어서) — 상자 모듈(오픈장 · 밥솥장 ·
            //   홈카페장 · EL장)을 걷어내기 **전** 모듈로 한 번 세운다. 키큰장 단이 상자 모듈이어도 그 자리가 이음을 막거나(깊이 다름)
            //   그 단의 상몰딩이 빠져야(이어짐) 하기 때문이다 — 상자 모듈 단의 상몰딩도 addTallMoldingPart 를 지난다.
            this._ctx.sinkMolding = this.sinkMoldingPlanOf(item);
            // ★ 같은 카테고리 2개 이상이면 #1, #2 접두사 부여
            const prefix = categoryTotals[category] > 1 ? `#${categoryCounts[category]} ` : '';
            // ★ 품목 라벨 (아이템 구분용)
            // B3: 단순 카테고리 라벨은 규칙표(BOM_SIMPLE_CATEGORY_RULES)에서 — 기존 셋은 그대로.
            const catNames = { sink: '싱크대', island: '아일랜드', door: '도어교체', custom: '비규격장', wardrobe: '붙박이장', fridge: '냉장고장' };
            const simpleRules = BOM_SIMPLE_CATEGORY_RULES[category] || null;
            const catName = catNames[category] || (simpleRules && simpleRules.label) || category;
            const itemLabel = item.labelName || `${prefix}${catName}`;
            const mods = item.modules || [];
            dlog(`[BOM-TRACE] === 아이템 처리: ${itemLabel} ===`);
            dlog(`[BOM-TRACE]   모듈 수: ${mods.length}`);
            dlog(`[BOM-TRACE]   상부장: ${mods.filter(m=>m.pos==='upper').length}개, 하부장: ${mods.filter(m=>m.pos==='lower').length}개`);
            dlog(`[BOM-TRACE]   모듈 상세:`, mods.map(m => `${m.pos}/${m.type}/${m.name}(${m.w})`));
            const beforeLen = materials.length;

            // 2026-09-19: 오픈장은 **카테고리 추출기 앞에서** 걷어낸다.
            //   모듈 타입이라 싱크대에도 붙박이장에도 수납장에도 붙을 수 있는데, 규칙(18T MDF)은
            //   어디 붙든 같다. 카테고리 추출기에 그대로 넘기면 그쪽 규칙(PB 몸통·도어·선반)으로
            //   한 번 더 산출돼 한 상자가 두 벌 나간다.
            // 2026-10-20: 밥솥장도 같은 이유로 먼저 걷어낸다 (상자는 오픈장 규칙 + 도어 한 장).
            // 2026-10-20: 플래너 홈카페장(moduleKind)도 같은 이유로 먼저 걷어낸다 — 어느 품목에 붙든 fridge.md §11 부재표.
            //   EL장 모듈 타입도 같다 (몸통만, 도어 [확인 필요]).
            const catItem = this.extractEls(this.extractHomecafes(
              this.extractRiceCabinets(this.extractOpenCabinets(item, materials, prefix), materials, prefix), materials, prefix),
            materials, prefix);

            switch (category) {
              // 2026-10-20 플래너 점검: 아일랜드는 싱크대 규칙 문서를 같이 쓴다 (docs/design-rules/sink.md "categoryId: sink / island").
              //   분기가 없어 아일랜드 BOM 이 0 개였다(철물만 나왔다). 깊이는 플래너 모듈 깊이(mod.d) 그대로다.
              //   2026-10-20 카드: 사장님이 몸통 깊이를 따로 정한다(770·550 아님) — 값이 올 때까지 측판 비고에 [확인 필요].
              case 'island': {
                const from = materials.length;
                this.extractSink(catItem, materials, prefix);
                for (let i = from; i < materials.length; i++) {
                  const m = materials[i];
                  if (m.part !== '측판') continue;
                  m.note = (m.note ? m.note + ' · ' : '') + BOM_ISLAND_DEPTH_NOTE;
                }
                break;
              }
              // 2026-10-20 카드 "도어만·싱크대 규칙" (사장님): 비규격장은 싱크대 규칙으로 산출한다 (door.md 워크스페이스 = 싱크 기반).
              case 'custom':
              case 'sink':
                this.extractSink(catItem, materials, prefix);
                break;
              // 2026-10-20 같은 카드: 도어교체는 도어 판만 (door.md "BOM: 도어 자재만", ACTIVE_RULES §12 "도어재만").
              //   싱크대 규칙으로 모듈을 풀어 도어·서랍 전면 판만 남긴다 — 도어 치수 규칙을 따로 두지 않는다. 철물은 경첩만 (HardwareExtractor).
              case 'door': {
                const tmp = [];
                const noticeLen = this._notices.length;
                this.extractSink(catItem, tmp, prefix);
                this._notices.length = noticeLen;   // 2026-10-24 D9: 도어 판만 내므로 마감재 알림은 뜻이 없다
                tmp.forEach((m) => { if (BOM_DOOR_ONLY_SLOTS.indexOf(m.slot) >= 0) materials.push(m); });
                break;
              }
              case 'wardrobe':
                this.extractWardrobe(catItem, materials, prefix);
                break;
              // 2026-10-20: 냉장고장이 플래너로 옮겨 왔다. 플래너 브리지가 만든 모듈(pos: 냉장고 위 상부장 'upper',
              //   키큰장 단 'lower'+단 표시)은 싱크대 규칙으로 낸다 — 위장은 2026-09-22 사장님 확정(일반 상부장 규칙),
              //   키큰장 단은 싱크대 옆 키큰장과 같은 sink.md §5.1. 전용 화면이 만든 type 모듈(옛 설계)만 extractFridge.
              case 'fridge':
                //   위장 깊이 = 좌우 EP − 25, 싱크대 상부장처럼 벽에 건다 (2026-10-20 사장님 확정, 구조 단계가 깊이를 앉힌다).
                if ((catItem.modules || []).some((m) => m && m.pos)) this.extractSink(catItem, materials, prefix);
                else this.extractFridge(catItem, materials, prefix);
                break;
              default:
                // B3: 신발장·화장대·수납장·창고장 — 같은 상자 규칙, 카테고리 상수만 다르다 (BOM_SIMPLE_CATEGORY_RULES)
                if (simpleRules) this.extractSimpleBox(catItem, materials, prefix, simpleRules);
                break;
            }
            // 2026-10-19: 기둥·배관 따내기 — 그 모듈의 해당 판 비고에 적는다 (재단기는 사각 판만 자른다)
            this.applyCutoutNotes(item, materials, beforeLen, itemIdx);
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
            notices: this._notices.slice(),
            summary: this.calculateSummary(materials),
            // B1: 엣지밴딩 총길이 — 두께별 { '1': mm, '0.6': mm }. summary 옆에 두는 이유는 calculateEdgeBanding 주석.
            edgeBanding: this.calculateEdgeBanding(materials),
            extractDate: new Date().toISOString(),
          };
        }

        /**
         * 2026-10-19: 기둥·배관 따내기 (플래너 s.cutouts → 브리지 mod.cutouts) — 측판·천판·지판 행의 비고에 붙인다.
         *   치수·수량은 바꾸지 않는다: 원판에서 사각으로 자르고 따내기는 가공이다. 측판은 두 장이 한 행이라
         *   비고가 어느 쪽(좌·우) 판인지 적는다. 그 판 행이 없으면(하부장 천판) 비고 없이 dlog 로 남긴다.
         */
        applyCutoutNotes(item, materials, fromIdx, itemIdx) {
          const PART = { left: '측판', right: '측판', top: '천판', bottom: '지판' };
          (item.modules || []).forEach((mod) => {
            const cuts = Array.isArray(mod && mod.cutouts) ? mod.cutouts : [];
            if (!cuts.length || mod.id === undefined || mod.id === null) return;
            const moduleKey = `${itemIdx | 0}-${String(mod.id)}`;
            cuts.forEach((c) => {
              const row = materials.slice(fromIdx).find((r) => r.moduleKey === moduleKey && r.part === PART[c.panel]);
              const note = bomCutoutNoteOf(c);
              if (!row || !note) { dlog(`[Cutout] ${moduleKey}: ${note || c.panel} 를 붙일 판 행이 없다`); return; }
              row.note = row.note ? `${row.note} · ${note}` : note;
            });
          });
        }

        // ========================================
        // B1: 부재 식별 문맥 — extract() 가 품목마다, 각 추출기가 모듈 루프마다 세운다.
        //   add() 는 이 문맥으로 partId·slot 을 만든다. 문맥 없이 add() 를 부르면(외부 직접 호출)
        //   품목 0 · 모듈 'none' 으로 떨어져 행은 나오되 식별자만 밋밋하다.
        // ========================================
        /**
         * 2026-10-24 사장님 D9: 좌·우 마감재(휠라 · 몰딩 · EP)는 **도면이 정본** — 플래너에 놓은 마감재(specs.drawnFinishes,
         *   브리지 ui-step1.js 가 적는다)를 그대로 발주한다. 스펙 finishLeft/Right 는 발주에 쓰지 않는다.
         *   휠라 · 몰딩 = MDF 18T, 부재 폭(partW, 60) × 높이(H) / EP = MDF partW(18)T, 깊이(D) × 높이(H) — 플래너가 그린 치수 그대로.
         *   높이는 플래너 규칙(W12-42) 그대로: 휠라 = 옆 도어, 몰딩 · EP = 상판 아래, 상부장 옆은 상부 영역 높이 (하부 · 상부 따로).
         *   비움(gap)은 판이 없다. 쪽(좌/우)은 붙은 모듈의 쪽(side), 없으면 배치 공간 끝(edge).
         *   도면에 마감재가 하나도 없으면 발주하지 않고 발행 전 확인창에 알린다 (사장님 D9 B-1). 치수를 모르는 옛 값도 알린다.
         */
        addDrawnFinishes(materials, epLabel, item) {
          const list = Array.isArray(item && item.specs && item.specs.drawnFinishes) ? item.specs.drawnFinishes : [];
          const ctx = this._ctx || this.beginItem(item, 0);
          const label = (item && item.labelName) || epLabel.replace(/EP$/, '').trim() || '품목';
          const notice = (code, message) => this._notices && this._notices.push({ itemIdx: ctx.itemIdx, code, message });
          if (!list.length) {
            notice('finish-none', `${label}: 도면에 좌·우 마감재(휠라 · 몰딩 · EP)가 없어 마감재를 발주하지 않습니다 — 플래너에서 마감재를 넣었는지 확인해 주세요`);
            return;
          }
          const NAME = { filler: '휠라', molding: '몰딩', ep: 'EP' };
          const pos = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
          let unknown = 0;
          list.forEach((f) => {
            if (!f || !NAME[f.section]) return;   // 비움(gap) — 판이 없다
            const side = f.side || f.edge;
            const partW = pos(f.partW), H = pos(f.H), D = pos(f.D);
            const w = f.section === 'ep' ? D : partW;
            const t = f.section === 'ep' ? partW : 18;
            if (!side || !partW || !H || !w) { unknown++; return; }
            this.beginItemLevel(f.area === 'upper' ? 'upper' : 'lower');
            this.add(materials, epLabel, `${NAME[f.section]}(${side === 'left' ? '좌' : '우'})`, 'MDF', t, w, H, 1, '4면', '도면 마감재');
          });
          if (unknown) {
            notice('finish-unknown', `${label}: 도면 마감재 ${unknown}개의 쪽·치수를 몰라 발주하지 않았습니다 — 플래너를 새로 고친 뒤 결과를 다시 적용해 주세요`);
          }
        }

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

        /** 뒷판 한 장 — 크기는 측판 사쿠리 여부로 (bomBackPanelSize). 비고에 조립 방식을 적는다. */
        addBackPanel(materials, label, W, H, sakuri) {
          const b = bomBackPanelSize(W, H, sakuri);
          this.add(materials, label, '뒷판', 'MDF', BOM_BACK_PANEL_T, b.w, b.h, 1, '-', sakuri ? '사쿠리 홈 끼움' : '측판 뒤 덮음');
        }

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
            // B4 (2026-10-13): 모듈 키 = partId 의 `${itemIdx}-${moduleId}` 부분. partId 는 쪼개 읽지 않으므로 따로 싣는다 —
            //   철물 행(경첩·레일)의 moduleKey 와 같으면 같은 모듈이다 (작업지시서 키팅·도어재 발주서의 경첩 컵 위치).
            moduleKey: `${ctx.itemIdx}-${ctx.moduleId}`,
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
          // 2026-10-24 사장님 (키큰장 조합) "싱크 서랍장 규칙 그대로": 키큰장 단의 서랍은 **단 몸통**을 하부장 몸통으로 본다 —
          //   전면 영역 = 몸통 H − 30 × 목찬넬 (좌대는 덮지 않는다 — 단 도어 H − 30 과 같다). 배치 높이는 스택 전체라 단에 쓰면 전면이 단을 넘는다.
          //   중간 · 상부 단의 서랍은 규칙이 없다 — 레이아웃이 없다 (null: 자재 · 조립 명세 · 레일이 같이 서랍을 내지 않는다).
          const tallTier = bomTallTierOf(mod);
          if (tallTier && !bomTallDrawerTier(mod)) return null;
          const areaH = tallTier ? H : (Number(mod.areaH) > 0 ? Number(mod.areaH) : (Number(mod.totalH) || 0));
          if (areaH > 0) {
            const hp = (!tallTier && mod.heightParts && typeof mod.heightParts === 'object') ? mod.heightParts : {};
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
        /**
         * 하부장 · 키큰장 단 몸통 (측판 · 지판 · 밴드 2 · 뒷판 · 처짐방지목) — 사쿠리 없음.
         *   보통은 몸통 하나. 2026-10-25 사장님: 위 도어 + 아래 서랍(L.split)은 **도어 모듈 · 서랍 모듈 두 몸통**으로 나누어 만든다 —
         *   몸통마다 같은 짜임, 서랍 모듈 행은 `-서랍모듈`. 처짐방지목은 도어 모듈에만 (서랍 모듈은 전부 서랍이라 없다, D2 (b)).
         * @param {boolean} channel  목찬넬 손잡이 — 측판 따내기 비고 · 처짐방지목 −70
         * @param {string} [extraNote]  측판 비고 뒤에 붙일 말 (키큰장 서랍 단 규칙 없음)
         */
        addLowerCarcassRows(materials, modLabel, W, H, T, modD, L, channel, extraNote) {
          const notchH = DrawerRules ? DrawerRules.DRAWER_RULES.CHANNEL_TOP_NOTCH_H : 0;
          const carcass = (label, h, note, brace) => {
            this.add(materials, label, '측판', 'PB', T, modD, h, 2, '3면', note);
            this.add(materials, label, '지판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
            this.add(materials, label, '밴드', 'PB', T, ASM.BAND_W, W - T * 2, 2, '2면(장)');
            this.addBackPanel(materials, label, W, h, false);
            // 밴드(처짐방지목) — 목찬넬이면 −70. W ≥ 800 이면 1장, 모듈 중앙 (bomBraceQtyOf)
            const bandH = channel ? h - T * 2 - notchH : h - T * 2;
            const braceQty = brace ? bomBraceQtyOf(W, 'lower') : 0;
            if (braceQty > 0) this.add(materials, label, '밴드(처짐방지)', 'PB', T, ASM.BRACE_W, bandH, braceQty, '2면(장)');
          };
          const sp = L && L.split;
          if (!sp) {
            const notes = [];
            if (channel && DrawerRules) notes.push(DrawerRules.notchNote(L));
            if (extraNote) notes.push(extraNote);
            carcass(modLabel, H, notes.join(' · '), !bomAllDrawers(L));   // 전부 서랍이면 처짐방지목 없음 (D2)
            return;
          }
          const nn = channel ? DrawerRules.splitNotchNotes(L) : null;
          carcass(modLabel, sp.doorH, nn ? nn.door : '', true);
          carcass(bomDrawerModLabel(modLabel, L), sp.drawerH, nn ? nn.drawer : '', false);
        }

        addDrawerModuleParts(materials, modLabel, mod, W, T, doorCount, L, modD, woodChannel) {
          const R = DrawerRules.DRAWER_RULES;
          const doorLabel = modLabel;
          // 2026-10-25: 위 도어 + 아래 서랍은 두 몸통 — 서랍 전면 · 박스 · 중간 목찬넬은 서랍 모듈 행
          modLabel = bomDrawerModLabel(modLabel, L);
          // 전면 — 위에서 아래로. 도어는 doorCount 장이 가로로 나뉜다. 같은 높이의 서랍도어는 한 행(수량)으로 묶는다.
          const drawerFrontRows = [];
          L.fronts.forEach((f) => {
            // 2026-09-15: 최소 전면 높이 미만은 부재로 내지 않는다 (옛 규칙 `hingeDoorH > 50`)
            if (f.h < R.MIN_FRONT_H) return;
            if (f.kind === 'door') {
              const dc = Math.max(1, doorCount || 1);
              this.add(materials, doorLabel, '도어', 'MDF', 18, Math.floor(W / dc) - 4, f.h, dc, '4면', '', mod);
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
            this.add(materials, modLabel, '서랍밑판', 'MDF', BOM_DRAWER_BOTTOM_T, bottomW, bottomD, n, '-', sakuri ? '우라 · 사쿠리 홈' : '우라');
            if (brace) {
              this.add(materials, modLabel, '서랍 하단보강', 'PB', drawerT, sideL, R.BOX_BRACE_H, n, '2면(장)');
            }
          }
          // 중간 목찬넬 — 따내기 90×40 자리를 채우는 ㄴ자 두 장, 모듈 폭.
          // 2026-10-22 사장님 "도어는 재단 규칙이 같음. 그러나 따내기, ㄴ자 목찬넬은 없음": 찬넬(알루미늄) 손잡이면
          //   전면 치수는 그대로 두고 측판 따내기(호출자 sideNote)와 ㄴ자 목찬넬 행은 내지 않는다.
          if (L.midCount > 0 && woodChannel !== false) {
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

        addBlindFrontParts(materials, modLabel, mod, H, battenH) {
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
          //   깊이 방향) 모두 15T. 앞선에서 15 + 60 = 75 만 들어간다 (corner.md §3.5).
          //   멍장 하나에 한 벌 — 하부·상부·키큰장 단 모두 같다.
          // 2026-10-22 사장님: 목대는 **천판과 지판 사이**에 들어간다 (높이 H − 2T). 목찬넬 몸통은 따내기 70 아래에
          //   밴드가 들어가므로 그 밴드 밑까지 — H − 2T − 70 (15T 기준 H−30 / 목찬넬 H−100). 호출자가 밴드 높이와
          //   같은 battenH 를 넘긴다 (corner.md §3.5.0).
          const battenQty = 1;
          const legH = Number.isFinite(battenH) ? battenH : H;
          this.add(materials, modLabel, '경첩목대(앞다리)', 'PB', battenT, battenLeg, legH, battenQty, '-',
                   'ㄱ자 경첩목대 앞다리 60×15T — 멍판 바로 뒤, 지판·천판(밴드) 사이 (corner.md §3.5.0)');
          this.add(materials, modLabel, '경첩목대(옆다리)', 'PB', battenT, battenLeg, legH, battenQty, '-',
                   'ㄱ자 경첩목대 옆다리 60×15T — 도어 쪽 끝, 앞선에서 75, 지판·천판(밴드) 사이 (corner.md §3.5.0)');
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
        //   상몰딩   상부단·통짜 — MDF 18T · moldingH × W 를 그 단에 (상부 라인 상몰딩과 별개 — 높이가 다르다).
        //            2026-10-26 사장님 확정 "깊이가 다르면 따로 함." — 상부장 사이에 서서 깊이가 같으면 상부 라인 상몰딩이 이어 한 장이라 내지 않는다 (addTallMoldingPart).
        //            줄 끝에 붙어 깊이가 같아도 같다 (2026-10-26 사장님 확정 "잇는다.")
        // 걸레받이는 없다 — 다리발이 아니라 좌대가 받친다.
        // ========================================
        addTallTierParts(materials, prefix, mod, tier, specs) {
          const T = this.thicknessFor(specs);
          const W = parseFloat(mod.w) || 600;
          // 몸통 높이 — 브리지가 좌대·상몰딩을 이미 뺀 값 (ui-step1.js _carcassHeight), 상세설계 화면도 같다 (addTallModule)
          const H = parseFloat(mod.h) || 0;
          const modD = parseFloat(mod.d) || 550;
          const tierLabel = BOM_TALL_TIER_LABEL[tier] || '';
          const modLabel = `${prefix}${mod.name || '키큰장'}${tierLabel ? `(${tierLabel})` : ''}`;
          const grounded = tier === 'bottom' || tier === 'single';   // 바닥에 닿는 단 — 좌대·목찬넬
          const crowned = tier === 'top' || tier === 'single';       // 천장에 닿는 단 — 상몰딩
          const channelHere = bomTallTierHasChannel(tier, specs);
          // 2026-10-24 사장님 (키큰장 조합) "싱크 서랍장 규칙 그대로": 맨 아래 단 서랍 — 전면 · 박스 · 중간 목찬넬을
          //   싱크 하부장 서랍장과 같은 함수(drawerLayoutOf · addDrawerModuleParts)로, 단 몸통을 전면 영역으로 (bomTallDrawerTier).
          const drawerLayout = (bomTallDrawerTier(mod) && DrawerRules) ? this.drawerLayoutOf(mod, H, T) : null;
          if (drawerLayout && drawerLayout.warnings.length) dlog(`[Drawer] ${modLabel}: ${drawerLayout.warnings.join(' / ')}`);

          // 몸통 — 하부장과 같다 (사쿠리 없음). 목찬넬 단은 하부장처럼 측판 앞 위를 70×40 따낸다 (sink.md §5.1, 비고는 하부장과 같은 글).
          //   서랍 단이면 중간 따내기도 (하부장 서랍장과 같은 notchNote). 서랍을 고른 중간 · 상부 단은 규칙이 없다고 남긴다.
          //   키큰장 단은 하부장 문턱(800) · 전부 서랍이면 처짐방지목 없음 · 위 도어 + 아래 서랍은 두 몸통 (addLowerCarcassRows)
          this.addLowerCarcassRows(materials, modLabel, W, H, T, modD, drawerLayout, !!(channelHere && DrawerRules),
            mod.isDrawer && !drawerLayout ? BOM_TALL_DRAWER_TIER_NOTE : '');
          const bandH = channelHere ? H - T * 2 - DrawerRules.DRAWER_RULES.CHANNEL_TOP_NOTCH_H : H - T * 2;
          // 선반 — 단이 가진 만큼 (하부장 규칙 "서랍·EL·오픈 아니면 1" 을 타지 않는다). 서랍 단에는 없다 (하부장 서랍장과 같다)
          const rawShelf = Number(mod.shelfCount);
          const shelfQty = drawerLayout ? 0 : (Number.isFinite(rawShelf) ? Math.max(0, Math.round(rawShelf)) : 1);
          if (shelfQty > 0) {
            this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - T - this.blindShelfCut(mod, 'lower'), shelfQty, '1면(전)');
          }
          // 도어 — 목찬넬 단만 H−30, 나머지는 푸쉬 H−4 (bomTallTierDoorH — 경첩 수도 같은 높이를 본다)
          const doorH = bomTallTierDoorH(mod, tier, specs);
          if (isBlindModule(mod, 'lower')) {
            const blindDoorW = this.blindDoorPartW(mod, W); // doorW + 11 — 도어가 목대를 덮는다 (corner.md §3.5.1)
            this.add(materials, modLabel, '도어', 'MDF', 18, blindDoorW, doorH, mod.doorCount || 1, '4면', '멍장 도어(도어폭 기준) — 목대를 덮는다: doorW + 15 − 4 (corner.md §3.5.1)', mod);
            this.addBlindFrontParts(materials, modLabel, mod, H, bandH);
          } else if (drawerLayout) {
            // 서랍 단 — 전면(위 칸도 서랍이면 도어 없음) · 박스 · 중간 목찬넬, 싱크 하부장 서랍장과 같다
            this.addDrawerModuleParts(materials, modLabel, mod, W, T, mod.doorCount || 0, drawerLayout, modD, channelHere);
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
          // 좌대 — 스택에 한 벌, 바닥 단에 / 상몰딩 — 스택 맨 위 단에 한 장
          if (grounded) this.addTallPedestalParts(materials, modLabel, mod, W, modD, T, specs);
          if (crowned) this.addTallMoldingPart(materials, modLabel, mod, W, specs);
        }

        /**
         * 키큰장 좌대 — 스택에 한 벌, 바닥 단에 (sink.md §5 좌대 60 · 상자 구성은 wardrobe.md).
         * 2026-10-13 사장님: 좌대 앞뒤판 W = 모듈 W, 측판 = 모듈 D − 80, 중간보강도 측판과 같다 (BOM_PEDESTAL_*).
         *   (2026-10-12 의 "앞뒤 W − 2T · 측 D − 5 · 보강 D − 2T − 35" 를 바꾼다)
         */
        addTallPedestalParts(materials, modLabel, mod, W, modD, T, specs) {
          const hp = (mod.heightParts && typeof mod.heightParts === 'object') ? mod.heightParts : {};
          const n = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? x : d; };
          const pedestalH = n(hp.pedestalH, n(specs.wardrobePedestal, 60));
          if (!(pedestalH > 0)) return;
          const pedNote = '키큰장 좌대 — 앞뒤 W · 측·보강 D−80 (2026-10-13 사장님 확정, 붙박이장과 같다)';
          const pedLabel = `${modLabel}-좌대`;
          this.add(materials, pedLabel, '좌대 전후', 'PB', T, W, pedestalH, 2, '1면(전)', pedNote);
          this.add(materials, pedLabel, '좌대 측', 'PB', T, modD - BOM_PEDESTAL_D_SETBACK, pedestalH, 2, '1면(전)', pedNote);
          if (W >= BOM_PEDESTAL_BRACE_W_MIN) {
            this.add(materials, pedLabel, '좌대 중간보강', 'PB', T, modD - BOM_PEDESTAL_D_SETBACK, pedestalH, 1, '1면(전)', pedNote);
          }
          this.add(materials, pedLabel, '좌대 걸레받이', 'MDF', 18, pedestalH, W, 1, '2면(장)', pedNote);
        }

        /**
         * 싱크 상몰딩 계획 (bomSinkMoldingPlanOf) — 싱크대 규칙으로 상몰딩을 내는 품목(BOM_SINK_MOLDING_CATEGORIES)만, 아니면 null.
         *   상부 라인 모듈(후드 자리 포함)과 키큰장 단(쿡탑장 제외 하부 줄, 상자 모듈 단 포함)으로 세운다.
         *   BOM(extract → extractSink · addTallMoldingPart)과 조립 명세(bom-assembly.js runsOf 'molding')가 이 한 답을 쓴다.
         * @returns {{lens:number[], joinedTalls:string[]}|null}
         */
        sinkMoldingPlanOf(item) {
          const cat = item && (item.categoryId || item.category);
          if (BOM_SINK_MOLDING_CATEGORIES.indexOf(cat) < 0) return null;
          const mods = (item && item.modules) || [];
          return bomSinkMoldingPlanOf(
            mods.filter((m) => m && m.pos === 'upper'),
            mods.filter((m) => m && m.pos === 'lower' && m.type !== 'cook' && bomTallTierOf(m)),
            (item && item.specs) || {});
        }

        /**
         * 키큰장 상몰딩 — 스택 맨 위 단에 한 장 (sink.md §5 상몰딩 60, MDF 18T · moldingH × W).
         *   2026-10-26 사장님 확정 "깊이가 다르면 따로 함." — 상부장 사이에 선 키큰장의 깊이가 상부장과 같아 상부 라인 상몰딩이
         *   그 위까지 이어 한 장이면(bomSinkMoldingPlanOf joinedTalls) 이 단은 상몰딩을 따로 내지 않는다 — 그 길이는 EP 상몰딩에 들어 있다.
         *   줄 끝(가장 바깥 상부장 시작 · 끝)에 붙은 키큰장도 같다 — 2026-10-26 사장님 확정 "잇는다."
         */
        addTallMoldingPart(materials, modLabel, mod, W, specs) {
          const plan = this._ctx && this._ctx.sinkMolding;
          if (plan && plan.joinedTalls.indexOf(String(mod.id)) >= 0) return;
          const moldingH = bomTallMoldingHOf(mod, specs);
          if (moldingH >= 20) {
            this.add(materials, modLabel, '상몰딩', 'MDF', 18, moldingH, W, 1, W > 2000 ? '2면(장)' : '4면');
          }
        }

        /**
         * 2026-10-24 (키큰장 조합): 키큰장 단을 상자 타입(오픈장 · 밥솥장 · 홈카페장 · EL장)으로 바꾼 모듈 — 몸통은 상자 규칙 파일이 내고,
         *   그 단이 짊어진 **좌대(바닥 단) · 상몰딩(맨 위 단)**은 단 규칙 그대로 낸다 (sink.md §5.1 — 좌대는 스택에 한 벌, 상몰딩은 맨 위 단).
         *   브리지가 키큰장 섹션의 상자 모듈을 `type:'tall'` + heightParts 로 보낸다. 키큰장 단이 아니면 아무것도 하지 않는다.
         */
        addTallStackParts(materials, modLabel, mod, specs) {
          const tier = bomTallTierOf(mod);
          if (!tier) return;
          const W = parseFloat(mod.w) || 0;
          const modD = parseFloat(mod.d) || 0;
          if (!(W > 0) || !(modD > 0)) return;
          if (tier === 'bottom' || tier === 'single') this.addTallPedestalParts(materials, modLabel, mod, W, modD, this.thicknessFor(specs), specs);
          if (tier === 'top' || tier === 'single') this.addTallMoldingPart(materials, modLabel, mod, W, specs);
        }

        // ========================================
        // 오픈장 자재 추출 (2026-09-19)
        //
        // 모듈 타입이다 — 카테고리를 가리지 않는다. 규칙은 js/detaildesign/bom-open-cabinet-rules.js
        // 한 파일뿐이고 플래너(mockup-structure)도 같은 파일로 그린다.
        //   측판 D×H 2 · 천지판 (W−36)×(D−20) 2 · 뒷판 (W−36)×H 1, 전부 18T MDF.
        //
        // 오픈장 모듈을 뺀 item 을 돌려준다 — 부르는 쪽이 그걸 카테고리 추출기에 넘겨
        // 같은 상자가 두 벌 나가지 않게 한다. 오픈장이 없으면 받은 item 을 그대로 돌려준다.
        // ========================================
        extractOpenCabinets(item, materials, prefix = '') {
          const R = (typeof DadamOpenCabinetRules !== 'undefined' && DadamOpenCabinetRules)
            || (typeof window !== 'undefined' && window.DadamOpenCabinetRules)
            || null;
          const mods = (item && item.modules) || [];
          if (!R || !mods.length) return item;
          const open = mods.filter((m) => R.isOpenCabinet(m));
          if (!open.length) return item;

          open.forEach((mod, i) => {
            // 2026-10-20: 행 식별자(partId·moduleKey)가 이 모듈을 가리키게 — 문맥이 없으면 '0-none' 으로 떨어져 조립 명세가 모듈을 못 찾는다.
            this.beginModule(mod, i, mod.pos);
            const dims = { W: Number(mod.w) || 0, H: Number(mod.h) || 0, D: Number(mod.d) || 0 };
            // 같은 품목에 오픈장이 여럿이면 자재표에서 구분되어야 한다 (#1·#2 는 품목 접두사라 여기선 못 쓴다).
            const name = `${prefix}${R.RULES.LABEL}${open.length > 1 ? ` ${i + 1}` : ''}`;
            const parts = R.partsOf(dims);
            if (!parts.length) {
              dlog(`[BOM] 오픈장 ${mod.id || name} 치수가 규칙을 못 채운다:`, dims, R.warningsOf(dims));
              return;
            }
            parts.forEach((p) => {
              this.add(materials, name, p.part, p.material, p.t, p.w, p.h, p.qty, p.edge, '', mod);
            });
            this.addTallStackParts(materials, name, mod, (item && item.specs) || {});
          });

          // 원본은 건드리지 않는다 — 호출자(extract)가 같은 item 을 다른 곳에서도 읽는다.
          return Object.assign({}, item, { modules: mods.filter((m) => !R.isOpenCabinet(m)) });
        }

        // ========================================
        // 2026-10-20: 밥솥장 (bom-rice-cabinet-rules.js — 사장님 확정: 오픈장 + 슬라이딩 선반, 도어 여닫이·포켓·리프트)
        //   몸통 (2026-10-25 사장님) — 오픈이면 오픈장 부재 그대로 (18T MDF 측판 2 · 천지판 2 · 뒷판 1),
        //     도어가 달리면 일반 장 몸통 (addRiceCarcassParts — 측판 · 지판 · 밴드 2 · 3T 뒷판, PB 품목 몸통 두께 15 · 18).
        //   슬라이딩 선반 = 규칙 파일 shelfPartsOf (선반 · 보강목 2 · 마이다 · 여닫이면 추가 목대), 레일 길이는 서랍 규칙 (railLengthFor).
        //   도어 = 규칙 파일 doorOf (W − 4) × (H − 4), 도어 종류를 비고에 적는다. 철물은 HardwareExtractor 가 doorType 으로 낸다.
        //   밥솥장 모듈을 뺀 item 을 돌려준다 (extractOpenCabinets 와 같은 이유).
        // ========================================
        extractRiceCabinets(item, materials, prefix = '') {
          const R = RiceRules;
          const mods = (item && item.modules) || [];
          if (!R || !mods.length) return item;
          const rice = mods.filter((m) => R.isRiceCabinet(m));
          if (!rice.length) return item;

          rice.forEach((mod, i) => {
            // 2026-10-20: 행 식별자(partId·moduleKey)가 이 모듈을 가리키게 — 문맥이 없으면 '0-none' 으로 떨어져 조립 명세가 모듈을 못 찾는다.
            this.beginModule(mod, i, mod.pos);
            const dims = { W: Number(mod.w) || 0, H: Number(mod.h) || 0, D: Number(mod.d) || 0 };
            const name = `${prefix}${R.RULES.LABEL}${rice.length > 1 ? ` ${i + 1}` : ''}`;
            const specs = (item && item.specs) || {};
            const bodyT = this.thicknessFor(specs);
            const doorType = mod.doorType || 'none';
            if (R.hasDoorBody(doorType)) {
              if (!dims.W || !dims.H || !dims.D) return;
              this.addRiceCarcassParts(materials, name, dims, bodyT);
            } else {
              const parts = R.partsOf(dims);
              if (!parts.length) {
                dlog(`[BOM] 밥솥장 ${mod.id || name} 치수가 규칙을 못 채운다:`, dims, R.warningsOf(dims));
                return;
              }
              parts.forEach((p) => {
                this.add(materials, name, p.part, p.material, p.t, p.w, p.h, p.qty, p.edge, p.note || '', mod);
              });
            }
            R.shelfPartsOf(dims, doorType, bodyT, bomRiceRailLengthOf(mod)).forEach((p) => {
              this.add(materials, name, p.part, p.material, p.t, p.w, p.h, p.qty, p.edge, p.note || '', mod);
            });
            const door = R.doorOf(dims, doorType);
            if (door) {
              const note = `밥솥장 ${door.name} 도어` + (door.note ? ` — ${door.note}` : '');
              this.add(materials, name, '도어', 'MDF', 18, door.w, door.h, door.qty, '4면', note, mod);
            }
            this.addTallStackParts(materials, name, mod, specs);
          });

          return Object.assign({}, item, { modules: mods.filter((m) => !R.isRiceCabinet(m)) });
        }

        /**
         * 2026-10-25 사장님: 도어가 달린 밥솥장 몸통 = **일반 장 몸통** — 하부장 · 키큰장 단과 같은 짜임 (사쿠리 없음, 목찬넬 따내기 없음):
         *   측판 3면 D×H 2 · 지판 (W−2T)×D · 밴드 70×(W−2T) 2 · 뒷판 3T 측판 뒤 덮음 · 처짐방지 (W ≥ 800). PB, 품목 몸통 두께 (기본 15 · 18 옵션).
         */
        addRiceCarcassParts(materials, name, dims, T) {
          const { W, H, D } = dims;
          this.add(materials, name, '측판', 'PB', T, D, H, 2, '3면');
          this.add(materials, name, '지판', 'PB', T, W - T * 2, D, 1, '1면(전)');
          this.add(materials, name, '밴드', 'PB', T, ASM.BAND_W, W - T * 2, 2, '2면(장)');
          this.addBackPanel(materials, name, W, H, false);
          const braceQty = bomBraceQtyOf(W, 'lower');
          if (braceQty > 0) this.add(materials, name, '밴드(처짐방지)', 'PB', T, ASM.BRACE_W, H - T * 2, braceQty, '2면(장)');
        }

        /** EL장 몸통 — PB 측판(사쿠리)·천판·지판 + 뒷판, 도어 없음 (extractFridge 'el' 가지 그대로). sideNote 는 측판 비고에 덧붙인다. */
        addElParts(materials, name, dims, T, sideNote) {
          const { W, H, D } = dims;
          this.add(materials, name, '측판', 'PB', T, D, H, 2, '3면', 'sakuri(15→3mm)' + (sideNote ? ` · ${sideNote}` : ''));
          this.add(materials, name, '천판', 'PB', T, W - T * 2, D - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
          this.add(materials, name, '지판', 'PB', T, W - T * 2, D - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
          this.addBackPanel(materials, name, W, H, true);
        }

        // ========================================
        // 2026-10-20: EL장 모듈 타입 (플래너 — moduleKind 'el', 사장님 카드 "모듈 타입으로")
        //   몸통은 예전 extractFridge 'el' 과 같다. 도어 치수 규칙이 없어 도어 행은 내지 않고,
        //   측판 비고에 도어 종류와 [확인 필요] 를 적는다. EL장 모듈을 뺀 item 을 돌려준다.
        // ========================================
        extractEls(item, materials, prefix = '') {
          const R = ElRules;
          const mods = (item && item.modules) || [];
          if (!R || !mods.length) return item;
          const els = mods.filter((m) => R.isEl(m));
          if (!els.length) return item;
          const T = this.thicknessFor((item && item.specs) || {});
          els.forEach((mod, i) => {
            const dims = { W: Number(mod.w) || 0, H: Number(mod.h) || 0, D: Number(mod.d) || 0 };
            if (!dims.W || !dims.H || !dims.D) return;
            this.beginModule(mod, i, mod.pos || null);
            const door = R.doorTypeName(mod.doorType);
            const note = (door ? `도어 ${door} · ` : '도어 종류 미선택 · ') + R.RULES.NOTE;
            const name = `${prefix}${R.RULES.LABEL}${els.length > 1 ? ` ${i + 1}` : ''}`;
            this.addElParts(materials, name, dims, T, note);
            this.addTallStackParts(materials, name, mod, (item && item.specs) || {});
          });
          return Object.assign({}, item, { modules: mods.filter((m) => !R.isEl(m)) });
        }

        /** 홈카페장 한 칸 — 몸통 + 도어 (bom-homecafe-rules.js). 예전 화면(extractFridge)과 플래너 모듈 타입이 같이 쓴다. */
        addHomecafeParts(materials, name, mod, dims) {
          const R = HomecafeRules;
          if (!R) return;
          R.partsOf(dims).forEach((p) => {
            this.add(materials, name, p.part, p.material, p.t, p.w, p.h, p.qty, p.edge, p.note || '');
          });
          const door = R.doorOf(dims, mod.doorCount);
          if (door) this.add(materials, name, '도어', 'MDF', 18, door.w, door.h, door.qty, '4면', '', mod);
        }

        // ========================================
        // 2026-10-20: 홈카페장 모듈 타입 (플래너 — moduleKind 'homecafe', 결정 카드 추천안)
        //   부재는 fridge.md §11 홈카페장 그대로. 홈카페장 모듈을 뺀 item 을 돌려준다 (extractOpenCabinets 와 같은 이유).
        //   예전 냉장고장 화면의 type 'homecafe' 모듈은 여기서 걷지 않는다 — extractFridge 가 낸다.
        // ========================================
        extractHomecafes(item, materials, prefix = '') {
          const R = HomecafeRules;
          const mods = (item && item.modules) || [];
          if (!R || !mods.length) return item;
          const isPlannerHc = (m) => !!m && String(m.moduleKind || '') === R.RULES.KIND;
          const hc = mods.filter(isPlannerHc);
          if (!hc.length) return item;
          hc.forEach((mod, i) => {
            const dims = { W: Number(mod.w) || 0, H: Number(mod.h) || 0, D: Number(mod.d) || 0 };
            this.beginModule(mod, i, mod.pos || null);
            const name = `${prefix}${R.RULES.LABEL}${hc.length > 1 ? ` ${i + 1}` : ''}`;
            this.addHomecafeParts(materials, name, mod, dims);
            this.addTallStackParts(materials, name, mod, (item && item.specs) || {});
          });
          return Object.assign({}, item, { modules: mods.filter((m) => !isPlannerHc(m)) });
        }

        // ========================================
        // 싱크대 자재 추출
        // ========================================
        /**
         * 걸레받이 행 — 벽마다, 원판 긴 변을 넘으면 그 단위로 나눈 조각을 길이별로 묶어 낸다 (bomKickWallLensOf).
         * @param {number[]} wallLens 벽 길이들
         * @param {number} kickH      걸레받이 높이 (다리발 − 5)
         */
        addKickBoards(materials, label, wallLens, kickH) {
          const unit = this.PANEL_H || 2440;
          const qtyByLen = new Map();
          wallLens.forEach((len) => bomKickPiecesOf(len, unit).forEach((p) => qtyByLen.set(p, (qtyByLen.get(p) || 0) + 1)));
          const pieces = [...qtyByLen.values()].reduce((a, b) => a + b, 0);
          const note = pieces > 1 ? `벽 ${wallLens.length}개 · ${unit} 넘으면 ${unit} 단위로 나눔` : '';
          [...qtyByLen.keys()].sort((a, b) => b - a).forEach((len) => {
            this.add(materials, label, '걸레받이', 'MDF', 18, len, kickH, qtyByLen.get(len), '2면(장)', note);
          });
        }

        extractSink(item, materials, prefix = '') {
          const specs = item.specs || {};
          const T = this.thicknessFor(specs);
          const defaultUpperD = ASM.UPPER_D_DEFAULT; // 상부장 기본 깊이
          const defaultLowerD = ASM.LOWER_D_DEFAULT; // 하부장 기본 깊이
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
            this.add(materials, modLabel, '천판', 'PB', T, W - T * 2, modD - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
            // 지판 (사쿠리 반영 D-18)
            this.add(materials, modLabel, '지판', 'PB', T, W - T * 2, modD - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
            // 뒷판 (사쿠리홈에 끼움 — bomBackPanelSize)
            this.addBackPanel(materials, modLabel, W, H, true);
            // 밴드(보강목) 2개
            this.add(materials, modLabel, '밴드(보강목)', 'PB', ASM.UPPER_BAND_T, W - T * 2, ASM.UPPER_BAND_W, 2, '2면(장)');
            // 밴드(처짐방지목) — W ≥ 700 이면 1장, 모듈 중앙 (bomBraceQtyOf)
            const braceQty = bomBraceQtyOf(W, 'upper');
            if (braceQty > 0) this.add(materials, modLabel, '밴드(처짐방지)', 'PB', T, ASM.BRACE_W, H - T * 2, braceQty, '2면(장)');
            // 선반 2개 (사쿠리 반영 D-34). 2026-09-13: 멍장은 ㄱ자 목대 깊이 75 만큼 짧다 (corner.md §3.5)
            this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - ASM.SAKURI_SHELF_D_MINUS - this.blindShelfCut(mod, 'upper'), 2, '1면(전)');
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
              this.addBlindFrontParts(materials, modLabel, mod, H, H - T * 2);
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

            // 몸통 — 측판 2 (하부장: 사쿠리 없음, 목찬넬이면 따내기 비고) · 지판 · 밴드 2 · 뒷판(측판 뒤 덮음) · 처짐방지목.
            //   위 도어 + 아래 서랍은 두 몸통 (2026-10-25, addLowerCarcassRows)
            this.addLowerCarcassRows(materials, modLabel, W, H, T, modD, drawerLayout, !!(isWoodChannel && DrawerRules));
            const bandH = isWoodChannel ? H - T * 2 - DrawerRules.DRAWER_RULES.CHANNEL_TOP_NOTCH_H : H - T * 2;
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
              this.addBlindFrontParts(materials, modLabel, mod, H, bandH);
            } else if (isDrawer) {
              // ★ 2026-09-15: 서랍장 — 규칙은 bom-drawer-rules.js (도면 "서랍장 목찬넬 구조 도면").
              //   전면(위→아래): doorCount>0 이면 [도어, 서랍×n] — 플래너 doorTopDrawerBottom 과 같은 그림.
              //   예전엔 서랍을 위에 220 피치로 쌓고 남는 높이를 여닫이 도어로 냈다 — 2단부터 몸통이 안 맞았다
              //   (전면 합 H−50, 3단은 68 짜리 도어, 4단은 몸통 초과). 지금은 전면 합 = H 로 닫힌다.
              //   서랍 박스는 존(위·아래 따내기 사이)에 레일 여유를 빼고 들어가는 가장 큰 크기(대·중·소).
              //   목찬넬은 전면과 1:1 이 아니라 최소 수 — 중간 목찬넬만 모듈 부재(전면판 72·지면판 40 × W).
              //   상단 목찬넬은 그대로 EP(effectiveW 연속).
              this.addDrawerModuleParts(materials, modLabel, mod, W, T, doorCount, drawerLayout, modD, isWoodChannel);
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
          // 하부 모듈이 하나도 없는 옛 저장 설계만 품목 폭 − 좌우 마감 120 으로 떨어진다. 키큰장만 있는 라인은 0 — 걸레받이가 없다.
          const effectiveW = lowerModules.length ? totalLowerW : item.w - 120;
          const moldingH = parseFloat(specs.moldingH) || 60;
          const lowerH = (specs.lowerH || 870) - legH;
          const totalH = parseFloat(item.h) || 2310;

          // 상몰딩 (moldingH >= 20이면 산출) — 상부 라인 위에 얹히므로 섹션 'upper'
          // P1-2: 상부장이 없으면 없다. 예전엔 상부 폭 합이 0 이면 하부 폭(effectiveW)에 떨어져 없는 상몰딩이 나갔다.
          //   키큰장 상부단의 상몰딩은 그 단이 따로 낸다 (addTallTierParts).
          // 2026-10-25 사장님 확정: "상몰딩은 후드라고 해서 구별 하지 않음" — 후드 자리(type hood, 몸통은 없다)도 상부 라인 폭에 넣는다.
          //   상몰딩 한 장이 후드 위를 끊기지 않고 지난다 (조립 명세 runsOf 'molding' 도 후드를 구간에 넣는다).
          // 2026-10-26 사장님 확정: "상부장이 있다면 위에는 상몰딩이 있다고 보면됨. 가능한 이어지게." — 같은 벽 상부장 사이
          //   빈 자리(빈 벽 · 창문)도 건너 한 장. "벽을 기준으로 나눠야함." — 두 벽(ㄱ자 상부)이면 목찬넬처럼 벽마다 한 장,
          //   같은 길이의 벽은 한 행에 수량으로. "깊이가 다르면 따로 함." — 빈 자리에 선 키큰장은 깊이가 다르면 그 단이 제 상몰딩을 따로 내고,
          //   깊이가 같으면(앞면 · 윗면 · 몰딩 높이도 같을 때) 그 위까지 이어 한 장 (bomSinkMoldingPlanOf · sinkMoldingPlanOf).
          //   줄 끝에 붙은 키큰장도 같은 검사로 그 폭만큼 잇는다 — "잇는다." (2026-10-26 사장님 확정, 줄 끝 키큰장)
          //   계획은 extract() 가 상자 모듈을 걷어내기 전 모듈로 세운 것 (이 item 은 걷어낸 뒤라 상자 모듈 키큰장 단이 없다).
          const moldingPlan = (this._ctx && this._ctx.sinkMolding)
            || bomSinkMoldingPlanOf((item.modules || []).filter((m) => m.pos === 'upper'), lowerModules.filter((m) => bomTallTierOf(m)), specs);
          const moldingRows = bomWallLenQtyOf(moldingPlan.lens);
          const moldingWalls = moldingRows.reduce((a, r) => a + r[1], 0);
          const moldingNote = [moldingWalls > 1 ? `벽 ${moldingWalls}개 · 벽마다 한 장` : '',
            moldingPlan.joinedTalls.length ? '키큰장 위도 이어 한 장 (깊이 같음)' : ''].filter(Boolean).join(' · ');
          this.beginItemLevel('upper');
          if (moldingH >= 20) {
            moldingRows.forEach(([len, n]) => this.add(materials, epLabel, '상몰딩', 'MDF', 18, moldingH, len, n, len > 2000 ? '2면(장)' : '4면', moldingNote));
          }

          // 걸레받이 — 여기부터 하부 라인 마감. 벽마다 나눈다 (2026-10-20 카드 「꺾임에서 나누기」)
          this.beginItemLevel('lower');
          if (effectiveW > 0) {
            this.addKickBoards(materials, epLabel, lowerModules.length ? bomKickWallLensOf(lineLowerModules) : [effectiveW], legH - 5);
          }

          // 목찬넬 — 벽마다 한 장 (2026-10-25 사장님 확정 "보통 벽마다 한장씩, 두장으로 나뉨").
          //   벽 = 걸레받이와 같다 (하부 모듈 앞면 방향, 쿡탑장 · 키큰장 단 제외 — bomKickWallLensOf). 같은 길이의 벽은 한 행에 수량으로.
          //   자리가 없는 옛 설계 · 일자는 한 벽 — 예전처럼 한 장. 모서리는 그 자리에 선 모듈의 벽 몫이다 (벽 길이 = 그 벽 모듈 폭 합).
          if (isWoodChannel && effectiveW > 0) {
            const chRows = bomWallLenQtyOf(lowerModules.length ? bomKickWallLensOf(lineLowerModules) : [effectiveW]);
            const chWalls = chRows.reduce((a, r) => a + r[1], 0);
            const chNote = chWalls > 1 ? `벽 ${chWalls}개 · 벽마다 한 장` : '';
            chRows.forEach(([len, n]) => this.add(materials, epLabel, '목찬넬(전면)', 'MDF', 18, 52, len, n, '2면(장)', chNote));
            chRows.forEach(([len, n]) => this.add(materials, epLabel, '목찬넬(지면)', 'MDF', 18, 40, len, n, '2면(장)', chNote));
          }

          // P1-3: 상판 — 하부 라인에 한 장 (3D addTopPanel 도 배치 공간 단위 한 장이다 · W12-38).
          //   두께 = specs.topThickness — 12 · 50T 인조대리석 (2026-10-18 사장님, 예전 선택지의 18 도어자재 상판은 없앴다).
          //   마감 코드는 디테일 모델 top 슬롯 > specs.topColor 의 TOP-* (add()).
          //   폭 = 하부 라인 폭 + 좌·우 마감 폭 (상판은 마감재 위를 지나간다 — 3D 는 영역 전폭 그대로). 깊이 = 품목 깊이(도면 그대로).
          //   이음·타공은 상판 업체가 판단한다 — BOM 은 한 장으로 낸다.
          //   **품목당 한 장**이다 — 사용자 결정 2026-09-15. 3D 가 배치 공간(런)마다 한 장 그리는 것은 표시용 단순화이고,
          //   ㄱ·ㄷ자도 발주는 폭 합 한 장이다 (scene-bom-ledger.md §3 — 원장은 3D 조각의 합으로 맞춘다, test-utils/ledger-diff.js splitDeclaredTop).
          //   2026-10-26 사장님 확정 "ㄱ자 한 장으로 보내면 업체에서 알아서 나눔." — ㄱ·ㄷ자도 **발주는 한 장**이다 (2026-10-25
          //   "보통 벽마다 한장씩, 두장으로 나뉨. 상판 외주업체에서 결정." 의 나누기는 상판 업체가 한다). 상판 발주 요청서
          //   (workers/workflow-api/src/countertop.js)도 이 한 행으로 요청 한 장(평면 · 벽 길이 · 타공)을 만든다. 벽마다 나누지 않는다.
          //   쿡탑장(type cook)은 몸통을 안 내지만 상판은 그 위를 지나가므로 폭에 넣는다 (걸레받이 effectiveW 는 예전대로 뺀다).
          const topLineW = (item.modules || [])
            .filter((m) => m.pos === 'lower' && !bomTallTierOf(m))
            .reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0)
            || (lowerModules.length ? 0 : effectiveW);
          if (topLineW > 0) {
            const topT = parseFloat(specs.topThickness) || 12;
            const topD = parseFloat(item.d) || 650;
            // 2026-10-24 D9: 상판은 하부 배치 공간의 도면 마감재(비움 포함) 위도 지나간다 — 그 공간 폭(W)을 더한다 (3D addTopPanel = 영역 전폭)
            const topW = topLineW + (Array.isArray(specs.drawnFinishes) ? specs.drawnFinishes : [])
              .filter((f) => f && f.area === 'lower').reduce((s, f) => s + (Number(f.W) > 0 ? Number(f.W) : 0), 0);
            // 2026-10-18 사장님: 두께 12 · 50T 인조대리석, 깊이는 도면 그대로(배치 깊이 — 오버행 없음), 이음은 상판 업체 판단.
            //   목록 밖의 옛 값(18 도어자재 상판 등)은 그대로 내되 비고로 알린다 — 재질은 인조대리석 하나다.
            //   재질은 사양 topMaterial (인조대리석 · 엔지니어드 스톤 · 세라믹, 없으면 인조대리석) — 두께 선택지가 재질마다 다르다.
            const topMat = Object.prototype.hasOwnProperty.call(BOM_TOP_MATERIALS, specs.topMaterial) ? specs.topMaterial : '인조대리석';
            const topTs = BOM_TOP_MATERIALS[topMat];
            const topOk = topTs.includes(topT);
            this.add(materials, `${prefix}상판`, '상판', topMat, topT, topW, topD, 1, '-',
                     '하부 라인 한 장(도면 마감재 폭 포함) · 깊이 = 도면 · 이음은 상판 업체 판단'
                     + (topOk ? '' : ` [확인 필요] ${topMat} 상판 두께는 ${topTs.join(' · ')}T — 지정 값 ${topT}`));
          }

          // 좌·우 마감 (휠라/몰딩/EP) — 2026-10-24 D9: 도면 마감재 그대로 (addDrawnFinishes)
          this.addDrawnFinishes(materials, epLabel, item);
          this.beginItemLevel('lower');

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
            // 2026-09-19: 내부 서랍의 전면·좌우몰딩은 규칙 파일이 정한다 (사장님 확정 치수).
            //   전면 = 모듈 내경 −4 / 내경 높이 −4 에서 손잡이 빈 공간(30 × 목찬넬 갯수)을 뺀 것을 단수로 나눈다.
            //   몰딩은 좌우 각 60, 앞선에서 70 안쪽 — 문이 경첩에 걸리지 않게.
            const innerZone = wrLayout && WardrobeRules
              ? (WardrobeRules.cabinetsOf(wrLayout).find((c) => c.drawerZone) || {}).drawerZone
              : null;
            const innerRows = (innerZone && WardrobeRules)
              ? WardrobeRules.innerDrawerPartsOf(innerZone)
              : [];
            // 2026-09-19 사장님 확정: 내부 서랍은 **모듈을 따로 만든다** — 만드는 방식은 일반 모듈과 같고
            //   모듈 W = 통 내경 − 120 (경첩 몰딩 60+60) · H = 단수 × 350 · D = 통 깊이 − 70 이다.
            //   몸통(측판·천판·지판·뒷판·밴드)과 박스(전후판·측판·우라)를 규칙 파일이 낸다.
            const innerModRows = (innerZone && WardrobeRules && WardrobeRules.innerDrawerModulePartsOf)
              ? WardrobeRules.innerDrawerModulePartsOf(innerZone)
              : [];
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
              this.add(materials, `${name}-상부장`, '천판', 'PB', T, W - T * 2, modD - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
              this.add(materials, `${name}-상부장`, '지판', 'PB', T, W - T * 2, modD - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
              this.addBackPanel(materials, `${name}-상부장`, W, upperH, true);
              const shelfUpper = wrLayout ? 0 : (mod.shelfCountUpper || 0);
              if (shelfUpper > 0) {
                this.add(materials, `${name}-상부장`, '선반', 'PB', T, W - T * 2, modD - ASM.WARDROBE_SHELF_D_MINUS, shelfUpper, '1면(전)');
              }

              // --- 하부장 ---
              this.add(materials, `${name}-하부장`, '측판', 'PB', T, modD, lowerH, 2, '3면');
              this.add(materials, `${name}-하부장`, '천판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
              this.add(materials, `${name}-하부장`, '지판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
              this.addBackPanel(materials, `${name}-하부장`, W, lowerH, false);
              const shelfLower = wrLayout ? 0 : (mod.shelfCountLower || 0);
              if (shelfLower > 0) {
                this.add(materials, `${name}-하부장`, '선반', 'PB', T, W - T * 2, modD - T, shelfLower, '1면(전)');
              }

              // 서랍
              if (drawerCount > 0) {
                const drawerFBW = isExternalDrawer ? W - 30 - 42 : W - 30 - 42 - 120;
                // 2026-10-20 사장님 카드 "싱크 규칙": 외부 서랍 박스는 싱크 서랍 박스 규칙 (언더레일, 레일 = 깊이 − 50 이하 최대 규격, 대 박스 180)
                const extBox = isExternalDrawer ? DrawerRules.drawerBoxDims({ W, D: modD, bodyT: T, drawerT: T, rail: 'under', boxH: DrawerRules.DRAWER_RULES.BOX_H.large, sakuri: false }) : null;
                if (isExternalDrawer) {
                  // 외부 서랍 모듈 본체 (별도 제작)
                  const drawerModH = drawerCount * DRAWER_MOD_H;
                  // 2026-10-20 사장님 카드 "싱크처럼 따냄": 측판 앞선에 목찬넬 따내기 — 상단 70×40, 서랍 사이 90×40 (2단은 서랍마다 위, 그 밖은 assignChannels)
                  const extMids = drawerCount === 2 ? 1 : DrawerRules.assignChannels(Math.min(drawerCount, 3)).filter(Boolean).length;
                  const extNotch = ` · ${DrawerRules.notchNote({ midCount: extMids })}`;
                  this.add(materials, `${name}-서랍모듈`, '측판', 'PB', T, modD, drawerModH, 2, '3면', `sakuri(15→3mm)${extNotch}`);
                  // 2026-10-20 사장님 카드 "천판 빼기": 서랍모듈은 싱크처럼 천판 없이 밴드만 — 위는 위 몸통 지판이 막고, 앞 위는 상단 목찬넬 ㄴ자 자리
                  this.add(materials, `${name}-서랍모듈`, '지판', 'PB', T, W - T * 2, modD - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
                  this.addBackPanel(materials, `${name}-서랍모듈`, W, drawerModH, true);
                  this.add(materials, `${name}-서랍모듈`, '밴드', 'PB', T, W - T * 2, ASM.BAND_W, 2, '2면(장)');
                  // 외부 서랍 자재
                  this.add(materials, `${name}-서랍모듈`, '서랍전후판', 'PB', T, extBox.fbW, extBox.fbH, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍측판', 'PB', T, extBox.sideL, extBox.sideH, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍밑판', 'MDF', BOM_DRAWER_BOTTOM_T, extBox.bottomW, extBox.bottomD, drawerCount, '-');
                } else if (innerModRows.length) {
                  // 내부 서랍장 — **따로 만드는 모듈**이다. 몸통·박스 모두 규칙 파일 치수다.
                  //   옛 코드는 서랍 1단짜리 고정치(측판 350×500 · 박스 440×180)라 단수가 늘어도 그대로였다.
                  innerModRows.forEach((row) => {
                    this.add(materials, `${name}-내부서랍모듈`, row.part, row.material, row.t,
                      row.w, row.h, row.qty, row.edge, row.note || '');
                  });
                } else {
                  // 옛 설계(규칙 블록 없음) — 1단 기준 고정치를 그대로 쓴다
                  this.add(materials, `${name}`, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍밑판', 'MDF', BOM_DRAWER_BOTTOM_T, W - 30 - 13, 449, drawerCount, '-');
                  this.add(materials, `${name}`, '내부서랍 상판', 'PB', T, W - 30, 520, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 측판', 'PB', T, 350, 500, 2, '3면');
                  this.add(materials, `${name}`, '내부서랍 지판', 'PB', T, W - 30 - 120, 500, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 밴드', 'PB', T, W - 30 - 120, 70, 2, '2면(장)');
                  if (!innerRows.length) {
                    this.add(materials, `${name}`, '내부서랍 좌우몰딩', 'PB', T, 350, 60, 2, '2면(장)');
                    this.add(materials, `${name}`, '내부서랍 전면판', 'PB', T, W - 30 - 120 - 6, 298, 1, '4면');
                  }
                }
                // 서랍 전후판 가로 600 초과 시 하단 보강재
                const bogangModule = isExternalDrawer ? `${name}-서랍모듈` : `${name}`;
                // 내부 서랍을 모듈로 낼 때는 하단보강도 그 안에 있다 — 여기서 또 내면 두 번 나온다.
                if (drawerFBW > 600 && (isExternalDrawer || !innerModRows.length)) {
                  this.add(materials, bogangModule, '서랍 하단보강', 'PB', T, extBox ? extBox.sideL : 440, 60, drawerCount, '2면(장)');
                }
              }

              // 도어 (좌대+bodyH-20 통일 — 짧은옷/긴옷 모두 동일 높이)
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                const doorH = pedestalH + bodyH - 20;
                if (isExternalDrawer && drawerCount > 0) {
                  // 2026-10-20 사장님 카드 "도어 1580": 외부 서랍 위 도어는 서랍모듈 상단~몸통 상단 (= 몸통 − 서랍모듈H). 좌대 덮기는 서랍 전면 몫이다
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, bodyH - drawerCount * DRAWER_MOD_H, doorCount, '4면', '', mod);
                  // 외부 서랍 도어 (목찬넬, 서랍수별 높이)
                  const drawerDoorW = W - 4;
                  const drawerModTotal = drawerCount * DRAWER_MOD_H + pedestalH;
                  let drawerDoorH, drawerDoorQty;
                  if (drawerCount === 1) {
                    drawerDoorH = drawerModTotal - 30 - 20;
                    drawerDoorQty = 1;
                  } else if (drawerCount === 2) {
                    // 2026-10-20 사장님: 2단은 서랍마다 위에 목찬넬 30 하나씩 (예전 30 하나 → 355, 지금 340)
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30 - 30) / 2);
                    drawerDoorQty = 2;
                  } else {
                    // 2026-10-20 사장님 카드 "4 띄움": 목찬넬 없는 위 두 전면 사이는 싱크 규칙대로 4 (FRONT_GAP)
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30 - 30 - 4) / 3);
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
              this.add(materials, `${name}`, '천판', 'PB', T, W - T * 2, modD - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
              this.add(materials, `${name}`, '지판', 'PB', T, W - T * 2, modD - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
              this.addBackPanel(materials, `${name}`, W, modH, true);

              const shelfCount = wrLayout ? 0 : (mod.shelfCount || 1);
              if (shelfCount > 0) {
                this.add(materials, `${name}`, '선반', 'PB', T, W - T * 2, modD - ASM.WARDROBE_SHELF_D_MINUS, shelfCount, '1면(전)');
              }
              if (drawerCount > 0) {
                const drawerFBW = isExternalDrawer ? W - 30 - 42 : W - 30 - 42 - 120;
                // 2026-10-20 사장님 카드 "싱크 규칙": 외부 서랍 박스는 싱크 서랍 박스 규칙 (언더레일, 레일 = 깊이 − 50 이하 최대 규격, 대 박스 180)
                const extBox = isExternalDrawer ? DrawerRules.drawerBoxDims({ W, D: modD, bodyT: T, drawerT: T, rail: 'under', boxH: DrawerRules.DRAWER_RULES.BOX_H.large, sakuri: false }) : null;
                if (isExternalDrawer) {
                  // 외부 서랍 모듈 본체 (별도 제작)
                  const drawerModH = drawerCount * DRAWER_MOD_H_LONG;
                  // 2026-10-20 사장님 카드 "싱크처럼 따냄": 측판 앞선에 목찬넬 따내기 — 상단 70×40, 서랍 사이 90×40 (2단은 서랍마다 위, 그 밖은 assignChannels)
                  const extMids = drawerCount === 2 ? 1 : DrawerRules.assignChannels(Math.min(drawerCount, 3)).filter(Boolean).length;
                  const extNotch = ` · ${DrawerRules.notchNote({ midCount: extMids })}`;
                  this.add(materials, `${name}-서랍모듈`, '측판', 'PB', T, modD, drawerModH, 2, '3면', `sakuri(15→3mm)${extNotch}`);
                  // 2026-10-20 사장님 카드 "천판 빼기": 서랍모듈은 싱크처럼 천판 없이 밴드만 — 위는 위 몸통 지판이 막고, 앞 위는 상단 목찬넬 ㄴ자 자리
                  this.add(materials, `${name}-서랍모듈`, '지판', 'PB', T, W - T * 2, modD - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
                  this.addBackPanel(materials, `${name}-서랍모듈`, W, drawerModH, true);
                  this.add(materials, `${name}-서랍모듈`, '밴드', 'PB', T, W - T * 2, ASM.BAND_W, 2, '2면(장)');
                  // 외부 서랍 자재
                  this.add(materials, `${name}-서랍모듈`, '서랍전후판', 'PB', T, extBox.fbW, extBox.fbH, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍측판', 'PB', T, extBox.sideL, extBox.sideH, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍밑판', 'MDF', BOM_DRAWER_BOTTOM_T, extBox.bottomW, extBox.bottomD, drawerCount, '-');
                } else if (innerModRows.length) {
                  // 내부 서랍장 — **따로 만드는 모듈**이다. 몸통·박스 모두 규칙 파일 치수다.
                  //   옛 코드는 서랍 1단짜리 고정치(측판 350×500 · 박스 440×180)라 단수가 늘어도 그대로였다.
                  innerModRows.forEach((row) => {
                    this.add(materials, `${name}-내부서랍모듈`, row.part, row.material, row.t,
                      row.w, row.h, row.qty, row.edge, row.note || '');
                  });
                } else {
                  // 옛 설계(규칙 블록 없음) — 1단 기준 고정치를 그대로 쓴다
                  this.add(materials, `${name}`, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍밑판', 'MDF', BOM_DRAWER_BOTTOM_T, W - 30 - 13, 449, drawerCount, '-');
                  this.add(materials, `${name}`, '내부서랍 상판', 'PB', T, W - 30, 520, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 측판', 'PB', T, 350, 500, 2, '3면');
                  this.add(materials, `${name}`, '내부서랍 지판', 'PB', T, W - 30 - 120, 500, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 밴드', 'PB', T, W - 30 - 120, 70, 2, '2면(장)');
                  if (!innerRows.length) {
                    this.add(materials, `${name}`, '내부서랍 좌우몰딩', 'PB', T, 350, 60, 2, '2면(장)');
                    this.add(materials, `${name}`, '내부서랍 전면판', 'PB', T, W - 30 - 120 - 6, 298, 1, '4면');
                  }
                }
                // 서랍 전후판 가로 600 초과 시 하단 보강재
                const bogangModule = isExternalDrawer ? `${name}-서랍모듈` : `${name}`;
                // 내부 서랍을 모듈로 낼 때는 하단보강도 그 안에 있다 — 여기서 또 내면 두 번 나온다.
                if (drawerFBW > 600 && (isExternalDrawer || !innerModRows.length)) {
                  this.add(materials, bogangModule, '서랍 하단보강', 'PB', T, extBox ? extBox.sideL : 440, 60, drawerCount, '2면(장)');
                }
              }

              // 도어 (좌대+bodyH-20 통일 — 짧은옷/긴옷 모두 동일 높이)
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                const doorH = pedestalH + bodyH - 20;
                if (isExternalDrawer && drawerCount > 0) {
                  // 2026-10-20 사장님 카드 "도어 1580": 외부 서랍 위 도어는 서랍모듈 상단~몸통 상단 (= 몸통 − 서랍모듈H). 좌대 덮기는 서랍 전면 몫이다
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, bodyH - drawerCount * DRAWER_MOD_H_LONG, doorCount, '4면', '', mod);
                  // 외부 서랍 도어 (목찬넬, 서랍수별 높이)
                  const drawerDoorW = W - 4;
                  const drawerModTotal = drawerCount * DRAWER_MOD_H_LONG + pedestalH;
                  let drawerDoorH, drawerDoorQty;
                  if (drawerCount === 1) {
                    drawerDoorH = drawerModTotal - 30 - 20;
                    drawerDoorQty = 1;
                  } else if (drawerCount === 2) {
                    // 2026-10-20 사장님: 2단은 서랍마다 위에 목찬넬 30 하나씩 (예전 30 하나 → 355, 지금 340)
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30 - 30) / 2);
                    drawerDoorQty = 2;
                  } else {
                    // 2026-10-20 사장님 카드 "4 띄움": 목찬넬 없는 위 두 전면 사이는 싱크 규칙대로 4 (FRONT_GAP)
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30 - 30 - 4) / 3);
                    drawerDoorQty = 3;
                  }
                  this.add(materials, `${name}-서랍모듈`, '서랍도어', 'MDF', 18, drawerDoorW, drawerDoorH, drawerDoorQty, '4면', '', mod);
                } else {
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, doorH, doorCount, '4면', '', mod);
                }
              }
            }

            // 2026-09-19: 내부 서랍 전면·좌우몰딩 (규칙 파일 치수). 통 이름으로 붙는다.
            innerRows.forEach((row) => {
              this.add(materials, `${name}`, row.part, row.material, row.t,
                row.w, row.h, row.qty, row.edge, row.note || '');
            });

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
            // 2026-10-20 사장님: EP 는 ㄴ자로 나눠 만든다 — 100 = 지면 40 + 전면 52 (상단), 120 = 지면 40 + 전면 72 (중간).
            //   싱크 서랍장 목찬넬과 같은 판이다 (bom-drawer-rules CHANNEL_*). 2단도 서랍마다 위에 하나씩이라 상단 + 중간.
            const CR = DrawerRules.DRAWER_RULES;
            this.add(materials, 'EP', '목찬넬(전면)', 'MDF', 18, CR.CHANNEL_TOP_FACE_H, modW, 1, '2면(장)');
            this.add(materials, 'EP', '목찬넬(지면)', 'MDF', 18, CR.CHANNEL_BASE_W, modW, 1, '2면(장)');
            if (drawerCount >= 2) {
              this.add(materials, 'EP', '목찬넬(중간 전면)', 'MDF', 18, CR.CHANNEL_MID_FACE_H, modW, 1, '2면(장)');
              this.add(materials, 'EP', '목찬넬(중간 지면)', 'MDF', 18, CR.CHANNEL_BASE_W, modW, 1, '2면(장)');
            }
          });

          // 좌대 (모듈별 본체)
          if (pedestalH > 0) {
            modules.forEach((mod, idx) => {
              this.beginModule(mod, idx, mod.pos || 'wardrobe');
              const modW = parseFloat(mod.w) || 900;
              const modD = parseFloat(mod.d) || D;
              const pName = `${prefix}${mod.name || `${idx + 1}번`}`;
              // 2026-10-13 사장님: 키큰장 단 좌대와 같은 규칙 — 앞뒤 W · 측·중간보강 D − 80 (예전 W − 30 · D − 35 · D − 65)
              this.add(materials, `${pName}-좌대`, '좌대 전후', 'PB', T, modW, pedestalH, 2, '1면(전)');
              this.add(materials, `${pName}-좌대`, '좌대 측', 'PB', T, modD - BOM_PEDESTAL_D_SETBACK, pedestalH, 2, '1면(전)');
              if (modW >= BOM_PEDESTAL_BRACE_W_MIN) {
                this.add(materials, `${pName}-좌대`, '좌대 중간보강', 'PB', T, modD - BOM_PEDESTAL_D_SETBACK, pedestalH, 1, '1면(전)');
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
              this.add(materials, `${pf}키큰장`, '천판', 'PB', T, W - T * 2, D - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
              this.add(materials, `${pf}키큰장`, '지판', 'PB', T, W - T * 2, D - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
              this.addBackPanel(materials, `${pf}키큰장`, W, H, true);
              this.add(materials, `${pf}키큰장`, '선반', 'PB', T, W - T * 2, D - ASM.SAKURI_SHELF_D_MINUS, 3, '1면(전)');
              const doorCount = mod.doorCount || 1;
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                this.add(materials, `${pf}키큰장`, '도어', 'MDF', 18, doorW, H + 20, doorCount, '4면', '', mod);
              }
            }
            // 홈카페장 (homecafe) - MDF 18T 전체 — 부재표는 규칙 파일(bom-homecafe-rules.js, fridge.md §11)
            else if (modType === 'homecafe') {
              this.addHomecafeParts(materials, `${pf}홈카페장`, mod, { W, H, D });
            }
            // 상부장 (upper) — PB 구조
            else if (modType === 'upper') {
              this.add(materials, `${pf}냉장고상부장`, '측판', 'PB', T, D, H, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${pf}냉장고상부장`, '천판', 'PB', T, W - T * 2, D - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
              this.add(materials, `${pf}냉장고상부장`, '지판', 'PB', T, W - T * 2, D - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
              this.addBackPanel(materials, `${pf}냉장고상부장`, W, H, true);
              // 2026-10-22 사장님: "냉장고장 몸통은 상부장 … 15T 이고 사쿠리 홈에 끼워서 보강목까지 붙는 형식", "냉장고 상부장에만 넣음"
              //   — 싱크 상부장과 같은 보강목 2장 (15T · 60 × W−2T, 홈 뒤 맨 뒤 위·아래). 키큰장·EL장은 없다.
              this.add(materials, `${pf}냉장고상부장`, '밴드(보강목)', 'PB', ASM.UPPER_BAND_T, W - T * 2, ASM.UPPER_BAND_W, 2, '2면(장)');
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
              this.addBackPanel(materials, `${pf}냉장고하부장`, W, H, false);
              const doorCount = mod.doorCount || 1;
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                this.add(materials, `${pf}냉장고하부장`, '도어', 'MDF', 18, doorW, H - 30, doorCount, '4면', '', mod);
              }
            }
            // EL장 (el) — PB 구조 (뒷판만)
            else if (modType === 'el') {
              this.addElParts(materials, `${pf}EL장`, { W, H, D }, T, '');
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
          // 2026-10-13 사장님 확정 — 도어·선반 기본값은 플래너와 같다 (비고는 "기본값으로 정했다"는 표시)
          const doorNote = `도어 수 미지정 → 한 장 최대 ${BOM_DOOR_W_MAX} (플래너와 같다)`;
          const sp = rules.shelfSpace || BOM_SHELF_SPACE_GENERAL;
          const shelfNote = `선반 수 미지정 → 상부 ${BOM_UPPER_SHELF_COUNT} · 그 밖 칸 간격 ${sp.min}~${sp.max} (플래너와 같다)`;

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
            this.add(materials, modLabel, '천판', 'PB', T, W - T * 2, modD - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
            this.add(materials, modLabel, '지판', 'PB', T, W - T * 2, modD - ASM.SAKURI_PANEL_D_MINUS, 1, '1면(전)');
            this.addBackPanel(materials, modLabel, W, H, true);
            this.add(materials, modLabel, '밴드(보강목)', 'PB', ASM.UPPER_BAND_T, W - T * 2, ASM.UPPER_BAND_W, 2, '2면(장)');
            const braceQty = bomBraceQtyOf(W, 'upper');
            if (braceQty > 0) this.add(materials, modLabel, '밴드(처짐방지)', 'PB', T, ASM.BRACE_W, H - T * 2, braceQty, '2면(장)');
            const shelf = bomSimpleShelfQtyOf(mod, rules);
            if (shelf.qty > 0) {
              this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - ASM.SAKURI_SHELF_D_MINUS, shelf.qty, '1면(전)', shelf.defaulted ? shelfNote : '');
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
            // 2026-10-22 사장님 카드 "싱크 규칙으로 통일": 서랍장은 전면·목찬넬·박스 모두 싱크 하부장 서랍 규칙 (drawerLayoutOf ·
            //   addDrawerModuleParts). 측판 비고(따내기)도 싱크처럼 레이아웃에서 나온다.
            const drawerLayout = isDrawer ? this.drawerLayoutOf(mod, H, T) : null;
            if (drawerLayout && drawerLayout.warnings.length) dlog(`[Drawer] ${modLabel}: ${drawerLayout.warnings.join(' / ')}`);
            // 몸통 — 위 도어 + 아래 서랍은 두 몸통 (2026-10-25, addLowerCarcassRows)
            this.addLowerCarcassRows(materials, modLabel, W, H, T, modD, drawerLayout, !!(isWoodChannel && DrawerRules));
            const shelf = bomSimpleShelfQtyOf(mod, rules);
            if (shelf.qty > 0) {
              this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - T, shelf.qty, '1면(전)', shelf.defaulted ? shelfNote : '');
            }

            if (isDrawer) {
              // 서랍장 — 싱크 하부장 서랍 규칙 그대로 (bom-drawer-rules.js): 전면 합 = H, 목찬넬 ㄴ자(중간은 모듈 부재, 상단은 EP),
              //   박스는 존에 맞는 크기. 2026-10-22 사장님 카드 "싱크 규칙으로 통일" — 예전 옛 식(서랍도어 220 피치 · 1개면 250 ·
              //   남는 높이 아래 여닫이 · 목찬넬 120×W 한 장)은 전면 합이 몸통보다 50 짧아 자리를 정할 수 없었다.
              this.addDrawerModuleParts(materials, modLabel, mod, W, T, mod.doorCount || 0, drawerLayout, modD, isWoodChannel);
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

          // 상몰딩 — 상부장이 있을 때만 (P1-2 와 같다). 키큰장 상부단 상몰딩은 그 단이 낸다.
          this.beginItemLevel('upper');
          if (moldingH >= 20 && totalUpperW > 0) {
            this.add(materials, epLabel, '상몰딩', 'MDF', 18, moldingH, totalUpperW, 1, totalUpperW > 2000 ? '2면(장)' : '4면');
          }

          // 걸레받이·목찬넬 — 다리발 위 하부 라인 폭 (키큰장 단은 좌대가 받치므로 뺀다). 하부장이 없으면 없다.
          this.beginItemLevel('lower');
          if (effectiveW > 0) {
            this.addKickBoards(materials, epLabel, bomKickWallLensOf(lineLowerModules), legH - 5);
          }
          if (isWoodChannel && effectiveW > 0) {
            this.add(materials, epLabel, '목찬넬(전면)', 'MDF', 18, 52, effectiveW, 1, '2면(장)');
            this.add(materials, epLabel, '목찬넬(지면)', 'MDF', 18, 40, effectiveW, 1, '2면(장)');
          }

          // 좌·우 마감 — 2026-10-24 사장님 D9: 도면 마감재 그대로 (addDrawnFinishes). simple-categories.md §2 의 스펙 기본(Filler 60)은 발주에 쓰지 않는다.
          this.addDrawnFinishes(materials, epLabel, item);
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
          const catNames = { sink: '싱크대', island: '아일랜드', door: '도어교체', custom: '비규격장', wardrobe: '붙박이장', fridge: '냉장고장' };
          const categoryTotals = {};
          const categoryCounts = {};
          items.forEach(item => {
            const cat = item.categoryId || item.category;
            categoryTotals[cat] = (categoryTotals[cat] || 0) + 1;
          });

          items.forEach((item, itemIdx) => {
            const category = item.categoryId || item.category;
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
            const prefix = categoryTotals[category] > 1 ? `#${categoryCounts[category]} ` : '';
            const simpleRules = BOM_SIMPLE_CATEGORY_RULES[category] || null;
            const catName = catNames[category] || (simpleRules && simpleRules.label) || category;
            const itemLabel = item.labelName || `${prefix}${catName}`;
            const beforeLen = hardware.length;
            this._itemIdx = itemIdx; // B4: 철물 행 moduleKey — 자재 행 partId 와 같은 품목 순번

            this.extractHinges(item, hardware);
            // 2026-10-20 카드 "도어만·싱크대 규칙": 도어교체는 도어 판 + 경첩만 — 레일·손잡이·다리발은 내지 않는다.
            if (category !== 'door') this.extractRest(item, hardware);

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

        /** 경첩 다음 철물 — 레일·옷봉·손잡이·다리발·브라켓·기타 (도어교체는 부르지 않는다). */
        extractRest(item, hardware) {
          this.extractRails(item, hardware);
          this.extractWardrobeRods(item, hardware);
          this.extractHandles(item, hardware);
          this.extractLegs(item, hardware);
          this.extractBrackets(item, hardware);
          this.extractOthers(item, hardware);
        }

        /**
         * 경첩 품번 — 2026-10-13 거래명세서 확인 (hardware.md §1 default_type · overlay_inset).
         *   실제로 사는 경첩은 H052W 105° 저압(슬라이드온) 하나뿐이고, 품번은 **몸통 두께**로 갈린다:
         *   15T 몸통 → H052W-5 (200개 단위로 다섯 번), 18T 몸통 → H052W-3. 인셋·반덮방 경첩은 산 적이 없다.
         */
        hingeModelOf(specs) {
          const t = parseFloat((specs || {}).bodyThickness);
          return Number.isFinite(t) && t >= 18 ? 'H052W-3' : 'H052W-5';
        }

        /**
         * 여닫이가 아닌 도어 — 경첩 대신 제 철물을 낸다 (hardware.md §1 el_lift_up · sliding_door, 2026-10-13 확정).
         *   리프트업  가변철물 1 SET/도어 — 명세서의 가변철물 小(23KG) 는 도어 폭 450~600 용이라 그 밖이면 비고에 남긴다
         *   슬라이딩  SDR-2 상·하레일 2500 1조/모듈 + 상부속·하부속 도어당 2개씩 (명세서 #089 #110)
         * 냉장고장 모듈의 doorType 값 (data-constants.js EL_DOOR_TYPES 'liftup'·'sliding', fridge.md §7 의 옛 표기 'lift'·'slide').
         * 플랩은 flapHardwareOf (경첩 + 가스쇼바), 포켓은 철물이 정해지지 않아 예전처럼 경첩으로 센다.
         */
        nonSwingHardwareOf(mod, doorCount) {
          const type = mod.doorType;
          const label = mod.name || mod.type;
          const doorW = (parseFloat(mod.w) || 0) / Math.max(1, doorCount);
          if (type === 'liftup' || type === 'lift') {
            const fits = doorW >= 450 && doorW <= 600;
            return [{
              category: '리프트업',
              item: '리프트업도어 가변철물 小(23KG)',
              manufacturer: '',
              spec: '폭 450~600',
              qty: doorCount,
              unit: 'SET',
              note: fits ? label : `${label} · 도어 폭 ${Math.round(doorW)} — 450~600 밖 [확인 필요]`,
              ...this.moduleTagOf(mod),
            }];
          }
          if (type === 'sliding' || type === 'slide') {
            const tag = this.moduleTagOf(mod);
            return [
              { category: '슬라이딩', item: 'SDR-2 상·하레일', manufacturer: '', spec: '2500mm', qty: 1, unit: '조', note: label, ...tag },
              { category: '슬라이딩', item: 'SDR-2 상부속', manufacturer: '', spec: '-', qty: doorCount * 2, unit: 'EA', note: label, ...tag },
              { category: '슬라이딩', item: 'SDR-2 하부속', manufacturer: '', spec: '-', qty: doorCount * 2, unit: 'EA', note: label, ...tag },
            ];
          }
          return null;
        }

        /**
         * 플랩(위로 여는 도어) 철물 — 2026-10-13 사장님 결정 (hardware.md §1 flap).
         *   경첩   천판 쪽에 달린다 → 개수·보링을 도어 **폭** 변으로 센다 (≤900 → 2구 · 끝 110). 품번은 여닫이와 같다.
         *          그래서 도어 최대폭 600 을 넘는 냉장고 자리 위장(615 → 도어 611)도 한 장이 된다.
         *   쇼바   도어당 양쪽 1개씩 2개. 규격은 도어 무게로 자동 — MDF 18T × 밀도 750kg/m³,
         *          쪽당 규격 ≥ 도어 무게인 것 중 가장 약한 것. 규격은 산 것만 (명세서 1·5·7·9kg).
         *          9kg 으로도 모자라면 9kg 을 내고 비고에 [확인 필요].
         * 도어 폭은 자재 행과 같은 식 — mod.doorW 가 있으면 그것, 없으면 floor(W / 도어 수) − 4.
         */
        flapHardwareOf(mod, doorCount, doorH, specs) {
          const label = mod.name || mod.type;
          const doorW = parseFloat(mod.doorW) || (Math.floor((parseFloat(mod.w) || 0) / Math.max(1, doorCount)) - 4);
          const hinges = this.getHingeCount(doorW);
          const boring = this.getBoringPositions(doorW);
          const strut = bomGasStrutFor(doorW, doorH);
          return [
            {
              category: '경첩',
              item: `${this.hingeModelOf(specs)} 105도 저압 경첩`,
              manufacturer: '문주',
              spec: `${hinges}구`,
              qty: hinges * doorCount,
              unit: 'EA',
              note: `${label} 플랩 — 천판 쪽, 도어 폭 ${doorW} 변 (보링: ${boring.join(', ')})`,
              ...this.moduleTagOf(mod),
              boring: boring.slice(),
              boringSide: 'top', // 플랩 — 보링이 도어 **폭** 변(천판 쪽)을 따라간다
            },
            {
              category: '가스쇼바',
              item: `가스쇼바 ${strut.kg}kg`,
              manufacturer: '',
              spec: strut.model,
              qty: BOM_GAS_STRUT_PER_DOOR * doorCount,
              unit: 'EA',
              note: `${label} 플랩 ${doorW}×${Math.round(doorH)} ≈ ${strut.weight.toFixed(1)}kg`
                + (strut.over ? ` — ${strut.kg}kg 로도 모자람 [확인 필요]` : ''),
              ...this.moduleTagOf(mod),
            },
          ];
        }

        /**
         * B4 (2026-10-13): 철물 행의 모듈 표시 — 이름(`module`)과 키(`moduleKey`).
         *   moduleKey 는 자재 행의 moduleKey(= partId 의 `${itemIdx}-${moduleId}`)와 같은 규칙이다. 모듈 id 가 없으면
         *   자재 쪽 폴백(`${pos}-${idx}`)을 여기서 똑같이 만들 수 없어 키를 싣지 않는다 — 작업지시서는 이름으로 맞춘다.
         */
        moduleTagOf(mod) {
          const tag = { module: (mod && (mod.name || mod.type)) || '' };
          if (mod && mod.id !== undefined && mod.id !== null && String(mod.id) !== '') {
            tag.moduleKey = `${this._itemIdx | 0}-${mod.id}`;
          }
          return tag;
        }

        // 경첩 수 계산 — bom-protocol.md §4-1 · ACTIVE_RULES.md §9.1: ≤900 → 2구, 901~1600 → 3구, 1601+ → 4구.
        //   문턱은 **재단 도어 높이**(자재 행의 h) 기준이다 — 몸통 H 가 아니다.
        getHingeCount(doorH) {
          if (doorH <= 900) return 2;
          if (doorH <= 1600) return 3;
          return 4;
        }

        /** 개수가 정해진 경첩의 보링 — 끝 110, 가운데는 균등 분배 (폭 +1 로 개수가 늘어난 도어용). */
        boringFor(len, count) {
          // 2·3·4구는 getBoringPositions 와 같은 식, 5구부터 끝 110 사이 균등
          if (count <= 2) return [110, len - 110];
          if (count === 3) return [110, Math.round(len / 2), len - 110];
          if (count === 4) return [110, Math.round(len / 3), Math.round((len * 2) / 3), len - 110];
          const span = len - 220;
          return Array.from({ length: count }, (_, i) => Math.round(110 + (span * i) / (count - 1)));
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
            // 2026-10-18: 서랍장 전면은 마이다 — 보링 없음 (bomIsMaidaModule)
            if (bomIsMaidaModule(mod)) return;
            let doorCount = mod.doorCount || 0;
            let simpleDoorH = null;
            // 2026-10-20: 밥솥장 — 도어 수·높이는 자재 행과 같은 규칙 파일 doorOf (카테고리 규칙을 타지 않는다)
            const riceDoor = (RiceRules && RiceRules.isRiceCabinet(mod))
              ? (RiceRules.doorOf({ W: mod.w, H: mod.h }, mod.doorType || 'none') || { qty: 0 }) : null;
            if (riceDoor) doorCount = riceDoor.qty;
            // 2026-10-20: 플래너 홈카페장 모듈 타입 — 자재 행과 같은 규칙 파일 doorOf (H + 20, 수 없으면 1)
            const hcDoor = (!riceDoor && HomecafeRules && String(mod.moduleKind || '') === HomecafeRules.RULES.KIND)
              ? HomecafeRules.doorOf({ W: mod.w, H: mod.h }, mod.doorCount) : null;
            // B4: 붙박이장 통 · 냉장고장 모듈은 자재 도어 행과 같은 수·높이
            const wardrobeDoor = riceDoor ? null
              : hcDoor ? { count: hcDoor.qty, h: hcDoor.h }
              : (bomWardrobeDoorOf(item, mod) || bomFridgeDoorOf(item, mod));
            if (wardrobeDoor) doorCount = wardrobeDoor.count;
            if (!riceDoor && !hcDoor && simpleRules && (mod.pos === 'upper' || mod.pos === 'lower')) {
              const d = bomSimpleHingeDoorsOf(mod, specs);
              doorCount = d.count;
              simpleDoorH = d.doorH;
            }
            if (doorCount === 0) return;

            const special = this.nonSwingHardwareOf(mod, doorCount);
            if (special) { special.forEach((row) => hardware.push(row)); return; }

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
            if (riceDoor) doorH = riceDoor.h;
            if (wardrobeDoor) doorH = wardrobeDoor.h;

            // 2026-10-13: 위로 여는 도어(플랩) — 경첩이 천판 쪽에 달려 도어 **폭** 변을 따라 보링하고 가스쇼바 2 가 붙는다
            if (mod.doorOpen === 'up' || mod.doorType === 'flap') {
              this.flapHardwareOf(mod, doorCount, doorH, specs).forEach((row) => hardware.push(row));
              return;
            }

            // 2026-10-13 사장님: 여닫이 도어 폭이 600 을 넘으면 경첩 1개 더 (보링 끝 110 은 그대로 — 가운데를 균등 분배)
            const swingDoorW = parseFloat(mod.doorW) || (Math.floor((parseFloat(mod.w) || 0) / Math.max(1, doorCount)) - 4);
            const hingesPerDoor = this.getHingeCount(doorH) + (swingDoorW > BOM_HINGE_WIDE_DOOR_W ? 1 : 0);
            const boring = this.boringFor(doorH, hingesPerDoor);
            // 끝 110 규칙은 짧은 도어에서 컵 간격이 무너진다 (서랍 위 244 도어 → 110 · 134). 값은 규칙대로 두고 알린다.
            const gap = boring.length >= 2 ? Math.min(...boring.slice(1).map((v, i) => v - boring[i])) : Infinity;
            const shortNote = gap < BOM_HINGE_MIN_GAP ? ` [확인 필요] 도어 H ${Math.round(doorH)} — 컵 간격 ${gap}` : '';

            hardware.push({
              category: '경첩',
              item: `${this.hingeModelOf(specs)} 105도 저압 경첩`,
              manufacturer: '문주',
              spec: `${hingesPerDoor}구`,
              qty: hingesPerDoor * doorCount,
              unit: 'EA',
              note: `${mod.name || mod.type} (보링: ${boring.join(', ')})${shortNote}`,
              // B4: 구조화 — 작업지시서가 비고 글자를 파싱하지 않아도 된다 (도어 상단 기준 mm)
              ...this.moduleTagOf(mod),
              boring: boring.slice(),
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
          // 2026-10-25 사장님: 밥솥장 슬라이딩 선반 — 문주 언더레일 1 SET (모듈 타입이라 카테고리와 무관)
          if (RiceRules) {
            (item.modules || []).filter((m) => RiceRules.isRiceCabinet(m)).forEach((mod) => {
              hardware.push({
                category: '레일',
                item: '문주 언더레일',
                manufacturer: '문주',
                spec: `${bomRiceRailLengthOf(mod)}mm`,
                qty: 1,
                unit: 'SET',
                note: `${mod.name || '밥솥장'} 슬라이딩 선반`,
                ...this.moduleTagOf(mod),
              });
            });
          }

          // 붙박이장: 모듈별 drawerCount 기준
          if (category === 'wardrobe') {
            (item.modules || []).forEach((mod) => {
              const drawerCount = mod.drawerCount || 0;
              if (drawerCount <= 0) return;
              // 2026-10-20 사장님 카드 "싱크 규칙": 외부 서랍은 깊이 − 50 이하 최대 규격 (railLengthFor, 깊이 600 → 500). 내부 서랍은 그대로 450.
              //   박스 측판과 같은 값 (drawerBoxDims.railLength — 깊이가 모자라면 가장 짧은 규격).
              const extRail = mod.isExternalDrawer
                ? DrawerRules.drawerBoxDims({ W: parseFloat(mod.w) || 900, D: parseFloat(mod.d) || parseFloat(item.d) || WR_DEFAULTS.DEFAULT_D, rail: 'under' }).railLength
                : null;
              hardware.push({
                category: '레일',
                item: '문주 언더레일',
                manufacturer: '문주',
                spec: `${extRail || 450}mm`,
                qty: drawerCount,
                unit: 'SET',
                note: mod.name || mod.type,
                ...this.moduleTagOf(mod),
              });
            });
            return;
          }

          // B3: 단순 카테고리 — 자재 행(extractSimpleBox)과 같은 깊이 폴백으로 레일 길이를 정하고, 서랍 **개수**만큼 센다.
          //   (아래 기타 경로는 모듈당 1 SET 로 과소 — 싱크는 골든에 묶여 있어 그대로 두고(계획 B2), 새 카테고리만 맞춘다)
          const simpleRules = BOM_SIMPLE_CATEGORY_RULES[category];
          if (simpleRules) {
            (item.modules || []).forEach((mod) => {
              // 2026-10-24: 키큰장 맨 아래 단 서랍은 센다 (bomTallDrawerTier — 자재 행이 박스를 낸다). 다른 단은 서랍이 없다
              if (!mod.isDrawer || mod.pos !== 'lower' || (bomTallTierOf(mod) && !bomTallDrawerTier(mod))) return;
              const depth = bomSimpleDepthOf(mod, 'lower', item, simpleRules);
              hardware.push({
                category: '레일',
                item: '소프트클로즈 서랍레일',
                manufacturer: '블룸',
                spec: `${bomSimpleRailLenOf(depth)}mm`,
                qty: mod.drawerCount || 1,
                unit: 'SET',
                note: mod.name || mod.type,
                ...this.moduleTagOf(mod),
              });
            });
            return;
          }

          // 기타 카테고리 — 2026-09-15: 레일은 단수만큼, 종류는 mod.drawer.rail (댐핑 언더레일 기본 · 댐핑 볼레일)
          (item.modules || []).forEach((mod) => {
            if (!mod.isDrawer) return;
            // 2026-10-24: 키큰장 단은 맨 아래 단 서랍만 (bomTallDrawerTier — 자재 행이 박스를 내는 단). 중간 · 상부 단 서랍은 규칙이 없어 박스도 레일도 없다
            if (bomTallTierOf(mod) && !bomTallDrawerTier(mod)) return;
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
              ...this.moduleTagOf(mod),
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
          // B3: 단순 카테고리도 다리발 150 위에 선다 (simple-categories.md §2). 키큰장 단은 좌대가 받치므로 뺀다.
          //   2026-10-24: 싱크 · 아일랜드 · 비규격장도 같다 — sink.md §5 "키큰장은 하부장이 아니다, 다리발 대신 좌대(60)".
          //   예전엔 싱크만 골든에 묶여 키큰장 단도 세는 옛 셈이 남아, 조립 명세의 단마다 다리발 자리가 보류(leg-tall-tier)였다.
          const simple = !!BOM_SIMPLE_CATEGORY_RULES[category];
          // 2026-10-20: 아일랜드도 다리발 150 (sink.md §1 표). 비규격장은 싱크대 규칙 (2026-10-20 카드).
          if (category !== 'sink' && category !== 'island' && category !== 'custom' && !simple) return;
          const specs = item.specs || {};
          const legH = specs.sinkLegHeight || 150;
          let totalLegs = 0;

          (item.modules || [])
            .filter((m) => m.pos === 'lower' && !bomTallTierOf(m))
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
        /**
         * 같은 품목의 자재 행 — 철물 중 자재에서 세는 것(선반 핀 · 걸레받이카바)이 자재 표와 갈라지지 않게
         * 자재 추출을 한 번 돌려 읽는다 (품목마다 한 번, 캐시).
         */
        materialRowsOf(item) {
          if (!this._matCache) this._matCache = new WeakMap();
          if (!this._matCache.has(item)) {
            const rows = new MaterialExtractor().extract({ items: [item] }).materials || [];
            this._matCache.set(item, rows);
          }
          return this._matCache.get(item);
        }

        extractBrackets(item, hardware) {
          // 2026-10-13 사장님: 선반 핀은 **자재 선반 수 × 4** — 자재 표의 '선반' 행 수량을 그대로 센다.
          //   (예전엔 철물이 따로 셌다: 상부 2 · 하부 1 — 키큰장·붙박이장·냉장고장 선반은 빠졌다)
          const shelfCount = this.materialRowsOf(item)
            .filter((r) => r.part === '선반')
            .reduce((n, r) => n + (Number(r.qty) || 0), 0);

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

          // 2026-10-13 사장님: 걸레받이카바(18T 투명) — 한 개 2400mm, 걸레받이 전체 길이로 센다.
          //   자재 표의 '걸레받이'·'좌대 걸레받이' 행의 긴 변 × 수량 합 ÷ 2400 올림.
          //   2026-10-20: 걸레받이는 벽마다 나뉜다(addKickBoards) — 길이는 w 다. 나머지 조각(예 47)이 높이 145 보다
          //   짧아도 긴 변(145)으로 세면 전체 길이가 늘어 카바 개수가 바뀐다. 좌대 걸레받이는 행마다 놓는 방향이 달라 긴 변 그대로.
          const kickLen = this.materialRowsOf(item)
            .filter((r) => r.part === '걸레받이' || r.part === '좌대 걸레받이')
            .reduce((n, r) => n + (r.part === '걸레받이'
              ? Number(r.w) || 0
              : Math.max(Number(r.w) || 0, Number(r.h) || 0)) * (Number(r.qty) || 0), 0);
          if (kickLen > 0) {
            hardware.push({
              category: '걸레받이카바',
              item: '걸레받이카바(18T) 투명',
              manufacturer: '-',
              spec: `${BOM_KICK_COVER_LEN}mm`,
              qty: Math.ceil(kickLen / BOM_KICK_COVER_LEN),
              unit: 'EA',
              note: `걸레받이 ${Math.round(kickLen)}mm ÷ ${BOM_KICK_COVER_LEN}`,
            });
          }
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
      // 2026-10-23: 추출기를 window 에 올린다. `class` 선언은 고전 스크립트 최상위여도 window 속성이 되지 않는다 —
      //   그래서 플래너 iframe 이 부모 창 추출기를 찾는 길(planner-export.js plannerExportCadSpec: CAD GLB · 조립 검사 배지)과
      //   브라우저의 조립 명세(bom-assembly.js root.MaterialExtractor — 서랍장 레이아웃 · 철물 자리)가 추출기를 못 찾았다.
      if (typeof window !== 'undefined') {
        window.MaterialExtractor = MaterialExtractor;
        window.HardwareExtractor = HardwareExtractor;
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
          // 2026-10-13 플랩 가스쇼바 — 규격표·자동 선택
          BOM_GAS_STRUTS, bomGasStrutFor,
          // 2026-10-18 사전 오류 검사(bom-preflight.js)가 컵 간격 문턱을 여기서 읽는다
          BOM_HINGE_MIN_GAP,
          // 2026-10-20 걸레받이 꺾임에서 나누기
          bomKickWallLensOf, bomKickPiecesOf,
          // 2026-10-26 상몰딩은 같은 벽 상부장 사이 빈 자리도 건너 한 장 · 벽마다 한 장 · 깊이가 같은 키큰장은 이어서
          bomSinkMoldingLenOf, bomSinkMoldingPlanOf,
        };
      }

