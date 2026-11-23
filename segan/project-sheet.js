/* ============================================================
   segan/project-sheet.js — 프로젝트 한 건 창 (처음부터 끝까지 한 창에서)

   2026-11-21 대표님 「모든 공정이 자연 스럽게 이어지도록 UI가 배치 되어 있어야하고, 파이프라인도 구축 되어 있어야해」
   — 승인 계획 「프로젝트 한 길」 묶음 4. 새로 생긴 일 표의 프로젝트 이름이 연다 (줄의 「진행 보기」 단추는 11-21 뺌).

   2026-11-23 대표님 「선형 단계를 찍으면 구체적으로 어떤 사진 및 도면, 정보들이 있는지 한눈에」 — 승인 계획
   「프로젝트 관리 새 틀」: 프로젝트 줄의 이름을 눌러도 열린다. 띠의 단계 칸을 누르면 그 단계의 정보 · 일정 ·
   문서 · 사진이 아래에 나온다 (GET /company/projects/:id/stages/:key — SeganPartnerProjects.readStage).
   서버가 단계 띠(stages)를 주지 않으면(옛 서버) 아래의 옛 모습 그대로 그린다.

   창에 있는 것 (위에서부터)
     고객 · 전화 · 담당 · 시작한 날
     단계 띠 · 다음 할 일 — 프로젝트 줄과 같은 것 (SeganPartnerProjects.nextOf · runNext)
     (새 모습) 누른 단계의 칸 — 핵심 정보 · 사진 · 도면 · 문서 · 그 단계에 일어난 일, 맨 아래 「일어난 일 모두」
     일어난 일 — 오래된 것부터 (프로젝트 생김 → 설계 → 견적 → 계약 → 배송 · 완료 → A/S).
       줄 끝에 「누가」 — 구성원 이름 · 고객 · 본사 (일지가 있는 일만 — 2026-11-21 뒤 공정 1차)
     설계 · 견적 · 계약 · 제작 의뢰 · A/S — 있는 것만, 저마다 그 화면으로 가는 링크 (계약은 수주 창을 연다)

   읽기: workflow-api GET /company/projects/:id (src/company-project.js) — SeganPartnerProjects.readProject 가 읽는다
         (로그인 · 주소는 프로젝트 칸의 것을 그대로 쓴다).
   못 읽으면(옛 서버 · 오류) 이미 읽은 프로젝트 줄로 위쪽(고객 · 단계 띠 · 다음 할 일)만 그리고 알린다.
   서버에 쓰지 않는다 — 다음 할 일 단추는 프로젝트 칸이 한다. 금액 · 주소는 오지 않는다.
   창 안의 화면 링크(#p-…)는 창을 닫은 뒤 그 화면으로 간다.
   ============================================================ */
