/**
 * 관리자 「상담 분배」 (admin/consult-distribution.html).
 *   본사 상담 목록 GET /admin/consult-inbox?state=… → 상담을 고르면 GET /admin/consultations/:id/candidates
 *   → 1~3순위 · 점수 내역 · 걸러진 업체 → 「이 업체에 배정」(화면 안 확인) → POST /admin/consultations/:id/assign
 * 페이지 스크립트를 jsdom 에 올리고 업무 서버(workflow-api)는 가짜 fetch 로 대신한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
const HTML = read('admin/consult-distribution.html');
const SCRIPT = HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.lastIndexOf('<script>')).replace(
  /<script src="\.\.\/js\/admin-shell\.js(\?v=[\d.]+)?"><\/script>/,
  ''
);
const API = 'https://api.test';
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

const C1 = {
  id: 'c1',
  created_at: '2026-10-29T01:00:00Z',
  status: 'pending',
  name: '김고객',
  phone: '010-1111-2222',
  sido: '경기도',
  gugun: '성남시',
  furniture_categories: ['sink', 'wardrobe'],
  door_finish: 'highgloss',
  demolition_needed: true,
  wanted_price_tier: 'mid',
  preferred_date: '2026-11-20',
  preferred_time: '09:00-12:00',
  request_detail_design: true,
  quote_total: 4200000,
  has_generation: true,
  assignment: null,
  tried: [{ company_id: 'p9', company_name: '앞선가구', state: 'declined' }],
};
const C2 = {
  id: 'c2',
  created_at: '2026-10-29T02:00:00Z',
  status: 'assigned',
  name: '이고객',
  phone: '010-3333-4444',
  sido: '서울특별시',
  gugun: '강남구',
  furniture_categories: ['fridge'],
  door_finish: 'unknown',
  demolition_needed: false,
  wanted_price_tier: null,
  preferred_date: null,
  preferred_time: null,
  request_detail_design: false,
  quote_total: null,
  has_generation: false,
  assignment: {
    id: 'a1',
    company_id: 'p1',
    company_name: '한빛가구',
    state: 'assigned',
    assigned_at: '2026-10-29T03:00:00Z',
    expires_at: inHours(5.5),
  },
  tried: [],
};
const CANDS = {
  items: [
    {
      company_id: 'p1',
      company_name: '한빛가구',
      kind: 'partner',
      total: 82,
      rank: 1,
      score: {
        eval: { grade: 13, satisfaction: 9.6, rework: 6, response: 3, sum: 31.6 },
        fit: { item: 12, finish: 6, price: 2, timing: 6, design: 5, sum: 31 },
        location: { sum: 15, why: 'same_gugun' },
        other: { spread: 2.5, capacity: 2, sum: 4.5 },
      },
    },
    {
      company_id: 'f1',
      company_name: '다담 공장',
      kind: 'hq',
      total: 70,
      rank: 2,
      score: {
        eval: { grade: 13, satisfaction: 6, rework: 3, response: 3, sum: 25 },
        fit: { item: 12, finish: 6, price: 6, timing: 6, design: 5, sum: 35 },
        location: { sum: 5, why: 'other' },
        other: { spread: 5, capacity: 0, sum: 5 },
      },
    },
    {
      company_id: 'p2',
      company_name: '바른장',
      kind: 'partner',
      total: 61,
      rank: 3,
      score: {
        eval: { grade: 10, satisfaction: 6, rework: 3, response: 3, sum: 22 },
        fit: { item: 3, finish: 6, price: 6, timing: 3, design: 5, sum: 23 },
        location: { sum: 10, why: 'same_sido' },
        other: { spread: 3, capacity: 3, sum: 6 },
      },
    },
  ],
  filtered: [
    { company_id: 'p5', company_name: '먼가구', reasons: ['region', 'limit'] },
    { company_id: 'p6', company_name: '서류업체', reasons: ['docs', 'inactive', 'tier', 'item'] },
  ],
};

const ok = (data, status = 200) => ({ status, body: { success: true, data } });
const fail = (status, message, code) => ({ status, body: { success: false, message, code } });

/** 기본 서버 — 탭별 목록 · 후보 · 배정. over 로 경로마다 바꾼다 */
function defaultHandler(over = {}) {
  return (call) => {
    for (const [re, fn] of Object.entries(over)) {
      if (new RegExp(re).test(`${call.method} ${call.path}`)) return fn(call);
    }
    if (call.method === 'GET' && call.path.startsWith('/admin/consult-inbox')) {
      const st = new URL(`https://x${call.path}`).searchParams.get('state');
      const items = st === 'pending' ? [C1] : st === 'assigned' ? [C2] : [C1, C2];
      return ok({ items });
    }
    if (call.method === 'GET' && /\/candidates$/.test(call.path)) return ok(CANDS);
    if (call.method === 'POST' && /\/assign$/.test(call.path))
      return ok({ assignment_id: 'a9', copy_consultation_id: 'cc9' }, 201);
    return { status: 404, body: { success: false, message: 'Not found' } };
  };
}

