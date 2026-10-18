/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require, window, BOM_HINGE_MIN_GAP */
/**
 * 사전 오류 검사 (preflight) — 동결·재단 전에 BOM 의 모순을 잡는다.
 *
 * ArchiWood REA 1번 (2026-10-18, rea-archiwood/rea-plan.html §6). "부재 누락·불가능 보링·엣지 문제" 를
 * 공장에 넘기기 전에 알린다. 규칙을 **새로 정하지 않는다** — 추출기(extractors.js)·네스팅 엔진(nesting-engine.js)이
 * 낸 행끼리 서로 맞는지만 본다. 숫자는 정본에서 받는다:
 *   - 원판 초과      NestingEngine.plan 의 unallocated (원판 규격·트림·결 회전은 엔진이 정본)
 *   - 경첩 컵 간격    extractors.js BOM_HINGE_MIN_GAP
 *   - 도어 엣지 4면   bom-protocol.md §7 CSV 예 · 골든 전부 (도어·서랍도어 = 4면, 1mm)
 *
 * 입력: materials = MaterialExtractor.extract().materials (행 배열)
 *       hardware  = HardwareExtractor.extract() 결과 또는 그 .hardware 배열
 *       opts.cutPlan = 이미 계산한 NestingEngine.plan 결과 (없으면 여기서 계산, 엔진도 없으면 원판 검사 생략)
 *       opts.hingeMinGap = 컵 간격 문턱 (없으면 extractors 전역/모듈에서 읽는다)
 * 출력: { version, ok, counts: {error, warning, info}, issues: [{code, level, message, partId?, moduleKey?, module?, part?}] }
 *       ok = error 0. 같은 입력이면 같은 출력(결정적).
 *
 * 검사 목록 (code → 수준):
 *   dim-invalid        error    가로·세로·두께·수량이 양수가 아님
 *   dup-partid         error    partId 가 두 행 이상
 *   oversize           error    원판에 놓을 수 없는 몸통·뒷판·도어 부재 (cutPlan.unallocated)
 *   long-part          info     원판보다 긴 상판·걸레받이·몰딩 등 — 이음·별도 발주 확인
 *   hinge-no-door      error    경첩·쇼바 행의 모듈에 도어 행이 없음
 *   hinge-out-of-door  error    보링 컵 위치가 도어 밖 (≤0 또는 ≥ 도어 높이, 플랩은 폭)
 *   body-incomplete    warning  측판이 있는 모듈에 지판·뒷판이 없음 / 도어가 있는데 측판이 없음
 *   door-no-hinge      warning  여닫이 도어 모듈에 여는 철물이 없음 (서랍장 = 마이다 는 뺀다)
 *   hinge-gap          warning  경첩 컵 사이가 문턱보다 가까움
 *   door-edge          warning  도어·서랍도어 엣지가 4면이 아님
 *   small-part         info     한 변 ≤ 소부품 문턱 — 원판 배치에서 빠지고 잔재에서 따로 재단
 *   unkeyed            info     moduleKey 가 없는 옛 행 — 도어·경첩 대조를 건너뜀
 *
 * 전역 스크립트(detaildesign.html → window.BomPreflight) + CommonJS 이중 노출(Jest). nesting-engine.js 와 같은 방식.
 */
