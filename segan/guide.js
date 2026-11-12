/* ============================================================
   segan/guide.js — SEGAN 비서 (앱 모든 화면 · 안내 모드)

   어디서     셸 화면 전부 (segan/*.html 이 shell.js 뒤에 싣는다). 싣지 않는 곳: offline.html(오프라인 화면) ·
              pay.html(결제창이 돌아오는 곳) · join.html(직원 초대 받기) · ledger-board.html(옛 주소 — 바로 넘긴다).
   여는 곳    폰 · 태블릿(~1023px) — 위 막대 오른쪽 「비서」 버튼 → 아래 시트 (SeganShell.sheet kind 'sheet', 90dvh)
              PC(1024px~, 글 위 메뉴가 보이는 폭) — 본문 아래 가운데 고정 입력 줄 「SEGAN 비서에게 물어보기」
                → 오른쪽 옆 패널 420px (kind 'panel'). 줄에 적고 보내면 패널을 열고 그 글을 바로 묻는다.
              어느 것을 보일지는 shell.css 가 폭으로 정한다 (둘 다 그려 두고 한쪽을 감춘다).
              PC 입력 줄은 화면 아래에 붙는 버튼 줄과 겹치는 동안 감춘다 — 만들기 · 상담 신청의 .mk-bar ·
              업무 비서 화면의 .as-form (shell.css body:has()). 옆 패널은 한 번에 하나 · 뒤로 가기가 닫는다 (셸 도우미).
              주소(# 포함)는 건드리지 않는다.
   누가       로그인한 누구나 — 안내 모드 (assistant-api, 워커 주소 SeganShell.assistantBase())
                GET  /assistant/guide → { on, used, limit, remaining, day, reset_at } — 「오늘 n번 남음」
                POST /assistant/guide/turns { text, history } → NDJSON
                     start { used, limit, remaining, reset_at } · text { text } … · 끝 하나 done · refused · error { message, given_back }
                     보내기 전 오류: 401 · 422 invalid · 429 rate_limited(분 한도) · 429 guide_limit(하루 한도, data { used, limit, reset_at }) ·
                     403 guide_off
              업무 비서(Agent 업체 — GET /assistant/me level full · read, SeganShell.hasAssistant)는 패널 위에
              「업무 비서 열기」 링크만 둔다 — 업무 대화는 그 화면(assistant.html) 그대로.
              로그인 전 — AI 를 부르지 않는다. 자주 묻는 것(FAQ — 정해 둔 답) + 「로그인하면 무엇이든 물어볼 수 있습니다」
              로그인 링크 (돌아올 곳 = 지금 화면 segan/<파일>.html — js/auth-redirect.js 가 받는 모양).
   대화 기록  서버에 두지 않는다 — 이 탭(sessionStorage STORE)에 사람 id 와 함께 두고, 보낼 때마다 지난 차례를
              history 로 보낸다 (끝까지 받은 질문 · 답 짝만, 마지막 HISTORY_MAX 줄). 화면을 옮겨도 이어진다.
              다른 사람으로 로그인하면 지운다. 로그아웃은 셸이 지운다 (shell.js — segan.guide. 로 시작하는 칸).
   보이기     모든 글은 textContent 로만 넣는다 (HTML 로 읽지 않는다). 비서 답 안의 앱 주소(LINK_PATHS — 정확히 그 글자)만
              <a href> 로 바꾼다 — 다른 주소 · 바깥 주소는 글 그대로.
              글이 들어오는 동안 대화 목록은 aria-busy — 다 받은 뒤 읽어 준다 (aria-live polite).
   FAQ · 가격 · 크레딧 글은 2026-11-08 대표님 결정 — 워커 안내 모드 시스템 글(workers/assistant-api/src/guide-prompt.js)과
   구독 화면(plans.html)에 적힌 것만 옮겼다. 그쪽이 바뀌면 여기도 고친다.
   ============================================================ */
