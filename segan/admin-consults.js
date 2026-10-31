/* ============================================================
   segan/admin-consults.js — 「관리 › 상담 배정」 (segan/admin.html#consults)

   누가      관리자 — segan/admin.js 가 관리자일 때만 부른다 (서버도 관리자만 답한다)
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /admin/consult-inbox?state=pending|assigned        다담 본사 상담 (data.items)
               GET  /admin/consultations/:id/candidates                 1~3순위 · 점수 내역 · 걸러진 업체
               POST /admin/consultations/:id/assign { company_id }     배정 (업체가 24시간 안에 답한다)
   화면      PC admin/consult-distribution.html 과 같은 일을 폰 한 줄로:
               대기 · 답 기다림 탭 → 상담 줄 → 누르면 그 자리에 고객 칸 · 지금 배정 · 거친 업체 · 순위(점수 내역) ·
               걸러진 업체 · 「이 업체에 배정」(되묻기는 화면 안에서). 거르기 · 점수는 서버가 한다 — 받은 대로 보인다.
             업체 평가 · 상담 관리 같은 큰 화면은 PC에서.
   이름      이름표 · 점수 묶음 = admin/consult-distribution.html (시험이 같은지 본다)
   못 읽으면  목록 · 순위 자리에 한 줄 안내. 배정을 못 하면 서버 글을 그 자리에.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  // ── 이름표 — admin/consult-distribution.html 과 같다 ─────────
  var ITEM_LABEL = {
    sink: '싱크대',
    island: '아일랜드',
    wardrobe: '붙박이장',
    fridge: '냉장고장',
    shoerack: '신발장',
    vanity: '화장대',
    storage: '수납장',
    other: '기타',
  };
  var TIME_LABEL = {
    '09:00-12:00': '오전',
    '12:00-15:00': '점심',
    '15:00-18:00': '오후',
    '18:00-21:00': '저녁',
  };
  var DOOR_FINISH_LABEL = {
    pet: 'PET',
    highgloss: '하이그로시',
    paint: '도장',
    veneer: '무늬목',
    ceramic: '세라믹',
    unknown: '모름',
  };
  var PRICE_TIER_LABEL = { basic: '보급', mid: '중급', high: '고급', unknown: '모름' };
  var STATUS_LABEL = {
    pending: '대기',
    assigned: '배정됨',
    confirmed: '확정',
    completed: '완료',
    cancelled: '취소',
    returned: '돌아옴',
  };
  var ASSIGN_STATE_LABEL = {
    assigned: '답 기다림',
    accepted: '받음',
    declined: '못 받음',
    expired: '시간 지남',
  };
  var KIND_LABEL = { hq: '다담 공장', partner: 'Agent' };
  var FILTER_REASON = {
    region: '지역 밖',
    item: '품목 안 함',
    limit: '한도',
    period: '기간 없음',
    docs: '서류 미확인',
    tier: '자격',
    inactive: '활동 안 함',
    tried: '거친 업체',
  };
  var LOCATION_WHY = { same_gugun: '같은 시/군/구', same_sido: '같은 시/도', other: '그 밖' };
  var SCORE_GROUPS = [
    {
      key: 'eval',
      label: '본사 평가',
      max: 40,
      parts: [
        ['grade', '등급', 16],
        ['satisfaction', '고객 만족', 12],
        ['rework', '재작업', 6],
        ['response', '응답', 6],
      ],
    },
    {
      key: 'fit',
      label: '선택 적합도',
      max: 35,
      parts: [
        ['item', '품목 실적', 15],
        ['price', '가격대', 5],
        ['timing', '희망 시기', 5],
        ['design', '상세 설계', 10],
      ],
    },
    { key: 'location', label: '위치', max: 15, parts: [] },
    {
      key: 'other',
      label: '기타',
      max: 10,
      parts: [
        ['spread', '일감 고르게', 5],
        ['capacity', '처리 여유', 5],
      ],
    },
  ];
  var TABS = [
    ['pending', '대기'],
    ['assigned', '답 기다림'],
  ];
  var EMPTY_TEXT = {
    pending: '기다리는 상담이 없습니다.',
    assigned: '답을 기다리는 배정이 없습니다.',
  };
  var PC_PAGE = '../admin/consult-distribution.html';
  var TEXT = {
    loadFail: '상담을 불러오지 못했습니다.',
    candFail: '순위를 불러오지 못했습니다.',
    candLoading: '순위를 계산하는 중…',
    noCand: '남는 업체 없음 — 고객에게 직접 연락해 주세요. 상담은 대기로 둡니다.',
    waitingNow: '답을 기다리는 배정이 있어 지금은 배정할 수 없습니다.',
    pendingOnly: '대기 상담만 배정할 수 있습니다.',
    openAssignment: '이미 답을 기다리는 배정이 있습니다. 목록을 다시 불러왔습니다.',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var C = {
    sb: null,
    session: null,
    base: '',
    tab: 'pending',
    items: null, // 상담 목록 | null(못 읽음)
    selectedId: null,
    cand: null, // { items, filtered } | 'loading' | null(못 읽음)
    confirm: null, // 배정 되묻기 { consultId, companyId, companyName }
    err: '',
    msg: '',
    busy: false,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ── 글자 ───────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function has(obj, k) {
    return typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);
  }

  /** 이름표가 있으면 이름표, 없으면 값 그대로, 값이 없으면 fallback */
  function label(map, k, fallback) {
    return has(map, k) ? map[k] : k === null || k === undefined || k === '' ? fallback : String(k);
  }

  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 한국 시간 { date: 'YYYY.MM.DD', time: 'HH:MM' } (ISO UTC 로 온 시각) */
  function kst(iso) {
    var t = Date.parse(iso || '');
    if (isNaN(t)) return null;
    var k = new Date(t + 9 * 3600 * 1000);
    return {
      date: k.getUTCFullYear() + '.' + pad(k.getUTCMonth() + 1) + '.' + pad(k.getUTCDate()),
      time: pad(k.getUTCHours()) + ':' + pad(k.getUTCMinutes()),
    };
  }

  function fmtDate(iso) {
    var k = kst(iso);
    return k ? k.date : '-';
  }

  function fmtDateTime(iso) {
    var k = kst(iso);
    return k ? k.date + ' ' + k.time : '-';
  }

  /** 남은 시간 — 서버가 준 expires_at 까지 (PC 와 같은 글) */
  function leftText(expiresAt, now) {
    var t = Date.parse(expiresAt || '');
    if (!isFinite(t)) return '';
    var ms = t - (now === undefined ? Date.now() : now);
    if (ms <= 0) return '시간 지남';
    var mins = Math.ceil(ms / 60000);
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h ? h + '시간 ' + m + '분 남음' : m + '분 남음';
  }

  function fmtNum(v) {
    return typeof v === 'number' && isFinite(v) ? String(Math.round(v * 10) / 10) : '-';
  }

  function region(c) {
    return [c.sido, c.gugun].filter(Boolean).join(' ') || '-';
  }

  function itemNames(cats) {
    return arr(cats).map(function (k) {
      return label(ITEM_LABEL, k, '');
    });
  }

  function doneBy(c) {
    return c.wanted_done_date ? c.wanted_done_date + ' 시공 완료' : '-';
  }

  function wantedTime(c) {
    var parts = [c.preferred_date, label(TIME_LABEL, c.preferred_time, '')].filter(Boolean);
    return parts.length ? parts.join(' ') : '-';
  }

  function demolition(v) {
    return v === true ? '필요' : v === false ? '필요 없음' : '-';
  }

  function won(v) {
    return typeof v === 'number' && isFinite(v)
      ? Math.round(v).toLocaleString('ko-KR') + '원'
      : '-';
  }

  function telHref(tel) {
    return 'tel:' + String(tel || '').replace(/[^0-9+]/g, '');
  }

  // ── 판정 (순수 함수 — 시험이 직접 부른다) ─────────────────
  function waiting(c) {
    return Boolean(c && c.assignment && c.assignment.state === 'assigned');
  }

  /** 배정할 수 있는 상담 — 대기이고 답을 기다리는 배정이 없을 때 (서버가 다시 확인한다) */
  function canAssign(c) {
    return Boolean(c && c.status === 'pending' && !waiting(c));
  }

  /** 점수 묶음 한 줄 — 「본사 평가 32/40 (등급 B 16/16 · 고객 만족 …)」 */
  function groupText(g, s) {
    var sum = s && typeof s.sum === 'number' ? s.sum : null;
    var head = g.label + ' ' + fmtNum(sum) + '/' + g.max;
    var parts;
    if (g.key === 'location') parts = s && s.why ? label(LOCATION_WHY, s.why, '') : '';
    else {
      parts = g.parts
        .map(function (p) {
          var name =
            g.key === 'eval' &&
            p[0] === 'grade' &&
            s &&
            typeof s.grade_letter === 'string' &&
            s.grade_letter
              ? p[1] + ' ' + s.grade_letter
              : p[1];
          var v = s ? s[p[0]] : null;
          var val =
            typeof v === 'number' ? fmtNum(v) + '/' + p[2] : typeof v === 'string' && v ? v : '-';
          return name + ' ' + val;
        })
        .join(' · ');
    }
    return parts ? head + ' (' + parts + ')' : head;
  }

  // ── 그리기 ─────────────────────────────────────────────
  function current() {
    return (
      (C.items || []).filter(function (c) {
        return c.id === C.selectedId;
      })[0] || null
    );
  }

  function fact(name, html) {
    return '<div><dt>' + esc(name) + '</dt><dd>' + html + '</dd></div>';
  }

  function detailHtml(c) {
    var items = itemNames(c.furniture_categories).filter(Boolean);
    var facts =
      '<dl class="me-facts">' +
      fact(
        '전화',
        c.phone ? '<a href="' + esc(telHref(c.phone)) + '">' + esc(c.phone) + '</a>' : '-'
      ) +
      fact('지역', esc(region(c))) +
      fact('품목', esc(items.length ? items.join(' · ') : '-')) +
      fact('도어 마감', esc(label(DOOR_FINISH_LABEL, c.door_finish, '-'))) +
      fact('철거', esc(demolition(c.demolition_needed))) +
      fact('가격대', esc(label(PRICE_TIER_LABEL, c.wanted_price_tier, '-'))) +
      fact('희망 시기', esc(doneBy(c))) +
      fact('희망 상담', esc(wantedTime(c))) +
      fact('상세 설계', esc(c.request_detail_design ? '요청함' : '요청 안 함')) +
      fact('예상 견적', esc(won(c.quote_total))) +
      fact('연출컷', esc(c.has_generation ? '있음' : '없음')) +
      fact('신청일', esc(fmtDate(c.created_at))) +
      '</dl>';
    var a = c.assignment;
    var now = a
      ? '<p class="ad-assign" data-assign-now>' +
        esc(
          [
            a.company_name || '-',
            label(ASSIGN_STATE_LABEL, a.state, '-'),
            a.state === 'assigned' ? leftText(a.expires_at) : '',
            '배정 ' + fmtDateTime(a.assigned_at),
          ]
            .filter(Boolean)
            .join(' · ')
        ) +
        '</p>'
      : '<p class="ad-assign" data-assign-now>지금 배정 없음</p>';
    var tried = arr(c.tried);
    var triedHtml = tried.length
      ? '<p class="mk-note" data-tried>거친 업체 — ' +
        esc(
          tried
            .map(function (t) {
              return (t.company_name || '-') + ' ' + label(ASSIGN_STATE_LABEL, t.state, '-');
            })
            .join(' · ')
        ) +
        '</p>'
      : '';
    return '<div class="ad-detail">' + facts + now + triedHtml + candidatesHtml(c) + '</div>';
  }

  function candidatesHtml(c) {
    if (C.cand === 'loading') return '<p class="sg-note">' + esc(TEXT.candLoading) + '</p>';
    if (C.cand === null) return '<p class="me-pt-msg" role="status">' + esc(TEXT.candFail) + '</p>';
    var items = C.cand.items;
    var allow = canAssign(c);
    var why = waiting(c) ? TEXT.waitingNow : !allow ? TEXT.pendingOnly : '';
    var list = items.length
      ? '<ol class="ad-cands">' +
        items
          .map(function (x) {
            var asking = C.confirm && C.confirm.companyId === x.company_id;
            return (
              '<li class="ad-cand" data-company="' +
              esc(x.company_id) +
              '"><p class="ad-cand-head"><b>' +
              esc(x.rank) +
              '순위 ' +
              esc(x.company_name || '-') +
              '</b><span>' +
              esc(label(KIND_LABEL, x.kind, '-')) +
              ' · ' +
              esc(fmtNum(x.total)) +
              '점</span></p><ul class="ad-score">' +
              SCORE_GROUPS.map(function (g) {
                return (
                  '<li data-group="' +
                  g.key +
                  '">' +
                  esc(groupText(g, x.score && x.score[g.key])) +
                  '</li>'
                );
              }).join('') +
              '</ul>' +
              (asking
                ? '<div class="ad-panel"><p class="mk-note">' +
                  esc(
                    (c.name || '이 고객') +
                      ' 상담을 「' +
                      (x.company_name || '-') +
                      '」에 배정할까요?'
                  ) +
                  '</p><p class="mk-error" data-err role="alert"' +
                  (C.err ? '' : ' hidden') +
                  '>' +
                  esc(C.err) +
                  '</p><div class="rd-acts">' +
                  '<button type="button" class="mk-btn mk-btn--solid" data-act="assign-yes"' +
                  (C.busy ? ' disabled' : '') +
                  '>배정</button><button type="button" class="mk-btn" data-act="assign-no"' +
                  (C.busy ? ' disabled' : '') +
                  '>취소</button></div></div>'
                : allow
                  ? '<div class="rd-acts"><button type="button" class="mk-btn" data-act="assign" data-company="' +
                    esc(x.company_id) +
                    '">이 업체에 배정</button></div>'
                  : '') +
              '</li>'
            );
          })
          .join('') +
        '</ol>'
      : '<p class="me-pt-msg" role="status">' + esc(TEXT.noCand) + '</p>';
    var filtered = arr(C.cand.filtered);
    var filteredHtml = filtered.length
      ? '<details class="ad-filtered"><summary>걸러진 업체 ' +
        filtered.length +
        '</summary><ul>' +
        filtered
          .map(function (f) {
            return (
              '<li>' +
              esc(f.company_name || '-') +
              ' — ' +
              esc(
                arr(f.reasons)
                  .map(function (r) {
                    return label(FILTER_REASON, r, String(r));
                  })
                  .join(' · ')
              ) +
              '</li>'
            );
          })
          .join('') +
        '</ul></details>'
      : '';
    return (
      '<p class="me-pt-title">순위</p>' +
      (why ? '<p class="mk-note">' + esc(why) + '</p>' : '') +
      list +
      filteredHtml
    );
  }

  function itemHtml(c) {
    var sel = c.id === C.selectedId;
    var statusKey = waiting(c) ? 'assigned' : c.status;
    var items = itemNames(c.furniture_categories).filter(Boolean);
    var sub = [region(c), items.length ? items.join(' · ') : '품목 없음', fmtDate(c.created_at)];
    if (waiting(c))
      sub.push((c.assignment.company_name || '-') + ' ' + leftText(c.assignment.expires_at));
    var tried = arr(c.tried).length;
    if (tried) sub.push('거친 업체 ' + tried);
    return (
      '<li class="me-cs-item" data-consult="' +
      esc(c.id) +
      '"><button type="button" class="ad-pick" data-act="pick" data-id="' +
      esc(c.id) +
      '" aria-expanded="' +
      sel +
      '"><span class="me-c-main"><b>' +
      esc(c.name || '이름 없음') +
      '</b><small>' +
      esc(sub.join(' · ')) +
      '</small></span><span class="ad-status">' +
      esc(label(STATUS_LABEL, statusKey, '-')) +
      '</span></button>' +
      (sel ? detailHtml(c) : '') +
      '</li>'
    );
  }

  function render() {
    var box = $('adConsultsBody');
    if (!box) return;
    var tabs =
      '<div class="cs-choices ad-tabs" role="tablist">' +
      TABS.map(function (t) {
        var on = C.tab === t[0];
        return (
          '<button type="button" class="mk-btn' +
          (on ? ' mk-btn--solid' : '') +
          '" data-act="tab" data-tab="' +
          t[0] +
          '" role="tab" aria-selected="' +
          on +
          '"' +
          (C.busy ? ' disabled' : '') +
          '>' +
          esc(t[1]) +
          '</button>'
        );
      }).join('') +
      '</div>';
    var body;
    if (C.items === null)
      body = '<p class="me-pt-msg" role="status">' + esc(TEXT.loadFail) + '</p>';
    else if (!C.items.length) body = '<p class="me-empty">' + esc(EMPTY_TEXT[C.tab]) + '</p>';
    else body = '<ul class="me-cs-list ad-list">' + C.items.map(itemHtml).join('') + '</ul>';
    box.innerHTML =
      tabs +
      (C.msg ? '<p class="me-pt-msg" role="status">' + esc(C.msg) + '</p>' : '') +
      body +
      '<ul class="sg-rows ad-more"><li><a class="sg-row" href="' +
      PC_PAGE +
      '">전체 상담 · 업체 평가는 PC에서</a></li></ul>';
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = C.sb && (await C.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return C.session ? C.session.access_token : '';
  }

  async function call(method, path, body) {
    if (!C.base) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(C.base + path, {
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

  async function fetchInbox() {
    var r = await call('GET', '/admin/consult-inbox?state=' + encodeURIComponent(C.tab));
    var d = r.ok ? r.body.data : null;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    return d.items.filter(function (c) {
      return c && typeof c === 'object' && typeof c.id === 'string' && c.id;
    });
  }

  async function fetchCandidates(id) {
    var r = await call('GET', '/admin/consultations/' + encodeURIComponent(id) + '/candidates');
    var d = r.ok ? r.body.data : null;
    if (!d || typeof d !== 'object') return null;
    return { items: arr(d.items), filtered: arr(d.filtered) };
  }

  async function reload() {
    C.items = await fetchInbox();
    if (!current()) {
      C.selectedId = null;
      C.cand = null;
    }
    render();
    if (C.selectedId) await loadCandidates(C.selectedId);
  }

  async function loadCandidates(id) {
    C.cand = 'loading';
    render();
    var got = await fetchCandidates(id);
    if (C.selectedId !== id) return; // 그새 다른 상담을 골랐다
    C.cand = got;
    render();
  }

  async function assign() {
    var p = C.confirm;
    if (!p || C.busy) return;
    C.busy = true;
    C.err = '';
    render();
    var r = await call(
      'POST',
      '/admin/consultations/' + encodeURIComponent(p.consultId) + '/assign',
      {
        company_id: p.companyId,
      }
    );
    C.busy = false;
    if (r.ok) {
      C.confirm = null;
      C.msg = '「' + p.companyName + '」에 배정했습니다. 업체가 24시간 안에 답합니다.';
      await reload();
      return;
    }
    if (r.body.code === 'open_assignment' || r.status === 409) {
      C.confirm = null;
      C.msg = TEXT.openAssignment;
      await reload();
      return;
    }
    if (r.body.code === 'not_eligible' || r.status === 422) {
      C.confirm = null;
      C.msg =
        '「' + p.companyName + '」은 지금 배정 조건에 맞지 않습니다. 순위를 다시 불러왔습니다.';
      await loadCandidates(p.consultId);
      return;
    }
    C.err = errText(r);
    render();
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || C.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'tab') {
      var tab = el.getAttribute('data-tab');
      if (tab === C.tab || !has(EMPTY_TEXT, tab)) return;
      C.tab = tab;
      C.selectedId = null;
      C.cand = null;
      C.confirm = null;
      C.msg = '';
      return reload();
    }
    if (act === 'pick') {
      var id = el.getAttribute('data-id');
      C.confirm = null;
      C.err = '';
      C.msg = '';
      if (C.selectedId === id) {
        C.selectedId = null;
        C.cand = null;
        render();
        return;
      }
      C.selectedId = id;
      return loadCandidates(id);
    }
    var c = current();
    if (act === 'assign' && c && C.cand && C.cand !== 'loading' && canAssign(c)) {
      var companyId = el.getAttribute('data-company');
      var x = C.cand.items.filter(function (i) {
        return i.company_id === companyId;
      })[0];
      if (!x) return;
      C.confirm = { consultId: c.id, companyId: x.company_id, companyName: x.company_name || '-' };
      C.err = '';
      render();
      return;
    }
    if (act === 'assign-no') {
      C.confirm = null;
      C.err = '';
      render();
      return;
    }
    if (act === 'assign-yes') return assign();
  }

  /** 상담 배정 칸 채우기 — admin.js 가 #consults(-assigned) 로 올 때 부른다. tab = 처음 탭 */
  async function load(sb, session, tab) {
    var box = $('adConsultsBody');
    if (!box) return;
    var cfg = window.DADAM_CONFIG || {};
    C.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    C.sb = sb;
    C.session = session;
    C.tab = has(EMPTY_TEXT, tab) ? tab : 'pending';
    C.selectedId = null;
    C.cand = null;
    C.confirm = null;
    C.err = '';
    C.msg = '';
    C.busy = false;
    if (!box.getAttribute('data-bound')) {
      box.setAttribute('data-bound', '1');
      box.addEventListener('click', onClick);
    }
    box.innerHTML = '<p class="sg-note">불러오는 중…</p>';
    await reload();
  }

  window.SeganAdminConsults = {
    ITEM_LABEL: ITEM_LABEL,
    TIME_LABEL: TIME_LABEL,
    DOOR_FINISH_LABEL: DOOR_FINISH_LABEL,
    PRICE_TIER_LABEL: PRICE_TIER_LABEL,
    STATUS_LABEL: STATUS_LABEL,
    ASSIGN_STATE_LABEL: ASSIGN_STATE_LABEL,
    KIND_LABEL: KIND_LABEL,
    FILTER_REASON: FILTER_REASON,
    LOCATION_WHY: LOCATION_WHY,
    SCORE_GROUPS: SCORE_GROUPS,
    state: C,
    canAssign: canAssign,
    groupText: groupText,
    leftText: leftText,
    load: load,
  };
})();
