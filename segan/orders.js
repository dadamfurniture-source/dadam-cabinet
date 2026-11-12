/* ============================================================
   segan/orders.js — 「프로젝트 관리 › 영업 › 계약 · 수금」 안의 수주 · 수금 (segan/me.html #orders · #ordersCollect)

   PC 화면 erp.html(수주 · 수금)을 앱 안으로 옮긴 것 — 서버 · 권한은 그대로, 화면만 「목록 + 오른쪽 상세」 틀로.
   (마이페이지 B안 4단계 — 화면마다 PR 하나. 상세에 수주 정보 · 원가 · 재작업 · 완료 보고 · 설치 후 문항까지 있다)

   누가 보나  다담 공장 구성원 · Manager · Expert · Agent 협력업체 구성원 — account-api GET /partner/me 로 가린다
             (segan/partner-projects.js 와 같다). 금액(계약금액 · 받은 돈 · 수금 일정)은 서버가 대표 · 실장에게만 싣는다 —
             직원 줄에는 금액 칸이 없어 상태만 보인다. 수금 표(#ordersCollect)는 금액을 받는 사람만.
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganOrders.load(sb, session, partnerMe) 를 부른다.
             다담 공장 구성원이면 이 칸을 그렸을 때 업체 칸(#partner)을 연다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET   /orders                      { items[{ id, order_no, customer_name, status, ordered_at, price_tier?,
                                                    contract_amount?, received_amount? }] } — 금액 칸은 권한이 있는 줄만
               GET   /orders/:id                  { order, margin?, costs?, payments?(표가 없으면 null),
                                                    reworks(표가 없으면 null), feedback(표가 없으면 null) }
               PATCH /orders/:id                  { status, reason? } → state 'pending' 이면 대표 승인 요청이 됐다
               PATCH /orders/:id                  { received_amount?, price_tier?, partner_id? } — 구분 · 거래처는 본사 수주만
               POST  /orders/:id/costs            { category, description, vendor_name, counterparty_id, due_on, amount,
                                                    vat_amount, evidence_type, spent_on }
               PATCH /orders/:id/costs/:cid       { spent_on } · DELETE /orders/:id/costs/:cid
               POST  /orders/:id/reworks          { kind, cause, occurred_on, minutes, cost, parts, memo }
               DELETE /orders/:id/reworks/:rid
               GET   /orders/:id/reports          { ready, can_report, items[{ created_at, label, kind, note, photo_urls }] }
               POST  /orders/:id/reports/photo    사진 한 장(본문 그대로) → { photo_path }
               POST  /orders/:id/reports          { kind: 'install_done' | 'as_done', note, photo_paths }
               POST  /orders/:id/feedback-link    { url } — 링크는 이 응답에만 한 번 실린다
               GET   /counterparties              { items[{ id, name, kind: 'partner' | 'supplier', active }] } — 대표 · 실장만
               GET   /orders/:id/events           { status, pending | null, moves[{ to, label, reason_required, request }],
                                                    items[{ created_at, from_status, to_status, kind, reason, state, decided_at }] }
               GET   /order-requests?state=pending { items[…] } — 대표가 아니면 빈 목록
               POST  /order-events/:id/decide     { decision: 'approved' | 'rejected' }
               POST  /orders/:id/payments         { stage, amount, due_on }
               PATCH /orders/:id/payments/:pid    { paid_on: 'YYYY-MM-DD' | null }
               DELETE /orders/:id/payments/:pid
               GET   /company/schedules?from&to   items 중 source 'payment' = 아직 안 받은 수금 일정 (대표 · 실장만 실린다)
   화면      계약 화면 #orders        — 「대표 승인 기다림」(승인 · 반려 · 열기) + 수주 표 (번호 · 고객 · 상태 · 수주일 · 금액)
             수금 화면 #ordersCollect — 계약금액 · 받은 돈 · 미수금 합, 받을 날(지난 60일 ~ 앞으로 30일), 수주마다 표
             줄을 누르면 상세 — SeganShell.sheet kind 'sheet' (폰은 아래 시트 · PC 1100px~ 는 오른쪽 옆 패널):
               금액 요약 · 상태 바꾸기(사유 · 대표 승인 요청) · 수주 정보(수금액 · 구분 · 거래처) ·
               수금 일정(넣기 · 받음 · 되돌리기 · 삭제) · 실적 원가(넣기 · 냈음 · 삭제) · 재작업 · A/S(기록 · 삭제) ·
               설치 · A/S 완료 보고(사진 10장까지) · 설치 후 한 문항(링크 만들기 · 복사) · 상태 기록
               넣는 칸은 접어 둔다(「원가 넣기」 …). 안 바뀐 부분은 다시 그리지 않아 적던 칸이 남는다.
   이름      상태 · 수금 단계 · 온라인 결제 · 원가 분류 · 증빙 · 재작업 원인 이름은 erp.html 과 같다 (워커의 축)
   못 읽으면  처음(403 · 404 · 오류 · 끊김 · 모양이 틀림) → 칸째 감춘다. 승인 요청 · 받을 날만 못 읽으면 그 부분만 뺀다.
             상세에서 못 하면 서버 글을 그 자리에.
   고객 정보  알림 · 주소 · localStorage 에 싣지 않는다 — 화면에만 그린다.
             설치 후 문항 링크는 만든 그때만 보이고 어디에도 남기지 않는다 (상세를 닫으면 사라진다).
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var MEMBER_ROLES = ['owner', 'manager', 'staff'];
  var MONEY_ROLES = ['owner', 'manager']; // 금액을 보는 역할 — 워커가 이 역할에게만 금액 칸을 싣는다
  var PLANS = ['manager', 'expert', 'agent']; // 프로젝트를 가지는 협력업체 — segan/partner-projects.js 와 같다
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var KST_MS = 9 * 3600 * 1000;
  var DAY_MS = 24 * 3600 * 1000;
  var DUE_BACK = 60; // 받을 날 — 며칠 앞까지 밀린 것을 보나 (워커가 한 번에 100일까지 준다)
  var DUE_AHEAD = 30; // 받을 날 — 며칠 뒤까지
  var REASON_MAX = 200;
  var NOTE_MAX = 500; // 완료 보고 메모
  var PHOTOS_MAX = 10; // 완료 보고 한 번에 올리는 사진
  var PHOTO_EDGE = 2048; // 사진 긴 변 — 넘으면 줄여 올린다
  var PHOTO_BYTES = 4 * 1024 * 1024;
  var REPORTS_URL = '../admin/work-reports.html';

  // erp.html 과 같은 이름 (워커 orders.js ORDER_STATUSES · payments.js)
  var STATUS = {
    confirmed: '접수',
    in_production: '생산 중',
    delivered: '배송',
    completed: '완료',
    cancelled: '취소',
  };
  var EVENT_KIND = { revive: '되살리기', revert: '완료 되돌리기' };
  var EVENT_STATE = {
    done: '바로 바뀜',
    pending: '승인 기다림',
    approved: '대표 승인',
    rejected: '반려',
  };
  var PAY_STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' };
  var ONLINE = {
    waiting_deposit: '가상계좌 입금 대기',
    paid: '온라인 결제',
    check_needed: '확인 필요',
    expired: '입금 기한 지남',
    failed: '결제 실패',
  };
  var PAY_METHOD = {
    card: '카드',
    easy_pay: '간편결제',
    virtual_account: '가상계좌',
    transfer: '계좌이체',
  };
  var TIER = { customer: '고객', partner: '거래처' };
  var COST = {
    material: '자재',
    hardware: '부자재',
    labor: '노무',
    outsourcing: '외주',
    logistics: '물류',
    other: '기타',
  };
  var EVIDENCE = {
    tax_invoice: '세금계산서',
    invoice: '계산서',
    card: '카드',
    cash_receipt: '현금영수증',
    simple_receipt: '간이영수증',
    statement: '거래명세표',
    other: '기타',
    none: '증빙 없음',
  };
  var REWORK_KIND = { rework: '재작업 (공장)', as: 'A/S (설치 뒤)' };
  var REWORK_CAUSE = {
    measure: '실측',
    design: '설계',
    cutting: '재단',
    edge: '엣지',
    assembly: '조립',
    install: '설치',
    material: '자재 불량',
    outsource: '외주 불량',
    customer: '고객 변경',
    other: '기타',
  };
  var REPORT_KIND = { install_done: '설치 완료', as_done: 'A/S 완료' };
  // 지우기 — 한 번 더 묻는 말 · 서버 주소 (지운 뒤 알림 DEL_DONE 은 TEXT 아래)
  var DEL_ASK = {
    pay: '이 일정을 지울까요?',
    cost: '이 원가를 지울까요?',
    rework: '이 기록을 지울까요?',
  };
  var DEL_PATH = { pay: 'payments', cost: 'costs', rework: 'reworks' };

  var TEXT = {
    title: '수주',
    collectTitle: '수금',
    empty:
      '수주가 없습니다. 고객이 확인서를 승인하면 상세설계 화면의 업무 루프에서 수주로 전환할 수 있습니다.',
    lead: '수주를 누르면 상태 · 수금 일정 · 원가 · 재작업 · 완료 보고를 적습니다.',
    requests: '대표 승인 기다림',
    approved: '승인했습니다. 수주 상태가 바뀌었습니다.',
    rejected: '반려했습니다. 수주는 그대로입니다.',
    collectLead: '취소한 수주는 뺍니다. 수주를 누르면 수금 일정을 넣고 받음을 적습니다.',
    collectEmpty: '받을 돈을 볼 수주가 없습니다.',
    collectStaff: '수금은 대표 · 실장만 봅니다.',
    dues: '받을 날',
    duesLead:
      '지난 ' + DUE_BACK + '일부터 앞으로 ' + DUE_AHEAD + '일까지, 아직 안 받은 일정입니다.',
    duesEmpty: '이 기간에 받을 일정이 없습니다. 수주를 눌러 수금 일정을 넣어 주세요.',
    byOrder: '수주마다',
    loading: '불러오는 중…',
    detailFail: '수주를 불러오지 못했습니다. 닫았다가 다시 열어 주세요.',
    noCustomer: '고객 미기재',
    statusTitle: '상태',
    movesFail: '바꿀 수 있는 상태를 불러오지 못했습니다. 닫았다가 다시 열어 주세요.',
    moveRequest: '대표가 승인하면 바뀝니다. 그 전까지 수주는 그대로입니다.',
    moveReason: '사유를 적어야 바꿀 수 있습니다.',
    movePick: '바꿀 상태를 골라 주세요.',
    moveReasonEmpty: '사유를 적어 주세요.',
    payTitle: '수금 일정',
    payMissing: '수금 일정 칸이 아직 준비되지 않았습니다.',
    payEmpty: '일정이 없습니다. 계약금 · 중도금 · 잔금을 받기로 한 날과 함께 넣어 주세요.',
    payAmount: '금액을 넣어 주세요.',
    payDue: '받기로 한 날을 넣어 주세요.',
    payAdded: '수금 일정을 넣었습니다.',
    payPaid: '받은 것으로 적었습니다.',
    payUnpaid: '받음을 되돌렸습니다.',
    payDeleted: '수금 일정을 지웠습니다.',
    infoTitle: '수주 정보',
    infoScheduled: '수금액은 수금 일정의 받은 합입니다. 일정에서 받음을 눌러 주세요.',
    infoSaved: '수주 정보를 저장했습니다.',
    costTitle: '실적 원가',
    costEmpty: '입력된 원가가 없습니다.',
    costAmount: '공급가를 입력해 주세요.',
    costVat: '부가세는 0 이상으로 입력해 주세요.',
    costAdded: '원가를 추가했습니다.',
    costPaid: '낸 것으로 적었습니다.',
    costDeleted: '원가를 지웠습니다.',
    reworkTitle: '재작업 · A/S',
    reworkMissing: '재작업 · A/S 기록 칸이 아직 준비되지 않았습니다.',
    reworkEmpty: '적은 재작업 · A/S 가 없습니다.',
    reworkAdded: '재작업 · A/S 를 기록했습니다.',
    reworkDeleted: '기록을 지웠습니다.',
    reportTitle: '설치 · A/S 완료 보고',
    reportLead: '설치 · A/S 를 마치면 사진과 함께 남깁니다. 본사에는 기록으로 갑니다 (검수 없음).',
    reportFail: '완료 보고를 불러오지 못했습니다.',
    reportMissing: '완료 보고 칸이 아직 준비되지 않았습니다.',
    reportEmpty: '아직 보고가 없습니다.',
    reportMany: '사진은 ' + PHOTOS_MAX + '장까지입니다.',
    reportUploading: '사진 올리는 중…',
    reportSending: '보내는 중…',
    reportPhotoFail: '사진을 올리지 못했습니다',
    reportsLink: '작업 지시 보고 ↗',
    fbTitle: '설치 후 한 문항',
    fbMissing: '설치 후 문항 칸이 아직 준비되지 않았습니다.',
    fbNone: '아직 보내지 않았습니다. 설치가 끝나면 링크를 만들어 고객에게 문자로 보내 주세요.',
    fbExpired: '보낸 링크의 기간이 지났습니다. 새 링크를 만들어 다시 보내 주세요.',
    fbMade: '링크를 만들었습니다. 복사해서 고객에게 문자로 보내 주세요.',
    fbCopied: '링크를 복사했습니다.',
    fbPicked: '링크를 골랐습니다. 길게 눌러(PC 는 Ctrl+C) 복사해 주세요.',
    eventsTitle: '상태 기록',
    eventsEmpty: '상태가 바뀐 기록이 아직 없습니다.',
    eventsFail: '상태 기록을 불러오지 못했습니다.',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
  };
  var DEL_DONE = { pay: TEXT.payDeleted, cost: TEXT.costDeleted, rework: TEXT.reworkDeleted };

  var J = {
    base: '',
    sb: null,
    session: null,
    me: null,
    orders: null, // 읽은 수주 (orderOf) — null 이면 못 읽음
    requests: [], // 대표 승인 기다림
    dues: null, // 받을 날 — null 이면 못 읽음(그 부분을 뺀다)
    money: false, // 금액을 보는 사람인가
    today: '',
    cp: undefined, // 거래처 · 공급처 — undefined 아직 안 읽음 · null 못 읽음(권한 없음 포함) · 배열
    // 열린 상세 { id, node, handle, detail, events, eventsFailed, reports, reportsFailed, feedbackUrl, to, del, busy }
    open: null,
  };

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v) {
    return typeof v === 'string' ? v : '';
  }
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  /** 원 — 값이 없으면 '-' */
  function krw(n) {
    if (n === null || n === undefined || n === '') return '-';
    var v = Number(n);
    return isFinite(v) ? v.toLocaleString('ko-KR') + '원' : '-';
  }
  /** 한국 오늘 'YYYY-MM-DD' */
  function todayKst(nowMs) {
    return new Date((nowMs == null ? Date.now() : nowMs) + KST_MS).toISOString().slice(0, 10);
  }
  function addDays(day, n) {
    return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
  }
  /** 'YYYY-MM-DD' → 'YYYY.MM.DD' (날짜가 아니면 '-') */
  function dot(day) {
    return DAY_RE.test(str(day)) ? day.replace(/-/g, '.') : '-';
  }
  /** 때 — 한국 시각 'YYYY.MM.DD HH:mm' */
  function whenKst(iso) {
    var t = Date.parse(iso);
    if (!iso || isNaN(t)) return '-';
    var s = new Date(t + KST_MS).toISOString();
    return s.slice(0, 10).replace(/-/g, '.') + ' ' + s.slice(11, 16);
  }
  /** 날 — 한국 날짜 'YYYY.MM.DD' */
  function dayKst(iso) {
    var w = whenKst(iso);
    return w === '-' ? w : w.slice(0, 10);
  }
  /** 「접수 → 생산 중 (되살리기)」 */
  function moveText(e) {
    e = e || {};
    return (
      (STATUS[e.from_status] || str(e.from_status) || '-') +
      ' → ' +
      (STATUS[e.to_status] || str(e.to_status) || '-') +
      (EVENT_KIND[e.kind] ? ' (' + EVENT_KIND[e.kind] + ')' : '')
    );
  }
  /** 온라인 결제 한 줄 — { text, warn } (없으면 null). 확인 필요의 서버 메모는 warn 으로 따로 */
  function onlineText(o) {
    if (!o || typeof o !== 'object' || !ONLINE[o.status]) return null;
    var t = ONLINE[o.status];
    if (o.status !== 'waiting_deposit' && PAY_METHOD[o.method]) t += ' · ' + PAY_METHOD[o.method];
    var va = o.virtual_account;
    if (o.status === 'waiting_deposit' && va && va.due_at) t += ' (기한 ' + dayKst(va.due_at) + ')';
    var warn = '';
    if (o.status === 'check_needed') {
      t += ' · 들어온 돈 ' + krw(o.amount_received);
      warn = str(o.status_note);
    }
    return { text: t, warn: warn };
  }

  function isHq(me) {
    return !!me && typeof me === 'object' && !Array.isArray(me) && me.hq_member === true;
  }
  function companyOf(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me)) return null;
    var c = me.company;
    return c && typeof c === 'object' ? c : null;
  }
  /** 수주를 보는 사람 — 다담 공장 구성원 · Manager 이상 협력업체 구성원 */
  function canSee(me) {
    if (isHq(me)) return true;
    var c = companyOf(me);
    return !!(c && PLANS.indexOf(c.plan) >= 0 && MEMBER_ROLES.indexOf(c.role) >= 0);
  }
  /** 수주 한 줄 — 금액 칸은 서버가 실은 줄만 (money) */
  function orderOf(raw) {
    if (!raw || typeof raw !== 'object' || !UUID_RE.test(str(raw.id))) return null;
    var money = has(raw, 'contract_amount');
    return {
      id: raw.id,
      order_no: str(raw.order_no),
      customer_name: str(raw.customer_name),
      status: str(raw.status),
      ordered_at: str(raw.ordered_at),
      partner: raw.price_tier === 'partner',
      money: money,
      contract: money ? num(raw.contract_amount) : null,
      received: money ? num(raw.received_amount) : null,
    };
  }
  function ordersOf(body) {
    var d = body && body.data;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    return d.items.map(orderOf).filter(Boolean);
  }
  /** 금액을 보는 사람 — 금액이 실린 줄이 있거나, 업체의 대표 · 실장 */
  function moneyViewer(me, orders) {
    if (
      (orders || []).some(function (o) {
        return o.money;
      })
    )
      return true;
    var c = companyOf(me);
    return !!(c && MONEY_ROLES.indexOf(c.role) >= 0);
  }
  function outstandingOf(o) {
    return o && o.money ? o.contract - o.received : null;
  }
  /** 수금 표에 올리는 수주 — 금액이 실리고 취소가 아닌 것 */
  function collectRows(orders) {
    return (orders || []).filter(function (o) {
      return o.money && o.status !== 'cancelled';
    });
  }
  function totalsOf(rows) {
    return rows.reduce(
      function (t, o) {
        t.contract += o.contract;
        t.received += o.received;
        t.outstanding += o.contract - o.received;
        return t;
      },
      { contract: 0, received: 0, outstanding: 0 }
    );
  }
  /** 받을 날을 묻는 기간 — 오늘 앞 DUE_BACK 일 ~ 뒤 DUE_AHEAD 일 */
  function dueRange(today) {
    return { from: addDays(today, -DUE_BACK), to: addDays(today, DUE_AHEAD) };
  }
  /** /company/schedules 응답 → 받을 날 줄 (source payment 만, 날짜 차례) */
  function duesOf(body, today) {
    var d = body && body.data;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    return d.items
      .filter(function (x) {
        return x && typeof x === 'object' && x.source === 'payment' && DAY_RE.test(str(x.day));
      })
      .map(function (x) {
        var stage = str(x.type).replace(/^payment_/, '');
        return {
          day: x.day,
          stage: PAY_STAGE[stage] || '결제',
          order_no: str(x.order_no),
          amount: num(x.amount),
          late: x.day < today,
        };
      })
      .sort(function (a, b) {
        return a.day < b.day ? -1 : a.day > b.day ? 1 : 0;
      });
  }
  /** 수금 일정 합 한 줄 — 「일정 합 · 받은 돈 · 남은 돈」(+ 계약금액과 다르면 그 말) */
  function paySummary(pays, contract) {
    var planned = 0;
    var got = 0;
    (pays || []).forEach(function (p) {
      var a = num(p && p.amount);
      planned += a;
      if (p && p.paid_on) got += a;
    });
    return (
      '일정 합 ' +
      krw(planned) +
      ' · 받은 돈 ' +
      krw(got) +
      ' · 남은 돈 ' +
      krw(planned - got) +
      (planned !== num(contract) ? ' — 계약금액 ' + krw(contract) + ' 과 다릅니다' : '')
    );
  }
  /** 승인을 기다리는 수주 id — 요청 목록 + 열린 수주의 기다리는 요청 */
  function pendingIds() {
    var ids = {};
    (J.requests || []).forEach(function (r) {
      if (r && r.order_id) ids[r.order_id] = true;
    });
    if (J.open && J.open.events && J.open.events.pending) ids[J.open.id] = true;
    return ids;
  }

  function showSection() {
    if (!isHq(J.me)) return;
    var section = $('partner');
    var shown = ['orders', 'ordersCollect'].some(function (id) {
      var b = $(id);
      return b && !b.hidden;
    });
    if (section && shown) section.hidden = false;
  }

  async function token() {
    try {
      var r = J.sb && (await J.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return J.session ? J.session.access_token : '';
  }
  /** 보낸다 — init { type, body } 는 본문을 그대로 (사진 올리기). 없으면 본문 없이 */
  async function send(method, path, init) {
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (init) headers['Content-Type'] = init.type;
    var res;
    try {
      res = await fetch(J.base + path, {
        method: method,
        headers: headers,
        body: init ? init.body : undefined,
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
  function call(method, path, body) {
    return send(
      method,
      path,
      body ? { type: 'application/json', body: JSON.stringify(body) } : null
    );
  }
  function errText(r) {
    var m = r && r.body && r.body.message;
    return typeof m === 'string' && m ? m : TEXT.generic;
  }

  /** 목록을 다시 읽는다 — 수주를 못 읽으면 false (승인 요청 · 받을 날은 못 읽어도 그 부분만 뺀다) */
  async function refresh() {
    var got = await Promise.all([
      call('GET', '/orders'),
      call('GET', '/order-requests?state=pending'),
    ]);
    var orders = got[0].ok ? ordersOf(got[0].body) : null;
    if (!orders) return false;
    var rq = got[1].ok && got[1].body.data && got[1].body.data.items;
    J.orders = orders;
    J.requests = Array.isArray(rq)
      ? rq.filter(function (r) {
          return (
            r && typeof r === 'object' && UUID_RE.test(str(r.id)) && UUID_RE.test(str(r.order_id))
          );
        })
      : [];
    J.money = moneyViewer(J.me, orders);
    J.today = todayKst();
    J.dues = null;
    if (J.money) {
      var range = dueRange(J.today);
      var d = await call('GET', '/company/schedules?from=' + range.from + '&to=' + range.to);
      J.dues = d.ok ? duesOf(d.body, J.today) : null;
    }
    return true;
  }

  // ── 목록 ───────────────────────────────────────────
  function badge(text) {
    return ' <span class="od-badge">' + esc(text) + '</span>';
  }
  function openCell(o) {
    return (
      '<th scope="row"><button type="button" class="od-open" data-act="open" data-id="' +
      esc(o.id) +
      '">' +
      esc(o.order_no || '-') +
      '</button></th>'
    );
  }
  function amountCell(v, dim) {
    return '<td class="od-num' + (dim ? ' od-dim' : '') + '">' + esc(krw(v)) + '</td>';
  }
  function tableHtml(heads, rows) {
    return (
      '<div class="od-tablewrap"><table class="od-table"><thead><tr>' +
      heads
        .map(function (h) {
          return '<th scope="col"' + (h[1] ? ' class="od-num"' : '') + '>' + esc(h[0]) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      rows.join('') +
      '</tbody></table></div>'
    );
  }
  function rowHtml(o, cells) {
    var on = J.open && J.open.id === o.id;
    return (
      '<tr class="od-row' +
      (on ? ' od-row--on' : '') +
      '" data-act="open" data-id="' +
      esc(o.id) +
      '">' +
      cells.join('') +
      '</tr>'
    );
  }
  function requestsHtml() {
    if (!J.requests.length) return '';
    return (
      '<div class="me-pt-box od-req"><h4 class="od-h">' +
      esc(TEXT.requests) +
      '</h4><ul class="me-pt-list">' +
      J.requests
        .map(function (r) {
          return (
            '<li class="me-pt-row"><span class="me-pt-line"><span class="me-c-main"><b>' +
            esc((str(r.order_no) || '-') + ' · ' + (str(r.customer_name) || '-')) +
            '</b><small>' +
            esc(
              moveText(r) + (str(r.reason) ? ' · ' + r.reason : '') + ' · ' + whenKst(r.created_at)
            ) +
            '</small></span></span><div class="rd-acts">' +
            '<button type="button" class="mk-btn mk-btn--solid" data-act="approve" data-id="' +
            esc(r.id) +
            '">승인</button><button type="button" class="mk-btn" data-act="reject" data-id="' +
            esc(r.id) +
            '">반려</button><button type="button" class="mk-btn" data-act="open" data-id="' +
            esc(r.order_id) +
            '">열기</button></div></li>'
          );
        })
        .join('') +
      '</ul></div>'
    );
  }
  function ordersHtml() {
    var pending = pendingIds();
    var heads = [['수주번호'], ['고객'], ['상태'], ['수주일']];
    if (J.money) heads.push(['계약금액', true], ['미수금', true]);
    var rows = J.orders.map(function (o) {
      var cells = [
        openCell(o),
        '<td>' + esc(o.customer_name || '-') + (o.partner ? badge('거래처') : '') + '</td>',
        '<td>' +
          esc(STATUS[o.status] || o.status || '-') +
          (pending[o.id] ? badge(EVENT_STATE.pending) : '') +
          '</td>',
        '<td>' + esc(dayKst(o.ordered_at)) + '</td>',
      ];
      if (J.money) {
        var out = outstandingOf(o);
        cells.push(amountCell(o.contract), amountCell(out, out === 0));
      }
      return rowHtml(o, cells);
    });
    return (
      '<h3 class="me-pt-sub" id="ordersTitle">' +
      esc(TEXT.title) +
      '</h3>' +
      requestsHtml() +
      '<p class="me-pt-msg" role="status" data-od="msg"></p>' +
      (J.orders.length
        ? '<p class="mk-note">' + esc(TEXT.lead) + '</p>' + tableHtml(heads, rows)
        : '<p class="me-empty">' + esc(TEXT.empty) + '</p>')
    );
  }
  function duesHtml() {
    if (!J.dues) return '';
    var byNo = {};
    J.orders.forEach(function (o) {
      if (o.order_no) byNo[o.order_no] = o.id;
    });
    return (
      '<h4 class="od-h">' +
      esc(TEXT.dues) +
      '</h4><p class="mk-note">' +
      esc(TEXT.duesLead) +
      '</p>' +
      (J.dues.length
        ? '<ul class="me-pt-list od-dues">' +
          J.dues
            .map(function (d) {
              var id = byNo[d.order_no];
              var name =
                '<b>' +
                esc(d.stage + ' ' + krw(d.amount)) +
                '</b><small>' +
                esc(d.order_no || '-') +
                '</small>';
              return (
                '<li class="me-pt-row"><span class="me-pt-line"><span class="od-day' +
                (d.late ? ' od-late' : '') +
                '">' +
                esc(dot(d.day) + (d.late ? ' (밀림)' : '')) +
                '</span>' +
                (id
                  ? '<button type="button" class="od-open me-c-main" data-act="open" data-id="' +
                    esc(id) +
                    '">' +
                    name +
                    '</button>'
                  : '<span class="me-c-main">' + name + '</span>') +
                '</span></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="me-empty">' + esc(TEXT.duesEmpty) + '</p>')
    );
  }
  function collectHtml() {
    var head = '<h3 class="me-pt-sub" id="ordersCollectTitle">' + esc(TEXT.collectTitle) + '</h3>';
    // 다담 공장 구성원은 역할이 /partner/me 에 없다 — 수주가 하나도 없으면 금액을 보는 사람인지 알 수 없어 「없음」으로
    if (!J.money)
      return (
        head +
        '<p class="me-empty">' +
        esc(isHq(J.me) && !J.orders.length ? TEXT.collectEmpty : TEXT.collectStaff) +
        '</p>'
      );
    var list = collectRows(J.orders);
    if (!list.length) return head + '<p class="me-empty">' + esc(TEXT.collectEmpty) + '</p>';
    var t = totalsOf(list);
    var rows = list.map(function (o) {
      var out = outstandingOf(o);
      return rowHtml(o, [
        openCell(o),
        '<td>' + esc(o.customer_name || '-') + '</td>',
        '<td>' + esc(STATUS[o.status] || o.status || '-') + '</td>',
        amountCell(o.contract),
        amountCell(o.received),
        amountCell(out, out === 0),
      ]);
    });
    return (
      head +
      '<p class="mk-note">' +
      esc(TEXT.collectLead) +
      '</p><p class="me-pt-msg" role="status" data-od="msg"></p>' +
      kpiHtml([
        ['계약금액', krw(t.contract)],
        ['받은 돈', krw(t.received)],
        ['미수금', krw(t.outstanding)],
      ]) +
      duesHtml() +
      '<h4 class="od-h">' +
      esc(TEXT.byOrder) +
      '</h4>' +
      tableHtml(
        [['수주번호'], ['고객'], ['상태'], ['계약금액', true], ['받은 돈', true], ['미수금', true]],
        rows
      )
    );
  }
  function kpiHtml(pairs) {
    return (
      '<dl class="od-kpi">' +
      pairs
        .map(function (p) {
          return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>';
        })
        .join('') +
      '</dl>'
    );
  }
  /** 두 칸을 다시 그린다 — 한 줄 알림(msg)은 지금 보이는 칸에 */
  function render(msg) {
    var box = $('orders');
    if (box) {
      box.innerHTML = ordersHtml();
      box.hidden = false;
    }
    var col = $('ordersCollect');
    if (col) {
      col.innerHTML = collectHtml();
      col.hidden = false;
    }
    if (msg) say(msg);
    showSection();
  }
  function say(text) {
    document
      .querySelectorAll('#orders [data-od="msg"], #ordersCollect [data-od="msg"]')
      .forEach(function (el) {
        el.textContent = text || '';
      });
  }

  // ── 상세 (시트) ─────────────────────────────────────
  function sheetApi() {
    var S = window.SeganShell;
    return S && S.sheet && typeof S.sheet.open === 'function' ? S.sheet : null;
  }
  function hasMoney(d) {
    return !!(d && d.margin && typeof d.margin === 'object');
  }
  function part(name) {
    return J.open && J.open.node
      ? J.open.node.querySelector('[data-od-part="' + name + '"]')
      : null;
  }
  function note(text) {
    var n = J.open && J.open.node ? J.open.node.querySelector('[data-od="note"]') : null;
    if (n) n.textContent = text || '';
    fail('');
  }
  function fail(text) {
    var e = J.open && J.open.node ? J.open.node.querySelector('[data-od="err"]') : null;
    if (!e) return;
    e.textContent = text || '';
    e.hidden = !text;
  }
  function summaryHtml(O) {
    var d = O.detail;
    var o = (d && d.order) || {};
    var pairs = [['수주일', dayKst(o.ordered_at)]];
    if (hasMoney(d)) {
      var m = d.margin;
      pairs.push(
        ['계약금액', krw(m.contract_amount)],
        ['수금', krw(m.received_amount)],
        ['미수금', krw(m.outstanding)],
        ['실적 원가', krw(m.cost_total)],
        [
          '마진',
          krw(m.margin) +
            (m.margin_rate !== null && m.margin_rate !== undefined
              ? ' (' + m.margin_rate + '%)'
              : ''),
        ]
      );
      if (m.quoted_total !== null && m.quoted_total !== undefined)
        pairs.push(['견적 총액(참고)', krw(m.quoted_total)]);
    }
    return kpiHtml(pairs);
  }
  function movesOf(O) {
    var ev = O.events;
    return ev && !ev.pending && Array.isArray(ev.moves)
      ? ev.moves.filter(function (m) {
          return m && typeof m === 'object' && STATUS[m.to];
        })
      : [];
  }
  function statusHtml(O) {
    var d = O.detail;
    var ev = O.events;
    var now = (ev && str(ev.status)) || (d && d.order && str(d.order.status)) || '';
    var moves = movesOf(O);
    var m = moves.filter(function (x) {
      return x.to === O.to;
    })[0];
    var hint = '';
    if (O.eventsFailed) hint = TEXT.movesFail;
    else if (m && m.request) hint = TEXT.moveRequest;
    else if (m && m.reason_required) hint = TEXT.moveReason;
    var pending = ev && ev.pending;
    return (
      '<h3 class="me-pt-sub">' +
      esc(TEXT.statusTitle) +
      '</h3><p class="od-now">지금 <b>' +
      esc(STATUS[now] || now || '-') +
      '</b></p>' +
      (pending
        ? '<p class="mk-note">' +
          esc(
            '대표 승인을 기다리는 요청: ' +
              moveText(pending) +
              (str(pending.reason) ? ' · ' + pending.reason : '') +
              ' — 승인 · 반려 전에는 상태를 바꿀 수 없습니다.'
          ) +
          '</p>'
        : '') +
      '<form class="od-form" data-form="move" novalidate><label class="mk-input"><span>바꿀 상태</span>' +
      '<select name="to" data-fk="to"' +
      (moves.length ? '' : ' disabled') +
      '>' +
      (moves.length
        ? '<option value="">고르기</option>' +
          moves
            .map(function (x) {
              return (
                '<option value="' +
                esc(x.to) +
                '"' +
                (x.to === O.to ? ' selected' : '') +
                '>' +
                esc((str(x.label) || STATUS[x.to]) + (x.request ? ' — 대표 승인 요청' : '')) +
                '</option>'
              );
            })
            .join('')
        : '<option value="">' + (pending ? EVENT_STATE.pending : '없음') + '</option>') +
      '</select></label>' +
      (m && m.reason_required
        ? '<label class="mk-input"><span>사유</span><input type="text" name="reason" maxlength="' +
          REASON_MAX +
          '" autocomplete="off" /></label>'
        : '') +
      (hint ? '<p class="mk-note">' + esc(hint) + '</p>' : '') +
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid"' +
      (moves.length ? '' : ' disabled') +
      '>' +
      (m && m.request ? '대표 승인 요청' : '상태 바꾸기') +
      '</button></div></form>'
    );
  }
  // ── 상세의 조각 — 줄 · 고르기 · 넣는 칸 ─────────────
  function idOf(x) {
    if (!x || typeof x !== 'object') return '';
    return typeof x.id === 'string' || typeof x.id === 'number' ? String(x.id) : '';
  }
  function headHtml(text) {
    return '<h3 class="me-pt-sub">' + esc(text) + '</h3>';
  }
  function emptyHtml(text) {
    return '<p class="me-empty">' + esc(text) + '</p>';
  }
  /** 한 줄 — 굵은 글 · 작은 글 · 단추(acts 는 만든 HTML) */
  function lineHtml(main, small, acts) {
    return (
      '<li class="me-pt-row"><span class="me-pt-line"><span class="me-c-main"><b>' +
      esc(main) +
      '</b>' +
      (small ? '<small>' + esc(small) + '</small>' : '') +
      '</span></span>' +
      (acts ? '<div class="rd-acts">' + acts + '</div>' : '') +
      '</li>'
    );
  }
  /** 고르기 칸의 줄 — first 를 주면 빈 값 줄을 맨 앞에 */
  function optionsHtml(map, picked, first) {
    return (
      (first === undefined ? '' : '<option value="">' + esc(first) + '</option>') +
      Object.keys(map)
        .map(function (k) {
          return (
            '<option value="' +
            k +
            '"' +
            (k === picked ? ' selected' : '') +
            '>' +
            esc(map[k]) +
            '</option>'
          );
        })
        .join('')
    );
  }
  function fieldHtml(label, control, attrs) {
    return (
      '<label class="mk-input"' +
      (attrs || '') +
      '><span>' +
      esc(label) +
      '</span>' +
      control +
      '</label>'
    );
  }
  /** 접어 두는 넣는 칸 — 「원가 넣기」 를 눌러야 펼쳐진다 */
  function addHtml(summary, form, inner, button) {
    return (
      '<details class="od-add"><summary>' +
      esc(summary) +
      '</summary><form class="od-form" data-form="' +
      form +
      '" novalidate>' +
      inner +
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid">' +
      esc(button) +
      '</button></div></form></details>'
    );
  }
  /** 지우기 단추 — 누르면 그 자리에서 한 번 더 묻는다 (O.del = '종류:id'). rest 는 앞에 두는 단추 */
  function delHtml(O, kind, id, rest) {
    var at = ' data-kind="' + kind + '" data-id="' + esc(id) + '"';
    return O.del === kind + ':' + id
      ? '<span class="od-ask">' +
          esc(DEL_ASK[kind]) +
          '</span><button type="button" class="mk-btn mk-btn--solid" data-act="del-yes"' +
          at +
          '>삭제</button><button type="button" class="mk-btn" data-act="del-no">그만</button>'
      : (rest || '') +
          '<button type="button" class="mk-btn" data-act="del"' +
          at +
          '>삭제</button>';
  }
  /** 거래처 · 공급처 — 읽은 것 가운데 그 종류만 */
  function cpOf(kind) {
    return Array.isArray(J.cp)
      ? J.cp.filter(function (c) {
          return c.kind === kind;
        })
      : [];
  }
  function cpOptionsHtml(list, picked) {
    return list
      .map(function (c) {
        return (
          '<option value="' +
          esc(c.id) +
          '"' +
          (c.id === picked ? ' selected' : '') +
          '>' +
          esc(c.name || '-') +
          '</option>'
        );
      })
      .join('');
  }

  /** 수주 정보 — 수금액(수금 일정이 없을 때만 손으로) · 구분 · 거래처(본사 수주만 실려 온다) */
  function infoHtml(O) {
    var d = O.detail;
    var o = d.order;
    var pays = paysOf(d);
    var scheduled = !!(pays && pays.length);
    var amount = hasMoney(d) && !scheduled;
    var tier = has(o, 'price_tier');
    if (!amount && !tier) return '';
    var html = '';
    if (amount)
      html += fieldHtml(
        '수금액 (원)',
        '<input type="number" name="received" min="0" step="1000" inputmode="numeric" autocomplete="off" value="' +
          esc(num(o.received_amount)) +
          '" />'
      );
    if (tier) {
      var t = str(o.price_tier);
      html += fieldHtml(
        '구분',
        '<select name="tier" data-fk="tier">' +
          optionsHtml(TIER, t, TIER[t] ? undefined : '모름 (계약금으로 짐작)') +
          '</select>'
      );
      if (Array.isArray(J.cp) && has(o, 'partner_id')) {
        var partners = cpOf('partner');
        var pid = str(o.partner_id);
        var known = partners.some(function (c) {
          return c.id === pid;
        });
        html += fieldHtml(
          '거래처',
          '<select name="partner"><option value="">고르지 않음</option>' +
            (pid && !known
              ? '<option value="' + esc(pid) + '" selected>지금 거래처 (목록에 없음)</option>'
              : '') +
            cpOptionsHtml(partners, pid) +
            '</select>',
          ' data-od="partner"' + (t === 'partner' ? '' : ' hidden')
        );
      }
    }
    return (
      headHtml(TEXT.infoTitle) +
      '<form class="od-form" data-form="info" novalidate>' +
      html +
      (hasMoney(d) && scheduled ? '<p class="mk-note">' + esc(TEXT.infoScheduled) + '</p>' : '') +
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid">저장</button></div></form>'
    );
  }

  /** 실적 원가 — 금액을 보는 사람만. 줄은 costListHtml 이 따로 그린다 (넣는 칸을 건드리지 않게) */
  function costsOf(d) {
    return Array.isArray(d && d.costs) ? d.costs.filter(idOf) : [];
  }
  function costListHtml(O) {
    var costs = costsOf(O.detail);
    if (!costs.length) return emptyHtml(TEXT.costEmpty);
    return (
      '<ul class="me-pt-list">' +
      costs
        .map(function (c) {
          var id = idOf(c);
          var bits = [];
          if (str(c.description)) bits.push(c.description);
          if (str(c.vendor_name)) bits.push(c.vendor_name);
          bits.push(
            '부가세 ' +
              (c.vat_amount === null || c.vat_amount === undefined ? '미기재' : krw(c.vat_amount))
          );
          if (c.evidence_type) bits.push(EVIDENCE[c.evidence_type] || str(c.evidence_type));
          if (c.spent_on) bits.push('낸 날 ' + dot(c.spent_on));
          else if (c.due_on) bits.push('낼 날 ' + dot(c.due_on));
          return lineHtml(
            (COST[c.category] || str(c.category) || '-') + ' ' + krw(c.amount),
            bits.join(' · '),
            delHtml(
              O,
              'cost',
              id,
              !c.spent_on && c.due_on
                ? '<button type="button" class="mk-btn mk-btn--solid" data-act="cost-paid" data-id="' +
                    esc(id) +
                    '">냈음</button>'
                : ''
            )
          );
        })
        .join('') +
      '</ul>'
    );
  }
  function costHtml(O) {
    if (!hasMoney(O.detail)) return '';
    var suppliers = cpOf('supplier');
    return (
      headHtml(TEXT.costTitle) +
      '<div data-od-list="cost"></div>' +
      addHtml(
        '원가 넣기',
        'cost',
        fieldHtml('분류', '<select name="category">' + optionsHtml(COST) + '</select>') +
          (suppliers.length
            ? fieldHtml(
                '공급처',
                '<select name="supplier" data-fk="supplier"><option value="">직접 적기</option>' +
                  cpOptionsHtml(suppliers, '') +
                  '</select>'
              )
            : '') +
          fieldHtml(
            '거래처',
            '<input type="text" name="vendor" maxlength="100" autocomplete="off" />',
            ' data-od="vendor"'
          ) +
          fieldHtml('내용', '<input type="text" name="description" autocomplete="off" />') +
          fieldHtml(
            '공급가 (부가세 뺌, 원)',
            '<input type="number" name="amount" min="0" step="1000" inputmode="numeric" autocomplete="off" />'
          ) +
          fieldHtml(
            '부가세 (비우면 미기재)',
            '<input type="number" name="vat" min="0" step="100" inputmode="numeric" autocomplete="off" />'
          ) +
          fieldHtml(
            '증빙',
            '<select name="evidence">' + optionsHtml(EVIDENCE, '', '고르지 않음') + '</select>'
          ) +
          fieldHtml('낸 날', '<input type="date" name="spent_on" />') +
          fieldHtml('낼 날 (아직 안 냈으면)', '<input type="date" name="due_on" />'),
        '추가'
      )
    );
  }

  /** 재작업 · A/S — 줄은 모두 보고, 적기 · 지우기는 금액을 보는 사람만 */
  function reworksOf(d) {
    return Array.isArray(d && d.reworks) ? d.reworks.filter(idOf) : null;
  }
  function reworkListHtml(O) {
    var list = reworksOf(O.detail) || [];
    var money = hasMoney(O.detail);
    if (!list.length) return emptyHtml(TEXT.reworkEmpty);
    return (
      '<ul class="me-pt-list">' +
      list
        .map(function (r) {
          var bits = [];
          if (r.occurred_on) bits.push(dot(r.occurred_on));
          if (r.minutes !== null && r.minutes !== undefined) bits.push(num(r.minutes) + '분');
          if (r.cost !== null && r.cost !== undefined) bits.push('비용 ' + krw(r.cost));
          if (str(r.parts)) bits.push(r.parts);
          if (str(r.memo)) bits.push(r.memo);
          return lineHtml(
            (REWORK_KIND[r.kind] || str(r.kind) || '-') +
              ' · ' +
              (REWORK_CAUSE[r.cause] || str(r.cause) || '-'),
            bits.join(' · '),
            money ? delHtml(O, 'rework', idOf(r), '') : ''
          );
        })
        .join('') +
      '</ul>'
    );
  }
  function reworkHtml(O) {
    var head = headHtml(TEXT.reworkTitle);
    if (!reworksOf(O.detail)) return head + emptyHtml(TEXT.reworkMissing);
    return (
      head +
      '<div data-od-list="rework"></div>' +
      (hasMoney(O.detail)
        ? addHtml(
            '재작업 · A/S 적기',
            'rework',
            fieldHtml('종류', '<select name="kind">' + optionsHtml(REWORK_KIND) + '</select>') +
              fieldHtml('원인', '<select name="cause">' + optionsHtml(REWORK_CAUSE) + '</select>') +
              fieldHtml('날짜', '<input type="date" name="occurred_on" />') +
              fieldHtml(
                '다시 한 시간 (분)',
                '<input type="number" name="minutes" min="0" step="10" inputmode="numeric" autocomplete="off" />'
              ) +
              fieldHtml(
                '비용 (부재 · 외주, 원)',
                '<input type="number" name="cost" min="0" step="1000" inputmode="numeric" autocomplete="off" />'
              ) +
              fieldHtml(
                '다시 만든 부재',
                '<input type="text" name="parts" placeholder="예: 상부장 도어 2장" autocomplete="off" />'
              ) +
              fieldHtml('메모', '<input type="text" name="memo" autocomplete="off" />'),
            '기록'
          )
        : '')
    );
  }

  /** 설치 · A/S 완료 보고 — 남길 수 있는 사람(can_report)에게만 넣는 칸 */
  function reportListHtml(O) {
    var R = O.reports || {};
    var items = Array.isArray(R.items)
      ? R.items.filter(function (x) {
          return x && typeof x === 'object';
        })
      : [];
    if (!items.length) return emptyHtml(TEXT.reportEmpty);
    return (
      '<ul class="me-pt-list">' +
      items
        .map(function (x) {
          var photos = (Array.isArray(x.photo_urls) ? x.photo_urls : []).filter(function (u) {
            return str(u).indexOf('https://') === 0;
          });
          return lineHtml(
            str(x.label) || REPORT_KIND[x.kind] || str(x.kind) || '-',
            whenKst(x.created_at) + (str(x.note) ? ' · ' + x.note : ''),
            photos
              .map(function (u, i) {
                return (
                  '<a class="od-pc" href="' +
                  esc(u) +
                  '" target="_blank" rel="noopener">사진 ' +
                  (i + 1) +
                  '</a>'
                );
              })
              .join('')
          );
        })
        .join('') +
      '</ul>'
    );
  }
  function reportHtml(O) {
    var head = headHtml(TEXT.reportTitle);
    var link =
      '<p class="mk-note"><a class="od-pc" href="' +
      REPORTS_URL +
      '?order=' +
      encodeURIComponent(O.id) +
      '" data-desktop-tab>' +
      esc(TEXT.reportsLink) +
      '</a></p>';
    if (O.reportsFailed) return head + emptyHtml(TEXT.reportFail) + link;
    var R = O.reports || {};
    if (R.ready === false) return head + emptyHtml(TEXT.reportMissing) + link;
    return (
      head +
      '<div data-od-list="report"></div>' +
      (R.can_report
        ? addHtml(
            '완료 보고 남기기',
            'report',
            '<p class="mk-note">' +
              esc(TEXT.reportLead) +
              '</p>' +
              fieldHtml('종류', '<select name="kind">' + optionsHtml(REPORT_KIND) + '</select>') +
              fieldHtml(
                '메모',
                '<input type="text" name="note" maxlength="' +
                  NOTE_MAX +
                  '" placeholder="없어도 됩니다" autocomplete="off" />'
              ) +
              fieldHtml(
                '사진 (' + PHOTOS_MAX + '장까지)',
                '<input type="file" name="photos" accept="image/jpeg,image/png" multiple />'
              ) +
              '<p class="mk-note" role="status" data-od="report-msg" hidden></p>',
            '보고'
          )
        : '') +
      link
    );
  }

  /** 설치 후 한 문항 — 링크는 만든 그때만(O.feedbackUrl) 보인다 */
  function feedbackHtml(O) {
    var head = headHtml(TEXT.fbTitle);
    var f = O.detail.feedback;
    if (!f || typeof f !== 'object') return head + emptyHtml(TEXT.fbMissing);
    if (f.answered)
      return (
        head +
        '<p class="mk-note">' +
        esc(
          '받은 답: ' +
            num(f.score) +
            '점' +
            (str(f.comment) ? ' · "' + f.comment + '"' : '') +
            (f.answered_at ? ' (' + dayKst(f.answered_at) + ')' : '')
        ) +
        '</p>'
      );
    var text = TEXT.fbNone;
    if (f.exists)
      text = f.expired
        ? TEXT.fbExpired
        : '링크를 보냈고 답을 기다리는 중입니다 (' +
          dayKst(f.expires_at) +
          ' 까지). 새로 만들면 예전 링크는 더 열리지 않습니다.';
    var url = O.feedbackUrl;
    return (
      head +
      '<p class="mk-note">' +
      esc(text) +
      '</p>' +
      (url
        ? fieldHtml(
            '고객에게 보낼 링크',
            '<input type="text" readonly data-od="feedback-url" value="' + esc(url) + '" />'
          )
        : '') +
      '<div class="rd-acts">' +
      (url
        ? '<button type="button" class="mk-btn mk-btn--solid" data-act="feedback-copy">복사</button>'
        : '') +
      '<button type="button" class="mk-btn' +
      (url ? '' : ' mk-btn--solid') +
      '" data-act="feedback-link">' +
      (f.exists ? '새 링크 만들기' : '링크 만들기') +
      '</button></div>'
    );
  }
  /** 사진을 긴 변 PHOTO_EDGE 로 줄인다 — 줄일 수 없으면(브라우저 · 형식) 그대로 올린다 */
  async function shrinkPhoto(file) {
    try {
      if (typeof window.createImageBitmap !== 'function') return file;
      var bmp = await window.createImageBitmap(file);
      var k = Math.min(1, PHOTO_EDGE / Math.max(bmp.width, bmp.height));
      var plain = file.type === 'image/jpeg' || file.type === 'image/png';
      if (k === 1 && file.size <= PHOTO_BYTES && plain) return file;
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      var blob = await new Promise(function (ok) {
        c.toBlob(ok, 'image/jpeg', 0.85);
      });
      return blob || file;
    } catch {
      return file;
    }
  }

  function payRowHtml(O, p) {
    var late = !p.paid_on && DAY_RE.test(str(p.due_on)) && p.due_on < J.today;
    var on = onlineText(p.online);
    return (
      '<li class="me-pt-row"><span class="me-pt-line"><span class="me-c-main"><b>' +
      esc((PAY_STAGE[p.stage] || str(p.stage) || '-') + ' ' + krw(p.amount)) +
      '</b><small>받기로 한 날 <span' +
      (late ? ' class="od-late"' : '') +
      '>' +
      esc(dot(p.due_on) + (late ? ' (밀림)' : '')) +
      '</span> · 받은 날 ' +
      esc(dot(p.paid_on)) +
      (on ? ' · ' + esc(on.text) : '') +
      (on && on.warn ? ' <span class="od-late">— ' + esc(on.warn) + '</span>' : '') +
      '</small></span></span><div class="rd-acts">' +
      delHtml(
        O,
        'pay',
        p.id,
        p.paid_on
          ? '<button type="button" class="mk-btn" data-act="unpay" data-id="' +
              esc(p.id) +
              '">되돌리기</button>'
          : '<button type="button" class="mk-btn mk-btn--solid" data-act="pay" data-id="' +
              esc(p.id) +
              '">받음</button>'
      ) +
      '</div></li>'
    );
  }
  function paysOf(d) {
    return Array.isArray(d && d.payments)
      ? d.payments.filter(function (p) {
          return p && typeof p === 'object' && UUID_RE.test(str(p.id));
        })
      : null;
  }
  function payHtml(O) {
    var d = O.detail;
    if (!hasMoney(d)) return '';
    var head = '<h3 class="me-pt-sub">' + esc(TEXT.payTitle) + '</h3>';
    var pays = paysOf(d);
    if (!pays) return head + '<p class="me-empty">' + esc(TEXT.payMissing) + '</p>';
    return (
      head +
      (pays.length
        ? '<ul class="me-pt-list">' +
          pays
            .map(function (p) {
              return payRowHtml(O, p);
            })
            .join('') +
          '</ul><p class="mk-note">' +
          esc(paySummary(pays, d.order && d.order.contract_amount)) +
          '</p>'
        : '<p class="me-empty">' + esc(TEXT.payEmpty) + '</p>') +
      '<form class="od-form" data-form="pay" novalidate><label class="mk-input"><span>단계</span><select name="stage">' +
      Object.keys(PAY_STAGE)
        .map(function (k) {
          return '<option value="' + k + '">' + PAY_STAGE[k] + '</option>';
        })
        .join('') +
      '</select></label><label class="mk-input"><span>금액 (원)</span>' +
      '<input type="number" name="amount" min="1" step="1" inputmode="numeric" autocomplete="off" /></label>' +
      '<label class="mk-input"><span>받기로 한 날</span><input type="date" name="due_on" /></label>' +
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid">일정 넣기</button></div></form>'
    );
  }
  function eventsHtml(O) {
    var head = '<h3 class="me-pt-sub">' + esc(TEXT.eventsTitle) + '</h3>';
    if (O.eventsFailed) return head + '<p class="me-empty">' + esc(TEXT.eventsFail) + '</p>';
    var items = O.events && Array.isArray(O.events.items) ? O.events.items : [];
    if (!items.length) return head + '<p class="me-empty">' + esc(TEXT.eventsEmpty) + '</p>';
    return (
      head +
      '<ul class="me-pt-list">' +
      items
        .map(function (e) {
          e = e && typeof e === 'object' ? e : {};
          return (
            '<li class="me-pt-row"><span class="me-pt-line"><span class="me-c-main"><b>' +
            esc(moveText(e)) +
            '</b><small>' +
            esc(whenKst(e.created_at) + (str(e.reason) ? ' · ' + e.reason : '')) +
            '</small></span><span class="me-pr-status">' +
            esc(
              (EVENT_STATE[e.state] || str(e.state) || '-') +
                (e.decided_at ? ' ' + whenKst(e.decided_at) : '')
            ) +
            '</span></span></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }
  // ── 상세 그리기 ─────────────────────────────────────
  /** 부분의 차례 — 위에서 아래로 */
  var PARTS = [
    ['summary', summaryHtml],
    ['status', statusHtml],
    ['info', infoHtml],
    ['pay', payHtml],
    ['cost', costHtml, costListHtml],
    ['rework', reworkHtml, reworkListHtml],
    ['report', reportHtml, reportListHtml],
    ['feedback', feedbackHtml],
    ['events', eventsHtml],
  ];
  /**
   * 한 부분을 그린다 — 틀이 그대로면 다시 그리지 않는다 (적던 칸 · 펼친 칸이 남는다).
   * 줄을 따로 그리는 부분(원가 · 재작업 · 완료 보고)은 틀 안의 줄 자리만 다시 채운다.
   */
  function paintOne(O, name) {
    var el = part(name);
    var p = PARTS.filter(function (x) {
      return x[0] === name;
    })[0];
    if (!el || !p) return;
    var html = p[1](O);
    if (O.painted[name] !== html) {
      var was = el.querySelector('details');
      var open = !!(was && was.open);
      O.painted[name] = html;
      el.innerHTML = html;
      el.hidden = !html;
      var now = el.querySelector('details');
      if (open && now) now.open = true;
    }
    var box = p[2] ? el.querySelector('[data-od-list]') : null;
    if (box) box.innerHTML = p[2](O);
  }
  function paintDetail() {
    var O = J.open;
    if (!O || !O.node) return;
    var body = O.node.querySelector('[data-od="body"]');
    if (!O.detail) {
      body.innerHTML =
        '<p class="me-empty">' + esc(O.failed ? TEXT.detailFail : TEXT.loading) + '</p>';
      return;
    }
    if (!body.querySelector('[data-od-part]')) {
      O.painted = {};
      body.innerHTML = PARTS.map(function (p) {
        return '<section class="od-sec" data-od-part="' + p[0] + '"></section>';
      }).join('');
    }
    PARTS.forEach(function (p) {
      paintOne(O, p[0]);
    });
  }
  /** 수주 아래 주소 — sub(O) 상세 · sub(O, 'costs') · sub(O, 'costs', id) */
  function sub(O, name, id) {
    return (
      '/orders/' +
      encodeURIComponent(O.id) +
      (name ? '/' + name : '') +
      (id ? '/' + encodeURIComponent(id) : '')
    );
  }
  /** 거래처 답 — 쓰는 것만 { id, name, kind }. 못 읽었으면 null (다시 묻지 않는다) */
  function cpList(r) {
    var items = r.ok && r.body.data && r.body.data.items;
    if (!Array.isArray(items)) return null;
    return items
      .filter(function (c) {
        return idOf(c) && c.active !== false;
      })
      .map(function (c) {
        return { id: idOf(c), name: str(c.name), kind: str(c.kind) };
      });
  }
  /** 열린 수주를 다시 읽는다 — 다른 수주를 연 뒤에 돌아온 답은 버린다 */
  async function loadDetail(O) {
    var needCp = J.cp === undefined && J.money;
    var got = await Promise.all([
      call('GET', sub(O)),
      call('GET', sub(O, 'events')),
      call('GET', sub(O, 'reports')),
      needCp ? call('GET', '/counterparties') : null,
    ]);
    // 거래처는 수주마다 같다 — 한 번 읽으면 둔다 (연결이 끊겨 못 읽었으면 다음에 다시)
    if (needCp && got[3].status) J.cp = cpList(got[3]);
    if (J.open !== O) return false;
    var d = got[0].ok && got[0].body.data;
    if (!d || typeof d !== 'object' || !d.order || typeof d.order !== 'object') {
      O.failed = true;
      if (!O.detail) paintDetail();
      return false;
    }
    var ev = got[1].ok && got[1].body.data;
    O.failed = false;
    O.detail = d;
    O.events = ev && typeof ev === 'object' ? ev : null;
    O.eventsFailed = !O.events;
    var rp = got[2].ok && got[2].body.data;
    O.reports = rp && typeof rp === 'object' ? rp : null;
    O.reportsFailed = !O.reports;
    if (
      !movesOf(O).some(function (m) {
        return m.to === O.to;
      })
    )
      O.to = '';
    paintDetail();
    return true;
  }
  function openDetail(id) {
    var sheet = sheetApi();
    var o = (J.orders || []).filter(function (x) {
      return x.id === id;
    })[0];
    if (!sheet || !o) return;
    if (J.open && J.open.id === id) return;
    var node = document.createElement('div');
    node.className = 'od-detail';
    node.innerHTML =
      '<p class="me-pt-msg" role="status" data-od="note"></p>' +
      '<p class="mk-error" role="alert" data-od="err" hidden></p><div data-od="body"></div>';
    var O = {
      id: id,
      node: node,
      handle: null,
      detail: null,
      events: null,
      eventsFailed: false,
      reports: null,
      reportsFailed: false,
      feedbackUrl: '',
      failed: false,
      to: '',
      del: '',
      busy: false,
      painted: {},
    };
    node.addEventListener('click', onDetailClick);
    node.addEventListener('change', onDetailChange);
    node.addEventListener('submit', onDetailSubmit);
    J.open = O;
    O.handle = sheet.open({
      title: (o.order_no || '-') + ' · ' + (o.customer_name || TEXT.noCustomer),
      body: node,
      kind: 'sheet',
      onClose: function () {
        if (J.open !== O) return;
        J.open = null;
        if (J.orders) render();
      },
    });
    paintDetail();
    render();
    loadDetail(O);
  }
  /** 고친 뒤 — 목록과 상세를 다시 읽고 알린다. 목록 숫자와 상관없는 것은 상세만 (detailOnly) */
  async function reload(O, text, detailOnly) {
    if (!detailOnly && (await refresh())) render();
    if (J.open !== O) return;
    await loadDetail(O);
    if (J.open === O) note(text);
  }
  /** 한 번에 하나만 — 하는 동안 다시 눌러도 보내지 않는다 */
  async function act(O, fn) {
    if (!O || O.busy) return;
    O.busy = true;
    try {
      await fn();
    } catch {
      if (J.open === O) fail(TEXT.generic);
    } finally {
      O.busy = false;
    }
  }
  /** 설치 후 문항 링크를 복사한다 — 복사가 막힌 곳에서는 글을 골라 준다 */
  function copyLink(O) {
    var inp = O.node.querySelector('[data-od="feedback-url"]');
    if (!inp) return;
    var pick = function () {
      if (J.open !== O) return;
      inp.focus();
      inp.select();
      note(TEXT.fbPicked);
    };
    try {
      window.navigator.clipboard.writeText(inp.value).then(function () {
        if (J.open === O) note(TEXT.fbCopied);
      }, pick);
    } catch {
      pick();
    }
  }
  function onDetailClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    var O = J.open;
    if (!btn || !O || !O.node.contains(btn)) return;
    var a = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id') || '';
    var kind = btn.getAttribute('data-kind') || '';
    var asked = O.del.split(':')[0];
    if (a === 'del') {
      if (!DEL_PATH[kind]) return;
      O.del = kind + ':' + id;
      if (asked && asked !== kind) paintOne(O, asked);
      paintOne(O, kind);
    } else if (a === 'del-no') {
      O.del = '';
      if (asked) paintOne(O, asked);
    } else if (a === 'del-yes') {
      if (!DEL_PATH[kind]) return;
      act(O, async function () {
        var r = await call('DELETE', sub(O, DEL_PATH[kind], id));
        if (J.open !== O) return;
        O.del = '';
        if (!r.ok) {
          paintOne(O, kind);
          return fail(errText(r));
        }
        await reload(O, DEL_DONE[kind], kind !== 'pay');
      });
    } else if (a === 'pay' || a === 'unpay') {
      act(O, async function () {
        var body = { paid_on: a === 'pay' ? todayKst() : null };
        var r = await call('PATCH', sub(O, 'payments', id), body);
        if (J.open !== O) return;
        if (!r.ok) return fail(errText(r));
        await reload(O, a === 'pay' ? TEXT.payPaid : TEXT.payUnpaid);
      });
    } else if (a === 'cost-paid') {
      act(O, async function () {
        var r = await call('PATCH', sub(O, 'costs', id), { spent_on: todayKst() });
        if (J.open !== O) return;
        if (!r.ok) return fail(errText(r));
        await reload(O, TEXT.costPaid, true);
      });
    } else if (a === 'feedback-link') {
      act(O, async function () {
        var r = await call('POST', sub(O, 'feedback-link'));
        if (J.open !== O) return;
        var url = r.ok && r.body.data ? str(r.body.data.url) : '';
        if (!url) return fail(errText(r));
        O.feedbackUrl = url;
        await reload(O, TEXT.fbMade, true);
      });
    } else if (a === 'feedback-copy') {
      copyLink(O);
    }
  }
  function onDetailChange(e) {
    var O = J.open;
    var t = e.target;
    var fk = O && t && t.getAttribute ? t.getAttribute('data-fk') : '';
    if (fk === 'to') {
      O.to = t.value || '';
      paintOne(O, 'status');
      var sel = part('status') && part('status').querySelector('[data-fk="to"]');
      if (sel) sel.focus();
    } else if (fk === 'tier' || fk === 'supplier') {
      // 구분이 거래처일 때만 거래처 고르기 · 공급처를 고르면 거래처 적는 칸은 감춘다
      var box = t.form
        ? t.form.querySelector('[data-od="' + (fk === 'tier' ? 'partner' : 'vendor') + '"]')
        : null;
      if (box) box.hidden = fk === 'tier' ? t.value !== 'partner' : !!t.value;
    }
  }
  /** 칸에 적은 글 (없는 칸은 빈 글) */
  function val(form, name) {
    var el = form.elements[name];
    return el ? String(el.value || '').trim() : '';
  }
  function numOrNull(form, name) {
    var v = val(form, name);
    return v === '' ? null : Number(v);
  }
  function submitInfo(O, form) {
    var patch = {};
    if (form.elements.received) patch.received_amount = Number(val(form, 'received')) || 0;
    if (form.elements.tier) patch.price_tier = val(form, 'tier') || null;
    var box = form.querySelector('[data-od="partner"]');
    if (box && !box.hidden) patch.partner_id = val(form, 'partner') || null;
    else if (patch.price_tier === 'customer' && O.detail.order.partner_id) patch.partner_id = null;
    act(O, async function () {
      var r = await call('PATCH', sub(O), patch);
      if (J.open !== O) return;
      if (!r.ok) return fail(errText(r));
      await reload(O, TEXT.infoSaved);
    });
  }
  function submitCost(O, form) {
    var amount = numOrNull(form, 'amount');
    if (amount === null || !(amount >= 0)) return fail(TEXT.costAmount);
    var vat = numOrNull(form, 'vat');
    if (vat !== null && !(vat >= 0)) return fail(TEXT.costVat);
    var supplier = val(form, 'supplier');
    var body = {
      category: val(form, 'category'),
      description: val(form, 'description'),
      // 공급처를 고르면 서버가 이름을 그 공급처로 맞춘다
      vendor_name: supplier ? '' : val(form, 'vendor'),
      counterparty_id: supplier || null,
      due_on: val(form, 'due_on') || null,
      amount: amount,
      vat_amount: vat,
      evidence_type: val(form, 'evidence') || null,
      spent_on: val(form, 'spent_on') || null,
    };
    act(O, async function () {
      var r = await call('POST', sub(O, 'costs'), body);
      if (J.open !== O) return;
      if (!r.ok) return fail(errText(r));
      form.reset();
      var box = form.querySelector('[data-od="vendor"]');
      if (box) box.hidden = false;
      await reload(O, TEXT.costAdded, true);
    });
  }
  function submitRework(O, form) {
    var body = {
      kind: val(form, 'kind'),
      cause: val(form, 'cause'),
      occurred_on: val(form, 'occurred_on') || null,
      minutes: numOrNull(form, 'minutes'),
      cost: numOrNull(form, 'cost'),
      parts: val(form, 'parts'),
      memo: val(form, 'memo'),
    };
    act(O, async function () {
      var r = await call('POST', sub(O, 'reworks'), body);
      if (J.open !== O) return;
      if (!r.ok) return fail(errText(r));
      form.reset();
      await reload(O, TEXT.reworkAdded, true);
    });
  }
  /** 완료 보고 — 사진을 한 장씩 줄여 올린 다음 보고를 남긴다 */
  function submitReport(O, form) {
    var input = form.elements.photos;
    var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
    if (files.length > PHOTOS_MAX) return fail(TEXT.reportMany);
    var kind = val(form, 'kind');
    var memo = val(form, 'note');
    var msg = form.querySelector('[data-od="report-msg"]');
    var btn = form.querySelector('button[type="submit"]');
    var tell = function (text) {
      if (!msg) return;
      msg.textContent = text;
      msg.hidden = !text;
    };
    act(O, async function () {
      if (btn) btn.disabled = true;
      try {
        var paths = [];
        for (var i = 0; i < files.length; i++) {
          tell(TEXT.reportUploading + ' (' + (i + 1) + '/' + files.length + ')');
          var blob = await shrinkPhoto(files[i]);
          var up = await send('POST', sub(O, 'reports') + '/photo', {
            type: blob.type || 'image/jpeg',
            body: blob,
          });
          if (J.open !== O) return;
          var path = up.ok && up.body.data ? str(up.body.data.photo_path) : '';
          if (!path)
            return fail(str(up.body.message) || TEXT.reportPhotoFail + ' (' + up.status + ')');
          paths.push(path);
        }
        tell(TEXT.reportSending);
        var r = await call('POST', sub(O, 'reports'), {
          kind: kind,
          note: memo || null,
          photo_paths: paths,
        });
        if (J.open !== O) return;
        if (!r.ok) return fail(errText(r));
        form.reset();
        await reload(O, (REPORT_KIND[kind] || '완료') + ' 보고를 남겼습니다.', true);
      } finally {
        tell('');
        if (btn) btn.disabled = false;
      }
    });
  }
  function onDetailSubmit(e) {
    var form = e.target;
    var O = J.open;
    var kind = form && form.getAttribute ? form.getAttribute('data-form') : '';
    if (!O || !kind) return;
    e.preventDefault();
    if (!O.detail) return;
    if (kind === 'info') submitInfo(O, form);
    else if (kind === 'cost') submitCost(O, form);
    else if (kind === 'rework') submitRework(O, form);
    else if (kind === 'report') submitReport(O, form);
    else if (kind === 'move') {
      var m = movesOf(O).filter(function (x) {
        return x.to === O.to;
      })[0];
      if (!m) return fail(TEXT.movePick);
      var reason = form.elements.reason ? String(form.elements.reason.value || '').trim() : '';
      if (m.reason_required && !reason) return fail(TEXT.moveReasonEmpty);
      act(O, async function () {
        var body = { status: m.to };
        if (m.reason_required) body.reason = reason;
        var r = await call('PATCH', sub(O), body);
        if (J.open !== O) return;
        if (!r.ok) return fail(errText(r));
        var label = str(m.label) || STATUS[m.to];
        var asked = !!(r.body.data && r.body.data.state === 'pending');
        O.to = '';
        await reload(
          O,
          asked
            ? '대표 승인 요청을 보냈습니다. 승인되면 ' + label + '(으)로 바뀝니다.'
            : '상태를 ' + label + '(으)로 바꿨습니다.'
        );
      });
    } else if (kind === 'pay') {
      var amount = Number(form.elements.amount.value);
      var due = String(form.elements.due_on.value || '');
      if (!(amount > 0)) return fail(TEXT.payAmount);
      if (!DAY_RE.test(due)) return fail(TEXT.payDue);
      var stage = String(form.elements.stage.value || '');
      act(O, async function () {
        var r = await call('POST', sub(O, 'payments'), {
          stage: stage,
          amount: amount,
          due_on: due,
        });
        if (J.open !== O) return;
        if (!r.ok) return fail(errText(r));
        await reload(O, TEXT.payAdded);
      });
    }
  }

  // ── 목록 누르기 ─────────────────────────────────────
  var deciding = false;
  async function decide(eventId, decision) {
    if (deciding) return;
    deciding = true;
    try {
      var r = await call('POST', '/order-events/' + encodeURIComponent(eventId) + '/decide', {
        decision: decision,
      });
      if (!r.ok) return say(errText(r));
      var ok = await refresh();
      if (ok) render(decision === 'approved' ? TEXT.approved : TEXT.rejected);
      if (J.open) loadDetail(J.open);
    } catch {
      say(TEXT.generic);
    } finally {
      deciding = false;
    }
  }
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t || !J.orders) return;
    var a = t.getAttribute('data-act');
    var id = t.getAttribute('data-id') || '';
    if (a === 'open') openDetail(id);
    else if (a === 'approve') decide(id, 'approved');
    else if (a === 'reject') decide(id, 'rejected');
  }

  /**
   * 수주 · 수금 칸을 채운다 — 볼 사람이 아니거나 못 읽으면 칸째 감춘다.
   * @param sb Supabase 클라이언트 · session 로그인 세션 · me account-api GET /partner/me 응답
   */
  async function load(sb, session, me) {
    var boxes = ['orders', 'ordersCollect'].map($).filter(Boolean);
    if (!boxes.length) return;
    var hide = function () {
      boxes.forEach(function (b) {
        b.hidden = true;
        b.innerHTML = '';
      });
    };
    hide();
    var cfg = window.DADAM_CONFIG || {};
    J.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    J.sb = sb;
    J.session = session;
    J.me = me;
    J.orders = null;
    J.requests = [];
    J.dues = null;
    J.money = false;
    J.cp = undefined;
    J.open = null;
    if (!J.base || !session || !canSee(me)) return;
    try {
      if (!(await refresh())) return;
      boxes.forEach(function (b) {
        if (b.getAttribute('data-bound')) return;
        b.setAttribute('data-bound', '1');
        b.addEventListener('click', onClick);
      });
      render();
    } catch {
      J.orders = null;
      hide();
    }
  }

  window.SeganOrders = {
    STATUS: STATUS,
    PAY_STAGE: PAY_STAGE,
    TEXT: TEXT,
    state: J,
    canSee: canSee,
    orderOf: orderOf,
    moneyViewer: moneyViewer,
    collectRows: collectRows,
    totalsOf: totalsOf,
    dueRange: dueRange,
    duesOf: duesOf,
    paySummary: paySummary,
    onlineText: onlineText,
    moveText: moveText,
    krw: krw,
    whenKst: whenKst,
    todayKst: todayKst,
    load: load,
  };
})();
