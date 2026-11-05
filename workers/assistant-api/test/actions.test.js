/**
 * 승인 카드 (src/actions.js · DB 0041) — 비서는 바꾸는 일을 카드로만 만들고, 대화한 본인이 승인하면 그 사람 토큰으로 기존 주소.
 *
 *   - 만들기: 그 사람 토큰으로 읽어 카드 칸(서버 값) · expect(그때 상태), 사건 card, 도구 결과에 「승인 전에는 안 했다」
 *   - 승인: 한 번만 (두 번째 409), 본인만 (남 404), 기한 지나면 409 expired, 돈 카드는 대표 · 실장만
 *     기존 주소에 expect_* · X-Idempotency-Key act:<id> — 결과 done / failed(서버 문구) / unknown(끊김 · 5xx)
 *   - 거절 · 초안(승인하는 카드 아님) · 대화에 카드 · 다음 차례 맥락 블록에 카드 상태
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeDb, makeClaude, makeWorkflow, reply, toolUse, CO, OWNER } from './fakes.js';

const O = 'e0000000-0000-4000-8000-0000000000a1';
const P1 = 'e0000000-0000-4000-8000-0000000000b1';
const DOC = 'e0000000-0000-4000-8000-0000000000c1';
const C1 = 'e0000000-0000-4000-8000-0000000000d1';
const PRJ = 'e0000000-0000-4000-8000-0000000000e1';
const CUS = 'e0000000-0000-4000-8000-0000000000e2';
const D1 = 'e0000000-0000-4000-8000-0000000000f1';
const json = (data, status = 200) =>
  new Response(JSON.stringify(status < 300 ? { success: true, data } : data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function routes(over = {}) {
  return {
    ['/orders/' + O]: (call) =>
      call.method === 'PATCH'
        ? (over.patchOrder || (() => json({ id: O, status: 'in_production' })))(call)
        : json({
            order: {
              id: O,
              order_no: 'SO-20261101-AAAA',
              customer_name: '김고객',
              status: 'confirmed',
            },
            payments: [
              { id: P1, stage: 'balance', amount: 500000, due_on: '2026-11-10', paid_on: null },
            ],
            costs: [],
          }),
    ['/orders/' + O + '/events']: {
      status: 'confirmed',
      can_decide: true,
      pending: null,
      moves: [
        {
          to: 'in_production',
          label: '제작 중',
          kind: 'status',
          approval: false,
          reason_required: false,
          request: false,
        },
        {
          to: 'cancelled',
          label: '취소',
          kind: 'status',
          approval: false,
          reason_required: true,
          request: false,
        },
      ],
    },
    '/company/consults': {
      can_act: true,
      items: [
        {
          id: C1,
          name: '박고객',
          sido: '서울',
          gugun: '강남구',
          furniture_categories: ['싱크대'],
          assignment: {
            state: 'assigned',
            assigned_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600e3).toISOString(),
          },
        },
      ],
    },
    ['/company/consults/' + C1 + '/accept']:
      over.accept || (() => json({ customer_id: CUS, project_id: PRJ })),
    '/ledger/review': {
      items: [
        {
          id: DOC,
          hints: {
            ready: true,
            proposal: {
              entry_date: '2026-11-04',
              direction: 'expense',
              account: 'purchase.materials',
              counterparty_name: '가나목재',
              amount: 200000,
              vat_amount: 20000,
              evidence_type: 'tax_invoice',
            },
          },
        },
      ],
    },
    '/ledger/accounts': { items: [{ code: 'purchase.materials', name: '재료비 매입' }] },
    ['/ledger/documents/' + DOC + '/post']:
      over.post || (() => json({ document_id: DOC, entry_id: 'x' }, 201)),
    '/company/projects': (call) =>
      call.method === 'POST'
        ? (
            over.createProject ||
            (() => json({ project_id: PRJ, customer_id: CUS, reused: false }, 201))
          )(call)
        : json({
            can_manage: true,
            items: [{ id: PRJ, title: '싱크대', customer: { id: CUS, name: '김고객' } }],
          }),
    '/company/designs': {
      items: [{ id: D1, name: '주방 설계', project_id: null, has_order: false }],
    },
    ['/designs/' + D1 + '/project']: over.link || (() => json({ design_id: D1, project_id: PRJ })),
    ['/orders/' + O + '/costs']: over.cost || (() => json({ id: 'cost1' }, 201)),
    ['/orders/' + O + '/payments']:
      over.newPay ||
      (() => json({ payment: { id: 'pay2' }, received: 300000, reused: false }, 201)),
    ['/orders/' + O + '/payments/' + P1]:
      over.payPatch || (() => json({ payment: { id: P1 }, received: 500000 })),
  };
}

async function world({ over = {}, scripts, db } = {}) {
  const claude = makeClaude(scripts || [reply('네')]);
  const w = await makeWorld({ claude, db: db || makeDb(), workflow: makeWorkflow(routes(over)) });
  return { ...w, claude };
}

async function newConversation(w, token = 't-owner') {
  const r = await w.call('/assistant/conversations', { token, method: 'POST' });
  assert.equal(r.status, 201, r.text);
  return r.body.data.conversation.id;
}

/** 한 차례 — 카드 도구 하나를 부르고 답 */
async function propose(name, input, { token = 't-owner', over, db } = {}) {
  const w = await world({
    over,
    db,
    scripts: [toolUse(name, input), reply('카드를 만들었습니다')],
  });
  const id = await newConversation(w, token);
  const r = await w.call('/assistant/conversations/' + id + '/turns', {
    token,
    method: 'POST',
    body: { text: '해 줘' },
  });
  assert.equal(r.status, 202, r.text);
  await w.sessions.runAlarms();
  const result = w.claude.calls
    .at(-1)
    .messages.at(-1)
    .content.find((b) => b.type === 'tool_result');
  return { w, id, result, row: w.db.actions.at(-1) };
}

