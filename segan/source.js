/* ============================================================
   segan/source.js — 유입 경로 (window.SeganSource) — 2026-11-23 「사이트 새는 곳 막기」 묶음 3

   대표님 11-21: Cloudflare 웹 분석 + 자체 기록. 방문 수는 Cloudflare 가 보고, 「어느 글 · 광고를 보고 온 고객이
   상담 · 가입했나」는 여기서 담아 둔 값을 상담 · 회원 기록에 같이 남겨 센다 (DB 0080 inflow_* 칸).

   - 처음 들어온 곳 하나만 이 브라우저(localStorage segan.src)에 90일 담는다 — 뒤에 다른 꼬리표로 와도 바꾸지 않는다
       주소의 꼬리표 utm_source · utm_medium · utm_campaign (각 100자까지)
       꼬리표가 없으면 바로 앞 바깥 사이트의 호스트 이름만 (예 search.naver.com — 주소 전체는 담지 않는다, 200자까지)
   - columns()        상담 줄에 붙일 칸 — 값이 있는 칸만 (없으면 {} — 예전 상담과 같은 모양)
   - claim(sb, session)  가입한 사람의 profiles 줄에 한 번 채운다 — 이 값을 담은 뒤에 가입했고 아직 비었을 때만
                         (오래된 회원이 광고로 다시 들어온 것은 가입 유입이 아니다). 탭마다 한 번만 묻는다
   - 업체에 넘기는 상담 사본에는 넣지 않는다 (workflow-api COPY_FIELDS). 처리방침 10항.

   실는 곳: 공개 화면(홈 · 만들기 · 시공사례 · 상담 · 소개 · 구독 · 매거진 책장 · 글 여섯 편). claim 은 make.js · consult.js 가 부른다.
   ============================================================ */
/* global window, document, localStorage, sessionStorage, URL, URLSearchParams */
(function () {
  'use strict';

  var KEY = 'segan.src';
  var CLAIMED = 'segan.src.claimed'; // 이 탭에서 이미 물었다 (sessionStorage)
  var DAYS = 90;
  var MAX = 100;
  var MAX_HOST = 200;
  var OWN = /(^|\.)dadamfurniture\.com$/i;

  function clean(v, max) {
    // 보이지 않는 제어 문자는 뺀다 (글자 코드 32 미만 · 127)
    var s = String(v == null ? '' : v);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 32 && c !== 127) out += s[i];
    }
    return out.trim().slice(0, max);
  }

  /** 담아 둔 값 — 없거나 90일이 지났으면 null */
  function read() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d || typeof d !== 'object' || typeof d.at !== 'number') return null;
      if (Date.now() - d.at > DAYS * 864e5 || d.at > Date.now() + 864e5) return null;
      return {
        source: clean(d.source, MAX),
        medium: clean(d.medium, MAX),
        campaign: clean(d.campaign, MAX),
        referrer: clean(d.referrer, MAX_HOST),
        at: d.at,
      };
    } catch {
      return null;
    }
  }

  /** 지금 주소 · 앞 사이트에서 읽은 값 — 없으면 null */
  function sniff(search, referrer, host) {
    var q;
    try {
      q = new URLSearchParams(search || '');
    } catch {
      return null;
    }
    var source = clean(q.get('utm_source'), MAX);
    var medium = clean(q.get('utm_medium'), MAX);
    var campaign = clean(q.get('utm_campaign'), MAX);
    if (source || medium || campaign)
      return { source: source, medium: medium, campaign: campaign, referrer: '' };
    var ref = '';
    try {
      ref = referrer ? new URL(referrer).hostname.toLowerCase() : '';
    } catch {
      ref = '';
    }
    if (!ref || ref === String(host || '').toLowerCase() || OWN.test(ref)) return null;
    return { source: '', medium: '', campaign: '', referrer: clean(ref, MAX_HOST) };
  }

  /** 처음 들어온 것만 담는다 (이미 있으면 그대로) */
  function remember(search, referrer, host, now) {
    if (read()) return false;
    var got = sniff(search, referrer, host);
    if (!got) return false;
    got.at = typeof now === 'number' ? now : Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(got));
      return true;
    } catch {
      return false; // 저장소가 막힌 기기 — 세지 못한다
    }
  }

  /** 상담 줄에 붙일 칸 — 값이 있는 칸만 */
  function columns() {
    var d = read();
    var out = {};
    if (!d) return out;
    if (d.source) out.inflow_source = d.source;
    if (d.medium) out.inflow_medium = d.medium;
    if (d.campaign) out.inflow_campaign = d.campaign;
    if (d.referrer) out.inflow_referrer = d.referrer;
    return out;
  }

  /** 가입한 사람의 profiles 줄에 한 번 — 이 값을 담은 뒤 가입했고 비었을 때만. 결과: true = 채웠다 */
  async function claim(sb, session) {
    var uid = session && session.user && session.user.id;
    var d = read();
    if (!sb || !uid || !d) return false;
    try {
      if (sessionStorage.getItem(CLAIMED) === uid) return false;
      sessionStorage.setItem(CLAIMED, uid);
    } catch {
      /* 그래도 한 번은 묻는다 */
    }
    var cols = columns();
    if (!Object.keys(cols).length) return false;
    try {
      var r = await sb.from('profiles').select('inflow_at,created_at').eq('id', uid).maybeSingle();
      var row = r && !r.error ? r.data : null;
      if (!row || row.inflow_at) return false;
      var joined = Date.parse(row.created_at || '');
      if (!(joined >= d.at)) return false; // 처음 들어온 뒤에 가입한 사람만
      cols.inflow_at = new Date().toISOString();
      var u = await sb.from('profiles').update(cols).eq('id', uid).is('inflow_at', null);
      return !(u && u.error);
    } catch {
      return false;
    }
  }

  window.SeganSource = {
    KEY: KEY,
    DAYS: DAYS,
    read: read,
    sniff: sniff,
    remember: remember,
    columns: columns,
    claim: claim,
  };

  remember(window.location.search, document.referrer, window.location.hostname);
})();
