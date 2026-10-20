/**
 * 작업 배정 관리자 화면(admin/work-jobs.html) 공용 — 이름표 · 보드 묶기 · 카드/행 HTML · 공유 문구 · 입력 검사.
 * 계약: docs/01-plan/worker-portal-contract.md §1 상태 · §3 관리자 API · §4 화면.
 *
 * 순수 함수만 둔다 (브라우저 전역 `DadamWorkJobsAdmin`, Node(Jest) 는 module.exports).
 * 화면에 넣는 사용자 글(작업자 이름 · 제목 · 보고 본문 · 메모 · 사유)은 전부 esc() 를 거친다.
 * 현장 주소 · 연락처는 이 화면에서 받지도 보여 주지도 않는다 (★7 공개 기간 미정 — 계약 머리말).
 *
 * 서버 응답 모양 (계약 §3 은 이름만 정했다 — 이 화면이 읽는 열):
 *   AdminJobCard   { id, kind, title, status, effective_status, region_label, starts_at, ends_at, apply_deadline,
 *                    slots, filled, applied_count, mode, pay_amount, pay_unit, pay_visible, version }
 *   AdminJobDetail { job: AdminJob, applications[], assignments[], updates[], events[] } — 또는 작업 열을 펼친 모양
 *   신청 · 배정 행  { id, status, worker_id, worker: { id, display_name, kinds, region_label, done_count }, … }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamWorkJobsAdmin = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── 이름표 (계약 §1 · §2 의 CHECK 값) ──
  const KINDS = Object.freeze(['install', 'as', 'assembly']);
  const KIND_LABEL = Object.freeze({ install: '설치', as: 'A/S', assembly: '조립 추가 인원' });
  const JOB_STATUS_LABEL = Object.freeze({
    draft: '초안', open: '모집중', expired: '마감', filled: '배정', in_progress: '진행',
    review: '검수대기', done: '완료', closed: '닫힘', cancelled: '취소',
  });
  const APP_STATUS_LABEL = Object.freeze({ applied: '신청', approved: '선정', rejected: '반려', withdrawn: '철회' });
  const ASSIGN_STATUS_LABEL = Object.freeze({
    offered: '초대함 (수락 대기)', confirmed: '확정', declined: '거절', started: '작업 중', submitted: '완료 보고',
    revision: '보완요청', accepted: '승인', released: '포기', removed: '제외',
  });
  const WORKER_STATUS_LABEL = Object.freeze({ pending: '승인 대기', approved: '승인', suspended: '정지', rejected: '반려' });
  const UPDATE_KIND_LABEL = Object.freeze({
    progress: '진행 보고', issue: '문제 보고', result: '완료 보고', correction: '회사 정정', note: '회사 메모',
  });
  const MODE_LABEL = Object.freeze({ open: '모집 (신청 받기)', invite: '지정 초대', direct: '직접 배정' });
  const PAY_UNIT_LABEL = Object.freeze({ day: '일', hour: '시간', meter: 'm', job: '건' });
  const VIA_LABEL = Object.freeze({ application: '신청에서 선정', invite: '직접 초대' });
  const ACTOR_LABEL = Object.freeze({ worker: '작업자', admin: '관리자', system: '시스템' });

  /** 정원 계산에 드는 배정 (계약 §1) */
  const COUNTED = Object.freeze(['confirmed', 'started', 'submitted', 'revision', 'accepted']);
  /** 활성 배정 (계약 §1) */
  const ACTIVE = Object.freeze(['offered', 'confirmed', 'started', 'submitted', 'revision', 'accepted']);
  /** 끝난 작업 — 취소 · 초대를 더 받지 않는다 (계약 §3 cancel 은 done 전만) */
  const FINISHED = Object.freeze(['done', 'closed', 'cancelled']);

  /** 보드 열 (계약 §4) — `expired` 는 저장하지 않고 API 가 effective_status 로 준다. 닫힘은 완료 열에 함께 */
  const BOARD_COLUMNS = Object.freeze([
    { key: 'draft', label: '초안', statuses: ['draft'] },
    { key: 'open', label: '모집중', statuses: ['open'] },
    { key: 'expired', label: '마감 (신청 마감 지남)', statuses: ['expired'] },
    { key: 'filled', label: '배정', statuses: ['filled'] },
    { key: 'in_progress', label: '진행', statuses: ['in_progress'] },
    { key: 'review', label: '검수대기', statuses: ['review'] },
    { key: 'done', label: '완료', statuses: ['done', 'closed'] },
  ]);
  const CANCELLED_COLUMN = Object.freeze({ key: 'cancelled', label: '취소', statuses: ['cancelled'] });

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  const KST_MS = 9 * 3600 * 1000;
  const DAY_MS = 86400000;

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const label = (map, key) => (key ? map[key] || String(key) : '');
  const kindLabel = (k) => label(KIND_LABEL, k);
  const kindsText = (list) => (Array.isArray(list) && list.length ? list.map(kindLabel).join(' · ') : '종류 없음');
  const num = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? null : Number(n));
  function firstNum() {
    for (let i = 0; i < arguments.length; i++) {
      const n = num(arguments[i]);
      if (n !== null) return n;
    }
    return null;
  }

  // ── 날짜 (화면은 한국 시간) ──
  function kstParts(iso) {
    const t = Date.parse(iso);
    if (!iso || !Number.isFinite(t)) return null;
    const d = new Date(t + KST_MS);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
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
  /** ISO → <input type="datetime-local"> 값 (한국 시간) */
  function toKstInput(iso) {
    const t = Date.parse(iso);
    if (!iso || !Number.isFinite(t)) return '';
    return new Date(t + KST_MS).toISOString().slice(0, 16);
  }
  /** <input type="datetime-local"> 값(한국 시간) → ISO. 빈 값은 null, 잘못된 값은 오류 */
  function fromKstInput(v) {
    const s = String(v || '').trim();
    if (!s) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) throw new Error(`날짜 · 시간 형식이 아닙니다: ${s}`);
    const t = Date.parse(`${s.length === 16 ? `${s}:00` : s}+09:00`);
    if (!Number.isFinite(t)) throw new Error(`날짜 · 시간 형식이 아닙니다: ${s}`);
    return new Date(t).toISOString();
  }

  // ── 상태 ──
  /**
   * 화면에 쓰는 작업 상태. API 의 effective_status 가 정본이고, 없으면 계약 §1 의 식
   * (`open` 이고 apply_deadline < 지금 → expired) 을 그대로 쓴다.
   */
  function effectiveStatus(job, nowMs) {
    if (!job) return '';
    if (job.effective_status) return job.effective_status;
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const dl = Date.parse(job.apply_deadline);
    if (job.status === 'open' && Number.isFinite(dl) && dl < now) return 'expired';
    return job.status || 'draft';
  }

  /** 확정 수 · 신청 수 — 목록 카드는 숫자 열, 상세는 배열에서 센다 */
  function jobCounts(job, detail) {
    const d = detail || {};
    const filled = Array.isArray(d.assignments)
      ? d.assignments.filter((a) => COUNTED.includes(a.status)).length
      : firstNum(job && job.filled, job && job.confirmed_count);
    const applied = Array.isArray(d.applications)
      ? d.applications.filter((a) => a.status === 'applied').length
      : firstNum(job && job.applied_count, job && job.applications_count, job && job.application_count);
    return { filled, applied, slots: firstNum(job && job.slots) };
  }

  /** 상세 응답 → { job, applications, assignments, updates, events } (감싼 모양 · 펼친 모양 둘 다) */
  function splitDetail(d) {
    const src = d || {};
    const job = src.job && typeof src.job === 'object' ? src.job : src;
    const arr = (k) => (Array.isArray(src[k]) ? src[k] : Array.isArray(job[k]) ? job[k] : []);
    return { job, applications: arr('applications'), assignments: arr('assignments'), updates: arr('updates'), events: arr('events') };
  }

  /** 신청 · 배정 행의 작업자 — 행 안의 worker 객체 또는 펼친 열 */
  function workerOf(row) {
    const r = row || {};
    const w = r.worker && typeof r.worker === 'object' ? r.worker : {};
    return {
      id: w.id || r.worker_id || null,
      name: w.display_name || r.worker_name || r.worker_display_name || r.worker_name_snapshot || '',
      kinds: Array.isArray(w.kinds) ? w.kinds : Array.isArray(r.worker_kinds) ? r.worker_kinds : [],
      region: w.region_label || r.worker_region_label || '',
      done: firstNum(w.done_count, r.done_count, w.jobs_done, r.jobs_done),
    };
  }

  /**
   * 보드 묶기 — 종류 거르기, 취소는 보일 때만, 열 안은 작업 시작이 빠른 순(날짜 없으면 뒤).
   * @returns {{key:string,label:string,items:object[]}[]}
   */
  function groupBoard(items, opts) {
    const o = opts || {};
    const cols = o.showCancelled ? [...BOARD_COLUMNS, CANCELLED_COLUMN] : BOARD_COLUMNS;
    const list = (Array.isArray(items) ? items : []).filter((j) => !o.kind || j.kind === o.kind);
    const t = (j) => {
      const v = Date.parse(j.starts_at);
      return Number.isFinite(v) ? v : Infinity;
    };
    return cols.map((c) => ({
      key: c.key,
      label: c.label,
      items: list.filter((j) => c.statuses.includes(effectiveStatus(j, o.now))).sort((a, b) => t(a) - t(b)),
    }));
  }

  // ── 버튼 판단 (서버가 정본 — 화면은 맞지 않는 버튼을 감출 뿐) ──
  function jobActions(job, nowMs) {
    const st = job ? job.status : '';
    const eff = effectiveStatus(job, nowMs);
    return {
      publish: st === 'draft',
      edit: st === 'draft' || st === 'open',
      cancel: Boolean(st) && !FINISHED.includes(st),
      close: st === 'done',
      share: Boolean(st) && !['draft', 'closed', 'cancelled'].includes(st),
      invite: Boolean(st) && !FINISHED.includes(st) && st !== 'review',
      recruiting: eff === 'open',
    };
  }
  function assignmentActions(a, job) {
    const st = a ? a.status : '';
    const kind = job ? job.kind : '';
    return {
      accept: st === 'submitted' && kind !== 'assembly',
      revision: st === 'submitted',
      remove: ['offered', 'confirmed', 'started', 'submitted', 'revision'].includes(st),
    };
  }
  /** 작업자 상태 전이 (계약 §1: pending → approved/rejected, approved ↔ suspended) */
  function workerActions(w) {
    const st = w ? w.status : '';
    return { approve: st === 'pending', reject: st === 'pending', suspend: st === 'approved', resume: st === 'suspended' };
  }

  // ── HTML 조각 ──
  const badge = (map, status, cls) => (status ? `<span class="badge st-${esc(status)}${cls ? ` ${esc(cls)}` : ''}">${esc(label(map, status))}</span>` : '');
  const kindChip = (k) => `<span class="kind-chip kind-${esc(k)}">${esc(kindLabel(k))}</span>`;

  function payText(job) {
    const amt = num(job && job.pay_amount);
    if (amt === null) return '금액 없음';
    const unit = job.pay_unit ? ` / ${PAY_UNIT_LABEL[job.pay_unit] || job.pay_unit}` : '';
    return `${amt.toLocaleString('ko-KR')}원${unit} · ${job.pay_visible ? '작업자에게 공개' : '작업자에게 숨김'}`;
  }

  /** 보드 카드 — 날짜 · 종류 · 시/구 · 확정 n/정원 · 신청 수 (계약 §4) */
  function jobCardHtml(job, opts) {
    const o = opts || {};
    const eff = effectiveStatus(job, o.now);
    const c = jobCounts(job);
    const dday = FINISHED.includes(job.status) ? '' : ddayLabel(job.starts_at, o.now);
    const filledText = `확정 ${c.filled === null ? '-' : c.filled}/${c.slots === null ? '-' : c.slots}`;
    const appliedText = `신청 ${c.applied === null ? '-' : c.applied}`;
    return `<button type="button" class="job-card" data-job="${esc(job.id)}">`
      + `<span class="jc-top">${kindChip(job.kind)}${dday ? `<span class="dday">${esc(dday)}</span>` : ''}${eff === 'closed' ? badge(JOB_STATUS_LABEL, 'closed') : ''}</span>`
      + `<span class="jc-title">${esc(job.title)}</span>`
      + `<span class="jc-meta">${esc(fmtRange(job.starts_at, job.ends_at))}${job.region_label ? ` · ${esc(job.region_label)}` : ''}</span>`
      + `<span class="jc-meta">${esc(filledText)} · ${esc(appliedText)}</span>`
      + '</button>';
  }

  /** 신청자 한 줄 — [선정] · [반려] 는 편집자에게, 신청 상태일 때만 */
  function applicantRowHtml(app, opts) {
    const o = opts || {};
    const w = workerOf(app);
    const meta = [kindsText(w.kinds), w.region || '지역 미입력', w.done === null ? '' : `실적 ${w.done}건`].filter(Boolean).join(' · ');
    const can = o.canEdit && app.status === 'applied';
    return `<div class="row" data-app="${esc(app.id)}">`
      + `<div class="row-main"><b>${esc(w.name || '(이름 없음)')}</b> ${badge(APP_STATUS_LABEL, app.status)}`
      + `<div class="muted">${esc(meta)} · 신청 ${esc(fmtDateTime(app.created_at))}</div>`
      + `${app.message ? `<div class="pre">${esc(app.message)}</div>` : ''}`
      + `${app.decide_reason ? `<div class="muted">사유: ${esc(app.decide_reason)}</div>` : ''}</div>`
      + `<div class="row-actions">${can ? `<button type="button" class="btn btn-primary btn-sm" data-act="app-approve" data-id="${esc(app.id)}">선정</button>`
        + `<button type="button" class="btn btn-light btn-sm" data-act="app-reject" data-id="${esc(app.id)}">반려</button>` : ''}</div>`
      + '</div>';
  }

  /** 배정 한 줄 — [승인] · [보완요청] · [제외] */
  function assignmentRowHtml(a, opts) {
    const o = opts || {};
    const w = workerOf(a);
    const act = assignmentActions(a, o.job);
    const facts = [
      label(VIA_LABEL, a.via),
      a.started_at ? `시작 ${fmtDateTime(a.started_at)}` : '',
      a.submitted_at ? `보고 ${fmtDateTime(a.submitted_at)}` : '',
      a.accepted_at ? `승인 ${fmtDateTime(a.accepted_at)}` : '',
      num(a.revision_count) ? `보완요청 ${num(a.revision_count)}회` : '',
    ].filter(Boolean).join(' · ');
    const btns = o.canEdit ? [
      act.accept ? `<button type="button" class="btn btn-primary btn-sm" data-act="asg-accept" data-id="${esc(a.id)}">승인</button>` : '',
      act.revision ? `<button type="button" class="btn btn-light btn-sm" data-act="asg-revision" data-id="${esc(a.id)}">보완요청</button>` : '',
      act.remove ? `<button type="button" class="btn btn-light btn-sm" data-act="asg-remove" data-id="${esc(a.id)}">제외</button>` : '',
    ].join('') : '';
    return `<div class="row" data-asg="${esc(a.id)}">`
      + `<div class="row-main"><b>${esc(w.name || '(이름 없음)')}</b> ${badge(ASSIGN_STATUS_LABEL, a.status)}${a.no_show ? ' <span class="badge st-no-show">노쇼 기록</span>' : ''}`
      + `<div class="muted">${esc(facts)}</div>`
      + `${a.release_reason ? `<div class="muted">사유: ${esc(a.release_reason)}</div>` : ''}</div>`
      + `<div class="row-actions">${btns}</div>`
      + '</div>';
  }

  const excerpt = (s, n) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };

  /**
   * 기록 타임라인 (★5 가 · 나) — 작업자 보고와 회사 정정 · 메모를 한 줄로, 오래된 것부터.
   * 정정은 원본을 고치지 않고 아래에 쌓인다 (amends_id 로 가리킴). 작업자에게 숨긴 기록은 표시.
   * @param {object[]} updates
   * @param {{ names?: Record<string,string>, canEdit?: boolean }} opts names = 배정 id → 작업자 이름
   */
  function timelineHtml(updates, opts) {
    const o = opts || {};
    const names = o.names || {};
    const list = (Array.isArray(updates) ? updates : []).slice().sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
    if (!list.length) return '<div class="empty-mini">아직 기록이 없습니다.</div>';
    const byId = new Map(list.map((u) => [u.id, u]));
    const who = (u) => (u.author_role === 'worker'
      ? `작업자${names[u.assignment_id] ? ` · ${names[u.assignment_id]}` : ''}`
      : `회사${u.assignment_id && names[u.assignment_id] ? ` → ${names[u.assignment_id]}` : ''}`);
    return `<ol class="timeline">${list.map((u) => {
      const role = u.author_role === 'worker' ? 'worker' : 'company';
      const target = u.amends_id ? byId.get(u.amends_id) : null;
      const amends = u.amends_id
        ? `<div class="tl-amends">정정 대상 — ${target ? `${esc(who(target))} · ${esc(label(UPDATE_KIND_LABEL, target.kind))} ${esc(fmtDateTime(target.created_at))}: “${esc(excerpt(target.body, 60))}”` : '이전 기록'}</div>`
        : '';
      const chips = Array.isArray(u.issue_chips) && u.issue_chips.length
        ? `<div class="chips">${u.issue_chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : '';
      return `<li class="tl tl-${role}" data-update="${esc(u.id)}">`
        + `<div class="tl-head"><span class="tl-who">${esc(who(u))}</span><span class="tl-kind">${esc(label(UPDATE_KIND_LABEL, u.kind))}</span>`
        + `<span class="muted">${esc(fmtDateTime(u.created_at))}</span>`
        + `${u.visible_to_worker === false ? '<span class="badge st-hidden">작업자에게 숨김</span>' : ''}</div>`
        + amends
        + `<div class="tl-body pre">${esc(u.body)}</div>`
        + chips
        + `${o.canEdit ? `<div><button type="button" class="btn btn-light btn-xs" data-act="amend" data-id="${esc(u.id)}">이 기록 정정</button></div>` : ''}`
        + '</li>';
    }).join('')}</ol>`;
  }

  /** 이벤트 기록 (work_job_events) — 누가 · 전 → 후 · 사유 */
  function eventsHtml(events) {
    const list = (Array.isArray(events) ? events : []).slice().sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
    if (!list.length) return '<div class="empty-mini">이벤트가 없습니다.</div>';
    return `<table class="tbl"><thead><tr><th>시각</th><th>누가</th><th>무엇</th><th>상태</th><th>사유</th></tr></thead><tbody>${list.map((e) => `<tr>`
      + `<td>${esc(fmtDateTime(e.created_at))}</td><td>${esc(label(ACTOR_LABEL, e.actor_kind))}</td><td>${esc(e.type)}</td>`
      + `<td>${e.from_status || e.to_status ? `${esc(e.from_status || '-')} → ${esc(e.to_status || '-')}` : ''}</td><td>${esc(e.note)}</td></tr>`).join('')}</tbody></table>`;
  }

  /** 작업자 탭 한 줄 — 승인 · 반려 · 정지 · 종류 · 메모 */
  function workerRowHtml(w, opts) {
    const o = opts || {};
    const act = workerActions(w);
    const kinds = Array.isArray(w.kinds) ? w.kinds : [];
    const contact = [w.region_label, w.phone, w.email ? `${w.email}${w.provider ? ` (${w.provider})` : ''}` : ''].filter(Boolean).join(' · ');
    const facts = [
      `가입 ${fmtDate(w.created_at) || '-'}`,
      w.invited_via ? '초대 링크로 신청' : '공개 신청',
      w.consent_version ? `동의 ${w.consent_version}` : '',
      `사진 동의 ${w.photo_consent ? '예' : '아니오'}`,
      w.last_seen_at ? `최근 접속 ${fmtDate(w.last_seen_at)}` : '',
    ].filter(Boolean).join(' · ');
    const kindBoxes = KINDS.map((k) => `<label class="kind-box"><input type="checkbox" data-kind-of="${esc(w.id)}" value="${esc(k)}"${kinds.includes(k) ? ' checked' : ''}${o.canEdit ? '' : ' disabled'} />${esc(kindLabel(k))}</label>`).join('');
    const btns = o.canEdit ? [
      act.approve ? `<button type="button" class="btn btn-primary btn-sm" data-act="wk-approve" data-id="${esc(w.id)}">승인</button>` : '',
      act.reject ? `<button type="button" class="btn btn-light btn-sm" data-act="wk-reject" data-id="${esc(w.id)}">반려</button>` : '',
      act.suspend ? `<button type="button" class="btn btn-light btn-sm" data-act="wk-suspend" data-id="${esc(w.id)}">정지</button>` : '',
      act.resume ? `<button type="button" class="btn btn-light btn-sm" data-act="wk-resume" data-id="${esc(w.id)}">정지 해제</button>` : '',
      `<button type="button" class="btn btn-light btn-sm" data-act="wk-kinds" data-id="${esc(w.id)}">종류 저장</button>`,
      `<button type="button" class="btn btn-light btn-sm" data-act="wk-notes" data-id="${esc(w.id)}">메모</button>`,
    ].join('') : '';
    return `<div class="row wk-row" data-worker="${esc(w.id)}">`
      + `<div class="row-main"><b>${esc(w.display_name || '(이름 없음)')}</b> ${badge(WORKER_STATUS_LABEL, w.status)}`
      + `${contact ? `<div class="muted">${esc(contact)}</div>` : ''}`
      + `<div class="muted">${esc(facts)}</div>`
      + `${w.reject_reason ? `<div class="muted">반려 사유: ${esc(w.reject_reason)}</div>` : ''}`
      + `<div class="kind-boxes">${kindBoxes}</div></div>`
      + `<div class="row-actions">${btns}</div>`
      + '</div>';
  }

  /** 관리자 메모 목록 (worker_notes — 편집자만) */
  function notesHtml(notes) {
    const list = Array.isArray(notes) ? notes : [];
    if (!list.length) return '<div class="empty-mini">메모가 없습니다.</div>';
    return `<ul class="notes">${list.map((n) => `<li><div class="muted">${esc(fmtDateTime(n.created_at))}</div><div class="pre">${esc(n.note)}</div></li>`).join('')}</ul>`;
  }

  // ── 공유 ──
  /** 작업자 화면의 작업 주소 (worker.html#job=<id>) */
  function workerJobUrl(id, baseHref) {
    return new URL(`../worker.html#job=${encodeURIComponent(id)}`, baseHref).href;
  }
  /**
   * [카톡으로 공유] 문구 — 종류 · 시/구 · 날짜 · 링크만 (계획 §9-1 「Slack, 공유 문구」 줄).
   * 제목 · 상세 · 금액 · 주소 · 이름은 넣지 않는다 (제목은 편집자가 자유롭게 쓰는 글이라 고객 이름이 섞일 수 있다).
   */
  function shareText(job, url) {
    const j = job || {};
    return [`[다담가구 작업] ${kindLabel(j.kind) || '작업'} · ${j.region_label || '지역 미정'}`, fmtRange(j.starts_at, j.ends_at), url].filter(Boolean).join('\n');
  }

  // ── 입력 검사 → 요청 본문 ──
  const str = (v) => String(v === null || v === undefined ? '' : v).trim();
  function intOrNull(v, name, min) {
    const s = str(v);
    if (!s) return null;
    if (!/^\d+$/.test(s)) throw new Error(`${name}은(는) ${min} 이상의 정수로 적어 주세요.`);
    const n = Number(s);
    if (n < min) throw new Error(`${name}은(는) ${min} 이상이어야 합니다.`);
    return n;
  }
  function maxLen(v, n, name) {
    if (v.length > n) throw new Error(`${name}은(는) ${n}자 이하로 적어 주세요.`);
    return v;
  }

  /**
   * 작업 만들기 · 고치기 서랍 → POST/PATCH /work/admin/jobs 본문 (계약 §3).
   * 주소 · 연락처 칸은 없다. 빈 칸은 만들 때 빼고, 고칠 때는 null 로 지운다.
   * @param {object} f 서랍 값 (문자열 · 불리언)
   * @param {{ forPatch?: boolean, version?: number }} opts
   */
  function buildJobPayload(f, opts) {
    const o = opts || {};
    const empty = o.forPatch ? null : undefined;
    const kind = str(f.kind);
    if (!KINDS.includes(kind)) throw new Error('작업 종류를 골라 주세요.');
    const title = maxLen(str(f.title), 80, '제목');
    if (!title) throw new Error('제목을 적어 주세요.');
    const slots = intOrNull(f.slots, '정원', 1);
    if (slots === null) throw new Error('정원을 적어 주세요.');
    const mode = str(f.mode) || 'open';
    if (!MODE_LABEL[mode]) throw new Error('모집 방식을 골라 주세요.');
    const startsAt = fromKstInput(f.starts_at);
    const endsAt = fromKstInput(f.ends_at);
    if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new Error('끝나는 시각이 시작보다 빠릅니다.');
    const payAmount = intOrNull(f.pay_amount, '금액', 0);
    const payUnit = str(f.pay_unit);
    if (payUnit && !PAY_UNIT_LABEL[payUnit]) throw new Error('금액 단위를 골라 주세요.');
    const ids = {};
    for (const k of ['order_id', 'design_id']) {
      const v = str(f[k]);
      if (v && !UUID_RE.test(v)) throw new Error(`${k === 'order_id' ? '주문' : '디자인'} ID 형식이 아닙니다.`);
      ids[k] = v || empty;
    }
    const detail = maxLen(str(f.detail), 2000, '상세');
    const region = maxLen(str(f.region_label), 40, '시/구');
    const body = {
      kind,
      title,
      detail: detail || empty,
      region_label: region || empty,
      starts_at: startsAt || empty,
      ends_at: endsAt || empty,
      apply_deadline: fromKstInput(f.apply_deadline) || empty,
      slots,
      mode,
      pay_amount: payAmount === null ? empty : payAmount,
      pay_unit: payUnit || empty,
      pay_visible: Boolean(f.pay_visible),
      order_id: ids.order_id,
      design_id: ids.design_id,
    };
    if (o.forPatch) body.version = o.version;
    return body;
  }

  /** 회사 정정 · 메모 → POST /work/admin/jobs/:id/updates (★5 나). 작업자에게 보일지는 매번 명시한다 */
  function buildUpdatePayload(f) {
    const kind = str(f.kind);
    if (kind !== 'correction' && kind !== 'note') throw new Error('정정 · 메모 중에서 골라 주세요.');
    const body = maxLen(str(f.body), 1000, '내용');
    if (!body) throw new Error('내용을 적어 주세요.');
    const out = { kind, body, visible_to_worker: Boolean(f.visible_to_worker) };
    if (str(f.assignment_id)) out.assignment_id = str(f.assignment_id);
    if (str(f.amends_id)) out.amends_id = str(f.amends_id);
    return out;
  }

  /**
   * 초대 링크 발급 → POST /work/admin/invites. 만료 일시는 편집자가 고른다 — 기본값을 두지 않는다 (계약 §3).
   * @param {{ kinds: string[], display_name?: string, expires_at: string }} f expires_at 은 datetime-local(한국 시간)
   */
  function buildInvitePayload(f, nowMs) {
    const kinds = (Array.isArray(f.kinds) ? f.kinds : []).filter((k) => KINDS.includes(k));
    const expiresAt = fromKstInput(f.expires_at);
    if (!expiresAt) throw new Error('초대 링크 만료 일시를 골라 주세요 (기본값이 없습니다).');
    if (Date.parse(expiresAt) <= (Number.isFinite(nowMs) ? nowMs : Date.now())) throw new Error('만료 일시는 지금보다 뒤여야 합니다.');
    const name = maxLen(str(f.display_name), 30, '이름');
    const out = { kinds_preset: kinds, expires_at: expiresAt };
    if (name) out.display_name_preset = name;
    return out;
  }

  return {
    KINDS, KIND_LABEL, JOB_STATUS_LABEL, APP_STATUS_LABEL, ASSIGN_STATUS_LABEL, WORKER_STATUS_LABEL,
    UPDATE_KIND_LABEL, MODE_LABEL, PAY_UNIT_LABEL, VIA_LABEL, ACTOR_LABEL,
    COUNTED, ACTIVE, FINISHED, BOARD_COLUMNS, CANCELLED_COLUMN, UUID_RE,
    esc, kindLabel, kindsText, fmtDate, fmtDateTime, fmtRange, ddayLabel, toKstInput, fromKstInput,
    effectiveStatus, jobCounts, splitDetail, workerOf, groupBoard,
    jobActions, assignmentActions, workerActions, payText,
    jobCardHtml, applicantRowHtml, assignmentRowHtml, timelineHtml, eventsHtml, workerRowHtml, notesHtml,
    workerJobUrl, shareText, buildJobPayload, buildUpdatePayload, buildInvitePayload,
  };
});
