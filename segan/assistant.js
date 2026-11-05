/* ============================================================
   segan/assistant.js — 업체 AI 비서 (segan/assistant.html)

   누가      assistant-api GET /assistant/me 가 답하는 사람 — 업체 구성원 + 비서 자격(Agent · 시험 업체, 비서를 켠 업체).
             자격 full 만 대화한다 (can_chat). read 는 지난 대화를 보기만. none · 403 은 이유 한 줄.
   데이터    워커 주소는 segan/shell.js SeganShell.assistantBase() (js/config.js 의 assistantApi.url, 없으면 기본 주소)
             GET  /assistant/me · /assistant/conversations · /assistant/conversations/:id (running 이 있으면 그 차례를 이어 받는다)
             POST /assistant/conversations → 201 { conversation }
             POST /assistant/conversations/:id/turns { text } + X-Idempotency-Key — 보낼 때마다 새 키,
                  연결이 끊겨 한 번 더 보낼 때는 같은 키 (서버가 같은 차례로 답한다)
             GET  /assistant/conversations/:id/events?after=N — 사건 줄(NDJSON, 한 줄에 사건 하나 · 번호 n).
                  서버가 차례 끝 · 약 55초에 닫는다. 이 차례의 끝 사건 없이 닫히면 마지막으로 받은 n 부터 다시 연다.
   사건      start · text(글 조각을 잇는다) · tool(「… 보는 중」 한 줄, 다음 tool · text 가 오면 바뀐다) · done
             끝 — blocked(reason) · refused · error(message). 서버는 실패한 차례를 저장하지 않으므로
             보낸 말풍선을 거두고 글을 입력 칸에 되돌린다. 모르는 사건은 넘긴다.
   보이기    모든 글은 textContent 로만 넣는다 (사람 글 · AI 글 모두 — HTML · 링크로 바꾸지 않는다).
             비서 말풍선에는 「AI가 만든 내용」, 입력 칸 아래 늘 「틀릴 수 있습니다」 안내.
   주소      연 대화는 #c=<대화 id> — 새로 고쳐도 그 대화를 다시 연다.
   오늘 브리핑 workflow-api GET /brief/today — 서버가 센 볼 것(상담 · 수금 · 7일 안 납품 · 설치 · 대표 결정 요청 · 사진 ·
             장부 알림)과 진행 단계 · 공장 · 설치 필수 확인 진행. 역할에 없는 칸은 서버가 null 로 준다 (직원은 일정 · 현황만).
             못 받으면(403 · 끊김) 칸을 숨긴다. 「비서에게 묻기」는 새 대화로 정리를 묻는다 (대화할 수 있을 때만).
   장부 알림 대표 · 실장(me.money)이면 workflow-api GET /ledger/notices — 서버가 센 숫자로 카드를 만든다(AI 글 아님).
             카드를 누르면 POST /ledger/notices/seen { ids } 뒤 장부로, 「모두 봤어요」는 안 본 것 한꺼번에.
             알림을 못 받으면(403 · 0033 전 · 끊김) 칸을 숨긴다 — 대화는 그대로.
   로그인 · 클라이언트는 segan/shell.js 가 맡는다 (SeganShell.ready 의 sb · session).
   ============================================================ */
