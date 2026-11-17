/* SEGAN 「생산 › 생산 설정」 아래 — 자재 가격표 (segan/price-list.js)
 * (2026-11-18 사장님 「자재 가격 정보 … 파악해서 적용」 · 「도어용 보드까지 색마다」)
 *
 *   무엇    공급처 가격표(엑셀 · CSV)를 올려 둔다. 간편 플래너가 그 가격표에서
 *           색상 탭의 몸통 · 우라 · 도어 색 목록과, BOM 요약의 색마다 단가를 읽는다.
 *   누가    생산 설정을 여는 사람 (다담 공장 구성원 · 협력업체 대표 · 실장) 가운데 서버가 내주는 사람 —
 *           workflow-api GET /planner/price-lists 가 403 이면 칸째 감춘다.
 *   데이터  GET /planner/price-lists (지금 가격표) · POST /planner/price-lists (올리기) ·
 *           GET /planner/price-lists/items (줄 찾기). DB 0070 적용 전(409 db_pending)이면 올리는 칸을 내지 않고 그 글만.
 *   올리기  파일은 이 화면(브라우저)에서 읽는다 — 첫 줄의 칸 이름으로 분류 · 제품군 · 사양 · 색상명 · 코드 · 규격 · 단가를 찾는다.
 *           제품군마다 용도(몸통 · 우라 · 도어 · 엣지 · 그 밖)를 고른 뒤 올린다. 처음 값은 짐작이다 — 사람이 확인한다.
 *           같은 색 · 두께에 값이 둘이면(같은 색을 두 제품군에 몸통으로) 플래너가 그 색의 값을 고르지 못한다 — 올리기 전에 알린다.
 *   생산 설정의 「설정 저장」과는 따로다 (segan/production-settings.js 가 아래 저장 줄 밑에 이 칸을 놓는다).
 *   엑셀 읽기는 SheetJS 를 필요할 때만 불러온다 (PC 상세설계의 XLSX 내보내기와 같은 판).
 */