const approve = (w, id, token = 't-owner') =>
  w.call('/assistant/actions/' + id + '/approve', { token, method: 'POST' });
const reject = (w, id, token = 't-owner') =>
  w.call('/assistant/actions/' + id + '/reject', { token, method: 'POST' });

// ── 만들기 ───────────────────────────────────────────────

test('만들기 — 수주 상태: 서버 값으로 카드 칸 · expect, 사건 card, 도구 결과는 「승인 전에는 안 했다」, 대화 보기에 카드', async () => {
  const { w, id, result, row } = await propose('propose_order_status', {
    order_id: O,
    to: 'in_production',
  });
  assert.ok(!result.is_error, result.content);
  const out = JSON.parse(result.content);
  assert.equal(out.state, 'proposed');
  assert.match(out.note, /승인해야 실행된다/);
  assert.deepEqual(
    row.card.fields.map((f) => [f.label, f.value]),
    [
      ['수주', 'SO-20261101-AAAA'],
      ['고객', '김고객'],
      ['지금', '확정'],
      ['바꿀 상태', '제작 중'],
    ]
  );
  assert.deepEqual(
    [row.kind, row.state, row.user_id, row.company_id],
    ['order_status', 'proposed', OWNER, CO]
  );
  assert.deepEqual(row.expect, { status: 'confirmed' });
  assert.deepEqual(row.params, { order_id: O, to: 'in_production', reason: null });
  // 만들 때는 쓰지 않는다 — 읽기만
  assert.ok(w.workflow.calls.every((c) => !c.method));
  const { list } = await w.events(id, 0);
  const card = list.find((e) => e.type === 'card');
  assert.equal(card.action.id, row.id);
  assert.equal(card.action.state_name, '승인 기다림');
  const conv = await w.call('/assistant/conversations/' + id);
  assert.deepEqual(
    conv.body.data.actions.map((a) => [a.id, a.state]),
    [[row.id, 'proposed']]
  );
  // 도구 결과는 Claude 에 — 카드 객체(card)는 메시지에 남지 않는다
  assert.ok(w.db.messages.every((m) => JSON.stringify(m.content).indexOf('"card":{') < 0));
});

test('만들기 — 안 되는 바꾸기 · 사유 없는 취소 · 없는 수주는 카드 없이 오류 결과', async () => {
  let r = await propose('propose_order_status', { order_id: O, to: 'completed' });
  assert.equal(r.result.is_error, true);
  assert.match(r.result.content, /가능: 제작 중 · 취소/);
  assert.equal(r.w.db.actions.length, 0);
  r = await propose('propose_order_status', { order_id: O, to: 'cancelled' });
  assert.match(r.result.content, /사유가 필요합니다/);
  r = await propose('propose_order_status', {
    order_id: 'e0000000-0000-4000-8000-000000000999',
    to: 'in_production',
  });
  assert.equal(r.result.is_error, true);
  assert.equal(r.w.db.actions.length, 0);
});

test('만들기 — 직원 대화에는 상담 · 돈 카드 도구가 없다 (부르면 쓸 수 없는 도구)', async () => {
  const { result, w } = await propose(
    'propose_consult_accept',
    { consult_id: C1 },
    { token: 't-staff' }
  );
  assert.equal(result.is_error, true);
  assert.match(result.content, /쓸 수 없는 도구/);
  assert.equal(w.db.actions.length, 0);
});

