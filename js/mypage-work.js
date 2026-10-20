/**
 * 마이페이지 작업자 요약 (mypage.html #myWorkSection) — 계약 docs/01-plan/worker-portal-contract.md §4.
 *
 *   GET /work/me 가 작업자 행을 주면 요약 카드(예정 · 보완요청 · 새 소식, 다음 작업 한 줄, [작업자 페이지 열기]),
 *   아니면 섹션을 숨긴 채 둔다. 표가 아직 없으면({ ready:false }) 도 숨김. 요청이 실패해도 숨김 — 마이페이지를 막지 않는다.
 *   관리자도 작업자일 수 있어 .user-only 가 아니라 hidden 으로 연다.
 *
 *   마이페이지는 GET /work/me 만 부른다. GET /work/jobs?tab=mine 은 서버가 workers.last_seen_at 을 갱신해
 *   새 소식을 읽음으로 세므로(#946), 부르면 작업자가 worker.html 에서 새 소식을 못 보게 된다.
 *   그래서 다음 작업 한 줄은 서버에 읽기만 하는 길이 생기기 전까지 '작업자 페이지 내 작업에서 확인' 안내로 대신한다.
 *
 * 순수 함수는 Node(Jest) 에서 module.exports 로, 브라우저에서는 전역 `DadamMyPageWork` 로 쓴다.
 * mypage.html 은 `loadMyWork(supabaseClient)` 한 줄만 부른다. mypage 에는 esc 가 없어 여기에 둔다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamMyPageWork = api;
  root.loadMyWork = api.loadMyWork;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KIND_LABEL = Object.freeze({ install: '설치', as: 'A/S', assembly: '조립 추가 인원' });
  const ASSIGN_STATUS_LABEL = Object.freeze({
    offered: '초대 받음', confirmed: '확정', started: '작업 중', submitted: '완료 보고 · 검수 대기', revision: '보완요청',
  });
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  const KST_MS = 9 * 3600 * 1000;
  const DAY_MS = 86400000;

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const count = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0);

  function fmtWhen(iso) {
    const t = Date.parse(iso);
    if (!iso || !Number.isFinite(t)) return '날짜 미정';
    const d = new Date(t + KST_MS);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY[d.getUTCDay()]}) ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  const kstDay = (ms) => Math.floor((ms + KST_MS) / DAY_MS);

  /** 섹션을 열까 — 표가 있고(ready) 작업자 행이 있을 때만 */
  function shouldShow(me) {
    return !!(me && me.ready !== false && me.worker);
  }

  /** 요약 건수 — 서버 counts (승인 작업자만 값이 있다) */
  function summaryCounts(me) {
    const c = (me && me.counts) || {};
    return { open: count(c.open), mine: count(c.mine), revision: count(c.revision), newEvents: count(c.newEvents) };
  }

  /**
   * 다음 작업 한 줄 — 내 작업 카드 목록 중 보완요청이 먼저, 그다음 오늘 이후 가장 이른 날짜,
   * 날짜가 다 지났거나 없으면 첫 줄. 지금 loadMyWork 는 목록을 받지 않는다 (위 머리말 — 읽음 처리 문제).
   */
  function pickNextJob(items, nowMs) {
    const list = (Array.isArray(items) ? items : []).filter((j) => j && UUID_RE.test(String(j.id || '')));
    if (!list.length) return null;
    const rev = list.find((j) => j.my && j.my.assignment_status === 'revision');
    if (rev) return rev;
    const today = kstDay(Number.isFinite(nowMs) ? nowMs : Date.now());
    const dated = list
      .filter((j) => Number.isFinite(Date.parse(j.starts_at)) && kstDay(Date.parse(j.starts_at)) >= today)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    return dated[0] || list[0];
  }

  function nextJobText(j) {
    const parts = [fmtWhen(j.starts_at), KIND_LABEL[j.kind] || j.kind];
    if (j.region_label) parts.push(j.region_label);
    parts.push(j.title);
    const st = j.my && ASSIGN_STATUS_LABEL[j.my.assignment_status];
    return parts.filter(Boolean).join(' · ') + (st ? ` (${st})` : '');
  }

  const row = (k, v) => `<div class="info-item"><span class="info-label">${esc(k)}</span><span class="info-value">${v}</span></div>`;

  /** 요약 카드 HTML — 모든 글은 esc() 를 거친다 */
  function summaryHtml(me, nextJob) {
    if (!shouldShow(me)) return '';
    const w = me.worker;
    const rows = [];
    let next = '';
    if (w.status === 'approved') {
      const c = summaryCounts(me);
      rows.push(row('예정 · 진행', `${esc(c.mine)}건`));
      rows.push(row('보완요청', `${esc(c.revision)}건`));
      rows.push(row('새 소식', `${esc(c.newEvents)}건`));
      rows.push(row('모집중', `${esc(c.open)}건`));
      // 다음 작업은 길어서 표 줄이 아니라 아래 한 덩어리로 (좁은 화면에서 이름표가 눌리지 않게).
      // 작업을 받지 못했으면 내 작업이 있을 때 작업자 페이지 '내 작업' 탭으로 안내한다
      let line = '없음';
      if (nextJob && UUID_RE.test(String(nextJob.id || ''))) {
        line = `<a href="worker.html#job=${esc(nextJob.id)}" style="color: inherit">${esc(nextJobText(nextJob))}</a>`;
      } else if (c.mine > 0) {
        line = '<a href="worker.html#tab=mine" style="color: inherit">작업자 페이지 \'내 작업\'에서 확인하세요</a>';
      }
      next = `<div style="margin-top: 16px"><div class="info-label">다음 작업</div><div class="info-value" style="margin-top: 4px">${line}</div></div>`;
    } else if (w.status === 'pending') {
      rows.push(row('상태', '승인 대기 — 회사가 확인하면 작업을 볼 수 있습니다'));
    } else if (w.status === 'rejected') {
      rows.push(row('상태', '신청이 승인되지 않았습니다'));
    } else if (w.status === 'suspended') {
      rows.push(row('상태', '이용이 멈춰 있습니다'));
    }
    return `<p class="form-hint" style="margin: -8px 0 8px">${esc(w.display_name)} 님의 작업자 정보입니다.</p>` +
      `<div class="info-list">${rows.join('')}</div>${next}` +
      '<a class="btn-primary" href="worker.html" style="display: inline-block; margin-top: 16px; text-decoration: none">작업자 페이지 열기</a>';
  }

  async function getJson(apiBase, path, token) {
    const res = await fetch(apiBase + path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }
    if (!res.ok || !body || !body.success) throw new Error((body && body.message) || `요청 실패 (${res.status})`);
    return body.data;
  }

  /**
   * mypage.html 이 loadMyProjects() 다음에 부른다. 실패해도 던지지 않는다 (섹션은 숨긴 채).
   * GET /work/me 하나만 부른다 — /work/jobs?tab=mine 은 새 소식을 읽음 처리하므로 부르지 않는다 (머리말).
   */
  async function loadMyWork(client) {
    if (typeof document === 'undefined') return;
    const section = document.getElementById('myWorkSection');
    const box = document.getElementById('myWorkBody');
    if (!section || !box) return;
    section.hidden = true;
    try {
      const cfg = (typeof window !== 'undefined' && window.DADAM_CONFIG) || {};
      const apiBase = (cfg.workflowApi && cfg.workflowApi.url) || '';
      if (!apiBase || !client || !client.auth) return;
      const s = await client.auth.getSession();
      const token = s && s.data && s.data.session && s.data.session.access_token;
      if (!token) return;
      const me = await getJson(apiBase, '/work/me', token);
      if (!shouldShow(me)) return;
      box.innerHTML = summaryHtml(me, null);
      section.hidden = false;
    } catch (e) {
      section.hidden = true;
      console.warn('[mypage] 작업자 요약을 불러오지 못했습니다:', e && e.message);
    }
  }

  return Object.freeze({ esc, shouldShow, summaryCounts, pickNextJob, nextJobText, summaryHtml, loadMyWork });
});
