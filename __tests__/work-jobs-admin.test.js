/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, jest, global, __dirname, document, window, Event, setTimeout */
/**
 * 관리자 「작업 배정」 (admin/work-jobs.html + js/work-jobs-admin.js) — 작업자 포털 1주차 PR3.
 * 계약: docs/01-plan/worker-portal-contract.md §3 관리자 API · §4 화면.
 *   - 사용자 글(작업자 이름 · 제목 · 보고 · 신청 메모)은 글자로만 나온다 (<script> 가 요소가 되지 않음)
 *   - 작업 만들기에 주소 · 연락처 칸이 없다, 공유 문구에 제목 · 금액 · 주소가 없다
 *   - 초대 링크 만료는 편집자가 고른다 (기본값 없음)
 *   - 회사 정정은 원본을 고치지 않고 덧붙인다 — 작업자에게 보일지는 매번 명시
 * 1주차 후속 (2026-10-20 사장님 "추천대로 진행하고, 지원 종료일도 설정하고 표시 되도록 해줘"):
 *   - 0 지원 종료일: 서랍 이름 · 도움말 · 지난 시각 경고(막지 않음), 보드 카드 'D-n · 오늘 종료 · 지원 종료', 상세 행, 공유 문구 한 줄
 *   - C 닫기 · 취소 확인에 응답 없는 초대 수 (조립 닫기는 「검수」라 하지 않음), assignment_auto_declined 이름표
 *   - D 정지 확인에 진행 중인 배정 수(active_count), 정지 상태 설명
 *   - F 작업자 이력 (GET /work/admin/workers/:id/events — 404 · 빈 목록은 '기록 없음', 그 밖의 오류는 목록을 비우고 서버 문구를 오류색으로)
 * 페이지 스크립트를 jsdom 에 그대로 올리고 workflow-api 는 가짜 fetch 로 대신한다. 이름 · 지역은 전부 가짜.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const W = require('../js/work-jobs-admin.js');
const HTML = fs.readFileSync(path.join(ROOT, 'admin/work-jobs.html'), 'utf8').split('\r\n').join('\n');
const SCRIPT_START = HTML.lastIndexOf('<script>');
const SCRIPT = HTML.slice(SCRIPT_START + '<script>'.length, HTML.lastIndexOf('</script>'));
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, SCRIPT_START);
const API = 'https://api.test';
/** 이력 라우트의 가짜 500 문구 — 화면이 서버 message 를 그대로 오류색으로 보이는지 본다 */
const EVENTS_500 = '이력 표를 읽지 못했습니다 (가짜 서버 오류)';

const J1 = '11111111-1111-4111-8111-111111111111';
const J2 = '22222222-2222-4222-8222-222222222222';
const J3 = '33333333-3333-4333-8333-333333333333';
const J4 = '44444444-4444-4444-8444-444444444444';
const J5 = '55555555-5555-4555-8555-555555555555';
const J6 = '66666666-6666-4666-8666-666666666666';
const J9 = '99999999-9999-4999-8999-999999999999';
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const U1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const U2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const WK1 = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
const WK2 = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';
const WK3 = 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3';

const XSS = '<script>alert(1)</script>';
const IMG = '<img src=x onerror=alert(1)>';

// 목록 항목은 서버(workers/workflow-api/src/work/jobs.js listJobsAdmin) 모양 그대로:
//   { ...work_jobs 행, effective_status, applications: 신청 수(숫자), confirmed: 확정 수(숫자), next_date }
// 2026-10-21(수) 09:00~18:00 한국 시간
const JOB1 = {
  id: J1, kind: 'install', title: `${XSS} 싱크대 설치 보조`, status: 'open', effective_status: 'open', region_label: '가상시 시험구',
  starts_at: '2026-10-21T00:00:00Z', ends_at: '2026-10-21T09:00:00Z', apply_deadline: '2099-01-01T00:00:00Z',
  slots: 2, applications: 3, confirmed: 1, mode: 'open', pay_amount: 150000, pay_unit: 'day', pay_visible: false, version: 4,
  detail: `범위 ${IMG}`, created_at: '2026-10-19T01:00:00Z',
};
const JOBS = [
  JOB1,
  { id: J2, kind: 'as', title: '지원 종료된 A/S', status: 'open', effective_status: 'expired', region_label: '가상시 동구', starts_at: '2026-10-25T01:00:00Z', apply_deadline: '2026-10-21T09:00:00Z', slots: 1, applications: 0, confirmed: 0, version: 2 },
  { id: J3, kind: 'assembly', title: '조립 초안', status: 'draft', effective_status: 'draft', slots: 1, applications: 0, confirmed: 0 },
  { id: J4, kind: 'install', title: '취소된 작업', status: 'cancelled', effective_status: 'cancelled', slots: 1, applications: 0, confirmed: 0 },
  { id: J5, kind: 'install', title: '닫힌 작업', status: 'closed', effective_status: 'closed', slots: 1, applications: 0, confirmed: 1 },
];
const DETAIL = {
  job: JOB1,
  applications: [
    { id: A1, status: 'applied', message: IMG, created_at: '2026-10-19T02:00:00Z', worker: { id: WK1, display_name: `${XSS}가짜기사`, kinds: ['install'], region_label: '가상시', done_count: 2 } },
  ],
  assignments: [
    { id: S1, worker_id: WK2, worker_name_snapshot: '시험작업자', via: 'application', status: 'submitted', revision_count: 0, submitted_at: '2026-10-21T08:00:00Z' },
    { id: S2, worker_id: WK3, worker_name_snapshot: '시험초대', via: 'invite', status: 'offered', revision_count: 0 },
  ],
  updates: [
    { id: U2, job_id: J1, assignment_id: S1, author_role: 'company', kind: 'correction', body: '수량 2 → 3 정정', amends_id: U1, visible_to_worker: false, created_at: '2026-10-21T10:00:00Z' },
    { id: U1, job_id: J1, assignment_id: S1, author_role: 'worker', kind: 'result', body: `완료했습니다 ${IMG}`, issue_chips: [], visible_to_worker: true, created_at: '2026-10-21T08:00:00Z' },
  ],
  events: [
    { id: 'e1', type: 'published', from_status: 'draft', to_status: 'open', actor_kind: 'admin', note: null, created_at: '2026-10-19T01:05:00Z' },
    { id: 'e2', type: 'assignment_auto_declined', assignment_id: S2, from_status: 'offered', to_status: 'declined', actor_kind: 'system', note: '작업이 취소돼 초대가 끝났습니다', payload: { worker_id: WK3, reason: 'job_cancelled' }, created_at: '2026-10-19T02:05:00Z' },
  ],
};
/** 끝난 조립 작업 — 응답 없는 초대 하나가 남아 있다 (정원 계산은 offered 를 보지 않는다) */
const DONE_ASSEMBLY = {
  job: { id: J6, kind: 'assembly', title: '조립 추가 인원', status: 'done', effective_status: 'done', slots: 1, version: 7 },
  applications: [],
  assignments: [
    { id: S1, worker_id: WK2, worker_name_snapshot: '시험작업자', via: 'application', status: 'accepted', revision_count: 0 },
    { id: S2, worker_id: WK3, worker_name_snapshot: '시험초대', via: 'invite', status: 'offered', revision_count: 0 },
  ],
  updates: [],
  events: [],
};
/** 지원 종료일 시험의 '지금' — 10/22(목) 12:00 한국 시간 */
const NOW = Date.parse('2026-10-22T03:00:00Z');
const APPROVED = [
  { id: WK1, display_name: '승인기사', kinds: ['install', 'as'], status: 'approved', region_label: '가상시', active_count: 2 },
  { id: WK2, display_name: '이미배정', kinds: ['install'], status: 'approved' },
  { id: 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4', display_name: '조립만', kinds: ['assembly'], status: 'approved' },
];
const PENDING = [
  { id: WK1, display_name: XSS, phone: '010-0000-0000', kinds: ['install'], region_label: IMG, status: 'pending', consent_version: 'v1', photo_consent: false, invited_via: 'i-1', created_at: '2026-10-19T00:00:00Z' },
];

/**
 * 화면 코드에는 타이머가 없다 (가짜 fetch → await 사슬뿐) — 마이크로태스크를 넉넉히 비우고 타이머는 한 번만.
 * setTimeout(0) 을 여러 번 돌리면 윈도에서 한 번에 수 ms 라 긴 시험이 5초 제한에 걸린다.
 */
async function settle() {
  for (let i = 0; i < 300; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 300; i++) await Promise.resolve();
}
const $ = (id) => document.getElementById(id);

function fakeApi(opts) {
  const o = { me: { ready: true, worker: null }, jobs: { items: JOBS }, detail: DETAIL, workers: PENDING, ...(opts || {}) };
  const calls = [];
  const res = (status, payload) => ({ ok: status < 400, status, json: async () => payload });
  const ok = (data) => res(200, { success: true, data });
  const fetchFn = jest.fn(async (url, init = {}) => {
    const u = String(url).replace(API, '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ u, method, body, auth: init.headers && init.headers.Authorization });
    const hit = o.override ? o.override(u, method, body) : null;
    if (hit) return hit;
    if (u === '/work/me') return ok(o.me);
    if (u === '/work/admin/jobs' && method === 'GET') return ok(o.jobs);
    if (u === `/work/admin/jobs/${J1}` && method === 'GET') return ok(o.detail);
    if (u === `/work/admin/jobs/${J2}` && method === 'GET') return ok({ job: JOBS[1], applications: [], assignments: [], updates: [], events: [] });
    if (u === `/work/admin/jobs/${J6}` && method === 'GET') return ok(DONE_ASSEMBLY);
    if (u === `/work/admin/jobs/${J9}` && method === 'GET') return ok({ job: { id: J9, kind: 'as', title: '새 작업', status: 'draft', slots: 1, version: 0 }, applications: [], assignments: [], updates: [], events: [] });
    if (u === '/work/admin/workers?status=approved') return ok({ items: APPROVED });
    if (u.startsWith('/work/admin/workers/') && u.endsWith('/events') && method === 'GET') {
      if (o.workerEvents === 404) return res(404, { success: false, message: 'Not found' });
      if (o.workerEvents === 500) return res(500, { success: false, message: EVENTS_500 });
      return ok({ items: o.workerEvents || [] });
    }
    if (u.startsWith('/work/admin/workers') && u.endsWith('/notes') && method === 'GET') return ok({ items: [{ id: 'n1', note: XSS, created_at: '2026-10-19T00:00:00Z' }] });
    if (u.startsWith('/work/admin/workers') && method === 'GET') return ok({ items: o.workers });
    if (u === '/work/admin/jobs' && method === 'POST') return ok({ id: J9, status: 'draft', version: 0 });
    if (u === '/work/admin/invites') return ok({ id: 'inv1', url: 'https://example.test/worker.html#invite=fake-token', expires_at: body.expires_at });
    if (/^\/work\/admin\/jobs\/[^/]+\/(close|cancel)$/.test(u) && method === 'POST') return ok({ id: 'ok', auto_declined: o.autoDeclined || 0 });
    if (method === 'POST' || method === 'PATCH') return ok({ id: 'ok' });
    return res(404, { success: false, message: 'Not found' });
  });
  return { fetchFn, calls };
}

function boot(api, { admin = true, role = 'admin', url = '/admin/work-jobs.html' } = {}) {
  window.history.replaceState(null, '', url);
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb', anonKey: 'k' }, workflowApi: { url: API } };
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'T', user: { id: 'u-admin', email: 'admin@example.test' } } } }) } }) };
  window.AdminAccess = { isAdmin: async () => admin, getRole: async () => role };
  window.__WORK_JOBS_NO_AUTOSTART = true;
  global.fetch = api.fetchFn;
  window.confirm = jest.fn(() => true);
  (0, eval)(SCRIPT);
}
async function start(api, opts) {
  boot(api, opts);
  await window.WorkJobs.init();
  await settle();
}
async function openJob1() {
  document.querySelector(`.job-card[data-job="${J1}"]`).click();
  await settle();
}
const click = async (el) => { el.click(); await settle(); };
const writes = (api) => api.calls.filter((c) => c.method !== 'GET');
function setNav(key, value) {
  Object.defineProperty(window.navigator, key, { value, configurable: true, writable: true });
}

