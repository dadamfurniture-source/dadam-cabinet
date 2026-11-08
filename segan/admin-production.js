/* ============================================================
   segan/admin-production.js — 「관리 › 제작 의뢰」 (segan/admin.html#production)

   2026-11-08 제작 의뢰: Manager 업체가 보낸 의뢰를 본사가 검토해 팩토리를 추천한다 (보통 3곳, 많아야 5곳).
   Manager 가 한 곳을 고르면 그 팩토리가 24시간 안에 받기 · 못 받음. 못 받음 · 답 없음이면 다시 본사 차례.

   누가      관리자 — segan/admin.js 가 관리자일 때만 부른다 (서버도 관리자만 답한다)
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /admin/production-requests?state=todo|waiting|done   { ready, state, items[] }
               POST /admin/production-requests/:id/review                검토 시작 (접수 → 본사 검토 중)
               GET  /admin/production-requests/:id/suggestions           추천 후보 — 상담 분배 점수 그대로 (본사만)
               POST /admin/production-requests/:id/recommend             { company_ids[1~5], note?, notes? }
   화면      할 일(접수 · 검토 중 · 못 받음 · 답 없음) · 답 기다림(추천 도착 · 팩토리 답 기다림) · 끝(받음 · 거둠) 탭 →
             의뢰 줄 → 누르면 그 자리에 의뢰 내용 · 지금 추천 · 고른 기록(못 받음 사유 — 본사만 본다) · 거친 팩토리 ·
             「추천 후보 보기」(접수 상태면 검토 시작을 먼저 보낸다) → 순위(점수 내역)에서 미리 3곳을 골라 둔다 ·
             1~5곳 · 팩토리마다 소개(Manager 에게 보인다) · Manager 에게 남길 말 → 「N곳 추천」.
             지역 · 품목 · 한도 · 기간 · 서류로 걸러진 팩토리는 그 이유를 적고 고를 수 있게 둔다 (막지 않는다 —
             워커 production-requests/admin.js 머리말). 등급 밖 · 활동 안 함 · 이 의뢰를 돌려보낸 곳만 고를 수 없다.
             Manager 에게 보이는 추천 카드에는 가격대 · 제작 기간 칸이 아직 없다 — 소개에 적어 둘 수 있다.
   이름      거르기 이유 · 점수 묶음 = segan/admin-consults.js (상담 배정과 같은 점수 — 그 모듈이 있으면 점수 내역을 빌려 쓴다)
   못 읽으면  목록 · 후보 자리에 한 줄 안내. 추천을 못 하면 서버 글을 그 자리에.
   본사 알림  새 의뢰 · 못 받음 · 답 없음은 회사 Slack 으로만 온다 (워커 common.js notifyHq — 앱 알림 없음).
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var RECOMMEND_DEFAULT = 3; // 워커 production-requests/common.js RECOMMEND_DEFAULT (상담 순위 TOP_N)
  var RECOMMEND_MAX = 5; // 워커 RECOMMEND_MAX
  var HQ_NOTE_MAX = 500; // 워커 HQ_NOTE_MAX
  var PROFILE_NOTE_MAX = 200; // 워커 PROFILE_NOTE_MAX
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var STATUS_LABEL = {
    submitted: '접수',
    recommending: '본사 검토 중',
    recommended: '추천 도착',
    chosen: '팩토리 답 기다림',
    accepted: '팩토리가 받음',
    declined: '팩토리가 못 받음',
    expired: '팩토리 답 없음',
    cancelled: '거둠',
  }; // 워커 production-requests/common.js STATUS_LABEL
  var OFFER_LABEL = {
    open: '답 기다림',
    accepted: '받음',
    declined: '못 받음',
    expired: '답 없음',
    cancelled: '거둠',
  };
  var PLAN_LABEL = { manager: 'Manager', expert: 'Expert', agent: 'Agent' }; // 협력업체 등급 (companies.plan)
  // 후보 종류 · 거르기 이유 — segan/admin-consults.js 와 같다
  var KIND_LABEL = { hq: '다담 공장', partner: '협력 팩토리' };
  var FILTER_REASON = {
    region: '지역 밖',
    item: '품목 안 함',
    limit: '한도',
    period: '기간 없음',
    docs: '서류 미확인',
    tier: '자격',
    inactive: '활동 안 함',
    tried: '거친 팩토리',
    unknown: '모르는 업체',
  };
  var TABS = [
    ['todo', '할 일'],
    ['waiting', '답 기다림'],
    ['done', '끝'],
  ];
  var EMPTY_TEXT = {
    todo: '추천할 제작 의뢰가 없습니다.',
    waiting: '답을 기다리는 제작 의뢰가 없습니다.',
    done: '끝난 제작 의뢰가 없습니다.',
  };
  var TEXT = {
    lead:
      'Manager 업체가 보낸 제작 의뢰입니다. 검토한 뒤 팩토리를 보통 ' +
      RECOMMEND_DEFAULT +
      '곳, 많아야 ' +
      RECOMMEND_MAX +
      '곳 추천해 주세요. 새 의뢰 · 못 받음 · 답 없음은 회사 Slack 으로 알려 드립니다.',
    loadFail: '제작 의뢰를 불러오지 못했습니다.',
    notReady: '제작 의뢰 DB(0050)를 적용한 뒤에 볼 수 있습니다.',
    sugLoading: '후보를 계산하는 중…',
    sugFail: '추천 후보를 불러오지 못했습니다.',
    noCand: '추천할 수 있는 팩토리가 없습니다.',
    suggest: '추천 후보 보기',
    resuggest: '다시 추천',
    reviewFirst: '검토 시작 · 추천 후보 보기',
    pickRange: '1~' + RECOMMEND_MAX + '곳을 골라 주세요.',
    noteLong: 'Manager 에게 남길 말은 ' + HQ_NOTE_MAX + '자까지입니다.',
    profileLong: '소개는 ' + PROFILE_NOTE_MAX + '자까지입니다.',
    profilePh: '소개 (Manager 에게 보입니다) — 예: 가격대 · 제작 기간 · 잘하는 품목',
    hqNotePh: 'Manager 에게 남길 말 (없어도 됩니다)',
    stale: '그사이 의뢰가 바뀌었습니다. 목록을 다시 불러왔습니다.',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var A = {
    sb: null,
    session: null,
    base: '',
    tab: 'todo',
    items: null, // 목록 | null(못 읽음) | 'pending'(DB 적용 전)
    selectedId: null,
    sug: null, // { items, filtered, max, def } | 'loading' | null(못 읽음 · 아직 안 열었음)
    sugFor: '', // 후보를 연 의뢰 id
    picked: [], // 고른 팩토리 id (차례 = 보낼 차례)
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

  function label(map, k, fallback) {
    return has(map, k) ? map[k] : k === null || k === undefined || k === '' ? fallback : String(k);
  }

  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

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

  function day(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s));
    return m ? m[1] + '.' + m[2] + '.' + m[3] : '';
  }

  function fmtNum(v) {
    return typeof v === 'number' && isFinite(v) ? String(Math.round(v * 10) / 10) : '-';
  }

  // ── 판정 · 본문 (순수 함수 — 시험이 직접 부른다) ─────────
  /** 목록 본문 → items | 'pending'(DB 적용 전) | null */
  function listOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    if (d.ready === false) return 'pending';
    return d.items.filter(function (x) {
      return x && typeof x === 'object' && UUID_RE.test(String(x.id || ''));
    });
  }

  /** 후보 본문 → { items, filtered, max, def } | null */
  function suggestionsOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    var max =
      Number.isInteger(d.max) && d.max >= 1 ? Math.min(d.max, RECOMMEND_MAX) : RECOMMEND_MAX;
    var def =
      Number.isInteger(d.default_count) && d.default_count >= 0
        ? Math.min(d.default_count, max)
        : RECOMMEND_DEFAULT;
    var good = function (x) {
      return x && typeof x === 'object' && UUID_RE.test(String(x.company_id || ''));
    };
    return {
      items: d.items.filter(good),
      filtered: arr(d.filtered).filter(good),
      max: max,
      def: def,
    };
  }

  /** 처음 골라 둘 팩토리 — 순위 위에서부터 def 곳 (걸러진 팩토리는 미리 고르지 않는다) */
  function defaultPicks(sug) {
    if (!sug || typeof sug !== 'object') return [];
    return sug.items.slice(0, sug.def).map(function (x) {
      return x.company_id;
    });
  }

  /** 고를 수 있는 걸러진 팩토리의 이유 글 — 「지역 밖 · 품목 안 함」 */
  function reasonText(reasons) {
    return arr(reasons)
      .map(function (r) {
        return label(FILTER_REASON, r, String(r));
      })
      .join(' · ');
  }

  /**
   * 추천 본문 — 고른 차례 그대로 · 소개는 적은 것만 · 남길 말은 있으면. 아니면 { error }
   * v = { ids, note, notes: { company_id: 글 } }
   */
  function recommendBodyOf(v, max) {
    var ids = arr(v.ids).filter(function (id) {
      return UUID_RE.test(String(id || ''));
    });
    var cap = max || RECOMMEND_MAX;
    if (ids.length < 1 || ids.length > cap) return { error: TEXT.pickRange };
    var body = { company_ids: ids };
    var note = String(v.note || '').trim();
    if ([...note].length > HQ_NOTE_MAX) return { error: TEXT.noteLong };
    if (note) body.note = note;
    var notes = {};
    var any = false;
    for (var i = 0; i < ids.length; i++) {
      var t = String((v.notes && v.notes[ids[i]]) || '').trim();
      if (!t) continue;
      if ([...t].length > PROFILE_NOTE_MAX) return { error: TEXT.profileLong, company: ids[i] };
      notes[ids[i]] = t;
      any = true;
    }
    if (any) body.notes = notes;
    return { body: body };
  }

  // ── 그리기 ─────────────────────────────────────────────
  function current() {
    return (
      (Array.isArray(A.items) ? A.items : []).filter(function (x) {
        return x.id === A.selectedId;
      })[0] || null
    );
  }

  function fact(name, html) {
    return '<div><dt>' + esc(name) + '</dt><dd>' + html + '</dd></div>';
  }

  function managerText(r) {
    var m = r.manager && typeof r.manager === 'object' ? r.manager : {};
    return [m.name || '-', m.region || '', has(PLAN_LABEL, m.plan) ? PLAN_LABEL[m.plan] : '']
      .filter(Boolean)
      .join(' · ');
  }

  function designText(r) {
    var d = r.draft && typeof r.draft === 'object' ? r.draft : null;
    if (!d) return r.design_id ? '앱 설계' : '-';
    var parts = [d.name || '플래너 설계'];
    if (Number(d.walls) > 0) parts.push('벽 ' + Number(d.walls));
    if (Number(d.modules) > 0) parts.push('모듈 ' + Number(d.modules));
    if (Number(d.rev) > 0) parts.push(Number(d.rev) + '차 저장');
    if (Number(d.current_rev) > Number(d.rev)) parts.push('의뢰 뒤 고침');
    return parts.join(' · ');
  }

  function detailHtml(r) {
    var facts =
      '<dl class="me-facts">' +
      fact('의뢰 업체', esc(managerText(r))) +
      fact('설계', esc(designText(r))) +
      (r.project && typeof r.project === 'object'
        ? fact('프로젝트', esc(r.project.title || '프로젝트'))
        : '') +
      fact('품목', esc(r.item_label || '-')) +
      fact('현장 지역', esc(r.region || '-')) +
      fact(
        '희망 시기',
        esc(day(r.wanted_done_date) ? day(r.wanted_done_date) + ' 시공 완료' : '-')
      ) +
      (typeof r.note === 'string' && r.note
        ? '<div class="me-cs-desc"><dt>요청 메모</dt><dd>' + esc(r.note) + '</dd></div>'
        : '') +
      (r.hq_note
        ? '<div class="me-cs-desc"><dt>본사 말</dt><dd>' + esc(r.hq_note) + '</dd></div>'
        : '') +
      fact('의뢰일', esc(fmtDateTime(r.created_at))) +
      fact('상태', esc(label(STATUS_LABEL, r.status, '-'))) +
      '</dl>';
    var recs = arr(r.recommendations);
    var recsHtml = recs.length
      ? '<p class="me-pt-title">' +
        esc((Number(r.round) > 0 ? Number(r.round) + '차 ' : '') + '추천') +
        '</p><ul class="ad-score" data-recs>' +
        recs
          .map(function (x) {
            return (
              '<li>' +
              esc(
                [
                  (x.rank ? x.rank + '. ' : '') + (x.name || '-'),
                  x.chosen ? '고름 · ' + label(OFFER_LABEL, x.state, '-') : '',
                  x.note ? '소개: ' + x.note : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              ) +
              '</li>'
            );
          })
          .join('') +
        '</ul>'
      : '';
    var offers = arr(r.offers);
    // 고른 기록 — 못 받음 사유는 본사 화면에만 (Manager 응답에는 서버가 싣지 않는다)
    var offersHtml = offers.length
      ? '<p class="me-pt-title">고른 기록</p><ul class="ad-score" data-offers>' +
        offers
          .map(function (o) {
            return (
              '<li>' +
              esc(
                [
                  (Number(o.round) > 0 ? Number(o.round) + '차 ' : '') + (o.name || '-'),
                  label(OFFER_LABEL, o.state, '-'),
                  '고름 ' + fmtDateTime(o.chosen_at),
                  o.responded_at ? '답 ' + fmtDateTime(o.responded_at) : '',
                  o.reason ? '사유: ' + o.reason : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              ) +
              '</li>'
            );
          })
          .join('') +
        '</ul>'
      : '';
    var tried = arr(r.tried);
    var triedHtml = tried.length
      ? '<p class="mk-note" data-tried>돌려보낸 팩토리 (다시 추천할 수 없음) — ' +
        esc(
          tried
            .map(function (t) {
              return t.name || '-';
            })
            .join(' · ')
        ) +
        '</p>'
      : '';
    var open = A.sugFor === r.id;
    var action = '';
    if (r.can_recommend === true && !open) {
      var text =
        r.can_review === true ? TEXT.reviewFirst : r.round > 0 ? TEXT.resuggest : TEXT.suggest;
      action =
        '<div class="rd-acts"><button type="button" class="mk-btn" data-act="suggest" data-id="' +
        esc(r.id) +
        '"' +
        (A.busy ? ' disabled' : '') +
        '>' +
        esc(text) +
        '</button></div>';
    }
    return (
      '<div class="ad-detail">' +
      facts +
      recsHtml +
      offersHtml +
      triedHtml +
      action +
      (open ? suggestHtml(r) : '') +
      '</div>'
    );
  }

  /** 점수 내역 — segan/admin-consults.js 가 있으면 그 묶음 글을 빌린다 (같은 점수) */
  function scoreHtml(x) {
    var AC = window.SeganAdminConsults;
    if (!AC || !AC.groupText || !Array.isArray(AC.SCORE_GROUPS) || !x.score) return '';
    return (
      '<ul class="ad-score">' +
      AC.SCORE_GROUPS.map(function (g) {
        return '<li>' + esc(AC.groupText(g, x.score[g.key])) + '</li>';
      }).join('') +
      '</ul>'
    );
  }

  function pickRowHtml(x, head, hint, max) {
    var on = A.picked.indexOf(x.company_id) >= 0;
    var full = !on && A.picked.length >= max;
    return (
      '<li class="ad-cand" data-company="' +
      esc(x.company_id) +
      '"><label class="cs-agree"><input type="checkbox" name="pick" value="' +
      esc(x.company_id) +
      '"' +
      (on ? ' checked' : '') +
      (full || A.busy ? ' disabled' : '') +
      ' /><span class="ad-cand-head"><b>' +
      esc(head) +
      '</b><span>' +
      esc([label(KIND_LABEL, x.kind, ''), x.region || ''].filter(Boolean).join(' · ')) +
      '</span></span></label>' +
      (hint ? '<p class="me-pt-warn" data-hint>' + esc(hint) + '</p>' : '') +
      scoreHtml(x) +
      (on
        ? '<label class="mk-input"><span>소개</span><input type="text" name="note-' +
          esc(x.company_id) +
          '" data-note-for="' +
          esc(x.company_id) +
          '" maxlength="' +
          PROFILE_NOTE_MAX +
          '" placeholder="' +
          esc(TEXT.profilePh) +
          '" autocomplete="off" /></label>'
        : '') +
      '</li>'
    );
  }

  function suggestHtml(r) {
    var s = A.sug;
    if (s === 'loading') return '<p class="sg-note">' + esc(TEXT.sugLoading) + '</p>';
    if (!s || typeof s !== 'object')
      return '<p class="me-pt-msg" role="status">' + esc(TEXT.sugFail) + '</p>';
    var pickable = s.filtered.filter(function (f) {
      return f.can_recommend === true;
    });
    var blocked = s.filtered.filter(function (f) {
      return f.can_recommend !== true;
    });
    var rows =
      s.items
        .map(function (x) {
          return pickRowHtml(
            x,
            (x.rank ? x.rank + '순위 ' : '') +
              (x.company_name || '-') +
              ' · ' +
              fmtNum(x.total) +
              '점',
            '',
            s.max
          );
        })
        .join('') +
      pickable
        .map(function (f) {
          return pickRowHtml(f, f.company_name || '-', '확인 — ' + reasonText(f.reasons), s.max);
        })
        .join('');
    var blockedHtml = blocked.length
      ? '<details class="ad-filtered"><summary>추천할 수 없는 팩토리 ' +
        blocked.length +
        '</summary><ul>' +
        blocked
          .map(function (f) {
            return '<li>' + esc((f.company_name || '-') + ' — ' + reasonText(f.reasons)) + '</li>';
          })
          .join('') +
        '</ul></details>'
      : '';
    var n = A.picked.length;
    return (
      '<form class="ad-panel" data-form="recommend" data-id="' +
      esc(r.id) +
      '" novalidate>' +
      '<p class="me-pt-title">추천 후보</p>' +
      '<p class="mk-note">' +
      esc(
        '순위 위 ' +
          s.def +
          '곳을 골라 두었습니다. 1~' +
          s.max +
          '곳까지 고를 수 있습니다. 걸러진 팩토리는 이유를 보고 골라도 됩니다.'
      ) +
      '</p>' +
      (rows
        ? '<ol class="ad-cands">' + rows + '</ol>'
        : '<p class="me-pt-msg">' + esc(TEXT.noCand) + '</p>') +
      blockedHtml +
      '<label class="mk-input"><span>Manager 에게 남길 말</span><textarea name="hq_note" rows="3" maxlength="' +
      HQ_NOTE_MAX +
      '" placeholder="' +
      esc(TEXT.hqNotePh) +
      '"></textarea></label>' +
      '<p class="mk-error" data-err role="alert"' +
      (A.err ? '' : ' hidden') +
      '>' +
      esc(A.err) +
      '</p>' +
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid" data-count="' +
      n +
      '"' +
      (A.busy || n < 1 || n > s.max ? ' disabled' : '') +
      '>' +
      esc(n + '곳 추천') +
      '</button><button type="button" class="mk-btn" data-act="sug-close"' +
      (A.busy ? ' disabled' : '') +
      '>닫기</button></div></form>'
    );
  }

  function itemHtml(r) {
    var sel = r.id === A.selectedId;
    var m = r.manager && typeof r.manager === 'object' ? r.manager : {};
    var sub = [r.item_label || '품목 없음', r.region || '', fmtDate(r.created_at)];
    if (Number(r.round) > 0) sub.push(Number(r.round) + '차 추천');
    if (r.factory && r.factory.name) sub.push(r.factory.name);
    var tried = arr(r.tried).length;
    if (tried) sub.push('돌려보낸 팩토리 ' + tried);
    return (
      '<li class="me-cs-item" data-request="' +
      esc(r.id) +
      '"><button type="button" class="ad-pick" data-act="pick" data-id="' +
      esc(r.id) +
      '" aria-expanded="' +
      sel +
      '"><span class="me-c-main"><b>' +
      esc(m.name || '이름 없는 업체') +
      '</b><small>' +
      esc(sub.filter(Boolean).join(' · ')) +
      '</small></span><span class="ad-status">' +
      esc(r.label || label(STATUS_LABEL, r.status, '-')) +
      '</span></button>' +
      (sel ? detailHtml(r) : '') +
      '</li>'
    );
  }

  /** 다시 그려도 적던 소개 · 남길 말이 남게 */
  function typed() {
    var box = $('adProductionBody');
    var out = { note: '', notes: {} };
    var form = box && box.querySelector('form[data-form="recommend"]');
    if (!form) return out;
    var ta = form.querySelector('[name="hq_note"]');
    out.note = ta ? ta.value : '';
    form.querySelectorAll('[data-note-for]').forEach(function (el) {
      out.notes[el.getAttribute('data-note-for')] = el.value;
    });
    return out;
  }

  function restore(v) {
    var box = $('adProductionBody');
    var form = box && box.querySelector('form[data-form="recommend"]');
    if (!form || !v) return;
    var ta = form.querySelector('[name="hq_note"]');
    if (ta) ta.value = v.note || '';
    form.querySelectorAll('[data-note-for]').forEach(function (el) {
      var k = el.getAttribute('data-note-for');
      if (has(v.notes, k)) el.value = v.notes[k];
    });
  }

  function render() {
    var box = $('adProductionBody');
    if (!box) return;
    var keep = typed();
    var tabs =
      '<div class="cs-choices ad-tabs" role="tablist">' +
      TABS.map(function (t) {
        var on = A.tab === t[0];
        return (
          '<button type="button" class="mk-btn' +
          (on ? ' mk-btn--solid' : '') +
          '" data-act="tab" data-tab="' +
          t[0] +
          '" role="tab" aria-selected="' +
          on +
          '"' +
          (A.busy ? ' disabled' : '') +
          '>' +
          esc(t[1]) +
          '</button>'
        );
      }).join('') +
      '</div>';
    var body;
    if (A.items === 'pending')
      body = '<p class="me-pt-msg" role="status">' + esc(TEXT.notReady) + '</p>';
    else if (A.items === null)
      body = '<p class="me-pt-msg" role="status">' + esc(TEXT.loadFail) + '</p>';
    else if (!A.items.length) body = '<p class="me-empty">' + esc(EMPTY_TEXT[A.tab]) + '</p>';
    else body = '<ul class="me-cs-list ad-list">' + A.items.map(itemHtml).join('') + '</ul>';
    box.innerHTML =
      '<p class="mk-note">' +
      esc(TEXT.lead) +
      '</p>' +
      tabs +
      (A.msg ? '<p class="me-pt-msg" role="status">' + esc(A.msg) + '</p>' : '') +
      body;
    restore(keep);
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

  async function call(method, path, body) {
    if (!A.base) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(A.base + path, {
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

  async function fetchList() {
    var r = await call('GET', '/admin/production-requests?state=' + encodeURIComponent(A.tab));
    return r.ok ? listOf(r.body) : null;
  }

  function closeSug() {
    A.sug = null;
    A.sugFor = '';
    A.picked = [];
    A.err = '';
  }

  async function reload() {
    A.items = await fetchList();
    if (!current()) {
      A.selectedId = null;
      closeSug();
    }
    render();
  }

  /** 「추천 후보 보기」 — 접수 상태면 검토 시작을 먼저 (Manager 화면이 「본사 검토 중」이 된다) */
  async function openSuggestions(id) {
    var r = current();
    if (!r || r.id !== id || r.can_recommend !== true) return;
    A.busy = true;
    A.err = '';
    A.msg = '';
    A.sugFor = id;
    A.sug = 'loading';
    A.picked = [];
    render();
    if (r.can_review === true) {
      var rv = await call(
        'POST',
        '/admin/production-requests/' + encodeURIComponent(id) + '/review'
      );
      if (!rv.ok && rv.status !== 409) {
        A.busy = false;
        closeSug();
        A.msg = errText(rv);
        render();
        return;
      }
      r.status = 'recommending';
      r.label = STATUS_LABEL.recommending;
      r.can_review = false;
    }
    var got = await call(
      'GET',
      '/admin/production-requests/' + encodeURIComponent(id) + '/suggestions'
    );
    A.busy = false;
    if (A.sugFor !== id) return; // 그새 닫았다
    A.sug = got.ok ? suggestionsOf(got.body) : null;
    A.picked = defaultPicks(A.sug);
    render();
  }

  async function recommend(form) {
    if (A.busy) return;
    var id = form.getAttribute('data-id') || '';
    var s = A.sug && typeof A.sug === 'object' ? A.sug : null;
    var v = typed();
    var got = recommendBodyOf({ ids: A.picked, note: v.note, notes: v.notes }, s ? s.max : 0);
    if (got.error) {
      A.err = got.error;
      render();
      return;
    }
    A.busy = true;
    A.err = '';
    render();
    var r = await call(
      'POST',
      '/admin/production-requests/' + encodeURIComponent(id) + '/recommend',
      got.body
    );
    A.busy = false;
    if (r.ok) {
      closeSug();
      A.msg =
        got.body.company_ids.length +
        '곳을 추천했습니다. Manager 가 고르면 그 팩토리가 24시간 안에 답합니다.';
      await reload();
      return;
    }
    if (r.status === 409) {
      closeSug();
      A.msg = TEXT.stale;
      await reload();
      return;
    }
    A.err = errText(r);
    render();
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || A.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'tab') {
      var tab = el.getAttribute('data-tab');
      if (tab === A.tab || !has(EMPTY_TEXT, tab)) return;
      A.tab = tab;
      A.selectedId = null;
      A.msg = '';
      closeSug();
      return reload();
    }
    if (act === 'pick') {
      var id = el.getAttribute('data-id');
      A.msg = '';
      closeSug();
      A.selectedId = A.selectedId === id ? null : id;
      render();
      return;
    }
    if (act === 'suggest') return openSuggestions(el.getAttribute('data-id') || '');
    if (act === 'sug-close') {
      closeSug();
      render();
    }
  }

  /** 고르기 — 고른 차례를 지킨다 (보낼 때 순서 = 고른 차례), 많아야 max 곳 */
  function onChange(e) {
    var el = e.target;
    if (!el || el.name !== 'pick' || A.busy) return;
    var id = el.value;
    var s = A.sug && typeof A.sug === 'object' ? A.sug : null;
    var at = A.picked.indexOf(id);
    if (el.checked && at < 0) {
      if (A.picked.length >= (s ? s.max : RECOMMEND_MAX)) el.checked = false;
      else A.picked.push(id);
    } else if (!el.checked && at >= 0) A.picked.splice(at, 1);
    A.err = '';
    render();
  }

  function onSubmit(e) {
    var form = e.target;
    if (!form || form.getAttribute('data-form') !== 'recommend') return;
    e.preventDefault();
    recommend(form);
  }

  /** 제작 의뢰 칸 채우기 — admin.js 가 #production(-waiting · -done) 으로 올 때 부른다. tab = 처음 탭 */
  async function load(sb, session, tab) {
    var box = $('adProductionBody');
    if (!box) return;
    var cfg = window.DADAM_CONFIG || {};
    A.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    A.sb = sb;
    A.session = session;
    A.tab = has(EMPTY_TEXT, tab) ? tab : 'todo';
    A.selectedId = null;
    A.msg = '';
    A.busy = false;
    closeSug();
    if (!box.getAttribute('data-bound')) {
      box.setAttribute('data-bound', '1');
      box.addEventListener('click', onClick);
      box.addEventListener('change', onChange);
      box.addEventListener('submit', onSubmit);
    }
    box.innerHTML = '<p class="sg-note">불러오는 중…</p>';
    await reload();
  }

  window.SeganAdminProduction = {
    RECOMMEND_DEFAULT: RECOMMEND_DEFAULT,
    RECOMMEND_MAX: RECOMMEND_MAX,
    HQ_NOTE_MAX: HQ_NOTE_MAX,
    PROFILE_NOTE_MAX: PROFILE_NOTE_MAX,
    STATUS_LABEL: STATUS_LABEL,
    OFFER_LABEL: OFFER_LABEL,
    FILTER_REASON: FILTER_REASON,
    TABS: TABS,
    state: A,
    listOf: listOf,
    suggestionsOf: suggestionsOf,
    defaultPicks: defaultPicks,
    recommendBodyOf: recommendBodyOf,
    load: load,
  };
})();
