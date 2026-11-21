/**
 * 새로 생긴 일 (segan/inbox.js) — 프로젝트 관리 대시보드 맨 위의 할 일 표 · 소식.
 * 2026-11-21 대표님 「새롭게 발생 된 일을 표로 만들어서 제일 위에 표시 해주고 그다음에 달력을 표시」 · 「할 일 + 소식」.
 *
 * 고정하는 것
 *   1) 자리 — #meDash 안, 대시보드 칸(#meDashBody) 앞 · 업무 달력보다 위. 처음엔 감춘다. 서비스 워커가 담는다
 *   2) 할 일 = 서버 묶음(기한이 이른 것부터 — 서버 차례 그대로) + 프로젝트마다의 다음 할 일
 *      (남을 기다리는 일 · 내 직책으로 못 하는 일 · 묶음이 이미 센 일은 뺀다, 오래 머문 것부터, 20줄까지)
 *   3) 소식 — 새 것부터, 지난번에 본 뒤 생긴 것은 「새」(이 기기가 기억한다)
 *   4) 서버 길을 못 읽으면 프로젝트마다의 할 일만, 그릴 것이 없으면 칸을 감춘다. 볼 사람이 아니면 묻지 않는다
 *   5) 서버에 쓰지 않는다 — 단추는 프로젝트 칸의 것을 그대로 쓴다 (nextOf · runNext)
 * 시험 데이터는 모두 가짜다.
 */
const fs = require('fs');
const path = require('path');

const read = (f) =>
  fs
    .readFileSync(path.join(__dirname, '..', f), 'utf8')
    .split('\r\n')
    .join('\n');
const WORK = 'https://workflow.test';
const NOW = Date.parse('2026-11-21T01:00:00Z'); // 한국 시간 11-21 10:00
const CO = 'c0000000-0000-4000-8000-000000000001';
const P = (n) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const ago = (days, hours = 0) => new Date(NOW - days * 86400000 - hours * 3600000).toISOString();
const ok = (data) => ({ ok: true, status: 200, body: { success: true, data } });
const fail = (status) => ({ ok: false, status, body: { success: false, code: 'x', message: 'x' } });

const ME = {
  company: { id: CO, name: '예시 팩토리', plan: 'agent', role: 'owner', status: 'active' },
};
const next = (key, label, go, extra = {}) => ({
  key,
  label,
  go,
  wait: false,
  since: null,
  allowed: true,
  ...extra,
});
const project = (n, title, nx, extra = {}) => ({
  id: P(n),
  title,
  status: 'active',
  step: 'consult',
  next: nx,
  ...extra,
});

const DATA = () => ({
  role: 'owner',
  todo: [
    {
      kind: 'offer',
      label: '제작 의뢰 답하기',
      count: 1,
      go: 'p-make',
      due: new Date(NOW + 16 * 3600000).toISOString(),
    },
    {
      kind: 'consult',
      label: '새 상담 받기',
      count: 2,
      go: 'p-consult',
      due: new Date(NOW + 40 * 60000).toISOString(),
    },
    { kind: 'approval', label: '수주 요청 승인 · 반려', count: 1, go: 'p-contract' },
    { kind: 'due', label: '받을 돈 확인', count: 3, go: 'p-collect', late: 2, total: 1500000 },
  ],
  news: [
    {
      kind: 'quote_approved',
      at: ago(0, 1),
      label: '고객이 견적을 승인했습니다',
      go: 'p-quote',
      project: { id: P(1), title: '예시 주방' },
    },
    {
      kind: 'consult_assigned',
      at: ago(1, 3),
      label: '새 상담이 배정됐습니다',
      go: 'p-consult',
      project: null,
    },
    {
      kind: 'order_completed',
      at: ago(4),
      label: '설치가 끝났습니다',
      go: 'p-install',
      project: { id: P(2), title: '<b>예시</b> 붙박이장' },
    },
  ],
});

const ITEMS = () => [
  project(
    1,
    '예시 주방',
    next('order', '계약 만들기', 'p-quote', {
      since: ago(0, 1),
      act: { kind: 'order', document_id: 'd-1' },
    })
  ),
  project(
    2,
    '설계 전',
    next('design_start', '설계 시작', `planner?project=${P(2)}`, { since: ago(3) })
  ),
  project(
    3,
    '답 기다림',
    next('customer', '고객 답 기다림', 'p-quote', { wait: true, allowed: false, since: ago(9) })
  ),
  project(
    4,
    '직원은 못 함',
    next('deposit', '계약금 입금 적기', 'order:o-4', { allowed: false, since: ago(8) })
  ),
  project(5, '승인 요청', next('approve', '요청 승인 · 반려', 'order:o-5', { since: ago(7) })), // 묶음(approval)이 이미 센다
  project(6, '끝난 것', next('deposit', '계약금 입금 적기', 'order:o-6'), { status: 'closed' }),
  project(7, '할 일 없음', null),
  project(8, '때 모름', next('produce', '생산 시작', 'order:o-8')),
];