let nowSpy = null;
/** 화면 코드의 Date.now() 를 고정한다 (지원 종료일 꼬리표 · 지난 시각 경고) */
function freezeNow(ms) {
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(ms);
}
afterEach(() => {
  setNav('share', undefined);
  setNav('clipboard', undefined);
  if (nowSpy) nowSpy.mockRestore();
  nowSpy = null;
});

// ─────────────────────────────────────────────────────────────

describe('js/work-jobs-admin.js — 순수 함수', () => {
  const mount = (html) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
  };

  test('카드 · 신청자 · 작업자 줄 · 타임라인 · 메모 — 이름에 <script> 를 넣어도 글자로 나온다', () => {
    const pieces = [
      W.jobCardHtml(JOB1),
      W.applicantRowHtml(DETAIL.applications[0], { canEdit: true }),
      W.workerRowHtml(PENDING[0], { canEdit: true }),
      W.timelineHtml(DETAIL.updates, { names: { [S1]: XSS }, canEdit: true }),
      W.notesHtml([{ note: XSS, created_at: '2026-10-19T00:00:00Z' }]),
      W.eventsHtml([{ type: XSS, note: IMG, actor_kind: 'admin', created_at: '2026-10-19T00:00:00Z' }]),
    ];
    for (const html of pieces) {
      const div = mount(html);
      expect(div.querySelector('script, img')).toBeNull();
    }
    expect(mount(pieces[0]).textContent).toContain(XSS);
    expect(mount(pieces[1]).textContent).toContain(`${XSS}가짜기사`);
    expect(mount(pieces[1]).textContent).toContain(IMG);
    expect(mount(pieces[2]).textContent).toContain(XSS);
    expect(mount(pieces[3]).textContent).toContain(`작업자 · ${XSS}`);
    expect(W.esc(`"'&<>`)).toBe('&quot;&#39;&amp;&lt;&gt;');
  });

  test('카드 — 날짜(한국 시간) · 종류 · 시/구 · 확정 n/정원 · 신청 수 · D-day', () => {
    const now = Date.parse('2026-10-20T03:00:00Z'); // 10/20 12:00 한국 시간
    const t = mount(W.jobCardHtml(JOB1, { now })).textContent;
    expect(t).toContain('설치');
    expect(t).toContain('10/21(수) 09:00~18:00 · 가상시 시험구');
    expect(t).toContain('확정 1/2 · 신청 3');
    expect(t).toContain('D-1');
    expect(W.ddayLabel('2026-10-20T14:59:00Z', now)).toBe('D-day'); // 10/20 23:59 한국 시간
    expect(W.ddayLabel('2026-10-20T15:00:00Z', now)).toBe('D-1');
    expect(W.ddayLabel('2026-10-18T00:00:00Z', now)).toBe('D+2');
    expect(W.fmtRange(null, null)).toBe('날짜 미정');
    expect(W.fmtRange('2026-10-21T00:00:00Z', '2026-10-22T03:00:00Z')).toBe('10/21(수) 09:00 ~ 10/22(목) 12:00');
  });

  test('확정 수 · 신청 수 — 서버 목록 모양(applications · confirmed 숫자)과 상세 모양(펼친 작업 + 배열)을 읽는다', () => {
    // 목록: listJobsAdmin 항목 — 작업 행에는 filled 열이 없고 confirmed · applications 가 숫자로 온다
    expect(W.jobCounts(JOB1)).toEqual({ filled: 1, applied: 3, slots: 2 });
    expect(W.jobCounts(JOBS[1])).toEqual({ filled: 0, applied: 0, slots: 1 });
    // 상세: getJobAdmin — 작업 열을 펼치고 filled(숫자) + applications · assignments(배열)
    const flat = {
      ...JOB1, confirmed: undefined, filled: 1,
      applications: DETAIL.applications, assignments: DETAIL.assignments, updates: DETAIL.updates, events: DETAIL.events,
    };
    const d = W.splitDetail(flat);
    expect(d.job.id).toBe(J1);
    expect(W.jobCounts(d.job, d)).toEqual({ filled: 1, applied: 1, slots: 2 }); // submitted 1 (offered 는 정원 밖) · applied 1
    // 상세에서 꺼낸 작업만 넘겨도 신청 배열을 숫자로 잘못 읽지 않는다
    expect(W.jobCounts(d.job).applied).toBeNull();
  });

  test('보드 열 — 지원 종료는 effective_status, 없으면 계약 식(open + 지원 종료일 지남), 닫힘은 완료 열, 취소는 볼 때만', () => {
    const cols = W.groupBoard(JOBS);
    expect(cols.map((c) => c.label)).toEqual(['초안', '모집중', '지원 종료', '배정', '진행', '검수대기', '완료']);
    expect(W.JOB_STATUS_LABEL.expired).toBe('지원 종료');
    expect(W.JOB_STATUS_LABEL.closed).toBe('닫힘'); // 작업 상태 closed 의 이름은 그대로
    const ids = (k, list) => (list || cols).find((c) => c.key === k).items.map((j) => j.id);
    expect(ids('open')).toEqual([J1]);
    expect(ids('expired')).toEqual([J2]);
    expect(ids('done')).toEqual([J5]);
    expect(cols.flatMap((c) => c.items).map((j) => j.id)).not.toContain(J4);
    const withCancelled = W.groupBoard(JOBS, { showCancelled: true });
    expect(ids('cancelled', withCancelled)).toEqual([J4]);
    expect(W.groupBoard(JOBS, { kind: 'as' }).flatMap((c) => c.items).map((j) => j.id)).toEqual([J2]);
    const now = Date.parse('2026-10-20T00:00:00Z');
    expect(W.effectiveStatus({ status: 'open', apply_deadline: '2026-10-19T00:00:00Z' }, now)).toBe('expired');
    expect(W.effectiveStatus({ status: 'open', apply_deadline: '2026-10-21T00:00:00Z' }, now)).toBe('open');
    expect(W.effectiveStatus({ status: 'filled', apply_deadline: '2026-10-19T00:00:00Z' }, now)).toBe('filled');
  });

  test('버튼 판단 — 게시는 초안만, 고치기는 초안 · 모집중, 취소는 done 전, 닫기는 done, assembly 는 승인 단계 없음', () => {
    expect(W.jobActions({ status: 'draft' })).toMatchObject({ publish: true, edit: true, cancel: true, close: false, share: false });
    expect(W.jobActions({ status: 'open' })).toMatchObject({ publish: false, edit: true, cancel: true, share: true });
    expect(W.jobActions({ status: 'filled' })).toMatchObject({ edit: false, cancel: true });
    expect(W.jobActions({ status: 'done' })).toMatchObject({ cancel: false, close: true });
    expect(W.jobActions({ status: 'cancelled' })).toMatchObject({ cancel: false, share: false, invite: false });
    expect(W.assignmentActions({ status: 'submitted' }, { kind: 'install' })).toEqual({ accept: true, revision: true, remove: true });
    expect(W.assignmentActions({ status: 'submitted' }, { kind: 'assembly' }).accept).toBe(false);
    expect(W.assignmentActions({ status: 'accepted' }, { kind: 'as' })).toEqual({ accept: false, revision: false, remove: false });
    expect(W.workerActions({ status: 'pending' })).toEqual({ approve: true, reject: true, suspend: false, resume: false });
    expect(W.workerActions({ status: 'approved' })).toMatchObject({ suspend: true, approve: false });
    expect(W.workerActions({ status: 'suspended' })).toMatchObject({ resume: true });
    expect(W.workerActions({ status: 'rejected' })).toEqual({ approve: false, reject: false, suspend: false, resume: false });
  });

  test('타임라인 — 작업자 보고와 회사 정정을 구분, 정정은 원본 아래 덧붙고 원본을 가리킨다, 숨김 표시', () => {
    const div = mount(W.timelineHtml(DETAIL.updates, { names: { [S1]: '시험작업자' } }));
    const items = [...div.querySelectorAll('li.tl')];
    expect(items.map((li) => li.getAttribute('data-update'))).toEqual([U1, U2]); // 오래된 것부터
    expect(items[0].classList.contains('tl-worker')).toBe(true);
    expect(items[1].classList.contains('tl-company')).toBe(true);
    expect(items[0].textContent).toContain('작업자 · 시험작업자');
    expect(items[0].textContent).toContain('완료 보고');
    expect(items[1].textContent).toContain('회사 → 시험작업자');
    expect(items[1].querySelector('.tl-amends').textContent).toContain('정정 대상 — 작업자 · 시험작업자 · 완료 보고');
    expect(items[1].querySelector('.st-hidden').textContent).toBe('작업자에게 숨김');
    expect(items[0].querySelector('.st-hidden')).toBeNull();
    expect(div.querySelector('[data-act="amend"]')).toBeNull(); // 편집자만
  });

  test('공유 문구 — 종류 · 시/구 · 날짜 · 지원 종료일(있으면) · 링크만 (제목 · 상세 · 금액 · 이름 없음)', () => {
    const url = W.workerJobUrl(J1, 'https://dadam.example/admin/work-jobs.html?job=x');
    expect(url).toBe(`https://dadam.example/worker.html#job=${J1}`);
    const text = W.shareText(JOB1, url);
    expect(text).toBe(`[다담가구 작업] 설치 · 가상시 시험구\n10/21(수) 09:00~18:00\n지원 종료일 1/1(목) 09:00\n${url}`);
    // 지원 종료일이 없으면 그 줄이 없다 · D-n 꼬리표는 싣지 않는다 (대화방에서 나중에 읽으면 틀린 말)
    expect(W.shareText({ ...JOB1, apply_deadline: null }, url)).toBe(`[다담가구 작업] 설치 · 가상시 시험구\n10/21(수) 09:00~18:00\n${url}`);
    expect(W.shareText({ ...JOB1, apply_deadline: '2026-10-24T09:00:00Z' }, url).split('\n')[2]).toBe('지원 종료일 10/24(토) 18:00');
    expect(text).not.toMatch(/D-\d/);
    expect(text).not.toContain('싱크대');
    expect(text).not.toContain('150');
    expect(text).not.toContain('범위');
  });

  test('작업 본문 — 주소 · 연락처 키가 없고, 한국 시간 → ISO, 필수 칸 · 형식 검사', () => {
    const f = {
      kind: 'install', title: ' 설치 보조 ', detail: '', region_label: '가상시', slots: '2', mode: 'open',
      starts_at: '2026-10-21T09:00', ends_at: '2026-10-21T18:00', apply_deadline: '', pay_amount: '150000', pay_unit: 'day', pay_visible: false,
      order_id: '', design_id: '',
    };
    const body = W.buildJobPayload(f);
    expect(body).toMatchObject({ kind: 'install', title: '설치 보조', slots: 2, mode: 'open', starts_at: '2026-10-21T00:00:00.000Z', ends_at: '2026-10-21T09:00:00.000Z', pay_amount: 150000, pay_unit: 'day', pay_visible: false });
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('detail'); // 만들 때 빈 칸은 뺀다
    for (const k of Object.keys(body)) expect(k).not.toMatch(/addr|phone|contact|customer/i);
    const patch = W.buildJobPayload(f, { forPatch: true, version: 4 });
    expect(patch).toMatchObject({ detail: null, apply_deadline: null, version: 4 }); // 고칠 때 빈 칸은 지운다
    expect(() => W.buildJobPayload({ ...f, kind: '' })).toThrow('작업 종류');
    expect(() => W.buildJobPayload({ ...f, title: '' })).toThrow('제목');
    expect(() => W.buildJobPayload({ ...f, title: 'x'.repeat(81) })).toThrow('80자');
    expect(() => W.buildJobPayload({ ...f, slots: '0' })).toThrow('정원');
    expect(() => W.buildJobPayload({ ...f, slots: '' })).toThrow('정원');
    expect(() => W.buildJobPayload({ ...f, pay_amount: '-5' })).toThrow('금액');
    expect(() => W.buildJobPayload({ ...f, ends_at: '2026-10-21T08:00' })).toThrow('끝나는 시각');
    expect(() => W.buildJobPayload({ ...f, order_id: 'not-a-uuid' })).toThrow('주문 ID');
    expect(W.toKstInput('2026-10-21T00:00:00Z')).toBe('2026-10-21T09:00');
    expect(W.fromKstInput(W.toKstInput('2026-10-21T00:30:00Z'))).toBe('2026-10-21T00:30:00.000Z');
  });

  test('초대 링크 — 만료 일시 기본값 없음, 지난 시각 거부, 종류 · 이름 프리셋', () => {
    const now = Date.parse('2026-10-20T00:00:00Z');
    expect(() => W.buildInvitePayload({ kinds: ['install'], expires_at: '' }, now)).toThrow('만료 일시');
    expect(() => W.buildInvitePayload({ kinds: ['install'], expires_at: '2026-10-19T09:00' }, now)).toThrow('지금보다 뒤');
    expect(W.buildInvitePayload({ kinds: ['install', 'bogus'], display_name: ' 시험 ', expires_at: '2026-10-27T18:00' }, now))
      .toEqual({ kinds_preset: ['install'], display_name_preset: '시험', expires_at: '2026-10-27T09:00:00.000Z' });
  });

  test('회사 정정 · 메모 — 작업자에게 보일지는 매번 명시(false 도 보낸다), 본문 1000자', () => {
    expect(W.buildUpdatePayload({ kind: 'correction', body: ' 정정 ', amends_id: U1, assignment_id: S1, visible_to_worker: false }))
      .toEqual({ kind: 'correction', body: '정정', amends_id: U1, assignment_id: S1, visible_to_worker: false });
    expect(W.buildUpdatePayload({ kind: 'note', body: '메모', visible_to_worker: true })).toEqual({ kind: 'note', body: '메모', visible_to_worker: true });
    expect(() => W.buildUpdatePayload({ kind: 'result', body: 'x' })).toThrow('정정 · 메모');
    expect(() => W.buildUpdatePayload({ kind: 'note', body: '' })).toThrow('내용');
    expect(() => W.buildUpdatePayload({ kind: 'note', body: 'x'.repeat(1001) })).toThrow('1000자');
  });
});

