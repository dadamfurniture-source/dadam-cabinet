/**
 * 프로젝트 한 건 창 (segan/project-sheet.js) — 프로젝트 하나의 처음부터 끝을 한 창에서.
 * 2026-11-21 대표님 승인 계획 「프로젝트 한 길」 묶음 4.
 *
 * 고정하는 것
 *   1) 여는 곳 — 새로 생긴 일 표의 프로젝트 이름 (줄의 「진행 보기」 단추는 11-21 뺌). me.html 이 읽고 서비스 워커가 담는다
 *   2) 창 — 고객 · 담당 · 시작한 날, 단계 띠 · 다음 할 일(프로젝트 줄과 같은 것), 일어난 일(오래된 것부터),
 *      설계 · 견적 · 계약 · 제작 의뢰 · A/S (있는 것만)
 *   3) 이미 읽은 줄로 먼저 그리고 서버에서 채운다. 못 읽으면 위쪽만 그리고 알린다
 *   4) 서버에 쓰지 않는다 — 다음 할 일은 프로젝트 칸이, 계약은 수주 창이 한다. 화면 링크는 창을 닫고 간다
 * 시험 데이터는 모두 가짜다.
 */
const fs = require('fs');
const path = require('path');

const read = (f) =>
  fs
    .readFileSync(path.join(__dirname, '..', f), 'utf8')
    .split('\r\n')
    .join('\n');
const NOW = Date.parse('2026-11-21T01:00:00Z'); // 한국 시간 11-21 10:00
const P1 = '22222222-2222-4222-8222-000000000001';
const O1 = '33333333-3333-4333-8333-000000000001';
const O2 = '33333333-3333-4333-8333-000000000002';

const ROW = () => ({
  id: P1,
  title: '예시 <b>주방</b>',
  status: 'active',
  created_at: '2026-11-01T00:30:00Z',
  customer: { id: 'c1', name: '김고객', phone: '010-1111-2222' },
  assignee: { user_id: 'u1', name: '나직원', role: 'staff' },
  design_count: 2,
  stage: 'quote',
  step: 'quote',
  next: {
    key: 'order',
    label: '계약 만들기',
    go: 'p-quote',
    wait: false,
    since: null,
    allowed: true,
  },
});

const DATA = () => ({
  role: 'owner',
  can_manage: true,
  project: ROW(),
  designs: [
    { id: 'd2', name: null, updated_at: '2026-11-08T03:00:00Z' },
    { id: 'd1', name: '주방 1안', updated_at: '2026-11-03T03:00:00Z' },
  ],
  quotes: [
    {
      id: 'q2',
      design_id: 'd1',
      created_at: '2026-11-05T03:00:00Z',
      expires_at: '2099-01-01T00:00:00Z',
      first_viewed_at: '2026-11-06T03:00:00Z',
      view_count: 3,
      decision: 'approved',
      decided_at: '2026-11-07T03:00:00Z',
    },
    {
      id: 'q1',
      design_id: 'd2',
      created_at: '2026-11-04T03:00:00Z',
      expires_at: '2026-11-10T00:00:00Z',
      first_viewed_at: null,
      view_count: 0,
      decision: null,
      decided_at: null,
    },
  ],
  orders: [
    {
      id: O2,
      order_no: 'A-002',
      status: 'in_production',
      ordered_at: '2026-11-08T00:00:00Z',
      delivered_at: null,
      completed_at: null,
      deposit: 'paid',
    },
    {
      id: O1,
      order_no: null,
      status: 'cancelled',
      ordered_at: '2026-11-07T05:00:00Z',
      delivered_at: null,
      completed_at: null,
      deposit: 'unpaid',
    },
  ],
  requests: [{ id: 'r1', status: 'accepted', status_at: '2026-11-09T03:00:00Z' }],
  as: [
    {
      id: 'a1',
      state: 'requested',
      created_at: '2026-11-20T03:00:00Z',
      received_at: null,
      done_at: null,
    },
  ],
  history: [
    {
      kind: 'project_created',
      at: '2026-11-01T00:30:00Z',
      label: '프로젝트가 생겼습니다',
      go: null,
    },
    {
      kind: 'quote_sent',
      at: '2026-11-05T03:00:00Z',
      label: '견적서를 <i>보냈습니다</i>',
      go: 'p-quote',
    },
    { kind: 'deposit_paid', at: '2026-11-08', label: '계약금이 들어왔습니다', go: 'p-contract' },
    { kind: 'x', at: 'nope', label: '때를 모르는 일', go: null }, // 버린다
  ],
});

