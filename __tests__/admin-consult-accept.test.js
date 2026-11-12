/**
 * admin/consultations.html 「일정 확정」 — 업무 서버(workflow-api) POST /consultations/:id/accept 로 확정한다.
 *
 * 상담의 고객 · 프로젝트 연결 칸은 사용자 JWT 로 바꿀 수 없어(keep_owner_links) 서버가 상태 · 확정 일시와 함께 잇는다.
 * 화면은 status · confirmed_at 을 직접 고치지 않고, 서버가 실패하면 행을 건드리지 않는다.
 * 담당자 메모 · 담당자는 서버가 성공한 뒤 예전처럼 화면이 적는다.
 * 페이지 스크립트를 jsdom 에 올리고 가짜 Supabase · 가짜 fetch 로 돌린다 (admin-hq-scope.test.js 와 같은 방식).
 */
const fs = require('fs');
const path = require('path');

const read = (rel) =>
  fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .split('\r\n')
    .join('\n');

/** 두 표지 사이를 자른다 — 표지가 사라지면 빈 문자열로 거짓 통과하지 않고 바로 실패한다 */
function between(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error('표지를 찾지 못함: ' + start);
  const b = src.indexOf(end, a + start.length);
  if (b < 0) throw new Error('표지를 찾지 못함: ' + end);
  return src.slice(a, b);
}

const HTML = read('admin/consultations.html');
const API = 'https://wf.test';
const TOKEN = 'admin-access-token';
const HQ = 'hq-company-id';
const ROW = {
  id: 'c1',
  name: '고객',
  email: 'a@example.test',
  status: 'pending',
  created_at: '2026-10-20T00:00:00Z',
};

/** 어떤 메서드를 이어 불러도 자기를 돌려주고, await 하면 정해 둔 결과를 내는 가짜 쿼리. 부른 차례를 남긴다. */
function query(result, calls) {
  const q = {};
  for (const m of ['select', 'order', 'limit', 'eq', 'in', 'update', 'single', 'maybeSingle']) {
    q[m] = (...args) => {
      calls.push([m, ...args]);
      return q;
    };
  }
  q.then = (ok, ng) => Promise.resolve(result).then(ok, ng);
  return q;
}

/**
 * 페이지 스크립트를 올린다. events 에는 from() · fetch 를 부른 차례가 쌓인다.
 *   fetchImpl: 가짜 fetch, updateResult: consultations 고치기 결과, workflowUrl: 업무 서버 주소 ('' 면 없음)
 */
function boot({ fetchImpl, updateResult = { data: null, error: null }, workflowUrl = API } = {}) {
  const script = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  document.body.innerHTML = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n'));
  window.DADAM_CONFIG = {
    supabase: { url: 'https://sb.test', anonKey: 'k' },
    workflowApi: { url: workflowUrl },
  };
  window.AdminAccess = { isAdmin: async () => true };
  const session = {
    access_token: TOKEN,
    user: { id: 'admin-id', email: 'admin@example.test', user_metadata: {} },
  };
  const events = [];
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }) },
      from: (table) => {
        const entry = { kind: 'db', table, calls: [] };
        events.push(entry);
        let result = { data: [], error: null };
        if (table === 'companies') result = { data: { id: HQ }, error: null };
        if (table === 'consultations') result = { data: [ROW], error: null };
        const q = query(result, entry.calls);
        // 고치기는 따로 정한 결과를 낸다
        const update = q.update;
        q.update = (...args) => {
          update(...args);
          q.then = (ok, ng) => Promise.resolve(updateResult).then(ok, ng);
          return q;
        };
        return q;
      },
    }),
  };
  const fetchMock = jest.fn(async (url, init) => {
    events.push({ kind: 'fetch', url, init });
    return fetchImpl(url, init);
  });
  window.fetch = fetchMock;
  global.fetch = fetchMock;
  window.alert = jest.fn();
  (0, eval)(script);
  return { events, fetchMock };
}

const ok = (data) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
const fail = (status, message) => ({
  ok: false,
  status,
  json: async () => ({ success: false, message }),
});

const consultationUpdates = (events) =>
  events
    .filter((e) => e.kind === 'db' && e.table === 'consultations')
    .map((e) => e.calls.find((c) => c[0] === 'update'))
    .filter(Boolean)
    .map((c) => c[1]);

async function confirmWith(env, { when = '2026-11-03T14:00', memo = '주차는 지하 2층' } = {}) {
  await window.initAdmin();
  window.openConfirmModal('c1');
  document.getElementById('confirmedDateTime').value = when;
  document.getElementById('confirmMemo').value = memo;
  await window.confirmConsultation();
  return env;
}

