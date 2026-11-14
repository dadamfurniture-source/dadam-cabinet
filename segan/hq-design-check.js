/* ============================================================
   segan/hq-design-check.js — 마이페이지 관리 › 플랫폼 › 설계 · 학습 점검 (segan/me.html #hqDesignCheck, 주소 #hq-design-check)

   누가 보나  다담 본사 구성원 (account-api GET /partner/me 의 platform_member) — 서버가 본사 대표 · 실장만 연다.
             segan/me.js 가 업체 칸을 읽은 뒤 SeganHqDesignCheck.load(sb, session, partnerMe) 를 부른다.
             못 읽으면(403 not_platform · 404 · 오류 · 끊김) 칸째 감춘다 — 메뉴 줄도 없다.
             DB 준비 전(409 db_pending)이면 칸은 열고 「준비 중」 한 줄.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } — src/hq-design-check.js)
               GET  /hq/design-check                       한눈에 { companies, funnel, pc, suggest, issues, checks, ingest }
               GET  /hq/design-check/reviews?state=&only=  검토 줄 { items }
               POST /hq/design-check/reviews               { group_key, grade, reasons } 검토
               POST /hq/design-check/run                   지금 점검 { ok, steps }
   화면      점검(마지막 점검 걸음 · 「지금 점검」 · 마지막 수집) → 가는 길의 수(앱 플래너 · PC 플래너) →
             팩토리별 → 지난 7일 저장 실패 → 검토 줄(기다림 · 검토함 탭, 「시공 완료만」)
             검토 줄 한 장 = 팩토리 · 출처 · 설계 구성(공간마다 줄 · 모듈 폭) · 장소(시 · 군 · 구) · 사진 · 등급 단추.
             양질은 누르면 바로 저장, 보통 · 제외는 까닭을 고른 뒤 저장한다.
             설계 이름은 이 화면에만 보인다 (학습 자료에는 들어가지 않는다). 사진 주소는 1시간짜리다 — 다시 열면 새로 받는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var GRADES = [
    ['good', '양질'],
    ['normal', '보통'],
    ['exclude', '제외'],
  ];
  var REASONS = [
    ['dimension', '치수 이상'],
    ['incomplete', '구성 미완성'],
    ['photo_blur', '사진 흐림'],
    ['test', '시험 설계'],
  ];
  var SOURCE_NAME = { web: '앱 플래너', pc: 'PC 플래너' };
  var ITEM_NAME = {
    sink: '싱크대',
    wardrobe: '붙박이장',
    shoerack: '신발장',
    fridge: '냉장고장',
    vanity: '화장대',
    storage: '수납장',
    island: '아일랜드',
  };
  var SHAPE_NAME = { I: 'ㅡ자', L: 'ㄱ자', U: 'ㄷ자', island: '아일랜드' };
  var LINE_NAME = { floor: '바닥 줄', upper: '상부 줄', stack: '하부장 위', under: '위장 아래' };
  var PHOTOS_NAME = { always: '늘 제공', on: '사진 제공 켬', off: '사진 제공 끔' };
  var STAGE_NAME = { save: '저장', learn: '묶음 보내기', photo: '사진', open: '열기' };

  var TEXT = {
    lead: '앱 플래너와 PC 플래너의 설계가 학습 자료로 모이는 길을 보고, 모인 설계를 검토합니다.',
    pending: '준비 중입니다 — DB 적용 뒤에 열립니다.',
    loading: '불러오는 중',
    fail: '불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    run: '지금 점검',
    running: '점검하는 중',
    noCheck:
      '아직 점검 기록이 없습니다. 매일 아침 7시에 한 번 돌고, 「지금 점검」으로 바로 볼 수 있습니다.',
    noCompanies: '아직 저장된 설계가 없습니다.',
    noIssues: '지난 7일 동안 저장 실패가 없습니다.',
    emptyWaiting: '검토를 기다리는 설계가 없습니다.',
    emptyDone: '검토한 설계가 없습니다.',
    emptyCompleted: '시공 완료 확인된 설계가 없습니다.',
    save: '이 등급으로 저장',
    saved: '검토를 저장했습니다.',
    saveFail: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    noName: '이름 없는 설계',
    pcName: 'PC 플래너에서 올린 설계',
  };

  var C = {
    sb: null,
    session: null,
    base: '', // workflow-api
    sum: null, // GET /hq/design-check data
    pending: false, // 409 db_pending
    state: 'waiting', // 검토 줄 탭 — waiting · done
    only: false, // 시공 완료만
    items: null, // 검토 줄 (null = 읽는 중)
    pick: {}, // group_key → { grade, reasons[] } (보통 · 제외를 누르고 까닭을 고르는 중)
    busy: '', // 'run' | group_key (저장 중)
    note: '', // 화면 아래 한 줄
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 한국 시간 — 월.일 시:분 */
  function kstTime(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    return (
      pad(k.getUTCMonth() + 1) +
      '.' +
      pad(k.getUTCDate()) +
      ' ' +
      pad(k.getUTCHours()) +
      ':' +
      pad(k.getUTCMinutes())
    );
  }

  var num = function (v) {
    return Number(v) || 0;
  };

  // ── 판정 · 본문 (순수 함수 — 시험이 직접 부른다) ─────────
  /** 다담 본사 구성원 — /partner/me 가 platform_member 로 준다 */
  function canSee(me) {
    return !!me && typeof me === 'object' && !Array.isArray(me) && me.platform_member === true;
  }

  /** GET 본문 → data 객체 | null */
  function dataOf(body) {
    var d = body && body.success === true ? body.data : null;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  }

  /** 점검 한 줄 — 「11.14 07:00 매일 점검 — 다섯 걸음 모두 됨」 */
  function checkLine(c) {
    var steps = Array.isArray(c.steps) ? c.steps : [];
    var bad = steps.filter(function (s) {
      return !s || s.ok !== true;
    }).length;
    return (
      kstTime(c.created_at) +
      ' ' +
      (c.cause === 'manual' ? '손으로 돌린 점검' : '매일 점검') +
      ' — ' +
      (bad ? '막힌 걸음 ' + bad + '곳' : steps.length + '걸음 모두 됨')
    );
  }

  /** 가는 길 — [[이름, 수, 덧글]] (앱 플래너) */
  function funnelRows(f) {
    f = f || {};
    var stuck = [
      num(f.pending) ? '수집 기다림 ' + num(f.pending) : '',
      num(f.failed) ? '수집 오류 ' + num(f.failed) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return [
      ['저장된 설계', num(f.drafts), ''],
      ['받은 학습 묶음', num(f.bundles), stuck],
      ['학습 자료', num(f.samples), ''],
      ['검토 기다림', num(f.waiting), ''],
      [
        '검토함',
        num(f.good) + num(f.normal) + num(f.exclude),
        '양질 ' + num(f.good) + ' · 보통 ' + num(f.normal) + ' · 제외 ' + num(f.exclude),
      ],
      ['앱 설계로 이어짐', num(f.linked), ''],
      ['내보낼 수 있는 것', num(f.exportable), ''],
    ];
  }

  /** 모듈 줄 하나의 폭 비율 — 폭을 모르는 모듈은 600 으로 그린다 (그림용) */
  function barWidths(mods) {
    var ws = (mods || []).map(function (m) {
      return num(m && m.w) > 0 ? num(m.w) : 600;
    });
    var total = ws.reduce(function (a, b) {
      return a + b;
    }, 0);
    return ws.map(function (w) {
      return total ? Math.round((w / total) * 1000) / 10 : 0;
    });
  }

  /** 검토 줄 한 장의 머리 글 — 품목 · 모양 · 장소 · 모듈 · 사진 */
  function metaLine(it) {
    return [
      ITEM_NAME[it.item] || '',
      SHAPE_NAME[it.layout_shape] || '',
      it.region || '',
      '모듈 ' + num(it.modules) + '개',
      '사진 ' + num(it.photo_count) + '장',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** rev 한 줄 — 검토한 뒤 설계가 바뀌었으면 알린다 */
  function revLine(it) {
    if (it.source !== 'web') return '';
    if (it.gone) return '설계 모음에서 빠진 설계입니다';
    if (it.reviewed_rev && it.rev_now && it.reviewed_rev !== it.rev_now)
      return '검토한 rev ' + it.reviewed_rev + ', 지금 ' + it.rev_now;
    if (it.rev_bundle && it.rev_now && it.rev_bundle !== it.rev_now)
      return '받은 묶음 rev ' + it.rev_bundle + ', 지금 ' + it.rev_now;
    return it.rev_now ? 'rev ' + it.rev_now : '';
  }

  // ── 그리기 ─────────────────────────────────────────────
  function factsHtml(rows) {
    return (
      '<dl class="me-facts me-dc-facts">' +
      rows
        .map(function (r) {
          return (
            '<div><dt>' +
            esc(r[0]) +
            '</dt><dd><b>' +
            esc(r[1]) +
            '</b>' +
            (r[2] ? ' <small>' + esc(r[2]) + '</small>' : '') +
            '</dd></div>'
          );
        })
        .join('') +
      '</dl>'
    );
  }

  function checkHtml() {
    var s = C.sum || {};
    var checks = Array.isArray(s.checks) ? s.checks : [];
    var last = checks[0] || null;
    var ing = s.ingest || {};
    var steps = last && Array.isArray(last.steps) ? last.steps : [];
    return (
      '<h3 class="me-pt-sub">점검</h3>' +
      (last
        ? '<p class="me-dc-line' +
          (last.ok ? '' : ' me-dc-bad') +
          '">' +
          esc(checkLine(last)) +
          '</p>' +
          '<ol class="me-dc-steps">' +
          steps
            .map(function (st) {
              return (
                '<li' +
                (st.ok ? '' : ' class="me-dc-bad"') +
                '><b>' +
                (st.ok ? '됨' : '안 됨') +
                '</b><span>' +
                esc(st.label || st.key || '') +
                '</span><small>' +
                esc(st.note || '') +
                '</small></li>'
              );
            })
            .join('') +
          '</ol>'
        : '<p class="me-empty">' + esc(TEXT.noCheck) + '</p>') +
      '<p class="mk-note">마지막 수집 ' +
      esc(ing.last_run ? kstTime(ing.last_run) : '없음') +
      (ing.last_error ? ' · 일부 묶음 오류' : '') +
      ' (10분마다)</p>' +
      '<button type="button" class="mk-btn" data-act="run"' +
      (C.busy === 'run' ? ' disabled' : '') +
      '>' +
      esc(C.busy === 'run' ? TEXT.running : TEXT.run) +
      '</button>'
    );
  }

  function flowHtml() {
    var s = C.sum || {};
    var pc = s.pc || {};
    var sg = s.suggest; // 앱 플래너 「자주 쓴 구성」 카드가 쓰였나 (수만) — 옛 서버 답에는 없다
    return (
      '<h3 class="me-pt-sub">가는 길 — 앱 플래너</h3>' +
      factsHtml(funnelRows(s.funnel)) +
      '<h3 class="me-pt-sub">PC 플래너에서 올린 것</h3>' +
      factsHtml([
        ['올라온 설계', num(pc.designs), '사진 ' + num(pc.photos) + '장'],
        ['시공 완료 확인', num(pc.completed), ''],
        ['검토함', num(pc.graded), ''],
        ['내보낼 수 있는 것', num(pc.exportable), ''],
      ]) +
      (sg
        ? '<h3 class="me-pt-sub">자주 쓴 구성 카드 — 지난 ' +
          num(sg.days) +
          '일</h3>' +
          factsHtml([
            ['보임', num(sg.shown), ''],
            ['누름', num(sg.accepted), ''],
            ['지나침', num(sg.skipped), ''],
          ])
        : '')
    );
  }

  function companiesHtml() {
    var list = (C.sum && Array.isArray(C.sum.companies) ? C.sum.companies : []).filter(
      function (c) {
        return num(c.drafts) || num(c.issues) || num(c.bundles);
      }
    );
    return (
      '<h3 class="me-pt-sub">팩토리별</h3>' +
      (list.length
        ? '<ul class="sg-rows me-dc-cos">' +
          list
            .map(function (c) {
              var sub = [
                '설계 ' + num(c.drafts) + '개',
                c.last_saved ? '마지막 저장 ' + kstTime(c.last_saved) : '',
                '묶음 ' + num(c.bundles) + '개',
                num(c.pending) ? '수집 기다림 ' + num(c.pending) : '',
                num(c.failed) ? '수집 오류 ' + num(c.failed) : '',
                num(c.issues) ? '저장 실패 ' + num(c.issues) + '건' : '',
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                '<li class="sg-row me-dc-co"><span class="me-c-main"><b>' +
                esc(c.name || '이름 없음') +
                '</b><small>' +
                esc(sub) +
                '</small></span><span class="me-badge">' +
                esc(PHOTOS_NAME[c.photos] || '') +
                '</span></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="me-empty">' + esc(TEXT.noCompanies) + '</p>')
    );
  }

  function issuesHtml() {
    var is = (C.sum && C.sum.issues) || {};
    var codes = Array.isArray(is.by_code) ? is.by_code : [];
    return (
      '<h3 class="me-pt-sub">지난 7일 저장 실패</h3>' +
      (num(is.total)
        ? '<p class="me-dc-line">모두 ' +
          num(is.total) +
          '건</p><ul class="me-dc-codes">' +
          codes
            .map(function (c) {
              return (
                '<li><span>' +
                esc((STAGE_NAME[c.stage] || c.stage || '') + ' · ' + (c.code || '')) +
                '</span><b>' +
                num(c.n) +
                '</b></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="me-empty">' + esc(TEXT.noIssues) + '</p>')
    );
  }

  function wallsHtml(walls) {
    return (walls || [])
      .map(function (w) {
        var lines = w && w.lines && typeof w.lines === 'object' ? w.lines : {};
        var keys = ['upper', 'stack', 'under', 'floor'].filter(function (k) {
          return Array.isArray(lines[k]) && lines[k].length;
        });
        if (!keys.length) return '';
        return (
          '<div class="me-dc-wall"><p>' +
          esc(
            (w.name || '공간') + (num(w.length) ? ' ' + num(w.length).toLocaleString('en-US') : '')
          ) +
          '</p>' +
          keys
            .map(function (k) {
              var ws = barWidths(lines[k]);
              return (
                '<div class="me-dc-bar" aria-label="' +
                esc(LINE_NAME[k] || k) +
                '"><small>' +
                esc(LINE_NAME[k] || k) +
                '</small><span>' +
                lines[k]
                  .map(function (m, i) {
                    return (
                      '<i style="flex-basis:' +
                      ws[i] +
                      '%" title="' +
                      esc(m.id || '') +
                      '">' +
                      (num(m.w) ? num(m.w) : '') +
                      '</i>'
                    );
                  })
                  .join('') +
                '</span></div>'
              );
            })
            .join('') +
          '</div>'
        );
      })
      .join('');
  }

  function cardHtml(it) {
    var key = it.group_key;
    var pick = C.pick[key] || null;
    var cur = pick ? pick.grade : it.grade;
    var badges = [
      SOURCE_NAME[it.source] || '',
      it.completed ? '시공 완료 확인' : '',
      it.exportable ? '내보낼 수 있음' : '',
    ]
      .filter(Boolean)
      .map(function (b) {
        return (
          '<span class="me-badge' +
          (b === '시공 완료 확인' ? ' me-badge--completed' : '') +
          '">' +
          esc(b) +
          '</span>'
        );
      })
      .join('');
    var rev = revLine(it);
    var reasons = pick ? pick.reasons : it.reasons || [];
    return (
      '<li class="me-dc-card" data-key="' +
      esc(key) +
      '">' +
      '<div class="me-dc-head"><b>' +
      esc(it.company || '') +
      '</b>' +
      badges +
      '</div>' +
      '<p class="me-dc-name">' +
      esc(it.name || (it.source === 'pc' ? TEXT.pcName : TEXT.noName)) +
      '</p>' +
      '<p class="mk-note">' +
      esc(metaLine(it)) +
      (rev ? ' · ' + esc(rev) : '') +
      '</p>' +
      wallsHtml(it.walls) +
      (Array.isArray(it.photos) && it.photos.length
        ? '<div class="me-dc-photos">' +
          it.photos
            .map(function (p) {
              return (
                '<a href="' +
                esc(p.url) +
                '" target="_blank" rel="noopener"><img src="' +
                esc(p.url) +
                '" alt="' +
                esc(
                  p.kind === 'complete'
                    ? '시공 완료 사진'
                    : p.kind === 'ai'
                      ? 'AI 연출'
                      : '현장사진'
                ) +
                '" loading="lazy"></a>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      '<div class="me-dc-grade" role="group" aria-label="등급">' +
      GRADES.map(function (g) {
        return (
          '<button type="button" class="mk-chip" data-grade="' +
          g[0] +
          '" aria-pressed="' +
          (cur === g[0]) +
          '"' +
          (C.busy === key ? ' disabled' : '') +
          '>' +
          esc(g[1]) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      (pick
        ? '<div class="me-dc-why" role="group" aria-label="까닭">' +
          REASONS.map(function (r) {
            return (
              '<button type="button" class="mk-chip" data-why="' +
              r[0] +
              '" aria-pressed="' +
              (reasons.indexOf(r[0]) >= 0) +
              '">' +
              esc(r[1]) +
              '</button>'
            );
          }).join('') +
          '</div><button type="button" class="mk-btn mk-btn--solid" data-act="save"' +
          (C.busy === key ? ' disabled' : '') +
          '>' +
          esc(TEXT.save) +
          '</button>'
        : it.grade && reasons.length
          ? '<p class="mk-note">까닭 — ' +
            esc(
              REASONS.filter(function (r) {
                return reasons.indexOf(r[0]) >= 0;
              })
                .map(function (r) {
                  return r[1];
                })
                .join(' · ')
            ) +
            '</p>'
          : '') +
      '</li>'
    );
  }

  function reviewsHtml() {
    var f = (C.sum && C.sum.funnel) || {};
    var empty = C.only
      ? TEXT.emptyCompleted
      : C.state === 'done'
        ? TEXT.emptyDone
        : TEXT.emptyWaiting;
    return (
      '<h3 class="me-pt-sub">검토 줄</h3>' +
      '<div class="me-hc-tabs" role="tablist">' +
      [
        ['waiting', '기다림'],
        ['done', '검토함'],
      ]
        .map(function (t) {
          return (
            '<button type="button" role="tab" data-tab="' +
            t[0] +
            '" aria-selected="' +
            (C.state === t[0]) +
            '">' +
            esc(t[1]) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<button type="button" class="mk-chip me-dc-only" data-act="only" aria-pressed="' +
      C.only +
      '">시공 완료만</button>' +
      (C.items === null
        ? '<p class="me-empty">' + esc(TEXT.loading) + '</p>'
        : C.items.length
          ? '<ul class="me-dc-list">' + C.items.map(cardHtml).join('') + '</ul>'
          : '<p class="me-empty">' +
            esc(empty) +
            (C.state === 'waiting' && !C.only && !num(f.bundles)
              ? ' 앱 플래너에서 저장한 설계는 10분 안에 여기로 옵니다.'
              : '') +
            '</p>')
    );
  }

  function render() {
    var box = $('hqDesignCheckBody');
    if (!box) return;
    if (C.pending) {
      box.innerHTML = '<p class="me-empty">' + esc(TEXT.pending) + '</p>';
      return;
    }
    box.innerHTML =
      '<p class="mk-note">' +
      esc(TEXT.lead) +
      '</p>' +
      checkHtml() +
      flowHtml() +
      companiesHtml() +
      issuesHtml() +
      reviewsHtml() +
      (C.note ? '<p class="mk-note me-dc-note" role="status">' + esc(C.note) + '</p>' : '');
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

  /** → { status, body } (끊기면 status 0) */
  async function call(method, path, json) {
    try {
      var headers = { Authorization: 'Bearer ' + (await token()) };
      if (json) headers['Content-Type'] = 'application/json';
      var res = await fetch(C.base + path, {
        method: method,
        headers: headers,
        cache: 'no-store',
        body: json ? JSON.stringify(json) : undefined,
      });
      var body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { status: res.status, body: body };
    } catch {
      return { status: 0, body: null };
    }
  }

  async function loadReviews() {
    var state = C.state;
    var only = C.only;
    C.items = null;
    render();
    var r = await call(
      'GET',
      '/hq/design-check/reviews?state=' + state + (only ? '&only=completed' : '')
    );
    if (C.state !== state || C.only !== only) return; // 그사이 다른 탭으로
    var d = dataOf(r.body);
    C.items =
      d && Array.isArray(d.items)
        ? d.items.filter(function (x) {
            return x && typeof x.group_key === 'string';
          })
        : [];
    if (!d) C.note = TEXT.fail;
    render();
  }

  async function loadSummary() {
    var r = await call('GET', '/hq/design-check');
    var d = dataOf(r.body);
    if (d) C.sum = d;
    return r;
  }

  async function runCheck() {
    if (C.busy) return;
    C.busy = 'run';
    C.note = '';
    render();
    var r = await call('POST', '/hq/design-check/run');
    C.busy = '';
    var d = dataOf(r.body);
    if (!d) C.note = TEXT.fail;
    else {
      // 방금 점검을 맨 위에 — 한눈에를 다시 읽기 전에도 보이게
      C.sum = C.sum || {};
      C.sum.checks = [
        {
          cause: 'manual',
          ok: d.ok === true,
          steps: d.steps || [],
          created_at: d.created_at || new Date().toISOString(),
        },
      ].concat(Array.isArray(C.sum.checks) ? C.sum.checks : []);
    }
    render();
    if (d) {
      await loadSummary();
      render();
    }
  }

  async function saveReview(key, grade, reasons) {
    if (C.busy) return;
    C.busy = key;
    C.note = '';
    render();
    var r = await call('POST', '/hq/design-check/reviews', {
      group_key: key,
      grade: grade,
      reasons: reasons || [],
    });
    C.busy = '';
    if (!dataOf(r.body)) {
      C.note = TEXT.saveFail;
      render();
      return;
    }
    delete C.pick[key];
    C.note = TEXT.saved;
    await Promise.all([loadSummary(), loadReviews()]);
    render();
  }

  function onClick(e) {
    var t = e.target && e.target.closest ? e.target : null;
    var box = $('hqDesignCheckBody');
    if (!t || !box) return;
    // 이 칸 안의 것만 본다 — 앱 틀의 바깥 요소에도 data-tab 같은 이름이 있다
    var up = function (sel) {
      var el = t.closest(sel);
      return el && box.contains(el) ? el : null;
    };
    var act = up('[data-act]');
    var card = up('[data-key]');
    var key = card ? card.getAttribute('data-key') : '';
    if (act && act.getAttribute('data-act') === 'run') return runCheck();
    if (act && act.getAttribute('data-act') === 'only') {
      C.only = !C.only;
      C.pick = {};
      return loadReviews();
    }
    var tab = up('[data-tab]');
    if (tab) {
      if (tab.getAttribute('data-tab') === C.state) return;
      C.state = tab.getAttribute('data-tab') === 'done' ? 'done' : 'waiting';
      C.pick = {};
      C.note = '';
      return loadReviews();
    }
    if (!key) return;
    var g = up('[data-grade]');
    if (g) {
      var grade = g.getAttribute('data-grade');
      // 양질은 까닭이 없다 — 바로 저장. 보통 · 제외는 까닭을 고른 뒤 「이 등급으로 저장」
      if (grade === 'good') return saveReview(key, 'good', []);
      C.pick[key] = { grade: grade, reasons: (C.pick[key] && C.pick[key].reasons) || [] };
      return render();
    }
    var why = up('[data-why]');
    if (why && C.pick[key]) {
      var w = why.getAttribute('data-why');
      var list = C.pick[key].reasons;
      var at = list.indexOf(w);
      if (at >= 0) list.splice(at, 1);
      else list.push(w);
      return render();
    }
    if (act && act.getAttribute('data-act') === 'save' && C.pick[key])
      return saveReview(key, C.pick[key].grade, C.pick[key].reasons.slice());
  }

  /** 설계 · 학습 점검 칸 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data */
  async function load(sb, session, me) {
    var section = $('hqDesignCheck');
    var box = $('hqDesignCheckBody');
    if (!section || !box) return;
    section.hidden = true;
    var cfg = window.DADAM_CONFIG || {};
    C.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    C.sb = sb;
    C.session = session;
    C.sum = null;
    C.pending = false;
    C.state = 'waiting';
    C.only = false;
    C.items = null;
    C.pick = {};
    C.busy = '';
    C.note = '';
    if (!C.base || !session || !canSee(me)) return;
    try {
      var r = await loadSummary();
      var code = r.body && r.body.code;
      if (r.status === 409 && code === 'db_pending') C.pending = true;
      else if (!C.sum) return; // 403 not_platform · 404 · 오류 — 칸째 감춘다
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
      }
      render(); // 모양이 틀린 응답은 여기서 던진다 → 칸째 감춘다
      section.hidden = false;
      if (!C.pending) loadReviews();
    } catch {
      section.hidden = true;
      box.innerHTML = '';
    }
  }

  window.SeganHqDesignCheck = {
    TEXT: TEXT,
    state: C,
    canSee: canSee,
    dataOf: dataOf,
    checkLine: checkLine,
    funnelRows: funnelRows,
    barWidths: barWidths,
    metaLine: metaLine,
    revLine: revLine,
    load: load,
  };
})();