/* global window, document, fetch, crypto, location, history, setTimeout, AbortController, TextDecoder */
(function () {
  'use strict';

  var DENY = {
    not_member: '비서는 업체 구성원만 씁니다.',
    not_entitled: '비서를 쓸 수 없는 업체입니다.',
  };
  // 차례 끝 이유 — 워커 src/session.js blocked reason
  var BLOCKED = {
    not_entitled: '비서를 쓸 수 없는 업체입니다',
    conversation_full: '대화가 길어졌습니다. 새 대화를 시작해 주세요',
    no_limit: '이달 비서 한도가 정해지지 않았습니다',
    over_limit: '이달 비서 한도를 다 썼습니다',
    off: '비서가 꺼져 있습니다',
  };
  var REFUSED_MSG = '이 내용에는 답할 수 없습니다';
  var BUSY_MSG = '앞 답을 만드는 중입니다';
  var RATE_MSG = '잠시 뒤 다시 보내 주세요';
  var FAIL_MSG = '비서를 불러오지 못했습니다.';
  var LIST_FAIL_MSG = '대화 목록을 불러오지 못했습니다.';
  var OPEN_FAIL_MSG = '대화를 불러오지 못했습니다.';
  var NOT_FOUND_MSG = '대화를 찾지 못했습니다.';
  var NEW_FAIL_MSG = '새 대화를 만들지 못했습니다.';
  var TURN_FAIL_MSG = '답을 만들지 못했습니다. 잠시 뒤 다시 보내 주세요.';
  var SEND_FAIL_MSG = '보내지 못했습니다. 잠시 뒤 다시 보내 주세요.';
  var OFFLINE_MSG = '연결이 끊겨 보내지 못했습니다. 다시 보내 주세요.';
  var LOST_MSG = '답을 받지 못했습니다. 대화를 다시 열어 주세요.';
  var EMPTY_MSG = '보낼 글을 적어 주세요.';
  var AI_TAG = 'AI가 만든 내용';
  var WAIT_TEXT = '답을 만드는 중…';
  var TEXT_MAX = 4000; // 워커 src/worker.js TEXT_MAX
  var LIST_MAX = 20; // 워커가 주는 대화 수
  var CONV_RE = /^#c=([0-9a-fA-F-]{36})$/;
  var NOTICE_SHOW = 5; // 처음 보이는 알림 카드 수 (나머지는 「모두 보기」)
  var SEEN_MAX = 50; // 워커 src/ledger/notices.js SEEN_MAX
  // 장부 알림 종류 — 워커 src/ledger/notices.js · DB 0033 · 0036 · 0038 ledger_notices.kind
  var NOTICE_KIND = {
    duplicate: '중복 의심',
    large_amount: '평소와 다른 큰 금액',
    new_supplier: '새 거래처',
    supplier_status: '거래처 상태 바뀜',
    price_change: '단가 변동',
    evidence_risk: '증빙 경고',
    statement_mismatch: '명세표 합계와 세금계산서가 다름',
    invoice_missing: '세금계산서가 아직 없는 명세표',
    month_report: '지난달 회계 보고',
  };
  var NTS_NAME = {
    active: '계속 사업자',
    suspended: '휴업',
    closed: '폐업',
    unregistered: '국세청에 없는 번호',
  };
  var EVIDENCE_NAME = { simple_receipt: '간이영수증', statement: '거래명세표', none: '증빙 없음' };
  var LEDGER_PAGE = 'ledger.html';

  // 사건 줄 다시 열기 — 끊김(또는 새 사건 없이 곧바로 닫힘)이 이어지면 기다림을 2배씩, retry 번 넘으면 그만둔다
  var T = { retry: 5, waitMs: 1000, quickMs: 1000 };

  var A = {
    sb: null,
    session: null,
    base: '',
    me: null, // GET /assistant/me data
    convs: [], // GET /assistant/conversations items (새것부터)
    conv: null, // 연 대화 { id, title }
    turn: 0, // 지금 도는 차례 (0 = 없음)
    lastN: 0, // 받은 마지막 사건 번호
    sending: false,
    creating: false,
    sent: '', // 이 차례에 보낸 글 — 차례가 실패하면 입력 칸에 되돌린다
    userLi: null, // 이 차례의 사람 말풍선
    ai: null, // 이 차례의 비서 말풍선
    gen: 0, // 대화를 열거나 떠날 때마다 늘린다 — 옛 응답 · 사건 줄을 버린다
    ctl: null, // 지금 읽는 사건 줄의 AbortController
    work: '', // workflow-api 주소 (장부 알림)
    notices: [], // GET /ledger/notices items (새것부터)
    noticesAll: false, // 「모두 보기」를 눌렀나
    brief: null, // GET /brief/today data
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ── 글자 ───────────────────────────────────────────────
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** ISO → 한국 시간 'MM.DD HH:mm' (못 읽으면 빈 글) */
  function stamp(iso) {
    var t = Date.parse(String(iso == null ? '' : iso));
    if (!isFinite(t)) return '';
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

  /** 보낼 때마다 새 키 — 워커 KEY_RE(영숫자 _ . : -) 안 */
  function newKey() {
    try {
      if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch {
      /* 아래 키로 */
    }
    return 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** NDJSON 조각 → { lines, rest } — 끝나지 않은 마지막 줄은 rest 로 남긴다 */
  function takeLines(buf) {
    var parts = String(buf).split('\n');
    var rest = parts.pop();
    return {
      lines: parts.filter(function (l) {
        return l.trim() !== '';
      }),
      rest: rest,
    };
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = A.sb && (await A.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return A.session ? A.session.access_token : '';
  }

  /** → { ok, status, data, code, message } (끊김은 status 0). opts.base 를 주면 그 서버(장부 알림 — workflow-api) */
  async function api(path, opts) {
    var o = opts || {};
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.key) headers['X-Idempotency-Key'] = o.key;
    try {
      var res = await fetch((o.base || A.base) + path, {
        method: o.method || 'GET',
        headers: headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        cache: 'no-store',
      });
      var b = null;
      try {
        b = await res.json();
      } catch {
        b = null;
      }
      var good = res.ok && b && b.success === true;
      return {
        ok: !!good,
        status: res.status,
        data: good ? b.data : null,
        code: b && b.code ? b.code : '',
        message: b && b.message ? b.message : '',
      };
    } catch {
      return { ok: false, status: 0, data: null, code: '', message: '' };
    }
  }

  // ── 그리기 ─────────────────────────────────────────────
  function canChat() {
    return !!(A.me && A.me.can_chat);
  }

  function setState(msg) {
    $('asState').textContent = msg || '';
  }

  function setEnd(msg) {
    var el = $('asEnd');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function setTool(label) {
    var el = $('asTool');
    el.textContent = label || '';
    el.hidden = !label;
  }

  function syncForm() {
    $('asSend').disabled = A.sending || A.turn > 0;
  }

  function scrollEnd(el) {
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'end' });
  }

  function textEl(li) {
    return li.querySelector('.as-text');
  }

  /** 말풍선 — role user | assistant. 글은 textContent 로만 */
  function bubble(role, text) {
    var li = document.createElement('li');
    var ai = role === 'assistant';
    li.className = 'as-msg ' + (ai ? 'as-msg--ai' : 'as-msg--user');
    if (ai) {
      var tag = document.createElement('span');
      tag.className = 'as-tag';
      tag.textContent = AI_TAG;
      li.appendChild(tag);
    }
    var p = document.createElement('p');
    p.className = 'as-text';
    p.textContent = text == null ? '' : String(text);
    li.appendChild(p);
    $('asMsgs').appendChild(li);
    scrollEnd(li);
    return li;
  }

  /** 답을 기다리는 비서 말풍선 — 첫 글 조각이 오면 기다림 글을 지운다 */
  function waitBubble() {
    var li = bubble('assistant', WAIT_TEXT);
    li.classList.add('as-msg--wait');
    return li;
  }

  function drop(li) {
    if (li && li.parentNode) li.parentNode.removeChild(li);
  }

  function renderList() {
    var ul = $('asConvs');
    ul.textContent = '';
    if (!A.convs.length) {
      var empty = document.createElement('li');
      empty.className = 'as-empty';
      empty.textContent = canChat()
        ? '아직 대화가 없습니다. 「새 대화」로 시작하세요.'
        : '아직 대화가 없습니다.';
      ul.appendChild(empty);
      return;
    }
    A.convs.forEach(function (c) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'as-conv';
      b.setAttribute('data-id', c.id);
      var t = document.createElement('b');
      t.textContent = c.title || '새 대화';
      var s = document.createElement('small');
      s.textContent = stamp(c.updated_at || c.created_at);
      b.appendChild(t);
      b.appendChild(s);
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function setTitle(title) {
    if (A.conv) A.conv.title = title || '';
    $('asConvTitle').textContent = title || '새 대화';
  }

  // ── 장부 알림 ─────────────────────────────────────────
  function money(n) {
    var v = Number(n);
    return isFinite(v) && n !== null && n !== '' ? v.toLocaleString('ko-KR') + '원' : '';
  }

  /** 카드 한 줄 (순수) — 서버가 준 숫자로만 */
  function noticeText(n) {
    var d = (n && n.data) || {};
    var who = d.supplier || (d.biz_no ? String(d.biz_no) : '거래처');
    if (n.kind === 'duplicate')
      return (
        who +
        ' — 같은 날짜 · 금액 사진이 이미 있습니다' +
        (d.of && d.of.created_at ? ' (' + stamp(d.of.created_at) + ' 사진)' : '')
      );
    if (n.kind === 'large_amount')
      return (
        who +
        ' ' +
        money(d.total) +
        ' — 최근 ' +
        d.n +
        '번 중앙값 ' +
        money(d.median) +
        '의 ' +
        d.ratio +
        '배'
      );
    if (n.kind === 'new_supplier') return who + ' — 처음 올라온 거래처입니다';
    if (n.kind === 'supplier_status') {
      var s = '국세청 조회: ' + (NTS_NAME[d.status] || d.status || '');
      if (d.closed_on && d.status === 'closed') s += ' (' + d.closed_on + ')';
      if (d.old_tax_type && d.tax_type && d.old_tax_type !== d.tax_type)
        s += ' · 과세 유형 ' + d.old_tax_type + ' → ' + d.tax_type;
      return who + ' — ' + s;
    }
    if (n.kind === 'price_change') {
      var pct =
        Number(d.old) > 0
          ? Math.round(((Number(d.new) - Number(d.old)) / Number(d.old)) * 100)
          : null;
      return (
        who +
        ' ' +
        (d.item || '') +
        ' 단가 ' +
        money(d.old) +
        ' → ' +
        money(d.new) +
        (pct === null ? '' : ' (' + (pct > 0 ? '+' : '') + pct + '%)') +
        ' · 읽은 값 기준'
      );
    }
    if (n.kind === 'evidence_risk')
      return (
        who +
        ' ' +
        money(d.total) +
        ' — ' +
        (EVIDENCE_NAME[d.evidence_type] || '적격증빙 아님') +
        ' (3만원 넘음) · 가산세 2% 위험 참고'
      );
    if (n.kind === 'statement_mismatch')
      return (
        who +
        (d.on_date ? ' ' + d.on_date : '') +
        ' — 명세표 ' +
        d.n +
        '장 ' +
        (d.basis === 'supply' ? '공급가 ' : '합계 ') +
        money(d.statements) +
        ' · 세금계산서 ' +
        money(d.invoice)
      );
    if (n.kind === 'month_report')
      return (
        (d.month || '') +
        ' — 매출 ' +
        money(d.income) +
        ' · 매입 ' +
        money(d.expense) +
        ' · 장부 손익 ' +
        money(d.profit)
      );
    if (n.kind === 'invoice_missing')
      return (
        who +
        ' ' +
        (d.month || '') +
        ' 명세표 ' +
        d.count +
        '장' +
        (d.supply != null
          ? ' · 공급가 ' + money(d.supply)
          : d.total != null
            ? ' · 합계 ' + money(d.total)
            : '') +
        ' — 다음 달 10일 발급 기한이 지났습니다'
      );
    return who;
  }

  function renderNotices() {
    var list = A.notices;
    $('asNotices').hidden = !list.length;
    var unseen = list.filter(function (n) {
      return !n.seen_at;
    });
    $('asNoticesTitle').textContent =
      '장부 알림' + (unseen.length ? ' ' + unseen.length + '건 새로' : '');
    $('asNoticesSeen').hidden = !unseen.length;
    var shown = A.noticesAll ? list : list.slice(0, NOTICE_SHOW);
    $('asNoticesMore').hidden = shown.length >= list.length;
    $('asNoticesMore').textContent = '알림 ' + list.length + '건 모두 보기';
    var ul = $('asNoticeList');
    ul.textContent = '';
    shown.forEach(function (n) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className =
        'as-ncard as-ncard--' +
        (n.urgency === 'now' ? 'now' : 'am') +
        (n.seen_at ? ' as-ncard--seen' : '');
      b.setAttribute('data-notice', n.id);
      var top = document.createElement('span');
      top.className = 'as-ncard-top';
      var k = document.createElement('b');
      k.textContent = NOTICE_KIND[n.kind] || n.kind;
      var w = document.createElement('small');
      w.textContent = stamp(n.created_at);
      top.appendChild(k);
      top.appendChild(w);
      var body = document.createElement('span');
      body.className = 'as-ncard-body';
      body.textContent = noticeText(n);
      var go = document.createElement('span');
      go.className = 'as-ncard-go';
      go.textContent = n.kind === 'month_report' ? '보고서 보기 ›' : '장부에서 보기 ›';
      b.appendChild(top);
      b.appendChild(body);
      b.appendChild(go);
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  // ── 오늘 브리핑 ──────────────────────────────────────────
  var SCHEDULE_NAME = { delivery: '납품', installation: '설치' }; // 워커 src/brief.js · slack.js
  var STAGE_LINE = [
    ['projects', 'consult', '상담'],
    ['projects', 'render', '연출'],
    ['projects', 'design', '설계'],
    ['projects', 'quote', '견적'],
    ['orders', 'confirmed', '수주 확정'],
    ['orders', 'in_production', '제작 중'],
    ['orders', 'delivered', '납품'],
  ];
  var WORK_ROLES = ['cut', 'edge', 'assembly', 'install'];
  var ORDER_STATUS_NAME = { in_production: '제작 중', delivered: '납품' };
  var ASK_TEXT = '오늘 브리핑을 정리해 주세요.';

  /** 볼 것 → [{ key, text, sub, href }] — 수가 있는 것만 (서버가 센 수 그대로) */
  function briefLines(b) {
    var it = (b && b.items) || {};
    var out = [];
    var has = function (x) {
      return x && Number(x.count) > 0;
    };
    if (has(it.consults))
      out.push({
        key: 'consults',
        text: '응답 기다리는 상담 ' + it.consults.count + '건',
        sub: it.consults.next_deadline ? '가장 이른 마감 ' + stamp(it.consults.next_deadline) : '',
        href: 'me.html#partner-consults',
      });
    if (has(it.receivables)) {
      var r = it.receivables;
      var parts = [];
      if (r.late_count) parts.push('지남 ' + r.late_count + '건 ' + money(r.late_total));
      if (r.today_count) parts.push('오늘 ' + r.today_count + '건 ' + money(r.today_total));
      out.push({
        key: 'receivables',
        text: '받을 수금 ' + r.count + '건 · ' + money(r.total),
        sub: parts.join(' · '),
        href: 'ledger.html#sales',
      });
    }
    if (has(it.schedules))
      out.push({
        key: 'schedules',
        text: '7일 안 납품 · 설치 ' + it.schedules.count + '건',
        sub: (it.schedules.items || [])
          .map(function (s) {
            return (
              stamp(s.at) +
              ' ' +
              (SCHEDULE_NAME[s.type] || s.type) +
              (s.order_no ? ' ' + s.order_no : '')
            );
          })
          .join(' · '),
        href: '',
      });
    if (has(it.requests))
      out.push({
        key: 'requests',
        text: '대표 결정 기다리는 수주 요청 ' + it.requests.count + '건',
        sub: '',
        href: 'me.html#partner',
      });
    if (has(it.photos))
      out.push({
        key: 'photos',
        text: '확인 기다리는 영수증 · 명세표 사진 ' + it.photos.count + '장',
        sub: '',
        href: 'ledger.html#photos',
      });
    if (has(it.notices))
      out.push({
        key: 'notices',
        text: '안 본 장부 알림 ' + it.notices.count + '건',
        sub: '',
        href: '#asNotices',
      });
    return out;
  }

  /** 진행 단계 한 줄 — 0 인 단계는 뺀다 */
  function stagesText(st) {
    if (!st) return '';
    return STAGE_LINE.filter(function (x) {
      return st[x[0]] && Number(st[x[0]][x[1]]) > 0;
    })
      .map(function (x) {
        return x[2] + ' ' + st[x[0]][x[1]];
      })
      .join(' · ');
  }

  /** 작업 진행 칸 — done/total, 지시서 · 항목이 없으면 — */
  function workCell(x) {
    return x && x.total ? x.done + '/' + x.total : '—';
  }

  function renderBrief() {
    var b = A.brief;
    $('asBrief').hidden = !b;
    if (!b) return;
    var lines = briefLines(b);
    $('asBriefTitle').textContent = '오늘 브리핑' + (b.count ? ' ' + b.count + '건' : '');
    $('asBriefNone').hidden = lines.length > 0;
    $('asBriefAsk').hidden = !canChat();
    var ul = $('asBriefList');
    ul.textContent = '';
    lines.forEach(function (l) {
      var li = document.createElement('li');
      li.className = 'as-bline';
      li.setAttribute('data-brief', l.key);
      var main = document.createElement(l.href ? 'a' : 'span');
      if (l.href) main.setAttribute('href', l.href);
      main.textContent = l.text + (l.href ? ' ›' : '');
      li.appendChild(main);
      if (l.sub) {
        var s = document.createElement('small');
        s.textContent = l.sub;
        li.appendChild(s);
      }
      ul.appendChild(li);
    });
    var st = stagesText(b.stages);
    $('asBriefStagesTitle').hidden = !st;
    $('asBriefStages').hidden = !st;
    $('asBriefStages').textContent = st;
    var work = Array.isArray(b.work) ? b.work : [];
    $('asBriefWorkTitle').hidden = !work.length;
    $('asBriefWorkWrap').hidden = !work.length;
    var tb = $('asBriefWork');
    tb.textContent = '';
    work.forEach(function (w) {
      var tr = document.createElement('tr');
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent =
        (w.order_no || '수주') + ' · ' + (ORDER_STATUS_NAME[w.status] || w.status || '');
      tr.appendChild(th);
      WORK_ROLES.forEach(function (role) {
        var td = document.createElement('td');
        td.textContent = workCell(w.roles && w.roles[role]);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }

  async function loadBrief() {
    if (!A.work) return;
    var r = await api('/brief/today', { base: A.work });
    A.brief = r.ok && r.data && r.data.items ? r.data : null;
    renderBrief();
  }

  /** 비서에게 묻기 — 새 대화를 열고 정리를 묻는다 */
  async function askBrief() {
    if (!canChat() || A.creating || A.sending || A.turn) return;
    var before = A.conv;
    await newConv();
    if (!A.conv || A.conv === before) return; // 새 대화를 못 열었다 — 옛 대화에 보내지 않는다
    $('asText').value = ASK_TEXT;
    await send();
  }

  async function loadNotices() {
    if (!A.work || !A.me || !A.me.money) return;
    var r = await api('/ledger/notices?limit=30', { base: A.work });
    A.notices = r.ok ? (r.data && r.data.items) || [] : [];
    renderNotices();
  }

  /** 본 표시 — 실패해도 화면은 그대로 둔다 (다음에 다시 받는다) */
  async function markSeen(ids) {
    if (!ids.length) return;
    var r = await api('/ledger/notices/seen', {
      base: A.work,
      method: 'POST',
      body: { ids: ids.slice(0, SEEN_MAX) },
    });
    if (!r.ok) return;
    var now = new Date().toISOString();
    A.notices.forEach(function (n) {
      if (ids.indexOf(n.id) >= 0 && !n.seen_at) n.seen_at = now;
    });
    renderNotices();
  }

  async function onNoticeClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-notice]') : null;
    if (!b) return;
    var id = b.getAttribute('data-notice');
    var n = A.notices.filter(function (x) {
      return x.id === id;
    })[0];
    await markSeen([id]);
    // 월 보고 — 그 달 보고서 (ledger-report.html)
    var month =
      n && n.kind === 'month_report' && n.data && /^\d{4}-\d{2}$/.test(n.data.month)
        ? n.data.month
        : '';
    exported.go(month ? 'ledger-report.html?month=' + month : LEDGER_PAGE);
  }

  // ── 주소 (#c=대화) ─────────────────────────────────────
  function setHash(id) {
    try {
      history.replaceState(null, '', location.pathname + location.search + '#c=' + id);
    } catch {
      /* 주소를 못 바꿔도 대화는 연다 */
    }
  }

  function clearHash() {
    if (!location.hash) return;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* noop */
    }
  }

  // ── 목록 · 대화 ───────────────────────────────────────
  async function loadList() {
    var r = await api('/assistant/conversations');
    if (!r.ok) {
      setState(LIST_FAIL_MSG);
      return false;
    }
    A.convs = ((r.data && r.data.items) || []).slice(0, LIST_MAX);
    renderList();
    // 이어 받은 차례가 첫 차례였으면 제목은 목록에서 온다
    if (A.conv && !A.conv.title) {
      for (var i = 0; i < A.convs.length; i++) {
        if (A.convs[i].id === A.conv.id && A.convs[i].title) setTitle(A.convs[i].title);
      }
    }
    return true;
  }

  /** 지금 차례 따라가기를 멈춘다 — 서버의 차례는 그대로 돈다 (다시 열면 running 으로 이어 받는다) */
  function stopFollow() {
    A.gen++;
    if (A.ctl) {
      try {
        A.ctl.abort();
      } catch {
        /* noop */
      }
      A.ctl = null;
    }
    A.turn = 0;
    A.sending = false;
    A.sent = '';
    A.userLi = null;
    A.ai = null;
    setTool('');
    syncForm();
  }

  function showList() {
    stopFollow();
    A.conv = null;
    $('asChat').hidden = true;
    $('asListView').hidden = false;
    setEnd('');
    clearHash();
  }

  /** 대화 화면으로 — 메시지를 다시 그린다 */
  function enterConv(conv, messages) {
    A.conv = { id: conv.id, title: conv.title || '' };
    setTitle(A.conv.title);
    $('asMsgs').textContent = '';
    (messages || []).forEach(function (m) {
      bubble(m.role, m.text);
    });
    setEnd('');
    setTool('');
    $('asListView').hidden = true;
    $('asChat').hidden = false;
    setHash(conv.id);
    syncForm();
  }

  async function openConv(id) {
    stopFollow();
    var gen = A.gen;
    var r = await api('/assistant/conversations/' + encodeURIComponent(id));
    if (gen !== A.gen) return;
    if (!r.ok || !r.data || !r.data.conversation) {
      setState(r.status === 404 ? NOT_FOUND_MSG : OPEN_FAIL_MSG);
      showList();
      return;
    }
    setState('');
    enterConv(r.data.conversation, r.data.messages);
    var run = r.data.running;
    if (run && Number(run.turn) > 0) {
      // 새로 고치기 전에 보낸 차례가 아직 돈다 — 그 차례의 사건을 이어 받는다
      A.turn = Number(run.turn);
      A.ai = waitBubble();
      syncForm();
      follow(gen, A.turn, Number(run.after) || 0);
    }
  }

  async function newConv() {
    if (!canChat() || A.creating) return;
    A.creating = true;
    $('asNew').disabled = true;
    var r = await api('/assistant/conversations', { method: 'POST' });
    A.creating = false;
    $('asNew').disabled = false;
    if (!r.ok || !r.data || !r.data.conversation) {
      setState(r.status === 403 ? DENY[r.code] || DENY.not_entitled : NEW_FAIL_MSG);
      return;
    }
    setState('');
    var c = r.data.conversation;
    A.convs = [c]
      .concat(
        A.convs.filter(function (x) {
          return x.id !== c.id;
        })
      )
      .slice(0, LIST_MAX);
    renderList();
    stopFollow();
    enterConv(c, []);
  }

  // ── 보내기 ─────────────────────────────────────────────
  function sendError(r) {
    if (r.status === 0) return OFFLINE_MSG;
    if (r.status === 409) return BUSY_MSG;
    if (r.status === 429) return RATE_MSG;
    if (r.status === 403) return r.code === 'not_member' ? DENY.not_member : BLOCKED.not_entitled;
    if (r.status === 404) return NOT_FOUND_MSG;
    return r.message || SEND_FAIL_MSG;
  }

  async function send(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!A.conv || !canChat() || A.sending || A.turn) return;
    var text = $('asText').value.trim();
    if (!text) return setEnd(EMPTY_MSG);
    if (text.length > TEXT_MAX) return setEnd('글은 ' + TEXT_MAX + '자까지 보냅니다.');
    var gen = A.gen;
    var path = '/assistant/conversations/' + encodeURIComponent(A.conv.id) + '/turns';
    A.sending = true;
    A.sent = text;
    syncForm();
    setEnd('');
    setTool('');
    A.userLi = bubble('user', text);
    $('asText').value = '';
    var key = newKey();
    var r = await api(path, { method: 'POST', body: { text: text }, key: key });
    // 끊겼으면 한 번 더 — 같은 키라 서버에 차례가 두 번 생기지 않는다
    if (r.status === 0 && gen === A.gen)
      r = await api(path, { method: 'POST', body: { text: text }, key: key });
    if (gen !== A.gen) return; // 그새 대화를 떠났다
    A.sending = false;
    if (!r.ok || !r.data) {
      drop(A.userLi);
      A.userLi = null;
      if (!$('asText').value) $('asText').value = text;
      A.sent = '';
      setEnd(sendError(r));
      syncForm();
      return;
    }
    A.turn = Number(r.data.turn) || 0;
    if (!A.turn) {
      A.sent = '';
      setEnd(SEND_FAIL_MSG);
      syncForm();
      return;
    }
    A.ai = waitBubble();
    syncForm();
    follow(gen, A.turn, Number(r.data.after) || 0);
  }

  // ── 사건 줄 ────────────────────────────────────────────
  function onEvent(ev, turn) {
    if (ev.turn !== turn || A.turn !== turn) return;
    if (ev.type === 'text') {
      if (!A.ai) A.ai = waitBubble();
      var li = A.ai;
      var p = textEl(li);
      if (li.classList.contains('as-msg--wait')) {
        li.classList.remove('as-msg--wait');
        p.textContent = '';
      }
      p.textContent += ev.text == null ? '' : String(ev.text);
      setTool('');
      scrollEnd(li);
    } else if (ev.type === 'tool') {
      setTool(ev.label == null ? '' : String(ev.label));
    } else if (ev.type === 'done') {
      doneTurn(turn);
    } else if (ev.type === 'blocked') {
      endTurn(turn, BLOCKED[ev.reason] || TURN_FAIL_MSG, true);
    } else if (ev.type === 'refused') {
      endTurn(turn, REFUSED_MSG, true);
    } else if (ev.type === 'error') {
      endTurn(turn, ev.message ? String(ev.message) : TURN_FAIL_MSG, true);
    }
  }

  function doneTurn(turn) {
    if (A.turn !== turn) return;
    var missed = A.ai && A.ai.classList.contains('as-msg--wait'); // 글 사건을 못 받았다 (오래돼 지워짐)
    if (A.conv && !A.conv.title && A.sent) setTitle(A.sent.slice(0, 40)); // 워커와 같은 첫 40자
    A.turn = 0;
    A.ai = null;
    A.userLi = null;
    A.sent = '';
    setTool('');
    syncForm();
    if (missed && A.conv) {
      openConv(A.conv.id); // 저장된 답으로 다시 그린다
      return;
    }
    loadList(); // 제목 · 순서
  }

  /** 차례가 답 없이 끝났다. restore 면 서버가 저장하지 않은 차례 — 보낸 말풍선을 거두고 글을 되돌린다 */
  function endTurn(turn, msg, restore) {
    if (A.turn !== turn) return;
    drop(A.ai);
    if (restore) {
      drop(A.userLi);
      if (A.sent && !$('asText').value) $('asText').value = A.sent;
    }
    A.turn = 0;
    A.ai = null;
    A.userLi = null;
    A.sent = '';
    setTool('');
    setEnd(msg);
    syncForm();
  }

  /**
   * 사건 줄 한 번 열기 → 'closed' (서버가 닫음) · 'net' (끊김 · 5xx) · 'gone' (401 · 403 · 404 — 다시 열지 않는다)
   * 받은 사건은 번호(n)가 A.lastN 보다 클 때만 쓴다 — 다시 열어도 같은 사건을 두 번 쓰지 않는다.
   */
  async function readEvents(gen, turn) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    A.ctl = ctl;
    var take = function (line) {
      var ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (!ev || typeof ev.n !== 'number' || ev.n <= A.lastN) return;
      A.lastN = ev.n;
      if (gen === A.gen) onEvent(ev, turn);
    };
    try {
      var res = await fetch(
        A.base +
          '/assistant/conversations/' +
          encodeURIComponent(A.conv.id) +
          '/events?after=' +
          A.lastN,
        {
          headers: { Authorization: 'Bearer ' + (await token()) },
          cache: 'no-store',
          signal: ctl ? ctl.signal : undefined,
        }
      );
      if (gen !== A.gen) return 'closed';
      if (!res.ok) return [401, 403, 404].indexOf(res.status) >= 0 ? 'gone' : 'net';
      var reader =
        res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
      if (!reader) {
        takeLines((await res.text()) + '\n').lines.forEach(take);
        return 'closed';
      }
      var dec = typeof TextDecoder === 'function' ? new TextDecoder() : null;
      var buf = '';
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        var chunk = step.value;
        buf += typeof chunk === 'string' ? chunk : dec ? dec.decode(chunk, { stream: true }) : '';
        var got = takeLines(buf);
        buf = got.rest;
        got.lines.forEach(take);
        if (gen !== A.gen || A.turn !== turn) {
          try {
            reader.cancel();
          } catch {
            /* noop */
          }
          return 'closed';
        }
      }
      if (buf.trim()) take(buf);
      return 'closed';
    } catch {
      return 'net';
    } finally {
      if (A.ctl === ctl) A.ctl = null;
    }
  }

  /** 차례가 끝날 때까지 사건 줄을 따라간다 (닫히면 다시 연다) */
  async function follow(gen, turn, after) {
    A.lastN = after;
    var misses = 0;
    while (gen === A.gen && A.turn === turn) {
      var t0 = Date.now();
      var before = A.lastN;
      var how = await readEvents(gen, turn);
      if (gen !== A.gen || A.turn !== turn) return;
      if (how === 'gone') return endTurn(turn, LOST_MSG, false);
      var quick = how === 'net' || (A.lastN === before && Date.now() - t0 < T.quickMs);
      if (!quick) {
        misses = 0;
        continue;
      }
      misses++;
      if (misses > T.retry) return endTurn(turn, LOST_MSG, false);
      await sleep(T.waitMs * Math.pow(2, misses - 1));
    }
  }

  // ── 시작 ───────────────────────────────────────────────
  function bind() {
    $('asNew').addEventListener('click', newConv);
    $('asBack').addEventListener('click', function () {
      showList();
      loadList();
    });
    $('asConvs').addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-id]') : null;
      if (b) openConv(b.getAttribute('data-id'));
    });
    $('asForm').addEventListener('submit', send);
    $('asNoticeList').addEventListener('click', onNoticeClick);
    $('asBriefAsk').addEventListener('click', askBrief);
    $('asNoticesSeen').addEventListener('click', function () {
      markSeen(
        A.notices
          .filter(function (n) {
            return !n.seen_at;
          })
          .map(function (n) {
            return n.id;
          })
      );
    });
    $('asNoticesMore').addEventListener('click', function () {
      A.noticesAll = true;
      renderNotices();
    });
    $('asText').addEventListener('keydown', function (e) {
      // PC — Ctrl · ⌘ + Enter 로 보낸다 (Enter 는 줄 바꿈)
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send();
      }
    });
  }

  async function start(auth) {
    if (!auth || !auth.session || !auth.sb || !$('asConvs')) return;
    A.sb = auth.sb;
    A.session = auth.session;
    var shell = window.SeganShell;
    A.base = shell && shell.assistantBase ? shell.assistantBase() : '';
    if (!A.base) return setState(FAIL_MSG);
    var cfg = window.DADAM_CONFIG || {};
    A.work = (cfg.workflowApi && cfg.workflowApi.url) || '';
    var me = await api('/assistant/me');
    if (!me.ok) return setState(DENY[me.code] || FAIL_MSG);
    A.me = me.data || {};
    if (!A.me.level || A.me.level === 'none') return setState(DENY.not_entitled);
    bind();
    $('asReadonly').hidden = canChat();
    $('asNew').hidden = !canChat();
    $('asForm').hidden = !canChat();
    $('asBody').hidden = false;
    await Promise.all([loadList(), loadBrief(), loadNotices()]);
    var m = CONV_RE.exec(location.hash || '');
    if (m) await openConv(m[1]);
  }

  var exported = {
    BLOCKED: BLOCKED,
    state: A,
    timing: T,
    stamp: stamp,
    takeLines: takeLines,
    noticeText: noticeText,
    briefLines: briefLines,
    stagesText: stagesText,
    // 장부로 가기 — 시험이 갈아 끼운다
    go: function (url) {
      location.href = url;
    },
  };
  window.SeganAssistant = exported;
  exported.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