// ─────────────────────────────────────────────────────────────

describe('1주차 후속 — 순수 함수 (지원 종료일 · 초대 정리 · 정지 · 작업자 이력)', () => {
  const mount = (html) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
  };

  test('지원 종료일 꼬리표 — 한국 날짜 기준 D-n · 같은 날 아직 전이면 오늘 종료 · 지났으면 지원 종료', () => {
    // NOW = 10/22(목) 12:00 한국 시간
    expect(W.fmtDateTime('2026-10-24T09:00:00Z')).toBe('10/24(토) 18:00');
    expect(W.deadlineTag('2026-10-24T09:00:00Z', NOW)).toBe('D-2');
    expect(W.deadlineTag('2026-10-22T15:00:00Z', NOW)).toBe('D-1'); // 10/23 00:00 — 다음 날 첫 순간
    expect(W.deadlineTag('2026-10-22T14:59:00Z', NOW)).toBe('오늘 종료'); // 10/22 23:59
    expect(W.deadlineTag('2026-10-22T03:00:00Z', NOW)).toBe('오늘 종료'); // 바로 지금 — 지난 것은 '< 지금' (effectiveStatus 와 같은 경계)
    expect(W.deadlineTag('2026-10-22T02:59:00Z', NOW)).toBe('지원 종료'); // 오늘 11:59 — 이미 지남
    expect(W.deadlineTag('2026-10-21T14:59:00Z', NOW)).toBe('지원 종료'); // 어제 23:59
    expect(W.deadlineTag(null, NOW)).toBe('');
    expect(W.deadlineTag('날짜 아님', NOW)).toBe('');
    // 한국 자정 직후 — UTC 날짜로 세면 틀린다 (10/23 01:00 한국 = 10/22 16:00 UTC)
    const afterMidnight = Date.parse('2026-10-22T16:00:00Z');
    expect(W.deadlineTag('2026-10-23T10:00:00Z', afterMidnight)).toBe('오늘 종료'); // 10/23 19:00 한국 (UTC 로는 다음 날)
    expect(W.deadlineTag('2026-10-22T14:00:00Z', afterMidnight)).toBe('지원 종료'); // 10/22 23:00 한국
    expect(W.deadlineTag('2026-10-23T15:00:00Z', afterMidnight)).toBe('D-1'); // 10/24 00:00 한국
    // 지난 것과 effectiveStatus 의 expired 는 같은 경계다
    for (const dl of ['2026-10-22T02:59:00Z', '2026-10-22T03:00:00Z', '2026-10-22T03:01:00Z']) {
      expect(W.deadlineTag(dl, NOW) === '지원 종료').toBe(W.effectiveStatus({ status: 'open', apply_deadline: dl }, NOW) === 'expired');
    }
  });

  test('보드 카드 — 초안 · 모집중 · 지원 종료 칸에만 「지원 종료 10/24(토) 18:00 · D-2」, 오늘 종료 · 지원 종료는 눈에 띄게', () => {
    const open = { ...JOB1, apply_deadline: '2026-10-24T09:00:00Z' };
    const card = mount(W.jobCardHtml(open, { now: NOW }));
    expect(card.querySelector('.jc-deadline').textContent).toBe('지원 종료 10/24(토) 18:00 · D-2');
    expect(card.querySelector('.dl-tag').classList.contains('dl-days')).toBe(true);

    const today = mount(W.jobCardHtml({ ...JOB1, apply_deadline: '2026-10-22T09:00:00Z' }, { now: NOW }));
    expect(today.querySelector('.jc-deadline').textContent).toBe('지원 종료 10/22(목) 18:00 · 오늘 종료');
    expect(today.querySelector('.dl-tag').classList.contains('dl-today')).toBe(true);

    const expired = mount(W.jobCardHtml(JOBS[1], { now: NOW }));
    expect(expired.querySelector('.jc-deadline').textContent).toBe('지원 종료 10/21(수) 18:00 · 지원 종료');
    expect(expired.querySelector('.dl-tag').classList.contains('dl-over')).toBe(true);

    const draft = mount(W.jobCardHtml({ ...JOBS[2], apply_deadline: '2026-10-30T09:00:00Z' }, { now: NOW }));
    expect(draft.querySelector('.jc-deadline').textContent).toBe('지원 종료 10/30(금) 18:00 · D-8');

    // 배정 · 진행 · 완료 칸과 지원 종료일 없는 카드에는 없다
    for (const st of ['filled', 'in_progress', 'review', 'done', 'closed', 'cancelled']) {
      expect(mount(W.jobCardHtml({ ...open, status: st, effective_status: st }, { now: NOW })).querySelector('.jc-deadline')).toBeNull();
    }
    expect(mount(W.jobCardHtml({ ...JOB1, apply_deadline: null }, { now: NOW })).querySelector('.jc-deadline')).toBeNull();
  });

  test('상세 행 — 날짜 · 꼬리표, 없으면 「정하지 않음」, 모집이 끝난 상태에는 꼬리표를 붙이지 않는다', () => {
    expect(mount(W.deadlineDetailHtml({ status: 'open', apply_deadline: '2026-10-24T09:00:00Z' }, NOW)).textContent).toBe('10/24(토) 18:00 · D-2');
    expect(mount(W.deadlineDetailHtml({ status: 'open', apply_deadline: '2026-10-21T09:00:00Z' }, NOW)).textContent).toBe('10/21(수) 18:00 · 지원 종료');
    expect(mount(W.deadlineDetailHtml({ status: 'filled', apply_deadline: '2026-10-24T09:00:00Z' }, NOW)).textContent).toBe('10/24(토) 18:00');
    expect(mount(W.deadlineDetailHtml({ status: 'open', apply_deadline: null }, NOW)).textContent).toBe('정하지 않음');
  });

  test('서랍 — 지난 시각은 경고만 (저장 본문은 그대로 만든다), 빈 칸 · 형식 오류 · 앞으로의 시각은 경고 없음', () => {
    expect(W.DEADLINE_HELP).toBe('비워 두면 정원이 찰 때까지 받습니다');
    expect(W.deadlineWarning('2026-10-22T11:59', NOW)).toBe("지원 종료일이 이미 지났습니다 — 게시하면 바로 '지원 종료'로 보입니다");
    expect(W.deadlineWarning('2026-10-22T12:01', NOW)).toBe('');
    expect(W.deadlineWarning('', NOW)).toBe('');
    expect(W.deadlineWarning('날짜 아님', NOW)).toBe('');
    // 시작보다 늦어도 · 지났어도 막지 않는다 (새 검증 규칙 없음)
    const f = { kind: 'install', title: '설치', slots: '1', mode: 'open', starts_at: '2026-10-21T09:00', apply_deadline: '2026-10-21T08:00' };
    expect(W.buildJobPayload(f).apply_deadline).toBe('2026-10-20T23:00:00.000Z');
    expect(W.buildJobPayload({ ...f, apply_deadline: '2026-10-25T09:00' }).apply_deadline).toBe('2026-10-25T00:00:00.000Z');
  });

  test('닫기 · 취소 확인 — 응답 없는 초대(offered) 수, 0 이면 생략, 조립 닫기는 「검수」라 하지 않는다', () => {
    const offered2 = [{ status: 'offered' }, { status: 'offered' }, { status: 'confirmed' }, { status: 'declined' }];
    expect(W.offeredCount(offered2)).toBe(2);
    expect(W.offeredCount(null)).toBe(0);
    expect(W.closeConfirmText({ kind: 'install' }, offered2)).toBe('검수가 끝난 작업을 닫을까요?\n응답 없는 초대 2건은 자동으로 끝납니다.');
    expect(W.closeConfirmText({ kind: 'as' }, [])).toBe('검수가 끝난 작업을 닫을까요?');
    const asm = W.closeConfirmText({ kind: 'assembly' }, [{ status: 'offered' }]);
    expect(asm).not.toContain('검수');
    expect(asm).toBe('완료 보고가 끝난 작업을 닫을까요?\n응답 없는 초대 1건은 자동으로 끝납니다.');
    expect(W.cancelHint(offered2)).toBe('배정된 작업자가 있으면 그 사람의 작업 화면에도 취소로 보입니다. 응답 없는 초대 2건은 자동으로 끝납니다.');
    expect(W.cancelHint([{ status: 'confirmed' }])).not.toContain('응답 없는 초대');
    expect(W.autoDeclinedNote({ auto_declined: 3 })).toBe(' 응답 없는 초대 3건을 끝냈습니다.');
    expect(W.autoDeclinedNote({ auto_declined: 0 })).toBe('');
    expect(W.autoDeclinedNote({})).toBe('');
    expect(W.autoDeclinedNote(null)).toBe('');
  });

  test('이벤트 이름 — assignment_auto_declined 는 「응답 없는 초대 자동 종료」, 모르는 이름은 그대로 (이스케이프)', () => {
    const div = mount(W.eventsHtml([
      { type: 'assignment_auto_declined', from_status: 'offered', to_status: 'declined', actor_kind: 'system', note: '작업이 마감돼 초대가 끝났습니다', created_at: '2026-10-19T00:00:00Z' },
      { type: 'constructor', actor_kind: 'admin', created_at: '2026-10-19T01:00:00Z' },
    ]));
    const cells = [...div.querySelectorAll('tbody tr')].map((tr) => tr.children[2].textContent);
    expect(cells).toEqual(['응답 없는 초대 자동 종료', 'constructor']);
    expect(div.textContent).toContain('시스템');
    expect(div.textContent).toContain('offered → declined');
  });

  test('정지 확인 · 정지 상태 설명 — 진행 중인 배정 수(active_count), 0 · 모름이면 뒷문장 생략', () => {
    const head = '정지하면 새 작업 신청·초대 수락을 못 합니다.';
    expect(W.suspendConfirmText({ active_count: 2 })).toContain(`${head} 진행 중인 배정 2건은 그대로 남으니 필요하면 작업에서 제외하세요.`);
    expect(W.suspendConfirmText({ active_count: 0 })).toContain(head);
    expect(W.suspendConfirmText({ active_count: 0 })).not.toContain('진행 중인 배정');
    expect(W.suspendConfirmText({})).not.toContain('진행 중인 배정');

    const row = mount(W.workerRowHtml({ id: WK1, display_name: '정지기사', status: 'suspended', kinds: ['install'], active_count: 1 }, { canEdit: true }));
    expect(row.querySelector('.wk-suspended').textContent).toContain('새 작업 신청 · 초대 수락을 할 수 없습니다');
    expect(row.querySelector('.wk-suspended').textContent).toContain('지난 기록은 작업자가 계속 볼 수 있습니다');
    expect(row.querySelector('.wk-suspended').textContent).toContain('진행 중인 배정 1건');
    expect(row.textContent).toContain('진행 중인 배정 1건');
    expect([...row.querySelectorAll('[data-act]')].map((b) => b.getAttribute('data-act'))).toEqual(['wk-resume', 'wk-kinds', 'wk-notes', 'wk-events']);
    const approved = mount(W.workerRowHtml({ id: WK1, display_name: '승인기사', status: 'approved', active_count: 0 }, { canEdit: true }));
    expect(approved.querySelector('.wk-suspended')).toBeNull();
    expect(approved.textContent).toContain('진행 중인 배정 0건');
  });

  test('작업자 이력 — 가입 신청(공개 신청 · 초대 링크) · 상태 변경 「대기 → 승인」 · 종류 변경 「작업 종류: 설치·A/S」, 최근순, 모든 글자 이스케이프', () => {
    const items = [
      { type: 'registered', actor_kind: 'worker', to_status: 'pending', payload: { via: 'public' }, created_at: '2026-10-18T00:00:00Z' },
      { type: 'registered', actor_kind: 'worker', to_status: 'pending', payload: { via: 'invite', invite_id: 'i-1' }, created_at: '2026-10-18T01:00:00Z' },
      { type: 'status_changed', actor_kind: 'admin', from_status: 'pending', to_status: 'approved', created_at: '2026-10-19T00:00:00Z' },
      { type: 'status_changed', actor_kind: 'admin', from_status: 'pending', to_status: 'rejected', note: XSS, created_at: '2026-10-19T01:00:00Z' },
      { type: 'kinds_changed', actor_kind: 'admin', payload: { kinds: ['install', 'as'] }, created_at: '2026-10-20T00:00:00Z' },
      { type: IMG, actor_kind: 'system', from_status: XSS, payload: { via: XSS }, created_at: '2026-10-20T01:00:00Z' },
    ];
    const div = mount(W.workerEventsHtml(items));
    expect(div.querySelector('script, img')).toBeNull();
    const rows = [...div.querySelectorAll('tbody tr')].map((tr) => [...tr.children].slice(1).map((td) => td.textContent));
    expect(rows).toEqual([
      ['시스템', IMG, `${XSS} → -`, ''],
      ['관리자', '종류 변경', '작업 종류: 설치·A/S', ''],
      ['관리자', '상태 변경', '대기 → 반려', XSS],
      ['관리자', '상태 변경', '대기 → 승인', ''],
      ['작업자', '가입 신청', '초대 링크', ''],
      ['작업자', '가입 신청', '공개 신청', ''],
    ]);
    expect(W.workerEventLabel({ type: 'status_changed', from_status: 'approved', to_status: 'suspended' }).detail).toBe('승인 → 정지');
    expect(W.workerEventLabel({ type: 'kinds_changed', payload: { kinds: [] } }).detail).toBe('작업 종류: 없음');
    expect(W.workerEventsHtml([])).toContain('기록 없음');
    expect(W.workerEventsHtml(null)).toContain('기록 없음');
  });
});