/** 화면을 띄운다 — #meInbox 하나, 프로젝트 칸은 흉내 */
async function load(options = {}) {
  const opts = {
    me: ME,
    inbox: () => ok(DATA()),
    items: ITEMS(),
    canSee: true,
    session: { access_token: 'tok-1' },
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  document.body.innerHTML =
    '<section id="meDash"><div class="ib" id="meInbox" hidden></div></section>';
  delete window.SeganInbox;
  window.DADAM_CONFIG = { workflowApi: { url: opts.work === undefined ? WORK + '/' : opts.work } };
  const calls = [];
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.push({
      url,
      method: init.method || 'GET',
      auth: (init.headers || {}).Authorization,
      cache: init.cache,
    });
    const r = await opts.inbox(url);
    if (r instanceof Error) throw r;
    return { ok: r.ok, status: r.status, json: async () => r.body };
  });
  const runNext = jest.fn();
  window.SeganPartnerProjects = {
    canSee: () => opts.canSee,
    state: { data: opts.items ? { items: opts.items } : null },
    // 프로젝트 줄과 같은 단추 — 여기서는 글만 본다
    nextOf: (p) => ({
      act: `<button type="button" class="mk-btn mk-btn--solid" data-act="next-sheet" data-id="${p.id}">${p.next.label}</button>`,
    }),
    runNext,
  };
  window.SeganShell = { applyLinkTarget: jest.fn() };
  (0, eval)(read('segan/inbox.js'));
  await window.SeganInbox.load(
    { auth: { getSession: async () => ({ data: { session: opts.session } }) } },
    opts.session,
    opts.me
  );
  return { calls, runNext };
}

const box = () => document.getElementById('meInbox');
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const rows = () =>
  [...box().querySelectorAll('.ib-table tbody tr')].map((tr) => [...tr.children].map(text));
const news = () => [...box().querySelectorAll('.ib-news li')].map((li) => text(li));

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