/** 화면을 띄운다 — 시트 · 프로젝트 칸 · 수주 창은 흉내 */
function load(options = {}) {
  const opts = {
    items: [ROW()],
    project: () => ({ ok: true, status: 200, data: DATA() }),
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  document.body.innerHTML = '';
  delete window.SeganProjectSheet;
  const sheets = [];
  window.SeganShell = {
    applyLinkTarget: jest.fn(),
    sheet: {
      open: jest.fn((o) => {
        const handle = {
          opts: o,
          closed: [],
          close: jest.fn((why) => {
            handle.closed.push(why);
            if (o.onClose) o.onClose(why);
            return Promise.resolve();
          }),
        };
        document.body.appendChild(o.body);
        sheets.push(handle);
        return handle;
      }),
    },
  };
  const runNext = jest.fn();
  const readProject = jest.fn(async (id) => opts.project(id));
  window.SeganPartnerProjects = {
    state: { data: opts.items ? { items: opts.items } : null },
    personLabel: (m) => m.name + (m.role === 'staff' ? ' (직원)' : ''),
    // 프로젝트 줄과 같은 띠 · 단추 — 여기서는 글만 본다
    nextOf: (p) => ({
      strip: `<ol class="pj-strip" data-step="${p.step}"></ol>`,
      note: '',
      act: `<button type="button" class="mk-btn mk-btn--solid" data-act="next-order" data-id="doc-1">${p.next.label}</button>`,
      tail: '<small class="pj-since">3일째</small>',
    }),
    runNext,
    readProject,
  };
  const orderOpen = jest.fn(async () => (opts.orderOpens === undefined ? true : opts.orderOpens));
  window.SeganOrders = {
    open: orderOpen,
    STATUS: {
      confirmed: '접수',
      in_production: '생산 중',
      delivered: '배송',
      completed: '완료',
      cancelled: '취소',
    },
  };
  (0, eval)(read('segan/project-sheet.js'));
  return { sheets, runNext, readProject, orderOpen };
}

const node = () => document.querySelector('.ps');
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const sec = (key) => node().querySelector(`[data-ps="${key}"]`);
const rows = (key) => [...sec(key).querySelectorAll('li')].map(text);
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  jest.restoreAllMocks();
  window.location.hash = '';
});

