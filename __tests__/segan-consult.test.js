/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, URL, setTimeout */
/**
 * SEGAN ④ 상담 신청 (segan/consult.html + segan/consult.js) + database/consultations-app.sql.
 *
 *   - 저장은 consultation.html 과 같은 길 (Supabase consultations insert) — 새 엔드포인트 없음
 *   - 고객이 적는 칸 / 저절로 채우는 칸 / 뺀 칸 (상담 종류 · 가구 종류 · 공간 · 치수 · 예산 · 스타일 · 희망 날짜)
 *   - 시공 지역 목록 = signup.html, 연락 시간 값 = consultation.html
 *   - 보내는 칸은 consultation.html 이 쓰는 칸 + SQL 파일이 더하는 칸뿐
 *   - 새 칸이 없으면 신청서 대신 「아직 받을 수 없습니다」 + 전화
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const AuthRedirect = require('../js/auth-redirect.js');
const SQL = read('database/consultations-app.sql');
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
      'generation_id,quote,sido,gugun,consult_target,privacy_agreed_at',
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

  test('뺀 칸 — 상담 종류 · 가구 종류 · 공간 · 치수 · 예산 · 스타일 · 희망 날짜가 없다', async () => {
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
    expect(form).not.toMatch(/예산|상담 유형|가구 종류|희망 날짜|설치 공간/);
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(0);
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
    $('csTime').value = '15:00-18:00';
    $('csDesc').value = '다음 달 입주라 급해요';
    $('csAgree').checked = true;
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
      status: 'pending',
      privacy_agreed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      generation_id: ID,
      quote: QUOTE,
      sido: '대구광역시',
      gugun: '북구',
      consult_target: 'hq',
    });
    // 보내는 칸은 consultation.html 이 쓰는 칸 + SQL 파일이 더하는 칸뿐
    const allowed = new Set(siteKeys().concat(sqlColumns()));
    for (const k of Object.keys(row)) expect([k, allowed.has(k)]).toEqual([k, true]);
    // 접수 화면 — 다음에 일어나는 일 · 전화 · 결과로
    expect(view()).toEqual(['done']);
    expect($('csDoneTitle').textContent).toBe('상담 신청이 접수되었습니다');
    expect($('csDoneTel').querySelector('a').getAttribute('href')).toBe('tel:01077386822');
    expect($('csDoneBack').getAttribute('href')).toBe(`./?g=${ID}#result`);
    expect($('csDonePartner').hidden).toBe(true);
  });

  test.each([
    ['이름 없음', () => ($('csName').value = ''), '이름을 적어 주세요.'],
    ['연락처 없음', () => ($('csPhone').value = ' '), '연락처를 적어 주세요.'],
    ['동의 안 함', () => ($('csAgree').checked = false), '개인정보 수집·이용에 동의해 주세요.'],
  ])('%s → 보내지 않고 안내', async (_n, change, message) => {
    const calls = await load();
    $('csAgree').checked = true;
    change();
    await send();
    expect(calls.inserts).toEqual([]);
    expect(visible($('csError'))).toBe(true);
    expect($('csError').textContent).toBe(message);
  });

  test('가까운 협력업체 — 지역이 있어야 하고, 고른 값만 남긴다(연결은 아직)', async () => {
    const calls = await load({ profile: { name: '김고객', phone: '010-2222-3333' } });
    pick('target', 'partner');
    $('csAgree').checked = true;
    await send();
    expect(calls.inserts).toEqual([]);
    expect($('csError').textContent).toBe('협력업체를 찾으려면 시공 지역을 골라 주세요.');
    $('csSido').value = '경기도';
    $('csSido').dispatchEvent(new window.Event('change'));
    $('csGugun').value = '수원시';
    await send();
    expect(calls.inserts[0].row).toMatchObject({
      consult_target: 'partner',
      sido: '경기도',
      gugun: '수원시',
    });
    expect(visible($('csDonePartner'))).toBe(true);
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
    $('csAgree').checked = true;
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

  test('RLS 는 바꾸지 않는다 · 지우는 문 없음', () => {
    const code = SQL.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/POLICY|ROW LEVEL SECURITY|GRANT|REVOKE|DROP\s/i);
  });
});
