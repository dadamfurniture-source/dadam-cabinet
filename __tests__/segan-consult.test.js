/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, URL, setTimeout */
/**
 * SEGAN ④ 상담 신청 (segan/consult.html + segan/consult.js) + database/consultations-app.sql.
 *
 *   - 저장은 consultation.html 과 같은 길 (Supabase consultations insert) — 새 엔드포인트 없음
 *   - 고객이 적는 칸 / 저절로 채우는 칸 / 뺀 칸 (상담 종류 · 공간 · 치수 · 예산 · 스타일 · 희망 날짜)
 *   - 품목 칩 (여러 개, 필수 — consultation.html 가구 종류 키, 연출컷 품목 키가 같을 때만 미리 고름)
 *   - 상담받을 곳은 고르지 않는다 (모두 다담 본사 → 업체 배정). 시공 지역은 언제나 필수
 *   - 도어 마감 · 철거 · 가격대 (필수, 「모름」 있음), 동의 둘 — 수집 · 이용(필수) · 업체 제공(선택)
 *   - 시공 지역 목록 = signup.html, 연락 시간 값 = consultation.html
 *   - 보내는 칸은 consultation.html 이 쓰는 칸 + SQL 파일 · 0019 가 더하는 칸뿐
 *   - 새 칸이 없으면 신청서 대신 「아직 받을 수 없습니다」 + 전화
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const AuthRedirect = require('../js/auth-redirect.js');
const SQL = read('database/consultations-app.sql');
// 도어 마감 · 철거 · 가격대 · 업체 제공 동의 칸 — database/migrations/0019 (DB 쪽 PR) 가 더한다
const COLUMNS_0019 = [
  'door_finish',
  'demolition_needed',
  'wanted_price_tier',
  'third_party_agreed_at',
  'consent_version',
];
const MIGRATION_0019 = (() => {
  const dir = path.join(ROOT, 'database/migrations');
  const f = fs.readdirSync(dir).find((n) => /^0019_.*\.sql$/.test(n));
  return f ? read('database/migrations/' + f) : null;
})();
// 시공 완료 희망 날짜 칸 — database/migrations/0021 (DB 쪽 PR) 이 더한다
const COLUMNS_0021 = ['wanted_done_date'];
const MIGRATION_0021 = (() => {
  const dir = path.join(ROOT, 'database/migrations');
  const f = fs.readdirSync(dir).find((n) => /^0021_.*\.sql$/.test(n));
  return f ? read('database/migrations/' + f) : null;
})();
const ID = '11111111-2222-4333-8444-555555555555';
const API = 'https://gen.example.workers.dev/api/generate';
const SESSION = {
  access_token: 'tok-1',
  user: {
    id: 'user-1',
    email: 'customer@example.com',
    user_metadata: { name: '메타 이름', phone: '010-9999-0000' },
  },
};
/** 오늘(KST)에서 days 날 뒤 'YYYY-MM-DD' */
const kstDay = (days) =>
  new Date(Date.now() + 9 * 3600 * 1000 + days * 86400000).toISOString().slice(0, 10);
const QUOTE = { items: [{ name: '하부장 캐비닛', total: 1280000 }], total: 3128400 };
const GEN = {
  id: ID,
  status: 'done',
  category: 'sink',
  options: { design_style: 'modern-minimal', door_color: 'white' },
  images: [0, 1, 2, 3].map((i) => ({
    url: `https://example.supabase.co/sign/v${i}.png?token=t`,
    label: i ? '추천' : '싱크대 · 기본안',
  })),
  quote: QUOTE,
};