test('만들기 — 상담 받기 · 사진 올리기 · 설계 잇기 · 초안 카드 칸', async () => {
  let r = await propose('propose_consult_accept', { consult_id: C1 });
  assert.deepEqual(
    r.row.card.fields.slice(0, 3).map((f) => f.value),
    ['박고객', '서울 강남구', '싱크대']
  );
  r = await propose('propose_ledger_post', { document_id: DOC });
  assert.deepEqual(
    r.row.card.fields.map((f) => f.value),
    ['2026-11-04', '가나목재', '200,000원', '20,000원', '재료비 매입', '세금계산서']
  );
  assert.equal(r.row.expect.proposal.amount, 200000);
  r = await propose('propose_design_link', { design_id: D1, project_id: PRJ });
  assert.deepEqual(
    r.row.card.fields.map((f) => f.value),
    ['주방 설계', '(이은 프로젝트 없음)', '싱크대']
  );
  assert.deepEqual(r.row.expect, { project_id: null });
  r = await propose(
    'draft_customer_message',
    { text: '내일 10시 실측 방문드립니다.', purpose: '실측 안내' },
    { token: 't-staff' }
  );
  assert.deepEqual(
    [r.row.kind, r.row.state, r.row.card.text],
    ['draft', 'draft', '내일 10시 실측 방문드립니다.']
  );
  assert.match(JSON.parse(r.result.content).note, /보내는 것은 사람이 한다/);
});

test('만들기 — 바로 올릴 수 없는 사진은 카드를 만들지 않는다', async () => {
  const db = makeDb();
  const w = await world({
    db,
    scripts: [toolUse('propose_ledger_post', { document_id: DOC }), reply('네')],
  });
  w.workflow.routes['/ledger/review'] = {
    items: [{ id: DOC, hints: { ready: false, blockers: ['account'] } }],
  };
  const id = await newConversation(w);
  await w.call('/assistant/conversations/' + id + '/turns', {
    method: 'POST',
    body: { text: '올려 줘' },
  });
  await w.sessions.runAlarms();
  const res = w.claude.calls
    .at(-1)
    .messages.at(-1)
    .content.find((b) => b.type === 'tool_result');
  assert.equal(res.is_error, true);
  assert.match(res.content, /바로 올릴 수 있는 사진이 아닙니다/);
  assert.equal(db.actions.length, 0);
});

// ── 승인 ─────────────────────────────────────────────────

test('승인 — 수주 상태: 그 사람 토큰 · expect_status 로 PATCH, 완료 · 한 번만 (두 번째 409), 남은 404', async () => {
  const { w, row } = await propose('propose_order_status', { order_id: O, to: 'in_production' });
  const r = await approve(w, row.id);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.action.state, 'done');
  const patch = w.workflow.calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch.body, { status: 'in_production', expect_status: 'confirmed' });
  assert.equal(patch.token, 't-owner');
  assert.equal(w.db.actions[0].state, 'done');
  assert.equal(w.db.actions[0].result.order_status, 'in_production');
  const again = await approve(w, row.id);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'decided');
  assert.equal(w.workflow.calls.filter((c) => c.method === 'PATCH').length, 1);
  const other = await approve(w, row.id, 't-other');
  assert.equal(other.status, 404);
  assert.ok(w.db.audit.some((a) => a.kind === 'action' && a.detail.state === 'done'));
});

test('승인 — 서버가 막으면 failed(서버 문구), 끊기거나 5xx 면 unknown', async () => {
  let { w, row } = await propose(
    'propose_order_status',
    { order_id: O, to: 'in_production' },
    {
      over: {
        patchOrder: () =>
          json({ success: false, message: '그 사이 수주 상태가 바뀌었습니다', code: 'stale' }, 409),
      },
    }
  );
  let r = await approve(w, row.id);
  assert.equal(r.body.data.action.state, 'failed');
  assert.equal(r.body.data.action.result.message, '그 사이 수주 상태가 바뀌었습니다');
  assert.equal(w.db.actions[0].result.code, 'stale');
  ({ w, row } = await propose(
    'propose_order_status',
    { order_id: O, to: 'in_production' },
    {
      over: {
        patchOrder: () => {
          throw new Error('network');
        },
      },
    }
  ));
  r = await approve(w, row.id);
  assert.equal(r.body.data.action.state, 'unknown');
  ({ w, row } = await propose(
    'propose_order_status',
    { order_id: O, to: 'in_production' },
    {
      over: { patchOrder: () => json({ success: false, message: 'boom' }, 503) },
    }
  ));
  r = await approve(w, row.id);
  assert.equal(r.body.data.action.state, 'unknown');
});