function boot({ admin = true, handler = defaultHandler(), workflowUrl = API, hash = '' } = {}) {
  document.body.innerHTML = BODY;
  window.history.replaceState(null, '', `/admin/consult-distribution.html${hash}`);
  window.DADAM_CONFIG = {
    supabase: { url: 'https://sb', anonKey: 'k' },
    workflowApi: { url: workflowUrl },
  };
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'T', user: { email: 'a@b.c' } } },
        }),
      },
    }),
  };
  window.AdminAccess = { isAdmin: async () => admin };
  window.__CONSULT_DIST_NO_AUTOSTART = true;
  window.confirm = jest.fn(() => true);
  window.alert = jest.fn();
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    const call = {
      path: String(url).replace(API, ''),
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : null,
      auth: init.headers && init.headers.Authorization,
    };
    calls.push(call);
    const r = handler(call);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  });
  (0, eval)(SCRIPT);
  return calls;
}

const $ = (id) => document.getElementById(id);
const text = (sel) =>
  (document.querySelector(sel) || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
const infoMap = () =>
  Object.fromEntries(
    [...document.querySelectorAll('#customerCard dl.info > div')].map((d) => [
      d.querySelector('dt').textContent.trim(),
      d.querySelector('dd').textContent.replace(/\s+/g, ' ').trim(),
    ])
  );

async function start(opts) {
  const calls = boot(opts);
  await window.ConsultDistribution.init();
  await settle();
  return calls;
}
async function pick(id) {
  document.querySelector(`#inboxList button[data-id="${id}"]`).click();
  await settle();
}

describe('들어오기 · 목록', () => {
  test('관리자가 아니면 막고 서버를 부르지 않는다', async () => {
    const calls = await start({ admin: false });
    expect($('accessDenied').style.display).toBe('block');
    expect(calls).toHaveLength(0);
  });

  test('처음엔 「대기」 — 관리자 토큰으로 GET /admin/consult-inbox?state=pending', async () => {
    const calls = await start();
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/admin/consult-inbox?state=pending',
      auth: 'Bearer T',
    });
    const items = [...document.querySelectorAll('#inboxList .consult-item')];
    expect(items).toHaveLength(1);
    const t = items[0].textContent.replace(/\s+/g, ' ');
    expect(t).toContain('김고객');
    expect(t).toContain('대기');
    expect(t).toContain('경기도 성남시 · 싱크대 · 붙박이장');
    expect(t).toContain('010-1111-2222');
    expect(t).toContain('거친 업체 1');
    expect($('statusLine').textContent).toBe('1건');
    expect($('detailBody').hidden).toBe(true);
  });

  test('탭 대기 · 배정됨 · 전체 → state=pending|assigned|all', async () => {
    const calls = await start();
    document.querySelector('#tabs [data-state="assigned"]').click();
    await settle();
    expect(calls[calls.length - 1].path).toBe('/admin/consult-inbox?state=assigned');
    expect(
      document.querySelector('#tabs [data-state="assigned"]').getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      document.querySelector('#tabs [data-state="pending"]').getAttribute('aria-pressed')
    ).toBe('false');
    document.querySelector('#tabs [data-state="all"]').click();
    await settle();
    expect(calls[calls.length - 1].path).toBe('/admin/consult-inbox?state=all');
    expect(document.querySelectorAll('#inboxList .consult-item')).toHaveLength(2);
  });

  test('비면 탭에 맞는 한 줄', async () => {
    await start({
      handler: defaultHandler({ '^GET /admin/consult-inbox': () => ok({ items: [] }) }),
    });
    expect($('statusLine').textContent).toBe('기다리는 상담이 없습니다.');
    expect($('inboxList').textContent).toContain('없음');
  });

  test('업무 서버 주소가 없으면 부르지 않고 안내', async () => {
    const calls = await start({ workflowUrl: '' });
    expect(calls).toHaveLength(0);
    expect($('statusLine').textContent).toContain('workflowApi.url');
  });
});