/* global window, document */
(function () {
  'use strict';

  var TEXT = {
    loading: '불러오는 중…',
    failed: '지나온 일을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.',
    none: '프로젝트를 찾을 수 없습니다.',
    noTitle: '프로젝트',
    assignee: '담당 ',
    started: ' 시작',
    history: '일어난 일',
    designs: '설계',
    quotes: '견적',
    orders: '계약',
    requests: '제작 의뢰',
    as: 'A/S',
    noName: '이름 없는 설계',
    edited: ' 고침',
    sent: ' 보냄',
    open: '열기',
    toDesign: '설계 화면',
    toQuote: '견적 화면',
    toMake: '제작 의뢰 화면',
    toAs: 'A/S 화면',
    quoteApproved: '고객 승인',
    quoteRejected: '고객 수정 요청',
    quoteExpired: '답 기한 지남',
    quoteWaiting: '고객 답 기다림',
    views: '번 열어 봄',
    depositPaid: '계약금 받음',
    depositUnpaid: '계약금 전',
    noOrderNo: '번호 없음',
    balancePaid: '잔금 받음',
    balanceUnpaid: '잔금 전',
    whoCustomer: '고객',
    whoAdmin: '본사',
    whoWorker: '작업자',
    whoMember: '구성원',
    held: '보류 중',
    cancelled: '그만둔 프로젝트',
    holdUntil: '다시 볼 날 ',
    // 단계 띠 · 단계 칸 (2026-11-23)
    stages: '단계',
    day: '일',
    dayth: '일째',
    won: '원',
    info: '핵심 정보',
    media: '사진 · 도면',
    docs: '문서',
    schedules: '일정',
    reports: '완료 보고',
    payments: '수금',
    quoteDocs: '고객 확인서',
    stageHistory: '이 단계에 일어난 일',
    allHistory: '일어난 일 모두',
    stageTodo: '아직 이 단계에 오지 않았습니다.',
    stageEmpty: '이 단계에 남은 자료가 없습니다.',
    stageFailed: '이 단계의 자료를 불러오지 못했습니다. 단계 칸을 다시 눌러 주세요.',
    photo: '사진',
    shot: 'AI 연출컷',
    view: '보기',
    rev: '판',
    current: '지금 판',
    request: '요청',
    items: '품목',
    region: '지역',
    wantVisit: '방문 희망',
    wantDone: '완료 희망',
    doorFinish: '도어 마감',
    priceTier: '가격대',
    demolition: '철거',
    yes: '필요',
    no: '필요 없음',
    received: '받은 날',
    visitDay: '실측 날',
    visitDone: '끝낸 때',
    visitWho: '갈 사람',
    visitBtn: '실측 일정',
    planned: '예정',
    memo: '메모',
    modules: '모듈',
    walls: '벽',
    orderNo: '수주 번호',
    state: '상태',
    ordered: '계약한 날',
    amount: '계약 금액',
    openOrder: '수주 창 열기',
    paid: '받음',
    notPaid: '아직',
    due: '받을 날',
    work: '작업 배정',
    schDone: '끝',
    schCancelled: '취소',
    confirmed: '고객 확인',
    notConfirmed: '고객 확인 전',
    asBody: '접수 글',
    asReceived: '받은 날',
    asDone: '끝낸 날',
    asPhoto: '고객 사진',
    itemOpen: '플래너에서 열기',
    itemAdd: '+ 품목 — 플래너에서 더하기',
    uploads: '올린 사진',
    upload: '사진 올리기',
    uploading: '올리는 중',
    uploaded: '장을 올렸습니다.',
    uploadFail: '사진을 올리지 못했습니다.',
    uploadType: 'JPEG · PNG 사진만 올립니다.',
    uploadFull: '한 단계에 올리는 사진이 다 찼습니다.',
    uploadSome: '자리가 모자라 앞의 몇 장만 올립니다.',
    photoDel: '지우기',
    photoDelAsk: '지울까요?',
    photoDelNo: '그만',
    photoDelFail: '사진을 지우지 못했습니다.',
    popup: '새 창이 막혀 문서를 열지 못했습니다. 팝업을 허용해 주세요.',
    printFailed: '문서를 열지 못했습니다.',
  };
  // 수금 줄 종류 — segan/orders.js 와 같은 이름
  var PAY_STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' };
  // 수주 상태 — segan/orders.js STATUS 와 같은 이름 (그 파일이 있으면 그것을 쓴다)
  var ORDER_STATUS = {
    confirmed: '접수',
    in_production: '생산 중',
    delivered: '배송',
    completed: '완료',
    cancelled: '취소',
  };
  // 제작 의뢰 상태 — segan/production-requests.js STATUS_LABEL 과 같은 이름
  var REQUEST_STATUS = {
    submitted: '접수',
    recommending: '본사 검토 중',
    recommended: '추천 도착',
    chosen: '팩토리 답 기다림',
    accepted: '팩토리가 받음',
    declined: '팩토리가 못 받음',
    expired: '팩토리 답 없음',
  };
  // A/S 상태 — segan/as-requests.js STATE_LABEL 과 같은 이름
  var AS_STATE = { requested: '접수', received: '받음', done: '끝', cancelled: '거둠' };

  var S = {
    open: null, // { id, node, handle, data, note }
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }
  function PP() {
    return window.SeganPartnerProjects || null;
  }

  // ── 글 (순수 — 시험이 직접 부른다) ───────────────────────
  /** 때 (한국 시간) — 「2026.11.19 10:12」, 날짜뿐인 값은 「2026.11.19」 (모르면 빈 글자) */
  function whenText(at) {
    if (typeof at !== 'string' || !at) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at.replace(/-/g, '.');
    var t = Date.parse(at);
    if (isNaN(t)) return '';
    var k = new Date(t + 9 * 3600000);
    return (
      k.getUTCFullYear() +
      '.' +
      pad(k.getUTCMonth() + 1) +
      '.' +
      pad(k.getUTCDate()) +
      ' ' +
      pad(k.getUTCHours()) +
      ':' +
      pad(k.getUTCMinutes())
    );
  }
  function dayText(at) {
    return whenText(at).slice(0, 10);
  }

  /** 견적 한 줄의 상태 글 — 고객 승인 · 수정 요청 · 답 기한 지남 · 답 기다림 (+ 몇 번 열어 봄) */
  function quoteText(q, now) {
    var r = obj(q);
    var views = Number(r.view_count) > 0 ? Math.floor(Number(r.view_count)) + TEXT.views : '';
    var state =
      r.decision === 'approved'
        ? TEXT.quoteApproved
        : r.decision === 'rejected'
          ? TEXT.quoteRejected
          : Date.parse(r.expires_at) <= now
            ? TEXT.quoteExpired
            : TEXT.quoteWaiting;
    return [state, views].filter(Boolean).join(' · ');
  }

  /** 누가 — 구성원 이름 · 「고객」 · 「본사」 (모르면 빈 글자). 고객 이름은 오지 않는다 */
  function byText(who) {
    var w = obj(who);
    if (w.kind === 'member') return typeof w.name === 'string' && w.name ? w.name : TEXT.whoMember;
    if (w.kind === 'customer') return TEXT.whoCustomer;
    if (w.kind === 'admin') return TEXT.whoAdmin;
    if (w.kind === 'worker') return TEXT.whoWorker;
    return '';
  }

  /** 보류 · 그만둠 한 줄 — 「보류 중 · 다시 볼 날 2026.12.05 · 「메모」」 (진행 중이면 빈 글자) */
  function stateText(p) {
    var r = obj(p);
    var state = r.status === 'on_hold' ? TEXT.held : r.status === 'cancelled' ? TEXT.cancelled : '';
    if (!state) return '';
    return [
      state,
      r.status === 'on_hold' && typeof r.hold_until === 'string' && r.hold_until
        ? TEXT.holdUntil + r.hold_until.replace(/-/g, '.')
        : '',
      typeof r.status_note === 'string' && r.status_note ? '「' + r.status_note + '」' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** 맨 위 한 줄 — 고객 · 담당 · 시작한 날 (전화는 따로 링크로) */
  function whoText(p) {
    var r = obj(p);
    var who = obj(r.customer).name;
    var a = obj(r.assignee);
    var pp = PP();
    var name = a.user_id ? (pp && pp.personLabel ? pp.personLabel(a) : a.name || '') : '';
    return [
      typeof who === 'string' ? who : '',
      name ? TEXT.assignee + name : '',
      dayText(r.created_at) ? dayText(r.created_at) + TEXT.started : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // ── 그리기 ─────────────────────────────────────────────
  function secHtml(key, title, count, inner, link) {
    return (
      '<section class="od-sec" data-ps="' +
      key +
      '"><h4 class="od-h">' +
      esc(title) +
      (count ? ' <span class="ps-n">' + count + '</span>' : '') +
      '</h4>' +
      inner +
      (link ? '<p class="ps-more"><a href="#' + link[0] + '">' + esc(link[1]) + '</a></p>' : '') +
      '</section>'
    );
  }
  function rowHtml(main, sub, act) {
    return (
      '<li><span class="ps-main">' +
      esc(main) +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</span>' +
      (act || '') +
      '</li>'
    );
  }

  // ── 품목 (2026-11-23 — 서버 project.items: 한 프로젝트에 품목 설계가 여럿일 때 품목마다의 단계 · 다음 할 일) ──
  /** 지금 그리는 프로젝트의 품목 이름표 — { design: { 설계 id: 이름 }, draft: { 초안 id: 이름 } }. 품목이 둘 이상일 때만 채운다 */
  var TAGS = { design: {}, draft: {} };
  function setTags(p) {
    TAGS = { design: {}, draft: {} };
    var items = arr(obj(p).items).filter(function (x) {
      return x && typeof x.label === 'string' && x.label;
    });
    if (items.length < 2) return;
    items.forEach(function (x) {
      if (typeof x.design_id === 'string' && x.design_id) TAGS.design[x.design_id] = x.label;
      if (typeof x.draft_id === 'string' && x.draft_id) TAGS.draft[x.draft_id] = x.label;
    });
  }
  /** 글 앞에 품목 이름을 — 이미 그 이름이 들어 있으면 그대로 */
  function tagged(kind, id, text) {
    var label =
      typeof id === 'string' && Object.prototype.hasOwnProperty.call(TAGS[kind], id)
        ? TAGS[kind][id]
        : '';
    var t = String(text || '');
    return label && t.indexOf(label) < 0 ? label + ' · ' + t : t;
  }
  /**
   * 「품목」 칸 — 품목마다 이름 · 단계 · 그 품목의 다음 할 일 · 「플래너에서 열기」, 맨 아래 「+ 품목」.
   * 값은 프로젝트 칸이 준다 (segan/partner-projects.js itemFlowsOf — 프로젝트 줄과 같은 단추 · 같은 길).
   * 품목이 하나면 다음 할 일은 위의 것과 같아 다시 적지 않는다. 품목이 없으면 칸이 없다.
   */
  function itemsHtml(p) {
    var pp = PP();
    if (!pp || typeof pp.itemFlowsOf !== 'function' || !p.id) return '';
    var items = arr(pp.itemFlowsOf(p));
    if (!items.length) return '';
    var live = !p.status || p.status === 'active';
    var many = items.length > 1;
    var add = live && typeof pp.addItemUrl === 'function' ? pp.addItemUrl(p) : '';
    return (
      '<section data-ps="items">' +
      headHtml(TEXT.items, items.length) +
      '<ul class="pg-items">' +
      items
        .map(function (x) {
          return (
            '<li data-item="' +
            esc(x.key) +
            '"><span class="pg-item-main"><b>' +
            esc(x.label) +
            '</b><small>' +
            esc(x.stepLabel) +
            '</small></span>' +
            (many ? x.note : '') +
            '<div class="rd-acts">' +
            (many ? x.act + (x.tail || '') : '') +
            (x.open
              ? '<a class="mk-btn" href="' +
                esc(x.open) +
                '" data-desktop-tab data-ps="item-open">' +
                esc(TEXT.itemOpen) +
                '</a>'
              : '') +
            '</div></li>'
          );
        })
        .join('') +
      '</ul>' +
      (add
        ? '<div class="rd-acts"><a class="mk-btn" href="' +
          esc(add) +
          '" data-desktop-tab data-ps="item-add">' +
          esc(TEXT.itemAdd) +
          '</a></div>'
        : '') +
      '</section>'
    );
  }

  /** 일어난 일 목록 */
  function historyHtml(list) {
    return (
      '<ol class="ps-history">' +
      list
        .map(function (h) {
          return (
            '<li><time datetime="' +
            esc(h.at) +
            '">' +
            esc(whenText(h.at)) +
            '</time><span>' +
            esc(h.label) +
            (byText(h.who) ? ' <span class="ps-by">· ' + esc(byText(h.who)) + '</span>' : '') +
            '</span></li>'
          );
        })
        .join('') +
      '</ol>'
    );
  }

  // ── 단계 띠 · 단계 칸 (2026-11-23 대표님 「선형 단계를 찍으면 … 사진 및 도면, 정보들이 한눈에」) ──────
  //   띠 = 서버의 stages[] (끝난 단계는 걸린 날, 지금 단계는 머문 날). 칸을 누르면 그 단계의 자료를 읽어 아래에 그린다
  //   (GET /company/projects/:id/stages/:key — 정보 · 일정 · 문서 · 사진. 사진은 한 시간짜리 주소다).
  var MARK = { done: '✓ 끝', now: '● 지금', todo: '○ 아직' };
  var HISTORY_STAGE = {
    'p-quote': 'quote',
    'p-contract': 'contract',
    'p-make': 'make',
    'p-install': 'install',
    'p-as': 'done',
  };

  /** 'MM.DD' (한국 시간) */
  function shortDay(at) {
    var d = dayText(at);
    return d ? d.slice(5) : '';
  }
  function wonText(n) {
    return typeof n === 'number' && isFinite(n)
      ? Math.round(n).toLocaleString('ko-KR') + TEXT.won
      : '';
  }
  /** 단계 이름 — 마지막 칸(끝)은 프로젝트 줄의 띠처럼 「A/S」 */
  function stageLabel(s) {
    return s.key === 'done' ? TEXT.as : s.label;
  }
  /** 서버의 단계 띠 — 모양이 맞는 칸만 */
  function stagesOf(data) {
    return arr(obj(data).stages).filter(function (s) {
      return s && typeof s.key === 'string' && typeof s.label === 'string' && MARK[s.state];
    });
  }
  /** 처음 펼칠 단계 — 지금 단계, 없으면 마지막으로 끝난 단계, 그것도 없으면 첫 칸 */
  function firstStage(stages) {
    var now = stages.filter(function (s) {
      return s.state === 'now';
    })[0];
    var done = stages.filter(function (s) {
      return s.state === 'done';
    });
    return (now || done[done.length - 1] || stages[0] || {}).key || '';
  }
  /** 일어난 일 한 줄이 어느 단계 것인가 */
  function historyStage(h) {
    var r = obj(h);
    if (HISTORY_STAGE[r.go]) return HISTORY_STAGE[r.go];
    var k = typeof r.kind === 'string' ? r.kind : '';
    if (/^as_/.test(k)) return 'done';
    if (/measure|visit/.test(k)) return 'measure';
    if (/^(design|draft)/.test(k)) return 'design';
    if (/^quote/.test(k)) return 'quote';
    if (/^(order_created|deposit|approval|payment)/.test(k)) return 'contract';
    if (/^(request|produce)/.test(k)) return 'make';
    if (/deliver|install|complete/.test(k)) return 'install';
    return 'consult';
  }

  function stripHtml(stages, picked) {
    return (
      '<div class="pg-strip" role="group" aria-label="' +
      esc(TEXT.stages) +
      '" data-ps="strip">' +
      stages
        .map(function (s) {
          var when = s.state === 'todo' ? '' : shortDay(s.from);
          var days =
            typeof s.days === 'number' ? s.days + (s.state === 'now' ? TEXT.dayth : TEXT.day) : '';
          return (
            '<button type="button" class="pg-step pg-' +
            s.state +
            '" data-act="stage" data-key="' +
            esc(s.key) +
            '" aria-pressed="' +
            (s.key === picked) +
            '"><span class="pg-mark">' +
            MARK[s.state] +
            '</span><b>' +
            esc(stageLabel(s)) +
            '</b><small>' +
            esc([when, days].filter(Boolean).join(' · ')) +
            '</small></button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function kvHtml(rows) {
    var live = rows.filter(function (r) {
      return r[1] !== null && r[1] !== undefined && r[1] !== '';
    });
    if (!live.length) return '';
    return (
      '<dl class="pg-kv">' +
      live
        .map(function (r) {
          return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
        })
        .join('') +
      '</dl>'
    );
  }
  function headHtml(title, n) {
    return (
      '<h4 class="od-h">' + esc(title) + (n ? ' <span class="ps-n">' + n + '</span>' : '') + '</h4>'
    );
  }
  /** 사진 격자 — list [{ url, label, at }] (https 주소만 그린다) */
  function photosHtml(list) {
    var ok = arr(list).filter(function (p) {
      return p && typeof p.url === 'string' && /^https:\/\//.test(p.url);
    });
    if (!ok.length) return '';
    return (
      '<ul class="pg-photos" data-ps="photos">' +
      ok
        .map(function (p) {
          var cap = [p.label, shortDay(p.at)].filter(Boolean).join(' · ');
          return (
            '<li><a href="' +
            esc(p.url) +
            '" target="_blank" rel="noopener"><img src="' +
            esc(p.url) +
            '" alt="' +
            esc(p.label || TEXT.photo) +
            '" loading="lazy" /></a><small>' +
            esc(cap) +
            (p.note ? ' · ' + esc(p.note) : '') +
            '</small></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }
  /** 올린 사진인가 — 서버가 단계 사진 맨 앞에 싣는다 (kind 'upload' · DB 0083) */
  function isUpload(p) {
    return !!p && p.kind === 'upload';
  }
  /**
   * 단계 칸의 「올린 사진」 — 격자(내가 지울 수 있는 것에는 지우기) + 「사진 올리기」.
   * info = 서버의 uploads { ready, max, count } · up = 이 창의 올리기 상태 { key, busy, msg, err, ask } · can = 올리는 길이 있다
   */
  function uploadsHtml(key, list, info, up, can) {
    var ups = arr(list).filter(function (p) {
      return isUpload(p) && typeof p.url === 'string' && /^https:\/\//.test(p.url);
    });
    var u = obj(info);
    var st = obj(up).key === key ? obj(up) : {};
    var canAdd = can && u.ready === true;
    if (!ups.length && !canAdd) return '';
    var full = canAdd && Number(u.max) > 0 && Number(u.count) >= Number(u.max);
    var grid = ups.length
      ? '<ul class="pg-photos" data-ps="uploads">' +
        ups
          .map(function (p) {
            var asking = st.ask === p.id;
            var tail =
              !p.mine || !can
                ? ''
                : asking
                  ? ' <span class="pg-ask">' +
                    esc(TEXT.photoDelAsk) +
                    '</span> <button type="button" class="pg-x" data-act="photo-del-yes" data-id="' +
                    esc(p.id) +
                    '"' +
                    (st.busy ? ' disabled' : '') +
                    '>' +
                    esc(TEXT.photoDel) +
                    '</button> <button type="button" class="pg-x" data-act="photo-del-no">' +
                    esc(TEXT.photoDelNo) +
                    '</button>'
                  : ' <button type="button" class="pg-x" data-act="photo-del" data-id="' +
                    esc(p.id) +
                    '">' +
                    esc(TEXT.photoDel) +
                    '</button>';
            return (
              '<li><a href="' +
              esc(p.url) +
              '" target="_blank" rel="noopener"><img src="' +
              esc(p.url) +
              '" alt="' +
              esc(TEXT.uploads) +
              '" loading="lazy" /></a><small>' +
              esc(shortDay(p.at)) +
              tail +
              '</small></li>'
            );
          })
          .join('') +
        '</ul>'
      : '';
    var add = !canAdd
      ? ''
      : full
        ? '<p class="pg-up-note" data-ps="up-full">' + esc(TEXT.uploadFull) + '</p>'
        : '<div class="rd-acts"><label class="mk-btn pg-file' +
          (st.busy ? ' is-busy' : '') +
          '"><input type="file" accept="image/jpeg,image/png" multiple data-ps="file" data-key="' +
          esc(key) +
          '"' +
          (st.busy ? ' disabled' : '') +
          ' />' +
          esc(TEXT.upload) +
          '</label></div>';
    var say = st.err || st.msg;
    return (
      '<div data-ps="upload">' +
      headHtml(TEXT.uploads, ups.length) +
      grid +
      add +
      (say
        ? '<p class="pg-up-note' +
          (st.err ? ' is-err' : '') +
          '" role="status" data-ps="up-msg">' +
          esc(say) +
          '</p>'
        : '') +
      '</div>'
    );
  }
  function schedulesHtml(list) {
    var rows = arr(list).map(function (x) {
      var s = obj(x);
      var state =
        s.status === 'cancelled'
          ? TEXT.schCancelled
          : s.completed_at
            ? TEXT.schDone + ' ' + shortDay(s.completed_at)
            : '';
      var confirm =
        s.customer_confirmed_at === undefined
          ? ''
          : s.customer_confirmed_at
            ? TEXT.confirmed
            : TEXT.notConfirmed;
      return rowHtml(
        tagged('design', s.design_id, (s.label || '') + ' · ' + whenText(s.scheduled_at)),
        [s.assignee_name, state, confirm].filter(Boolean).join(' · ')
      );
    });
    return rows.length ? '<ul class="ps-list" data-ps="schedules">' + rows.join('') + '</ul>' : '';
  }
  function docsHtml(list) {
    var rows = arr(list).map(function (x) {
      var d = obj(x);
      return rowHtml(
        tagged('design', d.design_id, (d.label || '') + (d.doc_no ? ' ' + d.doc_no : '')),
        [d.rev ? d.rev + TEXT.rev : '', dayText(d.created_at)].filter(Boolean).join(' · '),
        printBtn(d.id)
      );
    });
    return rows.length ? '<ul class="ps-list" data-ps="documents">' + rows.join('') + '</ul>' : '';
  }
  function printBtn(id) {
    return id
      ? '<button type="button" class="mk-btn" data-act="print" data-id="' +
          esc(id) +
          '">' +
          esc(TEXT.view) +
          '</button>'
      : '';
  }
  function reportsHtml(list) {
    return arr(list)
      .map(function (x) {
        var r = obj(x);
        return (
          '<div data-ps="report"><p class="ps-who">' +
          esc([r.label, dayText(r.created_at), r.note].filter(Boolean).join(' · ')) +
          '</p>' +
          photosHtml(
            arr(r.photo_urls).map(function (u) {
              return { url: u, label: r.label, at: r.created_at };
            })
          ) +
          '</div>'
        );
      })
      .join('');
  }
  function labelOf(map, v) {
    return map && typeof v === 'string' && map[v] ? map[v] : typeof v === 'string' ? v : '';
  }

  /** 단계마다 — 서버 자료 → 칸의 글. 빈 글자면 그 단계에 남은 자료가 없다 */
  var PANELS = {
    consult: function (d) {
      var C = window.SeganPartnerConsults || {};
      return arr(d.consults)
        .map(function (x) {
          var c = obj(x);
          var items = arr(c.categories)
            .map(function (k) {
              return labelOf(C.ITEMS, k);
            })
            .filter(Boolean)
            .join(' · ');
          return (
            headHtml(TEXT.info) +
            kvHtml([
              [TEXT.request, c.description],
              [TEXT.items, items],
              [TEXT.region, [c.sido, c.gugun].filter(Boolean).join(' ')],
              [
                TEXT.wantVisit,
                [c.preferred_date, labelOf(C.TIME_LABELS, c.preferred_time)]
                  .filter(Boolean)
                  .join(' '),
              ],
              [TEXT.wantDone, c.wanted_done_date],
              [TEXT.doorFinish, labelOf(C.DOOR_FINISH, c.door_finish)],
              [TEXT.priceTier, labelOf(C.PRICE_TIER, c.price_tier)],
              [
                TEXT.demolition,
                c.demolition_needed === true
                  ? TEXT.yes
                  : c.demolition_needed === false
                    ? TEXT.no
                    : '',
              ],
              [TEXT.received, dayText(c.created_at)],
            ]) +
            (c.has_image && c.id
              ? headHtml(TEXT.media) +
                '<ul class="pg-photos"><li><a data-shot="' +
                esc(c.id) +
                '" target="_blank" rel="noopener" hidden><img alt="' +
                esc(TEXT.shot) +
                '" /></a><small>' +
                esc(TEXT.shot) +
                '</small></li></ul>'
              : '')
          );
        })
        .join('');
    },
    measure: function (d, p) {
      var v = d.visit ? obj(d.visit) : null;
      var pp = PP();
      var can = pp && typeof pp.canVisit === 'function' && p.id ? pp.canVisit(p) : false;
      var info = v
        ? kvHtml([
            [
              TEXT.visitDay,
              whenText(v.scheduled_at) + (v.status === 'done' ? '' : ' ' + TEXT.planned),
            ],
            [TEXT.visitDone, v.status === 'done' ? whenText(v.done_at) : ''],
            [TEXT.visitWho, v.assignee_name],
            [TEXT.memo, v.note],
          ])
        : '';
      var act = can
        ? '<div class="rd-acts"><button type="button" class="mk-btn" data-act="visit" data-for="' +
          esc(p.id) +
          '">' +
          esc(TEXT.visitBtn) +
          '</button></div>'
        : '';
      var photos = photosHtml(d.photos);
      if (!info && !photos && !act) return '';
      return (
        (info || act ? headHtml(TEXT.info) + info + act : '') +
        (photos ? headHtml(TEXT.media) + photos : '')
      );
    },
    design: function (d) {
      var drafts = arr(d.drafts).map(function (x) {
        var r = obj(x);
        return rowHtml(
          tagged('draft', r.id, r.name || TEXT.noName),
          [
            r.modules ? TEXT.modules + ' ' + r.modules : '',
            r.walls ? TEXT.walls + ' ' + r.walls : '',
            dayText(r.updated_at) ? dayText(r.updated_at) + TEXT.edited : '',
          ]
            .filter(Boolean)
            .join(' · ')
        );
      });
      var designs = drafts.length
        ? []
        : arr(d.designs).map(function (x) {
            var r = obj(x);
            return rowHtml(
              tagged('design', r.id, r.name || TEXT.noName),
              dayText(r.updated_at) ? dayText(r.updated_at) + TEXT.edited : ''
            );
          });
      var rows = drafts.concat(designs);
      var media = photosHtml(arr(d.renders).concat(arr(d.photos)));
      return (
        (rows.length
          ? headHtml(TEXT.designs, rows.length) + '<ul class="ps-list">' + rows.join('') + '</ul>'
          : '') + (media ? headHtml(TEXT.media) + media : '')
      );
    },
    quote: function (d, p, now) {
      var rows = arr(d.quotes).map(function (x) {
        var q = obj(x);
        return rowHtml(
          tagged(
            'design',
            q.design_id,
            (q.rev ? q.rev + TEXT.rev : TEXT.quotes) +
              (q.current ? ' · ' + TEXT.current : '') +
              (wonText(q.total) ? ' · ' + wonText(q.total) : '')
          ),
          [
            dayText(q.created_at) + TEXT.sent,
            quoteText(q, now),
            q.decided_at ? dayText(q.decided_at) : '',
          ]
            .filter(Boolean)
            .join(' · '),
          printBtn(q.id)
        );
      });
      return rows.length
        ? headHtml(TEXT.quoteDocs, rows.length) +
            '<ul class="ps-list" data-ps="quotes">' +
            rows.join('') +
            '</ul>'
        : '';
    },
    contract: function (d) {
      var status = (window.SeganOrders && window.SeganOrders.STATUS) || ORDER_STATUS;
      return arr(d.orders)
        .map(function (x) {
          var o = obj(x);
          var pays = arr(o.payments).map(function (y) {
            var pay = obj(y);
            return rowHtml(
              (PAY_STAGE[pay.stage] || pay.stage || '') +
                (wonText(pay.amount) ? ' · ' + wonText(pay.amount) : ''),
              pay.paid_on
                ? pay.paid_on.replace(/-/g, '.') + ' ' + TEXT.paid
                : pay.due_on
                  ? TEXT.due + ' ' + pay.due_on.replace(/-/g, '.')
                  : TEXT.notPaid
            );
          });
          return (
            headHtml(tagged('design', o.design_id, TEXT.orders)) +
            kvHtml([
              [TEXT.orderNo, o.order_no || TEXT.noOrderNo],
              [TEXT.state, status[o.status] || ORDER_STATUS[o.status] || ''],
              [TEXT.ordered, dayText(o.ordered_at)],
              [TEXT.amount, wonText(o.amount)],
            ]) +
            '<div class="rd-acts"><button type="button" class="mk-btn" data-act="order" data-id="' +
            esc(o.id) +
            '">' +
            esc(TEXT.openOrder) +
            '</button></div>' +
            (pays.length
              ? headHtml(TEXT.payments) +
                '<ul class="ps-list" data-ps="payments">' +
                pays.join('') +
                '</ul>'
              : '')
          );
        })
        .join('');
    },
    make: function (d, p) {
      var pp = PP();
      var work =
        pp && typeof pp.openWork === 'function' && p.status === 'active'
          ? '<div class="rd-acts"><button type="button" class="mk-btn" data-act="work" data-for="' +
            esc(p.id) +
            '">' +
            esc(TEXT.work) +
            '</button></div>'
          : '';
      var sch = schedulesHtml(d.schedules);
      var docs = docsHtml(d.documents);
      var photos = photosHtml(d.photos);
      var reqs = arr(d.requests).map(function (x) {
        var r = obj(x);
        return rowHtml(REQUEST_STATUS[r.status] || '', dayText(r.status_at));
      });
      if (!sch && !docs && !photos && !reqs.length) return '';
      return (
        (sch ? headHtml(TEXT.schedules) + sch : '') +
        work +
        (reqs.length
          ? headHtml(TEXT.requests, reqs.length) + '<ul class="ps-list">' + reqs.join('') + '</ul>'
          : '') +
        (docs ? headHtml(TEXT.docs) + docs : '') +
        (photos ? headHtml(TEXT.media) + photos : '')
      );
    },
    install: function (d) {
      var sch = schedulesHtml(d.schedules);
      var docs = docsHtml(d.documents);
      var reports = reportsHtml(d.reports);
      var photos = photosHtml(d.photos);
      return (
        (sch ? headHtml(TEXT.schedules) + sch : '') +
        (reports ? headHtml(TEXT.reports) + reports : '') +
        (photos ? headHtml(TEXT.media) + photos : '') +
        (docs ? headHtml(TEXT.docs) + docs : '')
      );
    },
    done: function (d) {
      var list = arr(d.as)
        .map(function (x) {
          var a = obj(x);
          return (
            '<div data-ps="as-item"><p class="ps-who">' +
            esc(
              [a.label || AS_STATE[a.state] || '', dayText(a.created_at)]
                .filter(Boolean)
                .join(' · ')
            ) +
            '</p>' +
            kvHtml([
              [TEXT.asBody, a.body],
              [TEXT.asReceived, dayText(a.received_at)],
              [TEXT.asDone, dayText(a.done_at)],
            ]) +
            photosHtml(
              arr(a.photo_urls).map(function (u) {
                return { url: u, label: TEXT.asPhoto, at: a.created_at };
              })
            ) +
            '</div>'
          );
        })
        .join('');
      var sch = schedulesHtml(d.schedules);
      var reports = reportsHtml(d.reports);
      return (
        (list ? headHtml(TEXT.as) + list : '') +
        (sch ? headHtml(TEXT.schedules) + sch : '') +
        (reports ? headHtml(TEXT.reports) + reports : '')
      );
    },
  };

  /**
   * 누른 단계의 칸 — stage = 띠의 그 칸, got = { loading } | { failed } | { data }, history = 일어난 일 전부
   */
  function panelHtml(stage, got, p, history, now, up) {
    var g = obj(got);
    var inner;
    if (g.loading || (!g.failed && !g.data))
      inner = '<p class="pg-empty">' + esc(TEXT.loading) + '</p>';
    else if (g.failed) inner = '<p class="pg-empty">' + esc(TEXT.stageFailed) + '</p>';
    else {
      var data = obj(g.data);
      setTags(p);
      // 올린 사진은 아래 「올린 사진」 칸이 그린다 — 단계의 원래 칸에는 그 밖의 사진만
      var own = Object.assign({}, data, {
        photos: arr(data.photos).filter(function (x) {
          return !isUpload(x);
        }),
      });
      var make = PANELS[stage.key];
      inner = make ? make(own, obj(p), now) : '';
      var pp = PP();
      var ups = uploadsHtml(
        stage.key,
        data.photos,
        data.uploads,
        up,
        !!pp && typeof pp.sendPhoto === 'function' && typeof pp.removePhoto === 'function'
      );
      if (!inner && !arr(data.photos).some(isUpload))
        inner =
          '<p class="pg-empty">' +
          esc(stage.state === 'todo' ? TEXT.stageTodo : TEXT.stageEmpty) +
          '</p>';
      inner += ups;
    }
    var events = arr(history).filter(function (h) {
      return historyStage(h) === stage.key;
    });
    return (
      '<div class="pg-panel" data-ps="stage" data-key="' +
      esc(stage.key) +
      '">' +
      inner +
      (events.length ? headHtml(TEXT.stageHistory) + historyHtml(events) : '') +
      '</div>'
    );
  }

  /**
   * 창의 몸 — d = GET /company/projects/:id 의 data (못 읽었으면 { project: 이미 읽은 줄 }).
   * view = { stage: 펼친 단계, got: { 단계: { loading | failed | data } } } — 서버가 단계 띠를 줄 때만 쓴다
   */
  function bodyHtml(d, now, view) {
    var data = obj(d);
    var p = obj(data.project);
    var pp = PP();
    var flow = pp && typeof pp.nextOf === 'function' && p.id ? pp.nextOf(p) : null;
    var phone = obj(p.customer).phone;
    var who = whoText(p);
    var html =
      who || phone
        ? '<p class="ps-who">' +
          esc(who) +
          (typeof phone === 'string' && phone
            ? (who ? ' · ' : '') +
              '<a href="tel:' +
              esc(phone.replace(/[^0-9+]/g, '')) +
              '">' +
              esc(phone) +
              '</a>'
            : '') +
          '</p>'
        : '';
    // 보류 · 그만둠이면 그 사정을 한 줄로 (바꾸는 것은 프로젝트 줄의 「보류 · 그만둠」에서)
    if (stateText(p)) html += '<p class="ps-state" data-ps="state">' + esc(stateText(p)) + '</p>';
    // 실측 한 줄 — 프로젝트 줄과 같은 글 (2026-11-21 뒤 공정 2차. 잡고 끝내는 것은 프로젝트 줄에서)
    var visit = pp && typeof pp.visitText === 'function' ? pp.visitText(p) : '';
    if (visit) html += '<p class="ps-state" data-ps="visit">' + esc(visit) + '</p>';
    var history = arr(data.history).filter(function (h) {
      return h && typeof h.label === 'string' && h.label && whenText(h.at);
    });
    var stages = stagesOf(data);
    if (stages.length) {
      // 새 모습 — 단계 띠(누르는 칸) · 다음 할 일 · 누른 단계의 칸 · 일어난 일 모두
      var v = obj(view);
      var picked =
        stages.filter(function (s) {
          return s.key === v.stage;
        })[0] ||
        stages.filter(function (s) {
          return s.key === firstStage(stages);
        })[0];
      html += stripHtml(stages, picked.key);
      if (flow)
        html +=
          (flow.note || '') +
          (flow.act ? '<div class="rd-acts">' + flow.act + (flow.tail || '') + '</div>' : '');
      // 「품목」 칸 — 품목마다 단계 · 다음 할 일 · 플래너에서 열기 (품목이 있을 때만)
      html += itemsHtml(p);
      // 「관리」 칸 — 실측 일정 · 담당자 · 작업 배정 · 보류/그만둠. 프로젝트 칸(segan/partner-projects.js)이 그리고 듣는다
      html += '<div data-ps="manage"></div>';
      html += panelHtml(picked, obj(v.got)[picked.key], p, history, now, v.up);
      if (history.length)
        html +=
          '<details class="pg-all" data-ps="history"><summary>' +
          esc(TEXT.allHistory) +
          ' <span class="ps-n">' +
          history.length +
          '</span></summary>' +
          historyHtml(history) +
          '</details>';
      return html;
    }
    if (flow) {
      html +=
        (flow.strip || '') +
        (flow.note || '') +
        (flow.act ? '<div class="rd-acts">' + flow.act + (flow.tail || '') + '</div>' : '');
    }
    if (history.length) html += secHtml('history', TEXT.history, 0, historyHtml(history));
    var designs = arr(data.designs);
    if (designs.length)
      html += secHtml(
        'designs',
        TEXT.designs,
        designs.length,
        '<ul class="ps-list">' +
          designs
            .map(function (x) {
              var r = obj(x);
              return rowHtml(
                r.name || TEXT.noName,
                dayText(r.updated_at) ? dayText(r.updated_at) + TEXT.edited : ''
              );
            })
            .join('') +
          '</ul>',
        ['p-design', TEXT.toDesign]
      );
    var quotes = arr(data.quotes);
    if (quotes.length)
      html += secHtml(
        'quotes',
        TEXT.quotes,
        quotes.length,
        '<ul class="ps-list">' +
          quotes
            .map(function (q) {
              return rowHtml(dayText(obj(q).created_at) + TEXT.sent, quoteText(q, now));
            })
            .join('') +
          '</ul>',
        ['p-quote', TEXT.toQuote]
      );
    var orders = arr(data.orders);
    var status = (window.SeganOrders && window.SeganOrders.STATUS) || ORDER_STATUS;
    if (orders.length)
      html += secHtml(
        'orders',
        TEXT.orders,
        orders.length,
        '<ul class="ps-list">' +
          orders
            .map(function (x) {
              var o = obj(x);
              var deposit =
                o.status === 'cancelled'
                  ? ''
                  : o.deposit === 'paid'
                    ? TEXT.depositPaid
                    : o.deposit === 'unpaid'
                      ? TEXT.depositUnpaid
                      : '';
              // 잔금 — 끝난 수주에서만 (잔금 줄이 없으면 적지 않는다)
              var balance =
                o.status !== 'completed'
                  ? ''
                  : o.balance === 'paid'
                    ? TEXT.balancePaid
                    : o.balance === 'unpaid'
                      ? TEXT.balanceUnpaid
                      : '';
              return rowHtml(
                (o.order_no || TEXT.noOrderNo) +
                  ' · ' +
                  (status[o.status] || ORDER_STATUS[o.status] || ''),
                [dayText(o.ordered_at), deposit, balance].filter(Boolean).join(' · '),
                '<button type="button" class="mk-btn" data-act="order" data-id="' +
                  esc(o.id) +
                  '">' +
                  esc(TEXT.open) +
                  '</button>'
              );
            })
            .join('') +
          '</ul>'
      );
    var requests = arr(data.requests);
    if (requests.length)
      html += secHtml(
        'requests',
        TEXT.requests,
        requests.length,
        '<ul class="ps-list">' +
          requests
            .map(function (x) {
              var r = obj(x);
              return rowHtml(REQUEST_STATUS[r.status] || '', dayText(r.status_at));
            })
            .join('') +
          '</ul>',
        ['p-make', TEXT.toMake]
      );
    var as = arr(data.as);
    if (as.length)
      html += secHtml(
        'as',
        TEXT.as,
        as.length,
        '<ul class="ps-list">' +
          as
            .map(function (x) {
              var r = obj(x);
              return rowHtml(AS_STATE[r.state] || '', dayText(r.created_at));
            })
            .join('') +
          '</ul>',
        ['p-as', TEXT.toAs]
      );
    return html;
  }

  function paint() {
    var O = S.open;
    if (!O) return;
    var note = O.node.querySelector('[data-ps="note"]');
    var body = O.node.querySelector('[data-ps="body"]');
    note.textContent = O.note || '';
    note.hidden = !O.note;
    var stages = stagesOf(O.data);
    if (stages.length && !O.stage) O.stage = firstStage(stages);
    body.innerHTML = O.data
      ? bodyHtml(O.data, Date.now(), { stage: O.stage, got: O.got, up: O.up })
      : '';
    var Shell = window.SeganShell || {};
    if (Shell.applyLinkTarget)
      body.querySelectorAll('a[data-desktop-tab]').forEach(function (a) {
        Shell.applyLinkTarget(a);
      });
    if (stages.length) {
      mountManage(O, body);
      loadStage(O, O.stage);
      paintShots(O);
    }
  }

  /** 「관리」 칸을 제자리에 — 같은 마디를 다시 끼워 적던 값이 남게 한다 */
  function mountManage(O, body) {
    var pp = PP();
    var slot = body.querySelector('[data-ps="manage"]');
    if (!slot || !pp || typeof pp.mountDetail !== 'function') return;
    slot.appendChild(O.manage);
    pp.mountDetail(O.manage, O.id, {
      onChange: function () {
        refresh(O);
      },
    });
  }

  /** 「관리」 칸에서 한 일로 프로젝트가 바뀌었다 — 띠 · 다음 할 일 · 단계 칸을 다시 읽는다 */
  async function refresh(O) {
    var pp = PP();
    if (S.open !== O || !pp) return;
    var r = await pp.readProject(O.id);
    if (S.open !== O) return;
    if (r && r.ok && r.data && typeof r.data === 'object' && obj(r.data.project).id === O.id) {
      O.data = r.data;
      O.got = {};
      O.note = '';
    }
    paint();
  }

  /** 그 단계의 자료를 읽는다 — 한 번 읽은 단계는 다시 읽지 않는다 (못 읽은 단계는 칸을 다시 누르면 읽는다) */
  async function loadStage(O, key) {
    var pp = PP();
    if (!key || O.got[key] || !pp || typeof pp.readStage !== 'function') return;
    O.got[key] = { loading: true };
    paint();
    var r = await pp.readStage(O.id, key);
    if (S.open !== O) return;
    O.got[key] = r && r.ok && r.data ? { data: r.data } : { failed: true };
    paint();
  }

  // ── 단계 칸에 사진 올리기 · 지우기 (DB 0083) ─────────────────
  var UP_EDGE = 2048; // 긴 변 — 넘으면 줄여 올린다
  var UP_PIXELS = 3600000; // 서버가 받는 화소 수(375만)보다 조금 작게
  var UP_BYTES = 4 * 1024 * 1024;
  /** 올릴 사진을 서버가 받는 크기로 — 줄일 길이 없으면 JPEG · PNG 만 그대로, 그 밖은 null */
  async function shrinkPhoto(file) {
    var plain = !!file && (file.type === 'image/jpeg' || file.type === 'image/png');
    try {
      if (typeof window.createImageBitmap !== 'function') return plain ? file : null;
      var bmp = await window.createImageBitmap(file);
      var k = Math.min(
        1,
        UP_EDGE / Math.max(bmp.width, bmp.height),
        Math.sqrt(UP_PIXELS / (bmp.width * bmp.height))
      );
      if (k === 1 && file.size <= UP_BYTES && plain) return file;
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      var blob = await new Promise(function (ok) {
        c.toBlob(ok, 'image/jpeg', 0.85);
      });
      return blob || (plain ? file : null);
    } catch {
      return plain ? file : null;
    }
  }
  /** 고른 사진을 그 단계에 차례로 올린다 — 올린 것은 읽어 둔 단계 자료 맨 앞에 끼운다 (다시 읽지 않는다) */
  async function uploadPhotos(O, key, files) {
    var pp = PP();
    var d = O.got[key] && O.got[key].data;
    if (!pp || typeof pp.sendPhoto !== 'function' || !d || obj(O.up).busy) return;
    var info = obj(d.uploads);
    var room = Math.max(0, (Number(info.max) || 0) - (Number(info.count) || 0));
    var all = Array.prototype.slice.call(files || []);
    var list = all.slice(0, room);
    if (!list.length) return;
    var up = (O.up = { key: key, busy: true, msg: '', err: '', ask: '' });
    var done = 0;
    for (var i = 0; i < list.length; i++) {
      up.msg = TEXT.uploading + ' (' + (i + 1) + '/' + list.length + ')';
      paint();
      var blob = await shrinkPhoto(list[i]);
      var r = blob ? await pp.sendPhoto(O.id, key, blob) : { ok: false, message: TEXT.uploadType };
      if (S.open !== O || O.up !== up) return;
      if (!r.ok || !r.data) {
        up.err = r.message || TEXT.uploadFail;
        break;
      }
      d.photos = [r.data].concat(arr(d.photos));
      d.uploads = Object.assign({}, info, { count: (Number(obj(d.uploads).count) || 0) + 1 });
      done += 1;
    }
    up.busy = false;
    up.msg = up.err
      ? ''
      : done + TEXT.uploaded + (all.length > list.length ? ' ' + TEXT.uploadSome : '');
    paint();
  }
  /** 올린 사진 한 장을 지운다 (두 번 눌러서) */
  async function removePhoto(O, fileId) {
    var pp = PP();
    var key = O.stage;
    var d = O.got[key] && O.got[key].data;
    if (!pp || typeof pp.removePhoto !== 'function' || !d || !fileId || obj(O.up).busy) return;
    var up = (O.up = { key: key, busy: true, msg: '', err: '', ask: fileId });
    paint();
    var r = await pp.removePhoto(O.id, fileId);
    if (S.open !== O || O.up !== up) return;
    up.busy = false;
    up.ask = '';
    // 이미 지워진 것(404)도 화면에서 뺀다
    if (r.ok || r.status === 404) {
      var before = arr(d.photos).length;
      d.photos = arr(d.photos).filter(function (x) {
        return !(isUpload(x) && x.id === fileId);
      });
      if (d.photos.length < before)
        d.uploads = Object.assign({}, obj(d.uploads), {
          count: Math.max(0, (Number(obj(d.uploads).count) || 0) - 1),
        });
    } else up.err = r.message || TEXT.photoDelFail;
    paint();
  }
  function onChange(e) {
    var O = S.open;
    var el = e.target;
    if (!O || !el || !el.matches || !el.matches('input[type="file"][data-ps="file"]')) return;
    if (O.manage && O.manage.contains(el)) return;
    var files = el.files;
    uploadPhotos(O, el.getAttribute('data-key') || O.stage, files);
  }

  /** 상담의 연출컷 — 본인 토큰으로 받아 그 칸에 채운다 (못 받으면 칸을 뺀다) */
  function paintShots(O) {
    var pp = PP();
    O.node.querySelectorAll('a[data-shot]').forEach(function (a) {
      var id = a.getAttribute('data-shot');
      var put = function (url) {
        if (!url) {
          var li = a.closest('li');
          if (li && li.parentNode && li.parentNode.children.length === 1) li.parentNode.remove();
          else if (li) li.remove();
          return;
        }
        a.href = url;
        a.querySelector('img').src = url;
        a.hidden = false;
      };
      if (O.shots[id] !== undefined) return put(O.shots[id]);
      if (!pp || typeof pp.fetchRaw !== 'function') return;
      O.shots[id] = '';
      pp.fetchRaw('/company/consults/' + encodeURIComponent(id) + '/image')
        .then(function (res) {
          return res && res.ok ? res.blob() : null;
        })
        .then(function (blob) {
          O.shots[id] =
            blob && window.URL && window.URL.createObjectURL
              ? window.URL.createObjectURL(blob)
              : '';
          if (S.open === O) paint();
        })
        .catch(function () {
          O.shots[id] = '';
        });
    });
  }

  /** 문서를 새 창에 — 인쇄 화면은 로그인이 필요해 받아서 쓴다 (segan/project-work.js openPrint 와 같은 방식) */
  async function openPrint(O, docId) {
    var pp = PP();
    if (!docId || !pp || typeof pp.fetchRaw !== 'function') return;
    var win = window.open('', '_blank');
    var fail = function (text) {
      try {
        if (win) win.close();
      } catch {
        /* 이미 닫혔다 */
      }
      O.note = text;
      paint();
    };
    if (!win) return fail(TEXT.popup);
    var res = await pp.fetchRaw('/documents/' + encodeURIComponent(docId) + '/print');
    if (!res || !res.ok) return fail(TEXT.printFailed);
    var html = await res.text();
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  /** 창을 닫고 그 화면으로 — 닫기의 뒤로 가기가 끝난 뒤에 주소를 바꾼다 */
  function leaveTo(hash) {
    var O = S.open;
    var done = O && O.handle && typeof O.handle.close === 'function' ? O.handle.close('nav') : null;
    var move = function () {
      window.location.hash = hash;
    };
    if (done && typeof done.then === 'function') done.then(move, move);
    else move();
  }

  function onClick(e) {
    var O = S.open;
    if (!O || !e.target || !e.target.closest) return;
    // 「관리」 칸 안의 누름은 프로젝트 칸이 듣는다 — 여기서 또 하지 않는다
    if (O.manage && O.manage.contains(e.target)) return;
    var btn = e.target.closest('[data-act]');
    if (btn && !btn.disabled) {
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id') || '';
      var pp = PP();
      if (act === 'stage') {
        var key = btn.getAttribute('data-key') || '';
        // 못 읽은 단계는 다시 누르면 다시 읽는다
        if (O.got[key] && O.got[key].failed) delete O.got[key];
        O.stage = key;
        if (!obj(O.up).busy) O.up = null;
        paint();
        var again = O.node.querySelector('[data-act="stage"][data-key="' + key + '"]');
        if (again && again.focus) again.focus();
      } else if (act === 'photo-del') {
        if (!obj(O.up).busy) {
          O.up = { key: O.stage, busy: false, msg: '', err: '', ask: id };
          paint();
          var yes = O.node.querySelector('[data-act="photo-del-yes"]');
          if (yes && yes.focus) yes.focus();
        }
      } else if (act === 'photo-del-no') {
        if (!obj(O.up).busy) {
          O.up = null;
          paint();
        }
      } else if (act === 'photo-del-yes') {
        removePhoto(O, id);
      } else if (act === 'print') {
        openPrint(O, id);
      } else if (act === 'work' && pp && typeof pp.openWork === 'function') {
        // 작업 배정 — 이 창의 「관리」 칸에서 펼친다
        pp.openWork(btn.getAttribute('data-for') || '');
      } else if (act === 'status' && pp && typeof pp.openStatus === 'function') {
        // 보류를 다시 볼 날 — 「관리」 칸의 다시 진행 · 그만둠
        pp.openStatus(btn.getAttribute('data-for') || '');
      } else if (act === 'order') {
        var Orders = window.SeganOrders;
        var opened = Orders && typeof Orders.open === 'function' ? Orders.open(id) : null;
        // 수주 창이 이 창을 바꾼다. 못 열면 계약 화면으로
        Promise.resolve(opened).then(function (ok) {
          if (!ok) leaveTo('#p-contract');
        });
      } else if (
        (act === 'next-sheet' || act === 'next-order') &&
        pp &&
        typeof pp.runNext === 'function'
      ) {
        pp.runNext(act, id);
      } else if ((act === 'visit' || act === 'next-visit-done') && pp) {
        // 실측 — 이 창의 「관리」 칸에서 한다 (실측 칸을 펼치거나, 그 자리에서 끝낸다). 관리 칸이 없으면(옛 프로젝트 칸) 닫고 줄에서
        var target = btn.getAttribute('data-for') || '';
        var after = function () {
          if (act === 'visit' && typeof pp.openVisit === 'function') pp.openVisit(target);
          else if (act === 'next-visit-done' && typeof pp.runNext === 'function')
            pp.runNext(act, target);
        };
        if (typeof pp.mountDetail === 'function') after();
        else {
          var closing =
            O.handle && typeof O.handle.close === 'function' ? O.handle.close('nav') : null;
          if (closing && typeof closing.then === 'function') closing.then(after, after);
          else after();
        }
      }
      return;
    }
    // 창 안의 앱 화면 링크 — 창을 닫고 간다 (새 탭으로 여는 누름 · 밖으로 나가는 링크는 그대로)
    var a = e.target.closest('a[href^="#"]');
    if (
      !a ||
      e.defaultPrevented ||
      e.button > 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    e.preventDefault();
    leaveTo(a.getAttribute('href'));
  }

  /** 열 수 있나 — 시트와 프로젝트 칸이 있고, 프로젝트를 읽는 길이 있다 */
  function canOpen() {
    var Shell = window.SeganShell;
    var pp = PP();
    return !!(
      Shell &&
      Shell.sheet &&
      typeof Shell.sheet.open === 'function' &&
      pp &&
      typeof pp.readProject === 'function'
    );
  }

  /** 프로젝트 창을 연다. 이미 읽은 줄이 있으면 그것으로 먼저 그리고, 서버에서 읽어 채운다 */
  async function open(id) {
    if (!canOpen() || typeof id !== 'string' || !id) return false;
    if (S.open && S.open.id === id) return true;
    var pp = PP();
    var items = pp.state && pp.state.data ? arr(pp.state.data.items) : [];
    var row = items.filter(function (x) {
      return x && x.id === id;
    })[0];
    var node = document.createElement('div');
    node.className = 'od-detail ps';
    node.innerHTML =
      '<p class="me-pt-msg" role="status" data-ps="note"></p><div data-ps="body"></div>';
    node.addEventListener('click', onClick);
    node.addEventListener('change', onChange);
    var O = {
      id: id,
      node: node,
      handle: null,
      data: row ? { project: row } : null,
      note: TEXT.loading,
      stage: '', // 펼친 단계
      got: {}, // 단계 → { loading | failed | data }
      shots: {}, // 상담 id → 연출컷 blob 주소 ('' = 못 받음)
      up: null, // 사진 올리기 · 지우기 상태 { key, busy, msg, err, ask }
      manage: document.createElement('div'), // 「관리」 칸 자리 — 다시 그려도 같은 마디를 끼운다
    };
    S.open = O;
    O.handle = window.SeganShell.sheet.open({
      title: (row && row.title) || TEXT.noTitle,
      body: node,
      kind: 'sheet',
      onClose: function () {
        if (S.open === O) S.open = null;
        var pp2 = PP();
        if (pp2 && typeof pp2.unmountDetail === 'function') pp2.unmountDetail(O.manage);
      },
    });
    paint();
    var r = await pp.readProject(id);
    if (S.open !== O) return true; // 그 사이에 닫았다
    if (r && r.ok && r.data && typeof r.data === 'object' && obj(r.data.project).id === id) {
      O.data = r.data;
      O.note = '';
    } else {
      O.note = r && r.status === 404 && !row ? TEXT.none : TEXT.failed;
    }
    paint();
    return true;
  }

  window.SeganProjectSheet = {
    TEXT: TEXT,
    state: S,
    whenText: whenText,
    quoteText: quoteText,
    byText: byText,
    stateText: stateText,
    whoText: whoText,
    stagesOf: stagesOf,
    firstStage: firstStage,
    historyStage: historyStage,
    panelHtml: panelHtml,
    itemsHtml: itemsHtml,
    uploadsHtml: uploadsHtml,
    bodyHtml: bodyHtml,
    canOpen: canOpen,
    open: open,
  };
})();
