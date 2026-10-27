/**
 * 작업자 포털 화면 (worker.html + js/worker-portal.js) — docs/01-plan/worker-portal-contract.md §3 · §4.
 *
 * 순수 함수(상태 고르기 · 카드 · 상세 · 기록 · 신청서)를 먼저 고정하고,
 * 페이지 본문을 jsdom 에 올려 가짜 Supabase · fetch 로 상태별 화면이 뜨는지 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { version: ASSET_VERSION } = require('../scripts/asset-version.json');
const HTML =fs.readFileSync(path.join(ROOT, 'worker.html'), 'utf8');
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
    // 1주차 후속 0 — expired 의 화면 이름은 「지원 종료」 (「신청 마감」 글자는 없앤다)
    expect(P.myStatus(card({ effective_status: 'expired' })).text).toBe('지원 종료');
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

// 앞 시험의 start() 가 단 hashchange 듣개 — 다음 mount 전에 뗀다 (안 떼면 주소를 바꿀 때 옛 화면들도 같이 다시 그린다)
const LIVE_HASH_LISTENERS = [];
function startPortal() {
  LIVE_HASH_LISTENERS.splice(0).forEach((fn) => window.removeEventListener('hashchange', fn));
  const orig = window.addEventListener;
  window.addEventListener = function (type, fn, o) {
    if (type === 'hashchange') LIVE_HASH_LISTENERS.push(fn);
    return orig.call(this, type, fn, o);
  };
  try {
    P.start();
  } finally {
    window.addEventListener = orig;
  }
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
  startPortal();
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

// ── 1주차 후속 (2026-10-20, 계약 머리 "1주차 후속" 절) ──

describe('지원 종료일 — 형식 · 꼬리표 (KST, 날짜 경계)', () => {
  const at = (iso) => Date.parse(iso);

  test('형식은 한국 시간 "10/25(일) 18:00"', () => {
    expect(P.fmtDateTime('2026-10-25T09:00:00Z')).toBe('10/25(일) 18:00');
    // UTC 로는 10/20 이지만 한국은 10/21 0시
    expect(P.fmtDateTime('2026-10-20T15:00:00Z')).toBe('10/21(수) 00:00');
  });

  test.each([
    ['2026-10-25T09:00:00Z', NOW, 'D-5'],
    ['2026-10-20T09:00:00Z', NOW, '오늘 종료'], // 같은 날 18:00, 지금 10:00
    ['2026-10-20T14:59:00Z', NOW, '오늘 종료'], // 같은 날 23:59
    ['2026-10-20T15:00:00Z', NOW, 'D-1'], // 다음 날 00:00 — UTC 로는 같은 날이지만 한국 날짜로 하루 뒤
    ['2026-10-20T01:00:00Z', NOW, '오늘 종료'], // 지금과 같은 시각은 아직 안 지남 (서버 expired = 지원 종료일 < 지금)
    ['2026-10-20T00:59:00Z', NOW, '지원 종료'], // 1분 전
    ['2026-10-18T09:00:00Z', NOW, '지원 종료'],
    ['2026-10-20T15:30:00Z', at('2026-10-20T14:30:00Z'), 'D-1'], // 밤 23:30 에 본 다음 날 00:30 — 한 시간 남아도 D-1
    ['2026-10-20T14:45:00Z', at('2026-10-20T14:30:00Z'), '오늘 종료'],
    ['2026-10-21T10:00:00Z', at('2026-10-20T16:00:00Z'), '오늘 종료'], // 한국 10/21 01:00 에 본 10/21 19:00 (UTC 날짜는 다르다)
  ])('%s (지금 %s) → %s', (iso, now, tag) => {
    expect(P.deadlineTag(iso, now)).toBe(tag);
  });

  test('지원 종료일이 없거나 이상하면 꼬리표 없음 · 지나지 않음', () => {
    expect(P.deadlineTag(null, NOW)).toBe('');
    expect(P.deadlineTag('nope', NOW)).toBe('');
    expect(P.deadlinePassed(null, NOW)).toBe(false);
    expect(P.deadlinePassed('2026-10-20T00:59:00Z', NOW)).toBe(true);
    expect(P.deadlinePassed('2026-10-20T01:00:00Z', NOW)).toBe(false);
  });

  test('꼬리표 HTML — 오늘 종료 · 지원 종료는 눈에 띄는 칸', () => {
    expect(P.deadlineTagHtml('오늘 종료')).toBe('<span class="dl-tag dl-today">오늘 종료</span>');
    expect(P.deadlineTagHtml('지원 종료')).toContain('dl-over');
    expect(P.deadlineTagHtml('D-3')).toContain('dl-days');
    expect(P.deadlineTagHtml('')).toBe('');
  });
});

describe('지원 종료일 — 카드 · 상세 · 신청 버튼', () => {
  test('모집중 카드 — "지원 종료일 10/25(일) 18:00 · D-5", 없으면 줄이 없다', () => {
    const html = P.jobCardHtml(card({ apply_deadline: '2026-10-25T09:00:00Z' }), NOW, 'open');
    expect(html).toContain('지원 종료일 10/25(일) 18:00 · <span class="dl-tag dl-days">D-5</span>');
    expect(P.jobCardHtml(card(), NOW, 'open')).not.toContain('지원 종료일');
  });

  test('모집중 카드 — 오늘 종료는 눈에 띄게', () => {
    const html = P.jobListHtml([card({ apply_deadline: '2026-10-20T09:00:00Z' })], 'open', NOW);
    expect(html).toContain('지원 종료일 10/20(화) 18:00 · <span class="dl-tag dl-today">오늘 종료</span>');
  });

  test('내 작업 · 완료 카드에는 지원 종료일 줄이 없다', () => {
    const c = card({ apply_deadline: '2026-10-25T09:00:00Z', my: { assignment_id: A1, assignment_status: 'confirmed' } });
    expect(P.jobCardHtml(c, NOW, 'mine')).not.toContain('지원 종료일');
    expect(P.jobListHtml([c], 'done', NOW)).not.toContain('지원 종료일');
  });

  test('상세 사실 행 「지원 종료일」 — 없으면 "정하지 않음 (정원이 차면 마감)"', () => {
    const none = P.jobDetailHtml(detail(), NOW, 'open');
    expect(none).toContain('<dt>지원 종료일</dt><dd>정하지 않음 (정원이 차면 마감)</dd>');
    expect(none).not.toContain('신청 마감');
    const some = P.jobDetailHtml(detail({ apply_deadline: '2026-10-23T09:00:00Z' }), NOW, 'open');
    expect(some).toContain('<dt>지원 종료일</dt><dd>10/23(금) 18:00 · <span class="dl-tag dl-days">D-3</span></dd>');
  });

  test('상세 꼬리표는 모집중 · 지원 종료 작업에만 (인원이 찼으면 날짜만)', () => {
    const filled = P.jobDetailHtml(detail({ apply_deadline: '2026-10-23T09:00:00Z', effective_status: 'filled', my: { assignment_id: A1, assignment_status: 'confirmed' } }), NOW, 'mine');
    expect(filled).toContain('<dt>지원 종료일</dt><dd>10/23(금) 18:00</dd>');
    const expired = P.jobDetailHtml(detail({ apply_deadline: '2026-10-19T09:00:00Z', effective_status: 'expired' }), NOW, 'open');
    expect(expired).toContain('<span class="dl-tag dl-over">지원 종료</span>');
  });

  test('화면 시각으로 지났으면 신청 양식 대신 잠긴 「지원 종료」 버튼 (서버가 아직 open 이라고 해도)', () => {
    const d = detail({ apply_deadline: '2026-10-20T00:30:00Z', effective_status: 'open' });
    expect(P.availableActions(d, { nowMs: NOW })).toMatchObject({ apply: false, applyEnded: true });
    const html = P.jobDetailHtml(d, NOW, 'open');
    expect(html).not.toContain('data-form="apply"');
    expect(html).toContain('<button type="button" class="big" disabled>지원 종료</button>');
    expect(html).toContain('지원 종료일이 지났습니다.');
    // 상태 칩도 화면 시각을 따른다 — 「모집중」 칩과 「지원 종료」 꼬리표가 엇갈리지 않게
    expect(html).toContain('<span class="chip t-off">지원 종료</span>');
    expect(html).not.toContain('모집중');
    expect(P.jobCardHtml(card({ apply_deadline: '2026-10-20T00:30:00Z' }), NOW, 'open')).toContain('<span class="chip t-off">지원 종료</span>');
    // 아직 전이면 신청 양식
    expect(P.jobDetailHtml(detail({ apply_deadline: '2026-10-20T09:00:00Z' }), NOW, 'open')).toContain('data-form="apply"');
  });

  test('서버가 expired 로 준 작업도 잠긴 「지원 종료」 — 신청 · 배정이 있으면 버튼 없음', () => {
    expect(P.availableActions(detail({ effective_status: 'expired' }), { nowMs: NOW })).toMatchObject({ apply: false, applyEnded: true });
    expect(P.availableActions(detail({ effective_status: 'expired', my: { application_id: AP1, application_status: 'applied' } }), { nowMs: NOW }))
      .toMatchObject({ applyEnded: false, withdraw: true });
  });
});

describe('정지된 작업자 — 새 신청 · 수락만 막는다 (순수)', () => {
  const opts = { nowMs: NOW, suspended: true };

  test('탭 — 모집중이 없고 기본은 내 작업 (주소가 #tab=open 이어도)', () => {
    expect(P.tabsFor(true).map((t) => t.key)).toEqual(['mine', 'done', 'me']);
    const html = P.tabsHtml('mine', { open: 3, mine: 1 }, true);
    expect(html).not.toContain('#tab=open');
    expect(html).not.toContain('모집중');
    expect(P.defaultTab({}, { mine: 0 }, true)).toBe('mine');
    expect(P.defaultTab({ tab: 'open' }, { mine: 0 }, true)).toBe('mine');
    expect(P.defaultTab({ tab: 'done' }, { mine: 0 }, true)).toBe('done');
    expect(P.isSuspended({ worker: { status: 'suspended' } })).toBe(true);
    expect(P.isSuspended({ worker: { status: 'approved' } })).toBe(false);
  });

  test('초대 받음 → 수락은 없고 거절은 있다', () => {
    const d = detail({ effective_status: 'filled', my: { assignment_id: A1, assignment_status: 'offered' } });
    expect(P.availableActions(d, opts)).toMatchObject({ confirm: false, decline: true });
    const html = P.jobDetailHtml(d, NOW, 'mine', { suspended: true });
    expect(html).not.toContain('data-act="confirm"');
    expect(html).toContain('data-form="decline"');
    expect(html).toContain('계정이 정지되어 수락할 수 없습니다');
  });

  test('모집중 작업에 신청 버튼이 없다 (잠긴 버튼도 없다)', () => {
    const html = P.jobDetailHtml(detail(), NOW, 'open', { suspended: true });
    expect(P.availableActions(detail(), opts)).toMatchObject({ apply: false, applyEnded: false });
    expect(html).not.toContain('data-form="apply"');
    expect(html).not.toContain('disabled>지원 종료');
    expect(html).toContain('href="#tab=mine"'); // 모집중 탭이 없으니 돌아갈 곳은 내 작업
  });

  test('나머지는 그대로 — 철회 · 시작 · 포기 · 보고', () => {
    expect(P.availableActions(detail({ my: { application_id: AP1, application_status: 'applied' } }), opts).withdraw).toBe(true);
    expect(P.availableActions(detail({ effective_status: 'filled', my: { assignment_id: A1, assignment_status: 'confirmed' } }), opts))
      .toMatchObject({ start: true, release: true, reports: ['progress', 'issue'] });
    expect(P.availableActions(detail({ effective_status: 'in_progress', my: { assignment_id: A1, assignment_status: 'started' } }), opts).reports)
      .toEqual(['progress', 'issue', 'result']);
  });
});

describe('지난 작업(완료) 탭 — 거절 배정의 사유', () => {
  test('작업이 마감 · 취소돼 끝난 초대 — 칩은 배정 상태 그대로 「거절함」, 서버 사유를 "사유:" 줄로 (문구 글자로 판별하지 않는다)', () => {
    const closed = card({ effective_status: 'closed', my: { assignment_id: A1, assignment_status: 'declined', release_reason: '작업이 마감돼 초대가 끝났습니다' } });
    const html = P.jobListHtml([closed], 'done', NOW);
    expect(html).toContain('거절함');
    expect(html).not.toContain('초대 끝남');
    expect(html).toContain('<div class="jd reason">사유: 작업이 마감돼 초대가 끝났습니다</div>');
    expect(html).not.toContain('거절 사유');
    const cancelled = card({ effective_status: 'cancelled', my: { assignment_id: A1, assignment_status: 'declined', release_reason: '작업이 취소돼 초대가 끝났습니다' } });
    expect(P.jobListHtml([cancelled], 'done', NOW)).toContain('사유: 작업이 취소돼 초대가 끝났습니다');
    // 상세 한 줄은 작업 상태로 (취소 · 종료) — 사유 글자에 기대지 않는다
    expect(P.stateText(cancelled)).toBe('취소된 작업입니다.');
    expect(P.stateText(closed)).toBe('종료된 작업입니다.');
    expect(P.isAutoDeclined).toBeUndefined();
    expect(P.AUTO_DECLINE_REASONS).toBeUndefined();
  });

  test('서버 문구가 조금 바뀌어도 화면은 같다 — 칩 「거절함」 + "사유:" 줄', () => {
    const changed = card({ effective_status: 'closed', my: { assignment_id: A1, assignment_status: 'declined', release_reason: '작업이 마감되어 초대가 끝났습니다' } });
    const exact = card({ effective_status: 'closed', my: { assignment_id: A1, assignment_status: 'declined', release_reason: '작업이 마감돼 초대가 끝났습니다' } });
    const strip = (h) => h.replace(/작업이 마감(돼|되어) 초대가 끝났습니다/, '#');
    expect(strip(P.jobCardHtml(changed, NOW, 'done'))).toBe(strip(P.jobCardHtml(exact, NOW, 'done')));
    expect(P.myStatus(exact, NOW)).toEqual(P.myStatus(changed, NOW));
    expect(P.stateText(exact)).toBe(P.stateText(changed));
  });

  test('내가 거절한 초대는 「거절함」 + 사유 (글자로)', () => {
    const mine = card({ effective_status: 'filled', my: { assignment_id: A1, assignment_status: 'declined', release_reason: XSS } });
    const html = P.jobCardHtml(mine, NOW, 'done');
    expect(html).toContain('거절함');
    expect(html).toContain('사유: &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  test('사유가 없거나 거절이 아니면 줄이 없다 · 다른 탭에서는 보이지 않는다', () => {
    expect(P.releaseReasonHtml(card({ my: { assignment_id: A1, assignment_status: 'declined' } }))).toBe('');
    expect(P.releaseReasonHtml(card({ my: { assignment_id: A1, assignment_status: 'accepted', release_reason: 'x' } }))).toBe('');
    const c = card({ my: { assignment_id: A1, assignment_status: 'declined', release_reason: '일정이 겹침' } });
    expect(P.jobCardHtml(c, NOW, 'mine')).not.toContain('일정이 겹침');
  });
});

describe("작업 상세 '← 목록으로'", () => {
  test('목록에서 왔으면 그 탭', () => {
    expect(P.backTabFor(detail({ my: { assignment_id: A1, assignment_status: 'confirmed' } }), 'open', false)).toBe('open');
  });
  test('#job= 로 바로 들어왔으면 내 배정이 든 탭 — 진행 중은 내 작업, 끝난 배정은 완료, 없으면 모집중', () => {
    expect(P.backTabFor(detail({ my: { assignment_id: A1, assignment_status: 'confirmed' } }), null, false)).toBe('mine');
    expect(P.backTabFor(detail({ my: { assignment_id: A1, assignment_status: 'offered' } }), null, false)).toBe('mine');
    expect(P.backTabFor(detail({ my: { assignment_id: A1, assignment_status: 'accepted' } }), null, false)).toBe('done');
    expect(P.backTabFor(detail(), null, false)).toBe('open');
    expect(P.backTabFor(detail({ my: { application_id: AP1, application_status: 'applied' } }), null, true)).toBe('mine');
  });
});

describe('페이지 — 1주차 후속', () => {
  const SUSPENDED_ME = { data: { ready: true, worker: { id: 'w', status: 'suspended', display_name: '테스트', kinds: ['install'] }, counts: { open: 0, mine: 1, revision: 0, newEvents: 0 }, next_job: null } };
  const APPROVED_ME = { data: { ready: true, worker: { id: 'w', status: 'approved', display_name: '테스트', kinds: ['install'] }, counts: COUNTS, next_job: null } };
  const goto = async (hash) => {
    window.history.replaceState(null, '', `/worker.html${hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
  };
  beforeEach(() => {
    sessionStorage.clear();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  test('worker.html — 맨 위 정지 안내 자리, 정지 전용 화면은 없다, 스크립트 ?v= 는 사이트 자산 버전', () => {
    expect(HTML).toContain(`<p class="alert warn" id="suspendedNote" hidden>${P.SUSPENDED_NOTE}</p>`);
    expect(HTML).not.toContain('id="viewSuspended"');
    expect(HTML).not.toContain('신청 마감');
    expect(HTML).toContain(`<script src="js/worker-portal.js?v=${ASSET_VERSION}"></script>`);
  });

  test('정지 작업자 → 앱 화면 + 맨 위 안내, 모집중 탭 없음, 기본 탭 내 작업 — 모집중 목록은 부르지 않는다', async () => {
    const calls = mount({
      routes: {
        'GET /work/me': SUSPENDED_ME,
        'GET /work/jobs?tab=mine': { data: { items: [card({ effective_status: 'filled', my: { assignment_id: A1, assignment_status: 'offered' } })] } },
        'GET /work/jobs?tab=done': { data: { items: [] } },
      },
    });
    await settle();
    expect(visible('viewApp')).toBe(true);
    expect(visible('suspendedNote')).toBe(true);
    expect(document.getElementById('suspendedNote').textContent).toBe(P.SUSPENDED_NOTE);
    const tabs = document.getElementById('tabs');
    expect(tabs.classList.contains('three')).toBe(true);
    expect(tabs.querySelector('a[href="#tab=open"]')).toBe(null);
    expect(document.querySelector('.tab.on').textContent).toContain('내 작업');
    await goto('#tab=open'); // 주소로 모집중을 열어도 내 작업
    await goto('#tab=done');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /work/me', 'GET /work/jobs?tab=mine', 'GET /work/jobs?tab=mine', 'GET /work/jobs?tab=done']);
  });

  test('정지 작업자 상세 — 수락 버튼 없이 거절만, 거절은 보낼 수 있다', async () => {
    const calls = mount({
      hash: `#job=${J1}`,
      routes: {
        'GET /work/me': SUSPENDED_ME,
        [`GET /work/jobs/${J1}`]: { data: detail({ effective_status: 'filled', my: { assignment_id: A1, assignment_status: 'offered' } }) },
        [`POST /work/assignments/${A1}/decline`]: { data: { id: A1, status: 'declined' } },
      },
    });
    await settle();
    expect(document.querySelector('[data-act="confirm"]')).toBe(null);
    expect(document.querySelector('.back').getAttribute('href')).toBe('#tab=mine');
    document.querySelector('[data-form="decline"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.some((c) => c.method === 'POST' && c.path === `/work/assignments/${A1}/decline`)).toBe(true);
  });

  test('승인 작업자는 정지 안내가 숨겨져 있고 모집중 탭이 있다', async () => {
    mount({ routes: { 'GET /work/me': APPROVED_ME, 'GET /work/jobs?tab=mine': { data: { items: [] } } } });
    await settle();
    expect(visible('suspendedNote')).toBe(false);
    expect(document.querySelector('#tabs a[href="#tab=open"]')).not.toBe(null);
  });

  test('쓰는 도중 정지되면 — 신청 403 문구를 그대로 보이고 정지 화면으로 다시 그린다', async () => {
    let suspended = false;
    const calls = mount({
      hash: `#job=${J1}`,
      routes: {
        'GET /work/me': () => (suspended ? SUSPENDED_ME : APPROVED_ME),
        [`GET /work/jobs/${J1}`]: () => (suspended ? null : { data: detail() }),
        [`POST /work/jobs/${J1}/apply`]: () => {
          suspended = true;
          return { status: 403, message: '정지된 계정은 새 작업에 신청할 수 없습니다' };
        },
      },
    });
    await settle();
    document.querySelector('[data-form="apply"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.filter((c) => c.path === '/work/me').length).toBe(2);
    expect(visible('suspendedNote')).toBe(true);
    expect(document.getElementById('alert').textContent).toBe('정지된 계정은 새 작업에 신청할 수 없습니다');
    expect(document.querySelector('[data-form="apply"]')).toBe(null);
  });

  test('신청 409 — 서버 문구 "지원 종료일이 지났습니다" 를 그대로 보인다', async () => {
    mount({
      hash: `#job=${J1}`,
      routes: {
        'GET /work/me': APPROVED_ME,
        [`GET /work/jobs/${J1}`]: { data: detail({ apply_deadline: '2026-10-20T09:00:00Z' }) },
        [`POST /work/jobs/${J1}/apply`]: { status: 409, message: '지원 종료일이 지났습니다' },
      },
    });
    await settle();
    expect(document.getElementById('appBody').textContent).toContain('오늘 종료');
    document.querySelector('[data-form="apply"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(document.getElementById('alert').textContent).toBe('지원 종료일이 지났습니다');
  });

  test('신청 409 뒤에는 상세를 다시 받는다 — 서버가 expired 를 주면 신청 양식 대신 잠긴 「지원 종료」 (휴대폰 시계가 늦어도)', async () => {
    // 화면 시각으로는 아직 모집중(오늘 종료)인데 서버 기준으로는 이미 지원 종료
    let serverExpired = false;
    const calls = mount({
      hash: `#job=${J1}`,
      routes: {
        'GET /work/me': APPROVED_ME,
        [`GET /work/jobs/${J1}`]: () => ({
          data: detail(serverExpired
            ? { effective_status: 'expired', apply_deadline: '2026-10-20T09:00:00Z' }
            : { apply_deadline: '2026-10-20T09:00:00Z' }),
        }),
        [`POST /work/jobs/${J1}/apply`]: () => {
          serverExpired = true;
          return { status: 409, message: '지원 종료일이 지났습니다' };
        },
      },
    });
    await settle();
    expect(document.querySelector('[data-form="apply"]')).not.toBe(null);
    document.querySelector('[data-form="apply"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.filter((c) => c.method === 'GET' && c.path === `/work/jobs/${J1}`).length).toBe(2);
    expect(document.getElementById('alert').textContent).toBe('지원 종료일이 지났습니다');
    expect(document.querySelector('[data-form="apply"]')).toBe(null);
    const btn = Array.from(document.querySelectorAll('#appBody button')).find((b) => b.textContent === '지원 종료');
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  test('409 가 아닌 실패(예: 500)는 상세를 다시 받지 않고 컨트롤만 다시 켠다', async () => {
    const calls = mount({
      hash: `#job=${J1}`,
      routes: {
        'GET /work/me': APPROVED_ME,
        [`GET /work/jobs/${J1}`]: { data: detail() },
        [`POST /work/jobs/${J1}/apply`]: { status: 500, message: '잠시 뒤 다시 시도해 주세요' },
      },
    });
    await settle();
    document.querySelector('[data-form="apply"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.filter((c) => c.method === 'GET' && c.path === `/work/jobs/${J1}`).length).toBe(1);
    expect(document.getElementById('alert').textContent).toBe('잠시 뒤 다시 시도해 주세요');
    expect(document.querySelector('[data-form="apply"] button').disabled).toBe(false);
  });

  test('화면 시각으로 지원 종료일이 지난 상세 — 신청 양식 대신 잠긴 「지원 종료」 버튼', async () => {
    mount({
      hash: `#job=${J1}`,
      routes: {
        'GET /work/me': APPROVED_ME,
        [`GET /work/jobs/${J1}`]: { data: detail({ apply_deadline: '2026-10-20T00:30:00Z' }) },
      },
    });
    await settle();
    const btn = Array.from(document.querySelectorAll('#appBody button')).find((b) => b.textContent === '지원 종료');
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    expect(document.querySelector('[data-form="apply"]')).toBe(null);
  });

  test('모집중 탭 카드에 지원 종료일 줄', async () => {
    mount({
      hash: '#tab=open',
      routes: {
        'GET /work/me': APPROVED_ME,
        'GET /work/jobs?tab=open': { data: { items: [card({ apply_deadline: '2026-10-20T09:00:00Z' })] } },
      },
    });
    await settle();
    const line = document.querySelector('#appBody .jd.dl');
    expect(line.textContent).toBe('지원 종료일 10/20(화) 18:00 · 오늘 종료');
    expect(line.querySelector('.dl-today')).not.toBe(null);
  });

  test("#job= 로 바로 들어온 내 배정 작업 — '← 목록으로' 는 내 작업 탭", async () => {
    mount({
      hash: `#job=${J1}`,
      routes: {
        'GET /work/me': APPROVED_ME,
        [`GET /work/jobs/${J1}`]: { data: detail({ effective_status: 'filled', my: { assignment_id: A1, assignment_status: 'confirmed' } }) },
      },
    });
    await settle();
    expect(document.querySelector('.back').getAttribute('href')).toBe('#tab=mine');
  });

  test("완료 탭에서 들어간 상세 — '← 목록으로' 는 완료 탭", async () => {
    mount({
      hash: '#tab=done',
      routes: {
        'GET /work/me': APPROVED_ME,
        'GET /work/jobs?tab=done': { data: { items: [card({ effective_status: 'closed', my: { assignment_id: A1, assignment_status: 'declined', release_reason: '작업이 마감돼 초대가 끝났습니다' } })] } },
        [`GET /work/jobs/${J1}`]: { data: detail({ effective_status: 'closed', my: { assignment_id: A1, assignment_status: 'declined', release_reason: '작업이 마감돼 초대가 끝났습니다' } }) },
      },
    });
    await settle();
    expect(document.getElementById('appBody').textContent).toContain('작업이 마감돼 초대가 끝났습니다');
    await goto(`#job=${J1}`);
    expect(document.querySelector('.back').getAttribute('href')).toBe('#tab=done');
  });
});
