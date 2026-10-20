/**
 * 작업자 포털 (worker.html) — 상태별 화면 · 작업 목록 · 작업 상세 · 글 보고.
 * 계약: docs/01-plan/worker-portal-contract.md §3 작업자 API · §4 화면.
 *
 * 앞부분은 순수 함수다 (브라우저 전역 `DadamWorkerPortal`, Node(Jest) 는 module.exports).
 * 뒷부분 start() 는 worker.html 에서만 돈다 (#workerApp 이 있을 때).
 *
 *   - 화면에 넣는 사용자 글(이름 · 제목 · 내용 · 보고 · 사유 · 지역 · 메모)은 전부 esc() 를 거친다
 *   - 현장 주소 · 연락처는 1주차에 어디에도 없다 (★7 공개 기간 미정) — site 가 null 이면 site_note 만 보여 준다
 *   - 금액은 서버가 pay_visible 일 때만 `pay` 를 준다. 화면은 받은 것만 보여 주고 지어 넣지 않는다
 *   - 초대 토큰(#invite=)은 sessionStorage 에 두고 로그인 왕복 뒤 POST /work/claim-invite 로 쓴다
 *   - 사진 · 문제 칩 · 평가는 2주차 (결정 8 · 9 미정) — 1주차 보고는 글만
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamWorkerPortal = api;
  if (typeof document !== 'undefined' && document.getElementById) {
    const boot = () => {
      if (document.getElementById('workerApp')) api.start();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── 이름표 (계약 §1 · §2 의 CHECK 값) ──
  const KINDS = Object.freeze(['install', 'as', 'assembly']);
  const KIND_LABEL = Object.freeze({ install: '설치', as: 'A/S', assembly: '조립 추가 인원' });
  /** 작업자에게 보이는 작업 상태 (effective_status — expired 는 API 가 읽을 때 판정) */
  const JOB_STATUS_LABEL = Object.freeze({
    draft: '준비 중', open: '모집중', expired: '신청 마감', filled: '인원 마감', in_progress: '진행 중',
    review: '검수 중', done: '완료', closed: '종료', cancelled: '취소됨',
  });
  const APP_STATUS_LABEL = Object.freeze({ applied: '신청함', approved: '선정됨', rejected: '선정 안 됨', withdrawn: '철회함' });
  const ASSIGN_STATUS_LABEL = Object.freeze({
    offered: '초대 받음', confirmed: '확정', started: '작업 중', submitted: '완료 보고 · 검수 대기',
    revision: '보완요청', accepted: '완료', declined: '거절함', released: '포기함', removed: '배정 제외',
  });
  const UPDATE_KIND_LABEL = Object.freeze({
    progress: '진행 보고', issue: '문제 보고', result: '완료 보고', correction: '회사 정정', note: '회사 메모',
  });
  const WORKER_STATUS_LABEL = Object.freeze({ pending: '승인 대기', approved: '승인', suspended: '정지', rejected: '반려' });
  const PAY_UNIT_LABEL = Object.freeze({ day: '일', hour: '시간', meter: 'm', job: '건' });
  const TABS = Object.freeze([
    { key: 'open', label: '모집중' },
    { key: 'mine', label: '내 작업' },
    { key: 'done', label: '완료' },
    { key: 'me', label: '내 정보' },
  ]);
  const TAB_KEYS = TABS.map((t) => t.key);

  /** 칩 색 (작업자 쪽 상태) */
  const TONE = Object.freeze({
    open: 'wait', expired: 'off', filled: 'off', in_progress: 'run', review: 'wait', done: 'ok', closed: 'off', cancelled: 'off', draft: 'off',
    applied: 'wait', approved: 'ok', rejected: 'off', withdrawn: 'off',
    offered: 'warn', confirmed: 'ok', started: 'run', submitted: 'wait', revision: 'warn', accepted: 'ok',
    declined: 'off', released: 'off', removed: 'off',
  });

  /**
   * 동의 버전 — workers.consent_version 에 저장된다 (≤40자). 동의 문구(아래 worker.html 신청서)를 바꾸면 올린다.
   * 문구는 결정 13(동의 문구 · 위탁 계약) 전까지 초안이다.
   */
  const CONSENT_VERSION = 'worker-consent-2026-10-20';
  /** 글자 수 상한 — database/work-jobs.sql 의 CHECK 와 같다 */
  const LIMITS = Object.freeze({ name: 30, phone: 30, region: 40, message: 300, body: 1000, reason: 200 });
  /** 서버가 site_note 를 안 줄 때 (계약 §3 JobDetail 의 문구) */
  const SITE_NOTE = '현장 주소·연락처는 공개 기간이 정해지면 열립니다';
  /** sessionStorage 키 — 초대 토큰을 로그인 왕복 동안 보관 */
  const INVITE_KEY = 'dadamWorkerInvite';

  /** 일이 시작된 배정 · 보고할 수 있는 배정 (서버 updates.js 와 같은 조건) */
  const REPORTABLE = Object.freeze(['confirmed', 'started', 'submitted', 'revision', 'accepted']);
  const RESULT_FROM = Object.freeze(['started', 'revision']);
  /** 검수를 거치는 종류 — 공장 조립은 완료 보고로 끝난다 (계약 머리말) */
  const REVIEWED_KINDS = Object.freeze(['install', 'as']);
  const ENDED_JOB = Object.freeze(['closed', 'cancelled']);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /** 초대 토큰 — 서버가 base64url 로 만든다 (claim-invite 는 20~100자만 받는다) */
  const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
  const PHONE_RE = /^[0-9+\-() ]+$/;
  const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  const KST_MS = 9 * 3600 * 1000;
  const DAY_MS = 86400000;

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
  const label = (map, key) => (key ? map[key] || String(key) : '');
  const kindLabel = (k) => label(KIND_LABEL, k);
  const kindsText = (list) => (Array.isArray(list) && list.length ? list.map(kindLabel).join(' · ') : '정하지 않음');
  const trimStr = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const toNum = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? null : Number(n));

  // ── 날짜 (화면은 한국 시간) ──
  function kstParts(iso) {
    const t = Date.parse(iso);
    if (!iso || !Number.isFinite(t)) return null;
    const d = new Date(t + KST_MS);
    return { mo: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  const pad = (n) => String(n).padStart(2, '0');
  function fmtDate(iso) {
    const p = kstParts(iso);
    return p ? `${p.mo}/${p.d}(${WEEKDAY[p.wd]})` : '';
  }
  function fmtTime(iso) {
    const p = kstParts(iso);
    return p ? `${pad(p.h)}:${pad(p.mi)}` : '';
  }
  const fmtDateTime = (iso) => (kstParts(iso) ? `${fmtDate(iso)} ${fmtTime(iso)}` : '');
  /** 작업 일시 — 같은 날이면 '10/21(화) 09:00~18:00', 없으면 '날짜 미정' */
  function fmtRange(startsAt, endsAt) {
    if (!kstParts(startsAt)) return '날짜 미정';
    if (!kstParts(endsAt)) return fmtDateTime(startsAt);
    if (fmtDate(startsAt) === fmtDate(endsAt)) return `${fmtDateTime(startsAt)}~${fmtTime(endsAt)}`;
    return `${fmtDateTime(startsAt)} ~ ${fmtDateTime(endsAt)}`;
  }
  /** 한국 날짜 기준 D-day ('D-1' · 'D-day' · 'D+2'), 날짜 없으면 '' */
  function ddayLabel(iso, nowMs) {
    const t = Date.parse(iso);
    if (!iso || !Number.isFinite(t)) return '';
    const day = (ms) => Math.floor((ms + KST_MS) / DAY_MS);
    const diff = day(t) - day(Number.isFinite(nowMs) ? nowMs : Date.now());
    if (diff === 0) return 'D-day';
    return diff > 0 ? `D-${diff}` : `D+${-diff}`;
  }

  // ── 주소 · 로그인 ──
  /**
   * 주소 # 뒤를 읽는다. 'invite=<토큰>' · 'job=<uuid>' · 'tab=open|mine|done|me' (여럿이면 & 로 잇는다).
   * 형식이 틀린 job 은 badJob 으로 알려 준다 (잘못된 링크 안내).
   */
  function parseHash(hash) {
    const out = { invite: null, job: null, tab: null, badJob: false };
    String(hash || '').replace(/^#/, '').split('&').forEach((part) => {
      const i = part.indexOf('=');
      if (i <= 0) return;
      const key = part.slice(0, i);
      let val = part.slice(i + 1);
      try {
        val = decodeURIComponent(val);
      } catch (e) {
        if (key === 'job') out.badJob = true;
        return;
      }
      if (key === 'invite' && TOKEN_RE.test(val)) out.invite = val;
      else if (key === 'job') {
        if (UUID_RE.test(val)) out.job = val.toLowerCase();
        else out.badJob = true;
      } else if (key === 'tab' && TAB_KEYS.includes(val)) out.tab = val;
    });
    return out;
  }

  /** 로그인 뒤 돌아올 곳 — 같은 사이트 상대 경로 (login.html 이 *.html + #… 만 받는다, 계약 §5) */
  function returnTarget(route, invite) {
    const r = route || {};
    if (invite && TOKEN_RE.test(invite)) return `worker.html#invite=${invite}`;
    if (r.job && UUID_RE.test(r.job)) return `worker.html#job=${r.job}`;
    if (r.tab && TAB_KEYS.includes(r.tab)) return `worker.html#tab=${r.tab}`;
    return 'worker.html';
  }
  const loginHref = (target) => `login.html?redirect=${encodeURIComponent(target || 'worker.html')}`;

  /**
   * 보여 줄 화면 (계약 §4): 미로그인 → login / 표 없음 → not_ready / 작업자 행 없음 → register /
   * pending · rejected · suspended · approved. API 주소나 Supabase 가 없으면 no_api.
   */
  function selectView(s) {
    const st = s || {};
    if (!st.apiReady) return 'no_api';
    if (!st.session) return 'login';
    const me = st.me;
    if (!me || me.ready === false) return 'not_ready';
    const w = me.worker;
    if (!w) return 'register';
    if (w.status === 'approved') return 'approved';
    if (w.status === 'rejected') return 'rejected';
    if (w.status === 'suspended') return 'suspended';
    return 'pending';
  }

  /** 승인 작업자가 처음 볼 탭 — 주소에 탭이 있으면 그것, 아니면 내 작업이 있으면 내 작업 */
  function defaultTab(route, counts) {
    if (route && route.tab && TAB_KEYS.includes(route.tab)) return route.tab;
    return counts && Number(counts.mine) > 0 ? 'mine' : 'open';
  }

  // ── 신청서 ──
  /**
   * 신청서 값 → 요청 본문 + 오류 목록 (계약 §3 POST /work/register · /work/claim-invite).
   * 초대로 오면 token 을 붙인다 — 초대에 정해진 작업 종류가 있으면 서버가 그것을 우선한다.
   * 동의 버전은 workers.consent_version(NOT NULL) 이라 초대로 와도 보낸다.
   */
  function registrationBody(values, invite) {
    const v = values || {};
    const errors = [];
    const name = trimStr(v.display_name);
    if (!name) errors.push('이름을 적어 주세요.');
    else if (name.length > LIMITS.name) errors.push(`이름은 ${LIMITS.name}자 이하로 적어 주세요.`);
    const phone = trimStr(v.phone);
    if (phone && (phone.length > LIMITS.phone || !PHONE_RE.test(phone))) errors.push('휴대폰은 숫자와 - 만 적어 주세요.');
    const kinds = [];
    (Array.isArray(v.kinds) ? v.kinds : []).forEach((k) => {
      if (KINDS.includes(k) && !kinds.includes(k)) kinds.push(k);
    });
    if (!invite && !kinds.length) errors.push('작업 종류를 하나 이상 골라 주세요.');
    const region = trimStr(v.region_label);
    if (region.length > LIMITS.region) errors.push(`활동 지역은 ${LIMITS.region}자 이하로 적어 주세요.`);
    if (v.consent !== true) errors.push('개인정보 수집·이용에 동의해야 신청할 수 있습니다.');
    const body = {
      display_name: name,
      phone: phone || null,
      kinds,
      region_label: region || null,
      consent_version: CONSENT_VERSION,
      photo_consent: v.photo_consent === true,
    };
    if (invite) body.token = invite;
    return { body, errors };
  }

  // ── 조각 HTML ──
  const chip = (text, tone) => (text ? `<span class="chip t-${esc(tone || 'off')}">${esc(text)}</span>` : '');
  const kindChip = (k) => (k ? `<span class="chip k-${esc(k)}">${esc(kindLabel(k))}</span>` : '');

  /** 금액 — 서버가 준 pay 만 ('150,000원 / 일'). 없으면 '' */
  function payText(pay) {
    if (!pay) return '';
    const n = toNum(pay.amount);
    if (n === null) return '';
    const unit = pay.unit ? PAY_UNIT_LABEL[pay.unit] || String(pay.unit) : '';
    return `${n.toLocaleString('ko-KR')}원${unit ? ` / ${unit}` : ''}`;
  }
  const slotsText = (c) => `확정 ${toNum(c && c.filled) || 0}/${toNum(c && c.slots) || 0}명`;

  /** 카드의 내 상태 — 배정 > 신청 > 작업 상태 */
  function myStatus(c) {
    const my = (c && c.my) || {};
    if (my.assignment_status) return { key: my.assignment_status, text: label(ASSIGN_STATUS_LABEL, my.assignment_status), tone: TONE[my.assignment_status] };
    if (my.application_status) return { key: my.application_status, text: label(APP_STATUS_LABEL, my.application_status), tone: TONE[my.application_status] };
    const eff = (c && (c.effective_status || c.status)) || '';
    return { key: eff, text: label(JOB_STATUS_LABEL, eff), tone: TONE[eff] };
  }

  /** 작업 카드 (목록 한 줄). 누르면 #job=<id> 로 상세 */
  function jobCardHtml(c, nowMs) {
    if (!c || !isUuid(c.id)) return '';
    const st = myStatus(c);
    const dday = ddayLabel(c.starts_at, nowMs);
    const pay = payText(c.pay);
    return `<a class="card job" href="#job=${esc(c.id)}">` +
      `<div class="chips">${kindChip(c.kind)}${chip(st.text, st.tone)}${dday ? chip(dday, 'dday') : ''}</div>` +
      `<div class="jt">${esc(c.title)}</div>` +
      `<div class="jd">${esc(fmtRange(c.starts_at, c.ends_at))}${c.region_label ? ` · ${esc(c.region_label)}` : ''}</div>` +
      `<div class="jd">${esc(slotsText(c))}${pay ? ` · ${esc(pay)}` : ''}</div>` +
      '</a>';
  }

  const EMPTY_TEXT = Object.freeze({
    open: '지금 모집 중인 작업이 없습니다. 내 작업 종류에 맞는 작업만 보입니다.',
    mine: '확정되거나 진행 중인 작업이 없습니다. 초대를 받으면 여기에 나옵니다.',
    done: '끝난 작업이 없습니다.',
  });
  function jobListHtml(items, tab, nowMs) {
    const list = (items || []).map((c) => jobCardHtml(c, nowMs)).filter(Boolean);
    if (!list.length) return `<div class="card empty">${esc(EMPTY_TEXT[tab] || '작업이 없습니다.')}</div>`;
    return list.join('');
  }

  /**
   * 탭 줄 — 모집중 · 내 작업 건수 (GET /work/me counts). 보완요청 · 새 소식은 탭 아래 한 줄로
   * (탭 칸에 넣으면 375px 에서 칸이 세 줄로 늘어난다).
   */
  function tabsHtml(active, counts) {
    const c = counts || {};
    const tabs = TABS.map((t) => {
      let n = '';
      if (t.key === 'open' && toNum(c.open)) n = `<span class="n">${esc(toNum(c.open))}</span>`;
      if (t.key === 'mine' && toNum(c.mine)) n = `<span class="n">${esc(toNum(c.mine))}</span>`;
      const on = t.key === active;
      return `<a href="#tab=${t.key}" class="tab${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''}><span>${esc(t.label)}</span>${n}</a>`;
    }).join('');
    const notes = [];
    if (toNum(c.revision)) notes.push(`보완요청 ${esc(toNum(c.revision))}건`);
    if (toNum(c.newEvents)) notes.push(`새 소식 ${esc(toNum(c.newEvents))}건`);
    return tabs + (notes.length ? `<a href="#tab=mine" class="tab-note">${notes.join(' · ')} — 내 작업에서 확인하세요</a>` : '');
  }

  /**
   * 작업 상세에서 할 수 있는 일 (서버 조건과 같다 — 계약 §3).
   *   apply: 신청 · 배정이 없고 모집중 / withdraw: 신청 대기 / confirm · decline: 초대 받음 /
   *   start: 확정 / release: 확정 · 작업 중 / reports: progress · issue 는 확정 이후 언제든(끝난 뒤 추가 보고 포함),
   *   result 는 작업 중 · 보완요청에서만. 닫히거나 취소된 작업에는 아무것도 못 한다.
   */
  function availableActions(d) {
    const out = { apply: false, withdraw: false, confirm: false, decline: false, start: false, release: false, reports: [] };
    if (!d) return out;
    const my = d.my || {};
    const a = my.assignment_status || null;
    const app = my.application_status || null;
    const eff = d.effective_status || d.status || '';
    if (ENDED_JOB.includes(eff)) return out;
    if (!a && !app && eff === 'open') out.apply = true;
    if (app === 'applied' && isUuid(my.application_id)) out.withdraw = true;
    if (isUuid(my.assignment_id)) {
      if (a === 'offered') {
        out.confirm = true;
        out.decline = true;
      }
      if (a === 'confirmed') out.start = true;
      if (a === 'confirmed' || a === 'started') out.release = true;
      if (REPORTABLE.includes(a)) out.reports = RESULT_FROM.includes(a) ? ['progress', 'issue', 'result'] : ['progress', 'issue'];
    }
    return out;
  }

  /** 내 상태 한 줄 설명 */
  function stateText(d) {
    const my = (d && d.my) || {};
    const eff = (d && (d.effective_status || d.status)) || '';
    if (eff === 'cancelled') return '취소된 작업입니다.';
    if (eff === 'closed') return '종료된 작업입니다.';
    switch (my.assignment_status) {
      case 'offered': return '회사가 이 작업을 맡아 달라고 초대했습니다. 수락하면 확정됩니다.';
      case 'confirmed': return '확정됐습니다. 작업을 시작할 때 「작업 시작」을 눌러 주세요.';
      case 'started': return '작업 중입니다. 진행 상황이나 문제가 있으면 보고하고, 끝나면 완료 보고를 보내 주세요.';
      case 'submitted': return '완료 보고를 보냈습니다. 회사 검수를 기다리는 중입니다.';
      case 'revision': return '회사가 보완을 요청했습니다. 아래 기록을 확인하고 다시 완료 보고를 보내 주세요.';
      case 'accepted': return '완료된 작업입니다. 더 알릴 내용이 있으면 추가로 보고할 수 있습니다.';
      case 'declined': return '초대를 거절했습니다.';
      case 'released': return '이 작업을 포기했습니다.';
      case 'removed': return '이 작업 배정에서 제외됐습니다.';
      default: break;
    }
    switch (my.application_status) {
      case 'applied': return '신청했습니다. 회사가 신청자 중에서 골라 확정하면 「내 작업」에 나옵니다.';
      case 'approved': return '선정됐습니다.';
      case 'rejected': return '이번 작업에는 선정되지 않았습니다.';
      case 'withdrawn': return '신청을 철회했습니다.';
      default: break;
    }
    if (eff === 'open') return '신청하면 회사가 신청자 중에서 골라 확정합니다.';
    return '지금은 신청할 수 없는 작업입니다.';
  }

  /** 기록 타임라인 — 작업자 보고와 회사 정정 · 메모가 덮어쓰지 않고 쌓인다 (★5 가 · 나) */
  function timelineHtml(list) {
    const rows = Array.isArray(list) ? list.filter(Boolean) : [];
    if (!rows.length) return '<p class="muted">아직 기록이 없습니다.</p>';
    const byId = new Map(rows.map((u) => [u.id, u]));
    return `<ol class="tl">${rows.map((u) => {
      const company = u.author_role === 'company';
      const head = company
        ? chip(u.kind === 'correction' ? '회사 정정' : '회사 메모', u.kind === 'correction' ? 'warn' : 'wait')
        : chip(`내 보고 · ${label(UPDATE_KIND_LABEL, u.kind)}`, u.kind === 'issue' ? 'warn' : 'ok');
      let amends = '';
      if (u.amends_id) {
        const orig = byId.get(u.amends_id);
        const what = orig ? `${label(UPDATE_KIND_LABEL, orig.kind)} ${fmtDateTime(orig.created_at)}` : '이전 기록';
        amends = `<div class="tl-amends">${esc(what)} 을(를) 바로잡은 기록입니다 — 원래 기록은 그대로 남아 있습니다.</div>`;
      }
      const chips = Array.isArray(u.issue_chips) && u.issue_chips.length
        ? `<div class="chips">${u.issue_chips.map((c) => chip(c, 'off')).join('')}</div>` : '';
      return `<li class="tl-item${company ? ' tl-co' : ''}">` +
        `<div class="tl-h">${head}<span class="muted">${esc(fmtDateTime(u.created_at))}</span></div>` +
        `${amends}<div class="tl-b">${esc(u.body)}</div>${chips}</li>`;
    }).join('')}</ol>`;
  }

  /** 보고 양식 (글만 — 사진은 2주차) */
  function reportFormHtml(d, kinds) {
    const id = d.my.assignment_id;
    const radios = kinds.map((k, i) =>
      `<label class="radio"><input type="radio" name="kind" value="${esc(k)}"${i === 0 ? ' checked' : ''}> ${esc(UPDATE_KIND_LABEL[k])}</label>`).join('');
    const resultNote = kinds.includes('result')
      ? `<p class="muted">${REVIEWED_KINDS.includes(d.kind)
        ? '완료 보고를 보내면 회사가 검수한 뒤 완료로 바뀝니다.'
        : '완료 보고를 보내면 바로 완료로 기록됩니다.'}</p>` : '';
    return `<form data-form="report" data-id="${esc(id)}" class="stack">` +
      `<fieldset class="radios"><legend>보고 종류</legend>${radios}</fieldset>` +
      `<label for="reportBody">내용 (${LIMITS.body}자 이내)</label>` +
      `<textarea id="reportBody" name="body" rows="4" maxlength="${LIMITS.body}" required></textarea>` +
      `${resultNote}<p class="muted">사진 올리기는 준비 중입니다. 지금은 글로 보고해 주세요.</p>` +
      '<button type="submit" class="big go">보고 보내기</button></form>';
  }

  /** 내 상태 + 할 수 있는 일 */
  function actionsHtml(d) {
    const act = availableActions(d);
    const my = d.my || {};
    const parts = [`<p>${esc(stateText(d))}</p>`];
    if (act.apply) {
      parts.push('<form data-form="apply" class="stack">' +
        `<label for="applyMsg">회사에 남길 말 (선택, ${LIMITS.message}자 이내)</label>` +
        `<textarea id="applyMsg" name="message" rows="3" maxlength="${LIMITS.message}"></textarea>` +
        '<button type="submit" class="big go">이 작업 신청하기</button></form>');
    }
    if (act.withdraw) parts.push(`<button type="button" class="big" data-act="withdraw" data-id="${esc(my.application_id)}">신청 철회</button>`);
    if (act.confirm) parts.push(`<button type="button" class="big go" data-act="confirm" data-id="${esc(my.assignment_id)}">수락하기</button>`);
    if (act.decline) {
      parts.push('<details class="fold"><summary>거절하기</summary>' +
        `<form data-form="decline" data-id="${esc(my.assignment_id)}" class="stack">` +
        `<label for="declineReason">사유 (선택, ${LIMITS.reason}자 이내)</label>` +
        `<textarea id="declineReason" name="reason" rows="2" maxlength="${LIMITS.reason}"></textarea>` +
        '<button type="submit" class="big stop">초대 거절</button></form></details>');
    }
    if (act.start) parts.push(`<button type="button" class="big go" data-act="start" data-id="${esc(my.assignment_id)}">작업 시작</button>`);
    if (act.reports.length) parts.push(reportFormHtml(d, act.reports));
    if (act.release) {
      parts.push('<details class="fold danger"><summary>작업 포기</summary>' +
        `<form data-form="release" data-id="${esc(my.assignment_id)}" class="stack">` +
        `<label for="releaseReason">포기 사유 (필수, ${LIMITS.reason}자 이내)</label>` +
        `<textarea id="releaseReason" name="reason" rows="2" maxlength="${LIMITS.reason}" required></textarea>` +
        '<button type="submit" class="big stop">포기하기</button></form></details>');
    }
    return parts.join('');
  }

  /** 작업 상세 (#job=<id>) */
  function jobDetailHtml(d, nowMs, backTab) {
    if (!d) return '';
    const st = myStatus(d);
    const eff = d.effective_status || d.status || '';
    const dday = ddayLabel(d.starts_at, nowMs);
    const pay = payText(d.pay);
    const facts = [
      ['일시', `${fmtRange(d.starts_at, d.ends_at)}${dday ? ` (${dday})` : ''}`],
      ['지역', d.region_label || '정해지지 않음'],
      ['인원', slotsText(d)],
    ];
    if (d.apply_deadline) facts.push(['신청 마감', fmtDateTime(d.apply_deadline)]);
    if (pay) facts.push(['금액', pay]);
    if (d.order_no) facts.push(['주문번호', d.order_no]);
    if (d.customer_masked) facts.push(['고객', d.customer_masked]);
    const back = TAB_KEYS.includes(backTab) ? backTab : 'open';
    // site 는 1주차에 늘 null — 주소 · 연락처를 그리지 않는다 (공개 기간 ★7 미정)
    const site = d.site == null ? `<p class="site-note">${esc(d.site_note || SITE_NOTE)}</p>` : '';
    const showTimeline = !!(d.my && d.my.assignment_id) || (Array.isArray(d.timeline) && d.timeline.length);
    return `<a class="back" href="#tab=${back}">← 목록으로</a>` +
      '<div class="card">' +
      `<div class="chips">${kindChip(d.kind)}${chip(label(JOB_STATUS_LABEL, eff), TONE[eff])}${st.key !== eff ? chip(st.text, st.tone) : ''}</div>` +
      `<h2 class="jt">${esc(d.title)}</h2>` +
      `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` +
      `${d.detail ? `<div class="detail-text">${esc(d.detail)}</div>` : ''}${site}</div>` +
      `<div class="card"><h3>내 상태</h3>${actionsHtml(d)}</div>` +
      (showTimeline ? `<div class="card"><h3>작업 기록</h3><p class="muted">내 보고와 회사 정정 · 메모가 고쳐지지 않고 차례로 쌓입니다.</p>${timelineHtml(d.timeline)}</div>` : '');
  }

  /** 내 정보 탭 (WorkerSelf) */
  function workerInfoHtml(w) {
    if (!w) return '';
    const rows = [
      ['이름', w.display_name],
      ['휴대폰', w.phone || '적지 않음'],
      ['작업 종류', kindsText(w.kinds)],
      ['활동 지역', w.region_label || '적지 않음'],
      ['상태', label(WORKER_STATUS_LABEL, w.status)],
      ['사진 동의', w.photo_consent ? '동의함' : '동의하지 않음'],
      ['동의 버전', w.consent_version || '-'],
    ];
    return '<div class="card"><h3>내 정보</h3>' +
      `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` +
      '<p class="muted">받은 정보: 이름 · 휴대폰(선택) · 작업 종류 · 활동 지역. 주민등록번호 · 계좌는 받지 않습니다.</p>' +
      '<p class="muted">이 화면에서는 아직 정보를 고칠 수 없습니다. 바꿀 내용은 회사에 알려 주세요.</p>' +
      '<div class="btns"><a class="big" href="mypage.html">마이페이지</a><button type="button" class="big" data-act="logout">로그아웃</button></div>' +
      '</div>';
  }

  /** 신청 대기 화면의 내 신청 정보 */
  function pendingInfoHtml(w) {
    if (!w) return '';
    const rows = [
      ['이름', w.display_name],
      ['작업 종류', kindsText(w.kinds)],
      ['활동 지역', w.region_label || '적지 않음'],
    ];
    return `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  }

  // ── 초대 토큰 보관 (sessionStorage — 탭을 닫으면 사라진다) ──
  function storeInvite(token) {
    try {
      if (token) sessionStorage.setItem(INVITE_KEY, token);
      else sessionStorage.removeItem(INVITE_KEY);
    } catch (e) { /* 저장소를 못 쓰면 이번 화면에서만 */ }
  }
  function loadInvite() {
    try {
      const v = sessionStorage.getItem(INVITE_KEY);
      return v && TOKEN_RE.test(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  // ── 화면 (worker.html 에서만) ──
  function start() {
    const $ = (id) => document.getElementById(id);
    const cfg = (typeof window !== 'undefined' && window.DADAM_CONFIG) || {};
    const API = (cfg.workflowApi && cfg.workflowApi.url) || '';
    const VIEWS = ['viewLoading', 'viewLogin', 'viewRegister', 'viewPending', 'viewRejected', 'viewSuspended', 'viewNotReady', 'viewError', 'viewApp'];
    let sb = null;
    let me = null;
    let route = parseHash(location.hash);
    let invite = null;
    let currentTab = 'open';
    let currentJob = null;
    let seq = 0;
    let alertTimer = null;

    try {
      if (window.supabase && cfg.supabase) sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey);
    } catch (e) {
      sb = null;
    }

    function show(id) {
      VIEWS.forEach((v) => {
        const el = $(v);
        if (el) el.hidden = v !== id;
      });
    }
    function say(msg, ok) {
      const a = $('alert');
      if (!a) return;
      clearTimeout(alertTimer);
      a.textContent = msg;
      a.className = `alert ${ok ? 'ok' : 'err'}`;
      a.hidden = !msg;
      if (ok) alertTimer = setTimeout(() => { a.hidden = true; }, 3000);
    }
    function sub(text) {
      $('sub').textContent = text;
    }

    async function token() {
      if (!sb) return null;
      const r = await sb.auth.getSession();
      return (r && r.data && r.data.session && r.data.session.access_token) || null;
    }
    async function api(path, opts) {
      const o = opts || {};
      const t = await token();
      if (!t) {
        const err = new Error('로그인이 필요합니다.');
        err.status = 401;
        throw err;
      }
      const h = { Authorization: `Bearer ${t}` };
      if (o.body) h['Content-Type'] = 'application/json';
      const res = await fetch(API + path, { method: o.method || 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined, cache: 'no-store' });
      let body = null;
      try {
        body = await res.json();
      } catch (e) {
        body = null;
      }
      if (!res.ok || !body || !body.success) {
        const err = new Error((body && body.message) || `요청 실패 (${res.status})`);
        err.status = res.status;
        throw err;
      }
      return body.data;
    }

    function showLogin() {
      const target = returnTarget(route, invite);
      $('loginLink').href = loginHref(target);
      $('loginInviteNote').hidden = !invite;
      sub('로그인이 필요합니다');
      show('viewLogin');
    }

    function showRegister() {
      $('regInviteNote').hidden = !invite;
      $('regTitle').textContent = invite ? '초대 링크로 작업자 신청' : '작업자 신청';
      $('regKindsHint').textContent = invite ? '(초대에 작업 종류가 정해져 있으면 그 종류로 등록됩니다)' : '(하나 이상)';
      $('regConsentVersion').textContent = CONSENT_VERSION;
      sub('작업자 신청서');
      show('viewRegister');
    }

    function renderWorkerState() {
      const view = selectView({ apiReady: !!(API && sb), session: true, me });
      const w = me && me.worker;
      if (view === 'not_ready') {
        sub('준비 중');
        show('viewNotReady');
      } else if (view === 'register') {
        showRegister();
      } else if (view === 'pending') {
        sub(`${w.display_name} 님 · 승인 대기`);
        $('pendingInfo').innerHTML = pendingInfoHtml(w);
        show('viewPending');
      } else if (view === 'rejected') {
        sub(`${w.display_name} 님`);
        $('rejectReason').textContent = w.reject_reason ? `사유: ${w.reject_reason}` : '';
        show('viewRejected');
      } else if (view === 'suspended') {
        sub(`${w.display_name} 님`);
        show('viewSuspended');
      } else if (view === 'approved') {
        sub(`${w.display_name} 님 · ${kindsText(w.kinds)}`);
        show('viewApp');
        route = parseHash(location.hash);
        renderRoute();
      }
    }

    async function refreshMe() {
      me = await api('/work/me');
      return me;
    }

    function renderTabs(active) {
      $('tabs').innerHTML = tabsHtml(active, me && me.counts);
    }

    async function renderRoute() {
      const mySeq = ++seq;
      const body = $('appBody');
      window.scrollTo(0, 0);
      if (route.badJob) {
        currentJob = null;
        renderTabs(null);
        body.innerHTML = `<a class="back" href="#tab=${currentTab}">← 목록으로</a><div class="card empty">작업 링크가 올바르지 않습니다.</div>`;
        return;
      }
      if (route.job) {
        currentJob = route.job;
        renderTabs(null);
        body.innerHTML = '<div class="card empty">불러오는 중…</div>';
        try {
          const d = await api(`/work/jobs/${route.job}`);
          if (mySeq !== seq) return;
          body.innerHTML = jobDetailHtml(d, Date.now(), currentTab);
        } catch (err) {
          if (mySeq !== seq) return;
          if (await handleAuthError(err)) return;
          const msg = err.status === 404 ? '작업을 찾을 수 없습니다. 마감됐거나 볼 수 없는 작업입니다.' : err.message;
          body.innerHTML = `<a class="back" href="#tab=${currentTab}">← 목록으로</a><div class="card empty">${esc(msg)}</div>`;
        }
        return;
      }
      currentJob = null;
      currentTab = defaultTab(route, me && me.counts);
      renderTabs(currentTab);
      if (currentTab === 'me') {
        body.innerHTML = workerInfoHtml(me && me.worker);
        return;
      }
      body.innerHTML = '<div class="card empty">불러오는 중…</div>';
      try {
        const data = await api(`/work/jobs?tab=${currentTab}`);
        if (mySeq !== seq) return;
        body.innerHTML = jobListHtml(data && data.items, currentTab, Date.now());
        // 내 작업을 열면 서버가 새 소식을 읽음으로 센다 — 배지를 다시 받는다
        if (currentTab === 'mine' && me && me.counts && toNum(me.counts.newEvents)) {
          refreshMe().then(() => { if (mySeq === seq) renderTabs(currentTab); }).catch(() => {});
        }
      } catch (err) {
        if (mySeq !== seq) return;
        if (await handleAuthError(err)) return;
        body.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
      }
    }

    /** 로그인 만료(401) · 자격 변경(403) — 처음 화면부터 다시 */
    async function handleAuthError(err) {
      if (err.status === 401) {
        showLogin();
        return true;
      }
      if (err.status === 403) {
        try {
          await refreshMe();
        } catch (e) {
          say(e.message);
          return true;
        }
        // 자격이 그대로면 다시 그리지 않는다 (같은 403 이 되풀이되지 않게) — 부르는 쪽이 오류 문구를 보여 준다
        if (me && me.worker && me.worker.status === 'approved') return false;
        renderWorkerState();
        return true;
      }
      return false;
    }

    /** 버튼을 잠그고 요청 → 성공 문구 → 상세 · 건수 다시 받기 */
    async function act(fn, okMsg) {
      const box = $('appBody');
      const controls = box.querySelectorAll('button, textarea, input');
      controls.forEach((c) => { c.disabled = true; });
      try {
        await fn();
        say(okMsg, true);
        try {
          await refreshMe();
        } catch (e) { /* 건수는 다음에 */ }
        await renderRoute();
      } catch (err) {
        controls.forEach((c) => { c.disabled = false; });
        if (await handleAuthError(err)) return;
        say(err.message);
      }
    }

    async function boot() {
      route = parseHash(location.hash);
      if (route.invite) storeInvite(route.invite);
      invite = loadInvite();
      if (!API || !sb) {
        $('errorText').textContent = '서비스에 연결할 수 없습니다. 잠시 뒤 다시 열어 주세요.';
        sub('연결 오류');
        show('viewError');
        return;
      }
      let session = null;
      try {
        const r = await sb.auth.getSession();
        session = r && r.data && r.data.session;
      } catch (e) {
        session = null;
      }
      if (!session) {
        showLogin();
        return;
      }
      // 로그인했으면 토큰은 sessionStorage 에만 둔다 — 주소창 · 방문 기록에서 지운다
      if (route.invite) history.replaceState(null, '', location.pathname + location.search);
      try {
        await refreshMe();
      } catch (err) {
        if (err.status === 401) {
          showLogin();
          return;
        }
        $('errorText').textContent = err.message;
        sub('오류');
        show('viewError');
        return;
      }
      if (me && me.worker && invite) {
        // 이미 작업자면 초대 링크는 쓰지 않는다 (서버도 409)
        storeInvite(null);
        invite = null;
        say('이미 작업자로 등록돼 있어 초대 링크는 쓰지 않았습니다.', true);
      }
      renderWorkerState();
    }

    // ── 신청서 ──
    $('regForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const values = {
        display_name: f.elements.display_name.value,
        phone: f.elements.phone.value,
        kinds: Array.from(f.querySelectorAll('input[data-kind]:checked')).map((x) => x.value),
        region_label: f.elements.region_label.value,
        consent: f.elements.consent.checked,
        photo_consent: f.elements.photo_consent.checked,
      };
      const { body, errors } = registrationBody(values, invite);
      if (errors.length) {
        say(errors.join(' '));
        return;
      }
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const worker = await api(invite ? '/work/claim-invite' : '/work/register', { method: 'POST', body });
        storeInvite(null);
        invite = null;
        me = { ready: true, worker, counts: (me && me.counts) || {} };
        say('신청을 받았습니다.', true);
        renderWorkerState();
      } catch (err) {
        if (err.status === 401) {
          showLogin();
        } else if (invite && (err.status === 410 || err.status === 404)) {
          // 만료 · 사용된 초대 — 공개 신청으로 이어 쓸 수 있다 (둘 다 승인 전까지 대기, ★3)
          storeInvite(null);
          invite = null;
          showRegister();
          say(`${err.message} 아래 신청서로 신청할 수 있습니다.`);
        } else if (err.status === 409) {
          say(err.message);
          try {
            await refreshMe();
            renderWorkerState();
          } catch (e2) { /* 그대로 둔다 */ }
        } else {
          say(err.message);
        }
      } finally {
        btn.disabled = false;
      }
    });

    $('pendingRefresh').addEventListener('click', async () => {
      try {
        await refreshMe();
        renderWorkerState();
      } catch (err) {
        say(err.message);
      }
    });

    // ── 작업 상세 · 내 정보 ──
    const appBody = $('appBody');
    appBody.addEventListener('submit', (e) => {
      const form = e.target.closest('form[data-form]');
      if (!form) return;
      e.preventDefault();
      const kind = form.getAttribute('data-form');
      const id = form.getAttribute('data-id');
      const text = (name) => trimStr(form.elements[name] && form.elements[name].value);
      if (kind === 'apply') {
        if (!currentJob) return;
        const message = text('message');
        act(() => api(`/work/jobs/${currentJob}/apply`, { method: 'POST', body: message ? { message } : {} }), '신청했습니다.');
      } else if (kind === 'decline') {
        if (!isUuid(id)) return;
        const reason = text('reason');
        act(() => api(`/work/assignments/${id}/decline`, { method: 'POST', body: reason ? { reason } : {} }), '초대를 거절했습니다.');
      } else if (kind === 'release') {
        if (!isUuid(id)) return;
        const reason = text('reason');
        if (!reason) {
          say('포기 사유를 적어 주세요.');
          return;
        }
        if (!window.confirm('이 작업을 포기할까요? 되돌릴 수 없습니다.')) return;
        act(() => api(`/work/assignments/${id}/release`, { method: 'POST', body: { reason } }), '작업을 포기했습니다.');
      } else if (kind === 'report') {
        if (!isUuid(id)) return;
        const checked = form.querySelector('input[name="kind"]:checked');
        const reportKind = checked ? checked.value : '';
        const body = text('body');
        if (!body) {
          say('보고 내용을 적어 주세요.');
          return;
        }
        if (reportKind === 'result' && !window.confirm('완료 보고를 보낼까요?')) return;
        act(() => api(`/work/assignments/${id}/updates`, { method: 'POST', body: { kind: reportKind, body } }),
          reportKind === 'result' ? '완료 보고를 보냈습니다.' : '보고를 보냈습니다.');
      }
    });
    appBody.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const what = b.getAttribute('data-act');
      const id = b.getAttribute('data-id');
      if (what === 'logout') {
        Promise.resolve(sb && sb.auth.signOut()).catch(() => {}).then(() => location.reload());
        return;
      }
      if (!isUuid(id)) return;
      if (what === 'withdraw') {
        if (!window.confirm('신청을 철회할까요?')) return;
        act(() => api(`/work/applications/${id}/withdraw`, { method: 'POST', body: {} }), '신청을 철회했습니다.');
      } else if (what === 'confirm') {
        act(() => api(`/work/assignments/${id}/confirm`, { method: 'POST', body: {} }), '수락했습니다. 확정됐습니다.');
      } else if (what === 'start') {
        act(() => api(`/work/assignments/${id}/start`, { method: 'POST', body: {} }), '작업을 시작했습니다.');
      }
    });

    window.addEventListener('hashchange', () => {
      const next = parseHash(location.hash);
      if (next.invite) {
        // 로그인한 채로 다른 초대 링크를 열었다 — 처음부터 다시
        boot();
        return;
      }
      route = next;
      if (me && me.worker && me.worker.status === 'approved' && !$('viewApp').hidden) renderRoute();
    });

    boot();
  }

  return Object.freeze({
    KINDS,
    KIND_LABEL,
    JOB_STATUS_LABEL,
    APP_STATUS_LABEL,
    ASSIGN_STATUS_LABEL,
    UPDATE_KIND_LABEL,
    WORKER_STATUS_LABEL,
    PAY_UNIT_LABEL,
    TABS,
    CONSENT_VERSION,
    LIMITS,
    SITE_NOTE,
    INVITE_KEY,
    esc,
    fmtDate,
    fmtTime,
    fmtDateTime,
    fmtRange,
    ddayLabel,
    parseHash,
    returnTarget,
    loginHref,
    selectView,
    defaultTab,
    registrationBody,
    payText,
    myStatus,
    jobCardHtml,
    jobListHtml,
    tabsHtml,
    availableActions,
    stateText,
    timelineHtml,
    jobDetailHtml,
    workerInfoHtml,
    pendingInfoHtml,
    storeInvite,
    loadInvite,
    start,
  });
});
