/* ============================================================
   segan/project-work.js — 프로젝트의 「작업 배정」 칸 (segan/partner-projects.js 의 프로젝트 줄 안)

   한 길: 작업 종류 → 작업자 → 배정 → 승인(작업자 수락) → 연결
   (2026-11-13 사장님 결정 — 프로젝트 한 화면에서 정한다. 종류는 철거 · 재단 · 엣지 · 조립 · 설치 · A/S.
    승인은 작업자가 「수락」, 처음 보는 작업자만 팩토리가 한 번 승인 — segan/company-workers.js)
   (2026-11-14 납품 일정 줄도 배정한다 — 종류 「납품」. 줄마다 「모집 올리기」 — segan/work-recruit.js)

   누가 보나  인사를 쓰는 팩토리(다담 공장 · Agent)의 구성원 — segan/partner-projects.js 가 프로젝트 줄에 단추를 그리고
             SeganProjectWork.mount(자리, { id, title }) 를 부른다. 배정 · 날짜 · 초대는 서버 답(can_manage · can_assign)을 따른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET   /company/projects/:id/work           { project, can_manage, can_assign, rows[{ key, kind, label, source, schedule_id,
                                                            at, job, can_assign, workers[], candidates[] }] }
               POST  /company/projects/:id/work           { kind, link_ids[], at? } — 철거 · 재단 · 엣지 · 조립 줄
               PATCH /company/projects/:id/work/:kind     { at } — 그 줄의 날짜 · 시각
               POST  /company/projects/:id/work/invite    { kind, schedule_id?, expires_at } → { url, expires_at } 「이 일로 바로」 초대
               POST  /company/schedules/:id/workers       { link_ids[] } — 납품 · 설치 · A/S 줄 (일정에 붙는다)
               POST  /company/projects/:id/work/recruit   { kind, people, apply_deadline?, at? } | { kind, stop: true } — 종류 줄의 모집
               POST  /company/schedules/:id/workers/recruit { people, apply_deadline? } | { stop: true } — 일정 줄의 모집
               POST  /company/work/applications/:id/approve | reject — 신청한 작업자 뽑기 · 반려
               POST  /company/work/assignments/:id/accept | revision { reason } | remove { reason }
   화면      표 한 장 — 줄 = 종류 (철거 · 재단 · 엣지 · 조립 + 그 프로젝트의 설치 · A/S 일정). 칸 = 작업자 · 날짜 · 상태 · 「고르기」.
             「고르기」를 누르면 그 줄 아래에: 배정된 작업자(상태 · 보고 글 · 「확인」 「보완요청」 「빼기」) ·
             날짜(철거 · 재단 · 엣지 · 조립 — 설치 · A/S 날짜는 일정에서) · 연결된 작업자 고르기 → 「배정하기」 ·
             「모집」(인원 · 지원 종료일 → 「모집 올리기」, 신청한 작업자 「뽑기」 「반려」, 「모집 내리기」 — segan/work-recruit.js) ·
             「새 작업자 초대」(이 일로 바로 — 만료는 3일 · 7일 · 30일 가운데 고른다, 미리 고른 값 없음) → 링크 상자 + 「링크 복사」.
             상태: 수락 대기 → 연결됨(작업자가 수락) → 작업 중 → 완료 보고 → 확인함.
   못 읽으면  칸 안에 서버 글과 「닫기」만 (DB 0065 적용 전이면 「DB 0065 적용 전입니다…」).
   정보      작업자 이름 · 보고 글 · 초대 링크는 화면에만 그린다 — 기기 저장 · 알림 · 주소에 싣지 않는다.
   ============================================================ */
