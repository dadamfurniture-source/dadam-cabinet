/**
 * 읽기 도구 — 도구 차례(tool_use → workflow-api → tool_result → 답), 대화 틀 고정, 토큰, 한도, 줄인 결과.
 * 가짜 Supabase · 가짜 DO · 가짜 Claude · 가짜 workflow-api (test/fakes.js). 실제 네트워크 · 모델 비용 없음.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeClaude, makeWorkflow, reply, toolUse, ORDER_ID, CO } from './fakes.js';
import { toolDefs, checkInput, resultText, runTool, ToolError, RESULT_MAX, PHOTO_PAGE, PHOTO_PAGES } from '../src/tools.js';
import { MAX_TOOL_ROUNDS } from '../src/session.js';
import { contextBlock } from '../src/prompt.js';
import { userTextOf, isTurnStart } from '../src/claude.js';
import { messagesView } from '../src/worker.js';

async function newConversation(w, token = 't-owner') {
  const r = await w.call('/assistant/conversations', { token, method: 'POST' });
  assert.equal(r.status, 201, r.text);
  return r.body.data.conversation.id;
}

async function turn(w, id, text, token = 't-owner') {
  return w.call(`/assistant/conversations/${id}/turns`, { token, method: 'POST', body: { text } });
}

/** 마지막 부르기에 보낸 tool_result 들 */
function lastResults(claude) {
  const msgs = claude.calls.at(-1).messages;
  return msgs.at(-1).content.filter((b) => b.type === 'tool_result');
}

