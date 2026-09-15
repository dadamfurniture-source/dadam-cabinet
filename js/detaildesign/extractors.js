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
            const catNames = { sink: '싱크대', wardrobe: '붙박이장', fridge: '냉장고장' };
            const itemLabel = item.labelName || `${prefix}${catNames[category] || category}`;
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
          return DrawerRules.layoutDrawerModule({ H, T, fronts, rail: mod.drawerRail });
        }

        /** 2026-09-15: 서랍장 부재 — 전면(도어·서랍도어), 박스(크기별 묶음), 밑판, 하단보강, 중간 목찬넬. */
        addDrawerModuleParts(materials, modLabel, mod, W, T, doorCount, L) {
          const R = DrawerRules.DRAWER_RULES;
          // 전면 — 위에서 아래로. 도어는 doorCount 장이 가로로 나뉜다. 같은 높이의 서랍도어는 한 행(수량)으로 묶는다.
          const drawerFrontRows = [];
          L.fronts.forEach((f) => {
            if (f.h <= 0) return;
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
          // 박스 — 같은 크기끼리 묶는다 (전후판·측판은 서랍당 2장)
          const fbW = W - R.BOX_FB_W_MINUS;
          const groups = [];
          L.boxes.forEach((b) => {
            let g = groups.find((x) => x.size === b.size);
            if (!g) { g = { size: b.size, h: b.h, count: 0, fits: true }; groups.push(g); }
            g.count += 1;
            if (!b.fits) g.fits = false;
          });
          groups.forEach((g) => {
            const note = `${R.BOX_LABEL[g.size]} 박스${g.fits ? '' : ' (레일 여유 부족)'}`;
            this.add(materials, modLabel, '서랍전후판', 'PB', T, fbW, g.h, g.count * 2, '1면(장)', note);
            this.add(materials, modLabel, '서랍측판', 'PB', T, R.BOX_LEN, g.h, g.count * 2, '1면(장)', note);
          });
          const n = L.boxes.length;
          if (n > 0) {
            this.add(materials, modLabel, '서랍밑판', 'MDF', 2.7, W - R.BOX_BOTTOM_W_MINUS, R.BOX_BOTTOM_D, n, '-');
            if (fbW > R.BOX_BRACE_OVER_W) {
              this.add(materials, modLabel, '서랍 하단보강', 'PB', T, R.BOX_LEN, 60, n, '2면(장)');
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
              const blindDoorW = (parseFloat(mod.doorW) || W) - 4;
              this.add(materials, modLabel, '도어', 'MDF', 18, blindDoorW, H + overlap, mod.doorCount || 1, '4면', '멍장 도어(도어폭 기준)', mod);
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
              const blindDoorW = (parseFloat(mod.doorW) || W) - 4;
              this.add(materials, modLabel, '도어', 'MDF', 18, blindDoorW, H - 30, mod.doorCount || 1, '4면', '멍장 도어(도어폭 기준)', mod);
              this.addBlindFrontParts(materials, modLabel, mod, H);
            } else if (isDrawer) {
              // ★ 2026-09-15: 서랍장 — 규칙은 bom-drawer-rules.js (도면 "서랍장 목찬넬 구조 도면").
              //   전면(위→아래): doorCount>0 이면 [도어, 서랍×n] — 플래너 doorTopDrawerBottom 과 같은 그림.
              //   예전엔 서랍을 위에 220 피치로 쌓고 남는 높이를 여닫이 도어로 냈다 — 2단부터 몸통이 안 맞았다
              //   (전면 합 H−50, 3단은 68 짜리 도어, 4단은 몸통 초과). 지금은 전면 합 = H 로 닫힌다.
              //   서랍 박스는 존(위·아래 따내기 사이)에 레일 여유를 빼고 들어가는 가장 큰 크기(대·중·소).
              //   목찬넬은 전면과 1:1 이 아니라 최소 수 — 중간 목찬넬만 모듈 부재(전면판 72·지면판 40 × W).
              //   상단 목찬넬은 그대로 EP(effectiveW 연속).
              this.addDrawerModuleParts(materials, modLabel, mod, W, T, doorCount, drawerLayout);
            } else if (doorCount > 0) {
              const doorW = Math.floor(W / doorCount) - 4;
              this.add(materials, modLabel, '도어', 'MDF', 18, doorW, H - 30, doorCount, '4면', '', mod);
            }
          });

          // ===== EP (마감재) =====
          const epLabel = `${prefix}EP`;
          const totalLowerW = lowerModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
          const totalUpperW = upperModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
          const effectiveW = totalLowerW || item.w - 120;
          const moldingH = parseFloat(specs.moldingH) || 60;
          const lowerH = (specs.lowerH || 870) - legH;
          const totalH = parseFloat(item.h) || 2310;

          // 상몰딩 (moldingH >= 20이면 산출) — 상부 라인 위에 얹히므로 섹션 'upper'
          this.beginItemLevel('upper');
          if (moldingH >= 20 && (totalUpperW || effectiveW) > 0) {
            const moldingW = totalUpperW || effectiveW;
            const moldingEdge = moldingW > 2000 ? '2면(장)' : '4면';
            this.add(materials, epLabel, '상몰딩', 'MDF', 18, moldingH, moldingW, 1, moldingEdge);
          }

          // 걸레받이 — 여기부터 하부 라인 마감
          this.beginItemLevel('lower');
          this.add(materials, epLabel, '걸레받이', 'MDF', 18, effectiveW, legH - 5, 1, '2면(장)');

          // 목찬넬
          if (isWoodChannel) {
            this.add(materials, epLabel, '목찬넬(전면)', 'MDF', 18, 52, effectiveW, 1, '2면(장)');
            this.add(materials, epLabel, '목찬넬(지면)', 'MDF', 18, 40, effectiveW, 1, '2면(장)');
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
          const D = parseFloat(item.d) || 600;
          const pedestalH = parseFloat(specs.wardrobePedestal) || 60;
          const moldingH = parseFloat(specs.wardrobeMoldingH) || 15;
          const totalH = parseFloat(item.h) || 2310;
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
              const shelfUpper = mod.shelfCountUpper || 0;
              if (shelfUpper > 0) {
                this.add(materials, `${name}-상부장`, '선반', 'PB', T, W - T * 2, modD - 18 - 70, shelfUpper, '1면(전)');
              }

              // --- 하부장 ---
              this.add(materials, `${name}-하부장`, '측판', 'PB', T, modD, lowerH, 2, '3면');
              this.add(materials, `${name}-하부장`, '천판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
              this.add(materials, `${name}-하부장`, '지판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
              this.add(materials, `${name}-하부장`, '뒷판', 'MDF', 2.7, W - T * 2, lowerH - T, 1, '-');
              const shelfLower = mod.shelfCountLower || 0;
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

              const shelfCount = mod.shelfCount || 1;
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

          // 상몰딩 (60 이상만 산출, 미만은 무몰딩)
          if (moldingH >= 60 && totalW > 0) {
            this.add(materials, 'EP', '상몰딩', 'MDF', 18, moldingH, EP_H, epQty(totalW), '2면(장)');
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

          // 품목 라벨 생성 (MaterialExtractor와 동일 로직)
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
            const itemLabel = item.labelName || `${prefix}${catNames[category] || category}`;
            const beforeLen = hardware.length;

            this.extractHinges(item, hardware);
            this.extractRails(item, hardware);
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

        // 경첩 수 계산
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
          (item.modules || []).forEach((mod) => {
            const doorCount = mod.doorCount || 0;
            if (doorCount === 0) return;

            let doorH;
            const upperOverlap = parseFloat(specs.upperDoorOverlap) || 15;
            if (mod.pos === 'upper') doorH = (mod.h || specs.upperH - upperOverlap) + upperOverlap;
            else if (mod.pos === 'lower') doorH = (mod.h || (specs.lowerH || 870) - (parseFloat(specs.topThickness) || 12) - (parseFloat(specs.sinkLegHeight) || 150)) - 30;
            else doorH = mod.h || 700;

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

          // 기타 카테고리 — 2026-09-15: 레일은 단수만큼, 종류는 mod.drawerRail (댐핑 언더레일 기본 · 댐핑 볼레일)
          (item.modules || []).forEach((mod) => {
            if (!mod.isDrawer) return;
            const depth = mod.d || 550;
            let railLength = 500;
            if (depth <= 350) railLength = 350;
            else if (depth <= 450) railLength = 450;
            const R = DrawerRules ? DrawerRules.DRAWER_RULES : null;
            const railKey = DrawerRules ? DrawerRules.railKeyOf(mod.drawerRail) : 'under';
            const railName = R ? R.RAIL_CLEARANCE[railKey].name : '소프트클로즈 서랍레일';
            const maxN = R ? R.MAX_COUNT : 4;
            const qty = Math.min(maxN, Math.max(1, parseInt(mod.drawerCount, 10) || 1));

            hardware.push({
              category: '레일',
              item: railName,
              manufacturer: '블룸',
              spec: `${railLength}mm`,
              qty,
              unit: 'SET',
              note: mod.name || mod.type,
            });
          });
        }

        // 손잡이 추출
        extractHandles(item, hardware) {
          const specs = item.specs || {};
          const category = item.categoryId || item.category;
          let totalDoors = 0;

          (item.modules || []).forEach((mod) => {
            totalDoors += mod.doorCount || 0;
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
          if (category !== 'sink') return;
          const specs = item.specs || {};
          const legH = specs.sinkLegHeight || 150;
          let totalLegs = 0;

          (item.modules || [])
            .filter((m) => m.pos === 'lower')
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
          (item.modules || []).forEach((mod) => {
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
        };
      }

