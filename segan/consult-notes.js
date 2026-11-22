/* ============================================================
   segan/consult-notes.js — 마이페이지 「AI 상담 기록」 (segan/me.html#consult-notes)

   2026-11-23 대표님 「상담내역은 마이페이지에 정리본 자동저장해 줘」.
   연출컷 만들기 ② 「요청 · AI 상담」에서 「정리하기」를 누르면 서버(generate-api POST /api/chat/brief)가
   정리본을 make_consult_notes 에 적는다 (DB 0081 — 같은 상담에서 다시 정리하면 같은 줄을 고친다).
   여기서는 본인 줄을 읽고(RLS — 본인만) 지운다. 넣기 · 고치기는 서버만 한다.
     목록   make_consult_notes (본인) id · category · brief · updated_at — 고친 때 최신순 20개씩, 「더 보기」
     지우기 줄마다 「지우기」 → 그 자리에서 한 번 더 묻는다 (지우면 되돌릴 수 없다)
   화면을 처음 열 때 읽는다 (segan/me.js 가 #consult-notes 를 열 때 open 을 부른다).
   품목 이름은 만들기 목록(segan/make.js KINDS)과 같은 표 KIND_LABELS.
   ============================================================ */
/* global window, document */
(function () {
  'use strict';

  var PAGE = 20;
  var TEXT = {
    loading: '불러오는 중',
    fail: '상담 기록을 불러오지 못했습니다.',
    retry: '다시 불러오기',
    more: '더 보기',
    del: '지우기',
    ask: '이 기록을 지울까요? 지우면 되돌릴 수 없습니다.',
    yes: '지우기',
    no: '취소',
    delFail: '지우지 못했습니다. 잠시 뒤 다시 눌러 주세요.',
    deleted: '지웠습니다.',
  };

  var N = { rows: [], before: null, done: false, loading: false, started: false, failed: false, asking: '', sb: null, me: '', msg: '' };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 품목 이름 — segan/make.js KINDS 와 같다 (시험이 둘을 견준다)
  var KIND_LABELS = {
    sink: '싱크대',
    island: '아일랜드',
    wardrobe: '붙박이장',
    storage: '수납장',
    fridge: '냉장고장',
    vanity: '화장대',
    shoe: '신발장',
    office: '사무실',
    study: '서재',
    bedroom: '침실',
  };

  function kindLabel(key) {
    return Object.prototype.hasOwnProperty.call(KIND_LABELS, key) ? KIND_LABELS[key] : '연출컷';
  }

  /** 2026.11.23 14:05 (기기 시각) */
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function rowHtml(r) {
    var asking = N.asking === r.id;
    return (
      '<li class="cn-item" data-id="' +
      esc(r.id) +
      '"><div class="cn-head"><b>' +
      esc(kindLabel(r.category)) +
      '</b><small>' +
      esc(when(r.updated_at)) +
      '</small></div><p class="cn-brief">' +
      esc(r.brief) +
      '</p>' +
      (asking
        ? '<div class="cn-ask" role="group" aria-label="' +
          esc(TEXT.ask) +
          '"><span>' +
          esc(TEXT.ask) +
          '</span><button type="button" class="sg-btn cn-yes" data-del-yes>' +
          esc(TEXT.yes) +
          '</button><button type="button" class="sg-btn" data-del-no>' +
          esc(TEXT.no) +
          '</button></div>'
        : '<div class="cn-acts"><button type="button" class="sg-btn" data-del>' + esc(TEXT.del) + '</button></div>') +
      '</li>'
    );
  }

  function paint() {
    var list = $('meNotes');
    if (!list) return;
    list.innerHTML = N.rows.map(rowHtml).join('');
    $('meNoteEmpty').hidden = N.loading || N.failed || !N.done || N.rows.length > 0;
    $('meNoteState').textContent = N.loading ? TEXT.loading : N.failed ? TEXT.fail : N.msg;
    var more = $('meNoteMore');
    more.hidden = N.loading || (N.done && !N.failed);
    more.textContent = N.failed ? TEXT.retry : TEXT.more;
  }

  /** 다음 쪽 — 고친 때(updated_at) 최신순, 다음 쪽은 마지막 updated_at 보다 앞 것 */
  async function loadMore() {
    if (!N.sb || N.loading || (N.done && !N.failed)) return;
    N.loading = true;
    N.failed = false;
    N.msg = '';
    paint();
    var rows = null;
    try {
      var q = N.sb
        .from('make_consult_notes')
        .select('id, category, brief, updated_at')
        .eq('user_id', N.me)
        .order('updated_at', { ascending: false })
        .limit(PAGE);
      if (N.before) q = q.lt('updated_at', N.before);
      var res = await q;
      if (res && !res.error && Array.isArray(res.data)) rows = res.data;
    } catch {
      rows = null;
    }
    N.loading = false;
    if (!rows) {
      N.failed = true;
      paint();
      return;
    }
    rows.forEach(function (r) {
      if (r && r.id && typeof r.brief === 'string') N.rows.push(r);
    });
    var last = rows.length ? rows[rows.length - 1].updated_at : null;
    if (last) N.before = last;
    N.done = rows.length < PAGE || !last;
    paint();
  }

  async function remove(id) {
    N.asking = '';
    N.msg = '';
    paint();
    var ok = false;
    try {
      var res = await N.sb.from('make_consult_notes').delete().eq('id', id).eq('user_id', N.me);
      ok = !!res && !res.error;
    } catch {
      ok = false;
    }
    if (ok)
      N.rows = N.rows.filter(function (r) {
        return r.id !== id;
      });
    N.msg = ok ? TEXT.deleted : TEXT.delFail;
    paint();
  }

  function onClick(e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var item = t.closest('.cn-item');
    var id = item && item.getAttribute('data-id');
    if (!id) return;
    if (t.closest('[data-del]')) {
      N.asking = id;
      N.msg = '';
      paint();
      var no = document.querySelector('.cn-item[data-id="' + id + '"] [data-del-no]');
      if (no) no.focus(); // 「취소」에 먼저 (실수로 지우지 않게)
    } else if (t.closest('[data-del-no]')) {
      N.asking = '';
      paint();
    } else if (t.closest('[data-del-yes]')) {
      api.removing = remove(id);
    }
  }

  /** me.js 가 화면을 열 때 — 처음 한 번만 읽는다. H = SeganMe.state (sb · session) */
  function open(H) {
    if (N.started || !H || !H.sb || !H.session || !H.session.user) return null;
    if (!$('meNotes')) return null;
    N.started = true;
    N.sb = H.sb;
    N.me = H.session.user.id;
    $('meNotes').addEventListener('click', onClick);
    $('meNoteMore').addEventListener('click', function () {
      api.loading = loadMore();
    });
    api.loading = loadMore();
    return api.loading;
  }

  var api = { open: open, state: N, TEXT: TEXT, PAGE: PAGE, KIND_LABELS: KIND_LABELS, loading: null, removing: null };
  window.SeganConsultNotes = api;
})();