function res(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

async function load(options = {}) {
  const opts = {
    session: SESSION,
    url: `/segan/consult.html?g=${ID}`,
    profile: { name: '김고객', phone: '010-2222-3333', sido: '대구광역시', gugun: '북구' },
    columnsMissing: false,
    insertError: null,
    gen: GEN,
    ...options,
  };
  const doc = new DOMParser().parseFromString(read('segan/consult.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  window.history.replaceState(null, '', opts.url);
  sessionStorage.clear();
  for (const k of ['SeganShell', 'SeganMake', 'SeganRegions', 'SeganConsult']) delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    generateApi: { url: API },
  };
  const calls = { inserts: [], probes: [], fetch: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      from: (table) => {
        const chain = {
          select: (cols) => {
            if (table === 'consultations') calls.probes.push(cols);
            return chain;
          },
          eq: () => chain,
          limit: async () =>
            opts.columnsMissing
              ? {
                  data: null,
                  error: { message: 'column consultations.generation_id does not exist' },
                }
              : { data: [], error: null },
          maybeSingle: async () => ({
            data: table === 'profiles' ? opts.profile : null,
            error: null,
          }),
          insert: async (row) => {
            calls.inserts.push({ table, row });
            return { error: opts.insertError };
          },
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.fetch.push({ url, auth: (init.headers || {}).Authorization });
    if (url === `https://gen.example.workers.dev/api/generate/${ID}`) {
      return opts.gen
        ? res(200, { success: true, generation: opts.gen })
        : res(404, { success: false });
    }
    throw new Error('예상하지 못한 요청: ' + url);
  });
  for (const f of ['segan/shell.js', 'segan/make.js', 'segan/regions.js', 'segan/consult.js'])
    (0, eval)(read(f));
  await window.SeganConsult.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const visible = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
  return true;
};
const view = () =>
  [...document.querySelectorAll('[data-cs-view]')]
    .filter((e) => !e.hidden)
    .map((e) => e.getAttribute('data-cs-view'));
const flush = () => new Promise((r) => setTimeout(r, 0));
async function send() {
  $('csForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await flush();
}
function pick(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  el.checked = true;
  el.dispatchEvent(new window.Event('change'));
}
/** 필수로 고르는 칸 · 수집 동의 */
function fillRequired() {
  pick('doorFinish', 'highgloss');
  pick('demolition', 'yes');
  pick('priceTier', 'mid');
  $('csAgree').checked = true;
}
const radios = (name) =>
  [...document.querySelectorAll(`input[name="${name}"]`)].map((el) => [
    el.value,
    el.closest('label').textContent.trim(),
  ]);

afterEach(() => jest.restoreAllMocks());

describe('들어오기 전', () => {
  test('로그인 없음 — 로그인 후 이 페이지(연출컷 id 포함)로 돌아온다, 아무것도 묻지 않는다', async () => {
    const calls = await load({ session: null });
    expect(view()).toEqual(['signed-out']);
    const href = $('csLogin').getAttribute('href');
    const url = new URL(href, `https://dadamfurniture.com/segan/consult.html?g=${ID}`);
    expect(url.pathname).toBe('/login.html');
    expect(AuthRedirect.fromSearch(url.search)).toBe(`segan/consult.html?g=${ID}`);
    expect(calls.fetch).toEqual([]);
    expect(calls.probes).toEqual([]);
  });

  test('연출컷 id 가 없으면 — 만들기로 가는 길과 전화', async () => {
    await load({ url: '/segan/consult.html' });
    expect(view()).toEqual(['no-gen']);
    expect(visible($('csTelLine'))).toBe(true);
    expect($('csTelLine').querySelector('a').getAttribute('href')).toBe('tel:01077386822');
  });

  test('새 칸이 아직 없으면(SQL 적용 전) — 신청서 대신 「아직 받을 수 없습니다」 + 전화', async () => {
    const calls = await load({ columnsMissing: true });
    expect(view()).toEqual(['unavailable']);
    expect(calls.probes).toEqual([
      'generation_id,quote,sido,gugun,privacy_agreed_at,' +
        'door_finish,demolition_needed,wanted_price_tier,third_party_agreed_at,consent_version,wanted_done_date',
    ]);
    expect(visible($('csTelLine'))).toBe(true);
    expect(calls.inserts).toEqual([]);
  });

  test('연출컷을 못 찾으면 — 안내', async () => {
    await load({ gen: null });
    expect(view()).toEqual(['no-gen']);
    expect($('csNoGenTitle').textContent).toBe('연출컷을 찾지 못했습니다');
  });
});

describe('신청서', () => {
  test('보내는 연출컷 요약 · 프로필로 채운 이름 · 연락처 · 지역 · 결과로 돌아가는 길', async () => {
    const calls = await load();
    expect(view()).toEqual(['form']);
    expect(calls.fetch[0]).toEqual({
      url: `https://gen.example.workers.dev/api/generate/${ID}`,
      auth: 'Bearer tok-1',
    });
    expect($('csSumLine1').textContent).toBe('싱크대 · 모던 미니멀 · 화이트');
    expect($('csSumLine2').textContent).toBe('예상 견적 3,128,400원 · 연출컷 4장');
    expect($('csThumb').getAttribute('src')).toBe(GEN.images[0].url);
    expect($('csName').value).toBe('김고객');
    expect($('csPhone').value).toBe('010-2222-3333');
    expect($('csSido').value).toBe('대구광역시');
    expect($('csGugun').value).toBe('북구');
    expect($('csBack').getAttribute('href')).toBe(`./?g=${ID}#result`);
    expect(document.querySelector('[aria-current="page"]').getAttribute('data-tab-link')).toBe(
      'make'
    );
  });

  test('프로필이 비면 가입 정보(user_metadata)로 채운다 — consultation.html 과 같은 출처', async () => {
    await load({ profile: null });
    expect($('csName').value).toBe('메타 이름');
    expect($('csPhone').value).toBe('010-9999-0000');
    expect($('csSido').value).toBe('');
  });

  test('뺀 칸 — 상담 종류 · 공간 · 치수 · 예산 · 스타일이 없다 (가구 종류는 「품목」 칩, 날짜는 「시공 완료 희망 날짜」 한 칸)', async () => {
    await load();
    for (const id of [
      'consultationType',
      'furnitureCategories',
      'spaceType',
      'spaceWidth',
      'budgetRange',
      'stylePreference',
      'preferredDate',
    ]) {
      expect(document.getElementById(id)).toBeNull();
    }
    const form = $('csForm').textContent;
    expect(form.replace(/시공 완료 희망 날짜/g, '')).not.toMatch(
      /예산|상담 유형|가구 종류|희망 날짜|설치 공간/
    );
    expect([...document.querySelectorAll('input[type="date"]')].map((el) => el.id)).toEqual([
      'csWantDate',
    ]);
  });

  test('시공 완료 희망 날짜 · 선택 — 오늘(KST)부터 고른다', async () => {
    await load();
    expect($('csWantDate').min).toBe(kstDay(0));
    expect($('csWantDate').closest('label').textContent).toContain(
      '시공 완료 희망 날짜 (예: 입주 날) · 선택'
    );
  });

  test('시공 지역 목록 = signup.html 의 locationData', async () => {
    await load();
    const signup = read('signup.html').match(/const locationData = (\{[\s\S]*?\n\s*\});/)[1];
    const expected = Function(`return ${signup}`)();
    expect(JSON.parse(JSON.stringify(window.SeganRegions))).toEqual(expected);
    expect([...$('csSido').options].slice(1).map((o) => o.value)).toEqual(Object.keys(expected));
    $('csSido').value = '서울특별시';
    $('csSido').dispatchEvent(new window.Event('change'));
    expect([...$('csGugun').options].slice(1).map((o) => o.value)).toEqual(expected['서울특별시']);
    expect($('csGugun').disabled).toBe(false);
  });

  test('상담받을 곳(본사 · 협력업체)은 고르지 않는다 — 지역은 언제나 필수', async () => {
    await load();
    expect(document.querySelectorAll('input[name="target"]')).toHaveLength(0);
    expect($('csForm').textContent).not.toMatch(/누구와 상담할까요|가까운 협력업체|준비 중/);
    for (const id of ['csCallPartner', 'csDonePartner', 'csSidoLabel'])
      expect(document.getElementById(id)).toBeNull();
    const labels = [...$('csFields').querySelectorAll('.cs-region .mk-input > span')].map(
      (s) => s.textContent
    );
    expect(labels).toEqual(['시공 지역 · 시/도 · 필수', '시/군/구 · 필수']);
  });

  test('도어 마감 · 철거 · 가격대 — 값은 consultations 칸 값, 이름은 업체 상담 칸(partner-consults.js)과 같다', async () => {
    await load();
    (0, eval)(read('segan/partner-consults.js'));
    const P = window.SeganPartnerConsults;
    expect(radios('doorFinish')).toEqual(Object.entries(P.DOOR_FINISH));
    expect(radios('priceTier')).toEqual(Object.entries(P.PRICE_TIER));
    expect(radios('demolition')).toEqual([
      ['yes', '예'],
      ['no', '아니요'],
    ]);
    expect(window.SeganConsult.DOOR_FINISHES).toEqual(Object.keys(P.DOOR_FINISH));
    expect(window.SeganConsult.PRICE_TIERS).toEqual(Object.keys(P.PRICE_TIER));
    // 처음엔 아무것도 골라 두지 않는다
    for (const n of ['doorFinish', 'demolition', 'priceTier'])
      expect(document.querySelector(`input[name="${n}"]:checked`)).toBeNull();
    // DB 쪽 마이그레이션이 들어와 있으면 CHECK 값과도 같다
    if (MIGRATION_0019) {
      const list = (col) =>
        [
          ...MIGRATION_0019.match(new RegExp(`${col} = ANY \\(ARRAY\\[([^\\]]*)\\]`))[1].matchAll(
            /'(\w+)'/g
          ),
        ].map((m) => m[1]);
      expect(list('door_finish')).toEqual(window.SeganConsult.DOOR_FINISHES);
      expect(list('wanted_price_tier')).toEqual(window.SeganConsult.PRICE_TIERS);
    }
  });

  test('동의 둘 — 수집 · 이용(필수) · 다담이 정한 업체에 제공(선택), 제공 내용', async () => {
    await load();
    const agrees = [...$('csFields').querySelectorAll('.cs-agree')].map((l) => [
      l.querySelector('input').id,
      l.textContent.trim(),
    ]);
    expect(agrees).toEqual([
      ['csAgree', '개인정보 수집·이용에 동의합니다 (필수)'],
      [
        'csAgreeThird',
        '다담 협력업체 목록 중 다담이 정한 업체에 상담 정보를 제공하는 데 동의합니다 (선택)',
      ],
    ]);
    expect($('csAgreeThird').checked).toBe(false);
    const lis = [...$('csThirdDetail').querySelectorAll('li')].map((li) =>
      li.textContent.replace(/\s+/g, ' ').trim()
    );
    expect(lis).toEqual([
      '받는 곳: 다담 협력업체(다담 공장 포함) 중 다담이 정한 한 곳 — 연결되면 업체 이름을 알려 드립니다',
      // 업체 사본에 실제로 넘기는 칸과 같다 (서버는 이 항목만 넣는다)
      '항목: 이름 · 전화 · 이메일 · 지역 · 연락 시간 · 시공 완료 희망 날짜 · 품목 · 요청 사항 · 도어 마감 · 철거 · 가격대 · 상세 설계 요청 · 연출컷 · 예상 견적',
      '목적: 상담 · 견적 · 시공',
      '보유: 상담 목적을 이룰 때까지',
      '동의하지 않으면 다담 본사가 직접 상담합니다',
    ]);
    // 수집 · 이용 목적에는 업체 연결을 넣지 않는다 (따로 묻는다)
    const privacy = $('csFields').querySelector('.cs-agree-detail').textContent;
    expect(privacy).toContain(
      '필수: 이름, 연락처, 이메일, 상담 제목, 시공 지역, 품목, 도어 마감, 철거, 가격대'
    );
    expect(privacy).toContain('선택: 연락 받기 좋은 시간, 시공 완료 희망 날짜, 요청 사항');
    expect(privacy).toContain('목적: 상담 신청 처리');
    expect(privacy).not.toContain('협력업체 연결');
  });

  test('품목 칩 — 여러 개, 값 · 이름 = consultation.html 가구 종류 = consult-notify.js FURNITURE_LABELS', async () => {
    await load();
    const notify = read('workers/workflow-api/src/consult-notify.js');
    const labels = Function(
      `return ${notify.match(/FURNITURE_LABELS = Object\.freeze\((\{[\s\S]*?\})\);/)[1]}`
    )();
    const chips = [...document.querySelectorAll('input[name="item"]')];
    expect(chips.every((el) => el.type === 'checkbox')).toBe(true);
    expect(chips.map((el) => [el.value, el.closest('label').textContent.trim()])).toEqual(
      Object.entries(labels)
    );
    const site = [
      ...read('consultation.html').matchAll(/name="furnitureCategory" value="([^"]+)"/g),
    ].map((m) => m[1]);
    expect(window.SeganConsult.ITEM_KEYS).toEqual(site);
    expect(window.SeganConsult.ITEM_KEYS).toEqual(Object.keys(labels));
    // 이 연출컷(싱크대 sink)은 같은 키가 있어 미리 골라 둔다
    expect(chips.filter((el) => el.checked).map((el) => el.value)).toEqual(['sink']);
  });

  test.each([
    ['wardrobe', ['wardrobe']],
    ['storage', ['storage']],
    // 목록에 똑같은 키가 없으면 골라 두지 않는다 (shoe → shoerack 같은 바꾸기 규칙은 없다)
    ['shoe', []],
    ['office', []],
    ['bedroom', []],
  ])('연출컷 품목 %s → 미리 고른 품목 %j', async (category, expected) => {
    await load({ gen: { ...GEN, category } });
    expect(
      [...document.querySelectorAll('input[name="item"]:checked')].map((el) => el.value)
    ).toEqual(expected);
  });

  test('연락 받기 좋은 시간 값 = consultation.html #preferredTime', async () => {
    await load();
    const site = [
      ...read('consultation.html')
        .match(/<select id="preferredTime">([\s\S]*?)<\/select>/)[1]
        .matchAll(/value="([^"]*)"/g),
    ].map((m) => m[1]);
    expect([...$('csTime').options].map((o) => o.value)).toEqual(site);
  });
});

describe('보내기 — consultations insert (consultation.html 과 같은 길)', () => {
  const siteKeys = () => {
    const block = read('consultation.html').match(
      /from\('consultations'\)\.insert\(\{([\s\S]*?)\}\);/
    )[1];
    return [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
  };
  const sqlColumns = () => [...SQL.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);

  test('한 줄 — 저절로 채우는 칸(이메일 · 제목 · 유형 · 연출컷 · 견적 · 동의 시각)과 고객 칸', async () => {
    const calls = await load();
    $('csWantDate').value = kstDay(40);
    $('csTime').value = '15:00-18:00';
    $('csDesc').value = '다음 달 입주라 급해요';
    fillRequired();
    await send();
    expect(calls.inserts).toHaveLength(1);
    const { table, row } = calls.inserts[0];
    expect(table).toBe('consultations');
    expect(row).toEqual({
      user_id: 'user-1',
      name: '김고객',
      email: 'customer@example.com',
      phone: '010-2222-3333',
      consultation_type: 'ai-design',
      title: 'AI 연출컷 상담 — 싱크대',
      description: '다음 달 입주라 급해요',
      preferred_time: '15:00-18:00',
      wanted_done_date: kstDay(40),
      status: 'pending',
      privacy_agreed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      generation_id: ID,
      quote: QUOTE,
      sido: '대구광역시',
      gugun: '북구',
      furniture_categories: ['sink'],
      door_finish: 'highgloss',
      demolition_needed: true,
      wanted_price_tier: 'mid',
      third_party_agreed_at: null,
      consent_version: null,
    });
    // 상담받을 곳 · 회사는 보내지 않는다 (company_id 는 DB 기본값 — 다담 본사)
    expect(row).not.toHaveProperty('consult_target');
    expect(row).not.toHaveProperty('company_id');
    // 보내는 칸은 consultation.html 이 쓰는 칸 + SQL 파일 · 0019 가 더하는 칸뿐
    const allowed = new Set(siteKeys().concat(sqlColumns(), COLUMNS_0019, COLUMNS_0021));
    for (const k of Object.keys(row)) expect([k, allowed.has(k)]).toEqual([k, true]);
    if (MIGRATION_0019) {
      for (const c of COLUMNS_0019)
        expect([c, MIGRATION_0019.includes(`ADD COLUMN IF NOT EXISTS ${c} `)]).toEqual([c, true]);
    }
    if (MIGRATION_0021) {
      for (const c of COLUMNS_0021)
        expect([c, MIGRATION_0021.includes(`ADD COLUMN IF NOT EXISTS ${c} `)]).toEqual([c, true]);
    }
    // 접수 화면 — 업체 제공에 동의하지 않았으면 본사가 직접 · 전화 · 결과로
    expect(view()).toEqual(['done']);
    expect($('csDoneTitle').textContent).toBe('상담 신청이 접수되었습니다');
    expect($('csDoneText').textContent).toBe(
      '다담 본사가 확인한 뒤 남기신 연락처로 직접 연락드립니다.'
    );
    expect($('csDoneTel').querySelector('a').getAttribute('href')).toBe('tel:01077386822');
    expect($('csDoneBack').getAttribute('href')).toBe(`./?g=${ID}#result`);
  });

  test('업체 제공 동의 — 같은 시각으로 third_party_agreed_at · consent_version v2, 접수 화면은 「가까운 업체를 연결」', async () => {
    const calls = await load();
    fillRequired();
    $('csAgreeThird').checked = true;
    await send();
    const { row } = calls.inserts[0];
    expect(row.third_party_agreed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.third_party_agreed_at).toBe(row.privacy_agreed_at);
    expect(row.consent_version).toBe('v2');
    expect($('csDoneText').textContent).toBe(
      '다담 본사가 확인한 뒤 가까운 업체를 연결해 드립니다.'
    );
    // 특정 업체를 약속하지 않는다
    expect($('csDoneText').textContent).not.toMatch(/협력업체|공장|업체 이름/);
  });

  test('품목 여러 개 — 목록 차례대로 furniture_categories, 미리 고른 것을 빼도 된다', async () => {
    const calls = await load();
    fillRequired();
    for (const v of ['other', 'wardrobe', 'island']) {
      document.querySelector(`input[name="item"][value="${v}"]`).checked = true;
    }
    document.querySelector('input[name="item"][value="sink"]').checked = false;
    await send();
    expect(calls.inserts[0].row.furniture_categories).toEqual(['island', 'wardrobe', 'other']);
  });

  test.each([
    ['아니요 · 모름 · 보급', 'no', 'unknown', 'basic', false],
    ['예 · 세라믹 · 고급', 'yes', 'ceramic', 'high', true],
  ])('고른 값 그대로 — %s', async (_n, demolition, door, tier, dem) => {
    const calls = await load();
    fillRequired();
    pick('demolition', demolition);
    pick('doorFinish', door);
    pick('priceTier', tier);
    await send();
    expect(calls.inserts[0].row).toMatchObject({
      demolition_needed: dem,
      door_finish: door,
      wanted_price_tier: tier,
    });
  });

  const uncheck = (name) => () =>
    document.querySelectorAll(`input[name="${name}"]`).forEach((el) => (el.checked = false));
  test.each([
    ['이름 없음', () => ($('csName').value = ''), '이름을 적어 주세요.'],
    ['연락처 없음', () => ($('csPhone').value = ' '), '연락처를 적어 주세요.'],
    [
      '시/군/구 없음',
      () => ($('csGugun').value = ''),
      '시공 지역(시/도 · 시/군/구)을 골라 주세요.',
    ],
    ['품목 안 고름', uncheck('item'), '품목을 하나 이상 골라 주세요.'],
    ['도어 마감 안 고름', uncheck('doorFinish'), '원하는 도어 마감을 골라 주세요.'],
    ['철거 안 고름', uncheck('demolition'), '철거가 필요한지 골라 주세요.'],
    ['가격대 안 고름', uncheck('priceTier'), '원하는 가격대를 골라 주세요.'],
    [
      '시공 완료 희망 날짜가 지남',
      () => ($('csWantDate').value = kstDay(-1)),
      '시공 완료 희망 날짜는 오늘이나 그 뒤로 골라 주세요.',
    ],
    ['동의 안 함', () => ($('csAgree').checked = false), '개인정보 수집·이용에 동의해 주세요.'],
  ])('%s → 보내지 않고 안내', async (_n, change, message) => {
    const calls = await load();
    fillRequired();
    change();
    await send();
    expect(calls.inserts).toEqual([]);
    expect(visible($('csError'))).toBe(true);
    expect($('csError').textContent).toBe(message);
  });

  test('지역은 언제나 필수 — 프로필에 없으면 골라야 보낸다', async () => {
    const calls = await load({ profile: { name: '김고객', phone: '010-2222-3333' } });
    fillRequired();
    await send();
    expect(calls.inserts).toEqual([]);
    expect($('csError').textContent).toBe('시공 지역(시/도 · 시/군/구)을 골라 주세요.');
    $('csSido').value = '경기도';
    $('csSido').dispatchEvent(new window.Event('change'));
    $('csGugun').value = '수원시';
    await send();
    expect(calls.inserts[0].row).toMatchObject({ sido: '경기도', gugun: '수원시' });
    expect(view()).toEqual(['done']);
  });

  test('지금 전화하기 — 신청서 대신 대표 전화, 저장하지 않는다', async () => {
    const calls = await load();
    pick('how', 'call');
    expect($('csFields').hidden).toBe(true);
    expect($('csSubmit').hidden).toBe(true);
    expect(visible($('csTel'))).toBe(true);
    expect($('csTel').getAttribute('href')).toBe('tel:01077386822');
    expect($('csCallNum').textContent).toBe('010-7738-6822');
    await send();
    expect(calls.inserts).toEqual([]);
  });

  test('저장 실패 — 안내하고 다시 누를 수 있다', async () => {
    const calls = await load({ insertError: { message: 'permission denied' } });
    fillRequired();
    await send();
    expect(calls.inserts).toHaveLength(1);
    expect(view()).toEqual(['form']);
    expect($('csError').textContent).toContain('신청을 보내지 못했습니다');
    expect($('csSubmit').disabled).toBe(false);
  });
});

describe('database/consultations-app.sql', () => {
  test('여러 번 돌려도 같다 — 칸은 IF NOT EXISTS, 제약은 있을 때 건너뛴다', () => {
    const cols = [...SQL.matchAll(/ADD COLUMN (IF NOT EXISTS )?(\w+)/g)];
    expect(cols.length).toBeGreaterThan(4);
    for (const m of cols) expect([m[2], !!m[1]]).toEqual([m[2], true]);
    expect(SQL).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/);
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_consultations_generation/);
  });

  test('더하는 칸 — 연출컷 · 견적 · 지역 · 상담받을 곳 (+ 이미 있는 동의 시각)', () => {
    expect([...SQL.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1])).toEqual([
      'generation_id',
      'quote',
      'sido',
      'gugun',
      'consult_target',
      'privacy_agreed_at',
    ]);
    expect(SQL).toMatch(
      /generation_id UUID REFERENCES public\.generations\(id\) ON DELETE SET NULL/
    );
    expect(SQL).toMatch(/consult_target IN \('hq', 'partner'\)/);
  });

  const code = () => SQL.replace(/--[^\n]*/g, '');

  test('insert 정책만 좁힌다 — user_id 는 비우거나 자기 것, generation_id 는 비우거나 자기 연출컷', () => {
    const c = code();
    // 바꾸는 정책은 하나뿐 (읽기 · 고치기 정책은 그대로)
    expect(
      [...c.matchAll(/(?:DROP|CREATE) POLICY (?:IF EXISTS )?"([^"]+)"/g)].map((m) => m[1])
    ).toEqual(['Users can insert consultations', 'Users can insert consultations']);
    const policy = c.match(
      /CREATE POLICY "Users can insert consultations" ON public\.consultations([\s\S]*?);/
    )[1];
    expect(policy).toMatch(/FOR INSERT/);
    expect(policy).toMatch(/\(user_id IS NULL OR user_id = auth\.uid\(\)\)/);
    expect(policy).toMatch(/public\.consultation_generation_ok\(generation_id\)/);
    expect(policy).not.toMatch(/WITH CHECK \(\s*true\s*\)/);
    // DROP 은 그 정책 하나뿐, 한 트랜잭션
    expect(c.match(/DROP\s/g)).toHaveLength(1);
    expect(c.trim().startsWith('BEGIN;')).toBe(true);
    expect(c.trim().endsWith('COMMIT;')).toBe(true);
    expect(c).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  test('연출컷 주인 확인 함수 — SECURITY DEFINER · search_path 고정 · 비면 참 · anon/authenticated 만 실행', () => {
    const c = code();
    const fn = c.match(
      /CREATE OR REPLACE FUNCTION public\.consultation_generation_ok\(gid UUID\)([\s\S]*?)\$\$;/
    )[1];
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET search_path = public/);
    expect(fn).toMatch(
      /SELECT gid IS NULL\s+OR EXISTS \(SELECT 1 FROM public\.generations g WHERE g\.id = gid AND g\.user_id = auth\.uid\(\)\)/
    );
    expect(c).toMatch(
      /REVOKE ALL ON FUNCTION public\.consultation_generation_ok\(UUID\) FROM PUBLIC;/
    );
    expect(c).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.consultation_generation_ok\(UUID\) TO anon, authenticated;/
    );
    expect([...c.matchAll(/GRANT\s/g)]).toHaveLength(1);
  });

  test('consultation.html 의 insert 는 새 정책을 지난다 — 로그인 없으면 user_id null, generation_id 없음', () => {
    const site = read('consultation.html');
    const block = site.match(/from\('consultations'\)\.insert\(\{([\s\S]*?)\}\);/)[1];
    expect(block).toMatch(/user_id: currentUser\?\.id \|\| null,/);
    expect(block).not.toMatch(/generation_id/);
  });
});