describe('여는 곳 · 이름', () => {
  test('me.html 이 읽고 서비스 워커가 담는다 · 새로 생긴 일 표가 연다 (줄에는 단추 없음)', () => {
    const html = read('segan/me.html');
    const at = (name) => html.indexOf('src="' + name);
    expect(at('project-sheet.js')).toBeGreaterThan(-1);
    expect(at('project-sheet.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'project-sheet.js')");
    const rowsJs = read('segan/partner-projects.js');
    expect(rowsJs).not.toContain('data-act="sheet"'); // 줄의 「진행 보기」 단추는 11-21 뺐다
    expect(rowsJs).toMatch(/call\('GET', '\/company\/projects\/' \+ id\)/);
    const inbox = read('segan/inbox.js');
    expect(inbox).toContain('data-act="project"');
    expect(inbox).toMatch(/Sheet\.open\(el\.getAttribute\('data-id'\) \|\| ''\)/);
  });

  test('서버에 쓰지 않는다 — 읽는 것도 프로젝트 칸에 맡긴다, 확인 창도 띄우지 않는다', () => {
    const code = read('segan/project-sheet.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/fetch\(/);
    expect(code).not.toMatch(/method:/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe('글 (순수)', () => {
  test('whenText — 한국 시간, 날짜뿐인 값은 날짜만', () => {
    load();
    const S = window.SeganProjectSheet;
    expect(S.whenText('2026-11-19T01:12:00Z')).toBe('2026.11.19 10:12');
    expect(S.whenText('2026-12-31T15:30:00Z')).toBe('2027.01.01 00:30');
    expect(S.whenText('2026-11-08')).toBe('2026.11.08');
    expect(S.whenText('nope')).toBe('');
    expect(S.whenText(null)).toBe('');
  });

  test('quoteText — 고객 승인 · 수정 요청 · 답 기한 지남 · 답 기다림 (+ 몇 번 열어 봄)', () => {
    load();
    const q = (extra) =>
      window.SeganProjectSheet.quoteText(
        { expires_at: '2099-01-01T00:00:00Z', view_count: 0, decision: null, ...extra },
        NOW
      );
    expect(q({ decision: 'approved', view_count: 3 })).toBe('고객 승인 · 3번 열어 봄');
    expect(q({ decision: 'rejected' })).toBe('고객 수정 요청');
    expect(q({ expires_at: '2026-11-10T00:00:00Z', view_count: 1 })).toBe(
      '답 기한 지남 · 1번 열어 봄'
    );
    expect(q({})).toBe('고객 답 기다림');
    expect(q({ expires_at: null })).toBe('고객 답 기다림'); // 기한을 모르면 기다림
  });

  test('whoText — 고객 · 담당 · 시작한 날 (없는 것은 뺀다)', () => {
    load();
    const S = window.SeganProjectSheet;
    expect(S.whoText(ROW())).toBe('김고객 · 담당 나직원 (직원) · 2026.11.01 시작');
    expect(S.whoText({ created_at: '2026-11-01T00:30:00Z' })).toBe('2026.11.01 시작');
    expect(S.whoText(null)).toBe('');
  });
});

describe('창', () => {
  test('열면 — 이미 읽은 줄로 먼저 그리고(고객 · 단계 띠 · 다음 할 일), 서버에서 읽어 채운다', async () => {
    const { sheets, readProject } = load();
    const opening = window.SeganProjectSheet.open(P1);
    // 서버 답을 기다리는 동안 — 줄로 그린 위쪽 + 알림
    expect(sheets).toHaveLength(1);
    expect(sheets[0].opts.kind).toBe('sheet');
    expect(sheets[0].opts.title).toBe('예시 <b>주방</b>'); // 시트가 글자로 넣는다 (shell.js)
    expect(text(node().querySelector('[data-ps="note"]'))).toBe('불러오는 중…');
    expect(text(node().querySelector('.ps-who'))).toBe(
      '김고객 · 담당 나직원 (직원) · 2026.11.01 시작 · 010-1111-2222'
    );
    expect(node().querySelector('.pj-strip').getAttribute('data-step')).toBe('quote');
    expect(sec('history')).toBeNull();
    expect(await opening).toBe(true);
    expect(readProject).toHaveBeenCalledWith(P1);
    expect(node().querySelector('[data-ps="note"]').hidden).toBe(true);
    expect(node().querySelector('.ps-who a').getAttribute('href')).toBe('tel:01011112222');
    // 다음 할 일 — 프로젝트 줄과 같은 단추 + 머문 날
    expect(text(node().querySelector('.rd-acts'))).toBe('계약 만들기3일째');
  });

  test('일어난 일 — 서버 차례 그대로(오래된 것부터), 글은 글자 그대로, 때를 모르는 줄은 뺀다', async () => {
    load();
    await window.SeganProjectSheet.open(P1);
    expect(rows('history')).toEqual([
      '2026.11.01 09:30프로젝트가 생겼습니다',
      '2026.11.05 12:00견적서를 <i>보냈습니다</i>',
      '2026.11.08계약금이 들어왔습니다',
    ]);
    expect(sec('history').querySelector('i')).toBeNull();
    expect(sec('history').querySelector('time').getAttribute('datetime')).toBe(
      '2026-11-01T00:30:00Z'
    );
  });

  test('설계 · 견적 · 계약 · 제작 의뢰 · A/S — 수와 줄, 저마다 그 화면으로 가는 링크 (계약은 「열기」)', async () => {
    load();
    await window.SeganProjectSheet.open(P1);
    expect(text(sec('designs').querySelector('.od-h'))).toBe('설계 2');
    expect(rows('designs')).toEqual(['이름 없는 설계2026.11.08 고침', '주방 1안2026.11.03 고침']);
    expect(rows('quotes')).toEqual([
      '2026.11.05 보냄고객 승인 · 3번 열어 봄',
      '2026.11.04 보냄답 기한 지남',
    ]);
    // 취소된 수주에는 계약금 글을 붙이지 않는다
    expect(rows('orders')).toEqual([
      'A-002 · 생산 중2026.11.08 · 계약금 받음열기',
      '번호 없음 · 취소2026.11.07열기',
    ]);
    expect(rows('requests')).toEqual(['팩토리가 받음2026.11.09']);
    expect(rows('as')).toEqual(['접수2026.11.20']);
    const links = [...node().querySelectorAll('.ps-more a')].map((a) => [
      text(a),
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['설계 화면', '#p-design'],
      ['견적 화면', '#p-quote'],
      ['제작 의뢰 화면', '#p-make'],
      ['A/S 화면', '#p-as'],
    ]);
    // 금액 칸은 없다
    expect(node().textContent).not.toMatch(/[0-9]원|₩/);
  });

  test('없는 것은 구역째 뺀다', async () => {
    load({
      project: () => ({
        ok: true,
        status: 200,
        data: { ...DATA(), designs: [], quotes: [], orders: [], requests: [], as: [] },
      }),
    });
    await window.SeganProjectSheet.open(P1);
    expect(
      [...node().querySelectorAll('section[data-ps]')].map((s) => s.getAttribute('data-ps'))
    ).toEqual(['history']);
  });

  test('다음 할 일 단추 — 프로젝트 칸이 한다 (runNext). 계약 「열기」 — 수주 창이 연다', async () => {
    const { runNext, orderOpen, sheets } = load();
    await window.SeganProjectSheet.open(P1);
    node().querySelector('[data-act="next-order"]').click();
    expect(runNext).toHaveBeenCalledWith('next-order', 'doc-1');
    sec('orders').querySelector('[data-act="order"]').click();
    await flush();
    expect(orderOpen).toHaveBeenCalledWith(O2);
    expect(sheets[0].close).not.toHaveBeenCalled(); // 수주 창이 이 창을 바꾼다 (shell.js — 시트는 하나)
  });

  test('수주 창을 못 열면 — 창을 닫고 계약 화면으로', async () => {
    const { sheets } = load({ orderOpens: false });
    await window.SeganProjectSheet.open(P1);
    sec('orders').querySelector('[data-act="order"]').click();
    await flush();
    expect(sheets[0].closed).toEqual(['nav']);
    expect(window.location.hash).toBe('#p-contract');
    expect(window.SeganProjectSheet.state.open).toBeNull();
  });

  test('화면 링크 — 창을 닫은 뒤 그 화면으로 간다 (전화 링크는 그대로)', async () => {
    const { sheets } = load();
    await window.SeganProjectSheet.open(P1);
    const tel = node().querySelector('.ps-who a');
    const telClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    tel.dispatchEvent(telClick);
    expect(telClick.defaultPrevented).toBe(false);
    expect(sheets[0].close).not.toHaveBeenCalled();
    const link = sec('quotes').querySelector('.ps-more a');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await flush();
    expect(sheets[0].closed).toEqual(['nav']);
    expect(window.location.hash).toBe('#p-quote');
  });

  test('같은 프로젝트를 다시 열면 그대로 둔다 · 닫은 뒤에는 다시 연다', async () => {
    const { sheets, readProject } = load();
    await window.SeganProjectSheet.open(P1);
    await window.SeganProjectSheet.open(P1);
    expect(sheets).toHaveLength(1);
    expect(readProject).toHaveBeenCalledTimes(1);
    await sheets[0].close('button');
    await window.SeganProjectSheet.open(P1);
    expect(sheets).toHaveLength(2);
  });
});

describe('못 읽을 때', () => {
  test('옛 서버 · 오류 — 이미 읽은 줄로 위쪽만 그리고 알린다', async () => {
    for (const project of [
      () => ({ ok: false, status: 404, data: null }),
      () => ({ ok: false, status: 500, data: null }),
      () => ({ ok: false, status: 0, data: null }),
      () => ({ ok: true, status: 200, data: { project: { id: 'other' } } }),
    ]) {
      load({ project });
      await window.SeganProjectSheet.open(P1);
      expect(text(node().querySelector('[data-ps="note"]'))).toBe(
        '지나온 일을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.'
      );
      expect(node().querySelector('.pj-strip')).not.toBeNull();
      expect(sec('history')).toBeNull();
    }
  });

  test('목록에 없는 프로젝트 — 서버에서 읽은 것으로 그린다, 서버에도 없으면 알린다', async () => {
    const { sheets } = load({ items: [] });
    await window.SeganProjectSheet.open(P1);
    expect(sheets[0].opts.title).toBe('프로젝트');
    expect(rows('history')).toHaveLength(3);
    load({ items: [], project: () => ({ ok: false, status: 404, data: null }) });
    await window.SeganProjectSheet.open(P1);
    expect(text(node().querySelector('[data-ps="note"]'))).toBe('프로젝트를 찾을 수 없습니다.');
    expect(node().querySelector('[data-ps="body"]').innerHTML).toBe('');
  });

  test('답이 오기 전에 닫았으면 아무것도 하지 않는다', async () => {
    let done;
    const { sheets } = load({ project: () => new Promise((r) => (done = r)) });
    const opening = window.SeganProjectSheet.open(P1);
    await sheets[0].close('button');
    done({ ok: true, status: 200, data: DATA() });
    await opening;
    expect(window.SeganProjectSheet.state.open).toBeNull();
    expect(sec('history')).toBeNull();
  });

  test('시트나 프로젝트 칸이 없으면 열지 않는다 (canOpen)', async () => {
    load();
    expect(window.SeganProjectSheet.canOpen()).toBe(true);
    delete window.SeganPartnerProjects.readProject;
    expect(window.SeganProjectSheet.canOpen()).toBe(false);
    expect(await window.SeganProjectSheet.open(P1)).toBe(false);
    load();
    window.SeganShell = {};
    expect(window.SeganProjectSheet.canOpen()).toBe(false);
    expect(await window.SeganProjectSheet.open('')).toBe(false);
  });
});