describe('상담 고르기 — 고객 · 배정 · 순위', () => {
  test('고객 칸: 이름 · 전화 · 지역 · 품목 · 도어 마감 · 철거 · 원하는 가격대 · 희망 시기 · 상세 설계 · 예상 견적', async () => {
    const calls = await start();
    await pick('c1');
    expect(calls.find((c) => /candidates$/.test(c.path)).path).toBe(
      '/admin/consultations/c1/candidates'
    );
    expect(text('#customerCard h3')).toContain('김고객');
    expect(infoMap()).toMatchObject({
      전화: '010-1111-2222',
      지역: '경기도 성남시',
      품목: '싱크대붙박이장',
      '도어 마감': '하이그로시',
      철거: '필요',
      '원하는 가격대': '중급',
      '희망 시기': '2026-11-20 오전',
      '상세 설계': '요청함',
      '예상 견적': '4,200,000원',
      연출컷: '있음',
    });
    expect(
      document.querySelector('#inboxList button[data-id="c1"]').classList.contains('active')
    ).toBe(true);
  });

  test('배정 칸: 지금 배정 없음 · 거친 업체와 결과', async () => {
    await start();
    await pick('c1');
    expect(text('#assignCard')).toContain('지금 배정 없음');
    expect(text('#assignCard')).toContain('앞선가구 · 못 받음');
  });

  test('1~3순위 카드 — 총점 · 본사 평가 40 · 선택 적합도 35 · 위치 15 · 기타 10 과 세부 항목', async () => {
    await start();
    await pick('c1');
    const cards = [...document.querySelectorAll('#candidates .cand')];
    expect(cards).toHaveLength(3);
    const c = cards[0];
    expect(c.querySelector('.rank').textContent).toBe('1순위');
    expect(c.querySelector('.cand-name').textContent).toBe('한빛가구');
    expect(c.querySelector('.kind-chip').textContent).toBe('Agent');
    expect(c.querySelector('.total').textContent.replace(/\s+/g, '')).toBe('82점');
    // 묶음 이름 | 묶음 점수/만점 | 세부 항목
    const g = (k) => {
      const sg = c.querySelector(`.sg[data-group="${k}"]`);
      const top = [...sg.querySelectorAll('.sg-top span')].map((s) => s.textContent);
      return [...top, sg.querySelector('.sg-parts').textContent].join(' | ');
    };
    expect(g('eval')).toBe(
      '본사 평가 | 31.6/40 | 등급 13/16 · 고객 만족 9.6/12 · 재작업 6/6 · 응답 3/6'
    );
    expect(g('fit')).toBe(
      '선택 적합도 | 31/35 | 품목 실적 12/12 · 도어 마감 6/6 · 가격대 2/6 · 희망 시기 6/6 · 상세 설계 5/5'
    );
    expect(g('location')).toBe('위치 | 15/15 | 같은 시/군/구');
    expect(g('other')).toBe('기타 | 4.5/10 | 일감 고르게 2.5/5 · 처리 여유 2/5');
    expect(c.querySelector('.sg[data-group="eval"] .bar i').getAttribute('style')).toBe(
      'width:79%'
    );
    expect(cards[1].querySelector('.kind-chip').textContent).toBe('다담 공장');
    expect(cards[1].querySelector('.sg[data-group="location"] .sg-parts').textContent).toBe(
      '그 밖'
    );
    expect(cards[2].querySelector('.sg[data-group="location"] .sg-parts').textContent).toBe(
      '같은 시/도'
    );
    // 업체 평가 화면으로 가는 링크
    expect(c.querySelector('.cand-actions a').getAttribute('href')).toBe(
      'partner-eval.html#company=p1'
    );
  });

  test('본사 평가 등급 — 서버가 grade_letter 를 주면 글자를 붙인다 (점수는 그대로)', async () => {
    const withLetter = JSON.parse(JSON.stringify(CANDS));
    withLetter.items[0].score.eval.grade_letter = 'A';
    withLetter.items[1].score.eval.grade_letter = '<b>S</b>';
    await start({ handler: defaultHandler({ '/candidates$': () => ok(withLetter) }) });
    await pick('c1');
    const parts = [
      ...document.querySelectorAll('#candidates .sg[data-group="eval"] .sg-parts'),
    ].map((n) => n.textContent);
    expect(parts[0]).toBe('등급 A 13/16 · 고객 만족 9.6/12 · 재작업 6/6 · 응답 3/6');
    expect(parts[1]).toBe('등급 <b>S</b> 13/16 · 고객 만족 6/12 · 재작업 3/6 · 응답 3/6');
    expect(document.querySelector('#candidates .sg-parts b')).toBeNull();
    // grade_letter 가 없으면 예전처럼 점수만
    expect(parts[2]).toBe('등급 10/16 · 고객 만족 6/12 · 재작업 3/6 · 응답 3/6');
  });

  test('걸러진 업체 — 이유를 우리말로 (지역 밖 · 품목 안 함 · 한도 · 서류 미확인 · 자격 · 활동 안 함)', async () => {
    await start();
    await pick('c1');
    expect($('filteredCard').hidden).toBe(false);
    expect(text('#filteredCard summary')).toBe('걸러진 업체 2');
    const rows = [...document.querySelectorAll('#filteredCard .filtered li')].map((li) => [
      li.querySelector('span').textContent,
      [...li.querySelectorAll('.reason')].map((r) => r.textContent),
    ]);
    expect(rows).toEqual([
      ['먼가구', ['지역 밖', '한도']],
      ['서류업체', ['서류 미확인', '활동 안 함', '자격', '품목 안 함']],
    ]);
    expect(document.querySelector('#filteredCard .reason').getAttribute('title')).toContain(
      '상담 받는 지역'
    );
  });

  test('후보가 없으면 「남는 업체 없음 — 고객에게 직접 연락」', async () => {
    await start({
      handler: defaultHandler({
        '/candidates$': () => ok({ items: [], filtered: CANDS.filtered }),
      }),
    });
    await pick('c1');
    expect(document.querySelectorAll('#candidates .cand')).toHaveLength(0);
    expect(text('#candidates .no-cand')).toContain('남는 업체 없음 — 고객에게 직접 연락');
    expect(text('#candidates .no-cand')).toContain('010-1111-2222');
    expect($('filteredCard').hidden).toBe(false);
  });

  test('답을 기다리는 배정이 있으면 남은 시간을 보이고 배정 단추를 잠근다', async () => {
    await start();
    document.querySelector('#tabs [data-state="assigned"]').click();
    await settle();
    expect(text('#inboxList .consult-item')).toContain('한빛가구 5시간 30분 남음');
    await pick('c2');
    expect(text('#assignCard .assign-now')).toContain('한빛가구');
    expect(text('#assignCard .assign-now')).toContain('답 기다림');
    expect(text('#assignCard .assign-now')).toContain('5시간 30분 남음');
    expect(infoMap()).toMatchObject({
      '도어 마감': '모름',
      철거: '필요 없음',
      '원하는 가격대': '-',
      '희망 시기': '-',
      '상세 설계': '요청 안 함',
      '예상 견적': '-',
    });
    const btns = [...document.querySelectorAll('#candidates button[data-assign]')];
    expect(btns).toHaveLength(3);
    btns.forEach((b) => expect(b.disabled).toBe(true));
    expect($('candidates').textContent).toContain('답을 기다리는 배정이 있어');
  });

  test('남은 시간 글자', () => {
    boot();
    const { leftText } = window.ConsultDistribution;
    const now = Date.parse('2026-10-30T00:00:00Z');
    expect(leftText('2026-10-30T23:59:00Z', now)).toBe('23시간 59분 남음');
    expect(leftText('2026-10-30T00:45:00Z', now)).toBe('45분 남음');
    expect(leftText('2026-10-30T00:00:20Z', now)).toBe('1분 남음');
    expect(leftText('2026-10-29T23:00:00Z', now)).toBe('시간 지남');
    expect(leftText(null, now)).toBe('');
  });

  test('후보를 읽는 사이 다른 상담을 고르면 늦게 온 답은 버린다', async () => {
    let release;
    const slow = new Promise((r) => {
      release = r;
    });
    await start({
      handler: defaultHandler({
        '^GET /admin/consult-inbox': () =>
          ok({ items: [C1, { ...C2, status: 'pending', assignment: null }] }),
        'c1/candidates$': () => ok(CANDS),
        'c2/candidates$': () => ok({ items: [], filtered: [] }),
      }),
    });
    // 첫 답을 늦추려고 fetch 를 한 번 감싼다
    const inner = global.fetch;
    global.fetch = jest.fn(async (url, init) => {
      const res = await inner(url, init);
      if (/c1\/candidates$/.test(String(url))) await slow;
      return res;
    });
    document.querySelector('#inboxList button[data-id="c1"]').click();
    await settle();
    await pick('c2');
    release();
    await settle();
    expect(text('#customerCard h3')).toContain('이고객');
    expect(document.querySelectorAll('#candidates .cand')).toHaveLength(0);
    expect(text('#candidates')).toContain('남는 업체 없음');
  });
});