// ─────────────────────────────────────────────────────────────

describe('admin/work-jobs.html — 페이지', () => {
  test('정본 게이트(AdminAccess) · 공용 메뉴 · 헬퍼 스크립트, 하드코딩 이메일 없음', () => {
    expect(HTML).toMatch(/<script src="\.\.\/js\/admin-access\.js(\?v=[\d.]+)?"><\/script>/);
    expect(HTML).toMatch(/<script src="\.\.\/js\/work-jobs-admin\.js\?v=\d+"><\/script>/);
    expect(HTML).toMatch(/window\.AdminAccess\.isAdmin\(state\.sb\)/);
    expect(HTML).not.toMatch(/ADMIN_EMAILS/);
    expect(HTML).toMatch(/<meta name="robots" content="noindex/);
  });

  test('관리자가 아니면 접근 거부 — 서버를 부르지 않는다', async () => {
    const api = fakeApi();
    await start(api, { admin: false });
    expect($('accessDenied').style.display).toBe('block');
    expect($('pageContent').style.display).toBe('none');
    expect(api.calls).toHaveLength(0);
  });

  test('보드 — 열 · 카드 · 이스케이프 · Bearer 토큰, 취소는 체크하면 보인다', async () => {
    const api = fakeApi();
    await start(api);
    expect(api.calls.find((c) => c.u === '/work/admin/jobs').auth).toBe('Bearer T');
    const board = $('board');
    expect([...board.querySelectorAll('.col h3')].map((h) => h.firstChild.textContent.trim())).toEqual(['초안', '모집중', '지원 종료', '배정', '진행', '검수대기', '완료']);
    expect(board.querySelector('[data-col="expired"] .job-card').getAttribute('data-job')).toBe(J2);
    expect(board.querySelector('script, img')).toBeNull();
    expect(board.querySelector(`[data-job="${J1}"]`).textContent).toContain(XSS);
    expect(board.querySelector(`[data-job="${J1}"]`).textContent).toContain('확정 1/2 · 신청 3');
    expect(board.querySelector(`[data-job="${J4}"]`)).toBeNull();
    $('fCancelled').checked = true;
    $('fCancelled').dispatchEvent(new Event('change'));
    expect(board.querySelector(`[data-col="cancelled"] [data-job="${J4}"]`)).not.toBeNull();
    $('fKind').value = 'as';
    $('fKind').dispatchEvent(new Event('change'));
    expect([...board.querySelectorAll('.job-card')].map((c) => c.getAttribute('data-job'))).toEqual([J2]);
    expect($('setupNotice').hidden).toBe(true);
  });

  test('표가 아직 없으면({ ready:false }) SQL 실행 안내, 서버에 /work 가 없으면(404) 배포 안내', async () => {
    const a = fakeApi({ me: { ready: false, worker: null }, jobs: { items: [] } });
    await start(a);
    expect($('setupNotice').hidden).toBe(false);
    expect($('setupNotice').textContent).toContain('database/work-jobs.sql');
    expect($('board').querySelectorAll('.col')).toHaveLength(7);

    const b = fakeApi({ override: (u) => (u.startsWith('/work/') ? { ok: false, status: 404, json: async () => ({ success: false, message: 'Not found' }) } : null) });
    await start(b);
    expect($('setupNotice').hidden).toBe(false);
    expect($('setupNotice').textContent).toContain('배포되지 않았습니다');
    expect($('statusLine').style.color).not.toBe('rgb(198, 40, 40)');
  });

  test('작업 상세 — 정보(주소 없음) · 신청자 이스케이프 · [선정] 은 approve, 다시 불러온다', async () => {
    const api = fakeApi();
    await start(api);
    await openJob1();
    expect($('jobModal').classList.contains('active')).toBe(true);
    expect($('jobTitle').textContent).toBe(JOB1.title);
    const modal = $('jobModal');
    expect(modal.querySelector('script, img')).toBeNull();
    expect($('jobInfo').textContent).toContain('150,000원 / 일 · 작업자에게 숨김');
    expect($('jobInfo').textContent).toContain(`범위 ${IMG}`);
    expect($('jobApplicants').textContent).toContain(`${XSS}가짜기사`);
    expect($('jobApplicants').textContent).toContain('설치 · 가상시 · 실적 2건');
    const before = api.calls.filter((c) => c.u === `/work/admin/jobs/${J1}`).length;
    await click(modal.querySelector(`[data-act="app-approve"][data-id="${A1}"]`));
    expect(writes(api)).toEqual([{ u: `/work/admin/applications/${A1}/approve`, method: 'POST', body: {}, auth: 'Bearer T' }]);
    expect(api.calls.filter((c) => c.u === `/work/admin/jobs/${J1}`).length).toBe(before + 1);
    expect($('jobStatus').textContent).toContain('선정했습니다');
  });

  test('보완요청은 사유 필수 · 제외는 사유 + 노쇼 표시 · 반려 사유는 선택', async () => {
    const api = fakeApi();
    await start(api);
    await openJob1();
    const modal = $('jobModal');
    // 승인 대기 중인 배정만 [승인] · [보완요청], 초대 중(offered)은 [제외] 만
    expect(modal.querySelector(`[data-asg="${S1}"]`).querySelectorAll('[data-act]')).toHaveLength(3);
    expect([...modal.querySelector(`[data-asg="${S2}"]`).querySelectorAll('[data-act]')].map((b) => b.getAttribute('data-act'))).toEqual(['asg-remove']);

    await click(modal.querySelector(`[data-act="asg-revision"][data-id="${S1}"]`));
    expect($('reasonModal').classList.contains('active')).toBe(true);
    expect($('reasonNoShowWrap').hidden).toBe(true);
    await click($('btnReasonOk'));
    expect($('reasonStatus').textContent).toBe('사유를 적어 주세요.');
    expect(writes(api)).toHaveLength(0);
    $('reasonText').value = '문짝 수평 다시';
    await click($('btnReasonOk'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/assignments/${S1}/revision`, body: { reason: '문짝 수평 다시' } });

    await click(modal.querySelector(`[data-act="asg-remove"][data-id="${S2}"]`));
    expect($('reasonNoShowWrap').hidden).toBe(false);
    $('reasonText').value = '연락 없음';
    $('reasonNoShow').checked = true;
    await click($('btnReasonOk'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/assignments/${S2}/remove`, body: { reason: '연락 없음', no_show: true } });

    await click(modal.querySelector(`[data-act="app-reject"][data-id="${A1}"]`));
    await click($('btnReasonOk'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/applications/${A1}/reject`, body: {} });

    const n = writes(api).length;
    await click(modal.querySelector(`[data-act="asg-revision"][data-id="${S1}"]`));
    await click($('btnReasonCancel'));
    expect(writes(api)).toHaveLength(n); // 그만두면 아무것도 보내지 않는다
  });

  test('회사 정정 — [이 기록 정정] 이 원본을 가리키고, 작업자에게 보이기는 체크한 대로 (기본 꺼짐)', async () => {
    const api = fakeApi();
    await start(api);
    await openJob1();
    const modal = $('jobModal');
    expect($('updateForm').hidden).toBe(false);
    expect($('uVisible').checked).toBe(false);
    expect([...modal.querySelectorAll('.timeline .tl')].map((li) => li.className)).toEqual(['tl tl-worker', 'tl tl-company']);

    await click(modal.querySelector(`[data-act="amend"][data-id="${U1}"]`));
    expect($('uAmends').hidden).toBe(false);
    expect($('uAmendsText').textContent).toContain('원본은 그대로 남습니다');
    expect($('uAssignment').value).toBe(S1);
    $('uBody').value = '수량 3개였음';
    await click($('btnAddUpdate'));
    expect(writes(api).pop()).toEqual({
      u: `/work/admin/jobs/${J1}/updates`, method: 'POST', auth: 'Bearer T',
      body: { kind: 'correction', body: '수량 3개였음', assignment_id: S1, amends_id: U1, visible_to_worker: false },
    });
    expect($('jobStatus').textContent).toContain('작업자에게 숨김');

    $('uKind').value = 'note';
    $('uAssignment').value = '';
    $('uBody').value = '내일 자재 도착';
    $('uVisible').checked = true;
    await click($('btnAddUpdate'));
    expect(writes(api).pop().body).toEqual({ kind: 'note', body: '내일 자재 도착', visible_to_worker: true });
  });

  test('직접 초대 — 이 작업 종류를 하고 아직 배정 안 된 승인 작업자만 고를 수 있다', async () => {
    const api = fakeApi();
    await start(api);
    await openJob1();
    expect($('inviteBox').hidden).toBe(false);
    const options = [...$('inviteWorker').options].map((o) => o.value).filter(Boolean);
    expect(options).toEqual([WK1]); // 이미배정(WK2) · 조립만 은 빠진다
    $('inviteWorker').value = WK1;
    await click($('btnInviteWorker'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/jobs/${J1}/invite`, body: { worker_id: WK1 } });
  });

  test('409(다른 관리자가 먼저 바꿈) — 이유를 알리고 상세를 다시 불러온다', async () => {
    const api = fakeApi({
      override: (u, m) => (u.endsWith('/approve') && m === 'POST'
        ? { ok: false, status: 409, json: async () => ({ success: false, message: '정원이 찼습니다' }) } : null),
    });
    await start(api);
    await openJob1();
    const before = api.calls.filter((c) => c.u === `/work/admin/jobs/${J1}`).length;
    await click($('jobModal').querySelector('[data-act="app-approve"]'));
    expect($('jobStatus').textContent).toContain('정원이 찼습니다');
    expect($('jobStatus').textContent).toContain('최신 상태로 다시 불러왔습니다');
    expect(api.calls.filter((c) => c.u === `/work/admin/jobs/${J1}`).length).toBe(before + 1);
  });

  test('[카톡으로 공유] — Web Share 가 있으면 공유, 없으면 클립보드 복사 (제목 없이)', async () => {
    const api = fakeApi();
    await start(api);
    await openJob1();
    const writeText = jest.fn(async () => {});
    setNav('clipboard', { writeText });
    await click($('jobModal').querySelector('[data-act="job-share"]'));
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0];
    expect(text).toContain('[다담가구 작업] 설치 · 가상시 시험구');
    expect(text).toContain(`/worker.html#job=${J1}`);
    expect(text).not.toContain('싱크대');
    expect($('jobStatus').textContent).toContain('복사했습니다');

    const share = jest.fn(async () => {});
    setNav('share', share);
    await click($('jobModal').querySelector('[data-act="job-share"]'));
    expect(share).toHaveBeenCalledWith({ title: '다담가구 작업', text });
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  test('작업 만들기 서랍 — 주소 · 연락처 칸이 없고, 초안 저장 → 저장하고 게시', async () => {
    const api = fakeApi();
    await start(api);
    expect($('btnNewJob').hidden).toBe(false);
    await click($('btnNewJob'));
    const drawer = $('jobDrawer');
    expect(drawer.classList.contains('active')).toBe(true);
    for (const el of drawer.querySelectorAll('input, textarea, select')) {
      expect(el.id).not.toMatch(/addr|phone|contact/i);
      const lab = drawer.querySelector(`label[for="${el.id}"]`);
      if (lab) expect(lab.textContent).not.toMatch(/주소|연락처|전화/);
    }
    expect($('jSlots').value).toBe('1');
    expect($('jPayVisible').checked).toBe(false);

    await click($('btnSaveJob'));
    expect($('drawerStatus').textContent).toBe('작업 종류를 골라 주세요.');
    expect(writes(api)).toHaveLength(0);

    $('jKind').value = 'as';
    $('jTitle').value = '시험 A/S';
    $('jRegion').value = '가상시';
    $('jStarts').value = '2026-10-22T10:00';
    $('jPay').value = '80000';
    $('jPayUnit').value = 'job';
    await click($('btnSavePublish'));
    const [create, publish] = writes(api);
    expect(create).toMatchObject({ u: '/work/admin/jobs', method: 'POST', body: { kind: 'as', title: '시험 A/S', region_label: '가상시', starts_at: '2026-10-22T01:00:00.000Z', slots: 1, mode: 'open', pay_amount: 80000, pay_unit: 'job', pay_visible: false } });
    expect(publish).toMatchObject({ u: `/work/admin/jobs/${J9}/publish`, method: 'POST' });
    expect(drawer.classList.contains('active')).toBe(false);
    expect($('jobModal').classList.contains('active')).toBe(true); // 만든 작업을 바로 연다
  });

  test('고치기 — 지금 값으로 채우고 PATCH 에 version 을 싣는다', async () => {
    const api = fakeApi();
    await start(api);
    await openJob1();
    await click($('jobModal').querySelector('[data-act="job-edit"]'));
    expect($('drawerTitle').textContent).toBe('작업 고치기');
    expect($('btnSavePublish').hidden).toBe(true);
    expect($('jTitle').value).toBe(JOB1.title);
    expect($('jStarts').value).toBe('2026-10-21T09:00');
    $('jSlots').value = '3';
    await click($('btnSaveJob'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/jobs/${J1}`, method: 'PATCH', body: { slots: 3, version: 4, pay_amount: 150000 } });
  });

  test('작업 취소는 사유 필수, 게시는 확인을 받는다', async () => {
    const api = fakeApi();
    await start(api);
    await openJob1();
    await click($('jobModal').querySelector('[data-act="job-cancel"]'));
    $('reasonText').value = '고객 일정 변경';
    await click($('btnReasonOk'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/jobs/${J1}/cancel`, body: { reason: '고객 일정 변경' } });
    expect($('jobModal').querySelector('[data-act="job-publish"]')).toBeNull(); // 모집중이면 게시 버튼 없음
  });

  test('작업자 탭 — 승인 대기 목록(이스케이프) · 승인 · 반려 사유 · 종류 저장 · 메모', async () => {
    const api = fakeApi();
    await start(api);
    await click(document.querySelector('#viewTabs [data-view="workers"]'));
    expect(api.calls.some((c) => c.u === '/work/admin/workers?status=pending')).toBe(true);
    const list = $('workerList');
    expect(list.querySelector('script, img')).toBeNull();
    expect(list.textContent).toContain(XSS);
    expect(list.textContent).toContain('초대 링크로 신청');
    expect(list.textContent).toContain('사진 동의 아니오');

    await click(list.querySelector('[data-act="wk-approve"]'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/workers/${WK1}`, method: 'PATCH', body: { status: 'approved' } });

    await click(list.querySelector('[data-act="wk-reject"]'));
    $('reasonText').value = '연락처 확인 불가';
    await click($('btnReasonOk'));
    expect(writes(api).pop()).toMatchObject({ body: { status: 'rejected', reject_reason: '연락처 확인 불가' } });

    list.querySelector(`input[data-kind-of="${WK1}"][value="as"]`).checked = true;
    await click(list.querySelector('[data-act="wk-kinds"]'));
    expect(writes(api).pop()).toMatchObject({ body: { kinds: ['install', 'as'] } });

    await click(list.querySelector('[data-act="wk-notes"]'));
    expect($('notesModal').classList.contains('active')).toBe(true);
    expect($('notesList').querySelector('script')).toBeNull();
    expect($('notesList').textContent).toContain(XSS);
    $('noteText').value = '성실함';
    await click($('btnAddNote'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/workers/${WK1}/notes`, method: 'POST', body: { note: '성실함' } });
  });

  test('메모를 못 읽는 역할(403)이면 분명한 안내', async () => {
    const api = fakeApi({ override: (u) => (u.endsWith('/notes') ? { ok: false, status: 403, json: async () => ({ success: false, message: 'Forbidden' }) } : null) });
    await start(api);
    await click(document.querySelector('#viewTabs [data-view="workers"]'));
    await click($('workerList').querySelector('[data-act="wk-notes"]'));
    expect($('workerStatus').textContent).toBe('메모는 super_admin · admin 만 볼 수 있습니다.');
  });

  test('초대 링크 — 만료 일시 칸은 비어 있고, 고르지 않으면 보내지 않는다. 만들면 복사 버튼', async () => {
    const api = fakeApi();
    await start(api);
    await click(document.querySelector('#viewTabs [data-view="workers"]'));
    expect($('inviteCard').hidden).toBe(false);
    expect($('invExpires').value).toBe('');
    expect($('invExpires').getAttribute('value')).toBeNull();
    await click($('btnInvite'));
    expect($('inviteStatus').textContent).toContain('만료 일시를 골라 주세요');
    expect(writes(api)).toHaveLength(0);

    document.querySelector('input[data-inv-kind][value="install"]').checked = true;
    $('invName').value = '시험 기사';
    $('invExpires').value = '2099-01-01T18:00';
    await click($('btnInvite'));
    expect(writes(api).pop()).toEqual({
      u: '/work/admin/invites', method: 'POST', auth: 'Bearer T',
      body: { kinds_preset: ['install'], display_name_preset: '시험 기사', expires_at: '2099-01-01T09:00:00.000Z' },
    });
    expect($('inviteResult').hidden).toBe(false);
    expect($('inviteUrl').value).toBe('https://example.test/worker.html#invite=fake-token');
    const writeText = jest.fn(async () => {});
    setNav('clipboard', { writeText });
    await click($('btnCopyInvite'));
    expect(writeText).toHaveBeenCalledWith('https://example.test/worker.html#invite=fake-token');
    expect($('inviteStatus').textContent).toBe('링크를 복사했습니다.');
  });

  test('읽기 전용 역할(support 등) — 쓰기 버튼 · 정정 입력 · 초대 링크 · 메모가 없다', async () => {
    const api = fakeApi();
    await start(api, { role: 'support' });
    expect($('readOnlyNotice').hidden).toBe(false);
    expect($('btnNewJob').hidden).toBe(true);
    await openJob1();
    const modal = $('jobModal');
    expect([...modal.querySelectorAll('[data-act]')].map((b) => b.getAttribute('data-act'))).toEqual(['job-share']);
    expect($('updateForm').hidden).toBe(true);
    expect($('inviteBox').hidden).toBe(true);
    $('jobModal').classList.remove('active');
    await click(document.querySelector('#viewTabs [data-view="workers"]'));
    expect($('inviteCard').hidden).toBe(true);
    // 쓰기 버튼은 없고, 읽기인 [이력] 만 있다 (support · moderator 도 이력은 본다)
    expect([...$('workerList').querySelectorAll('[data-act]')].map((b) => b.getAttribute('data-act'))).toEqual(['wk-events']);
    expect(api.calls.some((c) => c.u.includes('/notes'))).toBe(false);
  });

  test('Slack 링크(?job=<id>) 로 들어오면 그 작업 상세를 바로 연다', async () => {
    const api = fakeApi();
    await start(api, { url: `/admin/work-jobs.html?job=${J1}` });
    expect($('jobModal').classList.contains('active')).toBe(true);
    expect($('jobKind').textContent).toBe('설치');
  });

  // ── 1주차 후속 ──

  test('헬퍼 스크립트 ?v= 를 올렸다 (지원 종료일 · 이력 함수가 캐시된 옛 파일에 없다)', () => {
    const v = Number((HTML.match(/<script src="\.\.\/js\/work-jobs-admin\.js\?v=(\d+)"><\/script>/) || [])[1]);
    expect(v).toBeGreaterThanOrEqual(3);
    expect(HTML).not.toContain('신청 마감');
  });

  test('보드 — 지원 종료 칸 · 카드의 「지원 종료 날짜 · 꼬리표」 (한국 시간)', async () => {
    freezeNow(NOW);
    const api = fakeApi();
    await start(api);
    const board = $('board');
    expect(board.querySelector('[data-col="expired"] h3').firstChild.textContent.trim()).toBe('지원 종료');
    expect(board.querySelector(`[data-job="${J2}"] .jc-deadline`).textContent).toBe('지원 종료 10/21(수) 18:00 · 지원 종료');
    expect(board.querySelector(`[data-job="${J1}"] .jc-deadline`).textContent).toMatch(/^지원 종료 1\/1\(목\) 09:00 · D-\d+$/);
    expect(board.querySelector(`[data-job="${J3}"] .jc-deadline`)).toBeNull(); // 지원 종료일 없는 초안
  });

  test('작업 상세 — 「지원 종료일」 행 (없으면 정하지 않음), 공유 문구에 지원 종료일 한 줄', async () => {
    freezeNow(NOW);
    const api = fakeApi();
    await start(api);
    await openJob1();
    const info = $('jobInfo');
    const dt = [...info.querySelectorAll('dt')].find((d) => d.textContent === '지원 종료일');
    expect(dt).toBeTruthy();
    expect(dt.nextElementSibling.textContent).toMatch(/^1\/1\(목\) 09:00 · D-\d+$/);
    expect(info.textContent).not.toContain('신청 마감');

    const writeText = jest.fn(async () => {});
    setNav('clipboard', { writeText });
    await click($('jobModal').querySelector('[data-act="job-share"]'));
    expect(writeText.mock.calls[0][0].split('\n')).toEqual([
      '[다담가구 작업] 설치 · 가상시 시험구', '10/21(수) 09:00~18:00', '지원 종료일 1/1(목) 09:00', `${window.location.origin}/worker.html#job=${J1}`,
    ]);

    $('jobModal').classList.remove('active');
    const b = fakeApi();
    await start(b, { url: `/admin/work-jobs.html?job=${J9}` });
    const dt9 = [...$('jobInfo').querySelectorAll('dt')].find((d) => d.textContent === '지원 종료일');
    expect(dt9.nextElementSibling.textContent).toBe('정하지 않음');
  });

  test('서랍 — 「지원 종료일」 이름 · 도움말, 지난 시각은 경고만 하고 저장은 그대로 보낸다', async () => {
    freezeNow(NOW);
    const api = fakeApi();
    await start(api);
    await click($('btnNewJob'));
    expect(document.querySelector('label[for="jDeadline"]').textContent).toContain('지원 종료일');
    expect($('jDeadlineHelp').textContent).toBe(W.DEADLINE_HELP);
    expect($('jDeadlineWarn').hidden).toBe(true);

    $('jDeadline').value = '2026-10-22T11:00'; // 한국 11:00 < 지금 12:00
    $('jDeadline').dispatchEvent(new Event('input'));
    expect($('jDeadlineWarn').hidden).toBe(false);
    expect($('jDeadlineWarn').textContent).toBe("지원 종료일이 이미 지났습니다 — 게시하면 바로 '지원 종료'로 보입니다");
    $('jDeadline').value = '2026-10-25T18:00';
    $('jDeadline').dispatchEvent(new Event('change'));
    expect($('jDeadlineWarn').hidden).toBe(true);

    $('jDeadline').value = '2026-10-22T11:00';
    $('jDeadline').dispatchEvent(new Event('input'));
    $('jKind').value = 'install';
    $('jTitle').value = '시험 설치';
    await click($('btnSaveJob'));
    expect(writes(api)[0]).toMatchObject({ u: '/work/admin/jobs', method: 'POST', body: { apply_deadline: '2026-10-22T02:00:00.000Z' } });
  });

  test('지원 종료된 작업도 [고치기] 로 지원 종료일을 뒤로 — 서랍이 지난 값을 경고로 보이고, PATCH 에 새 값', async () => {
    freezeNow(NOW);
    const api = fakeApi();
    await start(api);
    document.querySelector(`.job-card[data-job="${J2}"]`).click();
    await settle();
    expect($('jobMeta').textContent).toContain('지원 종료');
    await click($('jobModal').querySelector('[data-act="job-edit"]'));
    expect($('jDeadline').value).toBe('2026-10-21T18:00');
    expect($('jDeadlineWarn').hidden).toBe(false);
    $('jDeadline').value = '2026-10-28T18:00';
    $('jDeadline').dispatchEvent(new Event('input'));
    expect($('jDeadlineWarn').hidden).toBe(true);
    await click($('btnSaveJob'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/jobs/${J2}`, method: 'PATCH', body: { apply_deadline: '2026-10-28T09:00:00.000Z', version: 2 } });
  });

  test('작업 취소 — 사유 창 안내에 응답 없는 초대 수, 응답의 auto_declined 를 알린다 · 이벤트 이름표', async () => {
    const api = fakeApi({ autoDeclined: 1 });
    await start(api);
    await openJob1();
    expect($('jobEvents').textContent).toContain('응답 없는 초대 자동 종료');
    expect($('jobEvents').textContent).not.toContain('assignment_auto_declined');
    await click($('jobModal').querySelector('[data-act="job-cancel"]'));
    expect($('reasonHint').textContent).toBe('배정된 작업자가 있으면 그 사람의 작업 화면에도 취소로 보입니다. 응답 없는 초대 1건은 자동으로 끝납니다.');
    $('reasonText').value = '고객 일정 변경';
    await click($('btnReasonOk'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/jobs/${J1}/cancel`, body: { reason: '고객 일정 변경' } });
    expect($('jobStatus').textContent).toBe('작업을 취소했습니다. 응답 없는 초대 1건을 끝냈습니다.');
  });

  test('조립 작업 닫기 — 확인 문구에 「검수」가 없고 응답 없는 초대 수가 있다, 그만두면 보내지 않는다', async () => {
    const api = fakeApi({ autoDeclined: 1 });
    await start(api, { url: `/admin/work-jobs.html?job=${J6}` });
    window.confirm = jest.fn(() => false);
    await click($('jobModal').querySelector('[data-act="job-close"]'));
    const text = window.confirm.mock.calls[0][0];
    expect(text).not.toContain('검수');
    expect(text).toContain('응답 없는 초대 1건은 자동으로 끝납니다.');
    expect(writes(api)).toHaveLength(0);

    window.confirm = jest.fn(() => true);
    await click($('jobModal').querySelector('[data-act="job-close"]'));
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/jobs/${J6}/close`, method: 'POST' });
    expect($('jobStatus').textContent).toBe('작업을 닫았습니다. 응답 없는 초대 1건을 끝냈습니다.');
  });

  test('정지 — 확인 문구에 진행 중인 배정 수, 정지 탭 행에 정지 상태 설명', async () => {
    const api = fakeApi();
    await start(api);
    await click(document.querySelector('#viewTabs [data-view="workers"]'));
    await click(document.querySelector('#workerTabs [data-wstatus="approved"]'));
    await click($('workerList').querySelector(`[data-act="wk-suspend"][data-id="${WK1}"]`));
    expect(window.confirm.mock.calls.pop()[0]).toContain('정지하면 새 작업 신청·초대 수락을 못 합니다. 진행 중인 배정 2건은 그대로 남으니 필요하면 작업에서 제외하세요.');
    expect(writes(api).pop()).toMatchObject({ u: `/work/admin/workers/${WK1}`, method: 'PATCH', body: { status: 'suspended' } });

    const b = fakeApi({ workers: [{ id: WK3, display_name: '정지기사', status: 'suspended', kinds: ['as'], active_count: 0, created_at: '2026-10-01T00:00:00Z' }] });
    await start(b);
    await click(document.querySelector('#viewTabs [data-view="workers"]'));
    const row = $('workerList').querySelector(`[data-worker="${WK3}"]`);
    expect(row.querySelector('.wk-suspended').textContent).toContain('새 작업 신청 · 초대 수락을 할 수 없습니다');
    expect(row.querySelector('.wk-suspended').textContent).not.toContain('진행 중인 배정');
  });

  test('작업자 [이력] — GET …/events 를 표로 (이스케이프), 404 · 빈 목록은 「기록 없음」', async () => {
    const events = [
      { type: 'status_changed', actor_kind: 'admin', from_status: 'pending', to_status: 'approved', created_at: '2026-10-19T00:00:00Z' },
      { type: 'registered', actor_kind: 'worker', to_status: 'pending', payload: { via: 'public' }, note: XSS, created_at: '2026-10-18T00:00:00Z' },
    ];
    const api = fakeApi({ workerEvents: events });
    await start(api);
    await click(document.querySelector('#viewTabs [data-view="workers"]'));
    await click($('workerList').querySelector(`[data-act="wk-events"][data-id="${WK1}"]`));
    expect(api.calls.some((c) => c.u === `/work/admin/workers/${WK1}/events` && c.method === 'GET')).toBe(true);
    expect($('workerEventsModal').classList.contains('active')).toBe(true);
    expect($('workerEventsTitle').textContent).toBe(`작업자 이력 — ${XSS}`);
    const list = $('workerEventsList');
    expect(list.querySelector('script, img')).toBeNull();
    expect(list.textContent).toContain('대기 → 승인');
    expect(list.textContent).toContain('가입 신청');
    expect(list.textContent).toContain('공개 신청');
    expect(list.textContent).toContain(XSS);

    for (const workerEvents of [404, []]) {
      const b = fakeApi({ workerEvents });
      await start(b);
      await click(document.querySelector('#viewTabs [data-view="workers"]'));
      await click($('workerList').querySelector('[data-act="wk-events"]'));
      expect($('workerEventsList').textContent).toBe('기록 없음');
      expect($('workerEventsStatus').style.color).not.toBe('rgb(198, 40, 40)');
    }
  });

  test('작업자 [이력] — 404 가 아닌 오류(500)는 「기록 없음」으로 합치지 않고 목록을 비운 채 서버 문구를 오류색으로', async () => {
    const api = fakeApi({ workerEvents: 500 });
    await start(api);
    await click(document.querySelector('#viewTabs [data-view="workers"]'));
    await click($('workerList').querySelector(`[data-act="wk-events"][data-id="${WK1}"]`));
    expect(api.calls.some((c) => c.u === `/work/admin/workers/${WK1}/events` && c.method === 'GET')).toBe(true);
    expect($('workerEventsModal').classList.contains('active')).toBe(true);
    const list = $('workerEventsList');
    expect(list.textContent).not.toContain('기록 없음');
    expect(list.textContent.trim()).toBe('');
    expect(list.children).toHaveLength(0);
    expect($('workerEventsStatus').textContent).toBe(EVENTS_500);
    expect($('workerEventsStatus').style.color).toBe('rgb(198, 40, 40)');
    expect(writes(api)).toHaveLength(0);
  });

  test('이력은 읽기 — support 역할도 [이력] 을 열 수 있다', async () => {
    const api = fakeApi({ workerEvents: [{ type: 'kinds_changed', actor_kind: 'admin', payload: { kinds: ['install', 'as'] }, created_at: '2026-10-19T00:00:00Z' }] });
    await start(api, { role: 'support' });
    await click(document.querySelector('#viewTabs [data-view="workers"]'));
    await click($('workerList').querySelector('[data-act="wk-events"]'));
    expect($('workerEventsList').textContent).toContain('작업 종류: 설치·A/S');
    expect(writes(api)).toHaveLength(0);
  });
});