describe('자리 · 이름', () => {
  test('me.html — 대시보드(#meDash) 안, 대시보드 칸 앞 · 업무 달력보다 위, 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const html = read('segan/me.html');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = doc.getElementById('meInbox');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('meDash');
    expect(el.previousElementSibling.id).toBe('meDashTitle');
    expect(el.nextElementSibling.id).toBe('meDashBody');
    expect(el.nextElementSibling.nextElementSibling.id).toBe('meCalendar');
    const at = (name) => html.indexOf('src="' + name);
    expect(at('inbox.js')).toBeGreaterThan(-1);
    expect(at('inbox.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'inbox.js')");
  });

  test('me.js — 프로젝트 관리 대시보드에서만 보이고(me-off), 업체 칸을 읽은 뒤 채우고, 목록이 바뀌면 다시 그린다', () => {
    const me = read('segan/me.js');
    expect(me).toContain("off('meInbox', !(open && s.dash === 'project'));");
    expect(me).toMatch(
      /synced\(Inbox && Inbox\.load \? Inbox\.load\(auth\.sb, auth\.session, me\) : null\)/
    );
    expect(me).toMatch(/window\.SeganInbox\.render\(\);/);
  });

  test('서버에 쓰지 않는다 — 읽기만, 확인 창도 띄우지 않는다', () => {
    const code = read('segan/inbox.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/method:/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/sessionStorage|indexedDB/);
  });
});

describe('글 (순수)', () => {
  test('dueText · sinceText · whenText', async () => {
    await load();
    const I = window.SeganInbox;
    expect(I.dueText(new Date(NOW + 19 * 3600000 + 5 * 60000).toISOString(), NOW)).toBe(
      '19시간 남음'
    );
    expect(I.dueText(new Date(NOW + 40 * 60000).toISOString(), NOW)).toBe('40분 남음');
    expect(I.dueText(new Date(NOW - 1000).toISOString(), NOW)).toBe('기한 지남');
    expect(I.dueText('', NOW)).toBe('');
    expect(I.sinceText(ago(0, 5), NOW)).toBe('오늘');
    expect(I.sinceText(ago(3, 1), NOW)).toBe('3일째');
    expect(I.sinceText(null, NOW)).toBe('');
    // 한국 시간 — NOW 는 11-21 10:00
    expect(I.whenText('2026-11-21T00:12:00Z', NOW)).toBe('오늘 09:12');
    expect(I.whenText('2026-11-20T08:40:00Z', NOW)).toBe('어제 17:40');
    expect(I.whenText('2026-11-19T02:00:00Z', NOW)).toBe('11.19');
    expect(I.whenText('x', NOW)).toBe('');
  });

  test('projectTodos — 남을 기다리는 일 · 못 하는 일 · 묶음이 센 일 · 끝난 프로젝트는 빼고, 오래 머문 것부터 (때 모르는 것은 뒤)', async () => {
    await load();
    const pick = (covered) => window.SeganInbox.projectTodos(ITEMS(), covered).map((p) => p.title);
    expect(pick({ approval: true })).toEqual(['설계 전', '예시 주방', '때 모름']);
    // 묶음에 없으면 줄마다 적는다
    expect(pick({})).toEqual(['승인 요청', '설계 전', '예시 주방', '때 모름']);
    expect(window.SeganInbox.projectTodos(null, {})).toEqual([]);
  });

  test('todoOf · newsOf — 아는 칸만, 이상한 줄은 버린다 (금액은 옮기지 않는다)', async () => {
    await load();
    const I = window.SeganInbox;
    expect(
      I.todoOf({
        todo: [
          {
            kind: 'due',
            label: '받을 돈 확인',
            count: 3,
            go: 'p-collect',
            late: 2,
            total: 1500000,
          },
          { kind: 'x' },
          null,
          { kind: 'a', label: 'b', count: 0 },
        ],
      })
    ).toEqual([
      { kind: 'due', label: '받을 돈 확인', count: 3, go: 'p-collect', due: '', late: 2 },
    ]);
    expect(
      I.todoOf({ todo: [{ kind: 'a', label: 'b', count: 1, go: 'javascript:alert(1)' }] })[0].go
    ).toBe('');
    expect(
      I.newsOf({
        news: [{ label: 'x', at: 't', go: '../x', project: { title: 7 } }, { label: '' }, 3],
      })
    ).toEqual([{ kind: '', at: 't', label: 'x', go: '', project: '' }]);
    expect(I.todoOf(null)).toEqual([]);
  });
});

describe('화면', () => {
  test('할 일 표 — 서버 묶음(서버 차례 그대로) 다음에 프로젝트마다의 할 일, 수 · 기한 · 머문 날', async () => {
    const { calls } = await load();
    expect(calls).toEqual([
      { url: WORK + '/company/inbox', method: 'GET', auth: 'Bearer tok-1', cache: 'no-store' },
    ]);
    expect(box().hidden).toBe(false);
    expect(text(box().querySelector('#meInboxTitle'))).toBe('새로 생긴 일');
    expect(text(box().querySelector('.ib-head'))).toBe('할 일 7'); // 묶음 4 + 프로젝트 3
    expect(rows()).toEqual([
      ['제작 의뢰 답하기', '1건', '16시간 남음', '열기'],
      ['새 상담 받기', '2건', '40분 남음', '열기'],
      ['수주 요청 승인 · 반려', '1건', '', '열기'],
      ['받을 돈 확인', '3건', '지난 것 2건', '열기'],
      ['설계 시작', '설계 전', '3일째', '설계 시작'],
      ['계약 만들기', '예시 주방', '오늘', '계약 만들기'],
      ['생산 시작', '때 모름', '', '생산 시작'],
    ]);
    const open = box().querySelector('[data-ib-todo="consult"] a');
    expect([open.getAttribute('href'), open.getAttribute('data-me-go')]).toEqual([
      '#p-consult',
      'p-consult',
    ]);
    // 금액은 그리지 않는다
    expect(box().textContent).not.toContain('1500000');
    expect(box().textContent).not.toContain('1,500,000');
  });

  test('프로젝트 줄의 단추를 그대로 쓴다 — 누르면 프로젝트 칸이 한다 (runNext)', async () => {
    const { runNext, calls } = await load();
    box()
      .querySelector(`[data-ib-project="${P(2)}"] [data-act="next-sheet"]`)
      .click();
    expect(runNext).toHaveBeenCalledWith('next-sheet', P(2));
    expect(calls.length).toBe(1); // 이 파일은 서버에 쓰지 않는다
  });

  test('소식 — 새 것부터, 프로젝트 이름은 글자 그대로. 지난번에 본 뒤 생긴 것만 「새」 (이 기기가 기억한다)', async () => {
    await load();
    expect(news()).toEqual([
      '오늘 09:00 고객이 견적을 승인했습니다 · 예시 주방',
      '어제 07:00 새 상담이 배정됐습니다',
      '11.17 설치가 끝났습니다 · <b>예시</b> 붙박이장',
    ]);
    expect(box().querySelector('.ib-news b')).toBeNull();
    expect(box().querySelector('.ib-new')).toBeNull(); // 처음 연 기기 — 「새」 없음
    const link = box().querySelector('.ib-news a');
    expect([link.getAttribute('href'), link.getAttribute('data-me-go')]).toEqual([
      '#p-quote',
      'p-quote',
    ]);
    // 본 때를 적어 둔다 → 다음에 열면 그 뒤에 생긴 것만 「새」
    expect(localStorage.getItem('segan.inbox.seen.' + CO)).toBe(ago(0, 1));
    const later = DATA();
    later.news.unshift({
      kind: 'as_requested',
      at: new Date(NOW + 60000).toISOString(),
      label: 'A/S 가 접수됐습니다',
      go: 'p-as',
      project: null,
    });
    await load({ inbox: () => ok(later) });
    expect(
      [...box().querySelectorAll('.ib-news li')].map((li) => !!li.querySelector('.ib-new'))
    ).toEqual([true, false, false, false]);
    expect(text(box().querySelector('.ib-news li'))).toContain('새');
  });

  test('다시 그리기 — 프로젝트 목록이 바뀌면 할 일 표가 따라온다 (글이 같으면 그대로 둔다)', async () => {
    await load();
    const before = box().firstElementChild;
    window.SeganInbox.render();
    expect(box().firstElementChild).toBe(before); // 글이 같다 — 다시 그리지 않았다
    window.SeganPartnerProjects.state.data.items = [ITEMS()[1]];
    window.SeganInbox.render();
    expect(rows().slice(4)).toEqual([['설계 시작', '설계 전', '3일째', '설계 시작']]);
    expect(text(box().querySelector('.ib-head'))).toBe('할 일 5');
  });

  test('프로젝트마다의 할 일은 20줄까지 — 넘으면 몇 건이 더 있는지 알린다', async () => {
    const many = [];
    for (let i = 1; i <= 23; i++)
      many.push(
        project(
          i,
          '프로젝트 ' + i,
          next('design_start', '설계 시작', `planner?project=${P(i)}`, { since: ago(i) })
        )
      );
    await load({ items: many, inbox: () => ok({ role: 'owner', todo: [], news: [] }) });
    expect(rows()).toHaveLength(20);
    expect(rows()[0][1]).toBe('프로젝트 23'); // 가장 오래 머문 것부터
    expect(text(box().querySelector('.mk-note'))).toBe('3건 더 — 아래 프로젝트 목록에서');
    expect(text(box().querySelector('.ib-head'))).toBe('할 일 23');
  });

  test('할 일도 소식도 없으면 — 안내 글', async () => {
    await load({ items: [], inbox: () => ok({ role: 'staff', todo: [], news: [] }) });
    expect(box().hidden).toBe(false);
    expect(text(box().querySelector('[data-ib="none"]'))).toBe('지금 처리할 일이 없습니다.');
    expect(text(box().querySelector('[data-ib="no-news"]'))).toBe(
      '최근 14일 동안 새로 생긴 일이 없습니다.'
    );
  });
});

describe('안 보이는 때', () => {
  test('서버 길을 못 읽으면(옛 서버 · 오류 · 끊김) — 프로젝트마다의 할 일만 그리고 소식 칸은 없다', async () => {
    for (const inbox of [
      () => fail(404),
      () => fail(500),
      () => new Error('끊김'),
      () => ({ ok: true, status: 200, body: { success: true } }),
    ]) {
      await load({ inbox });
      expect(box().hidden).toBe(false);
      expect(rows().map((r) => r[0])).toEqual([
        '요청 승인 · 반려',
        '설계 시작',
        '계약 만들기',
        '생산 시작',
      ]);
      expect(box().querySelector('.ib-news')).toBeNull();
      expect(box().querySelectorAll('.ib-head')).toHaveLength(1);
    }
  });

  test('서버 길도 못 읽고 할 일도 없으면 칸을 감춘다 (가짜 「없음」을 그리지 않는다)', async () => {
    await load({ inbox: () => fail(500), items: [] });
    expect(box().hidden).toBe(true);
    expect(box().innerHTML).toBe('');
  });

  test('볼 사람이 아니면(고객 · 본사 구성원) · 로그인하지 않았으면 · 워커 주소가 없으면 — 묻지 않고 감춘다', async () => {
    for (const o of [{ canSee: false }, { session: null }, { work: '' }]) {
      const { calls } = await load(o);
      expect(calls).toEqual([]);
      expect(box().hidden).toBe(true);
    }
  });
});
