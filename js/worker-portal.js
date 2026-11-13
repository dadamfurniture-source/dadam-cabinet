/**
 * 작업자 포털 (worker.html) — 상태별 화면 · 작업 목록 · 작업 상세 · 글 보고.
 * 계약: docs/01-plan/worker-portal-contract.md §3 작업자 API · §4 화면.
 *
 * 앞부분은 순수 함수다 (브라우저 전역 `DadamWorkerPortal`, Node(Jest) 는 module.exports).
 * 뒷부분 start() 는 #workerApp 이 있는 페이지에서만 돈다 — worker.html 과 앱 「작업」 탭 (본문은 둘이 같다).
 * 로그인 뒤 돌아올 곳 · 로그인 주소는 #workerApp 의 data-page · data-login (없으면 worker.html · login.html).
 *
 *   - 화면에 넣는 사용자 글(이름 · 제목 · 내용 · 보고 · 사유 · 지역 · 메모)은 전부 esc() 를 거친다
 *   - 현장 주소 · 층 · 출입 · 현장 연락처는 서버가 site 를 줄 때만 그린다 — 내가 수락한 때부터 작업이 끝나고 7일까지
 *     (2026-11-13 결정 ⑤, 서버 work/reveal.js siteOpenFor). site 가 null 이면 site_note 만 보여 준다.
 *     받은 현장 정보는 화면에만 그린다 — 기기 저장 · 주소에 싣지 않는다
 *   - 금액은 서버가 pay_visible 일 때만 `pay` 를 준다. 화면은 받은 것만 보여 주고 지어 넣지 않는다
 *   - 초대 토큰(#invite=)은 sessionStorage 에 두고 로그인 왕복 뒤 POST /work/claim-invite 로 쓴다
 *   - 사진 · 문제 칩 · 평가는 2주차 (결정 8 · 9 미정) — 1주차 보고는 글만
 *
 * 1주차 후속 (2026-10-20, 계약 머리 "1주차 후속" 절):
 *   - 0 지원 종료일: apply_deadline 을 "지원 종료일" 이라 부른다. 모집중 카드 한 줄 · 상세 사실 행 · 꼬리표(D-n · 오늘 종료 · 지원 종료),
 *     화면 시각으로 지났으면 신청 버튼을 잠그고 "지원 종료". 서버 409 문구는 그대로 보여 준다
 *   - C: 지난 작업(완료) 탭에서 거절(declined) 배정의 release_reason — 작업 닫기 · 취소로 끝난 초대 안내 포함
 *   - D: 정지(suspended) 작업자는 같은 앱 화면 + 맨 위 안내. 모집중 탭 · 신청 · 초대 수락 버튼만 숨긴다
 *
 * 공장 (2026-11-01, 서버 work/factory.js · DB 0024):
 *   - 작업자 종류에 재단 · 엣지 (공장 조립은 조립). 작업(모집) 종류는 그대로 셋
 *   - 「공장」 탭: 승인된 작업자가 공장에 배정됐거나(GET /work/me 의 factory), 이 기기에 생산 링크가 있을 때만.
 *     생산 링크 화면(production-worker.html)과 같은 일 — 오늘 지시 체크 · 공정별 할 일 시작/완료 기록 · 다른 작업 기록 · 오늘 내 기록.
 *     진행 중 타이머 · 고른 공정은 이 기기 localStorage. 배정이 없고 링크만 있으면 「내 계정에 잇기」
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
  /** 작업자 종류 — 작업 종류 + 공장 공정 재단 · 엣지 (공장 조립은 조립, 서버 WORKER_KINDS · DB 0024) */
  const WORKER_KINDS = Object.freeze([...KINDS, 'cutting', 'edge']);
  const KIND_LABEL = Object.freeze({ install: '설치', as: 'A/S', assembly: '조립 추가 인원', cutting: '재단', edge: '엣지' });
  /** 작업자에게 보이는 작업 상태 (effective_status — expired 는 API 가 읽을 때 판정) */
  const JOB_STATUS_LABEL = Object.freeze({
    draft: '준비 중', open: '모집중', expired: '지원 종료', filled: '인원 마감', in_progress: '진행 중',
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
  /** 팩토리와의 연결 상태 (GET /work/me 의 links[].status — 서버 work/links.js). 끝난 연결은 서버가 싣지 않는다 */
  const LINK_STATUS_LABEL = Object.freeze({ pending: '승인 대기', approved: '연결됨', suspended: '정지', rejected: '승인되지 않음' });
  const LINKS_NOTE = '팩토리가 보낸 초대 링크를 열면 그 팩토리와 연결을 신청할 수 있습니다. 연결된 팩토리의 작업만 보입니다.';
  const PAY_UNIT_LABEL = Object.freeze({ day: '일', hour: '시간', meter: 'm', job: '건' });
  const TABS = Object.freeze([
    { key: 'open', label: '모집중' },
    { key: 'mine', label: '내 작업' },
    { key: 'done', label: '완료' },
    { key: 'factory', label: '공장' },
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
  /** 서버가 site_note 를 안 줄 때 (서버 work/reveal.js SITE_NOTE 와 같은 글) */
  const SITE_NOTE = '현장 주소·연락처는 배정을 수락한 뒤부터 작업이 끝나고 7일까지 열립니다';
  /** 열린 현장 상자 아래 한 줄 */
  const SITE_OPEN_NOTE = '현장 정보는 작업이 끝나고 7일 뒤에 닫힙니다. 이 작업을 위해서만 써 주세요.';
  /** sessionStorage 키 — 초대 토큰을 로그인 왕복 동안 보관 */
  const INVITE_KEY = 'dadamWorkerInvite';
  /** 정지된 작업자 맨 위 안내 (1주차 후속 D) — worker.html #suspendedNote 와 같은 글 */
  const SUSPENDED_NOTE = '계정이 정지되어 새 작업 신청·수락을 할 수 없습니다. 지난 기록은 볼 수 있습니다.';
  /** 지원 종료일이 없을 때 상세 사실 행 (1주차 후속 0) */
  const DEADLINE_NONE = '정하지 않음 (정원이 차면 마감)';
  /** 지원 종료일이 지났을 때의 꼬리표 · 잠근 신청 버튼 글 */
  const DEADLINE_ENDED = '지원 종료';

  // ── 공장 (서버 work/factory.js — 생산 링크 화면 production-worker.html 과 같은 일을 계정으로) ──
  const FACTORY_ROLE_LABEL = Object.freeze({ cutter: '재단', edge: '엣지', asm: '조립' });
  const FACTORY_UNIT_HINT = Object.freeze({ cutter: '원판 장', edge: '엣지 면', asm: '통·서랍 개' });
  /** 공정 → 여는 작업지시서 꾸러미 (서버 work/checks.js PACKS_OF_ROLE 와 같다 — 재단 · 엣지 → 재단 · 라벨, 조립 → 조립) */
  const FACTORY_PACKS = Object.freeze({ cutter: ['cut', 'labels'], edge: ['cut', 'labels'], asm: ['assembly'] });
  const PACK_LABEL = Object.freeze({ cut: '재단 지시서', labels: '부재 라벨', assembly: '조립 지시서' });
  /** 작업지시서 · 필수 확인을 여는 작업(모집 · 초대) — 설치는 시공 지시서, 조립은 조립 꾸러미 */
  const DOC_JOB_KINDS = Object.freeze(['install', 'assembly']);
  const DOC_ASSIGNMENT_STATUSES = Object.freeze(['confirmed', 'started', 'submitted', 'revision', 'accepted']);
  /** 이 기기의 생산 링크 토큰 — production-worker.html 이 localStorage 에 둔다. 있으면 「내 계정에 잇기」 */
  const LINK_TOKEN_KEY = 'dadamWorkerToken';
  /** 마지막에 고른 공정 · 진행 중 타이머 (이 기기 localStorage) */
  const FACTORY_ROLE_KEY = 'dadamFactoryRole';
  const factoryTimerKey = (role, orderId) => `dadamFactoryTimer:${role}:${orderId}`;
  /** 실측 기록 상한 — 서버 validateWorklog 와 같다 */
  const WORKLOG_LIMITS = Object.freeze({ units: 1000, minutes: 1440, label: 200 });

  /** 일이 시작된 배정 · 보고할 수 있는 배정 (서버 updates.js 와 같은 조건) */
  const REPORTABLE = Object.freeze(['confirmed', 'started', 'submitted', 'revision', 'accepted']);
  const RESULT_FROM = Object.freeze(['started', 'revision']);
  /** 검수를 거치는 종류 — 공장 조립은 완료 보고로 끝난다 (계약 머리말) */
  const REVIEWED_KINDS = Object.freeze(['install', 'as']);
  const ENDED_JOB = Object.freeze(['closed', 'cancelled']);
  /** 작업자 탭에 드는 배정 (서버 jobs.js 의 MINE_STATUSES · DONE_STATUSES 와 같다) — 상세의 '← 목록으로' 를 고른다 */
  const MINE_ASSIGN = Object.freeze(['offered', 'confirmed', 'started', 'submitted', 'revision']);
  const DONE_ASSIGN = Object.freeze(['accepted', 'declined', 'released', 'removed']);

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
  const kstDay = (ms) => Math.floor((ms + KST_MS) / DAY_MS);
  const nowOr = (nowMs) => (Number.isFinite(nowMs) ? nowMs : Date.now());
  /** 한국 날짜 기준 D-day ('D-1' · 'D-day' · 'D+2'), 날짜 없으면 '' */
  function ddayLabel(iso, nowMs) {
    const t = Date.parse(iso);
    if (!iso || !Number.isFinite(t)) return '';
    const diff = kstDay(t) - kstDay(nowOr(nowMs));
    if (diff === 0) return 'D-day';
    return diff > 0 ? `D-${diff}` : `D+${-diff}`;
  }

  // ── 지원 종료일 (work_jobs.apply_deadline, 1주차 후속 0) ──
  /** 지원 종료일이 지났나 — 서버 effectiveStatus 와 같은 경계 (지원 종료일 < 지금). 없으면 false */
  function deadlinePassed(iso, nowMs) {
    const t = Date.parse(iso);
    if (!iso || !Number.isFinite(t)) return false;
    return t < nowOr(nowMs);
  }
  /**
   * 꼬리표 — 지났으면 '지원 종료', 한국 날짜로 같은 날이고 아직 전이면 '오늘 종료', 아니면 'D-n' (n ≥ 1).
   * 지원 종료일이 없으면 ''. (관리자 화면 js/work-jobs-admin.js deadlineTag 와 같은 규칙)
   */
  function deadlineTag(iso, nowMs) {
    const t = Date.parse(iso);
    if (!iso || !Number.isFinite(t)) return '';
    const now = nowOr(nowMs);
    if (t < now) return DEADLINE_ENDED;
    const diff = kstDay(t) - kstDay(now);
    return diff >= 1 ? `D-${diff}` : '오늘 종료';
  }
  /** 꼬리표 HTML — 오늘 종료 · 지원 종료는 눈에 띄게 */
  function deadlineTagHtml(tag) {
    if (!tag) return '';
    const cls = tag === DEADLINE_ENDED ? 'dl-over' : tag === '오늘 종료' ? 'dl-today' : 'dl-days';
    return `<span class="dl-tag ${cls}">${esc(tag)}</span>`;
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

  /**
   * 로그인 뒤 돌아올 곳 — 같은 사이트 상대 경로 (login.html 이 *.html + #… 만 받는다, 계약 §5).
   * page = 포털 페이지 (사이트 뿌리에서 본 주소 — #workerApp 의 data-page)
   */
  function returnTarget(route, invite, page = 'worker.html') {
    const r = route || {};
    if (invite && TOKEN_RE.test(invite)) return `${page}#invite=${invite}`;
    if (r.job && UUID_RE.test(r.job)) return `${page}#job=${r.job}`;
    if (r.tab && TAB_KEYS.includes(r.tab)) return `${page}#tab=${r.tab}`;
    return page;
  }
  /** login = 이 페이지에서 본 로그인 페이지 주소 (앱은 '../login.html') */
  const loginHref = (target, login = 'login.html') => `${login}?redirect=${encodeURIComponent(target || 'worker.html')}`;

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

  /** 작업자 상태로 본 정지 여부 (GET /work/me 의 worker.status) */
  const isSuspended = (me) => !!(me && me.worker && me.worker.status === 'suspended');
  /** 보이는 탭 — 정지된 작업자는 모집중 탭이 없다 (1주차 후속 D). 공장 탭은 factory 일 때만 (공장 배정 · 이을 링크) */
  const tabsFor = (suspended, factory) => TABS.filter((t) => !(suspended && t.key === 'open') && (factory || t.key !== 'factory'));

  /**
   * 처음 볼 탭 — 주소에 탭이 있으면 그것, 아니면 내 작업이 있으면 내 작업.
   * 정지된 작업자는 모집중 탭이 없어 기본이 내 작업 (주소가 #tab=open 이어도).
   */
  function defaultTab(route, counts, suspended, factory) {
    const keys = tabsFor(suspended, factory).map((t) => t.key);
    if (route && route.tab && keys.includes(route.tab)) return route.tab;
    if (suspended) return 'mine';
    return counts && Number(counts.mine) > 0 ? 'mine' : 'open';
  }

  /**
   * 작업 상세의 '← 목록으로' — 목록에서 들어왔으면 그 탭, #job= 로 바로 들어왔으면 내 배정이 든 탭
   * (내 작업 · 완료), 배정이 없으면 처음 탭 (1주차 리뷰: 내 배정 작업인데 모집중으로 돌아가던 것).
   */
  function backTabFor(d, fromTab, suspended, factory) {
    const keys = tabsFor(suspended, factory).map((t) => t.key);
    if (fromTab && keys.includes(fromTab)) return fromTab;
    const a = d && d.my && d.my.assignment_status;
    if (MINE_ASSIGN.includes(a)) return 'mine';
    if (DONE_ASSIGN.includes(a)) return 'done';
    return defaultTab(null, null, suspended, factory);
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
      if (WORKER_KINDS.includes(k) && !kinds.includes(k)) kinds.push(k);
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

  /**
   * 화면에 보일 작업 상태 — 서버가 open 이라고 줬어도 화면 시각으로 지원 종료일이 지났으면 expired(「지원 종료」)
   * (목록을 연 채 시간이 지나면 칩과 지원 종료일 줄이 엇갈리지 않게. 서버 경계와 같다: 지원 종료일 < 지금)
   */
  function shownStatus(c, nowMs) {
    const eff = (c && (c.effective_status || c.status)) || '';
    return eff === 'open' && deadlinePassed(c.apply_deadline, nowMs) ? 'expired' : eff;
  }

  /** 카드의 내 상태 — 배정 > 신청 > 작업 상태 */
  function myStatus(c, nowMs) {
    const my = (c && c.my) || {};
    if (my.assignment_status) return { key: my.assignment_status, text: label(ASSIGN_STATUS_LABEL, my.assignment_status), tone: TONE[my.assignment_status] };
    if (my.application_status) return { key: my.application_status, text: label(APP_STATUS_LABEL, my.application_status), tone: TONE[my.application_status] };
    const eff = shownStatus(c, nowMs);
    return { key: eff, text: label(JOB_STATUS_LABEL, eff), tone: TONE[eff] };
  }

  /** 모집중 카드 한 줄 '지원 종료일 10/25(토) 18:00 · D-3' — 지원 종료일이 있을 때만 */
  function deadlineLineHtml(c, nowMs) {
    const iso = c && c.apply_deadline;
    if (!kstParts(iso)) return '';
    return `<div class="jd dl">지원 종료일 ${esc(fmtDateTime(iso))} · ${deadlineTagHtml(deadlineTag(iso, nowMs))}</div>`;
  }

  /**
   * 지난 작업(완료) 탭 — 거절(declined) 배정의 release_reason 을 그대로 한 줄로 (계약 1주차 후속 C).
   * 내가 적은 거절 사유일 수도, 작업 닫기 · 취소로 서버가 끝낸 초대의 안내 문구일 수도 있어 "사유:" 로만 붙인다.
   * 서버 문구 글자를 맞춰 칩을 바꾸지 않는다 — 문구가 바뀌면 소리 없이 엇갈린다 (PR #978 리뷰).
   */
  function releaseReasonHtml(c) {
    const my = (c && c.my) || {};
    const reason = trimStr(my.release_reason);
    if (my.assignment_status !== 'declined' || !reason) return '';
    return `<div class="jd reason">사유: ${esc(reason)}</div>`;
  }

  /**
   * 작업 카드 (목록 한 줄). 누르면 #job=<id> 로 상세.
   * tab 이 'open' 이면 지원 종료일 줄, 'done' 이면 거절 사유 줄을 덧붙인다.
   */
  function jobCardHtml(c, nowMs, tab) {
    if (!c || !isUuid(c.id)) return '';
    const st = myStatus(c, nowMs);
    const dday = ddayLabel(c.starts_at, nowMs);
    const pay = payText(c.pay);
    return `<a class="card job" href="#job=${esc(c.id)}">` +
      `<div class="chips">${kindChip(c.kind)}${chip(st.text, st.tone)}${dday ? chip(dday, 'dday') : ''}</div>` +
      `<div class="jt">${esc(c.title)}</div>` +
      (c.company_name ? `<div class="jd co">${esc(c.company_name)}</div>` : '') +
      `<div class="jd">${esc(fmtRange(c.starts_at, c.ends_at))}${c.region_label ? ` · ${esc(c.region_label)}` : ''}</div>` +
      `<div class="jd">${esc(slotsText(c))}${pay ? ` · ${esc(pay)}` : ''}</div>` +
      (tab === 'open' ? deadlineLineHtml(c, nowMs) : '') +
      (tab === 'done' ? releaseReasonHtml(c) : '') +
      '</a>';
  }

  const EMPTY_TEXT = Object.freeze({
    open: '지금 모집 중인 작업이 없습니다. 내 작업 종류에 맞는 작업만 보입니다.',
    mine: '확정되거나 진행 중인 작업이 없습니다. 초대를 받으면 여기에 나옵니다.',
    done: '끝난 작업이 없습니다.',
  });
  function jobListHtml(items, tab, nowMs) {
    const list = (items || []).map((c) => jobCardHtml(c, nowMs, tab)).filter(Boolean);
    if (!list.length) return `<div class="card empty">${esc(EMPTY_TEXT[tab] || '작업이 없습니다.')}</div>`;
    return list.join('');
  }

  /**
   * 탭 줄 — 모집중 · 내 작업 건수 (GET /work/me counts). 보완요청 · 새 소식은 탭 아래 한 줄로
   * (탭 칸에 넣으면 375px 에서 칸이 세 줄로 늘어난다). 정지된 작업자는 모집중 탭이 없다.
   */
  function tabsHtml(active, counts, suspended, factory) {
    const c = counts || {};
    const tabs = tabsFor(suspended, factory).map((t) => {
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
   *   applyEnded: 신청할 자리였지만 지원 종료일이 지났다 (서버가 expired 로 줬거나 화면 시각으로 지남) — 잠근 「지원 종료」 버튼.
   *   opts.suspended: 정지된 작업자 — 신청 · 초대 수락만 없다 (거절 · 철회 · 시작 · 포기 · 보고는 그대로, 1주차 후속 D).
   */
  function availableActions(d, opts) {
    const o = opts || {};
    const out = { apply: false, applyEnded: false, withdraw: false, confirm: false, decline: false, start: false, release: false, reports: [] };
    if (!d) return out;
    const my = d.my || {};
    const a = my.assignment_status || null;
    const app = my.application_status || null;
    const eff = d.effective_status || d.status || '';
    if (ENDED_JOB.includes(eff)) return out;
    if (!o.suspended && !a && !app && (eff === 'open' || eff === 'expired')) {
      if (eff === 'expired' || deadlinePassed(d.apply_deadline, o.nowMs)) out.applyEnded = true;
      else out.apply = true;
    }
    if (app === 'applied' && isUuid(my.application_id)) out.withdraw = true;
    if (isUuid(my.assignment_id)) {
      if (a === 'offered') {
        out.confirm = !o.suspended;
        out.decline = true;
      }
      if (a === 'confirmed') out.start = true;
      if (a === 'confirmed' || a === 'started') out.release = true;
      if (REPORTABLE.includes(a)) out.reports = RESULT_FROM.includes(a) ? ['progress', 'issue', 'result'] : ['progress', 'issue'];
    }
    return out;
  }

  /** 내 상태 한 줄 설명 (opts: { nowMs, suspended }) */
  function stateText(d, opts) {
    const o = opts || {};
    const my = (d && d.my) || {};
    const eff = (d && (d.effective_status || d.status)) || '';
    if (eff === 'cancelled') return '취소된 작업입니다.';
    if (eff === 'closed') return '종료된 작업입니다.';
    switch (my.assignment_status) {
      case 'offered': return o.suspended
        ? '회사가 이 작업을 맡아 달라고 초대했습니다. 계정이 정지되어 수락할 수 없습니다.'
        : '회사가 이 작업을 맡아 달라고 초대했습니다. 수락하면 확정됩니다.';
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
    if (eff === 'expired' || (eff === 'open' && deadlinePassed(d.apply_deadline, o.nowMs))) return '지원 종료일이 지났습니다.';
    if (eff === 'open' && !o.suspended) return '신청하면 회사가 신청자 중에서 골라 확정합니다.';
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

  /** 내 상태 + 할 수 있는 일 (opts: { nowMs, suspended }) */
  function actionsHtml(d, opts) {
    const act = availableActions(d, opts);
    const my = d.my || {};
    const parts = [`<p>${esc(stateText(d, opts))}</p>`];
    if (act.apply) {
      parts.push('<form data-form="apply" class="stack">' +
        `<label for="applyMsg">회사에 남길 말 (선택, ${LIMITS.message}자 이내)</label>` +
        `<textarea id="applyMsg" name="message" rows="3" maxlength="${LIMITS.message}"></textarea>` +
        '<button type="submit" class="big go">이 작업 신청하기</button></form>');
    }
    // 지원 종료일이 지났다 (서버 expired 또는 화면 시각) — 신청 버튼 자리에 잠근 「지원 종료」 버튼
    if (act.applyEnded) parts.push(`<button type="button" class="big" disabled>${esc(DEADLINE_ENDED)}</button>`);
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
    if (DOC_JOB_KINDS.includes(d.kind) && isUuid(my.assignment_id) && DOC_ASSIGNMENT_STATUSES.includes(my.assignment_status)) {
      parts.push(`<div class="btns"><button type="button" class="big" data-act="as-pack" data-id="${esc(my.assignment_id)}">${d.kind === 'install' ? '시공 지시서' : '조립 지시서'}</button>` +
        `<button type="button" class="big" data-act="as-checks" data-id="${esc(my.assignment_id)}">필수 확인</button></div>`);
    }
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

  /**
   * 상세 사실 행 「지원 종료일」 값 (HTML) — 없으면 '정하지 않음 (정원이 차면 마감)'.
   * 꼬리표는 모집중 · 지원 종료 작업에만 (인원이 찼거나 진행 중이면 D-n 이 틀린 말이 된다 — 관리자 상세와 같다).
   */
  function deadlineFactHtml(d, nowMs) {
    const iso = d && d.apply_deadline;
    if (!kstParts(iso)) return esc(DEADLINE_NONE);
    const eff = d.effective_status || d.status || '';
    const tag = eff === 'open' || eff === 'expired' ? deadlineTag(iso, nowMs) : '';
    return `${esc(fmtDateTime(iso))}${tag ? ` · ${deadlineTagHtml(tag)}` : ''}`;
  }

  /** 전화 글 → tel: 주소에 넣을 숫자 (+ 와 숫자만). 숫자가 없으면 '' */
  function telOf(phone) {
    const s = String(phone == null ? '' : phone).replace(/[^0-9+]/g, '');
    return /[0-9]/.test(s) ? s : '';
  }

  /**
   * 현장 — 서버가 site 를 줄 때만(내가 수락한 때부터 작업이 끝나고 7일까지) 주소 · 층 · 출입 · 현장 연락처를 그린다.
   * site 가 없으면 안내 글(site_note)만. site_note 가 null 이면(현장이 없는 종류 — 공장 조립) 아무것도 그리지 않는다.
   * @returns {{ note: string, card: string }} note = 작업 카드 안의 안내 한 줄, card = 따로 그리는 현장 카드
   */
  function siteHtml(d) {
    const s = d && d.site && typeof d.site === 'object' && !Array.isArray(d.site) ? d.site : null;
    if (!s) return { note: d && d.site_note === null ? '' : `<p class="site-note">${esc((d && d.site_note) || SITE_NOTE)}</p>`, card: '' };
    const text = (v) => (typeof v === 'string' ? v.trim() : '');
    const rows = [];
    const address = [text(s.address), text(s.address_detail)].filter(Boolean).join(' ');
    if (address) rows.push(['주소', esc(address)]);
    if (text(s.floor)) rows.push(['층', esc(text(s.floor))]);
    if (s.has_elevator === true || s.has_elevator === false)
      rows.push(['엘리베이터', esc((s.has_elevator ? '있음' : '없음') + (text(s.elevator_note) ? ` — ${text(s.elevator_note)}` : ''))]);
    else if (text(s.elevator_note)) rows.push(['엘리베이터', esc(text(s.elevator_note))]);
    if (text(s.access_note)) rows.push(['출입', esc(text(s.access_note))]);
    const tel = telOf(s.contact_phone);
    const phone = text(s.contact_phone) ? (tel ? `<a href="tel:${esc(tel)}">${esc(text(s.contact_phone))}</a>` : esc(text(s.contact_phone))) : '';
    const contact = [esc(text(s.contact_name)), phone].filter(Boolean).join(' ');
    if (contact) rows.push(['현장 연락처', contact]);
    if (!rows.length) return { note: `<p class="site-note">${esc((d && d.site_note) || SITE_NOTE)}</p>`, card: '' };
    return {
      note: '',
      card: '<div class="card site-card"><h3>현장</h3>' +
        `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` +
        `<p class="muted">${esc(SITE_OPEN_NOTE)}</p></div>`,
    };
  }

  /** 작업 상세 (#job=<id>). opts: { suspended } — 정지된 작업자는 신청 · 수락 버튼이 없다 */
  function jobDetailHtml(d, nowMs, backTab, opts) {
    if (!d) return '';
    const o = { ...(opts || {}), nowMs };
    const st = myStatus(d, nowMs);
    const eff = shownStatus(d, nowMs);
    const dday = ddayLabel(d.starts_at, nowMs);
    const pay = payText(d.pay);
    // [이름, 값 HTML] — 값은 여기서 esc() 를 거친다
    const facts = [
      ...(d.company_name ? [['팩토리', esc(d.company_name)]] : []),
      ['일시', esc(`${fmtRange(d.starts_at, d.ends_at)}${dday ? ` (${dday})` : ''}`)],
      ['지역', esc(d.region_label || '정해지지 않음')],
      ['인원', esc(slotsText(d))],
      ['지원 종료일', deadlineFactHtml(d, nowMs)],
    ];
    if (pay) facts.push(['금액', esc(pay)]);
    if (d.order_no) facts.push(['주문번호', esc(d.order_no)]);
    if (d.customer_masked) facts.push(['고객', esc(d.customer_masked)]);
    const back = tabsFor(o.suspended).some((t) => t.key === backTab) ? backTab : defaultTab(null, null, o.suspended);
    // 현장 — 서버가 연 것만 그린다 (수락한 때부터 작업이 끝나고 7일까지). 닫혀 있으면 안내 한 줄
    const site = siteHtml(d);
    const showTimeline = !!(d.my && d.my.assignment_id) || (Array.isArray(d.timeline) && d.timeline.length);
    return `<a class="back" href="#tab=${back}">← 목록으로</a>` +
      '<div class="card">' +
      `<div class="chips">${kindChip(d.kind)}${chip(label(JOB_STATUS_LABEL, eff), TONE[eff])}${st.key !== eff ? chip(st.text, st.tone) : ''}</div>` +
      `<h2 class="jt">${esc(d.title)}</h2>` +
      `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` +
      `${d.detail ? `<div class="detail-text">${esc(d.detail)}</div>` : ''}${site.note}</div>` +
      site.card +
      `<div class="card"><h3>내 상태</h3>${actionsHtml(d, o)}</div>` +
      (showTimeline ? `<div class="card"><h3>작업 기록</h3><p class="muted">내 보고와 회사 정정 · 메모가 고쳐지지 않고 차례로 쌓입니다.</p>${timelineHtml(d.timeline)}</div>` : '');
  }

  /**
   * 연결된 팩토리 카드 (GET /work/me 의 links — 2026-11-13 작업자 한 길). 작업자는 여러 팩토리와 연결될 수 있다.
   * links 가 없으면(옛 서버 · DB 적용 전) 빈 글 — 카드를 그리지 않는다.
   */
  function linksHtml(links) {
    if (!Array.isArray(links)) return '';
    const rows = links.filter((l) => l && Object.prototype.hasOwnProperty.call(LINK_STATUS_LABEL, l.status));
    const list = rows.length
      ? `<dl class="facts">${rows.map((l) => `<dt>${esc(l.company_name || '이름 없는 팩토리')}</dt><dd>${esc(LINK_STATUS_LABEL[l.status])}</dd>`).join('')}</dl>`
      : '<p class="empty">아직 연결된 팩토리가 없습니다.</p>';
    return `<div class="card"><h3>연결된 팩토리</h3>${list}<p class="muted">${esc(LINKS_NOTE)}</p></div>`;
  }

  /** 초대 링크를 연 작업자에게 묻는 글 (POST /work/invites/peek 의 답) */
  function linkAskText(peek) {
    const name = (peek && peek.company_name) || '초대한 팩토리';
    return `${name}에서 작업자로 초대했습니다. 연결을 신청하면 ${name}에서 확인한 뒤 승인합니다. 승인되면 그 팩토리의 작업을 여기서 봅니다.`;
  }

  /** 내 정보 탭 (WorkerSelf). mypage = 이 페이지에서 본 마이페이지 주소 (#workerApp 의 data-mypage — 앱은 me.html) */
  function workerInfoHtml(w, mypage = 'mypage.html', links = null) {
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
    return linksHtml(links) +
      '<div class="card"><h3>내 정보</h3>' +
      `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` +
      '<p class="muted">받은 정보: 이름 · 휴대폰(선택) · 작업 종류 · 활동 지역. 주민등록번호 · 계좌는 받지 않습니다.</p>' +
      '<p class="muted">이 화면에서는 아직 정보를 고칠 수 없습니다. 바꿀 내용은 회사에 알려 주세요.</p>' +
      `<div class="btns"><a class="big" href="${esc(mypage)}">마이페이지</a><button type="button" class="big" data-act="logout">로그아웃</button></div>` +
      '</div>';
  }

  /** 신청 대기 화면의 내 신청 정보 */
  function pendingInfoHtml(w, links = null) {
    if (!w) return '';
    const waiting = (Array.isArray(links) ? links : []).filter((l) => l && l.status === 'pending' && l.company_name).map((l) => l.company_name);
    const rows = [
      ['이름', w.display_name],
      ['작업 종류', kindsText(w.kinds)],
      ['활동 지역', w.region_label || '적지 않음'],
      ...(waiting.length ? [['확인하는 곳', waiting.join(' · ')]] : []),
    ];
    return `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  }

  // ── 공장 (순수) ──
  /** 'YYYY-MM-DD' → '11/1(일)' (서버 kstDate 가 준 날짜) */
  function factoryDay(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return '-';
    const d = new Date(`${s}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY[d.getUTCDay()]})`;
  }
  /** 고를 공정 — 저장해 둔 것이 내 공정이면 그것, 아니면 첫 공정 (공정이 없으면 null) */
  const factoryRoleOf = (roles, stored) => (Array.isArray(roles) && roles.includes(stored) ? stored : (Array.isArray(roles) && roles[0]) || null);
  /** 시작한 지 몇 분 (1분 아래는 1) */
  const elapsedMin = (start, nowMs) => Math.max(1, Math.round((nowMs - Number(start)) / 60000));

  /** 실측 기록 값 → 요청 본문 + 오류 목록 (POST /work/factory/worklogs, 상한은 서버와 같다) */
  function worklogBody(values) {
    const v = values || {};
    const errors = [];
    const units = toNum(v.units);
    const minutes = toNum(v.minutes);
    if (!(units > 0 && units <= WORKLOG_LIMITS.units)) errors.push(`수량은 0보다 크고 ${WORKLOG_LIMITS.units} 이하로 적어 주세요.`);
    if (!(minutes > 0 && minutes <= WORKLOG_LIMITS.minutes)) errors.push(`걸린 시간(분)은 0보다 크고 ${WORKLOG_LIMITS.minutes} 이하로 적어 주세요.`);
    const body = { role: v.role, units, minutes };
    if (isUuid(v.order_id)) body.order_id = v.order_id;
    const what = trimStr(v.order_label);
    if (what) body.order_label = what.slice(0, WORKLOG_LIMITS.label);
    return { body, errors };
  }

  /** 「내 계정에 잇기」 — 이 기기에 생산 링크가 있고 공장 배정이 아직 없을 때 */
  function factoryLinkHtml() {
    return '<div class="card"><h3>생산 링크를 내 계정에 잇기</h3>' +
      '<p>이 기기에 공장 생산 링크가 있습니다. 내 계정에 이으면 링크 대신 이 「공장」 탭에서 오늘 할 일 · 지시 · 기록을 합니다. 그 링크로 남긴 기록도 이어집니다.</p>' +
      '<p class="muted">이으면 링크 주소는 더 열리지 않습니다.</p>' +
      '<button type="button" class="big go" data-act="fw-link">내 계정에 잇기</button></div>';
  }

  /** 한 공정의 할 일 카드 — 생산 링크 화면과 같은 차례 (오늘 예정 → 다른 진행 중 주문). timers = { orderId: 시작 ms } */
  function factoryJobsHtml(d, role, timers, nowMs) {
    const list = (d && d.work && d.work[role]) || [];
    const roleName = esc(FACTORY_ROLE_LABEL[role] || role);
    if (!list.length) {
      let why = d && d.activeJobs ? `진행 중인 주문에 ${roleName} 작업이 없습니다.` : '진행 중인 수주가 없습니다.';
      const skipped = (d && d.skipped) || [];
      if (skipped.length) why += `<br>계획에서 빠진 주문: ${skipped.map((s) => `${esc(s.label)} (${esc(s.reason)})`).join(', ')}`;
      return `<div class="card empty">${why}<br>아래 「다른 작업 기록」으로는 언제든 기록할 수 있습니다.</div>`;
    }
    const firstLater = list.findIndex((j) => !j.today);
    return list.map((j, i) => {
      let head = '';
      if (i === 0 && j.today) head = '<p class="muted fw-head">오늘 예정</p>';
      if (i === firstLater) head = `<p class="muted fw-head">${i === 0 ? '오늘 예정은 없습니다 · ' : ''}다른 진행 중 주문 (먼저 해도 됩니다)</p>`;
      const meta = [esc(j.detail), `마감 ${esc(factoryDay(j.due))}`];
      if (!j.today && j.plannedStart) meta.push(`계획 ${esc(factoryDay(j.plannedStart))}`);
      if (role === 'asm' && j.doorArrival) meta.push(`도어 도착 ${esc(factoryDay(j.doorArrival))}`);
      const start = timers && timers[j.orderId];
      const units = toNum(j.units);
      const form = start
        ? `<p class="fw-run" data-since="${esc(start)}">진행 중 · ${elapsedMin(start, nowMs)}분째</p>` +
          `<div class="fw-form"><label>${esc(FACTORY_UNIT_HINT[role] || '수량')} <input type="number" inputmode="decimal" id="fwU${i}" value="${units === null ? '' : esc(units)}" /></label>` +
          `<label>걸린 시간 (분) <input type="number" inputmode="decimal" id="fwM${i}" value="${elapsedMin(start, nowMs)}" /></label></div>` +
          `<div class="btns"><button type="button" class="big" data-act="fw-cancel" data-i="${i}">취소</button>` +
          `<button type="button" class="big stop" data-act="fw-done" data-i="${i}">완료 기록</button></div>`
        : `<button type="button" class="big go" data-act="fw-start" data-i="${i}">시작</button>`;
      return `${head}<div class="card job"><div class="jt">${esc(j.label)}</div><div class="jd">${meta.join(' · ')}</div>${factoryDocButtons(role, j.orderId)}${form}</div>`;
    }).join('');
  }

  /** 할 일 카드의 작업지시서 꾸러미 · 필수 확인 단추 (주문 id 가 있을 때) */
  function factoryDocButtons(role, orderId) {
    if (!isUuid(orderId)) return '';
    const packs = FACTORY_PACKS[role] || [];
    return `<div class="btns fw-docs">${packs.map((p) => `<button type="button" class="big" data-act="fw-pack" data-pack="${esc(p)}" data-order="${esc(orderId)}">${esc(PACK_LABEL[p])}</button>`).join('')}` +
      `<button type="button" class="big" data-act="fw-checks" data-order="${esc(orderId)}">필수 확인</button></div>`;
  }

  /** 주문 끝 항목(목록 v2 finish) — 필수가 남았으면 잠근다 (서버도 409 checks_left, 2026-11-06 사장님 「주문 끝 완료를 따로 둠」) */
  const finishLocked = (r, x) => !!(x && x.finish && !x.checked && Number(r && r.must_left) > 0);

  /**
   * 필수 확인 화면 (GET …/checks — 서버 work/checks.js) — 역할마다 칸(원장 · 모듈 · 주문) × 항목 체크.
   * 체크는 지우지 않고 기록으로 쌓인다. 저장 준비 전(db_ready false)이면 칸을 잠근다. 글은 전부 esc().
   */
  function checksHtml(v) {
    if (!v || !v.document) return '<div class="card empty">필수 확인을 불러오지 못했습니다.</div>';
    const parts = [
      '<div class="btns"><button type="button" class="big" data-act="ck-back">← 돌아가기</button></div>',
      `<div class="card"><h3>필수 확인 · ${esc(v.order_label)}</h3><p class="muted">작업지시서 ${esc(v.document.doc_no)} · 하고 나서 체크해 주세요. 체크는 지우지 않고 기록으로 남습니다.</p>` +
        (v.db_ready ? '' : '<p class="warn">아직 저장 준비가 안 되어 체크를 남길 수 없습니다 (회사 DB 적용 전).</p>') + '</div>',
    ];
    (v.roles || []).forEach((r) => {
      const head = `<h3>${esc(r.label || r.role)} <span class="muted">${esc(r.done)}/${esc(r.total)}${r.must_left ? ` · 필수 남음 ${esc(r.must_left)}` : ''}</span></h3>`;
      const cells = (r.cells || []).map((c) => `<div class="ck-cell"><p class="muted fw-head">${esc(c.label)}</p>${(c.items || []).map((x) =>
        `<label class="check${x.checked ? ' done' : ''}"><input type="checkbox" data-ck-role="${esc(r.role)}" data-ck-scope="${esc(c.scope_key)}" data-ck-item="${esc(x.key)}" data-ck-photo="${esc(x.photo || 'none')}"${x.checked ? ' checked' : ''}${v.db_ready && !finishLocked(r, x) ? '' : ' disabled'} />` +
        `<span>${esc(x.label)}${x.finish ? ` <small class="muted">${finishLocked(r, x) ? '주문 끝 — 필수를 다 체크하면 누를 수 있습니다' : '주문 끝'}</small>` : x.must ? '' : ' <small class="muted">권장</small>'}${x.photo === 'need' ? ' <small class="muted">사진 필수</small>' : ''}${x.has_photo ? ' <small class="muted">· 사진 있음</small>' : ''}</span></label>` +
        (x.photo === 'opt' && !x.checked && v.db_ready ? `<button type="button" class="link ck-photo" data-act="ck-photo" data-ck-role="${esc(r.role)}" data-ck-scope="${esc(c.scope_key)}" data-ck-item="${esc(x.key)}">사진 붙여 체크</button>` : '')).join('')}</div>`).join('');
      parts.push(`<div class="card">${head}${cells || '<p class="empty">이 역할에 확인할 항목이 없습니다.</p>'}</div>`);
    });
    if ((v.roles || []).some((r) => (r.cells || []).some((c) => (c.items || []).some((x) => x.photo === 'need' || x.photo === 'opt')))) {
      parts.push('<p class="muted">사진 필수 항목은 체크하면 사진 고르기가 열립니다. 사진은 회사만 봅니다.</p>');
    }
    parts.push('<input type="file" id="ckPhotoFile" accept="image/jpeg,image/png" capture="environment" hidden />');
    return parts.join('');
  }

  /** 사진 줄이기 — 긴 변 2048px · JPEG (서버 한도 긴 변 2576 · 375만 화소 · 5MB 안에). 줄일 수 없으면 원본 (서버가 이유를 알려 준다) */
  async function shrinkPhoto(file) {
    const MAX = 2048;
    try {
      if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
      if (k === 1 && file.size <= 4 * 1024 * 1024 && /^image\/(jpeg|png)$/.test(file.type)) return file;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
      return blob || file;
    } catch (e) {
      return file;
    }
  }

  /**
   * 공장 탭 한 장 (GET /work/factory) — 오늘 지시 · 공정 고르기 · 할 일 · 다른 작업 기록 · 오늘 내 기록.
   * opts.role = 고른 공정, opts.timers = 그 공정의 진행 중 타이머. 글은 전부 esc() (지시 · 주문 이름은 서버가 가려서 준다)
   */
  function factoryHtml(d, opts) {
    const o = opts || {};
    const roles = d && Array.isArray(d.roles) ? d.roles : [];
    const role = factoryRoleOf(roles, o.role);
    const parts = [`<p class="muted">${esc(factoryDay(d && d.today))} · 시작을 누르고, 끝나면 완료 기록을 눌러 주세요.</p>`];
    const assignments = (d && d.assignments) || [];
    if (assignments.length) {
      parts.push('<div class="card"><h3>오늘 지시</h3>' + assignments.map((a) => {
        const done = a.status === 'done';
        return `<label class="check${done ? ' done' : ''}"><input type="checkbox" data-fa="${esc(a.id)}"${done ? ' checked' : ''} /><span>${esc(a.text)}</span></label>`;
      }).join('') + '</div>');
    }
    if (!role) {
      parts.push('<div class="card empty">작업자 종류에 재단 · 엣지 · 조립이 없어 공장 기록을 할 수 없습니다. 회사에 종류를 넣어 달라고 해 주세요.</div>');
      return parts.join('');
    }
    const roleName = esc(FACTORY_ROLE_LABEL[role] || role);
    if (roles.length > 1) {
      const btn = (r) =>
        `<button type="button" class="tab${r === role ? ' on' : ''}" data-act="fw-role" data-role="${esc(r)}" aria-pressed="${r === role}">${esc(FACTORY_ROLE_LABEL[r] || r)}</button>`;
      parts.push(`<div class="fw-roles" role="group" aria-label="공정">${roles.map(btn).join('')}</div>`);
    } else {
      parts.push(`<h3>${roleName}</h3>`);
    }
    parts.push(factoryJobsHtml(d, role, o.timers || {}, o.nowMs || Date.now()));
    parts.push('<div class="card"><h3>다른 작업 기록</h3><p class="muted">목록에 없는 작업도 수량과 걸린 시간을 남겨 주세요.</p>' +
      `<div class="fw-form"><label class="full">무엇을 <input type="text" id="fwFreeLabel" maxlength="${WORKLOG_LIMITS.label}" placeholder="예: 싱크대 추가 재단" /></label>` +
      '<label>수량 <input type="number" inputmode="decimal" id="fwFreeUnits" min="0" step="1" /></label>' +
      '<label>걸린 시간 (분) <input type="number" inputmode="decimal" id="fwFreeMinutes" min="0" step="1" /></label></div>' +
      `<button type="button" class="big go" data-act="fw-free">${roleName} 기록하기</button></div>`);
    const logs = (d && d.logs) || [];
    const logRow = (l) =>
      `<div class="fw-log"><span>${esc(FACTORY_ROLE_LABEL[l.role] || l.role)} · ${esc(l.order_label || '-')}</span><span>${esc(toNum(l.units))} · ${esc(toNum(l.minutes))}분</span></div>`;
    parts.push(`<div class="card"><h3>오늘 내 기록</h3>${logs.length ? logs.map(logRow).join('') : '<p class="empty">아직 없습니다.</p>'}</div>`);
    return parts.join('');
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
    // 정지(suspended)는 따로 막는 화면 없이 viewApp + 맨 위 안내 (1주차 후속 D)
    const VIEWS = ['viewLoading', 'viewLogin', 'viewRegister', 'viewPending', 'viewRejected', 'viewNotReady', 'viewError', 'viewLink', 'viewApp'];
    let sb = null;
    let me = null;
    let route = parseHash(location.hash);
    let invite = null;
    /** 마지막으로 그린 목록 탭 — #job= 로 바로 들어왔으면 null (그때 '← 목록으로' 는 backTabFor 가 고른다) */
    let listTab = null;
    let currentJob = null;
    let seq = 0;
    let alertTimer = null;
    /** 마지막으로 받은 GET /work/factory (공장 탭) */
    let factoryData = null;

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
      const h = { Authorization: `Bearer ${t}`, ...(o.headers || {}) };
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

    // 이 기기 저장소 — 못 쓰면(사생활 보호 모드 등) 이번 접속 동안만 메모리에
    const mem = {};
    const store = {
      get(k) {
        try {
          const v = window.localStorage.getItem(k);
          if (v !== null) return v;
        } catch (e) { /* 메모리만 */ }
        return k in mem ? mem[k] : null;
      },
      set(k, v) {
        if (v === null) delete mem[k];
        else mem[k] = v;
        try {
          if (v === null) window.localStorage.removeItem(k);
          else window.localStorage.setItem(k, v);
        } catch (e) { /* 메모리만 */ }
      },
    };
    /** 공장 탭을 보이나 — 승인된 작업자이고, 공장 배정이 있거나 이 기기에 이을 생산 링크가 있을 때 */
    const factoryShown = () => !!(me && me.worker && me.worker.status === 'approved' && (me.factory || store.get(LINK_TOKEN_KEY)));

    function showLogin() {
      const appEl = $('workerApp');
      const page = (appEl && appEl.getAttribute('data-page')) || 'worker.html';
      const login = (appEl && appEl.getAttribute('data-login')) || 'login.html';
      const target = returnTarget(route, invite, page);
      $('loginLink').href = loginHref(target, login);
      $('loginInviteNote').hidden = !invite;
      sub('로그인이 필요합니다');
      show('viewLogin');
    }

    /** 초대한 팩토리 이름을 신청서 안내에 — 못 읽으면 원래 글 그대로 */
    async function nameInvite() {
      const token = invite;
      if (!token) return;
      try {
        const peek = await api('/work/invites/peek', { method: 'POST', body: { token } });
        if (invite === token && peek && peek.company_name)
          $('regInviteNote').textContent = `${peek.company_name}의 초대 링크로 신청합니다. 초대에 작업 종류가 정해져 있으면 그 종류로 등록됩니다. ${peek.company_name}에서 승인하면 작업을 볼 수 있습니다.`;
      } catch (e) { /* 원래 글 그대로 */ }
    }

    function showRegister() {
      $('regInviteNote').hidden = !invite;
      nameInvite();
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
        $('pendingInfo').innerHTML = pendingInfoHtml(w, me && me.links);
        show('viewPending');
      } else if (view === 'rejected') {
        sub(`${w.display_name} 님`);
        $('rejectReason').textContent = w.reject_reason ? `사유: ${w.reject_reason}` : '';
        show('viewRejected');
      } else if (view === 'approved' || view === 'suspended') {
        // 정지도 같은 앱 화면 — 맨 위 안내 + 모집중 탭 · 신청 · 수락만 빠진다 (renderRoute 가 맞춘다)
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
      const suspended = isSuspended(me);
      const nav = $('tabs');
      const factory = factoryShown();
      nav.classList.toggle('three', suspended);
      nav.classList.toggle('five', factory && !suspended);
      nav.innerHTML = tabsHtml(active, me && me.counts, suspended, factory);
    }

    async function renderRoute() {
      const mySeq = ++seq;
      const body = $('appBody');
      const suspended = isSuspended(me);
      $('suspendedNote').hidden = !suspended;
      const factory = factoryShown();
      const listBack = () => listTab || defaultTab(null, me && me.counts, suspended, factory);
      window.scrollTo(0, 0);
      if (route.badJob) {
        currentJob = null;
        renderTabs(null);
        body.innerHTML = `<a class="back" href="#tab=${listBack()}">← 목록으로</a><div class="card empty">작업 링크가 올바르지 않습니다.</div>`;
        return;
      }
      if (route.job) {
        currentJob = route.job;
        renderTabs(null);
        body.innerHTML = '<div class="card empty">불러오는 중…</div>';
        try {
          const d = await api(`/work/jobs/${route.job}`);
          if (mySeq !== seq) return;
          body.innerHTML = jobDetailHtml(d, Date.now(), backTabFor(d, listTab, suspended, factory), { suspended });
        } catch (err) {
          if (mySeq !== seq) return;
          if (await handleAuthError(err)) return;
          const msg = err.status === 404 ? '작업을 찾을 수 없습니다. 마감됐거나 볼 수 없는 작업입니다.' : err.message;
          body.innerHTML = `<a class="back" href="#tab=${listBack()}">← 목록으로</a><div class="card empty">${esc(msg)}</div>`;
        }
        return;
      }
      currentJob = null;
      const tab = defaultTab(route, me && me.counts, suspended, factory);
      listTab = tab;
      renderTabs(tab);
      if (tab === 'me') {
        const appEl = $('workerApp');
        body.innerHTML = workerInfoHtml(me && me.worker, (appEl && appEl.getAttribute('data-mypage')) || 'mypage.html', me && me.links);
        return;
      }
      if (tab === 'factory') {
        await renderFactory(mySeq);
        return;
      }
      body.innerHTML = '<div class="card empty">불러오는 중…</div>';
      try {
        const data = await api(`/work/jobs?tab=${tab}`);
        if (mySeq !== seq) return;
        body.innerHTML = jobListHtml(data && data.items, tab, Date.now());
        // 내 작업을 열면 서버가 새 소식을 읽음으로 센다 — 배지를 다시 받는다
        if (tab === 'mine' && me && me.counts && toNum(me.counts.newEvents)) {
          refreshMe().then(() => { if (mySeq === seq) renderTabs(tab); }).catch(() => {});
        }
      } catch (err) {
        if (mySeq !== seq) return;
        if (await handleAuthError(err)) return;
        body.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
      }
    }

    // ── 공장 탭 ──
    async function renderFactory(mySeq) {
      checks = null;
      const body = $('appBody');
      if (!(me && me.factory)) {
        factoryData = null;
        body.innerHTML = factoryLinkHtml();
        return;
      }
      body.innerHTML = '<div class="card empty">불러오는 중…</div>';
      try {
        const d = await api('/work/factory');
        if (mySeq !== seq) return;
        factoryData = d;
        drawFactory();
      } catch (err) {
        if (mySeq !== seq) return;
        if (await handleAuthError(err)) return;
        body.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
      }
    }
    const factoryRole = () => factoryRoleOf(factoryData && factoryData.roles, store.get(FACTORY_ROLE_KEY));
    /** 필수 확인 화면 — { base: '/work/factory/orders/<id>' | '/work/assignments/<id>', data } (null 이면 원래 화면) */
    let checks = null;
    async function openChecks(base) {
      try {
        checks = { base, data: await api(`${base}/checks`) };
        $('appBody').innerHTML = checksHtml(checks.data);
      } catch (err) {
        if (await handleAuthError(err)) return;
        say(err.message);
      }
    }
    /** 꾸러미 HTML 은 로그인이 필요해 새 창 주소로 바로 열 수 없다 — 받아서 새 창에 쓴다 (상세설계 인쇄와 같은 방식) */
    async function openPack(path) {
      const win = window.open('', '_blank');
      if (!win) {
        say('새 창이 막혀 지시서를 열지 못했습니다. 팝업을 허용해 주세요.');
        return;
      }
      try {
        const t = await token();
        if (!t) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
        const res = await fetch(API + path, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
        if (!res.ok) {
          let msg = `지시서를 열지 못했습니다 (${res.status})`;
          try { const b = await res.json(); if (b && b.message) msg = b.message; } catch (e) { /* 본문 없음 */ }
          throw Object.assign(new Error(msg), { status: res.status });
        }
        const html = await res.text();
        win.document.open();
        win.document.write(html);
        win.document.close();
      } catch (err) {
        win.close();
        if (await handleAuthError(err)) return;
        say(err.message);
      }
    }
    function drawFactory() {
      const role = factoryRole();
      const timers = {};
      ((factoryData && factoryData.work && factoryData.work[role]) || []).forEach((j) => {
        const v = store.get(factoryTimerKey(role, j.orderId));
        if (v) timers[j.orderId] = v;
      });
      $('appBody').innerHTML = factoryHtml(factoryData, { role, timers, nowMs: Date.now() });
    }
    /** 실측 기록 보내기 — 값이 틀리면 보내지 않는다. 보내면 공장 탭을 다시 받는다 (act) */
    function sendWorklog(values, onOk) {
      const { body, errors } = worklogBody(values);
      if (errors.length) {
        say(errors.join(' '));
        return;
      }
      act(async () => {
        await api('/work/factory/worklogs', { method: 'POST', body });
        if (onOk) onOk();
      }, `${FACTORY_ROLE_LABEL[values.role] || ''} 기록했습니다.`);
    }
    /** 「내 계정에 잇기」 — 이 기기의 생산 링크 토큰을 X-Worker-Token 으로. 틀리거나 끊긴 링크(410)는 이 기기에서 지운다 */
    async function linkAccount() {
      const tok = store.get(LINK_TOKEN_KEY);
      if (!tok) {
        await renderRoute();
        return;
      }
      const buttons = $('appBody').querySelectorAll('button');
      buttons.forEach((c) => { c.disabled = true; });
      try {
        await api('/work/factory/link', { method: 'POST', body: {}, headers: { 'X-Worker-Token': tok } });
        store.set(LINK_TOKEN_KEY, null);
        say('생산 링크를 내 계정에 이었습니다. 이제 「공장」 탭에서 기록합니다.', true);
        await refreshMe();
        await renderRoute();
      } catch (err) {
        buttons.forEach((c) => { c.disabled = false; });
        if (err.status === 410) {
          store.set(LINK_TOKEN_KEY, null);
          say(err.message);
          await renderRoute();
          return;
        }
        if (await handleAuthError(err)) return;
        say(err.message);
      }
    }
    function onFactoryAct(what, b) {
      const order = b.getAttribute('data-order');
      if (what === 'fw-pack' && isUuid(order)) {
        openPack(`/work/factory/orders/${order}/pack?pack=${encodeURIComponent(b.getAttribute('data-pack') || '')}`);
        return;
      }
      if (what === 'fw-checks' && isUuid(order)) {
        openChecks(`/work/factory/orders/${order}`);
        return;
      }
      if (what === 'fw-link') {
        linkAccount();
        return;
      }
      if (what === 'fw-role') {
        store.set(FACTORY_ROLE_KEY, b.getAttribute('data-role'));
        drawFactory();
        return;
      }
      const role = factoryRole();
      if (!role) return;
      if (what === 'fw-free') {
        sendWorklog({ role, order_label: $('fwFreeLabel').value, units: $('fwFreeUnits').value, minutes: $('fwFreeMinutes').value });
        return;
      }
      const i = Number(b.getAttribute('data-i'));
      const job = ((factoryData && factoryData.work && factoryData.work[role]) || [])[i];
      if (!job) return;
      const key = factoryTimerKey(role, job.orderId);
      if (what === 'fw-start') {
        store.set(key, String(Date.now()));
        drawFactory();
      } else if (what === 'fw-cancel') {
        store.set(key, null);
        drawFactory();
      } else if (what === 'fw-done') {
        sendWorklog(
          { role, order_id: job.orderId, order_label: job.label, units: $(`fwU${i}`).value, minutes: $(`fwM${i}`).value },
          () => store.set(key, null)
        );
      }
    }

    /**
     * 로그인 만료(401) · 자격 변경(403) — 처음 화면부터 다시.
     * 403 이면 /work/me 를 다시 받아, 자격이 그대로면 false (부르는 쪽이 서버 문구를 보여 준다 — 같은 403 이 되풀이되지 않게).
     * 바뀌었으면(예: 쓰는 도중 정지됨) 새 상태로 다시 그리고 서버 문구를 띄운다.
     */
    async function handleAuthError(err) {
      if (err.status === 401) {
        showLogin();
        return true;
      }
      if (err.status === 403) {
        const before = me && me.worker ? me.worker.status : null;
        try {
          await refreshMe();
        } catch (e) {
          say(e.message);
          return true;
        }
        const after = me && me.worker ? me.worker.status : null;
        if (after === before && (after === 'approved' || after === 'suspended')) return false;
        renderWorkerState();
        say(err.message);
        return true;
      }
      return false;
    }

    /**
     * 버튼을 잠그고 요청 → 성공 문구 → 상세 · 건수 다시 받기.
     * 409(상태가 이미 바뀜 — 예: 서버 기준으로 지원 종료일이 지남)면 서버 문구를 띄우고 상세를 다시 받는다
     * (화면이 옛 상태로 남아 같은 409 를 되풀이하지 않게).
     */
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
        if (err.status === 409) await renderRoute();
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
        // 이미 작업자 — 신청서 없이 그 팩토리와 연결만 신청한다 (2026-11-13). 먼저 어느 팩토리인지 묻는다
        let peek = null;
        try {
          peek = await api('/work/invites/peek', { method: 'POST', body: { token: invite } });
        } catch (err) {
          if (err.status === 401) {
            showLogin();
            return;
          }
          dropInvite();
          // 초대가 못 쓰게 된 것(거둠 · 만료 · 사용됨 · 없음)이면 서버 글, 그 밖(옛 서버 등)은 예전 안내
          const dead = (err.status === 410 || err.status === 404) && /초대/.test(err.message || '');
          say(dead ? err.message : '이미 작업자로 등록돼 있어 초대 링크는 쓰지 않았습니다.', !dead);
        }
        if (peek && (peek.link_status === 'approved' || peek.link_status === 'suspended')) {
          dropInvite();
          say(`이미 연결된 팩토리입니다 — ${peek.company_name || '초대한 팩토리'}`, true);
        } else if (peek) {
          $('linkTitle').textContent = `${peek.company_name || '팩토리'} 연결`;
          $('linkText').textContent = linkAskText(peek);
          $('linkGo').setAttribute('data-name', peek.company_name || '');
          sub(`${me.worker.display_name} 님 · 팩토리 초대`);
          show('viewLink');
          return;
        }
      }
      renderWorkerState();
    }

    function dropInvite() {
      storeInvite(null);
      invite = null;
    }

    // ── 팩토리 연결 신청 (이미 작업자 + 초대 링크) ──
    $('linkGo').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!invite) {
        renderWorkerState();
        return;
      }
      const name = btn.getAttribute('data-name') || '그 팩토리';
      btn.disabled = true;
      try {
        await api('/work/claim-invite', { method: 'POST', body: { token: invite } });
        dropInvite();
        await refreshMe().catch(() => {});
        say(`연결을 신청했습니다. ${name}에서 승인하면 그 팩토리의 작업이 보입니다.`, true);
        renderWorkerState();
      } catch (err) {
        if (err.status === 401) {
          showLogin();
        } else {
          dropInvite();
          say(err.message);
          renderWorkerState();
        }
      } finally {
        btn.disabled = false;
      }
    });
    $('linkSkip').addEventListener('click', () => {
      dropInvite();
      renderWorkerState();
    });

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
      if (what && what.indexOf('fw-') === 0) {
        onFactoryAct(what, b);
        return;
      }
      if (what === 'ck-back') {
        checks = null;
        renderRoute();
        return;
      }
      if (what === 'ck-photo' && checks) {
        sendCheck(b, true, true).catch(async (err) => {
          if (await handleAuthError(err)) return;
          say(err.message);
          if (err.status === 409) await openChecks(checks.base);
        });
        return;
      }
      if (!isUuid(id)) return;
      if (what === 'as-pack') {
        openPack(`/work/assignments/${id}/pack`);
        return;
      }
      if (what === 'as-checks') {
        openChecks(`/work/assignments/${id}`);
        return;
      }
      if (what === 'withdraw') {
        if (!window.confirm('신청을 철회할까요?')) return;
        act(() => api(`/work/applications/${id}/withdraw`, { method: 'POST', body: {} }), '신청을 철회했습니다.');
      } else if (what === 'confirm') {
        act(() => api(`/work/assignments/${id}/confirm`, { method: 'POST', body: {} }), '수락했습니다. 확정됐습니다.');
      } else if (what === 'start') {
        act(() => api(`/work/assignments/${id}/start`, { method: 'POST', body: {} }), '작업을 시작했습니다.');
      }
    });

    // 필수 확인 체크 — 보내고 다시 받는다 (칸마다 마지막 줄이 지금 값). 지시서가 새 판이면(409) 새 판으로 다시 연다.
    //   사진 필수 항목은 체크할 때 사진 고르기를 열고, 사진을 올린 뒤 그 경로를 붙여 체크한다 (취소하면 되돌린다)
    /** 사진 한 장 올리기 → photo_path (본문 = 줄인 사진) */
    async function uploadCheckPhoto(base, file) {
      const t = await token();
      if (!t) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
      const blob = await shrinkPhoto(file);
      const res = await fetch(`${API}${base}/checks/photo`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': blob.type || 'image/jpeg' }, body: blob, cache: 'no-store' });
      let body = null;
      try { body = await res.json(); } catch (e) { body = null; }
      if (!res.ok || !body || !body.success) throw Object.assign(new Error((body && body.message) || `사진을 올리지 못했습니다 (${res.status})`), { status: res.status });
      return body.data.photo_path;
    }
    /** 사진 고르기 창 — 고르면 File, 취소하면 null */
    function pickPhoto() {
      const input = $('ckPhotoFile');
      if (!input) return Promise.resolve(null);
      input.value = '';
      return new Promise((ok) => {
        const done = () => { window.removeEventListener('focus', onFocus); ok(input.files && input.files[0] ? input.files[0] : null); };
        const onFocus = () => setTimeout(() => { if (!(input.files && input.files.length)) done(); }, 800);
        input.onchange = done;
        window.addEventListener('focus', onFocus);
        input.click();
      });
    }
    async function sendCheck(el, checked, withPhoto) {
      const base = checks.base;
      const body = { document_id: checks.data.document.id, role: el.getAttribute('data-ck-role'), scope_key: el.getAttribute('data-ck-scope'), item_key: el.getAttribute('data-ck-item'), checked };
      if (checked && withPhoto) {
        const file = await pickPhoto();
        if (!file) throw Object.assign(new Error('사진을 고르지 않아 체크하지 않았습니다.'), { status: 0, quiet: true });
        say('사진을 올리는 중…', true);
        body.photo_path = await uploadCheckPhoto(base, file);
      }
      await api(`${base}/checks`, { method: 'POST', body });
      await openChecks(base);
    }
    appBody.addEventListener('change', async (e) => {
      const c = e.target && e.target.closest && e.target.closest('input[data-ck-item]');
      if (!c || !checks) return;
      try {
        await sendCheck(c, c.checked, c.getAttribute('data-ck-photo') === 'need');
      } catch (err) {
        c.checked = !c.checked;
        if (await handleAuthError(err)) return;
        say(err.message);
        if (err.status === 409) await openChecks(checks.base);
      }
    });

    // 오늘 지시 체크 — 보내고 성공하면 줄만 바꾼다 (다시 그리면 입력 중인 수량 · 시간이 지워진다), 실패하면 되돌린다
    appBody.addEventListener('change', async (e) => {
      const c = e.target && e.target.closest && e.target.closest('input[data-fa]');
      if (!c) return;
      const id = c.getAttribute('data-fa');
      if (!isUuid(id)) return;
      try {
        await api(`/work/factory/assignments/${id}/done`, { method: 'POST', body: { done: c.checked } });
        c.closest('label').classList.toggle('done', c.checked);
      } catch (err) {
        c.checked = !c.checked;
        if (await handleAuthError(err)) return;
        say(err.message);
      }
    });
    // 진행 시간 글자만 30초마다 — 다시 그리면 입력 중인 값이 지워진다
    setInterval(() => {
      document.querySelectorAll('#appBody .fw-run[data-since]').forEach((el) => {
        el.textContent = `진행 중 · ${elapsedMin(el.getAttribute('data-since'), Date.now())}분째`;
      });
    }, 30000);

    window.addEventListener('hashchange', () => {
      const next = parseHash(location.hash);
      if (next.invite) {
        // 로그인한 채로 다른 초대 링크를 열었다 — 처음부터 다시
        boot();
        return;
      }
      route = next;
      const st = me && me.worker && me.worker.status;
      if ((st === 'approved' || st === 'suspended') && !$('viewApp').hidden) renderRoute();
    });

    boot();
  }

  return Object.freeze({
    KINDS,
    WORKER_KINDS,
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
    SUSPENDED_NOTE,
    DEADLINE_NONE,
    FACTORY_ROLE_LABEL,
    LINK_TOKEN_KEY,
    FACTORY_ROLE_KEY,
    factoryTimerKey,
    esc,
    fmtDate,
    fmtTime,
    fmtDateTime,
    fmtRange,
    ddayLabel,
    deadlinePassed,
    deadlineTag,
    deadlineTagHtml,
    deadlineLineHtml,
    deadlineFactHtml,
    parseHash,
    returnTarget,
    loginHref,
    selectView,
    isSuspended,
    tabsFor,
    defaultTab,
    backTabFor,
    registrationBody,
    payText,
    myStatus,
    releaseReasonHtml,
    jobCardHtml,
    jobListHtml,
    tabsHtml,
    availableActions,
    stateText,
    timelineHtml,
    jobDetailHtml,
    workerInfoHtml,
    pendingInfoHtml,
    LINK_STATUS_LABEL,
    siteHtml,
    telOf,
    SITE_OPEN_NOTE,
    linksHtml,
    linkAskText,
    factoryDay,
    factoryRoleOf,
    worklogBody,
    factoryLinkHtml,
    factoryJobsHtml,
    factoryDocButtons,
    checksHtml,
    factoryHtml,
    storeInvite,
    loadInvite,
    start,
  });
});