/* global window, document, fetch */
(function () {
  'use strict';

  var KINDS = ['body', 'back', 'door', 'edge', 'other']; // workflow-api price-lists.js PRICE_KINDS
  var KIND_LABELS = { body: '몸통', back: '우라', door: '도어', edge: '엣지', other: '그 밖' };
  var XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  var ITEMS_MAX = 5000; // 한 가격표의 줄 수 (서버 PRICE_ITEMS_MAX)
  var TEXT_MAX = { supplier: 40, category: 40, product: 60, spec: 60, color_name: 40, code: 40, size_text: 40 };
  var FIND_LIMIT = 50;
  // 칸 이름 — 빈칸 · 가운뎃점을 뺀 글로 견준다
  var HEADS = {
    category: ['대분류', '분류', '구분'],
    product: ['제품군', '제품', '품목'],
    spec: ['사양소재', '사양', '소재'],
    color_name: ['색상명', '색상', '색'],
    code: ['코드', '색상코드', '품번'],
    size_text: ['규격', '사이즈'],
    unit_price: ['단가(원)', '단가', '가격', '금액'],
  };
  var TEXT = {
    title: '자재 가격표',
    help: '공급처 가격표(엑셀)를 올리면 간편 플래너 색상 탭의 몸통 · 우라 · 도어 색 목록이 되고, BOM 요약이 색마다 단가를 읽습니다. 위 「설정 저장」과 따로 올립니다.',
    none: '올린 가격표가 없습니다.',
    pending: 'DB 0070 적용 전입니다 — 자재 가격표는 적용 뒤에 올릴 수 있습니다.',
    supplier: '공급처 이름',
    file: '가격표 파일 (.xlsx · .csv)',
    reading: '파일을 읽는 중입니다.',
    noTool: '엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 골라 주세요.',
    noColumns: '가격표 칸을 찾지 못했습니다. 첫 줄에 색상명(또는 코드)과 단가 칸 이름이 있어야 합니다.',
    tooMany: '줄이 너무 많습니다 (' + ITEMS_MAX + '줄까지).',
    needSupplier: '공급처 이름을 적어 주세요.',
    guess: '용도의 처음 값은 짐작입니다. 제품군마다 확인하고 고쳐 주세요 — 몸통 · 우라 · 도어로 정한 줄만 플래너가 씁니다.',
    upload: '가격표 올리기',
    cancel: '취소',
    working: '올리는 중입니다.',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    find: '찾기',
    findLabel: '올린 가격표에서 찾기 (색상명 · 코드 · 제품군)',
    findNone: '맞는 줄이 없습니다.',
  };

  var P = {
    el: null,
    ctx: null,
    lists: null, // 지금 가격표 (null = 아직 안 읽음)
    loading: false,
    pending: false, // DB 0070 적용 전
    hidden: false, // 서버가 내주지 않는다
    supplier: '',
    draft: null, // 읽은 파일 { fileName, items[], skipped, groups[] }
    busy: false,
    msg: '',
    find: { q: '', kind: '', rows: null, total: 0 },
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function won(n) {
    return Number(n).toLocaleString('ko-KR');
  }
  function clean(v) {
    return String(v == null ? '' : v)
      .replace(/\s+/g, ' ')
      .trim();
  }
  function norm(v) {
    return clean(v).replace(/[\s·ㆍ.]/g, '').toLowerCase();
  }

  // ── 파일 → 줄 (순수) ───────────────────────────────────

  /** 칸 이름 줄 → { category: 칸 번호, … } — 단가와 (색상명이나 코드)가 없으면 null */
  function headerMapOf(row) {
    var map = {};
    (Array.isArray(row) ? row : []).forEach(function (cell, i) {
      var name = norm(cell);
      if (!name) return;
      Object.keys(HEADS).forEach(function (k) {
        if (map[k] === undefined && HEADS[k].indexOf(name) >= 0) map[k] = i;
      });
    });
    if (map.unit_price === undefined || (map.color_name === undefined && map.code === undefined)) return null;
    return map;
  }

  /** 단가 칸 → 정수 원 (「98,000원」 · 98000) — 읽지 못하면 null */
  function priceOf(v) {
    if (typeof v === 'number') return isFinite(v) && v >= 0 && Math.round(v) === v ? v : null;
    var s = clean(v).replace(/[,원\s]/g, '');
    if (!/^\d+$/.test(s)) return null;
    return Number(s);
  }

  /** 규격 글의 첫 숫자 = 두께 (「18*1220*2440」 → 18) — 0 초과 100 이하가 아니면 null */
  function thicknessOf(size) {
    var m = /^\s*(\d+(?:\.\d+)?)\s*[*xX×]/.exec(String(size == null ? '' : size));
    var n = m ? Number(m[1]) : NaN;
    return isFinite(n) && n > 0 && n <= 100 ? n : null;
  }

  /**
   * 표(줄마다 칸 배열) → { items[], skipped } — 앞 스무 줄 안에서 칸 이름 줄을 찾는다. 못 찾으면 null.
   *   items[] = { category, product, spec, color_name, code, size_text, thickness, unit_price } (용도 kind 는 아직 없다)
   *   skipped = 단가를 읽지 못했거나 색상명 · 코드가 둘 다 없는 줄 수 (빈 줄은 세지 않는다)
   */
  function itemsOfRows(aoa) {
    var rows = Array.isArray(aoa) ? aoa : [];
    var at = -1;
    var map = null;
    for (var i = 0; i < rows.length && i < 20 && !map; i += 1) {
      map = headerMapOf(rows[i]);
      if (map) at = i;
    }
    if (!map) return null;
    var items = [];
    var skipped = 0;
    var cell = function (row, k) {
      var s = map[k] === undefined ? '' : clean(row[map[k]]);
      return TEXT_MAX[k] ? s.slice(0, TEXT_MAX[k]) : s;
    };
    for (var r = at + 1; r < rows.length; r += 1) {
      var row = Array.isArray(rows[r]) ? rows[r] : [];
      if (
        !row.some(function (c) {
          return clean(c) !== '';
        })
      )
        continue;
      var price = priceOf(map.unit_price === undefined ? '' : row[map.unit_price]);
      var name = cell(row, 'color_name');
      var code = cell(row, 'code');
      if (price === null || (!name && !code)) {
        skipped += 1;
        continue;
      }
      var size = cell(row, 'size_text');
      items.push({
        category: cell(row, 'category'),
        product: cell(row, 'product'),
        spec: cell(row, 'spec'),
        color_name: name,
        code: code,
        size_text: size,
        thickness: thicknessOf(size),
        unit_price: price,
      });
    }
    return { items: items, skipped: skipped };
  }

  function groupKeyOf(it) {
    return it.category + '|' + it.product;
  }

  /**
   * 용도의 처음 값 — 짐작이다 (사람이 확인하고 고친다):
   *   분류에 에지 · 엣지 → 엣지 · 두께가 모두 5 미만인 판 → 우라 · 두께가 모두 15 이상이고 제품군이 PB 로 시작 → 몸통 ·
   *   두께가 모두 15 이상인 그 밖의 판 → 도어 · 나머지 → 그 밖
   */
  function guessKind(g) {
    if (/에지|엣지/i.test(g.category) || /에지|엣지/i.test(g.product)) return 'edge';
    var t = g.thicknesses;
    if (!t.length || !g.sheet) return 'other';
    if (
      t.every(function (x) {
        return x < 5;
      })
    )
      return 'back';
    if (
      t.every(function (x) {
        return x >= 15;
      })
    )
      return /^PB/i.test(g.product) ? 'body' : 'door';
    return 'other';
  }

  /** 줄 → 제품군 묶음 [{ key, category, product, n, min, max, thicknesses[], sheet, kind }] (가격표 차례) */
  function groupsOf(items) {
    var by = {};
    var out = [];
    (items || []).forEach(function (it) {
      var key = groupKeyOf(it);
      var g = by[key];
      if (!g) {
        g = by[key] = {
          key: key,
          category: it.category,
          product: it.product,
          n: 0,
          min: it.unit_price,
          max: it.unit_price,
          thicknesses: [],
          sheet: true,
          kind: 'other',
        };
        out.push(g);
      }
      g.n += 1;
      g.min = Math.min(g.min, it.unit_price);
      g.max = Math.max(g.max, it.unit_price);
      if (it.thickness === null) g.sheet = false;
      else if (g.thicknesses.indexOf(it.thickness) < 0) g.thicknesses.push(it.thickness);
    });
    out.forEach(function (g) {
      g.kind = guessKind(g);
    });
    return out;
  }

  /** 묶음의 용도를 줄에 입힌다 — 올릴 줄 [{ kind, … }] */
  function withKinds(items, groups) {
    var kindOf = {};
    (groups || []).forEach(function (g) {
      kindOf[g.key] = KINDS.indexOf(g.kind) >= 0 ? g.kind : 'other';
    });
    return (items || []).map(function (it) {
      var out = { kind: kindOf[groupKeyOf(it)] || 'other' };
      Object.keys(it).forEach(function (k) {
        out[k] = it[k];
      });
      return out;
    });
  }

  /**
   * 같은 색에 값이 둘인 곳 — 플래너가 그 색의 값을 고르지 못한다 (workflow-api price-lists.js listBoardPrice 와 같은 셈).
   *   몸통 · 도어: 색 + 두께마다, 우라: 색마다 (두께를 가리지 않는다). 몸통 · 우라의 색 = 「색상명 코드」, 도어의 색 = 코드.
   * @returns {{kind:string, color:string, thickness:(number|null), prices:number[]}[]}
   */
  function conflictsOf(items) {
    var by = {};
    var order = [];
    (items || []).forEach(function (it) {
      if (['body', 'back', 'door'].indexOf(it.kind) < 0) return;
      var color = it.kind === 'door' ? it.code : [it.color_name, it.code].filter(Boolean).join(' ');
      if (!color) return;
      var t = it.kind === 'back' ? null : it.thickness;
      var key = it.kind + '|' + color + '|' + (t === null ? '' : t);
      if (!by[key]) {
        by[key] = { kind: it.kind, color: color, thickness: t, prices: [] };
        order.push(key);
      }
      if (by[key].prices.indexOf(it.unit_price) < 0) by[key].prices.push(it.unit_price);
    });
    return order
      .map(function (k) {
        return by[k];
      })
      .filter(function (c) {
        return c.prices.length > 1;
      });
  }

  // ── 서버 ───────────────────────────────────────────────
  async function call(method, path, body) {
    var headers = { Authorization: 'Bearer ' + (await P.ctx.token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(P.ctx.base + path, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      return { ok: false, status: 0, body: {} };
    }
    var b = null;
    try {
      b = await res.json();
    } catch {
      b = null;
    }
    b = b && typeof b === 'object' ? b : {};
    return { ok: res.ok && b.success === true, status: res.status, body: b };
  }
  function errText(r) {
    var m = r && r.body && r.body.message;
    return typeof m === 'string' && m ? m : TEXT.generic;
  }

  async function loadLists() {
    if (P.loading) return;
    P.loading = true;
    var r = await call('GET', '/planner/price-lists');
    P.loading = false;
    if (r.ok) {
      var lists = r.body.data && r.body.data.lists;
      P.lists = Array.isArray(lists) ? lists : [];
      P.pending = false;
    } else if (r.status === 409 && r.body.code === 'db_pending') {
      P.lists = [];
      P.pending = true;
    } else if (r.status === 403) {
      P.hidden = true;
    } else {
      P.lists = [];
      P.msg = errText(r);
    }
    draw();
  }

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (window.__seganXlsxLoading) return window.__seganXlsxLoading;
    window.__seganXlsxLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = function () {
        if (window.XLSX) resolve(window.XLSX);
        else reject(new Error('XLSX'));
      };
      s.onerror = function () {
        window.__seganXlsxLoading = null;
        s.remove();
        reject(new Error('XLSX'));
      };
      document.head.appendChild(s);
    });
    return window.__seganXlsxLoading;
  }

  /** 고른 파일을 읽어 올릴 줄 · 제품군 묶음을 만든다 (올리지는 않는다) */
  async function pick(file) {
    if (!file || P.busy) return;
    P.draft = null;
    P.msg = TEXT.reading;
    draw();
    var X;
    try {
      X = await loadXlsx();
    } catch {
      P.msg = TEXT.noTool;
      draw();
      return;
    }
    var got = null;
    try {
      var wb = X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      (wb.SheetNames || []).some(function (name) {
        var r = itemsOfRows(X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }));
        if (r && r.items.length) got = r;
        return !!got;
      });
    } catch {
      got = null;
    }
    if (!got) {
      P.msg = TEXT.noColumns;
      draw();
      return;
    }
    if (got.items.length > ITEMS_MAX) {
      P.msg = TEXT.tooMany;
      draw();
      return;
    }
    P.draft = { fileName: clean(file.name).slice(0, 120), items: got.items, skipped: got.skipped, groups: groupsOf(got.items) };
    P.msg = '';
    draw();
  }

  async function upload() {
    if (P.busy || !P.draft) return;
    var supplier = clean(P.supplier);
    if (!supplier) {
      P.msg = TEXT.needSupplier;
      draw();
      var input = P.el && P.el.querySelector('#pl-supplier');
      if (input && input.focus) input.focus();
      return;
    }
    P.busy = true;
    P.msg = TEXT.working;
    draw();
    var items = withKinds(P.draft.items, P.draft.groups);
    var r = await call('POST', '/planner/price-lists', { supplier: supplier, source_name: P.draft.fileName, items: items });
    P.busy = false;
    if (!r.ok) {
      P.msg = errText(r);
      draw();
      return;
    }
    P.draft = null;
    P.find.rows = null;
    P.msg = '가격표를 올렸습니다 — ' + items.length + '줄.';
    P.lists = null;
    draw();
    await loadLists();
  }

  async function find() {
    if (P.busy) return;
    var qs = '?limit=' + FIND_LIMIT + (P.find.q ? '&q=' + encodeURIComponent(P.find.q) : '') + (P.find.kind ? '&kind=' + P.find.kind : '');
    var r = await call('GET', '/planner/price-lists/items' + qs);
    if (!r.ok) {
      P.msg = errText(r);
      draw();
      return;
    }
    var d = r.body.data || {};
    P.find.rows = Array.isArray(d.items) ? d.items : [];
    P.find.total = Number(d.total) || 0;
    draw();
  }

  // ── 그리기 ─────────────────────────────────────────────
  function kindCounts(counts) {
    var c = counts && typeof counts === 'object' ? counts : {};
    return KINDS.filter(function (k) {
      return Number(c[k]) > 0;
    })
      .map(function (k) {
        return KIND_LABELS[k] + ' ' + Number(c[k]);
      })
      .join(' · ');
  }
  function listsHtml() {
    if (P.lists === null) return '';
    if (P.pending) return '<p class="mk-note" data-pl="pending">' + esc(TEXT.pending) + '</p>';
    if (!P.lists.length) return '<p class="mk-note" data-pl="none">' + esc(TEXT.none) + '</p>';
    return (
      '<div class="pl-scroll"><table class="pl-table" data-pl="lists"><thead><tr><th scope="col">공급처</th><th scope="col">파일</th><th scope="col" class="n">줄</th><th scope="col">용도마다</th><th scope="col">올린 날</th></tr></thead><tbody>' +
      P.lists
        .map(function (l) {
          return (
            '<tr><th scope="row">' +
            esc(l.supplier) +
            '</th><td>' +
            esc(l.source_name || '') +
            '</td><td class="n">' +
            esc(l.row_count) +
            '</td><td>' +
            esc(kindCounts(l.counts)) +
            '</td><td>' +
            esc(String(l.created_at || '').slice(0, 10)) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>'
    );
  }
  function pickHtml() {
    if (P.pending || P.lists === null) return '';
    return (
      '<div class="ps-grid"><label class="mk-input ps-field" for="pl-supplier"><span>' +
      esc(TEXT.supplier) +
      '</span><input id="pl-supplier" type="text" maxlength="' +
      TEXT_MAX.supplier +
      '" autocomplete="off" value="' +
      esc(P.supplier) +
      '"></label><label class="mk-input ps-field" for="pl-file"><span>' +
      esc(TEXT.file) +
      '</span><input id="pl-file" type="file" accept=".xlsx,.xls,.csv"></label></div>'
    );
  }
  function draftHtml() {
    var d = P.draft;
    if (!d) return '';
    var bad = conflictsOf(withKinds(d.items, d.groups));
    var warn = bad.length
      ? '<p class="pl-warn" data-pl="conflicts">같은 색에 값이 둘인 색이 ' +
        bad.length +
        '개 있습니다 — 플래너가 그 색의 값을 고르지 못합니다. 한쪽 제품군을 「그 밖」으로 바꿔 주세요. 예: ' +
        esc(
          bad
            .slice(0, 3)
            .map(function (c) {
              return KIND_LABELS[c.kind] + ' ' + c.color + (c.thickness === null ? '' : ' ' + c.thickness + 'T') + ' (' + c.prices.map(won).join(' · ') + ')';
            })
            .join(', ')
        ) +
        '</p>'
      : '';
    return (
      '<div data-pl="draft"><p class="mk-note">' +
      esc(d.fileName + ' — ' + d.items.length + '줄' + (d.skipped ? ' (단가나 이름을 읽지 못한 ' + d.skipped + '줄은 뺍니다)' : '')) +
      '</p><p class="mk-note">' +
      esc(TEXT.guess) +
      '</p>' +
      warn +
      '<div class="pl-scroll"><table class="pl-table" data-pl="groups"><thead><tr><th scope="col">분류</th><th scope="col">제품군</th><th scope="col" class="n">줄</th><th scope="col" class="n">단가 (원)</th><th scope="col">용도</th></tr></thead><tbody>' +
      d.groups
        .map(function (g, i) {
          return (
            '<tr><td>' +
            esc(g.category) +
            '</td><th scope="row">' +
            esc(g.product) +
            '</th><td class="n">' +
            g.n +
            '</td><td class="n">' +
            (g.min === g.max ? won(g.min) : won(g.min) + ' ~ ' + won(g.max)) +
            '</td><td><select data-pl-kind="' +
            i +
            '" aria-label="' +
            esc(g.product + ' 용도') +
            '">' +
            KINDS.map(function (k) {
              return '<option value="' + k + '"' + (k === g.kind ? ' selected' : '') + '>' + KIND_LABELS[k] + '</option>';
            }).join('') +
            '</select></td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div><div class="pl-bar"><button type="button" class="mk-btn mk-btn--solid" data-act="pl-upload"' +
      (P.busy ? ' disabled' : '') +
      '>' +
      esc(TEXT.upload) +
      '</button><button type="button" class="mk-btn" data-act="pl-cancel"' +
      (P.busy ? ' disabled' : '') +
      '>' +
      esc(TEXT.cancel) +
      '</button></div></div>'
    );
  }
  function findHtml() {
    if (P.pending || !P.lists || !P.lists.length) return '';
    var rows = P.find.rows;
    var result = '';
    if (rows) {
      result = rows.length
        ? '<p class="mk-note" data-pl="found">' +
          esc(P.find.total + '줄' + (P.find.total > rows.length ? ' 가운데 앞 ' + rows.length + '줄' : '')) +
          '</p><div class="pl-scroll"><table class="pl-table" data-pl="items"><thead><tr><th scope="col">용도</th><th scope="col">색상명</th><th scope="col">코드</th><th scope="col">제품군 · 사양</th><th scope="col">규격</th><th scope="col" class="n">단가 (원)</th></tr></thead><tbody>' +
          rows
            .map(function (it) {
              return (
                '<tr><td>' +
                esc(KIND_LABELS[it.kind] || it.kind) +
                '</td><th scope="row">' +
                esc(it.color_name) +
                '</th><td>' +
                esc(it.code) +
                '</td><td>' +
                esc([it.product, it.spec].filter(Boolean).join(' · ')) +
                '</td><td>' +
                esc(it.size_text) +
                '</td><td class="n">' +
                won(it.unit_price) +
                '</td></tr>'
              );
            })
            .join('') +
          '</tbody></table></div>'
        : '<p class="mk-note" data-pl="found">' + esc(TEXT.findNone) + '</p>';
    }
    return (
      '<div class="ps-grid"><label class="mk-input ps-field" for="pl-q"><span>' +
      esc(TEXT.findLabel) +
      '</span><input id="pl-q" type="search" maxlength="40" autocomplete="off" value="' +
      esc(P.find.q) +
      '"></label><label class="mk-input ps-field" for="pl-fkind"><span>용도</span><select id="pl-fkind"><option value="">전체</option>' +
      KINDS.map(function (k) {
        return '<option value="' + k + '"' + (k === P.find.kind ? ' selected' : '') + '>' + KIND_LABELS[k] + '</option>';
      }).join('') +
      '</select></label></div><div class="pl-bar"><button type="button" class="mk-btn" data-act="pl-find">' +
      esc(TEXT.find) +
      '</button></div>' +
      result
    );
  }
  function draw() {
    var el = P.el;
    if (!el) return;
    if (P.hidden) {
      el.innerHTML = '';
      return;
    }
    var keep = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
    var keepSel = keep && keep.id ? '#' + keep.id : keep && keep.getAttribute('data-pl-kind') !== null ? '[data-pl-kind="' + keep.getAttribute('data-pl-kind') + '"]' : '';
    el.innerHTML =
      '<div class="od-sec ps-sec pl" data-pl="box"' +
      (P.busy ? ' aria-busy="true"' : '') +
      '><h4 class="od-h">' +
      esc(TEXT.title) +
      '</h4><p class="mk-note">' +
      esc(TEXT.help) +
      '</p>' +
      listsHtml() +
      pickHtml() +
      draftHtml() +
      '<p class="mk-note pl-msg" role="status" data-pl="msg">' +
      esc(P.msg) +
      '</p>' +
      findHtml() +
      '</div>';
    if (keepSel) {
      var again = el.querySelector(keepSel);
      if (again && again.focus) again.focus();
    }
  }

  // ── 누른 일 ────────────────────────────────────────────
  function onChange(e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'pl-file') {
      var f = t.files && t.files[0];
      if (f) pick(f);
      return;
    }
    if (t.id === 'pl-fkind') {
      P.find.kind = KINDS.indexOf(t.value) >= 0 ? t.value : '';
      return;
    }
    var i = t.getAttribute && t.getAttribute('data-pl-kind');
    if (i !== null && i !== undefined && P.draft && P.draft.groups[Number(i)] && KINDS.indexOf(t.value) >= 0) {
      P.draft.groups[Number(i)].kind = t.value;
      draw();
    }
  }
  function onInput(e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'pl-supplier') P.supplier = String(t.value || '').slice(0, TEXT_MAX.supplier);
    if (t.id === 'pl-q') P.find.q = clean(t.value).slice(0, 40);
  }
  function onClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !P.el || !P.el.contains(b)) return;
    var act = b.getAttribute('data-act');
    if (act === 'pl-upload') upload();
    else if (act === 'pl-cancel') {
      P.draft = null;
      P.msg = '';
      draw();
    } else if (act === 'pl-find') find();
  }
  function onKey(e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'pl-q') {
      e.preventDefault();
      find();
    }
  }

  /**
   * 생산 설정이 칸을 그릴 때마다 부른다 — el = 가격표가 들어갈 자리, ctx = { base, token }.
   *   읽은 것 · 적던 것은 그대로 둔다 (설정을 저장해 다시 그려도 올리던 가격표가 사라지지 않게).
   */
  function mount(el, ctx) {
    if (!el || !ctx || !ctx.base || typeof ctx.token !== 'function') return;
    var fresh = !P.ctx || P.ctx.base !== ctx.base;
    P.el = el;
    P.ctx = ctx;
    if (fresh) {
      P.lists = null;
      P.pending = false;
      P.hidden = false;
      P.draft = null;
      P.msg = '';
      P.find = { q: '', kind: '', rows: null, total: 0 };
    }
    if (!el.getAttribute('data-pl-bound')) {
      el.setAttribute('data-pl-bound', '1');
      el.addEventListener('change', onChange);
      el.addEventListener('input', onInput);
      el.addEventListener('click', onClick);
      el.addEventListener('keydown', onKey);
    }
    draw();
    if (P.lists === null && !P.hidden) loadLists();
  }

  /** 시험 · 다른 계정으로 바뀔 때 — 읽은 것을 비운다 */
  function reset() {
    P.el = null;
    P.ctx = null;
    P.lists = null;
    P.loading = false;
    P.pending = false;
    P.hidden = false;
    P.supplier = '';
    P.draft = null;
    P.busy = false;
    P.msg = '';
    P.find = { q: '', kind: '', rows: null, total: 0 };
  }

  window.SeganPriceList = {
    KINDS: KINDS,
    KIND_LABELS: KIND_LABELS,
    TEXT: TEXT,
    XLSX_URL: XLSX_URL,
    headerMapOf: headerMapOf,
    priceOf: priceOf,
    thicknessOf: thicknessOf,
    itemsOfRows: itemsOfRows,
    groupsOf: groupsOf,
    guessKind: guessKind,
    withKinds: withKinds,
    conflictsOf: conflictsOf,
    state: P,
    mount: mount,
    pick: pick,
    reset: reset,
  };
})();
