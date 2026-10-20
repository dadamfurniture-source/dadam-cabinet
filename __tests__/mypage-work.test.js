/**
 * 마이페이지 작업자 요약 (js/mypage-work.js + mypage.html #myWorkSection) — docs/01-plan/worker-portal-contract.md §4.
 * 작업자 행이 있을 때만 열리고, 표가 없거나(ready:false) 실패하면 숨긴 채 둔다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MYPAGE = fs.readFileSync(path.join(ROOT, 'mypage.html'), 'utf8');
const W = require('../js/mypage-work.js');

const J1 = '11111111-1111-4111-8111-111111111111';
const J2 = '22222222-2222-4222-8222-222222222222';
const J3 = '33333333-3333-4333-8333-333333333333';
const XSS = '<script>alert(1)</script>';
const NOW = Date.parse('2026-10-20T01:00:00Z'); // 10/20(화) 10:00 KST

const approved = (counts, over) => ({
  ready: true,
  worker: { id: 'w', status: 'approved', display_name: '테스트 작업자', kinds: ['install'], ...over },
  counts: { open: 0, mine: 0, revision: 0, newEvents: 0, ...counts },
});
const job = (id, startsAt, over) => ({ id, kind: 'install', title: '싱크대 설치', region_label: '테스트시', starts_at: startsAt, my: { assignment_status: 'confirmed' }, ...over });

describe('섹션을 열까', () => {
  test.each([
    [null, false],
    [{ ready: false, worker: null }, false],
    [{ ready: false, worker: { id: 'w', status: 'approved' } }, false],
    [{ ready: true, worker: null }, false],
    [{ ready: true, worker: { id: 'w', status: 'pending' } }, true],
    [approved(), true],
  ])('%j → %s', (me, show) => {
    expect(W.shouldShow(me)).toBe(show);
  });

  test('작업자가 아니면 요약 HTML 도 비어 있다', () => {
    expect(W.summaryHtml({ ready: true, worker: null }, null)).toBe('');
  });
});

describe('건수 · 다음 작업', () => {
  test('건수 — 서버 counts, 이상한 값은 0', () => {
    expect(W.summaryCounts(approved({ open: 2, mine: 3, revision: 1, newEvents: 5 }))).toEqual({ open: 2, mine: 3, revision: 1, newEvents: 5 });
    expect(W.summaryCounts({ counts: { open: 'x', mine: -1, revision: null } })).toEqual({ open: 0, mine: 0, revision: 0, newEvents: 0 });
  });

  test('다음 작업 — 보완요청이 먼저, 그다음 오늘 이후 가장 이른 날짜', () => {
    const past = job(J1, '2026-10-18T00:00:00Z');
    const later = job(J2, '2026-10-25T00:00:00Z');
    const soon = job(J3, '2026-10-21T00:00:00Z');
    expect(W.pickNextJob([past, later, soon], NOW).id).toBe(J3);
    expect(W.pickNextJob([past, later, { ...soon, my: { assignment_status: 'revision' }, id: J3 }], NOW).id).toBe(J3);
    expect(W.pickNextJob([later, job(J1, '2026-10-30T00:00:00Z', { my: { assignment_status: 'revision' } })], NOW).id).toBe(J1);
    expect(W.pickNextJob([past], NOW).id).toBe(J1);
    expect(W.pickNextJob([], NOW)).toBe(null);
    expect(W.pickNextJob([{ id: 'not-a-uuid' }], NOW)).toBe(null);
  });

  test('요약 카드 — 예정 · 보완요청 · 새 소식 · 다음 작업 한 줄 · 작업자 페이지 링크', () => {
    const html = W.summaryHtml(approved({ open: 4, mine: 2, revision: 1, newEvents: 3 }), job(J1, '2026-10-21T00:00:00Z'));
    expect(html).toContain('2건');
    expect(html).toContain('보완요청');
    expect(html).toContain('새 소식');
    expect(html).toContain('3건');
    expect(html).toContain(`href="worker.html#job=${J1}"`);
    expect(html).toContain('10/21(수) 09:00 · 설치 · 테스트시 · 싱크대 설치 (확정)');
    expect(html).toContain('href="worker.html"');
    expect(html).toContain('작업자 페이지 열기');
  });

  test('이름 · 제목 · 지역의 <script> 는 글자로', () => {
    const html = W.summaryHtml(approved({ mine: 1 }, { display_name: XSS }), job(J1, '2026-10-21T00:00:00Z', { title: XSS, region_label: XSS }));
    expect(html).not.toContain('<script>');
    expect(html.match(/&lt;script&gt;/g).length).toBe(3);
  });

  test('승인 대기 · 반려는 상태 한 줄', () => {
    expect(W.summaryHtml({ ready: true, worker: { id: 'w', status: 'pending', display_name: '테스트' }, counts: {} }, null)).toContain('승인 대기');
    expect(W.summaryHtml({ ready: true, worker: { id: 'w', status: 'rejected', display_name: '테스트' }, counts: {} }, null)).toContain('승인되지 않았습니다');
  });
});

describe('mypage.html — 섹션 자리 · 부르는 곳', () => {
  test('계정 정보 바로 다음에 숨긴 섹션, user-only 아님', () => {
    const account = MYPAGE.search(/계정 정보\s*<\/h2>/);
    const section = MYPAGE.search(/<section class="section" id="myWorkSection" hidden>/);
    const partners = MYPAGE.search(/id="savedPartnersSection"/);
    expect(account).toBeGreaterThan(0);
    expect(section).toBeGreaterThan(account);
    expect(section).toBeLessThan(partners);
    expect(MYPAGE).toMatch(/<div id="myWorkBody"><\/div>/);
  });

  test('loadMyProjects() 다음에 loadMyWork(supabaseClient) — 스크립트는 ?v= 를 단다', () => {
    expect(MYPAGE).toMatch(/await loadMyProjects\(\);\s*\n\s*\/\/[^\n]*\n\s*if \(typeof loadMyWork === 'function'\) await loadMyWork\(supabaseClient\);/);
    expect(MYPAGE).toMatch(/<script src="js\/mypage-work\.js\?v=\d+"><\/script>/);
  });
});

describe('loadMyWork — 섹션 열고 닫기', () => {
  const API = 'https://api.test';
  const client = (token = 'jwt-test') => ({ auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } });

  function mount(routes) {
    document.body.innerHTML = '<section id="myWorkSection" hidden><div id="myWorkBody"></div></section>';
    window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'anon' }, workflowApi: { url: API } };
    const calls = [];
    global.fetch = jest.fn(async (url, opts = {}) => {
      const p = url.replace(API, '');
      calls.push({ path: p, auth: opts.headers && opts.headers.Authorization });
      const r = routes[p];
      if (r instanceof Error) throw r;
      if (!r) return { ok: false, status: 404, json: async () => ({ success: false, message: 'Not found' }) };
      return { ok: true, status: 200, json: async () => ({ success: true, data: r }) };
    });
    return calls;
  }
  const section = () => document.getElementById('myWorkSection');

  test('전역 loadMyWork 가 있다 (mypage.html 이 부른다)', () => {
    expect(typeof globalThis.loadMyWork).toBe('function');
  });

  test('ready:false → 숨김, 내 작업은 부르지 않는다', async () => {
    const calls = mount({ '/work/me': { ready: false, worker: null, counts: {} } });
    await W.loadMyWork(client());
    expect(section().hidden).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(['/work/me']);
  });

  test('작업자 행 없음 → 숨김', async () => {
    mount({ '/work/me': { ready: true, worker: null, counts: {} } });
    await W.loadMyWork(client());
    expect(section().hidden).toBe(true);
    expect(document.getElementById('myWorkBody').innerHTML).toBe('');
  });

  test('승인 작업자 + 내 작업 → 열고 다음 작업 한 줄', async () => {
    const calls = mount({
      '/work/me': approved({ mine: 1, open: 2 }),
      '/work/jobs?tab=mine': { items: [job(J1, '2099-01-01T00:00:00Z', { title: XSS })] },
    });
    await W.loadMyWork(client());
    expect(section().hidden).toBe(false);
    const body = document.getElementById('myWorkBody');
    expect(body.querySelector('script')).toBe(null);
    expect(body.textContent).toContain(XSS);
    expect(body.querySelector(`a[href="worker.html#job=${J1}"]`)).not.toBe(null);
    expect(calls.every((c) => c.auth === 'Bearer jwt-test')).toBe(true);
  });

  test('내 작업이 0 이면 목록은 부르지 않는다', async () => {
    const calls = mount({ '/work/me': approved({ mine: 0 }) });
    await W.loadMyWork(client());
    expect(section().hidden).toBe(false);
    expect(calls.map((c) => c.path)).toEqual(['/work/me']);
    expect(document.getElementById('myWorkBody').textContent).toContain('없음');
  });

  test('요청 실패 · 로그인 없음 → 숨김, 던지지 않는다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ '/work/me': new Error('network') });
    await expect(W.loadMyWork(client())).resolves.toBeUndefined();
    expect(section().hidden).toBe(true);
    const calls = mount({});
    await W.loadMyWork(client(null));
    expect(section().hidden).toBe(true);
    expect(calls).toEqual([]);
    console.warn.mockRestore();
  });
});