test('승인 — 만들기 · 새 줄은 X-Idempotency-Key act:<카드 id>, 받음 표시는 expect_unpaid, 설계 잇기는 expect_project_id', async () => {
  let { w, row } = await propose('propose_project_create', {
    title: '거실장',
    customer_name: '최고객',
    customer_phone: '010-2222-3333',
  });
  await approve(w, row.id);
  let call = w.workflow.calls.find((c) => c.method === 'POST' && c.path === '/company/projects');
  assert.equal(call.idem, 'act:' + row.id);
  assert.deepEqual(call.body, {
    title: '거실장',
    customer: { name: '최고객', phone: '010-2222-3333' },
  });
  assert.equal(w.db.actions[0].result.project_id, PRJ);

  ({ w, row } = await propose('propose_cost_add', {
    order_id: O,
    category: 'material',
    amount: 100000,
    vat_amount: 10000,
    spent_on: '2026-11-04',
  }));
  await approve(w, row.id);
  call = w.workflow.calls.find((c) => c.method === 'POST' && c.path.endsWith('/costs'));
  assert.equal(call.idem, 'act:' + row.id);
  assert.deepEqual(call.body, {
    category: 'material',
    amount: 100000,
    vat_amount: 10000,
    spent_on: '2026-11-04',
  });
  assert.equal(w.db.actions[0].result.cost_id, 'cost1');

  ({ w, row } = await propose('propose_payment_received', {
    order_id: O,
    payment_id: P1,
    paid_on: '2026-11-05',
  }));
  await approve(w, row.id);
  call = w.workflow.calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(call.body, { paid_on: '2026-11-05', expect_unpaid: true });
  assert.equal(call.idem, null);

  ({ w, row } = await propose('propose_payment_received', {
    order_id: O,
    stage: 'deposit',
    amount: 300000,
    paid_on: '2026-11-05',
  }));
  await approve(w, row.id);
  call = w.workflow.calls.find((c) => c.method === 'POST' && c.path.endsWith('/payments'));
  assert.equal(call.idem, 'act:' + row.id);

  ({ w, row } = await propose('propose_design_link', { design_id: D1, project_id: PRJ }));
  await approve(w, row.id);
  call = w.workflow.calls.find((c) => c.method === 'PUT');
  assert.deepEqual(call.body, { project_id: PRJ, expect_project_id: null });

  ({ w, row } = await propose('propose_ledger_post', { document_id: DOC }));
  await approve(w, row.id);
  call = w.workflow.calls.find((c) => c.method === 'POST' && c.path.endsWith('/post'));
  assert.equal(call.body.ready, true);
  assert.equal(call.body.entry.counterparty_name, '가나목재');
});

test('승인 — 기한 24시간이 지나면 409 expired 로 닫는다, 거절한 카드 · 초안은 승인하지 않는다', async () => {
  let { w, row } = await propose('propose_consult_accept', { consult_id: C1 });
  w.db.actions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  let r = await approve(w, row.id);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'expired');
  assert.equal(w.db.actions[0].state, 'expired');
  assert.ok(!w.workflow.calls.some((c) => c.method === 'POST'));

  ({ w, row } = await propose('propose_consult_accept', { consult_id: C1 }));
  r = await reject(w, row.id);
  assert.equal(r.body.data.action.state, 'rejected');
  r = await approve(w, row.id);
  assert.equal(r.status, 409);
  assert.ok(!w.workflow.calls.some((c) => c.method === 'POST'));

  ({ w, row } = await propose('draft_customer_message', { text: '안녕하세요' }));
  r = await approve(w, row.id);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'not_action');
});

test('승인 — 돈 카드는 지금 대표 · 실장이어야 한다 (역할이 바뀌면 403), 비서 자격이 없으면 403', async () => {
  const db = makeDb();
  const { w, row } = await propose(
    'propose_cost_add',
    { order_id: O, category: 'material', amount: 1000 },
    { db }
  );
  db.members.find((m) => m.user_id === OWNER).role = 'staff';
  let r = await approve(w, row.id);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'not_money');
  assert.equal(db.actions[0].state, 'proposed');
  db.members.find((m) => m.user_id === OWNER).role = 'owner';
  db.entitled[CO] = 'none';
  r = await approve(w, row.id);
  assert.equal(r.status, 403);
  assert.equal(db.actions[0].state, 'proposed');
});

test('다음 차례 — 맥락 블록에 이 대화 카드 상태 (승인 결과를 비서가 안다)', async () => {
  const w = await world({
    scripts: [
      toolUse('propose_order_status', { order_id: O, to: 'in_production' }),
      reply('카드'),
      reply('완료됐네요'),
    ],
  });
  const id = await newConversation(w);
  await w.call('/assistant/conversations/' + id + '/turns', {
    method: 'POST',
    body: { text: '제작 중으로' },
  });
  await w.sessions.runAlarms();
  await approve(w, w.db.actions[0].id);
  await w.call('/assistant/conversations/' + id + '/turns', {
    method: 'POST',
    body: { text: '됐어?' },
  });
  await w.sessions.runAlarms();
  const ctx = w.claude.calls.at(-1).messages.at(-1).content[0].text;
  assert.match(ctx, /이 대화의 카드: 「수주 상태 바꾸기 · SO-20261101-AAAA」 완료/);
});