describe('admin/consultations.html — 일정 확정은 업무 서버 accept 로', () => {
  test('관리자 토큰으로 POST /consultations/:id/accept { confirmed_at } 를 부른다', async () => {
    const env = boot({ fetchImpl: async () => ok({ consultation_id: 'c1' }) });
    await confirmWith(env);
    expect(env.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = env.fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/consultations/c1/accept`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      confirmed_at: new Date('2026-11-03T14:00').toISOString(),
    });
    expect(window.alert).toHaveBeenCalledWith('상담 일정이 확정되었습니다.');
    expect(document.getElementById('confirmModal').classList.contains('active')).toBe(false);
  });

  test('화면은 status · confirmed_at · 연결 칸을 직접 고치지 않는다 — 메모 · 담당자만, 서버가 성공한 뒤에', async () => {
    const env = boot({ fetchImpl: async () => ok({ consultation_id: 'c1' }) });
    await confirmWith(env);
    const updates = consultationUpdates(env.events);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      admin_memo: '주차는 지하 2층',
      assigned_to: 'admin-id',
      updated_at: expect.any(String),
    });
    for (const key of ['status', 'confirmed_at', 'customer_id', 'project_id']) {
      expect(updates[0]).not.toHaveProperty(key);
    }
    const fetchAt = env.events.findIndex((e) => e.kind === 'fetch');
    const updateAt = env.events.findIndex(
      (e) =>
        e.kind === 'db' && e.table === 'consultations' && e.calls.some((c) => c[0] === 'update')
    );
    expect(fetchAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(fetchAt);
    const updateEntry = env.events[updateAt];
    expect(updateEntry.calls).toContainEqual(['eq', 'id', 'c1']);
  });

  test('서버가 거절하면 기존 오류 알림을 띄우고 행을 건드리지 않는다', async () => {
    const env = boot({
      fetchImpl: async () => fail(409, '대기 · 확정 상담만 일정을 확정할 수 있습니다'),
    });
    await confirmWith(env);
    expect(window.alert).toHaveBeenCalledWith('오류: 대기 · 확정 상담만 일정을 확정할 수 있습니다');
    expect(consultationUpdates(env.events)).toHaveLength(0);
    expect(document.getElementById('confirmModal').classList.contains('active')).toBe(true);
  });

  test('네트워크 오류도 같은 알림, 행은 그대로', async () => {
    const env = boot({
      fetchImpl: async () => {
        throw new Error('Failed to fetch');
      },
    });
    await confirmWith(env);
    expect(window.alert).toHaveBeenCalledWith('오류: Failed to fetch');
    expect(consultationUpdates(env.events)).toHaveLength(0);
  });

  test('업무 서버 주소가 없으면 부르지 않고 오류 알림, 행은 그대로', async () => {
    const env = boot({ fetchImpl: async () => ok({}), workflowUrl: '' });
    await confirmWith(env);
    expect(env.fetchMock).not.toHaveBeenCalled();
    expect(window.alert.mock.calls[0][0]).toMatch(/^오류: /);
    expect(consultationUpdates(env.events)).toHaveLength(0);
  });

  test('확정 일시를 고르지 않으면 서버를 부르지 않는다', async () => {
    const env = boot({ fetchImpl: async () => ok({}) });
    await confirmWith(env, { when: '' });
    expect(env.fetchMock).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('확정 일시를 선택해주세요.');
  });

  test('메모 저장이 실패하면 일정은 확정됐다고 알린다 (서버 확정은 이미 끝남)', async () => {
    const env = boot({
      fetchImpl: async () => ok({ consultation_id: 'c1' }),
      updateResult: { data: null, error: { message: 'permission denied' } },
    });
    await confirmWith(env);
    expect(env.fetchMock).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalledWith(
      '일정은 확정되었지만 메모 저장 중 오류: permission denied'
    );
  });

  test('소스 — confirmConsultation 에 status 를 직접 고치는 코드가 없다, 완료 · 취소는 그대로', () => {
    const fn = between(
      HTML,
      'async function confirmConsultation()',
      'async function completeConsultation()'
    );
    expect(fn).not.toMatch(/status:\s*'confirmed'/);
    expect(fn).not.toMatch(/confirmed_at:\s*dateTime/);
    expect(fn).toMatch(/acceptConsultation\(id, new Date\(dateTime\)\.toISOString\(\)\)/);
    const others = between(
      HTML,
      'async function completeConsultation()',
      '// 모달 외부 클릭 시 닫기'
    );
    expect(others).toMatch(/status:\s*'completed'/);
    expect(others).toMatch(/status:\s*'cancelled'/);
  });
});
