/**
 * 관리자 화면은 본사(다담) 행만, 마이페이지 「시공 완료 · 평가」는 내 설계만 읽는다.
 *
 * 회사 구성원 읽기 규칙이 생겨 RLS 만으로는 「본사 것」·「내 것」이 갈리지 않는다
 * (회사 구성원은 자기 회사의 상담 · 수주 · 설계를 모두 읽는다). 그래서 읽는 쪽이 직접 거른다.
 *   - admin/consultations.html, admin/index.html, mypage.html 의 관리자 통계:
 *       companies(kind='hq') 의 id 로 consultations 를 거른다. 그 id 를 못 읽으면 거르지 않은 채 읽지 않는다.
 *   - mypage.html loadMyProjects: 내 설계(designs.user_id) id 로 orders 를 거른다.
 * 관리자 두 화면은 페이지 스크립트를 jsdom 에 올리고 가짜 Supabase 로 돌린다. 마이페이지는 소스를 잘라 본다.
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

const HQ = 'hq-company-id';

/** 어떤 메서드를 이어 불러도 자기를 돌려주고, await 하면 정해 둔 결과를 내는 가짜 쿼리. 부른 차례를 남긴다. */
function query(result, calls) {
  const q = {};
  for (const m of ['select', 'order', 'limit', 'eq', 'in', 'update', 'single']) {
    q[m] = (...args) => {
      calls.push([m, ...args]);
      return q;
    };
  }
  q.then = (ok, ng) => Promise.resolve(result).then(ok, ng);
  return q;
}

/** 페이지 스크립트를 올린다. 돌려주는 log 에는 from() 마다 { table, calls } 가 쌓인다. */
function boot(html, tables) {
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script>\n'));
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  window.AdminAccess = { isAdmin: async () => true };
  const session = { user: { id: 'admin-id', email: 'admin@example.test', user_metadata: {} } };
  const log = [];
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }) },
      from: (table) => {
        const entry = { table, calls: [] };
        log.push(entry);
        const res = typeof tables[table] === 'function' ? tables[table]() : tables[table];
        return query(res || { data: [], error: null }, entry.calls);
      },
    }),
  };
  (0, eval)(script);
  return log;
}

const reads = (log, table) =>
  log.filter((e) => e.table === table && e.calls.some((c) => c[0] === 'select'));
const hasEq = (entry, col, val) =>
  entry.calls.some((c) => c[0] === 'eq' && c[1] === col && c[2] === val);

const HQ_OK = { data: { id: HQ }, error: null };
const HQ_FAIL = { data: null, error: { message: '본사 회사를 읽지 못했습니다' } };
const ROW = {
  id: 'c1',
  name: '고객',
  email: 'a@example.test',
  status: 'pending',
  created_at: '2026-10-20T00:00:00Z',
};

describe('admin/consultations.html — 본사 상담만', () => {
  const HTML = read('admin/consultations.html');

  test('통계 · 목록 읽기가 모두 본사 company_id 로 걸러진다', async () => {
    const log = boot(HTML, { companies: HQ_OK, consultations: { data: [ROW], error: null } });
    await window.initAdmin();
    const companyReads = reads(log, 'companies');
    expect(companyReads).toHaveLength(1);
    expect(hasEq(companyReads[0], 'kind', 'hq')).toBe(true);
    const consult = reads(log, 'consultations');
    expect(consult.length).toBe(2); // loadStats + loadConsultations
    consult.forEach((e) => expect(hasEq(e, 'company_id', HQ)).toBe(true));
    expect(document.querySelectorAll('#consultationList .consultation-card')).toHaveLength(1);
  });

  test('본사 id 는 한 번만 읽는다 — 새로고침해도 다시 묻지 않는다', async () => {
    const log = boot(HTML, { companies: HQ_OK, consultations: { data: [ROW], error: null } });
    await window.initAdmin();
    await window.loadConsultations();
    expect(reads(log, 'companies')).toHaveLength(1);
    reads(log, 'consultations').forEach((e) => expect(hasEq(e, 'company_id', HQ)).toBe(true));
  });

  test('본사 id 를 못 읽으면 거르지 않은 목록을 내지 않고 오류 화면을 보인다', async () => {
    const log = boot(HTML, { companies: HQ_FAIL, consultations: { data: [ROW], error: null } });
    await window.initAdmin();
    expect(reads(log, 'consultations')).toHaveLength(0);
    const list = document.getElementById('consultationList');
    expect(list.querySelector('.consultation-card')).toBeNull();
    expect(list.textContent).toContain('데이터를 불러올 수 없습니다');
  });
});

describe('admin/index.html — 상담 통계는 본사 것만', () => {
  const HTML = read('admin/index.html');

  test('전체 · 대기 상담 수가 본사 company_id 로 걸러진다', async () => {
    const log = boot(HTML, { companies: HQ_OK, consultations: { data: [ROW, ROW], error: null } });
    await window.initAdmin();
    const consult = reads(log, 'consultations');
    expect(consult).toHaveLength(2);
    consult.forEach((e) => expect(hasEq(e, 'company_id', HQ)).toBe(true));
    expect(document.getElementById('totalConsultations').textContent).toBe('2');
  });

  test("본사 id 를 못 읽으면 상담을 세지 않고 '-' 로 둔다", async () => {
    const log = boot(HTML, {
      companies: HQ_FAIL,
      consultations: { data: [ROW, ROW], error: null },
    });
    await window.initAdmin();
    expect(reads(log, 'consultations')).toHaveLength(0);
    expect(document.getElementById('totalConsultations').textContent).toBe('-');
  });
});

describe('mypage.html', () => {
  const MYPAGE = read('mypage.html');

  test('관리자 통계 「상담 대기」는 본사 상담만 센다', () => {
    const fn = between(
      MYPAGE,
      'async function loadAdminStats()',
      'async function renderDetailDesignApprovalBanner('
    );
    const consult = between(fn, "from('consultations')", 'adminStatPendingConsult');
    expect(fn).toMatch(
      /\.from\('companies'\)\s*\.select\('id'\)\s*\.eq\('kind', 'hq'\)\s*\.single\(\)/
    );
    expect(fn).toMatch(/if \(hqError\) throw hqError;/);
    expect(consult).toMatch(/\.eq\('company_id', hq\.id\)/);
    expect(consult).toMatch(/\.eq\('status', 'pending'\)/);
    expect(fn.indexOf("from('companies')")).toBeLessThan(fn.indexOf("from('consultations')"));
  });

  test('시공 완료 · 평가는 내 설계의 수주만 읽는다', () => {
    const fn = between(MYPAGE, 'async function loadMyProjects()', 'function projectRowEl(');
    const designs = fn.indexOf(".from('designs').select('id').eq('user_id', currentUser.id)");
    const orders = fn.indexOf(".from('orders')");
    expect(designs).toBeGreaterThan(-1);
    expect(orders).toBeGreaterThan(designs);
    const ordersQuery = between(fn, ".from('orders')", '.limit(50)');
    expect(ordersQuery).toMatch(/\.in\('design_id', myDesignIds\)/);
    expect(ordersQuery).toMatch(/\.eq\('status', 'completed'\)/);
    // 내 설계가 없으면 수주를 묻지 않는다 (빈 목록 → 구역 숨김)
    expect(fn).toMatch(/if \(myDesignIds\.length\) \{/);
  });
});
