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

  test('누가 · 잔금 · 보류 상태 (2026-11-21 뒤 공정 1차) — 일어난 일 줄 끝에 이름 · 고객, 끝난 수주에 잔금, 보류면 맨 위 한 줄', async () => {
    const data = DATA();
    data.history[0].who = { kind: 'member', name: '박실장' };
    data.history[1].who = { kind: 'customer', name: null };
    data.history[2].who = { kind: 'member', name: null };
    data.orders = [
      {
        id: O2,
        order_no: 'A-002',
        status: 'completed',
        ordered_at: '2026-11-08T00:00:00Z',
        delivered_at: null,
        completed_at: '2026-11-16T00:00:00Z',
        deposit: 'paid',
        balance: 'unpaid',
      },
      {
        id: O1,
        order_no: 'A-001',
        status: 'in_production',
        ordered_at: '2026-11-07T05:00:00Z',
        deposit: 'paid',
        balance: 'unpaid',
      },
    ];
    data.project = {
      ...data.project,
      status: 'on_hold',
      hold_until: '2026-12-05',
      status_note: '이사 <날짜> 미정',
      next: null,
    };
    load({ project: () => ({ ok: true, status: 200, data }) });
    window.SeganPartnerProjects.nextOf = () => ({
      strip: '<ol class="pj-strip"></ol>',
      note: '',
      act: '',
      tail: '',
    });
    await window.SeganProjectSheet.open(P1);
    expect(rows('history')).toEqual([
      '2026.11.01 09:30프로젝트가 생겼습니다 · 박실장',
      '2026.11.05 12:00견적서를 <i>보냈습니다</i> · 고객',
      '2026.11.08계약금이 들어왔습니다 · 구성원',
    ]);
    // 잔금은 끝난 수주에서만 적는다
    expect(rows('orders')).toEqual([
      'A-002 · 완료2026.11.08 · 계약금 받음 · 잔금 전열기',
      'A-001 · 생산 중2026.11.07 · 계약금 받음열기',
    ]);
    expect(text(node().querySelector('[data-ps="state"]'))).toBe(
      '보류 중 · 다시 볼 날 2026.12.05 · 「이사 <날짜> 미정」'
    );
    // 창에서는 상태를 바꾸지 않는다 — 프로젝트 줄의 「보류 · 그만둠」에서 한다
    expect(node().querySelector('form')).toBeNull();
    const S = window.SeganProjectSheet;
    expect([
      S.byText({ kind: 'admin' }),
      S.byText({ kind: 'worker' }),
      S.byText({ kind: 'system' }),
      S.byText(null),
    ]).toEqual(['본사', '작업자', '', '']);
    expect([
      S.stateText({ status: 'active' }),
      S.stateText({ status: 'cancelled', status_note: '포기' }),
    ]).toEqual(['', '그만둔 프로젝트 · 「포기」']);
  });

  test('실측 한 줄 (2026-11-21 뒤 공정 2차) — 프로젝트 줄과 같은 글을 맨 위에. 창의 실측 단추는 창을 닫고 프로젝트 줄에서 한다', async () => {
    const data = DATA();
    load({ project: () => ({ ok: true, status: 200, data }) });
    const PP = window.SeganPartnerProjects;
    PP.visitText = jest.fn(() => '실측 11.25 (수) 14:00 · 박실장');
    PP.openVisit = jest.fn();
    PP.runNext = jest.fn();
    PP.nextOf = () => ({
      strip: '<ol class="pj-strip"></ol>',
      note: '',
      act:
        '<button type="button" data-act="visit" data-for="' +
        P1 +
        '">실측 일정 잡기</button><button type="button" data-act="next-visit-done" data-for="' +
        P1 +
        '">실측 완료 처리</button>',
      tail: '',
    });
    await window.SeganProjectSheet.open(P1);
    expect(text(node().querySelector('[data-ps="visit"]'))).toBe('실측 11.25 (수) 14:00 · 박실장');
    expect(PP.visitText).toHaveBeenCalledWith(expect.objectContaining({ id: P1 }));
    node().querySelector('[data-act="visit"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(PP.openVisit).toHaveBeenCalledWith(P1);
    await window.SeganProjectSheet.open(P1);
    node().querySelector('[data-act="next-visit-done"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(PP.runNext).toHaveBeenCalledWith('next-visit-done', P1);
    // 실측이 없으면 줄도 없다
    PP.visitText = () => '';
    expect(window.SeganProjectSheet.bodyHtml(data)).not.toContain('data-ps="visit"');
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

// ── 단계 띠 · 단계 칸 (2026-11-23 대표님 「선형 단계를 찍으면 … 사진 및 도면, 정보들이 한눈에」) ──────────────
const stage = (key, label, state, from, to, days) => ({ key, label, state, from, to, days });
const STAGES = () => [
  stage('consult', '상담', 'done', '2026-11-01T00:30:00Z', '2026-11-02T00:00:00Z', 1),
  stage('measure', '실측', 'done', '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z', 1),
  stage('design', '설계', 'done', '2026-11-03T00:00:00Z', '2026-11-05T03:00:00Z', 2),
  stage('quote', '견적', 'now', '2026-11-05T03:00:00Z', null, 16),
  stage('contract', '계약', 'todo', null, null, null),
  stage('make', '생산', 'todo', null, null, null),
  stage('install', '설치', 'todo', null, null, null),
  stage('done', '끝', 'todo', null, null, null),
];
const STAGE_DATA = {
  consult: {
    consults: [
      {
        id: 'c-1',
        created_at: '2026-11-01T00:30:00Z',
        sido: '경기',
        gugun: '성남시',
        categories: ['sink', 'fridge'],
        door_finish: 'pet',
        demolition_needed: true,
        price_tier: 'mid',
        preferred_date: '2026-11-05',
        preferred_time: '15:00-18:00',
        wanted_done_date: '2026-12-10',
        description: 'ㄱ자 <b>주방</b>',
        has_image: true,
      },
    ],
  },
  measure: {
    ready: true,
    visit: {
      id: 'v1',
      status: 'done',
      scheduled_at: '2026-11-02T05:00:00Z',
      assignee_name: '나직원',
      note: '가스 배관 왼쪽',
      done_at: '2026-11-03T00:00:00Z',
    },
    photos: [
      {
        url: 'https://img.example/site-1.jpg',
        kind: 'site',
        label: '현장사진',
        at: '2026-11-02T06:00:00Z',
        note: '배관',
      },
      {
        url: 'http://img.example/plain.jpg',
        kind: 'site',
        label: '안 그리는 주소',
        at: null,
        note: null,
      },
    ],
  },
  design: {
    designs: [
      {
        id: 'd1',
        name: '주방 1안',
        created_at: '2026-11-03T03:00:00Z',
        updated_at: '2026-11-04T03:00:00Z',
      },
    ],
    drafts: [
      {
        id: 'draft-1',
        name: '주방 ㄱ자',
        updated_at: '2026-11-04T03:00:00Z',
        walls: 2,
        modules: 14,
      },
    ],
    renders: [
      {
        design_id: 'd1',
        kind: 'front',
        label: '정면도',
        url: 'https://img.example/front.png',
        at: '2026-11-04T03:00:00Z',
      },
    ],
    photos: [],
  },
  quote: {
    quotes: [
      {
        id: 'q2',
        rev: 2,
        current: true,
        created_at: '2026-11-05T03:00:00Z',
        expires_at: '2099-01-01T00:00:00Z',
        view_count: 3,
        decision: 'approved',
        decided_at: '2026-11-07T03:00:00Z',
        total: 8420000,
        reasons: [],
      },
      {
        id: 'q1',
        rev: 1,
        current: false,
        created_at: '2026-11-04T03:00:00Z',
        expires_at: '2099-01-01T00:00:00Z',
        view_count: 1,
        decision: 'rejected',
        decided_at: '2026-11-04T09:00:00Z',
        total: null,
        reasons: ['price'],
      },
    ],
  },
  contract: {
    orders: [
      {
        id: O2,
        order_no: 'A-002',
        status: 'in_production',
        ordered_at: '2026-11-08T00:00:00Z',
        amount: 8420000,
        payments: [
          { stage: 'deposit', due_on: '2026-11-09', paid_on: '2026-11-09', amount: 2000000 },
          { stage: 'balance', due_on: '2026-12-05', paid_on: null, amount: null },
        ],
      },
    ],
    approvals: [],
  },
  make: {
    schedules: [
      {
        id: 's1',
        type: 'manufacturing_start',
        label: '제작 착수',
        status: 'completed',
        scheduled_at: '2026-11-10T00:00:00Z',
        completed_at: '2026-11-10T02:00:00Z',
        assignee_name: '김재단',
      },
    ],
    documents: [
      {
        id: 'doc-9',
        doc_type: 'work_order',
        label: '작업지시서',
        doc_no: 'WO-1',
        rev: 1,
        status: 'issued',
        created_at: '2026-11-09T00:00:00Z',
      },
    ],
    photos: [
      {
        url: 'https://img.example/cut.jpg',
        kind: 'check',
        label: '재단 확인',
        at: '2026-11-11T00:00:00Z',
        note: null,
      },
    ],
    requests: [],
  },
  install: {
    schedules: [
      {
        id: 's2',
        type: 'installation',
        label: '설치',
        status: 'scheduled',
        scheduled_at: '2026-12-02T01:00:00Z',
        completed_at: null,
        assignee_name: null,
        customer_confirmed_at: null,
      },
    ],
    documents: [],
    reports: [
      {
        id: 'r1',
        kind: 'install_done',
        label: '설치 완료',
        note: '실리콘 마감',
        created_at: '2026-12-02T08:00:00Z',
        photo_urls: ['https://img.example/r1.jpg', 'https://img.example/r2.jpg'],
      },
    ],
    photos: [],
  },
  done: {
    as: [
      {
        id: 'a1',
        state: 'received',
        label: '받음',
        body: '도어가 처집니다',
        created_at: '2026-12-20T00:00:00Z',
        received_at: '2026-12-20T03:00:00Z',
        done_at: null,
        photo_urls: ['https://img.example/as.jpg'],
      },
    ],
    reports: [],
    schedules: [],
  },
};

/** 단계 띠를 주는 서버로 띄운다 — readStage · fetchRaw · canVisit · openWork · openVisit 흉내 */
function loadStages(options = {}) {
  const opts = {
    stage: (key) => ({ ok: true, status: 200, data: STAGE_DATA[key] }),
    raw: null,
    ...options,
  };
  const got = load({
    project: () => ({ ok: true, status: 200, data: { ...DATA(), stages: STAGES() } }),
    ...options,
  });
  const pp = window.SeganPartnerProjects;
  pp.readStage = jest.fn(async (id, key) => opts.stage(key, id));
  pp.fetchRaw = jest.fn(async (p) => (opts.raw ? opts.raw(p) : null));
  pp.canVisit = () => true;
  pp.openWork = jest.fn();
  pp.openVisit = jest.fn();
  window.SeganPartnerConsults = {
    ITEMS: { sink: '싱크대', fridge: '냉장고장' },
    DOOR_FINISH: { pet: 'PET' },
    PRICE_TIER: { mid: '중급' },
    TIME_LABELS: { '15:00-18:00': '오후 (15:00~18:00)' },
  };
  return { ...got, pp };
}
const steps = () => [...node().querySelectorAll('[data-act="stage"]')];
const stepOf = (key) => node().querySelector(`[data-act="stage"][data-key="${key}"]`);
const panel = () => node().querySelector('[data-ps="stage"]');
const pick = async (key) => {
  stepOf(key).click();
  await flush();
  await flush();
};

describe('단계 띠 · 단계 칸', () => {
  afterEach(() => {
    delete window.SeganPartnerConsults;
  });

  test('띠 — 끝난 단계 ✓ · 지금 ● · 아직 ○, 날짜와 걸린 날. 마지막 칸은 「A/S」. 지금 단계가 펼쳐진다', async () => {
    const { pp } = loadStages();
    await window.SeganProjectSheet.open(P1);
    await flush();
    expect(steps().map(text)).toEqual([
      '✓ 끝상담11.01 · 1일',
      '✓ 끝실측11.02 · 1일',
      '✓ 끝설계11.03 · 2일',
      '● 지금견적11.05 · 16일째',
      '○ 아직계약',
      '○ 아직생산',
      '○ 아직설치',
      '○ 아직A/S',
    ]);
    expect(steps().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    // 프로젝트 줄의 띠 · 옛 묶음(설계 · 견적 · 계약 …)은 그리지 않는다 — 단계 칸이 대신한다
    expect(node().querySelector('.pj-strip')).toBeNull();
    for (const key of ['designs', 'quotes', 'orders', 'requests', 'as'])
      expect(node().querySelector(`section[data-ps="${key}"]`)).toBeNull();
    // 다음 할 일은 그대로
    expect(text(node().querySelector('[data-act="next-order"]'))).toBe('계약 만들기');
    // 지금 단계의 자료를 한 번 읽는다
    expect(pp.readStage.mock.calls).toEqual([[P1, 'quote']]);
    expect(panel().getAttribute('data-key')).toBe('quote');
    expect(rows('quotes')).toEqual([
      '2판 · 지금 판 · 8,420,000원2026.11.05 보냄 · 고객 승인 · 3번 열어 봄 · 2026.11.07보기',
      '1판2026.11.04 보냄 · 고객 수정 요청 · 1번 열어 봄 · 2026.11.04보기',
    ]);
    // 이 단계에 일어난 일 + 맨 아래 모두
    expect(text(panel())).toContain('이 단계에 일어난 일');
    expect([...panel().querySelectorAll('.ps-history li')].map(text)).toEqual([
      '2026.11.05 12:00견적서를 <i>보냈습니다</i>',
    ]);
    expect(text(sec('history').querySelector('summary'))).toBe('일어난 일 모두 3');
  });

  test('칸을 누르면 그 단계를 읽어 그린다 — 한 번 읽은 단계는 다시 읽지 않고, 못 읽은 단계는 다시 누르면 읽는다', async () => {
    let fail = true;
    const { pp } = loadStages({
      stage: (key) =>
        key === 'make' && fail
          ? { ok: false, status: 500, data: null }
          : { ok: true, status: 200, data: STAGE_DATA[key] },
    });
    await window.SeganProjectSheet.open(P1);
    await flush();
    await pick('measure');
    expect(stepOf('measure').getAttribute('aria-pressed')).toBe('true');
    expect(text(panel())).toContain('실측 날2026.11.02 14:00');
    expect(text(panel())).toContain('끝낸 때2026.11.03 09:00');
    expect(text(panel())).toContain('갈 사람나직원');
    // 사진은 https 주소만
    expect(
      [...panel().querySelectorAll('.pg-photos img')].map((i) => i.getAttribute('src'))
    ).toEqual(['https://img.example/site-1.jpg']);
    expect(text(panel().querySelector('.pg-photos small'))).toBe('현장사진 · 11.02 · 배관');
    await pick('quote');
    await pick('measure');
    expect(pp.readStage.mock.calls.map((c) => c[1])).toEqual(['quote', 'measure']);
    // 못 읽은 단계
    await pick('make');
    expect(text(panel())).toBe('이 단계의 자료를 불러오지 못했습니다. 단계 칸을 다시 눌러 주세요.');
    fail = false;
    await pick('make');
    expect(pp.readStage.mock.calls.map((c) => c[1])).toEqual(['quote', 'measure', 'make', 'make']);
    expect(text(panel())).toContain('제작 착수 · 2026.11.10 09:00김재단 · 끝 11.10');
  });

  test('아직 안 온 단계 · 자료가 없는 단계는 그 사정을 적는다', async () => {
    loadStages({ stage: () => ({ ok: true, status: 200, data: { orders: [], approvals: [] } }) });
    await window.SeganProjectSheet.open(P1);
    await flush();
    await pick('contract');
    expect(text(panel())).toContain('아직 이 단계에 오지 않았습니다.');
    const S = window.SeganProjectSheet;
    expect(S.panelHtml(stage('design', '설계', 'done'), { data: {} }, ROW(), [], NOW)).toContain(
      '이 단계에 남은 자료가 없습니다.'
    );
    expect(
      S.panelHtml(stage('design', '설계', 'now'), { loading: true }, ROW(), [], NOW)
    ).toContain('불러오는 중…');
  });

  test('단계마다의 칸 — 상담 · 설계 · 계약 · 생산 · 설치 · A/S', () => {
    loadStages();
    const S = window.SeganProjectSheet;
    const html = (key, state = 'done') => {
      document.body.innerHTML = S.panelHtml(
        stage(key, key, state),
        { data: STAGE_DATA[key] },
        ROW(),
        [],
        NOW
      );
      return document.body;
    };
    const kv = (root) =>
      Object.fromEntries(
        [...root.querySelectorAll('.pg-kv dt')].map((dt) => [text(dt), text(dt.nextElementSibling)])
      );

    const consult = html('consult');
    expect(kv(consult)).toEqual({
      요청: 'ㄱ자 <b>주방</b>',
      품목: '싱크대 · 냉장고장',
      지역: '경기 성남시',
      '방문 희망': '2026-11-05 오후 (15:00~18:00)',
      '완료 희망': '2026-12-10',
      '도어 마감': 'PET',
      가격대: '중급',
      철거: '필요',
      '받은 날': '2026.11.01',
    });
    expect(consult.querySelector('b')).toBeNull(); // 요청 글은 글자 그대로
    expect(consult.querySelector('a[data-shot="c-1"]').hidden).toBe(true); // 그림은 받아 온 뒤에 보인다

    const design = html('design');
    expect([...design.querySelectorAll('.ps-list li')].map(text)).toEqual([
      '주방 ㄱ자모듈 14 · 벽 2 · 2026.11.04 고침',
    ]);
    expect(text(design.querySelector('.pg-photos small'))).toBe('정면도 · 11.04');

    const contract = html('contract');
    expect(kv(contract)).toEqual({
      '수주 번호': 'A-002',
      상태: '생산 중',
      '계약한 날': '2026.11.08',
      '계약 금액': '8,420,000원',
    });
    expect([...contract.querySelectorAll('[data-ps="payments"] li')].map(text)).toEqual([
      '계약금 · 2,000,000원2026.11.09 받음',
      '잔금받을 날 2026.12.05', // 금액을 못 받은 사람(직원)에게는 금액 없이
    ]);
    expect(contract.querySelector('[data-act="order"]').getAttribute('data-id')).toBe(O2);

    const make = html('make', 'now');
    expect([...make.querySelectorAll('[data-ps="documents"] li')].map(text)).toEqual([
      '작업지시서 WO-11판 · 2026.11.09보기',
    ]);
    expect(make.querySelector('[data-act="print"]').getAttribute('data-id')).toBe('doc-9');
    expect(make.querySelector('[data-act="work"]').getAttribute('data-for')).toBe(P1);
    expect(text(make.querySelector('.pg-photos small'))).toBe('재단 확인 · 11.11');

    const install = html('install', 'todo');
    expect([...install.querySelectorAll('[data-ps="schedules"] li')].map(text)).toEqual([
      '설치 · 2026.12.02 10:00고객 확인 전',
    ]);
    expect(text(install.querySelector('[data-ps="report"] .ps-who'))).toBe(
      '설치 완료 · 2026.12.02 · 실리콘 마감'
    );
    expect(install.querySelectorAll('[data-ps="report"] img')).toHaveLength(2);

    const done = html('done', 'todo');
    expect(text(done.querySelector('[data-ps="as-item"] .ps-who'))).toBe('받음 · 2026.12.20');
    expect(kv(done)).toEqual({ '접수 글': '도어가 처집니다', '받은 날': '2026.12.20' });
    expect(done.querySelector('img').getAttribute('src')).toBe('https://img.example/as.jpg');
  });

  test('일어난 일이 어느 단계 것인가', () => {
    loadStages();
    const of = window.SeganProjectSheet.historyStage;
    expect(of({ kind: 'project_created', go: null })).toBe('consult');
    expect(of({ kind: 'measure_done', go: null })).toBe('measure');
    expect(of({ kind: 'design_linked', go: null })).toBe('design');
    expect(of({ kind: 'quote_sent', go: 'p-quote' })).toBe('quote');
    expect(of({ kind: 'deposit_paid', go: 'p-contract' })).toBe('contract');
    expect(of({ kind: 'request_accepted', go: 'p-make' })).toBe('make');
    expect(of({ kind: 'order_completed', go: 'p-install' })).toBe('install');
    expect(of({ kind: 'as_requested', go: 'p-as' })).toBe('done');
    expect(of(null)).toBe('consult');
  });

  test('문서 「보기」 — 본인 토큰으로 받아 새 창에 쓴다. 새 창이 막히면 알린다', async () => {
    const win = {
      document: { open: jest.fn(), write: jest.fn(), close: jest.fn() },
      close: jest.fn(),
    };
    const openSpy = jest.spyOn(window, 'open').mockReturnValue(win);
    const { pp } = loadStages({
      raw: () => ({ ok: true, text: async () => '<html>지시서</html>' }),
    });
    await window.SeganProjectSheet.open(P1);
    await flush();
    await pick('make');
    panel().querySelector('[data-act="print"]').click();
    await flush();
    await flush();
    expect(pp.fetchRaw).toHaveBeenCalledWith('/documents/doc-9/print');
    expect(win.document.write).toHaveBeenCalledWith('<html>지시서</html>');
    openSpy.mockReturnValue(null);
    panel().querySelector('[data-act="print"]').click();
    await flush();
    expect(text(node().querySelector('[data-ps="note"]'))).toBe(
      '새 창이 막혀 문서를 열지 못했습니다. 팝업을 허용해 주세요.'
    );
  });

  test('상담의 연출컷 — 받아 오면 보이고, 못 받으면 칸을 뺀다', async () => {
    const created = jest.fn(() => 'blob:shot-1');
    const had = window.URL.createObjectURL;
    window.URL.createObjectURL = created;
    try {
      const { pp } = loadStages({ raw: () => ({ ok: true, blob: async () => ({}) }) });
      await window.SeganProjectSheet.open(P1);
      await flush();
      await pick('consult');
      await flush();
      expect(pp.fetchRaw).toHaveBeenCalledWith('/company/consults/c-1/image');
      const a = panel().querySelector('a[data-shot="c-1"]');
      expect(a.hidden).toBe(false);
      expect(a.querySelector('img').getAttribute('src')).toBe('blob:shot-1');
      window.SeganProjectSheet.state.open.handle.close();

      loadStages({ raw: () => ({ ok: false }) });
      await window.SeganProjectSheet.open(P1);
      await flush();
      await pick('consult');
      await flush();
      expect(panel().querySelector('a[data-shot]')).toBeNull();
    } finally {
      window.URL.createObjectURL = had;
    }
  });

  test('「관리」 칸 — 프로젝트 칸이 그리는 자리를 준다. 다시 그려도 같은 마디라 적던 값이 남고, 그 안의 누름은 창이 듣지 않는다', async () => {
    const { pp, sheets } = loadStages();
    const mounts = [];
    pp.mountDetail = jest.fn((el, id, opts) => {
      mounts.push({ el, id, opts });
      if (!el.firstChild)
        el.innerHTML =
          '<input name="note" /><button type="button" data-act="visit" data-for="' +
          id +
          '">실측 일정</button>';
    });
    pp.unmountDetail = jest.fn();
    await window.SeganProjectSheet.open(P1);
    await flush();
    const slot = () => node().querySelector('[data-ps="manage"]');
    expect(slot().firstChild).toBe(mounts[0].el);
    expect(mounts.every((m) => m.el === mounts[0].el && m.id === P1)).toBe(true);
    // 다음 할 일 아래 · 단계 칸 위
    expect(slot().compareDocumentPosition(panel()) & 4).toBe(4);
    // 적던 값 — 단계 칸을 바꿔 다시 그려도 남는다
    slot().querySelector('input').value = '적던 글';
    await pick('measure');
    expect(slot().querySelector('input').value).toBe('적던 글');
    // 「관리」 칸 안의 단추는 프로젝트 칸이 듣는다 — 창이 또 실측 칸을 열지 않는다
    slot().querySelector('[data-act="visit"]').click();
    expect(pp.openVisit).not.toHaveBeenCalled();
    // 단계 칸의 「실측 일정」 · 「작업 배정」은 창을 닫지 않고 「관리」 칸을 펼친다
    panel().querySelector('[data-act="visit"]').click();
    expect(pp.openVisit).toHaveBeenCalledWith(P1);
    await pick('make');
    panel().querySelector('[data-act="work"]').click();
    expect(pp.openWork).toHaveBeenCalledWith(P1);
    expect(sheets[0].closed).toEqual([]);

    // 「관리」 칸에서 한 일로 프로젝트가 바뀌었다 — 프로젝트 · 단계 칸을 다시 읽는다
    const before = pp.readProject.mock.calls.length;
    const stageReads = pp.readStage.mock.calls.length;
    mounts[0].opts.onChange();
    await flush();
    await flush();
    expect(pp.readProject.mock.calls.length).toBe(before + 1);
    expect(pp.readStage.mock.calls.length).toBe(stageReads + 1); // 읽어 둔 단계 칸을 버리고 지금 칸을 다시 읽었다
    expect(slot().querySelector('input').value).toBe('적던 글');

    // 닫으면 자리를 돌려준다
    sheets[0].close('button');
    expect(pp.unmountDetail).toHaveBeenCalledWith(mounts[0].el);
  });

  test('실측 일정 · 작업 배정 — 「관리」 칸을 못 쓰는 프로젝트 칸이면(옛 판) 창을 닫고 프로젝트 줄에서 한다', async () => {
    const { pp, sheets } = loadStages();
    await window.SeganProjectSheet.open(P1);
    await flush();
    await pick('measure');
    panel().querySelector('[data-act="visit"]').click();
    await flush();
    expect(sheets[0].closed).toEqual(['nav']);
    expect(pp.openVisit).toHaveBeenCalledWith(P1);

    document.body.innerHTML = ''; // 흉내 시트는 닫아도 몸을 치우지 않는다
    await window.SeganProjectSheet.open(P1);
    await flush();
    await pick('make');
    panel().querySelector('[data-act="work"]').click();
    await flush();
    expect(pp.openWork).toHaveBeenCalledWith(P1);
  });

  test('프로젝트 줄 — 이름을 누르면 한 건 화면이 열린다 (한 건 화면을 실은 화면에서만 단추)', () => {
    const rowsJs = read('segan/partner-projects.js');
    expect(rowsJs).toContain('data-act="page"');
    expect(rowsJs).toMatch(
      /window\.SeganProjectSheet\.open\(el\.getAttribute\('data-for'\) \|\| ''\)/
    );
    expect(rowsJs).toMatch(/call\('GET', '\/company\/projects\/' \+ id \+ '\/stages\/' \+ key\)/);
    expect(read('workers/workflow-api/src/worker.js')).toContain(
      "path: '/company/projects/:id/stages/:key'"
    );
    // 띠는 일곱 칸으로 못 박지 않는다 — 실측이 들어가면 여덟
    const css = read('segan/shell.css');
    expect(css).not.toMatch(/\.pj-strip \{[^}]*repeat\(7,/);
    // 한 건 화면의 띠는 네 칸씩 — 좁은 창에서도 모든 단계가 한 번에 보인다
    expect(css).toMatch(/\.pg-strip \{[^}]*repeat\(4,/);
  });
});

// ── 단계 칸에 사진 올리기 · 지우기 (2026-11-23 대표님 답 5번 ① — 서버 POST …/stages/:key/photos · DELETE …/photos/:id, DB 0083) ──
describe('단계 칸 — 올린 사진', () => {
  const F1 = 'f0000000-0000-4000-8000-000000000001';
  const F2 = 'f0000000-0000-4000-8000-000000000002';
  const shot = (id, extra = {}) => ({
    id,
    url: 'https://sb.example/storage/v1/object/sign/project-files/' + id + '.jpg?token=t',
    kind: 'upload',
    label: '올린 사진',
    at: '2026-11-22T03:00:00.000Z',
    note: null,
    mine: true,
    ...extra,
  });
  /** 실측 칸의 자료에 올린 사진 · 올리기 자리를 얹는다 */
  const measure = (ups = [], uploads = { ready: true, max: 30, count: ups.length }) => ({
    ...STAGE_DATA.measure,
    uploads,
    photos: [...ups, ...(STAGE_DATA.measure.photos || [])],
  });
  const withUploads = (data, extra = {}) => {
    const got = loadStages({
      stage: (key) => ({ ok: true, status: 200, data: key === 'measure' ? data : { ...STAGE_DATA[key] } }),
    });
    got.pp.sendPhoto = jest.fn(async () => ({ ok: true, status: 201, data: shot(F2), message: '' }));
    got.pp.removePhoto = jest.fn(async () => ({ ok: true, status: 200, message: '' }));
    Object.assign(got.pp, extra);
    return got;
  };
  const up = () => node().querySelector('[data-ps="upload"]');
  const tiles = () => [...up().querySelectorAll('[data-ps="uploads"] li')];
  const file = (name = 'a.jpg', type = 'image/jpeg') => new File(['x'], name, { type });
  /** 파일을 고른 것처럼 — jsdom 은 files 를 못 넣어 속성을 갈아 끼운다 */
  const choose = async (files) => {
    const input = up().querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await flush();
    await flush();
  };

  afterEach(() => {
    delete window.SeganPartnerConsults;
  });

  test('올린 사진은 「올린 사진」 칸에 따로 — 내가 지울 수 있는 것에만 「지우기」, 아래에 「사진 올리기」', async () => {
    withUploads(measure([shot(F1), shot(F2, { mine: false })]));
    await window.SeganProjectSheet.open(P1);
    await flush();
    await pick('measure');
    expect(text(up().querySelector('.od-h'))).toBe('올린 사진 2');
    expect(tiles().map((li) => !!li.querySelector('[data-act="photo-del"]'))).toEqual([true, false]);
    expect(tiles()[0].querySelector('img').getAttribute('src')).toContain(F1);
    const input = up().querySelector('input[type="file"]');
    expect([input.accept, input.multiple, input.getAttribute('data-key')]).toEqual(['image/jpeg,image/png', true, 'measure']);
    expect(text(input.closest('label'))).toBe('사진 올리기');
    // 단계가 원래 주던 사진(플래너 현장사진) 칸에는 올린 사진이 섞이지 않는다
    const own = [...panel().querySelectorAll('[data-ps="photos"] img')].map((i) => i.getAttribute('src'));
    expect(own.some((u) => u.includes('project-files'))).toBe(false);
  });

  test('올리기 — 고른 사진을 차례로 보내고, 그 칸 맨 앞에 끼운다 (단계를 다시 읽지 않는다)', async () => {
    const { pp } = withUploads(measure([shot(F1)]));
    await window.SeganProjectSheet.open(P1);
    await flush();
    await pick('measure');
    const reads = pp.readStage.mock.calls.length;
    const a = file('a.jpg');
    await choose([a]);
    expect(pp.sendPhoto.mock.calls).toEqual([[P1, 'measure', a]]);
    expect(tiles().map((li) => li.querySelector('img').getAttribute('src').includes(F2))).toEqual([true, false]);
    expect(text(up().querySelector('.od-h'))).toBe('올린 사진 2');
    expect(text(up().querySelector('[data-ps="up-msg"]'))).toBe('1장을 올렸습니다.');
    expect(pp.readStage.mock.calls.length).toBe(reads);
  });

  test('올리기 — 서버가 막으면 그 글을 적고 멈춘다. JPEG · PNG 가 아니면 보내지 않는다', async () => {
    const { pp } = withUploads(measure(), {
      sendPhoto: jest.fn(async () => ({ ok: false, status: 409, data: null, message: 'DB 0083 적용 전입니다' })),
    });
    await window.SeganProjectSheet.open(P1);
    await flush();
    await pick('measure');
    await choose([file('a.jpg'), file('b.jpg')]);
    expect(pp.sendPhoto).toHaveBeenCalledTimes(1);
    const msg = up().querySelector('[data-ps="up-msg"]');
    expect([text(msg), msg.classList.contains('is-err')]).toEqual(['DB 0083 적용 전입니다', true]);
    expect(up().querySelector('[data-ps="uploads"]')).toBeNull();
    pp.sendPhoto.mockClear();
    await choose([file('a.gif', 'image/gif')]);
    expect(pp.sendPhoto).not.toHaveBeenCalled();
    expect(text(up().querySelector('[data-ps="up-msg"]'))).toBe('JPEG · PNG 사진만 올립니다.');
  });

  test('올리기 — 남은 자리만큼만 보낸다. 다 차면 단추 대신 안내', async () => {
    const { pp } = withUploads(measure([shot(F1)], { ready: true, max: 2, count: 1 }));
    await window.SeganProjectSheet.open(P1);
    await flush();
    await pick('measure');
    await choose([file('a.jpg'), file('b.jpg')]);
    expect(pp.sendPhoto).toHaveBeenCalledTimes(1);
    expect(text(up().querySelector('[data-ps="up-msg"]'))).toBe('1장을 올렸습니다. 자리가 모자라 앞의 몇 장만 올립니다.');
    expect(up().querySelector('input[type="file"]')).toBeNull();
    expect(text(up().querySelector('[data-ps="up-full"]'))).toBe('한 단계에 올리는 사진이 다 찼습니다.');
  });

  test('지우기 — 두 번 눌러서. 「그만」이면 그대로, 지우면 그 칸에서 빠진다. 못 지우면 그 글', async () => {
    const { pp } = withUploads(measure([shot(F1), shot(F2)]));
    await window.SeganProjectSheet.open(P1);
    await flush();
    await pick('measure');
    tiles()[0].querySelector('[data-act="photo-del"]').click();
    await flush();
    expect(text(tiles()[0].querySelector('small'))).toContain('지울까요?');
    expect(pp.removePhoto).not.toHaveBeenCalled();
    tiles()[0].querySelector('[data-act="photo-del-no"]').click();
    await flush();
    expect(tiles()[0].querySelector('[data-act="photo-del-yes"]')).toBeNull();
    tiles()[0].querySelector('[data-act="photo-del"]').click();
    await flush();
    tiles()[0].querySelector('[data-act="photo-del-yes"]').click();
    await flush();
    await flush();
    expect(pp.removePhoto.mock.calls).toEqual([[P1, F1]]);
    expect(tiles().length).toBe(1);
    expect(text(up().querySelector('.od-h'))).toBe('올린 사진 1');
    // 못 지우면 사진은 그대로 두고 알린다
    pp.removePhoto.mockImplementation(async () => ({ ok: false, status: 403, message: '사진은 올린 사람이나 대표 · 실장이 지웁니다' }));
    tiles()[0].querySelector('[data-act="photo-del"]').click();
    await flush();
    tiles()[0].querySelector('[data-act="photo-del-yes"]').click();
    await flush();
    await flush();
    expect(tiles().length).toBe(1);
    expect(text(up().querySelector('[data-ps="up-msg"]'))).toBe('사진은 올린 사람이나 대표 · 실장이 지웁니다');
  });

  test('올릴 수 없는 때 — 서버가 준비되지 않았으면(DB 전 · 옛 서버) 칸이 없다. 자료 없는 단계에는 안내 아래에 올리기만', () => {
    loadStages();
    const S = window.SeganProjectSheet;
    const pp = window.SeganPartnerProjects;
    pp.sendPhoto = jest.fn();
    pp.removePhoto = jest.fn();
    const html = (data, state = 'done') => {
      document.body.innerHTML = S.panelHtml(stage('quote', '견적', state), { data }, ROW(), [], NOW);
      return document.body;
    };
    expect(html({ quotes: [] }).querySelector('[data-ps="upload"]')).toBeNull();
    expect(html({ quotes: [], uploads: { ready: false, max: 30, count: 0 }, photos: [] }).querySelector('[data-ps="upload"]')).toBeNull();
    const ready = html({ quotes: [], uploads: { ready: true, max: 30, count: 0 }, photos: [] }, 'todo');
    expect(text(ready.querySelector('.pg-empty'))).toBe('아직 이 단계에 오지 않았습니다.');
    expect(ready.querySelector('[data-ps="upload"] input[type="file"]')).not.toBeNull();
    // 올리는 길이 없는 프로젝트 칸(옛 파일)이면 사진은 보이되 단추가 없다
    delete pp.sendPhoto;
    const old = html({ quotes: [], uploads: { ready: true, max: 30, count: 1 }, photos: [shot(F1)] });
    expect(old.querySelectorAll('[data-ps="uploads"] li').length).toBe(1);
    expect(old.querySelector('input[type="file"], [data-act="photo-del"]')).toBeNull();
  });

  test('길 — 프로젝트 칸이 사진을 본문 그대로 보내고, 지우기는 DELETE', () => {
    const rowsJs = read('segan/partner-projects.js');
    expect(rowsJs).toMatch(/'\/company\/projects\/' \+ id \+ '\/stages\/' \+ key \+ '\/photos'/);
    expect(rowsJs).toMatch(/call\('DELETE', '\/company\/projects\/' \+ id \+ '\/photos\/' \+ fileId\)/);
    const w = read('workers/workflow-api/src/worker.js');
    expect(w).toContain("path: '/company/projects/:id/stages/:key/photos'");
    expect(w).toContain("path: '/company/projects/:id/photos/:fileId'");
  });
});