describe('배정 — 화면 안에서 묻고 POST', () => {
  test('누르면 화면 안 확인 창, window.confirm 은 쓰지 않는다 · 그만두면 부르지 않는다', async () => {
    const calls = await start();
    await pick('c1');
    document.querySelector('#candidates button[data-assign="p1"]').click();
    expect($('assignModal').classList.contains('active')).toBe(true);
    expect($('assignText').textContent).toBe('김고객 상담을 「한빛가구」에 배정할까요?');
    expect(window.confirm).not.toHaveBeenCalled();
    $('assignCancel').click();
    await settle();
    expect($('assignModal').classList.contains('active')).toBe(false);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  test('배정 → POST /admin/consultations/c1/assign { company_id } 뒤 목록을 다시 읽는다', async () => {
    let assigned = false;
    const calls = await start({
      handler: defaultHandler({
        '^GET /admin/consult-inbox': () => ok({ items: assigned ? [] : [C1] }),
        '^POST .*/assign$': () => {
          assigned = true;
          return ok({ assignment_id: 'a9', copy_consultation_id: 'cc9' }, 201);
        },
      }),
    });
    await pick('c1');
    document.querySelector('#candidates button[data-assign="f1"]').click();
    $('assignOk').click();
    await settle();
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toMatchObject({
      path: '/admin/consultations/c1/assign',
      body: { company_id: 'f1' },
      auth: 'Bearer T',
    });
    expect(calls.filter((c) => c.path.startsWith('/admin/consult-inbox'))).toHaveLength(2);
    expect($('assignModal').classList.contains('active')).toBe(false);
    expect($('statusLine').textContent).toBe(
      '「다담 공장」에 배정했습니다. 업체가 24시간 안에 답합니다.'
    );
    // 대기 목록에서 빠지면 상세도 닫힌다
    expect($('detailBody').hidden).toBe(true);
  });

  test('409 open_assignment — 이미 기다리는 배정, 목록을 다시 읽는다', async () => {
    const calls = await start({
      handler: defaultHandler({
        '^POST .*/assign$': () => fail(409, '이미 기다리는 배정이 있습니다', 'open_assignment'),
      }),
    });
    await pick('c1');
    document.querySelector('#candidates button[data-assign="p1"]').click();
    $('assignOk').click();
    await settle();
    expect($('assignModal').classList.contains('active')).toBe(false);
    expect($('statusLine').textContent).toBe(
      '이미 답을 기다리는 배정이 있습니다. 목록을 다시 불러왔습니다.'
    );
    expect(calls.filter((c) => c.path.startsWith('/admin/consult-inbox'))).toHaveLength(2);
  });

  test('422 not_eligible — 거르기에 걸림, 순위를 다시 읽는다', async () => {
    const calls = await start({
      handler: defaultHandler({
        '^POST .*/assign$': () => fail(422, '배정 조건에 맞지 않습니다', 'not_eligible'),
      }),
    });
    await pick('c1');
    document.querySelector('#candidates button[data-assign="p2"]').click();
    $('assignOk').click();
    await settle();
    expect(calls.filter((c) => /candidates$/.test(c.path))).toHaveLength(2);
    expect($('candStatus').textContent).toBe(
      '「바른장」은 지금 배정 조건에 맞지 않습니다. 순위를 다시 불러왔습니다.'
    );
    expect($('assignModal').classList.contains('active')).toBe(false);
  });

  test('그 밖의 오류는 확인 창에 그대로 두고 알린다', async () => {
    await start({
      handler: defaultHandler({ '^POST .*/assign$': () => fail(500, '잠시 뒤 다시 해 주세요') }),
    });
    await pick('c1');
    document.querySelector('#candidates button[data-assign="p1"]').click();
    $('assignOk').click();
    await settle();
    expect($('assignModal').classList.contains('active')).toBe(true);
    expect($('assignStatus').textContent).toBe('잠시 뒤 다시 해 주세요');
    expect($('assignOk').disabled).toBe(false);
  });
});

describe('서버가 아직 없을 때 · 오류', () => {
  test("라우터 404 'Not found' — 배포 안내만, 목록은 빈 채로", async () => {
    await start({
      handler: () => ({ status: 404, body: { success: false, message: 'Not found' } }),
    });
    expect($('setupNotice').hidden).toBe(false);
    expect($('setupNotice').textContent).toContain('아직 배포되지 않았습니다');
    expect($('statusLine').textContent).toBe('');
  });

  test('후보 경로가 아직 없으면 순위 칸에 배포 안내', async () => {
    await start({
      handler: defaultHandler({
        '/candidates$': () => ({ status: 404, body: { success: false, message: 'Not found' } }),
      }),
    });
    await pick('c1');
    expect($('candStatus').textContent).toContain('아직 배포되지 않았습니다');
  });

  test('다른 404 · 오류는 서버 글을 그대로', async () => {
    await start({
      handler: defaultHandler({ '/candidates$': () => fail(404, '상담을 찾을 수 없습니다') }),
    });
    await pick('c1');
    expect($('candStatus').textContent).toBe('상담을 찾을 수 없습니다');
    expect($('setupNotice').hidden).toBe(true);
  });

  test('응답이 JSON 이 아니면 상태 번호로', async () => {
    boot({ handler: () => ({ status: 502, body: null }) });
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('x');
      },
    }));
    await window.ConsultDistribution.init();
    await settle();
    expect($('statusLine').textContent).toBe('요청 실패 (502)');
  });
});

