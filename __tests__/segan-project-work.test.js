/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element */
/**
 * SEGAN 프로젝트의 「작업 배정」 칸 (segan/project-work.js — segan/partner-projects.js 의 프로젝트 줄 안)
 *
 *   2026-11-13 사장님 결정 — 한 길: 작업 종류 → 작업자 → 배정 → 승인(작업자 수락) → 연결. 프로젝트 한 화면에서.
 *   종류 줄: 철거 · 재단 · 엣지 · 조립(프로젝트에 붙는 작업) + 그 프로젝트의 설치 · A/S 일정
 *   누가      인사를 쓰는 팩토리(다담 공장 · Agent) 구성원이 보고, 서버가 can_manage · can_assign 이라고 한 사람만 바꾼다
 *   서버      GET|POST /company/projects/:id/work · PATCH …/work/:kind · POST …/work/invite ·
 *             POST /company/schedules/:id/workers · POST /company/work/assignments/:id/accept|revision|remove
 *   이름은 모두 지어낸 것이다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const CO = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222221';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '22222222-2222-4222-8222-222222222223';
const S1 = '55555555-5555-4555-8555-555555555551';
const NOW = Date.parse('2026-11-13T03:00:00Z'); // 한국 시간 2026-11-13 (금) 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });
const partnerOf = (plan, role = 'owner') =>
  ok({
    company: {
      id: CO,
      name: '다담 협력 주방',
      plan,
      next_plan: null,
      status: 'active',
      sido: '대구광역시',
      gugun: '북구',
      role,
      created_at: '2026-10-01T00:00:00Z',
    },
    application: null,
    members: [],
    invites: [],
  });
const project = (id, title, extra = {}) => ({
  id,
  title,
  status: 'active',
  created_at: '2026-11-01T00:00:00Z',
  closed_at: null,
  customer: { id: 'c-1', name: '시험고객', phone: null },
  design_count: 1,
  stage: 'make',
  order: { id: 'o-1', order_no: 'SO-1', status: 'in_production' },
  assignee: null,
  ...extra,
});
const PROJECTS = (manage = true) =>
  ok({
    company: { id: CO, name: '다담 협력 주방', kind: 'partner', plan: 'agent' },
    can_manage: manage,
    assignee_ready: true,
    members: [],
    items: [
      project(P1, '시험 주방'),
      project(P2, '시험 붙박이장'),
      project(P3, '끝난 프로젝트', { status: 'closed' }),
    ],
  });

const worker = (id, name, status, extra = {}) => ({
  assignment_id: id,
  name,
  status,
  reason: null,
  revision_count: 0,
  reports: [],
  ...extra,
});
const row = (kind, label, extra = {}) => ({
  key: 'kind:' + kind,
  kind,
  label,
  source: 'project',
  schedule_id: null,
  schedule_status: null,
  at: null,
  job: null,
  can_assign: true,
  workers: [],
  candidates: [],
  ...extra,
});
// 철거 = 빈 줄(후보 둘), 재단 = 수락 대기, 엣지 = 연결됨, 조립 = 빈 줄(후보 없음), 설치 = 일정 줄 · 완료 보고
const WORKVIEW = (extra = {}) => ({
  project: { id: P1, title: '시험 주방', status: 'active' },
  can_manage: true,
  can_assign: true,
  rows: [
    row('demolition', '철거', {
      candidates: [
        {
          link_id: 'lk-1',
          name: '시험기사 <b>가</b>',
          kinds: ['demolition'],
          region: '시험도 시험시',
        },
        { link_id: 'lk-2', name: '시험기사 나', kinds: ['demolition'], region: null },
      ],
    }),
    row('cutting', '재단', {
      at: '2026-11-19T00:00:00Z',
      job: { id: 'j-2', status: 'open' },
      workers: [worker('a-1', '시험기사 다', 'offered')],
    }),
    row('edge', '엣지', {
      at: '2026-11-19T00:00:00Z',
      job: { id: 'j-3', status: 'filled' },
      workers: [
        worker('a-2', '시험기사 다', 'confirmed'),
        worker('a-9', '시험기사 라', 'declined', { reason: '그날은 어렵습니다' }),
      ],
    }),
    row('assembly', '조립'),
    row('install', '설치', {
      key: 'schedule:' + S1,
      source: 'schedule',
      schedule_id: S1,
      schedule_status: 'scheduled',
      at: '2026-11-22T00:00:00Z',
      job: { id: 'j-5', status: 'review' },
      workers: [
        worker('a-3', '시험기사 마', 'submitted', {
          reports: [
            {
              kind: 'result',
              by: 'worker',
              body: '설치를 마쳤습니다',
              issue_chips: [],
              at: '2026-11-22T05:05:00Z',
            },
          ],
        }),
      ],
      candidates: [{ link_id: 'lk-5', name: '시험기사 바', kinds: ['install'], region: null }],
    }),
    { key: 'kind:paint', kind: 'paint', label: '도장' }, // 모르는 종류 — 뺀다
  ],
  ...extra,
});

async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: partnerOf('agent'),
    hash: '#dash-project',
    projects: () => PROJECTS(),
    work: () => ok(WORKVIEW()),
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/me.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  localStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerProjects',
    'SeganProjectWork',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) =>
        name === 'is_admin' ? { data: false, error: null } : { data: [], error: null },
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      cache: init.cache,
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (
      /\/company\/projects\/[^/]+\/work/.test(url) ||
      /\/company\/schedules\/[^/]+\/workers$/.test(url) ||
      url.startsWith(WORK + '/company/work/assignments/')
    )
      return reply(await opts.work(method, body, url));
    if (url === WORK + '/company/projects') return reply(opts.projects());
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/work/me') return reply(ok({ ready: true, worker: null }));
    return reply(fail(404, 'not_found', 'x'));
  });
  Element.prototype.scrollIntoView = jest.fn();
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/regions.js',
    'segan/partner.js',
    'segan/project-work.js',
    'segan/partner-projects.js',
    'segan/shell.js',
    'segan/make.js',
    'segan/me.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const press = async (el) => {
  el.click();
  await flush();
};
const projectRow = (id) => $('partnerProjects').querySelector(`li[data-project="${id}"]`);
const workBtn = (id) => projectRow(id).querySelector('[data-act="work"], [data-act="work-close"]');
const panel = () => $('partnerProjects').querySelector('.pjw');
const tableRows = () =>
  [...panel().querySelectorAll('.pjw-table tbody tr')].map((tr) =>
    [...tr.children].map(text).join(' | ')
  );
const openRow = (key) =>
  press(panel().querySelector(`[data-pjw-row="${key}"] [data-act="pw-open"]`));
const act = (name, attr = '') => panel().querySelector(`[data-act="${name}"]${attr}`);
const msg = () => text(panel().querySelector('[data-pjw="msg"]'));
const err = () => {
  const el = panel().querySelector('[data-pjw="err"]');
  return el && !el.hidden ? el.textContent : '';
};
const workCalls = (calls) =>
  calls.fetch
    .filter(
      (c) =>
        /\/work(\/|$)|\/workers$|\/assignments\//.test(c.url.slice(WORK.length)) &&
        c.url.startsWith(WORK + '/company/')
    )
    .map((c) => [c.method, c.url.slice(WORK.length), c.body]);
const mod = () => {
  delete window.SeganProjectWork;
  (0, eval)(read('segan/project-work.js'));
  return window.SeganProjectWork;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('자리 · 이름', () => {
  test('me.html — 스크립트는 me.js 앞 · 서비스 워커가 담는다 · 기기에 남기지 않는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((x) => x === name);
    expect(at('project-work.js')).toBeGreaterThanOrEqual(0);
    expect(at('project-work.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'project-work.js')");
    const code = read('segan/project-work.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification|document\.cookie/);
  });

  test('순수 — 누가 보나 · 날짜 · 본문 읽기 · 줄의 작업자 · 상태', () => {
    const W = mod();
    expect(W.canSee({ hq_member: true })).toBe(true);
    expect(W.canSee({ company: { plan: 'agent' } })).toBe(true);
    expect(W.canSee({ company: { plan: 'expert' } })).toBe(false);
    expect(W.canSee({ platform_member: true, hq_member: true })).toBe(false);
    expect([...W.PROJECT_KINDS].map((k) => W.KIND[k])).toEqual(['철거', '재단', '엣지', '조립']);
    expect(W.STATE.confirmed).toBe('연결됨'); // 작업자가 수락하면 연결
    expect(W.DAYS).toEqual([3, 7, 30]);

    expect(W.partsOf('2026-11-18T00:00:00Z')).toEqual({ day: '2026-11-18', time: '09:00' });
    expect(W.partsOf('2026-11-18T15:30:00Z')).toEqual({ day: '2026-11-19', time: '00:30' }); // 한국 시간으로 넘어간 날
    expect(W.partsOf('')).toBeNull();
    expect(W.whenText('2026-11-18T00:00:00Z')).toBe('11/18 (수) 09:00');
    expect(W.whenText(null)).toBe('');
    expect(W.atOf('2026-11-18', '09:00')).toEqual({ at: '2026-11-18T09:00:00+09:00' });
    expect(W.atOf('', '09:00')).toEqual({ error: 'date', message: '날짜를 골라 주세요.' });
    expect(W.atOf('2026-11-18', '')).toEqual({ error: 'time', message: '시각을 골라 주세요.' });
    expect(W.expiresIn(7, NOW)).toBe('2026-11-20T03:00:00.000Z');

    const d = W.dataOf(WORKVIEW());
    expect([d.manage, d.assign, d.rows.map((r) => r.key)]).toEqual([
      true,
      true,
      ['kind:demolition', 'kind:cutting', 'kind:edge', 'kind:assembly', 'schedule:' + S1],
    ]);
    expect(d.rows[4].schedule).toBe(S1);
    expect(d.rows.map((r) => W.namesOf(r))).toEqual([
      '',
      '시험기사 다',
      '시험기사 다',
      '',
      '시험기사 마',
    ]); // 거절한 사람은 뺀다
    expect(d.rows.map((r) => W.stateOf(r))).toEqual(['', '수락 대기', '연결됨', '', '완료 보고']);
    expect(
      W.stateOf({
        workers: [
          { status: 'offered' },
          { status: 'confirmed' },
          { status: 'confirmed' },
          { status: 'removed' },
        ],
      })
    ).toBe('수락 대기 1 · 연결됨 2');
    expect(W.dataOf(WORKVIEW({ can_manage: false })).assign).toBe(false);
    expect(W.dataOf({ rows: null })).toBeNull();
    expect(W.dataOf(null)).toBeNull();
  });
});

describe('작업 배정 — 대표 · 실장', () => {
  test('프로젝트 줄의 「작업 배정」 → 종류 줄 표. 설치 · A/S 일정이 없으면 그 안내 줄', async () => {
    const calls = await load();
    expect(text(workBtn(P1))).toBe('작업 배정');
    expect(workBtn(P3)).toBeNull(); // 끝난 프로젝트에는 없다
    expect(workCalls(calls)).toEqual([]); // 누르기 전에는 묻지 않는다
    await press(workBtn(P1));
    expect(workCalls(calls)).toEqual([['GET', `/company/projects/${P1}/work`, undefined]]);
    expect(calls.fetch.find((c) => c.url.endsWith('/work')).auth).toBe('Bearer tok-1');
    expect(text(workBtn(P1))).toBe('작업 배정 닫기');
    expect(panel().closest('li').getAttribute('data-project')).toBe(P1);
    expect(tableRows()).toEqual([
      '철거 | - | - | - | 고르기',
      '재단 | 시험기사 다 | 11/19 (목) 09:00 | 수락 대기 | 고르기',
      '엣지 | 시험기사 다 | 11/19 (목) 09:00 | 연결됨 | 고르기',
      '조립 | - | - | - | 고르기',
      '설치 | 시험기사 마 | 11/22 (일) 09:00 | 완료 보고 | 고르기',
      'A/S | A/S 방문일을 잡으면 줄이 생깁니다.',
    ]);
    expect(panel().textContent).not.toContain('도장');
    expect(panel().querySelector('a[href="work.html"]')).not.toBeNull(); // 작업자가 쓰는 화면으로 가는 줄

    // 다른 프로젝트를 열면 앞의 칸은 닫히고 새로 읽는다
    await press(workBtn(P2));
    expect($('partnerProjects').querySelectorAll('.pjw').length).toBe(1);
    expect(panel().closest('li').getAttribute('data-project')).toBe(P2);
    expect(workCalls(calls).pop()).toEqual(['GET', `/company/projects/${P2}/work`, undefined]);
    await press(workBtn(P2));
    expect(panel()).toBeNull();

    // 설치 일정이 없는 프로젝트
    await load({ work: () => ok(WORKVIEW({ rows: WORKVIEW().rows.slice(0, 4) })) });
    await press(workBtn(P1));
    expect(tableRows().slice(4)).toEqual([
      '설치 | 설치 일정을 넣으면 여기서 배정합니다 (프로젝트 관리 › 업무 달력).',
      'A/S | A/S 방문일을 잡으면 줄이 생깁니다.',
    ]);
  });

  test('종류 → 작업자 → 배정 — 고르기 전에는 누를 수 없다. 프로젝트 줄은 종류로, 날짜를 적어 두었으면 같이 보낸다', async () => {
    const calls = await load();
    await press(workBtn(P1));
    await openRow('kind:demolition');
    expect([...panel().querySelectorAll('[data-act="pw-pick"]')].map(text)).toEqual([
      '시험기사 <b>가</b> · 시험도 시험시',
      '시험기사 나',
    ]);
    expect(panel().querySelector('[data-act="pw-pick"] b')).toBeNull(); // 이름은 글자로만
    expect(panel().querySelectorAll('[data-act="pw-pick"][aria-pressed="true"]').length).toBe(0);
    expect(act('pw-assign').disabled).toBe(true);
    await press(act('pw-pick', '[data-id="lk-1"]'));
    await press(act('pw-pick', '[data-id="lk-2"]'));
    await press(act('pw-pick', '[data-id="lk-2"]')); // 다시 누르면 뺀다
    expect(act('pw-assign').disabled).toBe(false);
    // 날만 적고 시각이 비면 묻는다
    panel().querySelector('[name="pw-date"]').value = '2026-11-18';
    await press(act('pw-assign'));
    expect(err()).toBe('시각을 골라 주세요.');
    expect(workCalls(calls)).toHaveLength(1);
    panel().querySelector('[name="pw-time"]').value = '09:00';
    await press(act('pw-assign'));
    expect(workCalls(calls)[1]).toEqual([
      'POST',
      `/company/projects/${P1}/work`,
      { kind: 'demolition', link_ids: ['lk-1'], at: '2026-11-18T09:00:00+09:00' },
    ]);
    expect(workCalls(calls)[2]).toEqual(['GET', `/company/projects/${P1}/work`, undefined]); // 다시 읽는다
    expect(msg()).toBe('배정했습니다. 작업자가 수락하면 연결됩니다.');
  });

  test('설치 · A/S 줄은 일정에 배정한다 (날짜 칸 없음) · 확인 · 보완요청(사유 필수) · 빼기', async () => {
    const calls = await load();
    await press(workBtn(P1));
    await openRow('schedule:' + S1);
    expect(panel().querySelector('[name="pw-date"]')).toBeNull();
    expect(panel().textContent).toContain('날짜는 일정에서 고칩니다');
    expect(text(panel().querySelector('.sm-wk-row'))).toBe('시험기사 마완료 보고확인보완요청빼기');
    expect(text(panel().querySelector('.sm-wk-reports li'))).toBe(
      '작업자 · 완료 보고 · 11/22 (일) 14:05설치를 마쳤습니다'
    );
    await press(act('pw-pick', '[data-id="lk-5"]'));
    await press(act('pw-assign'));
    expect(workCalls(calls)[1]).toEqual([
      'POST',
      `/company/schedules/${S1}/workers`,
      { link_ids: ['lk-5'] },
    ]);

    await press(act('pw-accept'));
    expect(
      workCalls(calls)
        .filter((c) => c[0] === 'POST')
        .pop()
    ).toEqual(['POST', '/company/work/assignments/a-3/accept', {}]);
    expect(msg()).toBe('완료 보고를 확인했습니다.');

    await press(act('pw-revision'));
    const ask = () => panel().querySelector('[data-pjw="ask"]');
    expect(text(ask().querySelector('p'))).toBe(
      '시험기사 마 — 보완할 내용을 적어 주세요. 작업자에게 그대로 보입니다.'
    );
    expect(act('pw-assign')).toBeNull(); // 묻는 동안 다른 칸은 접는다
    await press(act('pw-yes'));
    expect(err()).toBe('사유를 적어 주세요.');
    panel().querySelector('[name="pw-reason"]').value = ' 걸레받이를 다시 봐 주세요 ';
    await press(act('pw-yes'));
    expect(
      workCalls(calls)
        .filter((c) => c[0] === 'POST')
        .pop()
    ).toEqual([
      'POST',
      '/company/work/assignments/a-3/revision',
      { reason: '걸레받이를 다시 봐 주세요' },
    ]);
    expect(msg()).toBe('보완을 요청했습니다.');

    await press(act('pw-remove'));
    await press(act('pw-no'));
    expect(ask()).toBeNull();
    await press(act('pw-remove'));
    panel().querySelector('[name="pw-reason"]').value = '일정이 바뀌었습니다';
    await press(act('pw-yes'));
    expect(
      workCalls(calls)
        .filter((c) => c[0] === 'POST')
        .pop()
    ).toEqual(['POST', '/company/work/assignments/a-3/remove', { reason: '일정이 바뀌었습니다' }]);
  });

  test('날짜 — 저장 · 지우기. 다른 줄로 옮기면 앞 줄에서 적던 날짜가 따라오지 않는다', async () => {
    const calls = await load();
    await press(workBtn(P1));
    await openRow('kind:cutting');
    expect([
      panel().querySelector('[name="pw-date"]').value,
      panel().querySelector('[name="pw-time"]').value,
    ]).toEqual(['2026-11-19', '09:00']);
    panel().querySelector('[name="pw-date"]').value = '2026-11-25';
    // 조립 줄(날짜 없음)로 옮긴다 — 빈 칸이어야 한다
    await openRow('kind:assembly');
    expect([
      panel().querySelector('[name="pw-date"]').value,
      panel().querySelector('[name="pw-time"]').value,
    ]).toEqual(['', '']);
    await press(act('pw-date'));
    expect(err()).toBe('날짜를 골라 주세요.');
    expect(workCalls(calls)).toHaveLength(1);
    expect(act('pw-date-clear')).toBeNull(); // 날짜가 없으면 지우기 단추도 없다
    panel().querySelector('[name="pw-date"]').value = '2026-11-20';
    panel().querySelector('[name="pw-time"]').value = '13:30';
    await press(act('pw-date'));
    expect(workCalls(calls)[1]).toEqual([
      'PATCH',
      `/company/projects/${P1}/work/assembly`,
      { at: '2026-11-20T13:30:00+09:00' },
    ]);
    expect(msg()).toBe('날짜를 저장했습니다.');
    await openRow('kind:cutting');
    await press(act('pw-date-clear'));
    expect(
      workCalls(calls)
        .filter((c) => c[0] === 'PATCH')
        .pop()
    ).toEqual(['PATCH', `/company/projects/${P1}/work/cutting`, { at: null }]);
  });

  test('새 작업자 초대 (이 일로 바로) — 만료를 골라야 만든다, 그 줄의 종류(설치는 일정까지)로. 링크 상자 + 복사', async () => {
    const made = (body) =>
      ok(
        {
          id: 'inv-1',
          url: 'https://dadamfurniture.com/segan/work.html#invite=TOKEN-ABCDEFGHIJKLMNOP',
          expires_at: body.expires_at,
        },
        201
      );
    const calls = await load({
      work: (method, body, url) => (url.endsWith('/work/invite') ? made(body) : ok(WORKVIEW())),
    });
    await press(workBtn(P1));
    await openRow('kind:assembly');
    expect(panel().textContent).toContain('이 종류로 연결된 작업자가 없습니다.');
    expect(panel().querySelectorAll('[data-act="pw-days"][aria-pressed="true"]').length).toBe(0);
    await press(act('pw-invite'));
    expect(err()).toBe('링크 만료를 골라 주세요.');
    await press(act('pw-days', '[data-days="7"]'));
    await press(act('pw-invite'));
    expect(workCalls(calls)[1]).toEqual([
      'POST',
      `/company/projects/${P1}/work/invite`,
      { kind: 'assembly', expires_at: '2026-11-20T03:00:00.000Z' },
    ]);
    const link = panel().querySelector('[name="pw-link"]');
    expect([link.value, link.readOnly]).toEqual([
      'https://dadamfurniture.com/segan/work.html#invite=TOKEN-ABCDEFGHIJKLMNOP',
      true,
    ]);
    expect(msg()).toBe('초대 링크를 만들었습니다.');
    const writeText = jest.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    await press(act('pw-copy'));
    expect(writeText).toHaveBeenCalledWith(link.value);
    expect(text(panel().querySelector('[data-pjw="copy"]'))).toBe(
      '복사했습니다. 메시지로 보내 주세요.'
    );
    // 다른 줄에는 그 링크 상자가 없다 · 설치 줄은 일정까지 보낸다
    await openRow('schedule:' + S1);
    expect(panel().querySelector('[name="pw-link"]')).toBeNull();
    await press(act('pw-days', '[data-days="3"]'));
    await press(act('pw-invite'));
    expect(
      workCalls(calls)
        .filter((c) => c[1].endsWith('/invite'))
        .pop()[2]
    ).toEqual({ kind: 'install', schedule_id: S1, expires_at: '2026-11-16T03:00:00.000Z' });
  });
});

describe('누가 무엇을', () => {
  test('직원 — 「작업자 보기」, 단추 없이 읽기만. 인사를 안 쓰는 등급 · 작업 분배 보기에는 단추가 없다', async () => {
    await load({
      partner: partnerOf('agent', 'staff'),
      projects: () => PROJECTS(false),
      work: () =>
        ok(
          WORKVIEW({
            can_manage: false,
            can_assign: false,
            rows: WORKVIEW().rows.map((r) => ({ ...r, can_assign: false })),
          })
        ),
    });
    expect(text(workBtn(P1))).toBe('작업자 보기');
    await press(workBtn(P1));
    expect(tableRows()[1]).toBe('재단 | 시험기사 다 | 11/19 (목) 09:00 | 수락 대기 | 보기');
    await openRow('schedule:' + S1);
    expect(panel().querySelectorAll('.pjw-detail [data-act]').length).toBe(0);
    expect(text(panel().querySelector('.sm-wk-row'))).toBe('시험기사 마완료 보고');
    expect(panel().textContent).toContain('배정은 대표 · 실장이 합니다.');

    for (const partner of [partnerOf('expert'), partnerOf('manager')]) {
      await load({ partner });
      expect(projectRow(P1).querySelector('[data-act="work"]')).toBeNull();
    }
    await load({ hash: '#assign' });
    expect(projectRow(P1).querySelector('[data-act="work"]')).toBeNull();
    await load({ partner: HQ });
    expect(text(workBtn(P1))).toBe('작업 배정'); // 다담 공장
  });

  test('못 읽으면(DB 적용 전 409 · 끊김) 그 글 · 서버가 막으면 그 글을 두고 다시 읽는다', async () => {
    await load({
      work: () =>
        fail(
          409,
          'db_pending',
          'DB 0065 적용 전입니다 — 철거 · 재단 · 엣지 작업과 프로젝트 작업 배정은 적용 뒤에 쓸 수 있습니다'
        ),
    });
    await press(workBtn(P1));
    expect(err()).toBe(
      'DB 0065 적용 전입니다 — 철거 · 재단 · 엣지 작업과 프로젝트 작업 배정은 적용 뒤에 쓸 수 있습니다'
    );
    expect(panel().querySelector('.pjw-table')).toBeNull();
    await load({ work: () => new Error('offline') });
    await press(workBtn(P1));
    expect(err()).toBe('작업 배정을 불러오지 못했습니다. 잠시 뒤 다시 해 주세요.');

    const calls = await load({
      work: (method) =>
        method === 'POST' ? fail(409, 'conflict', '이미 배정된 작업자입니다') : ok(WORKVIEW()),
    });
    await press(workBtn(P1));
    await openRow('kind:demolition');
    await press(act('pw-pick', '[data-id="lk-1"]'));
    await press(act('pw-assign'));
    expect(err()).toBe('이미 배정된 작업자입니다');
    expect(msg()).toBe('');
    expect(workCalls(calls).pop()[0]).toBe('GET');
  });
});

// ── 2026-11-13 업무 달력의 작업 줄에서 열기 (SeganPartnerProjects.openWork) ──
describe('달력에서 열기', () => {
  const PP = () => window.SeganPartnerProjects;

  test('그 프로젝트의 「작업 배정」 칸을 열고 그 줄로 옮긴다. 이미 열려 있으면 다시 묻지 않는다', async () => {
    const calls = await load();
    expect(PP().openWork(P2)).toBe(true);
    await flush();
    expect(workCalls(calls)).toEqual([['GET', `/company/projects/${P2}/work`, undefined]]);
    expect(panel().closest('li').getAttribute('data-project')).toBe(P2);
    expect(text(workBtn(P2))).toBe('작업 배정 닫기');
    expect(document.activeElement).toBe(workBtn(P2));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    // 다시 불러도 같은 칸 — 서버에 또 묻지 않는다
    expect(PP().openWork(P2)).toBe(true);
    await flush();
    expect(workCalls(calls)).toHaveLength(1);
    // 다른 프로젝트로 옮기면 앞 칸은 닫힌다
    expect(PP().openWork(P1)).toBe(true);
    await flush();
    expect(panel().closest('li').getAttribute('data-project')).toBe(P1);
    expect(text(workBtn(P2))).toBe('작업 배정');
  });

  test('열 수 없으면 false — 끝난 프로젝트 · 모르는 id · 인사를 안 쓰는 등급', async () => {
    const calls = await load();
    expect(PP().openWork(P3)).toBe(false); // 끝난 프로젝트에는 단추가 없다
    expect(PP().openWork('nope')).toBe(false);
    expect(PP().openWork('')).toBe(false);
    expect(panel()).toBeNull();
    expect(workCalls(calls)).toEqual([]);
    await load({ partner: partnerOf('expert') });
    expect(PP().openWork(P1)).toBe(false);
  });
});
