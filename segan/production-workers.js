/* ============================================================
   segan/production-workers.js — 「인사 › 작업자」 다담 공장 (segan/me.html #productionWorkers)

   PC 화면 production.html(생산 현황판)의 작업자 부분을 앱 안으로 옮긴 것 — 서버 · 권한은 그대로, 화면만.
   (마이페이지 B안 4단계 — 화면마다 PR 하나. 표준시간 · 인력 설정은 생산 › 생산 설정 화면 segan/production-settings.js)

   누가 보나  다담 공장 구성원 가운데 공장 배정을 읽을 수 있는 사람 (account-api GET /partner/me 의 hq_member +
             서버가 공장 대표 · 실장 · 관리자에게만 주는 GET /production/factory-workers). 공장 직원 · 협력업체 ·
             다담 본사 구성원은 서버가 403 으로 막고, 이 칸은 그려지지 않는다.
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganProductionWorkers.load(sb, session, partnerMe) 를
             부른다. 이 칸을 그렸을 때 업체 칸(#partner)을 연다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /production/factory-workers          { assigned[{ id, worker{ display_name, status }, roles[],
                                                           assigned_at, from_link }], candidates[{ id, display_name, kinds[] }] }
               POST /production/factory-workers          { worker_id } — 공장에 배정
               POST /production/factory-workers/:id/end  배정 끝 (작업자 화면의 「공장」 탭이 사라진다)
               GET  /production/worker-links             { items[{ id, label, expires_at, last_used_at, revoked_at, linked }] }
               POST /production/worker-links/:id/revoke  링크 끊기 (새 링크는 만들지 않는다)
               GET  /production/calibration              { from, result[{ role, label, records, units, current, measured,
                                                           suggested, diffPct, minUnits }] } — 최근 30일 · 값은 초
               POST /production/calibration/apply        { roles[] | null(전부) } — 표준시간을 실측값으로
               GET  /production/worklogs?from=날짜       { items[{ work_date, worker_label, role, order_label, units, minutes }] }
   화면      공장 배정(고르기 + 「배정하기」 · 줄마다 「배정 끝」) · 작업자 링크(줄마다 「끊기」) ·
             실측 기록 · 표준시간 보정(공정마다 「…으로 적용」 · 「보정 모두 적용」 · 「최근 기록 보기」)
             부분마다 따로 그린다.
   이름      공정 · 작업자 종류 · 링크 상태 · 표 머리 · 안내 글은 production.html 과 같다.
   확인      「배정 끝」 · 「끊기」는 창을 띄우지 않는다 — 그 부분 아래에 물음 한 줄과 단추 둘을 그린다.
   못 읽으면  공장 배정(403 · 오류 · 끊김) → 칸째 감춘다. 작업자 링크 · 실측 보정 · 최근 기록만 못 읽으면 그 부분만 뺀다.
             누른 일이 안 되면 서버 글을 위 한 줄에.
   고객 정보  실측 기록의 주문 이름 · 작업자 이름은 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var KST_MS = 9 * 3600 * 1000;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var WEEK = '일월화수목금토';
  var LOG_MAX = 100; // 최근 기록 — 앞의 100줄 (production.html 과 같다)
  var SETTINGS_HASH = '#p-config'; // 표준시간 · 인력 설정 (생산 › 생산 설정 — segan/production-settings.js)

  // 공정 · 작업자 종류 — production.html 과 같다
  var ROLE = { cutter: '재단', edge: '엣지', asm: '조립' };
  var KIND = { install: '설치', as: 'A/S', assembly: '조립', cutting: '재단', edge: '엣지' };
  var LINK_STATE = { linked: '계정에 이음', revoked: '끊음', expired: '만료', live: '사용 중' };
  var PARTS = ['factory', 'links', 'calib'];

  var TEXT = {
    title: '작업자',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    working: '처리하는 중입니다.',
    empty: '아직 없습니다.',
    factoryHelp:
      '승인된 작업자(재단 · 엣지 · 조립)를 이 생산 계획에 배정하면, 작업자 계정의 「공장」 탭에서 오늘 할 일 · 지시를 보고 시작 · 완료로 실제 걸린 시간을 남깁니다. 작업자 신청 승인 · 종류는 관리자 「작업 배정」 화면에서 합니다.',
    pickLabel: '배정할 작업자',
    noCandidates: '배정할 수 있는 작업자가 없습니다',
    assign: '배정하기',
    assigned: '공장에 배정했습니다.',
    end: '배정 끝',
    endAsk: '이 작업자의 공장 배정을 끝낼까요? 작업자 화면의 「공장」 탭이 사라집니다.',
    endYes: '배정 끝내기',
    ended: '공장 배정을 끝냈습니다.',
    noRoles: '공정 없음',
    fromLink: '링크에서 이음',
    linksHelp:
      '새 링크는 만들지 않습니다. 작업자는 작업자 포털에서 신청하고, 승인되면 위 「공장 배정」에서 배정합니다. 남은 링크는 만료되거나 끊을 때까지 열리고, 작업자가 로그인한 채 열어 「내 계정에 잇기」를 하면 계정으로 옮겨집니다.',
    revoke: '끊기',
    revokeAsk: '이 링크를 끊을까요? 작업자는 더 이상 열 수 없습니다.',
    revokeYes: '링크 끊기',
    revoked: '링크를 끊었습니다.',
    cancel: '취소',
    calibHelp:
      '작업자가 남긴 기록으로 1단위에 실제 걸린 시간을 냅니다. 10단위 이상 쌓인 공정만 제안합니다.',
    applyAll: '보정 모두 적용',
    applied:
      '표준시간을 실측값으로 바꿨습니다. 생산 계획에서 「지금 다시 계산」을 누르면 추천에 반영됩니다.',
    reflected: '반영됨',
    noLogs: '기록 없음',
    logs: '최근 기록 보기',
    settings: '생산 설정',
    settingsHelp: '표준시간 · 인력 설정은 생산 › 「생산 설정」에서 합니다.',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    me: null,
    ready: false, // 처음 읽기를 마쳤다 (칸을 그렸다)
    factory: null, // { assigned[], candidates[] } (못 읽으면 null — 칸째 감춘다)
    links: null, // 작업자 링크 줄 (못 읽으면 null — 그 부분을 뺀다)
    calib: null, // { from, result[] } (못 읽으면 null — 그 부분을 뺀다)
    logs: null, // 최근 기록 (못 읽으면 null — 「최근 기록 보기」를 뺀다)
    ask: null, // 확인을 기다리는 일 { kind: 'end' | 'revoke', id }
    busy: false, // 누른 일을 처리하는 중
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
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  // ── 글자 꼴 ─────────────────────────────────────────
  /** 초 → '1.5분' (없으면 '-') — production.html 과 같다 */
  function mins(s) {
    return s == null || !isFinite(Number(s)) ? '-' : (Number(s) / 60).toFixed(1) + '분';
  }
  /** 'YYYY-MM-DD' → '11/12(목)' (없으면 '-') */
  function day(s) {
    s = str(s).slice(0, 10);
    if (!DAY_RE.test(s)) return '-';
    var d = new Date(s + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '-';
    return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + '(' + WEEK[d.getUTCDay()] + ')';
  }
  /** 때 → 한국 날짜 'YYYY-MM-DD' (없으면 '-') */
  function dateKst(iso) {
    var t = Date.parse(str(iso));
    return isNaN(t) ? '-' : new Date(t + KST_MS).toISOString().slice(0, 10);
  }
  /** 때 → 한국 시각 'MM/DD HH:MM' (없으면 '-') */
  function stamp(iso) {
    var t = Date.parse(str(iso));
    if (isNaN(t)) return '-';
    var at = new Date(t + KST_MS).toISOString();
    return at.slice(5, 7) + '/' + at.slice(8, 10) + ' ' + at.slice(11, 16);
  }
  function roleName(r) {
    return own(ROLE, r) ? ROLE[r] : str(r);
  }
  function kindName(k) {
    return own(KIND, k) ? KIND[k] : str(k);
  }

  function canSee(me) {
    return !!me && typeof me === 'object' && !Array.isArray(me) && me.hq_member === true;
  }

  /** 링크 상태 — 'linked' | 'revoked' | 'expired' | 'live' (production.html 과 같은 차례) */
  function linkState(l, nowMs) {
    l = obj(l);
    if (l.linked) return 'linked';
    if (l.revoked_at) return 'revoked';
    var t = Date.parse(str(l.expires_at));
    return !isNaN(t) && t < (nowMs == null ? Date.now() : nowMs) ? 'expired' : 'live';
  }
  /** 적용할 보정이 있는 공정인가 */
  function canApply(r) {
    r = obj(r);
    return r.suggested != null && r.suggested !== r.current;
  }

  // ── 서버 ────────────────────────────────────────────
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
  async function call(method, path, body) {
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(J.base + path, {
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

  async function readFactory() {
    var r = await call('GET', '/production/factory-workers');
    var d = r.ok ? r.body.data : null;
    J.factory =
      d && typeof d === 'object' && !Array.isArray(d)
        ? { assigned: arr(d.assigned), candidates: arr(d.candidates) }
        : null;
    return r;
  }
  async function readLinks() {
    var r = await call('GET', '/production/worker-links');
    var d = r.ok ? obj(r.body.data) : null;
    J.links = d && Array.isArray(d.items) ? d.items : null;
    return r;
  }
  /** 실측 보정 + 그 기간의 기록 (기록만 못 읽으면 「최근 기록 보기」만 뺀다) */
  async function readCalib() {
    var r = await call('GET', '/production/calibration');
    var d = r.ok ? obj(r.body.data) : null;
    J.calib = d && Array.isArray(d.result) ? { from: str(d.from), result: d.result } : null;
    J.logs = null;
    if (J.calib && DAY_RE.test(J.calib.from)) {
      var l = await call('GET', '/production/worklogs?from=' + J.calib.from);
      var ld = l.ok ? obj(l.body.data) : null;
      J.logs = ld && Array.isArray(ld.items) ? ld.items : null;
    }
    return r;
  }

  // ── 그리기 ──────────────────────────────────────────
  function tableHtml(heads, rows) {
    return (
      '<div class="od-tablewrap"><table class="od-table"><thead><tr>' +
      heads
        .map(function (h) {
          return (
            '<th scope="col"' +
            (h[1] ? ' class="od-num"' : h[0] ? '' : ' class="pw-act"') +
            '>' +
            (h[0] ? esc(h[0]) : '<span class="pw-sr">' + esc(h[2] || '') + '</span>') +
            '</th>'
          );
        })
        .join('') +
      '</tr></thead><tbody>' +
      rows.join('') +
      '</tbody></table></div>'
    );
  }
  /** 확인 한 줄 — 창을 띄우지 않고 그 부분 아래에 그린다 */
  function askHtml(name, question, yes) {
    return (
      '<div class="pw-ask" role="group" aria-label="확인" data-pw="ask"><p>' +
      (name ? '<b>' + esc(name) + '</b> — ' : '') +
      esc(question) +
      '</p><div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="yes">' +
      esc(yes) +
      '</button><button type="button" class="mk-btn" data-act="no">' +
      esc(TEXT.cancel) +
      '</button></div></div>'
    );
  }
  function asking(kind, id) {
    return !!J.ask && J.ask.kind === kind && J.ask.id === id;
  }

  /** 공장 배정 — 고르기 + 「배정하기」 · 배정된 작업자 줄 */
  function factoryHtml() {
    var f = J.factory;
    if (!f) return '';
    var candidates = f.candidates.filter(function (w) {
      return w && typeof w === 'object' && ID_RE.test(str(w.id));
    });
    var options = candidates
      .map(function (w) {
        var kinds = arr(w.kinds).map(kindName).join(' · ');
        return (
          '<option value="' +
          esc(w.id) +
          '">' +
          esc(str(w.display_name) + (kinds ? ' (' + kinds + ')' : '')) +
          '</option>'
        );
      })
      .join('');
    var askName = '';
    var rows = f.assigned
      .filter(function (a) {
        return a && typeof a === 'object' && ID_RE.test(str(a.id));
      })
      .map(function (a) {
        var w = obj(a.worker);
        var status = str(w.status);
        var name =
          str(w.display_name) +
          (status === 'approved' || !status
            ? ''
            : ' (' + (status === 'suspended' ? '정지' : status) + ')');
        var roles = arr(a.roles).map(roleName).join(' · ');
        var on = asking('end', a.id);
        if (on) askName = str(w.display_name);
        return (
          '<tr' +
          (on ? ' class="od-row--on"' : '') +
          '><td>' +
          esc(name) +
          '</td><td' +
          (roles ? '' : ' class="pw-muted"') +
          '>' +
          esc(roles || TEXT.noRoles) +
          '</td><td>' +
          esc(dateKst(a.assigned_at) + (a.from_link ? ' · ' + TEXT.fromLink : '')) +
          '</td><td class="pw-act"><button type="button" class="od-open" data-act="end" data-id="' +
          esc(a.id) +
          '">' +
          esc(TEXT.end) +
          '</button></td></tr>'
        );
      });
    return (
      '<h4 class="od-h">공장 배정</h4><p class="mk-note">' +
      esc(TEXT.factoryHelp) +
      '</p><div class="pw-add"><select name="worker" aria-label="' +
      esc(TEXT.pickLabel) +
      '"' +
      (options ? '' : ' disabled') +
      '>' +
      (options || '<option value="">' + esc(TEXT.noCandidates) + '</option>') +
      '</select><button type="button" class="mk-btn" data-act="assign"' +
      (options ? '' : ' disabled') +
      '>' +
      esc(TEXT.assign) +
      '</button></div>' +
      (rows.length
        ? tableHtml([['작업자'], ['공정'], ['배정'], ['', 0, '하기']], rows)
        : '<p class="me-empty">' + esc(TEXT.empty) + '</p>') +
      (J.ask && J.ask.kind === 'end' ? askHtml(askName, TEXT.endAsk, TEXT.endYes) : '')
    );
  }

  /** 작업자 링크 — 남은 링크를 보고 끊는다 (새 링크는 만들지 않는다) */
  function linksHtml() {
    if (!J.links) return '';
    var askName = '';
    var rows = J.links
      .filter(function (l) {
        return l && typeof l === 'object' && ID_RE.test(str(l.id));
      })
      .map(function (l) {
        var st = linkState(l);
        var on = asking('revoke', l.id);
        if (on) askName = str(l.label);
        return (
          '<tr' +
          (on ? ' class="od-row--on"' : '') +
          '><td>' +
          esc(str(l.label) || '-') +
          '</td><td>' +
          esc(LINK_STATE[st]) +
          '</td><td>' +
          esc(dateKst(l.expires_at)) +
          '</td><td>' +
          esc(l.last_used_at ? stamp(l.last_used_at) : '-') +
          '</td><td class="pw-act">' +
          (st === 'live'
            ? '<button type="button" class="od-open" data-act="revoke" data-id="' +
              esc(l.id) +
              '">' +
              esc(TEXT.revoke) +
              '</button>'
            : '') +
          '</td></tr>'
        );
      });
    return (
      '<h4 class="od-h">작업자 링크</h4><p class="mk-note">' +
      esc(TEXT.linksHelp) +
      '</p>' +
      (rows.length
        ? tableHtml([['작업자'], ['상태'], ['만료'], ['마지막 사용'], ['', 0, '하기']], rows)
        : '<p class="me-empty">' + esc(TEXT.empty) + '</p>') +
      (J.ask && J.ask.kind === 'revoke' ? askHtml(askName, TEXT.revokeAsk, TEXT.revokeYes) : '')
    );
  }

  /** 최근 기록 (접어 둔다) */
  function logsHtml() {
    if (!J.logs) return '';
    var rows = J.logs.slice(0, LOG_MAX).map(function (l) {
      l = obj(l);
      return (
        '<tr><td>' +
        esc(day(l.work_date)) +
        '</td><td>' +
        esc(str(l.worker_label) || '-') +
        '</td><td>' +
        esc(roleName(l.role)) +
        '</td><td>' +
        esc(str(l.order_label) || '-') +
        '</td><td class="od-num">' +
        num(l.units) +
        '</td><td class="od-num">' +
        num(l.minutes) +
        '</td></tr>'
      );
    });
    return (
      '<details class="pw-more"><summary>' +
      esc(TEXT.logs) +
      '</summary>' +
      (rows.length
        ? tableHtml([['날짜'], ['작업자'], ['공정'], ['주문'], ['수량', 1], ['분', 1]], rows)
        : '<p class="me-empty">' + esc(TEXT.empty) + '</p>') +
      '</details>'
    );
  }

  /** 실측 기록 · 표준시간 보정 (최근 30일) */
  function calibHtml() {
    var c = J.calib;
    if (!c) return '';
    var any = false;
    var rows = c.result
      .filter(function (r) {
        return r && typeof r === 'object' && own(ROLE, str(r.role));
      })
      .map(function (r) {
        var diff = r.diffPct == null ? '-' : (num(r.diffPct) > 0 ? '+' : '') + num(r.diffPct) + '%';
        var act;
        if (canApply(r)) {
          any = true;
          act =
            '<button type="button" class="od-open" data-act="apply" data-role="' +
            esc(r.role) +
            '">' +
            esc(mins(r.suggested) + '으로 적용') +
            '</button>';
        } else if (r.suggested != null) act = esc(TEXT.reflected);
        else
          act =
            '<span class="pw-muted">' +
            esc(
              num(r.units)
                ? '기록 ' + num(r.units) + '/' + num(r.minUnits) + '단위 (부족)'
                : TEXT.noLogs
            ) +
            '</span>';
        return (
          '<tr><td>' +
          esc(str(r.label) || roleName(r.role)) +
          '</td><td>' +
          act +
          '</td><td class="od-num">' +
          num(r.records) +
          '</td><td class="od-num">' +
          num(r.units) +
          '</td><td class="od-num">' +
          esc(mins(r.current)) +
          '</td><td class="od-num">' +
          esc(mins(r.measured)) +
          '</td><td class="od-num">' +
          esc(diff) +
          '</td></tr>'
        );
      });
    return (
      '<h4 class="od-h">실측 기록 · 표준시간 보정 (최근 30일)</h4><p class="mk-note">' +
      esc(TEXT.calibHelp) +
      '</p>' +
      (rows.length
        ? tableHtml(
            [
              ['공정'],
              ['보정'],
              ['기록', 1],
              ['수량', 1],
              ['현재 표준', 1],
              ['실측', 1],
              ['차이', 1],
            ],
            rows
          )
        : '<p class="me-empty">' + esc(TEXT.empty) + '</p>') +
      '<div class="rd-acts"><button type="button" class="mk-btn" data-act="apply-all"' +
      (any ? '' : ' disabled') +
      '>' +
      esc(TEXT.applyAll) +
      '</button></div>' +
      logsHtml() +
      '<p class="mk-note">' +
      esc(TEXT.settingsHelp) +
      ' <a class="od-pc" href="' +
      SETTINGS_HASH +
      '">' +
      esc(TEXT.settings) +
      ' →</a></p>'
    );
  }

  var HTML = { factory: factoryHtml, links: linksHtml, calib: calibHtml };

  function partEl(name) {
    var box = $('productionWorkers');
    return box ? box.querySelector('[data-pw-part="' + name + '"]') : null;
  }
  /** 고른 부분만 다시 그린다 — 펼쳐 둔 「최근 기록 보기」는 그대로 둔다 */
  function paint(names) {
    names.forEach(function (name) {
      var el = partEl(name);
      if (!el) return;
      var more = el.querySelector('details');
      var open = !!more && more.open;
      var html = HTML[name]();
      el.innerHTML = html;
      el.hidden = !html;
      more = el.querySelector('details');
      if (more && open) more.open = true;
    });
  }
  function say(text) {
    var box = $('productionWorkers');
    var el = box && box.querySelector('[data-pw="msg"]');
    if (el) el.textContent = text || '';
  }
  /** 다담 공장 구성원은 업체 내용이 없다 — 이 칸을 그렸으면 업체 칸을 연다 */
  function showSection() {
    var section = $('partner');
    var box = $('productionWorkers');
    if (section && box && !box.hidden) section.hidden = false;
  }
  /** 칸 전체 — 제목 · 한 줄 알림 · 부분마다 빈 자리 */
  function render() {
    var box = $('productionWorkers');
    if (!box) return;
    box.innerHTML =
      '<h3 class="me-pt-sub" id="productionWorkersTitle">' +
      esc(TEXT.title) +
      '</h3><p class="me-pt-msg" role="status" data-pw="msg"></p>' +
      PARTS.map(function (name) {
        return '<div class="od-sec pw-sec" data-pw-part="' + name + '" hidden></div>';
      }).join('');
    box.hidden = false;
    paint(PARTS);
    showSection();
  }

  // ── 누른 일 ─────────────────────────────────────────
  /** 처리하는 동안 단추를 한 번만 받는다 */
  async function busy(fn) {
    if (J.busy) return;
    J.busy = true;
    var box = $('productionWorkers');
    if (box) box.setAttribute('aria-busy', 'true');
    say(TEXT.working);
    try {
      say((await fn()) || '');
    } catch {
      say(TEXT.generic);
    } finally {
      J.busy = false;
      if (box) box.removeAttribute('aria-busy');
    }
  }

  /** 고른 작업자를 공장에 배정한다 */
  async function assign() {
    var sel = partEl('factory') && partEl('factory').querySelector('select[name="worker"]');
    var id = sel ? sel.value : '';
    if (!ID_RE.test(id)) return '';
    var r = await call('POST', '/production/factory-workers', { worker_id: id });
    if (!r.ok) return errText(r);
    await readFactory();
    paint(['factory']);
    return TEXT.assigned;
  }

  /** 확인을 묻는다 — 그 부분 아래에 물음과 단추 둘 */
  function ask(kind, id) {
    if (!ID_RE.test(id)) return;
    var before = J.ask;
    J.ask = { kind: kind, id: id };
    say('');
    paint(
      before && before.kind !== kind ? ['factory', 'links'] : [kind === 'end' ? 'factory' : 'links']
    );
    var el = partEl(kind === 'end' ? 'factory' : 'links');
    var yes = el && el.querySelector('[data-act="yes"]');
    if (yes && yes.focus) yes.focus();
  }
  function cancelAsk() {
    if (!J.ask) return;
    var name = J.ask.kind === 'end' ? 'factory' : 'links';
    J.ask = null;
    paint([name]);
  }
  /** 확인한 일을 한다 — 배정 끝 · 링크 끊기 */
  async function confirmAsk() {
    var a = J.ask;
    if (!a) return '';
    var end = a.kind === 'end';
    var r = await call(
      'POST',
      end
        ? '/production/factory-workers/' + encodeURIComponent(a.id) + '/end'
        : '/production/worker-links/' + encodeURIComponent(a.id) + '/revoke'
    );
    J.ask = null;
    if (end) await readFactory();
    else await readLinks();
    paint([end ? 'factory' : 'links']);
    if (!r.ok) return errText(r);
    return end ? TEXT.ended : TEXT.revoked;
  }

  /** 표준시간을 실측값으로 — role 이 없으면 제안이 있는 공정 전부 */
  async function applyCalib(role) {
    if (role && !own(ROLE, role)) return '';
    var r = await call('POST', '/production/calibration/apply', { roles: role ? [role] : null });
    if (!r.ok) return errText(r);
    await readCalib();
    paint(['calib']);
    return TEXT.applied;
  }

  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn || btn.disabled || J.busy) return;
    var act = btn.getAttribute('data-act');
    if (act === 'assign') busy(assign);
    else if (act === 'end' || act === 'revoke') ask(act, btn.getAttribute('data-id') || '');
    else if (act === 'no') cancelAsk();
    else if (act === 'yes') busy(confirmAsk);
    else if (act === 'apply-all')
      busy(function () {
        return applyCalib('');
      });
    else if (act === 'apply') {
      var role = btn.getAttribute('data-role') || '';
      if (role)
        busy(function () {
          return applyCalib(role);
        });
    }
  }

  /**
   * 업체 칸을 읽은 뒤 부른다 (segan/me.js). 다담 공장 구성원만 — 공장 배정을 못 읽으면(공장 직원 403 · 오류) 칸째 감춘다.
   * 읽기만 한다 — 여는 것만으로는 아무것도 바꾸거나 보내지 않는다
   */
  async function load(sb, session, me) {
    var box = $('productionWorkers');
    if (!box) return;
    var hide = function () {
      box.hidden = true;
      box.innerHTML = '';
      J.ready = false;
    };
    hide();
    var cfg = window.DADAM_CONFIG || {};
    J.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    J.sb = sb;
    J.session = session;
    J.me = me;
    J.factory = null;
    J.links = null;
    J.calib = null;
    J.logs = null;
    J.ask = null;
    J.busy = false;
    if (!J.base || !session || !canSee(me)) return;
    try {
      await readFactory();
      if (!J.factory) return;
      await Promise.all([readLinks(), readCalib()]);
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
      }
      J.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganProductionWorkers = {
    ROLE: ROLE,
    KIND: KIND,
    LINK_STATE: LINK_STATE,
    TEXT: TEXT,
    canSee: canSee,
    linkState: linkState,
    canApply: canApply,
    mins: mins,
    day: day,
    dateKst: dateKst,
    stamp: stamp,
    state: J,
    load: load,
  };
})();
