/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, HashChangeEvent */
/**
 * SEGAN 「관리 › 새 업체 신청」 (segan/admin-applications.js + segan/admin.html#applications)
 *
 *   들어오기  관리 › 오늘 할 일 「새 업체 신청」 줄 = #applications. 「‹ 관리」로 돌아오면 수를 다시 읽는다
 *   서버      account-api GET /admin/partner/applications?status=applied,meeting ·
 *             POST /admin/partner/applications/:id { action: meeting, meeting_at } | { action: approve | hold }
 *   화면      열린 신청 카드 — PC admin/expert-requests.html 과 같은 일 · 같은 되묻는 글, 되묻기는 화면 안에서
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'admin-1', email: 'admin@example.com' } };
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const LIST = ACC + '/admin/partner/applications?status=applied,meeting';
const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';

const ok = (data) => ({ ok: true, status: 200, body: { success: true, data } });
const fail = (status, error) => ({ ok: false, status, body: { success: false, error } });
const app = (id, extra = {}) => ({
  id,
  user_id: 'u-' + id.slice(0, 4),
  company_id: null,
  kind: 'new',
  plan: 'agent',
  status: 'applied',
  company_name: '가나 인테리어',
  representative_name: '김대표',
  contact_phone: '010-1111-2222',
  sido: '대구광역시',
  gugun: '북구',
  business_number: '123-45-67890',
  intro: '싱크대 · 붙박이장 시공',
  meeting_at: null,
  created_at: '2026-10-30T01:00:00Z', // 한국 시간 10:00
  email: 'kim@example.test',
  ...extra,
});

/** admin.html#applications 를 올린다. opts.list() → 목록 응답, opts.decide(id, body) → POST 응답 */
async function load(options = {}) {
  const opts = {
    hash: '#applications',
    list: () =>
      ok([
        app(A1),
        app(A2, {
          kind: 'upgrade',
          status: 'meeting',
          company_name: '다라 가구',
          meeting_at: '2026-11-03T05:30:00Z',
        }),
        app('not-a-uuid'),
        app('33333333-3333-4333-8333-333333333333', { status: 'held' }),
      ]),
    decide: () => ok({ application: {} }),
    ...options,
  };
  window.history.replaceState(null, '', '/segan/admin.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/admin.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of ['AdminAccess', 'SeganShell', 'SeganAdmin', 'SeganAdminApplications'])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: SESSION } }) },
      rpc: async (name) => ({ data: name === 'is_admin', error: null }),
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.fetch.push({ url, method, body, auth: (init.headers || {}).Authorization });
    let r;
    if (url === LIST) r = await opts.list();
    else if (url.startsWith(ACC + '/admin/partner/applications/') && method === 'POST')
      r = await opts.decide(decodeURIComponent(url.split('/').pop()), body);
    else if (url === WORK + '/admin/consult-inbox?state=pending') r = ok({ items: [] });
    else if (url === WORK + '/admin/consult-inbox?state=assigned') r = ok({ items: [] });
    else if (url === WORK + '/reports/summary') r = ok({ pendingProposals: 0 });
    else r = fail(404, 'x');
    if (r instanceof Error) throw r;
    return { ok: r.ok, status: r.status, json: async () => r.body };
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of ['segan/shell.js', 'segan/admin-applications.js', 'segan/admin.js'])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganAdmin.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const card = (id) => document.querySelector(`[data-app="${id}"]`);
const click = async (id, act) => {
  card(id).querySelector(`[data-act="${act}"]`).click();
  await flush();
};
const facts = (id) =>
  [...card(id).querySelectorAll('.me-facts div')].map((d) => [
    d.querySelector('dt').textContent,
    d.querySelector('dd').textContent,
  ]);

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('들어오기', () => {
  test('오늘 할 일의 「새 업체 신청」 줄은 #applications, 열면 첫 화면을 감춘다', async () => {
    await load({ hash: '' });
    expect(document.querySelector('[data-today="applications"] a').getAttribute('href')).toBe(
      '#applications'
    );
    expect($('adApplications').hidden).toBe(true);
    window.history.replaceState(null, '', '/segan/admin.html#applications');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await window.SeganAdmin.routed;
    expect($('adApplications').hidden).toBe(false);
    expect($('adToday').hidden).toBe(true);
    expect($('adPc').hidden).toBe(true);
  });

  test('「‹ 관리」로 돌아오면 첫 화면 · 수를 다시 읽는다', async () => {
    const calls = await load();
    expect(document.querySelector('#adApplications a.mk-back').getAttribute('href')).toBe('#');
    const before = calls.fetch.filter((f) => f.url === LIST).length;
    window.history.replaceState(null, '', '/segan/admin.html');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await window.SeganAdmin.routed;
    expect($('adApplications').hidden).toBe(true);
    expect($('adToday').hidden).toBe(false);
    expect(calls.fetch.filter((f) => f.url === LIST).length).toBe(before + 1);
  });
});

describe('목록', () => {
  test('열린 신청만 (uuid · 신청 접수 · 미팅 예정), 카드 칸 · 한국 시간 · 전화 링크 · 단추', async () => {
    const calls = await load();
    expect(calls.fetch.find((f) => f.url === LIST).auth).toBe('Bearer tok-1');
    const ids = [...document.querySelectorAll('[data-app]')].map((li) =>
      li.getAttribute('data-app')
    );
    expect(ids).toEqual([A1, A2]);
    expect(card(A1).querySelector('b').textContent).toBe('가나 인테리어');
    expect(card(A1).querySelector('small').textContent).toBe('새 업체 · 신청 접수');
    expect(card(A2).querySelector('small').textContent).toBe('Expert→Agent · 미팅 예정');
    expect(facts(A1)).toEqual([
      ['대표자', '김대표'],
      ['연락처', '010-1111-2222'],
      ['지역', '대구광역시 북구'],
      ['사업자 번호', '123-45-67890'],
      ['이메일', 'kim@example.test'],
      ['신청일', '2026.10.30 10:00'],
      ['하는 일', '싱크대 · 붙박이장 시공'],
    ]);
    expect(facts(A2)).toContainEqual(['미팅', '2026.11.03 14:30']);
    expect(card(A1).querySelector('a[href="tel:01011112222"]')).not.toBeNull();
    const labels = (id) => [...card(id).querySelectorAll('[data-act]')].map((b) => b.textContent);
    expect(labels(A1)).toEqual(['미팅 잡기', '승인', '보류']);
    expect(labels(A2)).toEqual(['미팅 바꾸기', '승인', '보류']);
    expect(document.querySelector('.ad-more a').getAttribute('href')).toBe(
      '../admin/expert-requests.html'
    );
  });

  test('비면 안내, 못 읽으면 한 줄 안내', async () => {
    await load({ list: () => ok([]) });
    expect($('adApplicationsBody').textContent).toContain('열린 업체 신청이 없습니다.');
    await load({ list: () => fail(403, 'x') });
    expect($('adApplicationsBody').textContent).toContain('신청을 불러오지 못했습니다.');
  });

  test('상태 · 종류 이름 = PC admin/expert-requests.html', async () => {
    await load();
    const pc = read('admin/expert-requests.html');
    const P = window.SeganAdminApplications;
    for (const [k, v] of Object.entries(P.STATUS_LABEL)) expect(pc).toContain(`${k}: '${v}'`);
    expect(pc).toContain("const KIND_LABEL = { new: '새 업체', upgrade: 'Expert→Agent' };");
    expect(P.KIND_LABEL).toEqual({ new: '새 업체', upgrade: 'Expert→Agent' });
  });
});

describe('처리', () => {
  test('승인 — 화면 안에서 되묻고(PC 와 같은 글) 보낸 뒤 목록을 다시 읽어 알린다', async () => {
    let sent = null;
    const calls = await load({
      decide: (id, body) => {
        sent = [id, body];
        return ok({ application: {} });
      },
    });
    await click(A1, 'approve');
    expect(card(A1).querySelector('[data-panel="approve"] .mk-note').textContent).toBe(
      '가나 인테리어 — 승인하면 대표가 앱에서 카드를 등록하고 첫 달을 결제할 때 Agent 업체가 시작됩니다.'
    );
    expect(sent).toBeNull();
    await click(A1, 'approve-yes');
    expect(sent).toEqual([A1, { action: 'approve' }]);
    expect(calls.fetch.filter((f) => f.url === LIST)).toHaveLength(2);
    expect($('adApplicationsBody').querySelector('.me-pt-msg').textContent).toBe('승인했습니다.');
    // Expert→Agent 승인 글
    expect(
      window.SeganAdminApplications.decideText(
        app(A2, { kind: 'upgrade', company_name: '다라 가구' }),
        'approve'
      )
    ).toBe('다라 가구 — 승인하면 다음 결제일부터 Agent 금액 · 크레딧이 됩니다.');
  });

  test('보류 — 되묻고 보낸다, 취소하면 단추로 돌아간다', async () => {
    let sent = null;
    await load({
      decide: (id, body) => {
        sent = [id, body];
        return ok({ application: {} });
      },
    });
    await click(A2, 'hold');
    expect(card(A2).querySelector('.mk-note').textContent).toBe(
      '다라 가구 — 보류하면 이 신청은 닫힙니다. 신청자는 다시 신청할 수 있습니다.'
    );
    await click(A2, 'cancel');
    expect(card(A2).querySelector('[data-panel]')).toBeNull();
    await click(A2, 'hold');
    await click(A2, 'hold-yes');
    expect(sent).toEqual([A2, { action: 'hold' }]);
  });

  test('미팅 — 날짜 · 시각(한국 시간)을 UTC 로 보내고, 비우면 막는다 · 지금 미팅을 채운다', async () => {
    let sent = null;
    await load({
      decide: (id, body) => {
        sent = [id, body];
        return ok({ application: {} });
      },
    });
    await click(A2, 'meeting');
    const input = () => card(A2).querySelector('input[name="meeting_at"]');
    expect(input().value).toBe('2026-11-03T14:30');
    input().value = '';
    await click(A2, 'meeting-save');
    expect(sent).toBeNull();
    expect(card(A2).querySelector('[data-err]').textContent).toBe(
      '미팅 날짜와 시각을 골라 주세요.'
    );
    input().value = '2026-11-05T09:00';
    await click(A2, 'meeting-save');
    expect(sent).toEqual([A2, { action: 'meeting', meeting_at: '2026-11-05T00:00:00.000Z' }]);
    expect($('adApplicationsBody').querySelector('.me-pt-msg').textContent).toBe(
      '미팅을 잡았습니다 — 2026.11.05 09:00 (한국 시간)'
    );
  });

  test('서버가 막으면 서버 글을 그 카드에, 열어 둔 칸 · 적은 미팅 값은 남는다', async () => {
    await load({ decide: () => fail(409, '이미 처리된 신청입니다.') });
    await click(A2, 'meeting');
    card(A2).querySelector('input[name="meeting_at"]').value = '2026-11-05T09:00';
    await click(A2, 'meeting-save');
    expect(card(A2).querySelector('[data-err]').textContent).toBe('이미 처리된 신청입니다.');
    expect(card(A2).querySelector('input[name="meeting_at"]').value).toBe('2026-11-05T09:00');
  });
});