/* global window, fetch, navigator */
(function () {
  'use strict';

  var PLANS = ['agent']; // 인사를 쓰는 등급 (+ 다담 공장) — segan/me.js PEOPLE_PLANS
  var KST_MS = 9 * 3600 * 1000;
  var DAY_MS = 86400000;
  var WEEK = '일월화수목금토';
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var REASON_MAX = 200;
  var DAYS = [3, 7, 30]; // 초대 만료 — 고르는 값 (미리 고르지 않는다)
  // 프로젝트에 붙는 종류 (일하는 차례) — 서버 work/validate.js PROJECT_KINDS
  var PROJECT_KINDS = ['demolition', 'cutting', 'edge', 'assembly'];
  var KIND = {
    demolition: '철거',
    cutting: '재단',
    edge: '엣지',
    assembly: '조립',
    delivery: '납품',
    install: '설치',
    as: 'A/S',
  };
  // 배정 상태 — 수락하면 「연결됨」 (서버 값 confirmed)
  var STATE = {
    offered: '수락 대기',
    confirmed: '연결됨',
    started: '작업 중',
    submitted: '완료 보고',
    revision: '보완 요청',
    accepted: '확인함',
    declined: '거절',
    released: '포기',
    removed: '뺌',
  };
  var LIVE = ['offered', 'confirmed', 'started', 'submitted', 'revision'];
  var SHOWN = LIVE.concat(['accepted']);
  var REPORT = {
    progress: '진행',
    issue: '문제',
    result: '완료 보고',
    note: '메모',
    correction: '정정',
  };

  var TEXT = {
    title: '작업 배정',
    note: '작업 종류마다 작업자를 골라 배정합니다. 작업자가 수락하면 그 일과 연결됩니다.',
    noteRead: '이 프로젝트에 배정된 작업자입니다. 배정은 대표 · 실장이 합니다.',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    loading: '작업 배정을 불러오는 중입니다.',
    failed: '작업 배정을 불러오지 못했습니다. 잠시 뒤 다시 해 주세요.',
    pick: '고르기',
    see: '보기',
    fold: '접기',
    noName: '(이름 없음)',
    none: '아직 배정한 작업자가 없습니다.',
    installSoon: '설치 일정을 넣으면 여기서 배정합니다 (프로젝트 관리 › 업무 달력).',
    asSoon: 'A/S 방문일을 잡으면 줄이 생깁니다.',
    scheduleDate: '날짜는 일정에서 고칩니다 (프로젝트 관리 › 설치 · A/S).',
    date: '날짜',
    time: '시각',
    saveDate: '날짜 저장',
    clearDate: '날짜 지우기',
    needDate: '날짜를 골라 주세요.',
    needTime: '시각을 골라 주세요.',
    dateSaved: '날짜를 저장했습니다.',
    dateCleared: '날짜를 지웠습니다.',
    candidates: '배정할 작업자 (여럿 고를 수 있습니다)',
    noCandidates:
      '이 종류로 연결된 작업자가 없습니다. 아래에서 새 작업자를 초대하거나, 인사 › 작업자에서 승인해 주세요.',
    assign: '배정하기',
    assignNote: '배정하면 작업자에게 알림이 가고, 작업자가 수락해야 연결됩니다.',
    assigned: '배정했습니다. 작업자가 수락하면 연결됩니다.',
    accept: '확인',
    accepted: '완료 보고를 확인했습니다.',
    revision: '보완요청',
    revisionAsk: '보완할 내용을 적어 주세요. 작업자에게 그대로 보입니다.',
    revised: '보완을 요청했습니다.',
    remove: '빼기',
    removeAsk: '이 작업자를 이 일에서 뺄까요? 사유는 우리 팩토리 기록에만 남습니다.',
    removed: '작업자를 뺐습니다.',
    reason: '사유',
    needReason: '사유를 적어 주세요.',
    cancel: '취소',
    invite: '새 작업자 초대 (이 일로 바로)',
    inviteHelp:
      '링크를 받은 사람이 로그인해 신청하면 인사 › 작업자의 「승인 대기」에 나타납니다. 승인하면 이 일의 배정 제안이 그 사람에게 갑니다. 이미 연결된 작업자가 열면 바로 갑니다.',
    days: '링크 만료',
    daysUnit: '일',
    pickDays: '링크 만료를 골라 주세요.',
    makeInvite: '초대 링크 만들기',
    made: '초대 링크',
    madeNote:
      '까지 쓸 수 있습니다. 링크는 지금만 보이니 복사해서 카카오톡 · 문자로 보내 주세요. 한 번만 쓸 수 있습니다.',
    madeMsg: '초대 링크를 만들었습니다.',
    copy: '링크 복사',
    copied: '복사했습니다. 메시지로 보내 주세요.',
    copyFail: '복사하지 못했습니다. 링크를 길게 눌러 복사해 주세요.',
    declined: '사유',
    workerScreen: '작업자는 앱 「작업」 화면에서 초대를 받고 수락 · 보고합니다.',
    workerScreenLink: '작업자 화면 열기',
  };

  var W = {
    base: '',
    sb: null,
    session: null,
    id: '', // 프로젝트 id
    host: null,
    data: null,
    loading: false,
    loadErr: '',
    open: '', // 펼친 줄의 key
    picked: [],
    ask: null, // { kind: 'revision' | 'remove', id }
    days: 0,
    made: null, // { key, url, expires_at } — 화면에만
    copy: '',
    msg: '',
    err: '',
    busy: false,
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v) {
    return typeof v === 'string' ? v.trim() : '';
  }
  function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  /** 모집 칸 (segan/work-recruit.js) — 못 읽었으면 모집 칸 없이 그린다 */
  function recruitKit() {
    var R = window.SeganWorkRecruit;
    return R && typeof R.blockHtml === 'function' ? R : null;
  }

  /** 인사를 쓰는 팩토리인가 — 다담 공장 · Agent (작업 배정 단추) */
  function canSee(me) {
    var m = obj(me);
    if (m.platform_member === true) return false;
    if (m.hq_member === true) return true;
    return PLANS.indexOf(obj(m.company).plan) >= 0;
  }

  // ── 날짜 (순수) ───────────────────────────────────────
  /** 때 → { day: 'YYYY-MM-DD', time: 'HH:MM' } 한국 시간 (없으면 null) */
  function partsOf(iso) {
    var t = Date.parse(typeof iso === 'string' ? iso : '');
    if (isNaN(t)) return null;
    var at = new Date(t + KST_MS).toISOString();
    return { day: at.slice(0, 10), time: at.slice(11, 16) };
  }
  /** 때 → '11/18 (수) 09:00' (없으면 '') */
  function whenText(iso) {
    var p = partsOf(iso);
    if (!p) return '';
    var d = new Date(Date.parse(p.day + 'T00:00:00Z'));
    return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + ' (' + WEEK[d.getUTCDay()] + ') ' + p.time;
  }
  /** 날 + 시각 → 보낼 때 ('2026-11-18T09:00:00+09:00') | { error } */
  function atOf(day, time) {
    if (!DAY_RE.test(str(day)) || isNaN(Date.parse(day + 'T00:00:00Z')))
      return { error: 'date', message: TEXT.needDate };
    if (!TIME_RE.test(str(time))) return { error: 'time', message: TEXT.needTime };
    return { at: day + 'T' + time + ':00+09:00' };
  }
  function expiresIn(days, nowMs) {
    return new Date((nowMs == null ? Date.now() : nowMs) + days * DAY_MS).toISOString();
  }

  // ── 본문 읽기 (순수) ──────────────────────────────────
  function workerOf(w) {
    w = obj(w);
    if (!ID_RE.test(str(w.assignment_id)) || !own(STATE, w.status)) return null;
    return {
      id: str(w.assignment_id),
      name: str(w.name),
      status: w.status,
      label: STATE[w.status],
      reason: str(w.reason),
      live: LIVE.indexOf(w.status) >= 0,
      reports: (Array.isArray(w.reports) ? w.reports : [])
        .filter(function (u) {
          return u && typeof u === 'object' && str(u.body);
        })
        .map(function (u) {
          return {
            label: REPORT[u.kind] || '',
            by: u.by === 'company' ? 'company' : 'worker',
            body: str(u.body),
            at: whenText(u.at),
          };
        }),
    };
  }
  function rowOf(r) {
    r = obj(r);
    if (!str(r.key) || !own(KIND, r.kind)) return null;
    var schedule = r.source === 'schedule';
    if (schedule && !ID_RE.test(str(r.schedule_id))) return null;
    return {
      key: str(r.key),
      kind: r.kind,
      label: str(r.label) || KIND[r.kind],
      schedule: schedule ? str(r.schedule_id) : '',
      at: str(r.at),
      job: r.job && typeof r.job === 'object' ? str(r.job.status) : '',
      assign: r.can_assign === true,
      recruit: recruitKit() ? recruitKit().recruitOf(r.recruit) : null,
      workers: (Array.isArray(r.workers) ? r.workers : []).map(workerOf).filter(Boolean),
      candidates: (Array.isArray(r.candidates) ? r.candidates : [])
        .filter(function (c) {
          return c && typeof c === 'object' && ID_RE.test(str(c.link_id));
        })
        .map(function (c) {
          return { id: str(c.link_id), name: str(c.name), region: str(c.region) };
        }),
    };
  }
  /** GET /company/projects/:id/work 의 data → { manage, assign, rows } | null */
  function dataOf(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.rows)) return null;
    return {
      manage: d.can_manage === true,
      assign: d.can_manage === true && d.can_assign === true,
      rows: d.rows.map(rowOf).filter(Boolean),
    };
  }
  /** 줄의 작업자 칸 — '김○○ · 이○○' (살아 있는 · 확인된 배정만, 없으면 '') */
  function namesOf(row) {
    return row.workers
      .filter(function (w) {
        return SHOWN.indexOf(w.status) >= 0;
      })
      .map(function (w) {
        return w.name || TEXT.noName;
      })
      .join(' · ');
  }
  /** 줄의 상태 칸 — '수락 대기 1 · 연결됨 1 · 모집 중 · 신청 2' (없으면 '') */
  function stateOf(row) {
    var R = recruitKit();
    return [assignStateOf(row), R ? R.summaryOf(row.recruit) : ''].filter(Boolean).join(' · ');
  }
  function assignStateOf(row) {
    var order = ['offered', 'confirmed', 'started', 'submitted', 'revision', 'accepted'];
    var shown = row.workers.filter(function (w) {
      return SHOWN.indexOf(w.status) >= 0;
    });
    return order
      .map(function (st) {
        var n = shown.filter(function (w) {
          return w.status === st;
        }).length;
        return n ? STATE[st] + (shown.length > 1 ? ' ' + n : '') : '';
      })
      .filter(Boolean)
      .join(' · ');
  }

  // ── 서버 ──────────────────────────────────────────────
  async function token() {
    try {
      var r = W.sb && (await W.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return W.session ? W.session.access_token : '';
  }
  async function call(method, path, body) {
    if (!W.base) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(W.base + path, {
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
  function errText(r, fallback) {
    var m = r && r.body && r.body.message;
    return typeof m === 'string' && m ? m : fallback || TEXT.generic;
  }
  var workPath = function () {
    return '/company/projects/' + encodeURIComponent(W.id) + '/work';
  };
  async function read() {
    var r = await call('GET', workPath());
    var d = r.ok ? dataOf(r.body.data) : null;
    if (d) {
      W.data = d;
      W.loadErr = '';
    } else if (!W.data) W.loadErr = r.ok ? TEXT.failed : errText(r, TEXT.failed);
    return !!d;
  }

  // ── 그리기 ────────────────────────────────────────────
  function dis() {
    return W.busy ? ' disabled' : '';
  }
  function btn(act, label, extra, solid) {
    return (
      '<button type="button" class="' +
      (solid === 'link' ? 'od-open' : 'mk-btn' + (solid ? ' mk-btn--solid' : '')) +
      '" data-act="' +
      act +
      '"' +
      (extra || '') +
      dis() +
      '>' +
      esc(label) +
      '</button>'
    );
  }
  function tableHtml(d) {
    var hasInstall = d.rows.some(function (r) {
      return r.kind === 'install';
    });
    var hasAs = d.rows.some(function (r) {
      return r.kind === 'as';
    });
    var body = d.rows
      .map(function (r) {
        var on = W.open === r.key;
        var names = namesOf(r);
        return (
          '<tr class="pjw-row' +
          (on ? ' od-row--on' : '') +
          '" data-pjw-row="' +
          esc(r.key) +
          '"><th scope="row">' +
          esc(r.label) +
          '</th><td' +
          (names ? '' : ' class="pw-muted"') +
          '>' +
          esc(names || '-') +
          '</td><td' +
          (r.at ? '' : ' class="pw-muted"') +
          '>' +
          esc(whenText(r.at) || '-') +
          '</td><td' +
          (stateOf(r) ? '' : ' class="pw-muted"') +
          '>' +
          esc(stateOf(r) || '-') +
          '</td><td class="pw-act">' +
          btn(
            on ? 'pw-fold' : 'pw-open',
            on ? TEXT.fold : r.assign ? TEXT.pick : TEXT.see,
            ' data-key="' + esc(r.key) + '" aria-expanded="' + on + '"',
            'link'
          ) +
          '</td></tr>'
        );
      })
      .join('');
    var soon = function (label, text) {
      return (
        '<tr class="pjw-row pjw-row--soon"><th scope="row">' +
        esc(label) +
        '</th><td colspan="4" class="pw-muted">' +
        esc(text) +
        '</td></tr>'
      );
    };
    return (
      '<div class="od-tablewrap"><table class="od-table pjw-table"><thead><tr><th scope="col">종류</th><th scope="col">작업자</th><th scope="col">날짜</th><th scope="col">상태</th><th scope="col" class="pw-act"><span class="pw-sr">하기</span></th></tr></thead><tbody>' +
      body +
      (hasInstall ? '' : soon(KIND.install, TEXT.installSoon)) +
      (hasAs ? '' : soon(KIND.as, TEXT.asSoon)) +
      '</tbody></table></div>'
    );
  }
  function workerHtml(w, manage, asking) {
    var acts = '';
    if (manage) {
      if (w.status === 'submitted')
        acts +=
          btn('pw-accept', TEXT.accept, ' data-id="' + esc(w.id) + '"', 'link') +
          btn('pw-revision', TEXT.revision, ' data-id="' + esc(w.id) + '"', 'link');
      if (w.live) acts += btn('pw-remove', TEXT.remove, ' data-id="' + esc(w.id) + '"', 'link');
    }
    var reports = w.reports.length
      ? '<ul class="sm-wk-reports">' +
        w.reports
          .map(function (u) {
            var head = [u.by === 'company' ? '팩토리' : '작업자', u.label, u.at]
              .filter(Boolean)
              .join(' · ');
            return '<li><span class="sm-wk-when">' + esc(head) + '</span>' + esc(u.body) + '</li>';
          })
          .join('') +
        '</ul>'
      : '';
    return (
      '<li class="sm-wk-item' +
      (asking ? ' sm-wk-item--on' : '') +
      '"><div class="sm-wk-row"><span class="sm-wk-name">' +
      esc(w.name || TEXT.noName) +
      '</span><span class="sm-wk-state">' +
      esc(w.label) +
      '</span><span class="sm-wk-acts">' +
      acts +
      '</span></div>' +
      (w.reason ? '<p class="mk-note">' + esc(TEXT.declined + ': ' + w.reason) + '</p>' : '') +
      reports +
      '</li>'
    );
  }
  function askHtml(w) {
    var revision = W.ask.kind === 'revision';
    return (
      '<div class="pw-ask" role="group" aria-label="확인" data-pjw="ask"><p><b>' +
      esc((w && w.name) || TEXT.noName) +
      '</b> — ' +
      esc(revision ? TEXT.revisionAsk : TEXT.removeAsk) +
      '</p><label class="mk-input"><span>' +
      esc(TEXT.reason) +
      '</span><input name="pw-reason" type="text" maxlength="' +
      REASON_MAX +
      '" autocomplete="off"' +
      dis() +
      ' /></label><div class="rd-acts">' +
      btn('pw-yes', revision ? TEXT.revision : TEXT.remove, '', true) +
      btn('pw-no', TEXT.cancel) +
      '</div></div>'
    );
  }
  function dateHtml(row) {
    if (row.schedule) return '<p class="mk-note">' + esc(TEXT.scheduleDate) + '</p>';
    var p = partsOf(row.at) || { day: '', time: '' };
    return (
      '<div class="pjw-date"><label class="mk-input"><span>' +
      esc(TEXT.date) +
      '</span><input name="pw-date" type="date" value="' +
      esc(p.day) +
      '"' +
      dis() +
      ' /></label><label class="mk-input"><span>' +
      esc(TEXT.time) +
      '</span><input name="pw-time" type="time" value="' +
      esc(p.time) +
      '"' +
      dis() +
      ' /></label><div class="rd-acts">' +
      btn('pw-date', TEXT.saveDate) +
      (row.at ? btn('pw-date-clear', TEXT.clearDate) : '') +
      '</div></div>'
    );
  }
  function choice(act, attr, value, label, on) {
    return (
      '<button type="button" class="mk-btn' +
      (on ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '" ' +
      attr +
      '="' +
      esc(value) +
      '" aria-pressed="' +
      on +
      '"' +
      dis() +
      '>' +
      esc(label) +
      '</button>'
    );
  }
  function madeHtml(row) {
    if (!W.made || W.made.key !== row.key) return '';
    return (
      '<div class="me-pt-box me-pt-made" data-pjw="made"><p class="me-pt-title">' +
      esc(TEXT.made) +
      '</p><input class="me-pt-url" name="pw-link" type="text" readonly aria-label="' +
      esc(TEXT.made) +
      '" value="' +
      esc(W.made.url) +
      '" /><p class="mk-note">' +
      esc(whenText(W.made.expires_at) + TEXT.madeNote) +
      '</p><div class="rd-acts">' +
      btn('pw-copy', TEXT.copy, '', true) +
      '</div><p class="me-pt-msg" data-pjw="copy" role="status">' +
      esc(W.copy) +
      '</p></div>'
    );
  }
  function detailHtml(d, row) {
    var asked = W.ask
      ? row.workers.filter(function (w) {
          return w.id === W.ask.id;
        })[0]
      : null;
    var list = row.workers.length
      ? '<ul class="sm-wk-list">' +
        row.workers
          .map(function (w) {
            return workerHtml(w, d.manage, !!asked && asked.id === w.id);
          })
          .join('') +
        '</ul>'
      : '<p class="me-empty">' + esc(TEXT.none) + '</p>';
    // 모집 칸 — 모집 중이거나 신청이 있으면 누구에게나(직원은 보기만), 아니면 올릴 수 있는 사람에게만
    var R = recruitKit();
    var recruitHtml =
      R && !asked
        ? R.blockHtml(row.recruit, {
            prefix: 'pw',
            manage: d.manage,
            assign: d.manage && row.assign,
            busy: W.busy,
            asking: !!W.ask && W.ask.kind === 'recruit-stop',
          })
        : '';
    var manageHtml = '';
    if (d.manage && row.assign && !asked) {
      manageHtml =
        dateHtml(row) +
        (row.candidates.length
          ? '<p class="cw-label">' +
            esc(TEXT.candidates) +
            '</p><div class="cs-choices">' +
            row.candidates
              .map(function (c) {
                return choice(
                  'pw-pick',
                  'data-id',
                  c.id,
                  (c.name || TEXT.noName) + (c.region ? ' · ' + c.region : ''),
                  W.picked.indexOf(c.id) >= 0
                );
              })
              .join('') +
            '</div><p class="mk-note">' +
            esc(TEXT.assignNote) +
            '</p><div class="rd-acts">' +
            '<button type="button" class="mk-btn mk-btn--solid" data-act="pw-assign"' +
            (W.busy || !W.picked.length ? ' disabled' : '') +
            '>' +
            esc(TEXT.assign) +
            '</button></div>'
          : '<p class="mk-note">' + esc(TEXT.noCandidates) + '</p>') +
        recruitHtml +
        '<div class="pjw-invite"><p class="cw-label">' +
        esc(TEXT.invite) +
        '</p><p class="mk-note">' +
        esc(TEXT.inviteHelp) +
        '</p><div class="cs-choices" role="group" aria-label="' +
        esc(TEXT.days) +
        '">' +
        DAYS.map(function (n) {
          return choice('pw-days', 'data-days', n, n + TEXT.daysUnit, W.days === n);
        }).join('') +
        '</div><div class="rd-acts">' +
        btn('pw-invite', TEXT.makeInvite) +
        '</div></div>' +
        madeHtml(row);
    } else manageHtml = recruitHtml;
    return (
      '<div class="sm-wk pjw-detail" data-pjw="detail"><h5 class="sm-wk-title">' +
      esc(row.label) +
      (row.at ? ' · ' + esc(whenText(row.at)) : '') +
      '</h5>' +
      list +
      (asked ? askHtml(asked) : '') +
      manageHtml +
      '</div>'
    );
  }
  function render() {
    var h = W.host;
    if (!h) return;
    var head = '<h4 class="od-h">' + esc(TEXT.title) + '</h4>';
    if (W.loading && !W.data) {
      h.innerHTML = head + '<p class="mk-note" role="status">' + esc(TEXT.loading) + '</p>';
      return;
    }
    if (!W.data) {
      h.innerHTML =
        head +
        '<p class="mk-error" role="alert" data-pjw="err">' +
        esc(W.loadErr || TEXT.failed) +
        '</p>';
      return;
    }
    var d = W.data;
    var row = d.rows.filter(function (r) {
      return r.key === W.open;
    })[0];
    // 같은 줄을 다시 그릴 때만 적던 사유 · 날짜를 되살린다 — 다른 줄로 옮기면 그 줄의 값이 보여야 한다
    var keep = {};
    if (row && h.getAttribute('data-pjw-open') === row.key)
      ['pw-reason', 'pw-date', 'pw-time', 'pw-people', 'pw-until-date', 'pw-until-time'].forEach(
        function (name) {
          var el = h.querySelector('[name="' + name + '"]');
          if (el) keep[name] = el.value;
        }
      );
    h.innerHTML =
      head +
      '<p class="mk-note">' +
      esc(d.manage ? TEXT.note : TEXT.noteRead) +
      ' ' +
      esc(TEXT.workerScreen) +
      ' <a class="od-pc" href="work.html">' +
      esc(TEXT.workerScreenLink) +
      ' →</a></p><p class="me-pt-msg" role="status" data-pjw="msg">' +
      esc(W.msg) +
      '</p><p class="mk-error" role="alert" data-pjw="err"' +
      (W.err ? '' : ' hidden') +
      '>' +
      esc(W.err) +
      '</p>' +
      tableHtml(d) +
      (row ? detailHtml(d, row) : '');
    h.setAttribute('aria-busy', W.busy ? 'true' : 'false');
    // 날짜를 저장 · 지운 바로 뒤에는 서버 값을 보인다 (적던 값을 되살리지 않는다)
    Object.keys(keep).forEach(function (name) {
      var el = h.querySelector('[name="' + name + '"]');
      if (el && keep[name] && (name === 'pw-reason' || !W.freshDate)) el.value = keep[name];
    });
    W.freshDate = false;
    h.setAttribute('data-pjw-open', row ? row.key : '');
  }
  function focusOn(sel) {
    var el = W.host && W.host.querySelector(sel);
    if (el && typeof el.focus === 'function') el.focus();
  }

  // ── 누른 일 ───────────────────────────────────────────
  function others() {
    // 설치 · A/S 표 · 업무 달력의 담당 글도 바뀐다
    var M = window.SeganSiteMap;
    if (M && typeof M.reload === 'function') M.reload();
    var C = window.SeganCalendar;
    if (C && typeof C.reload === 'function') C.reload();
  }
  /** 서버에 한 가지를 하고 표를 다시 읽는다 */
  async function run(method, path, body, done) {
    if (W.busy) return;
    var id = W.id;
    W.busy = true;
    W.msg = '';
    W.err = '';
    render();
    var r = await call(method, path, body);
    if (W.id !== id) return; // 그 사이 다른 프로젝트를 열었다
    if (r.ok) {
      W.ask = null;
      W.picked = [];
      if (typeof done === 'function') done(r);
      else W.msg = done || '';
    } else W.err = errText(r);
    await read();
    W.busy = false;
    W.freshDate = r.ok && method === 'PATCH';
    render();
    if (r.ok) others();
  }
  function rowNow() {
    return W.data
      ? W.data.rows.filter(function (r) {
          return r.key === W.open;
        })[0]
      : null;
  }
  async function copyLink() {
    var field = W.host && W.host.querySelector('[name="pw-link"]');
    var out = W.host && W.host.querySelector('[data-pjw="copy"]');
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(W.made ? W.made.url : '');
      W.copy = TEXT.copied;
    } catch {
      if (field && field.select) field.select();
      W.copy = TEXT.copyFail;
    }
    if (out) out.textContent = W.copy;
  }
  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || W.busy || !W.data) return;
    var act = el.getAttribute('data-act') || '';
    if (act.indexOf('pw-') !== 0) return;
    var id = el.getAttribute('data-id') || '';
    var row = rowNow();
    if (act === 'pw-open' || act === 'pw-fold') {
      W.open = act === 'pw-open' ? el.getAttribute('data-key') || '' : '';
      W.picked = [];
      W.ask = null;
      W.days = 0;
      W.msg = '';
      W.err = '';
      render();
      focusOn('[data-pjw-row="' + (el.getAttribute('data-key') || '') + '"] [data-act]');
      return;
    }
    if (act === 'pw-copy') return void copyLink();
    if (!row || !W.data.manage) return;
    if (act === 'pw-pick') {
      var at = W.picked.indexOf(id);
      if (at >= 0) W.picked.splice(at, 1);
      else if (id) W.picked.push(id);
      render();
      focusOn('[data-act="pw-pick"][data-id="' + id + '"]');
    } else if (act === 'pw-assign') {
      if (!W.picked.length) return;
      if (row.schedule) {
        run(
          'POST',
          '/company/schedules/' + encodeURIComponent(row.schedule) + '/workers',
          { link_ids: W.picked.slice() },
          TEXT.assigned
        );
        return;
      }
      var send = { kind: row.kind, link_ids: W.picked.slice() };
      // 날짜를 적어 두었으면 같이 보낸다 (날만 적고 시각이 비면 묻는다)
      var dayEl = W.host.querySelector('[name="pw-date"]');
      var timeEl = W.host.querySelector('[name="pw-time"]');
      if (dayEl && dayEl.value) {
        var when = atOf(dayEl.value, timeEl ? timeEl.value : '');
        if (when.error) {
          W.err = when.message;
          W.msg = '';
          render();
          focusOn('[name="pw-' + when.error + '"]');
          return;
        }
        send.at = when.at;
      }
      run('POST', workPath(), send, TEXT.assigned);
    } else if (act === 'pw-date' || act === 'pw-date-clear') {
      var body = { at: null };
      if (act === 'pw-date') {
        var day = W.host.querySelector('[name="pw-date"]');
        var time = W.host.querySelector('[name="pw-time"]');
        var res = atOf(day ? day.value : '', time ? time.value : '');
        if (res.error) {
          W.err = res.message;
          W.msg = '';
          render();
          focusOn('[name="pw-' + res.error + '"]');
          return;
        }
        body.at = res.at;
      }
      run(
        'PATCH',
        workPath() + '/' + encodeURIComponent(row.kind),
        body,
        act === 'pw-date' ? TEXT.dateSaved : TEXT.dateCleared
      );
    } else if (act === 'pw-accept') {
      run(
        'POST',
        '/company/work/assignments/' + encodeURIComponent(id) + '/accept',
        {},
        TEXT.accepted
      );
    } else if (act === 'pw-revision' || act === 'pw-remove') {
      W.ask = { kind: act === 'pw-revision' ? 'revision' : 'remove', id: id };
      W.err = '';
      W.msg = '';
      render();
      focusOn('[name="pw-reason"]');
    } else if (act === 'pw-no') {
      W.ask = null;
      W.err = '';
      render();
    } else if (act === 'pw-yes' && W.ask) {
      var field = W.host.querySelector('[name="pw-reason"]');
      var reason = field ? field.value.trim() : '';
      if (!reason) {
        W.err = TEXT.needReason;
        render();
        focusOn('[name="pw-reason"]');
        return;
      }
      run(
        'POST',
        '/company/work/assignments/' + encodeURIComponent(W.ask.id) + '/' + W.ask.kind,
        { reason: reason },
        W.ask.kind === 'revision' ? TEXT.revised : TEXT.removed
      );
    } else if (act === 'pw-recruit') {
      var R = recruitKit();
      var f = R ? R.readForm(W.host, 'pw') : null;
      if (!f) return;
      if (f.error) {
        W.err = f.message;
        W.msg = '';
        render();
        focusOn('[name="pw-' + f.error + '"]');
        return;
      }
      if (row.schedule) {
        run(
          'POST',
          '/company/schedules/' + encodeURIComponent(row.schedule) + '/workers/recruit',
          f.body,
          R.TEXT.opened
        );
        return;
      }
      f.body.kind = row.kind;
      // 날짜를 적어 두었으면 같이 보낸다 (날만 적고 시각이 비면 묻는다)
      var rDay = W.host.querySelector('[name="pw-date"]');
      var rTime = W.host.querySelector('[name="pw-time"]');
      if (rDay && rDay.value) {
        var rWhen = atOf(rDay.value, rTime ? rTime.value : '');
        if (rWhen.error) {
          W.err = rWhen.message;
          W.msg = '';
          render();
          focusOn('[name="pw-' + rWhen.error + '"]');
          return;
        }
        f.body.at = rWhen.at;
      }
      run('POST', workPath() + '/recruit', f.body, R.TEXT.opened);
    } else if (act === 'pw-recruit-stop') {
      W.ask = { kind: 'recruit-stop', id: '' };
      W.err = '';
      W.msg = '';
      render();
      focusOn('[data-act="pw-recruit-stop-yes"]');
    } else if (act === 'pw-recruit-stop-no') {
      W.ask = null;
      render();
      focusOn('[data-act="pw-recruit-stop"]');
    } else if (act === 'pw-recruit-stop-yes') {
      var stopped = recruitKit() ? recruitKit().TEXT.stopped : '';
      if (row.schedule)
        run(
          'POST',
          '/company/schedules/' + encodeURIComponent(row.schedule) + '/workers/recruit',
          { stop: true },
          stopped
        );
      else run('POST', workPath() + '/recruit', { kind: row.kind, stop: true }, stopped);
    } else if ((act === 'pw-app-approve' || act === 'pw-app-reject') && ID_RE.test(id)) {
      var RT = recruitKit() ? recruitKit().TEXT : {};
      run(
        'POST',
        '/company/work/applications/' +
          encodeURIComponent(id) +
          (act === 'pw-app-approve' ? '/approve' : '/reject'),
        {},
        act === 'pw-app-approve' ? RT.picked : RT.rejected
      );
    } else if (act === 'pw-days') {
      var n = Number(el.getAttribute('data-days'));
      W.days = DAYS.indexOf(n) >= 0 ? n : 0;
      W.err = '';
      render();
      focusOn('[data-act="pw-days"][data-days="' + n + '"]');
    } else if (act === 'pw-invite') {
      if (DAYS.indexOf(W.days) < 0) {
        W.err = TEXT.pickDays;
        W.msg = '';
        render();
        focusOn('[data-act="pw-days"]');
        return;
      }
      var key = row.key;
      var invite = { kind: row.kind, expires_at: expiresIn(W.days) };
      if (row.schedule) invite.schedule_id = row.schedule;
      run('POST', workPath() + '/invite', invite, function (r) {
        var d = obj(r.body.data);
        W.made = str(d.url)
          ? { key: key, url: d.url, expires_at: str(d.expires_at) || invite.expires_at }
          : null;
        W.copy = '';
        W.days = 0;
        W.msg = TEXT.madeMsg;
      });
    }
  }

  /**
   * 프로젝트 줄 안의 자리(host)에 칸을 올린다. 같은 프로젝트면 읽어 둔 것을 그대로 다시 그린다
   * (segan/partner-projects.js 가 목록을 다시 그릴 때마다 부른다).
   */
  async function mount(host, opts) {
    var o = opts || {};
    var id = str(o.id);
    if (!host || !ID_RE.test(id)) return;
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    W.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    W.sb = o.sb || W.sb;
    W.session = o.session || W.session;
    W.host = host;
    if (host.getAttribute('data-bound') !== '1') {
      host.setAttribute('data-bound', '1');
      host.addEventListener('click', onClick);
    }
    if (W.id === id && (W.data || W.loading || W.loadErr)) {
      render();
      return;
    }
    W.id = id;
    W.data = null;
    W.loadErr = '';
    W.open = '';
    W.picked = [];
    W.ask = null;
    W.days = 0;
    W.made = null;
    W.copy = '';
    W.msg = '';
    W.err = '';
    W.busy = false;
    W.loading = true;
    render();
    await read();
    if (W.id !== id) return;
    W.loading = false;
    render();
  }
  /** 칸을 닫는다 — 읽어 둔 것 · 초대 링크를 버린다 */
  function unmount() {
    W.id = '';
    W.host = null;
    W.data = null;
    W.made = null;
    W.loading = false;
    W.loadErr = '';
  }

  window.SeganProjectWork = {
    KIND: KIND,
    STATE: STATE,
    PROJECT_KINDS: PROJECT_KINDS,
    DAYS: DAYS,
    TEXT: TEXT,
    canSee: canSee,
    partsOf: partsOf,
    whenText: whenText,
    atOf: atOf,
    expiresIn: expiresIn,
    dataOf: dataOf,
    namesOf: namesOf,
    stateOf: stateOf,
    state: W,
    mount: mount,
    unmount: unmount,
  };
})();
