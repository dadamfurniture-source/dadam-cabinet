/**
 * 작업자 포털 화면 (worker.html + js/worker-portal.js) — docs/01-plan/worker-portal-contract.md §3 · §4.
 *
 * 순수 함수(상태 고르기 · 카드 · 상세 · 기록 · 신청서)를 먼저 고정하고,
 * 페이지 본문을 jsdom 에 올려 가짜 Supabase · fetch 로 상태별 화면이 뜨는지 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'worker.html'), 'utf8');
const P = require('../js/worker-portal.js');

const J1 = '11111111-1111-4111-8111-111111111111';
const A1 = '22222222-2222-4222-8222-222222222222';
const AP1 = '33333333-3333-4333-8333-333333333333';
const U1 = '44444444-4444-4444-8444-444444444444';
const U2 = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'TESTtoken_abcdefghijklmnop-0123456789';
const XSS = '<script>alert(1)</script>';
const NOW = Date.parse('2026-10-20T01:00:00Z'); // 10/20(화) 10:00 KST

function card(over) {
  return {
    id: J1, kind: 'install', title: '싱크대 설치', region_label: '테스트시 가구', starts_at: '2026-10-21T00:00:00Z',
    ends_at: '2026-10-21T09:00:00Z', apply_deadline: null, slots: 2, filled: 1, effective_status: 'open', my: {},
    ...over,
  };
}
function detail(over) {
  return { ...card(), detail: '상부장 3칸', site: null, site_note: '현장 주소·연락처는 공개 기간이 정해지면 열립니다', timeline: [], ...over };
}

describe('esc · 카드 — 사용자 글은 글자로 나온다', () => {
  test('esc 는 꺾쇠 · 따옴표 · & 를 바꾼다', () => {
    expect(P.esc(`${XSS}"'&`)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;');
    expect(P.esc(null)).toBe('');
  });

  test('작업 카드 — 제목 · 지역의 <script> 는 글자, 링크는 #job=<id>', () => {
    const html = P.jobCardHtml(card({ title: XSS, region_label: '<img src=x onerror=alert(1)>' }), NOW);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain(`href="#job=${J1}"`);
    expect(html).toContain('설치');
    expect(html).toContain('D-1');
    expect(html).toContain('확정 1/2명');
  });

  test('id 가 UUID 가 아니면 카드를 그리지 않는다 (주소에 엉뚱한 값이 섞이지 않게)', () => {
    expect(P.jobCardHtml(card({ id: '"><script>x</script>' }), NOW)).toBe('');
  });

  test('금액은 서버가 준 pay 만 — 없으면 아무 문구도 없다', () => {
    expect(P.payText(null)).toBe('');
    expect(P.payText({ amount: 150000, unit: 'day' })).toBe('150,000원 / 일');
    expect(P.jobCardHtml(card(), NOW)).not.toContain('원');
    expect(P.jobCardHtml(card({ pay: { amount: 150000, unit: 'day' } }), NOW)).toContain('150,000원 / 일');
  });

  test('내 상태 칩 — 배정 > 신청 > 작업 상태', () => {
    expect(P.myStatus(card({ my: { assignment_id: A1, assignment_status: 'offered', application_status: 'applied' } })).text).toBe('초대 받음');
    expect(P.myStatus(card({ my: { application_id: AP1, application_status: 'applied' } })).text).toBe('신청함');
    expect(P.myStatus(card({ effective_status: 'expired' })).text).toBe('신청 마감');
  });

  test('빈 목록은 탭마다 안내', () => {
    expect(P.jobListHtml([], 'open', NOW)).toContain('모집 중인 작업이 없습니다');
    expect(P.jobListHtml([], 'mine', NOW)).toContain('초대를 받으면');
  });
});

describe('주소 # 읽기 · 로그인 링크', () => {
  test('invite · job · tab 을 읽고, 형식이 틀리면 버린다', () => {
    expect(P.parseHash(`#invite=${TOKEN}`)).toEqual({ invite: TOKEN, job: null, tab: null, badJob: false });
    expect(P.parseHash(`#job=${J1.toUpperCase()}`).job).toBe(J1);
    expect(P.parseHash('#tab=mine').tab).toBe('mine');
    expect(P.parseHash('#tab=admin').tab).toBe(null);
    expect(P.parseHash('#job=../../x').badJob).toBe(true);
    expect(P.parseHash('#invite=<script>').invite).toBe(null);
    expect(P.parseHash('#invite=short').invite).toBe(null);
    expect(P.parseHash('').job).toBe(null);
  });

  test('돌아올 곳은 같은 사이트 상대 경로 + 해시 — login.html?redirect= 에 인코딩해 싣는다', () => {
    expect(P.returnTarget({}, TOKEN)).toBe(`worker.html#invite=${TOKEN}`);
    expect(P.returnTarget({ job: J1 }, null)).toBe(`worker.html#job=${J1}`);
    expect(P.returnTarget({ tab: 'done' }, null)).toBe('worker.html#tab=done');
    expect(P.returnTarget({}, null)).toBe('worker.html');
    expect(P.loginHref(`worker.html#job=${J1}`)).toBe(`login.html?redirect=worker.html%23job%3D${J1}`);
  });
});

describe('상태별 화면 고르기 (계약 §4)', () => {
  const me = (worker, ready = true) => ({ ready, worker, counts: { open: 0, mine: 0, revision: 0, newEvents: 0 } });
  test.each([
    [{ apiReady: false, session: true, me: me(null) }, 'no_api'],
    [{ apiReady: true, session: null }, 'login'],
    [{ apiReady: true, session: true, me: me(null, false) }, 'not_ready'],
    [{ apiReady: true, session: true, me: me(null) }, 'register'],
    [{ apiReady: true, session: true, me: me({ status: 'pending' }) }, 'pending'],
    [{ apiReady: true, session: true, me: me({ status: 'approved' }) }, 'approved'],
    [{ apiReady: true, session: true, me: me({ status: 'rejected' }) }, 'rejected'],
    [{ apiReady: true, session: true, me: me({ status: 'suspended' }) }, 'suspended'],
  ])('%j → %s', (state, view) => {
    expect(P.selectView(state)).toBe(view);
  });

  test('처음 탭 — 주소의 탭, 없으면 내 작업이 있을 때 내 작업', () => {
    expect(P.defaultTab({ tab: 'done' }, { mine: 3 })).toBe('done');
    expect(P.defaultTab({}, { mine: 2 })).toBe('mine');
    expect(P.defaultTab({}, { mine: 0 })).toBe('open');
  });

  test('탭 줄 — 건수, 보완요청 · 새 소식은 탭 아래 한 줄, 지금 탭에 aria-current', () => {
    const html = P.tabsHtml('mine', { open: 3, mine: 2, revision: 1, newEvents: 4 });
    expect(html).toContain('href="#tab=open"');
    expect(html).toMatch(/모집중<\/span><span class="n">3<\/span>/);
    expect(html).toMatch(/내 작업<\/span><span class="n">2<\/span>/);
    expect(html).toContain('보완요청 1건 · 새 소식 4건');
    expect(html).toMatch(/class="tab on" aria-current="page"><span>내 작업/);
    const empty = P.tabsHtml('open', {});
    expect(empty).not.toContain('class="n"');
    expect(empty).not.toContain('tab-note');
  });
});

describe('신청서 (POST /work/register · /work/claim-invite)', () => {
  const ok = { display_name: ' 테스트 작업자 ', phone: '010-0000-0000', kinds: ['install', 'as', 'install', 'bogus'], region_label: '테스트시', consent: true, photo_consent: false };

  test('정상 — 값을 다듬고 동의 버전을 붙인다. 주민번호 · 계좌 칸은 없다', () => {
    const { body, errors } = P.registrationBody(ok, null);
    expect(errors).toEqual([]);
    expect(body).toEqual({
      display_name: '테스트 작업자', phone: '010-0000-0000', kinds: ['install', 'as'], region_label: '테스트시',
      consent_version: P.CONSENT_VERSION, photo_consent: false,
    });
    expect(P.CONSENT_VERSION.length).toBeLessThanOrEqual(40);
  });

  test('필수 동의 · 이름 · 작업 종류가 없으면 막는다', () => {
    const { errors } = P.registrationBody({ ...ok, display_name: '', kinds: [], consent: false }, null);
    expect(errors.join(' ')).toMatch(/이름/);
    expect(errors.join(' ')).toMatch(/작업 종류/);
    expect(errors.join(' ')).toMatch(/동의/);
  });

  test('휴대폰 형식 · 글자 수', () => {
    expect(P.registrationBody({ ...ok, phone: '010-abc' }, null).errors.join(' ')).toMatch(/휴대폰/);
    expect(P.registrationBody({ ...ok, display_name: 'x'.repeat(31) }, null).errors.join(' ')).toMatch(/30자/);
    expect(P.registrationBody({ ...ok, phone: '' }, null).body.phone).toBe(null);
  });

  test('초대로 오면 token 을 싣고, 작업 종류는 초대 프리셋에 맡길 수 있다', () => {
    const { body, errors } = P.registrationBody({ ...ok, kinds: [] }, TOKEN);
    expect(errors).toEqual([]);
    expect(body.token).toBe(TOKEN);
    expect(body.consent_version).toBe(P.CONSENT_VERSION);
  });
});

describe('작업 상세에서 할 수 있는 일 (서버 조건과 같다)', () => {
  const acts = (my, eff = 'open', kind = 'install') => P.availableActions(detail({ my, effective_status: eff, kind }));

  test('모집중 · 신청 없음 → 신청만', () => {
    expect(acts({})).toMatchObject({ apply: true, withdraw: false, start: false, reports: [] });
    expect(acts({}, 'expired').apply).toBe(false);
  });
  test('신청 대기 → 철회', () => {
    expect(acts({ application_id: AP1, application_status: 'applied' })).toMatchObject({ apply: false, withdraw: true });
  });
  test('초대 받음 → 수락 · 거절', () => {
    expect(acts({ assignment_id: A1, assignment_status: 'offered' }, 'filled')).toMatchObject({ confirm: true, decline: true, start: false, reports: [] });
  });
  test('확정 → 시작 · 포기 · 진행/문제 보고', () => {
    expect(acts({ assignment_id: A1, assignment_status: 'confirmed' }, 'filled')).toMatchObject({ start: true, release: true, reports: ['progress', 'issue'] });
  });
  test('작업 중 · 보완요청 → 완료 보고까지', () => {
    expect(acts({ assignment_id: A1, assignment_status: 'started' }, 'in_progress')).toMatchObject({ release: true, reports: ['progress', 'issue', 'result'] });
    expect(acts({ assignment_id: A1, assignment_status: 'revision' }, 'in_progress')).toMatchObject({ release: false, reports: ['progress', 'issue', 'result'] });
  });
  test('완료 뒤에도 추가 보고 (★5 가) — 완료 보고는 다시 못 한다', () => {
    expect(acts({ assignment_id: A1, assignment_status: 'accepted' }, 'done').reports).toEqual(['progress', 'issue']);
    expect(acts({ assignment_id: A1, assignment_status: 'submitted' }, 'review').reports).toEqual(['progress', 'issue']);
  });
  test('닫히거나 취소된 작업 · 포기한 배정 → 아무것도 못 한다', () => {
    expect(acts({ assignment_id: A1, assignment_status: 'accepted' }, 'closed').reports).toEqual([]);
    expect(acts({ assignment_id: A1, assignment_status: 'confirmed' }, 'cancelled')).toMatchObject({ start: false, release: false, reports: [] });
    expect(acts({ assignment_id: A1, assignment_status: 'released' }, 'open')).toMatchObject({ apply: false, reports: [] });
  });
});

describe('작업 상세 · 기록', () => {
  test('현장 주소 대신 site_note — 주소 · 연락처 칸이 없다', () => {
    const html = P.jobDetailHtml(detail({ my: { assignment_id: A1, assignment_status: 'confirmed' }, order_no: 'TEST-0001', customer_masked: '테*' }), NOW, 'mine');
    expect(html).toContain('현장 주소·연락처는 공개 기간이 정해지면 열립니다');
    expect(html).toContain('TEST-0001');
    expect(html).toContain('테*');
    expect(html).not.toMatch(/주소<\/dt>|연락처<\/dt>/);
    expect(html).toContain('href="#tab=mine"');
    expect(html).toContain('data-act="start"');
    expect(html).toContain('data-form="release"');
  });

  test('site_note 가 비면 계약 문구로 채운다', () => {
    expect(P.jobDetailHtml(detail({ site_note: undefined }), NOW, 'open')).toContain(P.SITE_NOTE);
  });

  test('상세의 제목 · 내용 · 가린 이름도 글자로', () => {
    const html = P.jobDetailHtml(detail({ title: XSS, detail: XSS, customer_masked: XSS, my: { assignment_id: A1, assignment_status: 'confirmed' } }), NOW, 'mine');
    expect(html).not.toContain('<script>');
    expect(html.match(/&lt;script&gt;/g).length).toBe(3);
  });

  test('모집중 · 신청 없음 → 신청 양식 (메모 300자)', () => {
    const html = P.jobDetailHtml(detail(), NOW, 'open');
    expect(html).toContain('data-form="apply"');
    expect(html).toContain('maxlength="300"');
    expect(html).not.toContain('작업 기록'); // 배정 전에는 기록 칸이 없다
  });

  test('완료 보고 안내 — 설치 · A/S 는 검수, 조립은 바로 완료', () => {
    const my = { assignment_id: A1, assignment_status: 'started' };
    expect(P.jobDetailHtml(detail({ my, kind: 'install' }), NOW, 'mine')).toContain('회사가 검수한 뒤');
    expect(P.jobDetailHtml(detail({ my, kind: 'assembly' }), NOW, 'mine')).toContain('바로 완료로 기록됩니다');
  });

  test('기록 — 회사 정정은 「회사 정정」으로 표시하고 원래 기록을 가리킨다. 본문은 글자로', () => {
    const tl = [
      { id: U1, assignment_id: A1, author_role: 'worker', kind: 'progress', body: `수평 맞춤 ${XSS}`, issue_chips: [], amends_id: null, created_at: '2026-10-21T02:00:00Z' },
      { id: U2, assignment_id: A1, author_role: 'company', kind: 'correction', body: '수량 3 → 4', issue_chips: [], amends_id: U1, created_at: '2026-10-21T05:30:00Z' },
      { id: 'x', assignment_id: null, author_role: 'company', kind: 'note', body: '공지', issue_chips: [], amends_id: null, created_at: '2026-10-21T06:00:00Z' },
    ];
    const html = P.timelineHtml(tl);
    expect(html).toContain('내 보고 · 진행 보고');
    expect(html).toContain('회사 정정');
    expect(html).toContain('회사 메모');
    expect(html).toContain('진행 보고 10/21(수) 11:00 을(를) 바로잡은 기록');
    expect(html).toContain('원래 기록은 그대로');
    expect(html).not.toContain('<script>');
    expect(P.timelineHtml([])).toContain('아직 기록이 없습니다');
  });

  test('내 정보 — 이름은 글자로, 받지 않는 정보 안내', () => {
    const html = P.workerInfoHtml({ id: 'w', status: 'approved', display_name: XSS, phone: null, kinds: ['install', 'assembly'], region_label: null, photo_consent: true, consent_version: P.CONSENT_VERSION });
    expect(html).not.toContain('<script>');
    expect(html).toContain('설치 · 조립 추가 인원');
    expect(html).toContain('주민등록번호 · 계좌는 받지 않습니다');
    expect(html).toContain('data-act="logout"');
  });
});

describe('worker.html — 머리 · 신청서', () => {
  test('noindex · no-referrer · 스크립트 ?v=', () => {
    expect(HTML).toMatch(/<meta name="robots" content="noindex, nofollow, noarchive" \/>/);
    expect(HTML).toMatch(/<meta name="referrer" content="no-referrer" \/>/);
    expect(HTML).toMatch(/<script src="js\/worker-portal\.js\?v=\d+"><\/script>/);
    expect(HTML).toMatch(/max-width: 560px/);
  });

  test('신청서 — 수집 항목 · 목적 · 주민번호/계좌 안내 · 사진 동의 따로, 받지 않는 칸 없음', () => {
    expect(HTML).toContain('이름 · 휴대폰(선택) · 작업 종류 · 활동 지역');
    expect(HTML).toContain('주민등록번호 · 계좌는 받지 않습니다');
    expect(HTML).toMatch(/name="consent"/);
    expect(HTML).toMatch(/name="photo_consent"/);
    ['install', 'as', 'assembly'].forEach((k) => expect(HTML).toContain(`name="kind_${k}" value="${k}" data-kind`));
    expect(HTML).not.toMatch(/name="(rrn|resident|ssn|bank|account|account_no)"/i);
  });

  test('글자는 16px 이상', () => {
    const sizes = [...HTML.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
  });
});

// ── 페이지를 jsdom 에 올려 본다 ──
// 본문 = <body> 다음부터 페이지 스크립트 앞까지 (못 찾으면 시험이 바로 깨지게 한다)
const BODY_START = HTML.search(/<body>/);
const BODY_END = HTML.search(/<script src="js\/worker-portal\.js/);
if (BODY_START < 0 || BODY_END < BODY_START) throw new Error('worker.html 본문 경계를 찾지 못했습니다');
const BODY = HTML.slice(BODY_START + '<body>'.length, BODY_END);
const API = 'https://api.test';
const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 15; i++) await flush();
}

function mount({ session = true, routes = {}, hash = '' } = {}) {
  document.body.innerHTML = BODY;
  window.history.replaceState(null, '', `/worker.html${hash}`);
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'anon' }, workflowApi: { url: API } };
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: session ? { access_token: 'jwt-test', user: { id: 'u' } } : null } }),
        signOut: async () => ({}),
      },
    }),
  };
  window.scrollTo = jest.fn();
  window.confirm = jest.fn(() => true);
  const calls = [];
  global.fetch = jest.fn(async (url, opts = {}) => {
    const p = url.replace(API, '');
    const method = opts.method || 'GET';
    calls.push({ method, path: p, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers && opts.headers.Authorization });
    const hit = routes[`${method} ${p}`];
    const r = typeof hit === 'function' ? hit() : hit;
    if (!r) return { ok: false, status: 404, json: async () => ({ success: false, message: 'Not found' }) };
    const status = r.status || 200;
    return { ok: status < 400, status, json: async () => (status < 400 ? { success: true, data: r.data } : { success: false, message: r.message }) };
  });
  P.start();
  return calls;
}
const visible = (id) => !document.getElementById(id).hidden;
const COUNTS = { open: 1, mine: 1, revision: 0, newEvents: 0 };

describe('페이지 — 상태별 화면', () => {
  beforeEach(() => sessionStorage.clear());

  test('미로그인 + 초대 링크 → 로그인 안내, 토큰은 sessionStorage, 로그인 링크가 돌아올 곳을 싣는다', async () => {
    const calls = mount({ session: false, hash: `#invite=${TOKEN}` });
    await settle();
    expect(visible('viewLogin')).toBe(true);
    expect(visible('loginInviteNote')).toBe(true);
    expect(sessionStorage.getItem(P.INVITE_KEY)).toBe(TOKEN);
    expect(document.getElementById('loginLink').getAttribute('href')).toBe(`login.html?redirect=${encodeURIComponent(`worker.html#invite=${TOKEN}`)}`);
    expect(calls).toEqual([]);
  });

  test('로그인 + 작업자 아님 + 보관된 초대 → 초대 신청서, 보내면 claim-invite 에 토큰 · 동의 버전', async () => {
    sessionStorage.setItem(P.INVITE_KEY, TOKEN);
    const calls = mount({
      routes: {
        'GET /work/me': { data: { ready: true, worker: null, counts: {} } },
        'POST /work/claim-invite': { status: 201, data: { id: 'w', status: 'pending', display_name: '테스트 작업자', kinds: ['install'], region_label: null } },
      },
    });
    await settle();
    expect(visible('viewRegister')).toBe(true);
    expect(visible('regInviteNote')).toBe(true);
    const f = document.getElementById('regForm');
    f.elements.display_name.value = '테스트 작업자';
    f.elements.consent.checked = true;
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const claim = calls.find((c) => c.path === '/work/claim-invite');
    expect(claim.body).toMatchObject({ token: TOKEN, display_name: '테스트 작업자', consent_version: P.CONSENT_VERSION, photo_consent: false });
    expect(claim.auth).toBe('Bearer jwt-test');
    expect(sessionStorage.getItem(P.INVITE_KEY)).toBe(null);
    expect(visible('viewPending')).toBe(true);
  });

  test('동의 안 하면 보내지 않는다', async () => {
    const calls = mount({ routes: { 'GET /work/me': { data: { ready: true, worker: null, counts: {} } } } });
    await settle();
    const f = document.getElementById('regForm');
    f.elements.display_name.value = '테스트';
    f.querySelector('input[value="install"]').checked = true;
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.some((c) => c.path === '/work/register')).toBe(false);
    expect(document.getElementById('alert').textContent).toMatch(/동의/);
  });

  test('표가 아직 없으면(ready:false) 준비 중', async () => {
    mount({ routes: { 'GET /work/me': { data: { ready: false, worker: null, counts: {} } } } });
    await settle();
    expect(visible('viewNotReady')).toBe(true);
  });

  test('승인 대기 → 대기 화면 (이름은 글자로)', async () => {
    mount({ routes: { 'GET /work/me': { data: { ready: true, worker: { id: 'w', status: 'pending', display_name: XSS, kinds: ['as'] }, counts: {} } } } });
    await settle();
    expect(visible('viewPending')).toBe(true);
    expect(document.getElementById('pendingInfo').innerHTML).not.toContain('<script>');
    expect(document.getElementById('pendingInfo').textContent).toContain(XSS);
  });

  test('승인 작업자 → 탭 + 내 작업 목록 (제목은 글자로)', async () => {
    const calls = mount({
      routes: {
        'GET /work/me': { data: { ready: true, worker: { id: 'w', status: 'approved', display_name: '테스트 작업자', kinds: ['install'] }, counts: COUNTS } },
        'GET /work/jobs?tab=mine': { data: { items: [card({ title: XSS, my: { assignment_id: A1, assignment_status: 'confirmed' } })] } },
      },
    });
    await settle();
    expect(visible('viewApp')).toBe(true);
    expect(document.querySelector('.tab.on').textContent).toContain('내 작업');
    const body = document.getElementById('appBody');
    expect(body.querySelector('script')).toBe(null);
    expect(body.textContent).toContain(XSS);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /work/me', 'GET /work/jobs?tab=mine']);
  });

  test('작업 상세 #job= → 시작 누르면 POST start 후 다시 그린다', async () => {
    const confirmed = detail({ effective_status: 'filled', my: { assignment_id: A1, assignment_status: 'confirmed' } });
    const started = detail({ effective_status: 'in_progress', my: { assignment_id: A1, assignment_status: 'started' } });
    let state = confirmed;
    const calls = mount({
      hash: `#job=${J1}`,
      routes: {
        'GET /work/me': { data: { ready: true, worker: { id: 'w', status: 'approved', display_name: '테스트', kinds: ['install'] }, counts: COUNTS } },
        [`GET /work/jobs/${J1}`]: () => ({ data: state }),
        [`POST /work/assignments/${A1}/start`]: () => {
          state = started;
          return { data: { id: A1, status: 'started' } };
        },
      },
    });
    await settle();
    expect(document.getElementById('appBody').textContent).toContain('현장 주소·연락처는 공개 기간이 정해지면 열립니다');
    document.querySelector('[data-act="start"]').click();
    await settle();
    expect(calls.some((c) => c.method === 'POST' && c.path === `/work/assignments/${A1}/start`)).toBe(true);
    expect(document.querySelector('[data-form="report"] input[value="result"]')).not.toBe(null);
  });

  test('포기는 사유가 있어야 보낸다', async () => {
    const calls = mount({
      hash: `#job=${J1}`,
      routes: {
        'GET /work/me': { data: { ready: true, worker: { id: 'w', status: 'approved', display_name: '테스트', kinds: ['install'] }, counts: COUNTS } },
        [`GET /work/jobs/${J1}`]: { data: detail({ effective_status: 'filled', my: { assignment_id: A1, assignment_status: 'confirmed' } }) },
        [`POST /work/assignments/${A1}/release`]: { data: { id: A1, status: 'released' } },
      },
    });
    await settle();
    const form = document.querySelector('[data-form="release"]');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.some((c) => c.path.endsWith('/release'))).toBe(false);
    form.elements.reason.value = '테스트 사유';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.find((c) => c.path.endsWith('/release')).body).toEqual({ reason: '테스트 사유' });
  });
});