/* global window, document, fetch, location, sessionStorage, TextDecoder */
(function () {
  'use strict';

  var STATUS_PATH = '/assistant/guide';
  var TURNS_PATH = '/assistant/guide/turns';
  var STORE = 'segan.guide.chat'; // sessionStorage — { uid, msgs } (shell.js 로그아웃이 segan.guide. 칸을 지운다)
  var STORE_MAX = 40; // 이 탭에 두는 말풍선 수
  var TEXT_MAX = 1000; // 워커 GUIDE_TEXT_MAX
  var HISTORY_MAX = 6; // 워커 GUIDE_HISTORY_MAX — 서버가 쓰는 지난 줄 수
  var HISTORY_TEXT_MAX = 2000; // 워커 GUIDE_HISTORY_TEXT_MAX
  var WIDE = '(min-width: 1024px)'; // shell.css — 글 위 메뉴가 보이는 폭
  var BIZ_PAGE = 'assistant.html';
  var LOGIN_PAGE = '../login.html';

  /** 답 안에서 링크로 바꾸는 앱 주소 — 정확히 이 글자만 (워커 guide-prompt.js GUIDE_PAGES 의 주소) */
  var LINK_PATHS = [
    './',
    'collection.html',
    'blog.html',
    'about.html',
    'plans.html',
    'me.html',
    'renders.html',
    'consult.html',
    'billing.html',
    'settings.html',
  ];
  // 앞 · 뒤가 주소 글자(영숫자 _ . / -)가 아닐 때만 — 「../login.html」 · 「https://x/plans.html」 · 「home.html」 은 안 바꾼다
  var LINK_RE =
    /(^|[^A-Za-z0-9_./-])(\.\/|(?:collection|blog|about|plans|me|renders|consult|billing|settings)\.html)(?![A-Za-z0-9_/-])/g;

  var TXT = {
    title: 'SEGAN 비서',
    button: '비서',
    bar: 'SEGAN 비서에게 물어보기',
    barSend: '묻기',
    checking: '확인하는 중…',
    hello:
      'SEGAN 앱 쓰는 법을 물어보세요. 화면이 어디 있는지, 크레딧 · 구독 · 상담 신청 같은 것을 알려 드립니다.',
    label: '물어볼 글',
    placeholder: '앱 쓰는 법을 물어보세요',
    send: '보내기',
    fresh: '새 대화',
    biz: '업무 비서 열기',
    aiTag: 'AI가 만든 내용',
    mine: '내 질문',
    warn: 'AI가 만든 내용은 틀릴 수 있습니다.',
    wait: '답을 만드는 중…',
    paused: '안내 모드 쉬는 중',
    off: '지금은 안내 모드를 쉬고 있습니다. 잠시 뒤 다시 시도해 주세요.',
    empty: '물어볼 글을 적어 주세요.',
    tooLong: '질문은 ' + TEXT_MAX + '자까지 보냅니다.',
    offline: '연결이 끊겨 보내지 못했습니다. 다시 보내 주세요.',
    fail: '답을 만들지 못했습니다. 잠시 뒤 다시 물어봐 주세요.',
    rate: '요청이 너무 잦습니다. 잠시 뒤 다시 보내 주세요.',
    cut: '답을 끝까지 받지 못했습니다. 다시 물어봐 주세요.',
    moved: '답을 받기 전에 화면을 옮겼습니다. 다시 물어봐 주세요.',
    refused: '이 내용에는 답할 수 없습니다.',
    givenBack: '오늘 질문 수에서 빼지 않았습니다.',
    relogin: '로그인이 풀렸습니다. 다시 로그인해 주세요.',
    faqLead: '자주 묻는 것',
    loginNote: '로그인하면 무엇이든 물어볼 수 있습니다',
    login: '로그인',
  };

  /** 로그인 전 자주 묻는 것 — 정해 둔 답 (AI 아님). 앱 주소는 linkify 가 링크로 바꾼다 */
  var FAQ = [
    {
      q: '연출컷이 뭔가요',
      a:
        '현장 사진으로 가구가 들어간 모습을 미리 보는 사진입니다. AI 연출컷(./)에서 차례대로 만듭니다.\n' +
        '1. 현장 사진을 올립니다\n' +
        '2. 품목을 고릅니다\n' +
        '3. 참고 사진을 올립니다 (최대 5장, 고르지 않아도 됩니다)\n' +
        '4. 생성합니다\n' +
        '5. 견적서를 봅니다\n' +
        '6. 상담을 신청합니다',
    },
    {
      q: '크레딧은 어떻게 쓰나요',
      a:
        '연출컷을 한 번 생성할 때 20 크레딧이 듭니다. 남은 크레딧은 마이페이지(me.html)에서 봅니다.\n' +
        '크레딧은 매월 새로 지급되며 이월되지 않습니다. 생성이 실패하면 차감분은 돌려드립니다.\n' +
        '팩토리 구성원은 팩토리의 크레딧을 함께 씁니다.',
    },
    {
      q: '상담은 어떻게 신청하나요',
      a:
        '상담 신청(consult.html)에서 신청합니다. 다담 본사가 받아 가까운 팩토리로 배분합니다.\n' +
        '연출컷을 만든 뒤 이어서 신청할 수도 있습니다. 신청한 상담은 마이페이지(me.html)의 상담 내역에서 봅니다.',
    },
    {
      q: '구독 등급과 가격',
      a:
        '· Standard — 무료\n' +
        '· Manager — 월 99,000원\n' +
        '· Expert — 월 199,000원\n' +
        '· Agent — 월 299,000원\n' +
        '표시 금액은 VAT 포함입니다. 위 등급은 아래 등급의 서비스를 모두 포함합니다. ' +
        'Manager · Expert · Agent 는 팩토리(업체) 구독입니다. 등급마다 쓰는 도구는 구독(plans.html)에서 봅니다.',
    },
    {
      q: '플래너는 어디서 쓰나요',
      a:
        '플래너는 Manager 등급부터 쓰는 팩토리 도구입니다. 로그인한 뒤 마이페이지(me.html) › 업체 › 설계에서 엽니다.\n' +
        '등급은 구독(plans.html)에서 봅니다.',
    },
  ];

  var G = {
    sb: null, // Supabase 클라이언트 (셸 것이 있으면 그것)
    uid: '', // 대화 기록의 주인 — 다른 사람이면 지운다
    msgs: [], // { role: 'user'|'assistant', text, state: 'ok'|'pending'|'streaming'|'fail', note? }
    status: null, // GET /assistant/guide data (못 읽으면 null — 서버가 막는다)
    statusSeq: 0, // 차례의 start 가 남은 수를 고칠 때마다 늘린다
    biz: null, // 업무 비서를 여나 (null = 아직 모름)
    sending: false,
    live: null, // 지금 받는 비서 말풍선 (msgs 안의 것)
    h: null, // 열린 시트 손잡이
    v: null, // 열린 시트의 칸들 (닫으면 null — 답은 그대로 받아 msgs 에 둔다)
    gen: 0, // 시트를 열 때마다 늘린다 — 늦게 온 응답이 새 시트를 그리지 않게
  };

  function shell() {
    return window.SeganShell || null;
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /** PC 폭인가 — 옆 패널 · 입력 줄. 모르면(matchMedia 없음) 폰 */
  function wide() {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches === true;
    } catch {
      return false;
    }
  }

  /** 지금 화면 파일 이름 (segan/ 안) — 주소가 /segan/ 이면 index.html */
  function pageFile() {
    var last = String(location.pathname || '')
      .split('/')
      .pop();
    return /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.html$/.test(last) ? last : 'index.html';
  }

  /** 로그인 뒤 지금 화면으로 돌아오는 로그인 주소 — 같은 사이트 *.html (# · 쿼리 없이) */
  function loginHref() {
    return LOGIN_PAGE + '?redirect=' + encodeURIComponent('segan/' + pageFile());
  }

  /** ISO → 한국 시간 「11월 9일 0시」 (못 읽으면 빈 글) */
  function resetText(iso) {
    var t = Date.parse(String(iso == null ? '' : iso));
    if (!isFinite(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    return k.getUTCMonth() + 1 + '월 ' + k.getUTCDate() + '일 ' + k.getUTCHours() + '시';
  }

  function limitText(limit, resetAt) {
    var when = resetText(resetAt) || '내일 0시';
    return (
      '오늘 질문 ' +
      num(limit) +
      '개를 모두 썼습니다. ' +
      when +
      '(한국 시간)부터 다시 물을 수 있습니다.'
    );
  }

  /** 글 → el 안에 글 마디 + 앱 주소 링크 (HTML 로 읽지 않는다) */
  function linkify(el, text) {
    var s = String(text == null ? '' : text);
    var last = 0;
    var m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(s))) {
      var at = m.index + m[1].length;
      if (at > last) el.appendChild(document.createTextNode(s.slice(last, at)));
      var a = document.createElement('a');
      a.className = 'sg-ai-link';
      a.setAttribute('href', m[2]);
      a.textContent = m[2];
      el.appendChild(a);
      last = at + m[2].length;
    }
    if (last < s.length) el.appendChild(document.createTextNode(s.slice(last)));
    return el;
  }

  // ── 대화 기록 (이 탭) ──────────────────────────────────
  /** 보낼 지난 차례 — 끝까지 받은 질문 · 답 짝만, 마지막 HISTORY_MAX 줄 (첫 줄은 늘 사람) */
  function historyFor(msgs) {
    var out = [];
    for (var i = 0; i + 1 < msgs.length; i++) {
      var u = msgs[i];
      var a = msgs[i + 1];
      if (u.role === 'user' && u.state === 'ok' && a.role === 'assistant' && a.state === 'ok') {
        out.push({ role: 'user', text: String(u.text).slice(0, HISTORY_TEXT_MAX) });
        out.push({ role: 'assistant', text: String(a.text).slice(0, HISTORY_TEXT_MAX) });
        i++;
      }
    }
    return out.slice(-HISTORY_MAX);
  }

  function save() {
    if (!G.uid) return;
    try {
      var msgs = G.msgs.slice(-STORE_MAX).map(function (m) {
        var o = { role: m.role, text: m.text, state: m.state };
        if (m.note) o.note = m.note;
        return o;
      });
      sessionStorage.setItem(STORE, JSON.stringify({ uid: G.uid, msgs: msgs }));
    } catch {
      /* 못 두면 이 화면에서만 이어진다 */
    }
  }

  /** 이 탭에 둔 대화 — 그 사람 것만. 받는 중에 화면을 옮긴 차례는 실패로 둔다 */
  function restore(uid) {
    var st = null;
    try {
      st = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    } catch {
      st = null;
    }
    if (!st || st.uid !== uid || !Array.isArray(st.msgs)) {
      try {
        sessionStorage.removeItem(STORE);
      } catch {
        /* noop */
      }
      return [];
    }
    return st.msgs
      .filter(function (m) {
        return (
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.text === 'string' &&
          ['ok', 'pending', 'streaming', 'fail'].indexOf(m.state) >= 0
        );
      })
      .slice(-STORE_MAX)
      .map(function (m) {
        var o = { role: m.role, text: m.text, state: m.state };
        if (typeof m.note === 'string' && m.note) o.note = m.note;
        if (o.state === 'pending' || o.state === 'streaming') {
          o.state = 'fail';
          o.note = TXT.moved;
        }
        return o;
      });
  }

  function keepRecent() {
    if (G.msgs.length > STORE_MAX) G.msgs.splice(0, G.msgs.length - STORE_MAX);
  }

  // ── 로그인 · 서버 ──────────────────────────────────────
  function client() {
    if (G.sb) return G.sb;
    var S = shell();
    try {
      if (S && typeof S.client === 'function') G.sb = S.client();
    } catch {
      G.sb = null;
    }
    if (G.sb) return G.sb;
    try {
      var cfg = window.DADAM_CONFIG;
      if (cfg && cfg.supabase && window.supabase && window.supabase.createClient) {
        G.sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey);
      }
    } catch {
      G.sb = null;
    }
    return G.sb;
  }

  async function sessionNow() {
    var sb = client();
    if (!sb) return null;
    try {
      var r = await sb.auth.getSession();
      return (r && r.data && r.data.session) || null;
    } catch {
      return null;
    }
  }

  async function token() {
    var s = await sessionNow();
    return (s && s.access_token) || '';
  }

  function base() {
    var S = shell();
    return S && typeof S.assistantBase === 'function'
      ? S.assistantBase()
      : 'https://dadam-assistant-api.dadamfurniture.workers.dev';
  }

  /** 로그인했나 — 했으면 그 사람의 대화를 꺼낸다 */
  async function prepare() {
    var s = await sessionNow();
    if (!s || !s.access_token) return null;
    var uid = (s.user && s.user.id) || '';
    if (uid !== G.uid) {
      G.uid = uid;
      G.msgs = restore(uid);
      G.status = null;
      G.biz = null;
    }
    return s;
  }

  /** 오늘 질문 수 — 못 읽으면 null (보내기는 막지 않는다 — 서버가 센다) */
  async function loadStatus() {
    try {
      var tok = await token();
      if (!tok) return null;
      var res = await fetch(base() + STATUS_PATH, {
        headers: { Authorization: 'Bearer ' + tok },
        cache: 'no-store',
      });
      if (!res.ok) return null;
      var b = await res.json();
      if (!b || b.success !== true || !b.data) return null;
      var d = b.data;
      return {
        on: d.on === true,
        used: num(d.used),
        limit: num(d.limit),
        remaining: num(d.remaining),
        day: d.day || null,
        reset_at: d.reset_at || null,
      };
    } catch {
      return null;
    }
  }

  /** 업무 비서(Agent 업체)를 여나 — 셸의 판정 그대로 (GET /assistant/me level full · read). 이 화면에서 한 번만 */
  async function loadBiz(session) {
    if (G.biz !== null) return G.biz;
    var S = shell();
    var on = false;
    try {
      on = !!(S && typeof S.hasAssistant === 'function' && (await S.hasAssistant(session)));
    } catch {
      on = false;
    }
    G.biz = on;
    return on;
  }

  /** NDJSON 응답을 끝까지 읽는다 — 한 줄씩 onEvent. 한 줄이 조각으로 나뉘어 와도 잇는다 */
  async function readLines(res, onEvent) {
    var buf = '';
    var take = function (line) {
      if (!line.trim()) return;
      var ev = null;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev && typeof ev === 'object') onEvent(ev);
    };
    try {
      var reader =
        res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
      if (!reader) {
        buf = String(await res.text());
      } else {
        var dec = typeof TextDecoder === 'function' ? new TextDecoder() : null;
        for (;;) {
          var step = await reader.read();
          if (step.done) break;
          var c = step.value;
          buf += typeof c === 'string' ? c : dec ? dec.decode(c, { stream: true }) : '';
          var parts = buf.split('\n');
          buf = parts.pop();
          parts.forEach(take);
        }
        if (dec) buf += dec.decode();
      }
    } catch {
      /* 끊김 — 받은 것까지만 */
    }
    buf.split('\n').forEach(take);
  }

  // ── 그리기 ─────────────────────────────────────────────
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function blocked() {
    var st = G.status;
    return !!st && (!st.on || st.remaining <= 0);
  }

  /** 말풍선이 바뀌었나 — 바뀐 것만 다시 그린다 (읽어 주는 칸이 지난 말을 되풀이하지 않게) */
  function sigOf(m) {
    return m.state + '|' + m.text.length + '|' + (m.note || '');
  }

  function paintMsg(li, m) {
    var ai = m.role === 'assistant';
    li.className = 'sg-ai-msg sg-ai-msg--' + (ai ? 'ai' : 'user');
    li.textContent = '';
    li.appendChild(ai ? el('span', 'sg-ai-tag', TXT.aiTag) : el('span', 'sg-ai-sr', TXT.mine));
    var p = el('p', 'sg-ai-text');
    if (!ai) p.textContent = m.text;
    else if (m.text) linkify(p, m.text);
    else if (m.state === 'streaming') {
      p.textContent = TXT.wait;
      li.classList.add('sg-ai-msg--wait');
    }
    if (p.childNodes.length) li.appendChild(p);
    if (m.note) li.appendChild(el('p', 'sg-ai-note', m.note));
    return li;
  }

  function toEnd() {
    var box = G.v && G.v.scroll;
    if (box) box.scrollTop = box.scrollHeight;
  }

  /** 대화 목록 — 앞부분이 같으면 바뀐 말풍선만 고치고 새 것만 붙인다 (거두기 · 새 대화 · 오래된 것 덜기는 새로 그린다) */
  function paintLog() {
    var v = G.v;
    if (!v || !v.log) return;
    var items = v.items || [];
    var same =
      items.length <= G.msgs.length &&
      items.every(function (it, i) {
        return it.m === G.msgs[i];
      });
    if (!same) {
      v.log.textContent = '';
      items = [];
    }
    items.forEach(function (it) {
      var sig = sigOf(it.m);
      if (sig !== it.sig) {
        paintMsg(it.li, it.m);
        it.sig = sig;
      }
    });
    for (var i = items.length; i < G.msgs.length; i++) {
      var m = G.msgs[i];
      var li = paintMsg(document.createElement('li'), m);
      v.log.appendChild(li);
      items.push({ m: m, li: li, sig: sigOf(m) });
    }
    v.items = items;
    v.liveLi = null;
    items.forEach(function (it) {
      if (it.m === G.live) v.liveLi = it.li;
    });
    v.log.setAttribute('aria-busy', G.live ? 'true' : 'false');
    v.hello.hidden = G.msgs.length > 0;
    v.fresh.hidden = G.msgs.length === 0;
    toEnd();
  }

  function paintLive() {
    var v = G.v;
    if (v && v.liveLi && G.live) {
      paintMsg(v.liveLi, G.live);
      (v.items || []).forEach(function (it) {
        if (it.m === G.live) it.sig = sigOf(G.live);
      });
      toEnd();
    }
  }

  function paintStatus() {
    var v = G.v;
    if (!v || !v.count) return;
    var st = G.status;
    v.count.textContent = !st ? '' : !st.on ? TXT.paused : '오늘 ' + st.remaining + '번 남음';
    v.count.hidden = !st;
    var why = !st
      ? ''
      : !st.on
        ? TXT.off
        : st.remaining <= 0
          ? limitText(st.limit, st.reset_at)
          : '';
    v.block.textContent = why;
    v.block.hidden = !why;
    syncForm();
  }

  function paintBiz() {
    var v = G.v;
    if (v && v.biz) v.biz.hidden = !(G.biz === true && pageFile() !== BIZ_PAGE);
  }

  function syncForm() {
    var v = G.v;
    if (!v || !v.sendBtn) return;
    v.sendBtn.disabled = G.sending || blocked();
    v.fresh.disabled = G.sending;
  }

  /** 입력 칸 아래 한 줄 (보내기 전에 막힌 이유) — withLogin 이면 로그인 링크도 */
  function setEnd(msg, withLogin) {
    var v = G.v;
    if (!v || !v.end) return;
    v.end.textContent = msg || '';
    if (msg && withLogin) {
      v.end.appendChild(document.createTextNode(' '));
      var a = el('a', 'sg-ai-link', TXT.login);
      a.setAttribute('href', loginHref());
      v.end.appendChild(a);
    }
    v.end.hidden = !msg;
  }

  function focusText() {
    var v = G.v;
    if (!v || !v.text || !G.h) return;
    var active = document.activeElement;
    if (active && active !== G.h.el && !G.h.el.contains(active)) return;
    try {
      v.text.focus();
    } catch {
      /* noop */
    }
  }

  function viewChecking(root) {
    root.textContent = '';
    root.appendChild(el('p', 'sg-ai-checking', TXT.checking));
  }

  /** 로그인 전 — 자주 묻는 것 + 로그인 */
  function viewFaq(root) {
    root.textContent = '';
    root.className = 'sg-ai sg-ai--faq';
    var scroll = el('div', 'sg-ai-scroll');
    scroll.appendChild(el('p', 'sg-ai-lead', TXT.faqLead));
    var list = el('div', 'sg-ai-faq');
    FAQ.forEach(function (f) {
      var d = el('details', 'sg-ai-q');
      d.appendChild(el('summary', '', f.q));
      d.appendChild(linkify(el('p', 'sg-ai-a'), f.a));
      list.appendChild(d);
    });
    scroll.appendChild(list);
    var box = el('div', 'sg-ai-login');
    box.appendChild(el('p', 'sg-ai-login-note', TXT.loginNote));
    var a = el('a', 'sg-btn sg-ai-login-btn', TXT.login);
    a.setAttribute('href', loginHref());
    box.appendChild(a);
    scroll.appendChild(box);
    root.appendChild(scroll);
    G.v = { root: root, scroll: scroll };
  }

  /** 로그인 뒤 — 안내 대화 */
  function viewChat(root) {
    root.textContent = '';
    root.className = 'sg-ai sg-ai--chat';
    var top = el('div', 'sg-ai-top');
    var count = el('p', 'sg-ai-count');
    count.setAttribute('role', 'status');
    count.hidden = true;
    var acts = el('div', 'sg-ai-acts');
    var biz = el('a', 'sg-ai-biz', TXT.biz);
    biz.setAttribute('href', BIZ_PAGE);
    biz.hidden = true;
    var fresh = el('button', 'sg-ai-fresh', TXT.fresh);
    fresh.type = 'button';
    fresh.hidden = true;
    acts.appendChild(biz);
    acts.appendChild(fresh);
    top.appendChild(count);
    top.appendChild(acts);

    var scroll = el('div', 'sg-ai-scroll');
    var hello = el('p', 'sg-ai-hello', TXT.hello);
    var log = el('ol', 'sg-ai-log');
    log.setAttribute('aria-label', '대화');
    log.setAttribute('aria-live', 'polite');
    scroll.appendChild(hello);
    scroll.appendChild(log);

    var foot = el('div', 'sg-ai-foot');
    var block = el('p', 'sg-ai-block');
    block.setAttribute('role', 'status');
    block.hidden = true;
    var end = el('p', 'sg-ai-end');
    end.setAttribute('role', 'alert');
    end.hidden = true;
    var form = el('form', 'sg-ai-form');
    form.noValidate = true;
    var field = el('label', 'sg-ai-field');
    field.appendChild(el('span', 'sg-ai-sr', TXT.label));
    var text = el('textarea', 'sg-ai-input');
    text.setAttribute('maxlength', String(TEXT_MAX));
    text.setAttribute('rows', '2');
    text.setAttribute('placeholder', TXT.placeholder);
    field.appendChild(text);
    var sendBtn = el('button', 'sg-ai-send', TXT.send);
    sendBtn.type = 'submit';
    form.appendChild(field);
    form.appendChild(sendBtn);
    foot.appendChild(block);
    foot.appendChild(end);
    foot.appendChild(form);
    foot.appendChild(el('p', 'sg-ai-warn', TXT.warn));

    root.appendChild(top);
    root.appendChild(scroll);
    root.appendChild(foot);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      send(text.value);
    });
    // PC — Enter 로 보내고 Shift+Enter 는 줄 바꿈. 한글 조합 중 Enter 는 조합만 끝낸다. 폰은 Enter 가 줄 바꿈
    text.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229 || !wide()) return;
      e.preventDefault();
      send(text.value);
    });
    fresh.addEventListener('click', function () {
      if (G.sending) return;
      G.msgs = [];
      save();
      setEnd('');
      paintLog();
      focusText();
    });

    G.v = {
      root: root,
      scroll: scroll,
      hello: hello,
      log: log,
      count: count,
      biz: biz,
      fresh: fresh,
      block: block,
      end: end,
      text: text,
      sendBtn: sendBtn,
      liveLi: null,
    };
    paintLog();
    paintStatus();
    paintBiz();
  }

  // ── 묻기 ───────────────────────────────────────────────
  /** 보내기 전에 막혔다 — 보낸 말풍선을 거두고 글을 입력 칸에 되돌린다 */
  function undo(u, text, msg, withLogin) {
    var i = G.msgs.indexOf(u);
    if (i >= 0) G.msgs.splice(i, 1);
    G.sending = false;
    save();
    paintLog();
    paintStatus();
    if (G.v && G.v.text && !G.v.text.value) G.v.text.value = text;
    setEnd(msg, withLogin);
    syncForm();
  }

  async function send(raw) {
    if (G.sending) return;
    var text = String(raw == null ? '' : raw).trim();
    if (!text) return setEnd(TXT.empty);
    if (text.length > TEXT_MAX) return setEnd(TXT.tooLong);
    if (blocked()) return;
    var history = historyFor(G.msgs);
    var u = { role: 'user', text: text, state: 'pending' };
    G.msgs.push(u);
    keepRecent();
    G.sending = true;
    save();
    if (G.v && G.v.text) G.v.text.value = '';
    setEnd('');
    paintLog();
    syncForm();

    var tok = await token();
    if (!tok) return undo(u, text, TXT.relogin, true);
    var res = null;
    try {
      res = await fetch(base() + TURNS_PATH, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, history: history }),
        cache: 'no-store',
      });
    } catch {
      res = null;
    }
    if (!res) return undo(u, text, TXT.offline);
    if (!res.ok) {
      var b = null;
      try {
        b = await res.json();
      } catch {
        b = null;
      }
      var code = (b && b.code) || '';
      var msg = (b && b.message) || '';
      if (res.status === 429 && code === 'guide_limit') {
        var d = (b && b.data) || {};
        G.statusSeq++;
        G.status = {
          on: true,
          used: num(d.used),
          limit: num(d.limit),
          remaining: 0,
          day: G.status ? G.status.day : null,
          reset_at: d.reset_at || (G.status && G.status.reset_at) || null,
        };
        return undo(u, text, '');
      }
      if (res.status === 403 && code === 'guide_off') {
        G.statusSeq++;
        G.status = Object.assign({ used: 0, limit: 0, remaining: 0 }, G.status || {}, {
          on: false,
        });
        return undo(u, text, '');
      }
      if (res.status === 401) return undo(u, text, TXT.relogin, true);
      if (res.status === 429) return undo(u, text, msg || TXT.rate);
      if (res.status === 422) return undo(u, text, msg || TXT.fail);
      return undo(u, text, TXT.fail);
    }

    var a = { role: 'assistant', text: '', state: 'streaming' };
    G.msgs.push(a);
    keepRecent();
    G.live = a;
    paintLog();
    var end = null;
    await readLines(res, function (ev) {
      if (end) return;
      if (ev.type === 'start') {
        G.status = {
          on: true,
          used: num(ev.used),
          limit: num(ev.limit),
          remaining: num(ev.remaining),
          day: G.status ? G.status.day : null,
          reset_at: ev.reset_at || null,
        };
        G.statusSeq++; // 앞서 물은 GET /assistant/guide 가 늦게 와도 이 값을 덮지 않게
        paintStatus(); // 남은 수가 0 이면 이번 답은 받고, 다음 보내기부터 막는다
      } else if (ev.type === 'text') {
        a.text += typeof ev.text === 'string' ? ev.text : '';
        paintLive();
      } else if (ev.type === 'done' || ev.type === 'refused' || ev.type === 'error') {
        end = ev;
      }
    });

    if (end && end.type === 'done' && a.text.trim()) {
      u.state = 'ok';
      a.state = 'ok';
    } else {
      u.state = 'fail';
      a.state = 'fail';
      if (!end) a.note = TXT.cut;
      else if (end.type === 'refused') a.note = TXT.refused;
      else if (end.type === 'error') {
        a.note =
          (end.message ? String(end.message) : TXT.fail) +
          (end.given_back ? ' ' + TXT.givenBack : '');
        if (end.given_back === true && G.status && G.status.on) {
          G.status.used = Math.max(0, G.status.used - 1);
          G.status.remaining = Math.min(G.status.limit, G.status.remaining + 1);
        }
      } else a.note = TXT.fail;
    }
    G.live = null;
    G.sending = false;
    save();
    paintLog();
    paintStatus();
    focusText();
  }

  // ── 시트 ───────────────────────────────────────────────
  /** 패널 안 링크 — 패널을 닫고(기록 칸을 되돌린 뒤) 그 화면으로. 새 탭 · 창 열기는 브라우저에 맡긴다 */
  function onLinkClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    var href = a.getAttribute('href');
    var h = G.h;
    (h ? h.close('close') : Promise.resolve()).then(function () {
      window.SeganGuide.go(href);
    });
  }

  /**
   * 비서를 연다 — PC 옆 패널 · 폰 아래 시트. first 를 주면(PC 입력 줄) 로그인했을 때 그 글을 바로 묻는다.
   * 이미 열려 있으면 그 패널에서 묻는다.
   */
  function open(first) {
    var S = shell();
    var sheet = S && S.sheet;
    if (!sheet || typeof sheet.open !== 'function') return null;
    var text = String(first == null ? '' : first).trim();
    if (G.h && G.h.isOpen()) {
      if (text && G.v && G.v.text) send(text);
      return G.h;
    }
    var pc = wide();
    var root = el('div', 'sg-ai');
    viewChecking(root);
    var gen = ++G.gen;
    var h = sheet.open({
      title: TXT.title,
      body: root,
      kind: pc ? 'panel' : 'sheet',
      onClose: function () {
        if (G.h === h) {
          G.h = null;
          G.v = null;
        }
      },
    });
    if (h.el && h.el.parentNode) h.el.parentNode.classList.add('sg-ai-wrap');
    root.addEventListener('click', onLinkClick);
    G.h = h;
    G.v = { root: root };
    G.ready = prepare().then(function (session) {
      if (gen !== G.gen || !h.isOpen()) return;
      if (!session) {
        viewFaq(root);
        return;
      }
      viewChat(root);
      if (pc) focusText();
      if (text) send(text);
      var seq = G.statusSeq;
      loadStatus().then(function (st) {
        if (st && seq === G.statusSeq) G.status = st;
        if (gen === G.gen) paintStatus();
      });
      loadBiz(session).then(function () {
        if (gen === G.gen) paintBiz();
      });
    });
    return h;
  }

  // ── 여는 곳 (위 막대 버튼 · PC 입력 줄) ────────────────
  function mount() {
    if (!document.body) return;
    var header = document.querySelector('.sg-header');
    if (header && !header.querySelector('.sg-ai-btn')) {
      var b = el('button', 'sg-ai-btn', TXT.button);
      b.type = 'button';
      b.setAttribute('aria-haspopup', 'dialog');
      b.addEventListener('click', function () {
        open('');
      });
      header.appendChild(b);
    }
    if (!document.querySelector('.sg-ai-bar')) {
      var f = el('form', 'sg-ai-bar');
      f.noValidate = true;
      f.setAttribute('aria-label', TXT.title);
      var label = el('label', 'sg-ai-sr', TXT.bar);
      label.setAttribute('for', 'sgAiBarText');
      var input = el('input', 'sg-ai-bar-input');
      input.type = 'text';
      input.id = 'sgAiBarText';
      input.setAttribute('maxlength', String(TEXT_MAX));
      input.setAttribute('placeholder', TXT.bar);
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('enterkeyhint', 'send');
      var ask = el('button', 'sg-ai-bar-send', TXT.barSend);
      ask.type = 'submit';
      f.appendChild(label);
      f.appendChild(input);
      f.appendChild(ask);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var t = input.value;
        input.value = '';
        open(t);
      });
      var main = document.getElementById('main');
      if (main && main.parentNode) main.parentNode.insertBefore(f, main.nextSibling);
      else document.body.appendChild(f);
    }
    document.body.classList.add('sg-ai-on');
  }

  window.SeganGuide = {
    open: open,
    FAQ: FAQ,
    LINK_PATHS: LINK_PATHS,
    STORE: STORE,
    HISTORY_MAX: HISTORY_MAX,
    linkify: linkify,
    historyFor: historyFor,
    resetText: resetText,
    loginHref: loginHref,
    /** 화면 옮기기 — 시험이 바꿔 끼운다 */
    go: function (href) {
      window.location.href = href;
    },
    /** 열 때 로그인 확인 · 그리기 (시험용) */
    ready: function () {
      return G.ready || Promise.resolve();
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