describe('넣는 값은 모두 esc', () => {
  test('고객 · 업체 이름 · 모르는 이유 키', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    await start({
      handler: defaultHandler({
        '^GET /admin/consult-inbox': () =>
          ok({
            items: [
              {
                ...C1,
                name: evil,
                phone: evil,
                furniture_categories: [evil],
                tried: [{ company_name: evil, state: evil }],
              },
            ],
          }),
        '/candidates$': () =>
          ok({
            items: [
              {
                ...CANDS.items[0],
                company_name: evil,
                company_id: '"><b>x</b>',
                score: { location: { sum: 5, why: evil } },
              },
            ],
            filtered: [{ company_id: 'z', company_name: evil, reasons: [evil] }],
          }),
      }),
    });
    await pick('c1');
    expect(document.querySelector('#pageContent img')).toBeNull();
    expect(
      [...document.querySelectorAll('#pageContent b')].some((n) => n.textContent === 'x')
    ).toBe(false);
    expect(text('#customerCard h3')).toContain(evil);
    expect(
      document.querySelector('#candidates button[data-assign]').getAttribute('data-assign')
    ).toBe('"><b>x</b>');
    expect(document.querySelector('#filteredCard .reason').textContent).toBe(evil);
  });
});

describe('#consult=<id> — 상담 관리에서 그 상담을 고른 채로', () => {
  test('대기 탭에 있으면 바로 고른다', async () => {
    const calls = await start({ hash: '#consult=c1' });
    expect(calls.map((c) => c.path)).toEqual([
      '/admin/consult-inbox?state=pending',
      '/admin/consultations/c1/candidates',
    ]);
    expect(
      document.querySelector('#inboxList button[data-id="c1"]').classList.contains('active')
    ).toBe(true);
    expect(text('#customerCard h3')).toContain('김고객');
  });

  test('대기 탭에 없으면 전체 탭으로 바꿔 찾는다 (#<id> 꼴도 받는다)', async () => {
    const calls = await start({ hash: '#c2' });
    expect(calls.map((c) => c.path)).toEqual([
      '/admin/consult-inbox?state=pending',
      '/admin/consult-inbox?state=all',
      '/admin/consultations/c2/candidates',
    ]);
    expect(document.querySelector('#tabs [data-state="all"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(text('#customerCard h3')).toContain('이고객');
  });

  test('어디에도 없으면 한 줄 알림, 서버가 아직 없으면 조용히', async () => {
    await start({ hash: '#consult=zz' });
    expect($('statusLine').textContent).toBe('고른 상담을 목록에서 찾지 못했습니다.');
    expect($('detailBody').hidden).toBe(true);
    const calls = await start({
      hash: '#consult=c1',
      handler: () => ({ status: 404, body: { success: false, message: 'Not found' } }),
    });
    expect(calls).toHaveLength(1);
    expect($('statusLine').textContent).toBe('');
    expect($('setupNotice').hidden).toBe(false);
  });
});

describe('소스 · 메뉴 · 상담 관리 안내', () => {
  test('대시보드 「상담 요청 확인」 빠른 작업은 상담 분배로', () => {
    const doc = new window.DOMParser().parseFromString(read('admin/index.html'), 'text/html');
    const quick = [...doc.querySelectorAll('a.quick-action-btn')].find(
      (a) => a.querySelector('h4').textContent === '상담 요청 확인'
    );
    expect(quick.getAttribute('href')).toBe('consult-distribution.html');
  });

  test('브라우저 확인 창(confirm · alert)을 쓰지 않는다', () => {
    expect(SCRIPT).not.toMatch(/\bconfirm\(/);
    expect(SCRIPT).not.toMatch(/\balert\(/);
  });

  test('관리자 메뉴에 「업체 평가」 · 「상담 분배」 — 상담 분배는 상담 관리 바로 앞', () => {
    document.body.innerHTML = '<ul class="nav-menu" id="adminNav"></ul>';
    window.history.replaceState(null, '', '/admin/consult-distribution.html');
    (0, eval)(read('js/admin-shell.js'));
    const links = [...document.querySelectorAll('#adminNav a')];
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs.indexOf('consultations.html')).toBe(
      hrefs.indexOf('consult-distribution.html') + 1
    );
    expect(hrefs).toContain('partner-eval.html');
    const active = links.find((a) => a.classList.contains('active'));
    expect(active.textContent).toBe('🔀상담 분배');
    expect(links.find((a) => a.getAttribute('href') === 'partner-eval.html').textContent).toBe(
      '🏅업체 평가'
    );
  });

  test('상담 관리 화면에 「새 상담은 상담 분배에서」 안내 · 링크', () => {
    const doc = new window.DOMParser().parseFromString(
      read('admin/consultations.html'),
      'text/html'
    );
    const notice = doc.getElementById('distNotice');
    expect(notice.querySelector('a').getAttribute('href')).toBe('consult-distribution.html');
    expect(notice.textContent.replace(/\s+/g, ' ').trim()).toBe(
      '새 상담은 상담 분배에서 업체에 나눕니다.'
    );
    // 공지는 머리말 바로 뒤, 기존 상태 탭 앞
    expect(notice.previousElementSibling.tagName).toBe('HEADER');
    expect(notice.nextElementSibling.className).toBe('stats-tabs');
  });
});