test('도구 차례 — tool_use → 그 사람 토큰으로 workflow-api → tool_result → 답, 메시지는 받은 그대로 한 번에', async () => {
  const claude = makeClaude([
    toolUse('list_orders', { status: 'confirmed' }, { text: '확인해 볼게요.' }),
    reply('확정 수주는 1건입니다.'),
  ]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  assert.equal((await turn(w, id, '확정 수주 보여 줘')).status, 202);
  const live = w.events(id, 0);
  await w.sessions.runAlarms();
  const { list } = await live;
  assert.deepEqual(
    list.map((e) => e.type).filter((t, i, a) => t !== a[i - 1]),
    ['start', 'text', 'tool', 'text', 'done']
  );
  const tool = list.find((e) => e.type === 'tool');
  assert.deepEqual([tool.name, tool.label], ['list_orders', '수주 목록 보는 중']);
  assert.equal(
    list
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join(''),
    '확인해 볼게요.\n\n확정 수주는 1건입니다.'
  );

  // workflow-api — 묻는 사람의 토큰 그대로
  assert.deepEqual(w.workflow.calls, [{ path: '/orders', query: '', token: 't-owner' }]);

  // 둘째 부르기 — 시스템 글 · 도구는 같고, 도구 결과가 붙는다
  assert.equal(claude.calls.length, 2);
  assert.equal(claude.calls[1].system, claude.calls[0].system);
  assert.deepEqual(claude.calls[1].tools, claude.calls[0].tools);
  assert.deepEqual(
    claude.calls[1].messages.map((m) => m.role),
    ['user', 'assistant', 'user']
  );
  const [res] = lastResults(claude);
  assert.equal(res.tool_use_id, 'tu-list_orders');
  assert.equal(res.is_error, undefined);
  const data = JSON.parse(res.content);
  assert.equal(data.total, 1);
  assert.deepEqual(data.items[0], {
    id: ORDER_ID,
    order_no: 'O-1',
    customer_name: '김고객',
    status: 'confirmed',
    ordered_at: '2026-11-01',
    delivered_at: null,
    completed_at: null,
    note: '잔금 현장',
    contract_amount: 5_500_000,
    received_amount: 1_000_000,
  });

  // 저장 — 사람 · 비서(tool_use) · 도구 결과 · 비서(답), 차례 하나에 seq 넷
  assert.deepEqual(
    w.db.messages.map((m) => [m.seq, m.role, m.content.map((b) => b.type)]),
    [
      [1, 'user', ['text', 'text']],
      [2, 'assistant', ['thinking', 'text', 'tool_use']],
      [3, 'user', ['tool_result']],
      [4, 'assistant', ['thinking', 'text']],
    ]
  );
  // 예산 — 부르기마다 하나
  assert.deepEqual(
    w.db.usage.map((u) => u.key),
    [`chat:${id}:1:1`, `chat:${id}:1:2`]
  );
  assert.ok(w.db.usage.every((u) => u.cost !== null));
  // 기록 — 숫자만 (고객 이름 · 도구 결과 없음)
  const t = w.db.audit.find((a) => a.kind === 'turn');
  assert.equal(t.detail.calls, 2);
  assert.equal(t.detail.tools, 1);
  assert.equal(t.detail.output_tokens, 250);
  assert.ok(!JSON.stringify(w.db.audit).includes('김고객'));

  // 대화 보기 — 사람 글 · 그 차례 비서 글 하나 (도구 결과 · 맥락 블록은 없다)
  const view = await w.call(`/assistant/conversations/${id}`);
  assert.deepEqual(
    view.body.data.messages.map((m) => [m.seq, m.role, m.text]),
    [
      [1, 'user', '확정 수주 보여 줘'],
      [2, 'assistant', '확인해 볼게요.\n\n확정 수주는 1건입니다.'],
    ]
  );
  assert.equal(view.body.data.running, null);
  assert.ok(!view.text.includes('tool_use'));
  assert.ok(!view.text.includes('맥락'));

  // 다음 차례 — 지난 도구 메시지까지 그대로 다시 보낸다
  claude.push(reply('네.'));
  await turn(w, id, '고마워');
  await w.sessions.runAlarms();
  const p = claude.calls.at(-1);
  assert.deepEqual(
    p.messages.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant', 'user']
  );
  assert.deepEqual(p.messages[2].content, w.db.messages[2].content);
});

test('직원 — 견적 합 · 연락처 · 사진 주소는 빼고, 대화에 없는 돈 도구는 오류 결과', async () => {
  const claude = makeClaude([
    toolUse('list_consults', {}),
    toolUse('books_summary', {}),
    reply('배정 상담은 1건입니다.'),
  ]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w, 't-staff');
  await turn(w, id, '상담 뭐 있어?', 't-staff');
  await w.sessions.runAlarms();
  // 첫 도구 — 직원 토큰
  assert.deepEqual(
    w.workflow.calls.map((c) => [c.path, c.token]),
    [['/company/consults', 't-staff']]
  );
  const consults = JSON.parse(claude.calls[1].messages.at(-1).content[0].content);
  const c = consults.items[0];
  assert.equal(c.customer_name, '김고객');
  assert.equal(c.region, '서울 강남구');
  assert.deepEqual(c.assignment, {
    state: 'waiting',
    assigned_at: '2026-11-01T01:00:00Z',
    expires_at: '2026-11-02T01:00:00Z',
  });
  for (const k of ['quote_total', 'phone', 'email', 'generation_image_url', 'name'])
    assert.ok(!(k in c), k);
  // 둘째 도구 — 직원 대화 목록에 없다: workflow-api 를 부르지 않고 오류 결과
  const [bad] = lastResults(claude);
  assert.equal(bad.is_error, true);
  assert.match(bad.content, /쓸 수 없는 도구/);
  assert.equal(w.workflow.calls.length, 1);
  assert.equal(w.db.messages.length, 6);
});

test('대표 상담 — 견적 합은 싣는다, 연락처는 대표에게도 싣지 않는다', async () => {
  const claude = makeClaude([toolUse('list_consults', {}), reply('네')]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '상담');
  await w.sessions.runAlarms();
  const c = JSON.parse(lastResults(claude)[0].content).items[0];
  assert.equal(c.quote_total, 3_300_000);
  assert.ok(!('phone' in c) && !('email' in c));
});

test('수주 자세히 — 대표는 원가 · 마진 · 수금, 직원은 workflow-api 가 줘도 싣지 않는다', async () => {
  for (const [token, money] of [
    ['t-owner', true],
    ['t-staff', false],
  ]) {
    const claude = makeClaude([toolUse('get_order', { order_id: ORDER_ID }), reply('네')]);
    const w = await makeWorld({ claude });
    const id = await newConversation(w, token);
    await turn(w, id, '수주 O-1', token);
    await w.sessions.runAlarms();
    assert.equal(w.workflow.calls[0].path, `/orders/${ORDER_ID}`);
    const out = JSON.parse(lastResults(claude)[0].content);
    assert.equal(out.order.order_no, 'O-1');
    assert.equal(out.rework_count, 0);
    if (money) {
      assert.equal(out.margin.cost_total, 800_000);
      assert.equal(out.costs[0].vendor_name, '예림');
      assert.equal(out.payments[0].memo, '계약금');
      assert.equal(out.order.contract_amount, 5_500_000);
    } else {
      for (const k of ['margin', 'costs', 'payments']) assert.ok(!(k in out), k);
      assert.ok(!('contract_amount' in out.order));
    }
  }
});

test('회계장부 한 달 — 계정 이름 · 계정별 합, 취소 줄은 뺀다, 달은 그대로 넘긴다', async () => {
  const claude = makeClaude([toolUse('ledger_month', { month: '2026-11' }), reply('네')]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '이번 달 장부');
  await w.sessions.runAlarms();
  assert.deepEqual(w.workflow.calls.map((c) => c.path + c.query).sort(), [
    '/ledger/accounts',
    '/ledger/book?month=2026-11',
  ]);
  const out = JSON.parse(lastResults(claude)[0].content);
  assert.equal(out.rows_total, 2);
  assert.deepEqual(
    out.by_account.map((a) => [a.direction, a.account, a.amount, a.vat_amount, a.count]),
    [
      ['income', '매출', 909_091, 90_909, 1],
      ['expense', '재료비', 800_000, 80_000, 1],
    ]
  );
  assert.equal(out.rows[1].counterparty, '예림');
  assert.equal(out.rows[1].account, '재료비');
  assert.ok(!JSON.stringify(out).includes('취소된 줄'));
});

test('장부 알림 — 종류 이름 · 급함 · 본 표시 · 서버 숫자 그대로 (사진 id 는 싣지 않는다)', async () => {
  const claude = makeClaude([toolUse('ledger_notices', {}), reply('네')]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '이번 주 장부에 바뀐 점은?');
  await w.sessions.runAlarms();
  assert.deepEqual(
    w.workflow.calls.map((c) => c.path + c.query),
    ['/ledger/notices?limit=30']
  );
  const out = JSON.parse(lastResults(claude)[0].content);
  assert.equal(out.unseen, 1);
  assert.deepEqual(out.items[0], {
    kind: 'large_amount',
    kind_name: '평소와 다른 큰 금액',
    urgent: true,
    created_at: '2026-11-03T05:00:00Z',
    seen: false,
    data: { supplier: '예림', total: 2480000, median: 860000, n: 6, ratio: 2.9 },
  });
  assert.equal(out.items[1].kind_name, '단가 변동 (읽은 값 기준)');
  assert.equal(out.items[1].seen, true);
  assert.equal(out.items[2].kind_name, '지난달 회계 보고 (매출 · 매입 · 장부 손익)');
  assert.deepEqual(out.items[2].data, { month: '2026-10', rows: 42, income: 48200000, expense: 31050000, profit: 17150000 });
  assert.ok(!JSON.stringify(out).includes('d1'));
});

test('오늘 브리핑 — 서버가 센 값 그대로 + 코드 이름, 직원 대화에도 있다', async () => {
  const claude = makeClaude([toolUse('today_brief', {}), reply('네')]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '오늘 브리핑 정리해 줘');
  await w.sessions.runAlarms();
  assert.deepEqual(w.workflow.calls.map((c) => c.path + c.query), ['/brief/today']);
  const out = JSON.parse(lastResults(claude)[0].content);
  assert.equal(out.date, '2026-11-05');
  assert.equal(out.count, 4);
  assert.deepEqual(out.items.receivables, { count: 1, total: 300000, late_count: 1, late_total: 300000, today_count: 0, today_total: 0 });
  assert.equal(out.items.notices, null);
  assert.deepEqual(out.work[0].roles.cut, { done: 1, total: 2, must_left: 0 });
  assert.equal(out.names.work_role.cut, '재단');
  assert.equal(out.names.schedule.installation, '설치');
  assert.ok(toolDefs({ money: false }).some((t) => t.name === 'today_brief'));
});

test('올린 사진 · 장부 요약 · 고객 프로젝트 — 줄인 모양', async () => {
  const claude = makeClaude([
    toolUse('ledger_photos', {}, { id: 'a' }),
    toolUse('books_summary', {}, { id: 'b' }),
    toolUse('list_projects', {}, { id: 'c' }),
    reply('네'),
  ]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '정리해 줘');
  await w.sessions.runAlarms();
  const results = claude.calls
    .slice(1)
    .map((p) => JSON.parse(p.messages.at(-1).content[0].content));
  assert.deepEqual(results[0], {
    counted: 3,
    complete: true,
    by_status: { pending: 2, posted: 1 },
    status_names: { pending: '확인 기다림', posted: '장부에 올림' },
    oldest_pending_at: '2026-11-01T00:00:00Z',
  });
  assert.equal(results[1].month, '2026-11');
  assert.deepEqual(results[2].items[0], {
    id: 'p1',
    title: '강남 주방',
    status: 'open',
    created_at: '2026-10-30T00:00:00Z',
    closed_at: null,
    customer_name: '김고객',
    design_count: 2,
  });
  assert.deepEqual(
    w.workflow.calls.map((c) => c.path + c.query),
    ['/ledger/documents?limit=100', '/books/summary', '/company/projects']
  );
});

/** 사진 n 장 — 새것부터 (1분씩 앞), 상태는 status(i) */
function photos(n, start, status) {
  return Array.from({ length: n }, (_, i) => ({
    id: `d${start + i}`,
    review_status: status(start + i),
    created_at: new Date(Date.UTC(2026, 10, 5) - (start + i) * 60_000).toISOString(),
  }));
}
/** 가짜 사진 목록 — before 를 따라 넘긴다 */
function photoRoute(all) {
  return (call) => {
    const before = new URLSearchParams(call.query).get('before');
    const rest = before ? all.filter((d) => d.created_at < before) : all;
    return new Response(JSON.stringify({ success: true, data: { money: true, items: rest.slice(0, PHOTO_PAGE) } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

test('올린 사진 — 최근 100장이 아니라 끝까지 센다 (확인 기다림 ↔ 모아 둔 명세표)', async () => {
  const all = photos(130, 0, (i) => (i === 129 ? 'pending' : i % 2 ? 'held' : 'posted'));
  const workflow = makeWorkflow({ '/ledger/documents': photoRoute(all) });
  const claude = makeClaude([toolUse('ledger_photos', {}, { id: 'a' }), reply('네')]);
  const w = await makeWorld({ claude, workflow });
  const id = await newConversation(w);
  await turn(w, id, '사진');
  await w.sessions.runAlarms();
  const out = JSON.parse(claude.calls[1].messages.at(-1).content[0].content);
  assert.equal(out.counted, 130);
  assert.equal(out.complete, true);
  assert.deepEqual(out.by_status, { posted: 65, held: 64, pending: 1 });
  assert.equal(out.status_names.held, '세금계산서 기다리는 명세표(모아 둠 — 확인은 끝남)');
  assert.equal(out.oldest_pending_at, all[129].created_at);
  const docCalls = w.workflow.calls.filter((c) => c.path === '/ledger/documents');
  assert.equal(docCalls.length, 2);
  assert.equal(new URLSearchParams(docCalls[1].query).get('before'), all[99].created_at);
});

test('올린 사진 — PHOTO_PAGES 번을 넘으면 거기까지만 세고 complete false', async () => {
  const all = photos(PHOTO_PAGE * PHOTO_PAGES + 5, 0, () => 'posted');
  const workflow = makeWorkflow({ '/ledger/documents': photoRoute(all) });
  const claude = makeClaude([toolUse('ledger_photos', {}, { id: 'a' }), reply('네')]);
  const w = await makeWorld({ claude, workflow });
  const id = await newConversation(w);
  await turn(w, id, '사진');
  await w.sessions.runAlarms();
  const out = JSON.parse(claude.calls[1].messages.at(-1).content[0].content);
  assert.equal(out.counted, PHOTO_PAGE * PHOTO_PAGES);
  assert.equal(out.complete, false);
  assert.equal(w.workflow.calls.filter((c) => c.path === '/ledger/documents').length, PHOTO_PAGES);
});

test('도구 오류 — workflow-api 거절 문구 · 틀린 입력은 is_error 결과로, 차례는 계속된다', async () => {
  const workflow = makeWorkflow({
    '/company/projects': () =>
      new Response(
        JSON.stringify({
          success: false,
          message: '프로젝트를 가질 수 없는 업체입니다',
          code: 'x',
        }),
        { status: 403 }
      ),
  });
  const claude = makeClaude([
    toolUse('list_projects', {}, { id: 'a' }),
    toolUse('get_order', { order_id: 'not-a-uuid' }, { id: 'b' }),
    toolUse('list_orders', { status: 'lost' }, { id: 'c' }),
    reply('볼 수 없었습니다.'),
  ]);
  const w = await makeWorld({ claude, workflow });
  const id = await newConversation(w);
  await turn(w, id, '프로젝트');
  await w.sessions.runAlarms();
  const res = claude.calls.slice(1).map((p) => p.messages.at(-1).content[0]);
  assert.deepEqual(
    res.map((r) => [r.is_error, r.content]),
    [
      [true, '프로젝트를 가질 수 없는 업체입니다'],
      [true, 'order_id 는 수주 id(uuid)입니다'],
      [
        true,
        'status 는 confirmed · in_production · delivered · completed · cancelled 중 하나입니다',
      ],
    ]
  );
  assert.deepEqual(
    w.workflow.calls.map((c) => c.path),
    ['/company/projects']
  );
  const { list } = await w.events(id);
  assert.equal(list.at(-1).type, 'done');
});

test(`도구 한도 — ${MAX_TOOL_ROUNDS}번 뒤에는 「지금까지 본 자료로」 결과, 그래도 찾으면 tool_limit · 기록 없음`, async () => {
  const scripts = [];
  for (let i = 0; i < MAX_TOOL_ROUNDS + 2; i++)
    scripts.push(toolUse('list_orders', {}, { id: 'tu' + i }));
  const claude = makeClaude(scripts);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '계속 찾아');
  await w.sessions.runAlarms();
  assert.equal(w.workflow.calls.length, MAX_TOOL_ROUNDS);
  assert.equal(claude.calls.length, MAX_TOOL_ROUNDS + 2);
  const note = claude.calls.at(-1).messages.at(-1).content[0];
  assert.equal(note.is_error, true);
  assert.match(note.content, /지금까지 본 자료로 답하라/);
  const { list } = await w.events(id);
  assert.deepEqual([list.at(-1).type, list.at(-1).code], ['error', 'tool_limit']);
  assert.equal(list.filter((e) => e.type === 'tool').length, MAX_TOOL_ROUNDS);
  assert.equal(w.db.messages.length, 0);
  assert.equal(w.db.usage.length, MAX_TOOL_ROUNDS + 2);
  assert.ok(w.db.usage.every((u) => u.cost !== null));
});

test('도구 한도 — 마지막 안내 뒤 글로 답하면 저장한다', async () => {
  const scripts = [];
  for (let i = 0; i < MAX_TOOL_ROUNDS + 1; i++)
    scripts.push(toolUse('list_orders', {}, { id: 'tu' + i }));
  scripts.push(reply('지금까지 본 것으로 정리합니다.'));
  const claude = makeClaude(scripts);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '계속 찾아');
  await w.sessions.runAlarms();
  const { list } = await w.events(id);
  assert.equal(list.at(-1).type, 'done');
  assert.equal(w.db.messages.length, 2 + 2 * (MAX_TOOL_ROUNDS + 1));
});

test('도구 뒤 거절 · 잘린 tool_use — 메시지를 넣지 않고 부른 만큼 정산', async () => {
  const refuse = reply('', { chunks: [], content: [], stop_reason: 'refusal' });
  const cut = toolUse('list_orders', {});
  cut.stop_reason = 'max_tokens';
  for (const [second, end] of [
    [refuse, ['refused', undefined]],
    [cut, ['error', 'cut']],
  ]) {
    const claude = makeClaude([toolUse('list_orders', {}), second]);
    const w = await makeWorld({ claude });
    const id = await newConversation(w);
    await turn(w, id, '수주');
    await w.sessions.runAlarms();
    const { list } = await w.events(id);
    assert.deepEqual([list.at(-1).type, list.at(-1).code], end);
    assert.equal(w.db.messages.length, 0);
    assert.equal(w.db.usage.length, 2);
    assert.ok(w.db.usage.every((u) => u.cost !== null));
  }
});

test('대화 틀 고정 — 플레이북이 바뀌어도 이 대화의 시스템 글 · 도구는 첫 차례 그대로, 새 대화는 새 틀', async () => {
  const claude = makeClaude([reply('하나'), reply('둘'), reply('셋')]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '하나');
  await w.sessions.runAlarms();
  w.db.playbooks.push({ key: 'consult', version: 1, body: '상담은 24시간 안에 답한다.' });
  await turn(w, id, '둘');
  await w.sessions.runAlarms();
  assert.equal(claude.calls[1].system, claude.calls[0].system);
  assert.ok(!claude.calls[1].system.includes('24시간'));
  const id2 = await newConversation(w);
  await turn(w, id2, '셋');
  await w.sessions.runAlarms();
  assert.ok(claude.calls[2].system.includes('상담은 24시간 안에 답한다.'));
});

test('토큰 — 저장소 · 사건 · 기록에 남지 않고, 객체가 다시 떠서 없으면 expired (Claude 를 부르지 않는다)', async () => {
  const claude = makeClaude([toolUse('list_orders', {}), reply('네')]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '수주');
  await w.sessions.runAlarms();
  const { storage } = w.sessions.objects.get(id);
  const stored = JSON.stringify([...storage.map.values()]);
  assert.ok(!stored.includes('t-owner'));
  assert.ok(!JSON.stringify(w.db.audit).includes('t-owner'));
  assert.ok(!JSON.stringify(w.db.messages).includes('t-owner'));

  // 차례를 받은 뒤 객체가 메모리를 잃었다
  await turn(w, id, '또');
  w.sessions.objects.get(id).obj.tokens.clear();
  await w.sessions.runAlarms();
  const { list } = await w.events(id);
  assert.deepEqual([list.at(-1).type, list.at(-1).code], ['error', 'expired']);
  assert.equal(claude.calls.length, 2);
});

test('대화 보기 running — 도는 차례를 { turn, after } 로, 끝나면 null', async () => {
  const claude = makeClaude([reply('하나'), reply('둘')]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '하나');
  await w.sessions.runAlarms();
  const r = await turn(w, id, '둘');
  const during = await w.call(`/assistant/conversations/${id}`);
  assert.deepEqual(during.body.data.running, { turn: 2, after: r.body.data.after });
  await w.sessions.runAlarms();
  const after = await w.call(`/assistant/conversations/${id}`);
  assert.equal(after.body.data.running, null);
});

// ── 순수 ─────────────────────────────────────────────────

test('toolDefs — 돈 도구는 대표 · 실장만, 모두 strict · additionalProperties false', () => {
  const all = toolDefs({ money: true });
  const staff = toolDefs({ money: false });
  assert.equal(all.length, 19);
  assert.deepEqual(
    all.filter((t) => !staff.some((s) => s.name === t.name)).map((t) => t.name),
    [
      'books_summary',
      'ledger_month',
      'ledger_notices',
      'propose_consult_accept',
      'propose_consult_decline',
      'propose_ledger_post',
      'propose_project_create',
      'propose_design_link',
      'propose_payment_received',
      'propose_cost_add',
    ]
  );
  for (const t of all) {
    assert.equal(t.strict, true);
    assert.equal(t.input_schema.additionalProperties, false);
    assert.ok(!('label' in t) && !('money' in t));
  }
});

test('checkInput — 모르는 입력 · 틀린 달 · 틀린 id · 틀린 상태', () => {
  assert.deepEqual(checkInput('list_orders', {}), {});
  assert.deepEqual(checkInput('ledger_month', { month: '2026-11' }), { month: '2026-11' });
  for (const [name, input] of [
    ['list_orders', { status: 'lost' }],
    ['list_orders', { x: 1 }],
    ['ledger_month', { month: '2026-13' }],
    ['books_summary', { month: '11월' }],
    ['get_order', {}],
    ['get_order', { order_id: '1' }],
    ['nope', {}],
    ['list_orders', null],
  ]) {
    assert.throws(() => checkInput(name, input), ToolError, name + JSON.stringify(input));
  }
});

test('resultText — RESULT_MAX 를 넘으면 목록을 줄이고 shortened 표시', () => {
  const big = {
    total: 2000,
    items: Array.from({ length: 2000 }, (_, i) => ({ i, s: 'x'.repeat(50) })),
  };
  const text = resultText(big);
  assert.ok(text.length <= RESULT_MAX);
  const v = JSON.parse(text);
  assert.equal(v.shortened, true);
  assert.equal(v.total, 2000);
  assert.ok(v.items.length < 2000 && v.items[0].i === 0);
  assert.equal(resultText({ a: 1 }), '{"a":1}');
});

test('runTool — 던지지 않는다 (서버 오류 · 닿지 못함 · 401)', async () => {
  const ctx = { token: 't', money: true, allowed: new Set(['list_orders']) };
  const block = { id: 'x', name: 'list_orders', input: {} };
  const cases = [
    [{}, '자료 서버에 닿지 못했습니다'],
    [
      {
        WORKFLOW_API: {
          fetch: async () => {
            throw new Error('down');
          },
        },
      },
      '자료 서버에 닿지 못했습니다',
    ],
    [
      { WORKFLOW_API: { fetch: async () => new Response('x', { status: 500 }) } },
      '자료 서버 오류 (500)',
    ],
    [{ WORKFLOW_API: { fetch: async () => new Response('{}', { status: 401 }) } }, /다시 로그인/],
  ];
  for (const [env, msg] of cases) {
    const r = await runTool(env, block, ctx);
    assert.equal(r.type, 'tool_result');
    assert.equal(r.tool_use_id, 'x');
    assert.equal(r.is_error, true);
    if (msg instanceof RegExp) assert.match(r.content, msg);
    else assert.equal(r.content, msg);
  }
});

test('맥락 블록 · 사람 글 · 차례 시작 · 화면 메시지 묶기', () => {
  assert.equal(
    contextBlock(Date.UTC(2026, 10, 2, 15, 30)).text,
    '<맥락>오늘은 2026-11-03 (화), 한국 시간이다.</맥락>'
  );
  const user = [contextBlock(0), { type: 'text', text: '안녕' }];
  assert.equal(userTextOf(user), '안녕');
  assert.equal(isTurnStart({ role: 'user', content: user }), true);
  assert.equal(
    isTurnStart({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x' }],
    }),
    false
  );
  assert.deepEqual(
    messagesView([
      { seq: 1, role: 'user', content: user, created_at: 't1' },
      { seq: 2, role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'n', input: {} }] },
      { seq: 3, role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x' }] },
      { seq: 4, role: 'assistant', content: [{ type: 'text', text: '답' }], created_at: 't4' },
      { seq: 5, role: 'user', content: [{ type: 'text', text: '또' }], created_at: 't5' },
      { seq: 6, role: 'assistant', content: [{ type: 'text', text: '가' }], created_at: 't6' },
      { seq: 7, role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'y' }] },
      { seq: 8, role: 'assistant', content: [{ type: 'text', text: '나' }], created_at: 't8' },
    ]).map((m) => [m.seq, m.role, m.text]),
    [
      [1, 'user', '안녕'],
      [4, 'assistant', '답'],
      [5, 'user', '또'],
      [6, 'assistant', '가\n\n나'],
    ]
  );
  assert.equal(CO.length, 36);
});