(function () {
  'use strict';

  const VERSION = 1;
  const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };
  /** 도어를 여는 철물 — extractors.js extractHinges · nonSwingHardwareOf · flapHardwareOf 가 내는 분류 */
  const OPENING_CATEGORIES = ['경첩', '가스쇼바', '리프트업', '슬라이딩'];
  /** 보링 위치가 있는 철물 */
  const BORING_CATEGORIES = ['경첩'];
  const DOOR_SLOTS = ['door', 'drawerFront'];
  /** 원판에서 한 장으로 재단하는 슬롯 — 여기 부재가 원판에 안 들어가면 오류 (bom-protocol.md §7-1 슬롯) */
  const SHEET_SLOTS = ['body', 'back', 'door', 'drawerFront'];

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function positive(v) {
    const n = num(v);
    return Number.isFinite(n) && n > 0;
  }

  /** partId 에서 모듈 키 뒤의 partKey (끝 `-n` 을 뗀다). moduleKey 가 없으면 null. */
  function partKeyOf(m) {
    if (!m || !m.partId || !m.moduleKey) return null;
    const id = String(m.partId);
    const head = String(m.moduleKey) + '-';
    if (id.indexOf(head) !== 0) return null;
    return id.slice(head.length).replace(/-\d+$/, '');
  }

  function isEpModule(moduleKey) {
    return /-ep$/.test(String(moduleKey || ''));
  }

  function hardwareRowsOf(hardware) {
    if (Array.isArray(hardware)) return hardware;
    if (hardware && Array.isArray(hardware.hardware)) return hardware.hardware;
    return [];
  }

  function resolveNesting() {
    if (typeof window !== 'undefined' && window.NestingEngine) return window.NestingEngine;
    if (typeof module !== 'undefined' && typeof require === 'function') {
      try {
        return require('./nesting-engine.js');
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function resolveHingeMinGap(opts) {
    if (positive(opts.hingeMinGap)) return num(opts.hingeMinGap);
    // 브라우저: extractors.js 의 최상위 const 는 스크립트 전역 바인딩이다 (window 속성은 아니다)
    if (typeof BOM_HINGE_MIN_GAP !== 'undefined' && positive(BOM_HINGE_MIN_GAP))
      return num(BOM_HINGE_MIN_GAP);
    if (typeof module !== 'undefined' && typeof require === 'function') {
      try {
        const ex = require('./extractors.js');
        if (ex && positive(ex.BOM_HINGE_MIN_GAP)) return num(ex.BOM_HINGE_MIN_GAP);
      } catch (e) {
        /* 전역 dlog 가 없는 환경 등 — 아래로 */
      }
    }
    return null;
  }

  function label(m) {
    return [m.module, m.part].filter(Boolean).join(' · ') || m.partId || '(이름 없음)';
  }

  /**
   * @param {Array} materials
   * @param {Array|{hardware:Array}} hardware
   * @param {{cutPlan?:object, hingeMinGap?:number}} [opts]
   */
  function check(materials, hardware, opts) {
    opts = opts || {};
    const rows = Array.isArray(materials) ? materials : [];
    const hw = hardwareRowsOf(hardware);
    const issues = [];
    const push = (level, code, message, extra) =>
      issues.push(Object.assign({ level, code, message }, extra || {}));

    // ── 행 단위: 치수 · partId ──
    const valid = [];
    const seenId = new Map();
    rows.forEach((m, i) => {
      const bad = ['w', 'h', 'thickness', 'qty'].filter((k) => !positive(m[k]));
      if (bad.length) {
        push(
          'error',
          'dim-invalid',
          `${label(m)}: ${bad.map((k) => `${k}=${m[k] === undefined ? '없음' : m[k]}`).join(', ')} — 양수가 아닙니다`,
          { partId: m.partId || `row-${i}`, moduleKey: m.moduleKey, module: m.module, part: m.part }
        );
      } else {
        valid.push(m);
      }
      if (m.partId) {
        if (seenId.has(m.partId)) {
          push(
            'error',
            'dup-partid',
            `partId ${m.partId} 가 두 행에 있습니다 (${label(rows[seenId.get(m.partId)])} / ${label(m)})`,
            { partId: m.partId, moduleKey: m.moduleKey }
          );
        } else {
          seenId.set(m.partId, i);
        }
      }
      if (DOOR_SLOTS.indexOf(m.slot) >= 0 && m.edges && typeof m.edges === 'object') {
        const missing = ['L', 'R', 'T', 'B'].filter((s) => !m.edges[s]);
        if (missing.length) {
          push(
            'warning',
            'door-edge',
            `${label(m)}: 엣지가 4면이 아닙니다 (빠진 변 ${missing.join('·')})`,
            { partId: m.partId, moduleKey: m.moduleKey, module: m.module, part: m.part }
          );
        }
      }
    });

    // ── 원판 초과 · 소부품 (네스팅 엔진 정본) ──
    let cutPlan = opts.cutPlan || null;
    if (!cutPlan) {
      const NE = resolveNesting();
      if (NE && typeof NE.plan === 'function') {
        try {
          cutPlan = NE.plan(valid);
        } catch (e) {
          cutPlan = null;
        }
      }
    }
    if (cutPlan) {
      const byId = new Map();
      rows.forEach((m) => {
        if (m.partId) byId.set(m.partId, m);
      });
      (cutPlan.unallocated || []).forEach((u) => {
        const base = String((u.partIds || [])[0] || '').replace(/#\d+$/, '');
        const row = byId.get(base);
        const what = `${(u.parts || []).join(', ') || '부재'} ${u.w}×${u.h} (${u.material} ${u.thickness}T) ${u.qty}장`;
        const extra = { partIds: (u.partIds || []).slice() };
        if (row && row.moduleKey)
          Object.assign(extra, { moduleKey: row.moduleKey, module: row.module });
        // 몸통·뒷판·도어는 원판에서 한 장으로 재단한다. 상판·걸레받이·몰딩 같은 긴 부재는 이음·별도 발주가 있어 알리기만 한다.
        if (row && SHEET_SLOTS.indexOf(row.slot) < 0) {
          push(
            'info',
            'long-part',
            `${what} — 원판보다 깁니다. 이음 또는 별도 발주인지 확인하세요`,
            extra
          );
        } else {
          push('error', 'oversize', `${what} — 원판에 놓을 수 없습니다`, extra);
        }
      });
      (cutPlan.smallParts || []).forEach((s) => {
        push(
          'info',
          'small-part',
          `${s.part} ${s.w}×${s.h} ×${s.qty} — 소부품이라 재단 배치에서 빠집니다 (잔재에서 따로 재단)`,
          { partId: s.partId }
        );
      });
    }

    // ── 모듈 단위: 부재 구성 · 도어 ↔ 여는 철물 ──
    const mods = new Map();
    let unkeyedRows = 0;
    rows.forEach((m) => {
      if (!m.moduleKey) {
        unkeyedRows++;
        return;
      }
      if (isEpModule(m.moduleKey)) return;
      let mod = mods.get(m.moduleKey);
      if (!mod) {
        mod = { key: m.moduleKey, name: m.module, keys: new Set(), doors: [], drawerFronts: 0 };
        mods.set(m.moduleKey, mod);
      }
      const pk = partKeyOf(m);
      if (pk) mod.keys.add(pk);
      if (m.slot === 'door') mod.doors.push(m);
      if (m.slot === 'drawerFront') mod.drawerFronts++;
    });

    mods.forEach((mod) => {
      const has = (k) => mod.keys.has(k);
      if (has('body:side')) {
        const miss = [
          ['body:bottom', '지판'],
          ['back', '뒷판'],
        ]
          .filter(([k]) => !has(k))
          .map(([, n]) => n);
        if (miss.length) {
          push(
            'warning',
            'body-incomplete',
            `${mod.name}: 측판은 있는데 ${miss.join('·')}이 없습니다`,
            { moduleKey: mod.key, module: mod.name }
          );
        }
      } else if (mod.doors.length || mod.drawerFronts) {
        push('warning', 'body-incomplete', `${mod.name}: 도어가 있는데 몸통 측판이 없습니다`, {
          moduleKey: mod.key,
          module: mod.name,
        });
      }
    });

    const opening = hw.filter((h) => OPENING_CATEGORIES.indexOf(h.category) >= 0);
    const unkeyedHw = opening.filter((h) => !h.moduleKey).length;
    const openingByKey = new Map();
    opening.forEach((h) => {
      if (!h.moduleKey) return;
      if (!openingByKey.has(h.moduleKey)) openingByKey.set(h.moduleKey, []);
      openingByKey.get(h.moduleKey).push(h);
    });

    const hingeMinGap = resolveHingeMinGap(opts);
    openingByKey.forEach((list, key) => {
      const mod = mods.get(key);
      const doors = mod ? mod.doors : [];
      const name = (mod && mod.name) || list[0].module || key;
      if (!doors.length) {
        push(
          'error',
          'hinge-no-door',
          `${name}: ${list.map((h) => h.category).join('·')} 행이 있는데 도어 자재 행이 없습니다`,
          { moduleKey: key, module: name }
        );
        return;
      }
      list
        .filter((h) => BORING_CATEGORIES.indexOf(h.category) >= 0 && Array.isArray(h.boring))
        .forEach((h) => {
          const alongWidth = h.boringSide === 'top';
          const limit = Math.max.apply(
            null,
            doors.map((d) => num(alongWidth ? d.w : d.h)).filter(Number.isFinite)
          );
          const cups = h.boring.map(num);
          const outside = cups.filter((c) => !Number.isFinite(c) || c <= 0 || c >= limit);
          if (outside.length) {
            push(
              'error',
              'hinge-out-of-door',
              `${name}: 경첩 보링 ${outside.join(', ')} 이 도어 ${alongWidth ? '폭' : '높이'} ${limit} 밖입니다`,
              { moduleKey: key, module: name }
            );
          }
          if (hingeMinGap !== null && cups.length >= 2) {
            const sorted = cups.filter(Number.isFinite).sort((a, b) => a - b);
            const gap = Math.min.apply(
              null,
              sorted.slice(1).map((v, i) => v - sorted[i])
            );
            if (gap < hingeMinGap) {
              push(
                'warning',
                'hinge-gap',
                `${name}: 경첩 컵 간격 ${gap} — ${hingeMinGap} 보다 가깝습니다 (보링 ${cups.join(', ')})`,
                { moduleKey: key, module: name }
              );
            }
          }
        });
    });

    if (!unkeyedHw) {
      mods.forEach((mod) => {
        if (!mod.doors.length || openingByKey.has(mod.key)) return;
        // 서랍장 모듈 전면은 전부 마이다 — 경첩·보링 없음 (2026-10-18 사장님, extractors.js bomIsMaidaModule)
        if (mod.drawerFronts) return;
        push(
          'warning',
          'door-no-hinge',
          `${mod.name}: 도어 ${mod.doors.reduce((s, d) => s + (num(d.qty) || 0), 0)}장이 있는데 경첩·여는 철물이 없습니다`,
          { moduleKey: mod.key, module: mod.name }
        );
      });
    }
    if (unkeyedRows || unkeyedHw) {
      push(
        'info',
        'unkeyed',
        `모듈 키가 없는 옛 행 (자재 ${unkeyedRows} · 철물 ${unkeyedHw}) — 도어·경첩 대조를 일부 건너뛰었습니다`
      );
    }

    issues.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    const counts = { error: 0, warning: 0, info: 0 };
    issues.forEach((x) => {
      counts[x.level]++;
    });
    return { version: VERSION, ok: counts.error === 0, counts, issues };
  }

  /** 한 줄 요약 — 상태줄·확인창용 */
  function summaryOf(result) {
    if (!result) return '';
    const c = result.counts;
    if (!c.error && !c.warning) return '사전 검사 통과';
    return `사전 검사: 오류 ${c.error} · 경고 ${c.warning}`;
  }

  /**
   * BOM 모듈 id → 플래너 모듈 id. 브리지(ui-step1.js)가 플래너 모듈을 BOM 모듈로 바꿀 때 붙인 이름의 역이다:
   *   `planner-<id>-open` (오픈장) → id,  `planner-<id>-<칸>` (칸 셀 모듈) → id + 칸 번호,
   *   `corner-blind-*` (멍장, 브리지가 새로 만든 모듈) → null,  그 밖 → 그대로 (플래너 id 를 그대로 쓴 모듈).
   */
  function plannerModuleOf(moduleId) {
    const s = String(moduleId == null ? '' : moduleId);
    if (!s || /^corner-blind-/.test(s)) return null;
    let m = /^planner-(.+)-open$/.exec(s);
    if (m) return { id: m[1], cell: null };
    m = /^planner-(.+)-(\d+)$/.exec(s);
    if (m) return { id: m[1], cell: Number(m[2]) };
    return { id: s, cell: null };
  }

  /**
   * 검사 결과를 품목·플래너 모듈별 표시로 묶는다 (플래너 3D 테두리용). 오류·경고만 싣는다.
   * @param {object} result  check() 결과
   * @param {{items:Array}} design  exportDesign() — moduleKey 의 앞 번호가 items 순번이다
   * @returns {Object<string,{counts:{error:number,warning:number}, modules:Object<string,{level:string,messages:string[]}>, other:string[]}>}
   *          키 = 품목 uniqueId (없으면 순번)
   */
  function plannerMarksOf(result, design) {
    const items = (design && design.items) || [];
    const out = {};
    const slot = (idx) => {
      const it = items[idx];
      const key = it && it.uniqueId != null ? String(it.uniqueId) : String(idx);
      if (!out[key]) out[key] = { counts: { error: 0, warning: 0 }, modules: {}, other: [] };
      return out[key];
    };
    ((result && result.issues) || []).forEach((x) => {
      if (x.level !== 'error' && x.level !== 'warning') return;
      const mk = /^(\d+)-(.+)$/.exec(String(x.moduleKey || ''));
      if (!mk) return; // 품목을 모르는 문제(partId 중복 등)는 상세설계 화면에서만 보인다
      const bucket = slot(Number(mk[1]));
      bucket.counts[x.level]++;
      const pm = plannerModuleOf(mk[2]);
      if (!pm) {
        bucket.other.push(x.message);
        return;
      }
      const mod =
        bucket.modules[pm.id] || (bucket.modules[pm.id] = { level: 'warning', messages: [] });
      if (x.level === 'error') mod.level = 'error';
      mod.messages.push(pm.cell != null ? `칸 ${pm.cell + 1}: ${x.message}` : x.message);
    });
    return out;
  }

  /**
   * 상세설계 → 품목별 플래너 iframe 으로 표시를 보낸다 (DADAM_PREFLIGHT_MARKS, 같은 오리진).
   * 검사가 깨끗한 품목에도 빈 표시를 보내 지난 테두리를 지운다. 브라우저 전용 — DOM 이 없으면 0.
   * @returns {number} 보낸 iframe 수
   */
  function publishToPlanners(report) {
    if (typeof document === 'undefined' || !report || !report.materials) return 0;
    const mats = Array.isArray(report.materials) ? report.materials : report.materials.materials;
    if (!Array.isArray(mats)) return 0;
    const result = check(mats, report.hardware || []);
    const marks = plannerMarksOf(result, report.design);
    let origin = '*';
    try {
      origin = location.origin || '*';
    } catch (e) {
      origin = '*';
    }
    let sent = 0;
    ((report.design && report.design.items) || []).forEach((it, idx) => {
      const key = it && it.uniqueId != null ? String(it.uniqueId) : String(idx);
      const ov = document.getElementById('__planner-overlay-' + key);
      const frame = ov && ov.querySelector('iframe[data-planner]');
      if (!frame || !frame.contentWindow) return;
      const payload = marks[key] || { counts: { error: 0, warning: 0 }, modules: {}, other: [] };
      frame.contentWindow.postMessage({ type: 'DADAM_PREFLIGHT_MARKS', marks: payload }, origin);
      sent++;
    });
    return sent;
  }

  const BomPreflight = {
    VERSION,
    OPENING_CATEGORIES,
    check,
    summaryOf,
    partKeyOf,
    plannerModuleOf,
    plannerMarksOf,
    publishToPlanners,
  };

  if (typeof window !== 'undefined') window.BomPreflight = BomPreflight;
  if (typeof module !== 'undefined' && module.exports) module.exports = BomPreflight;
})();
