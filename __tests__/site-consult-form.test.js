/**
 * consultation.html — 사이트 상담 신청서.
 *
 * 상담은 다담 본사가 먼저 받아 업체(다담 협력업체 · 다담 공장)에 나눠 준다. 그래서 신청서는
 *   - 시공 지역(시/도 · 시/군/구, 필수 — signup.html 의 locationData 와 같은 목록)
 *   - 원하는 도어 마감 · 철거 필요 · 원하는 가격대(필수 — segan/consult.html 과 같은 값, 「모름」 있음)
 *   - 동의 둘: 개인정보 수집 · 이용(필수) → privacy_agreed_at
 *             다담 협력업체 목록 중 다담이 정한 업체에 제공(선택) → third_party_agreed_at · consent_version 'v1'
 *     업체 제공에 동의하지 않아도 신청은 간다 (다담 본사가 직접 상담 — 두 칸은 비운다)
 * 를 받고, company_id · consult_target 은 보내지 않는다 (DB 기본값이 본사).
 * 페이지 스크립트를 jsdom 에 올리고 가짜 Supabase 로 돌린다.
 */
const fs = require('fs');
const path = require('path');

const read = (rel) =>
  fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .split('\r\n')
    .join('\n');

const HTML = read('consultation.html');
const $ = (id) => document.getElementById(id);
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** 페이지의 `const locationData = {...}` 를 값으로 읽는다 */
function locationDataOf(html) {
  const m = html.match(/const locationData = (\{[\s\S]*?\n\s*\});/);
  if (!m) throw new Error('locationData 를 찾지 못함');
  return Function(`return ${m[1]}`)();
}

const SESSION = {
  user: {
    id: 'user-1',
    email: 'customer@example.com',
    user_metadata: { name: '김고객', phone: '010-2222-3333', sido: '대구광역시', gugun: '북구' },
  },
};

/** 페이지를 올린다. DOMContentLoaded 처리기를 잡아 직접 부른다. 돌려주는 calls 에 insert 가 쌓인다. */
async function load({ session = null, insertResult = { error: null } } = {}) {
  document.body.innerHTML = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('</body>'));
  const script = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  const calls = { inserts: [], alerts: [] };
  window.alert = (msg) => calls.alerts.push(msg);
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  delete window.DetailDesignAccess;
  delete window.AdminAccess;
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }), signOut: async () => ({}) },
      from: (table) => ({
        insert: async (row) => {
          calls.inserts.push({ table, row });
          return insertResult;
        },
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    }),
  };
  let ready = null;
  const add = document.addEventListener;
  document.addEventListener = (type, fn, ...rest) => {
    if (type === 'DOMContentLoaded') ready = fn;
    else add.call(document, type, fn, ...rest);
  };
  try {
    (0, eval)(script);
  } finally {
    document.addEventListener = add;
  }
  await ready();
  return calls;
}

function pick(name, value) {
  document.querySelector(`input[name="${name}"][value="${value}"]`).checked = true;
}

function unpick(name) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((el) => (el.checked = false));
}

function chooseRegion(sido, gugun) {
  $('sido').value = sido;
  $('sido').dispatchEvent(new window.Event('change'));
  $('gugun').value = gugun;
}

/** 필수를 모두 채운다 (이름 · 연락처 · 이메일은 로그인 정보로 채워진다) */
function fillRequired() {
  $('title').value = '주방 싱크대 교체 문의';
  chooseRegion('서울특별시', '강남구');
  pick('doorFinish', 'paint');
  pick('demolition', 'yes');
  pick('priceTier', 'mid');
  $('agreePrivacy').checked = true;
}

async function send() {
  await window.submitConsultation({ preventDefault() {} });
}

const radioValues = (name) =>
  [...document.querySelectorAll(`input[type="radio"][name="${name}"]`)].map((el) => [
    el.value,
    norm(el.closest('label').textContent),
  ]);

describe('시공 정보', () => {
  test('시공 지역 목록 = signup.html 의 locationData', async () => {
    await load();
    const expected = locationDataOf(read('signup.html'));
    expect(locationDataOf(HTML)).toEqual(expected);
    expect([...$('sido').options].map((o) => o.value)).toEqual([''].concat(Object.keys(expected)));
    expect($('gugun').disabled).toBe(true);
    $('sido').value = '서울특별시';
    $('sido').dispatchEvent(new window.Event('change'));
    expect([...$('gugun').options].map((o) => o.value)).toEqual(
      [''].concat(expected['서울특별시'])
    );
    expect($('gugun').disabled).toBe(false);
    // 시/도를 비우면 시/군/구도 비우고 막는다
    $('sido').value = '';
    $('sido').dispatchEvent(new window.Event('change'));
    expect([...$('gugun').options].map((o) => o.value)).toEqual(['']);
    expect($('gugun').disabled).toBe(true);
  });

  test('시/도 · 시/군/구는 필수', async () => {
    await load();
    expect($('sido').required).toBe(true);
    expect($('gugun').required).toBe(true);
  });

  test('로그인했으면 가입 때 적은 거주지역을 미리 골라 둔다 — 목록에 없는 값은 고르지 않는다', async () => {
    await load({ session: SESSION });
    expect($('sido').value).toBe('대구광역시');
    expect($('gugun').value).toBe('북구');
    await load({
      session: { user: { ...SESSION.user, user_metadata: { sido: '없는시', gugun: '북구' } } },
    });
    expect($('sido').value).toBe('');
    expect($('gugun').value).toBe('');
  });

  test('도어 마감 · 철거 · 가격대 값과 이름 = 앱 신청서(segan/consult.html)와 같다', async () => {
    await load();
    expect(radioValues('doorFinish')).toEqual([
      ['pet', 'PET'],
      ['highgloss', '하이그로시'],
      ['paint', '도장'],
      ['veneer', '무늬목'],
      ['ceramic', '세라믹'],
      ['unknown', '모름'],
    ]);
    expect(radioValues('demolition')).toEqual([
      ['yes', '예'],
      ['no', '아니요'],
    ]);
    expect(radioValues('priceTier')).toEqual([
      ['basic', '보급'],
      ['mid', '중급'],
      ['high', '고급'],
      ['unknown', '모름'],
    ]);
    for (const name of ['doorFinish', 'demolition', 'priceTier']) {
      expect(document.querySelector(`input[name="${name}"]`).required).toBe(true);
    }
  });
});

describe('동의', () => {
  test('개인정보 수집 · 이용은 필수, 업체 제공은 선택 — 문구는 앱 신청서와 같다', async () => {
    await load();
    expect($('agreePrivacy').required).toBe(true);
    expect($('agreeThirdParty').required).toBe(false);
    expect(norm($('agreePrivacy').closest('label').textContent)).toBe(
      '개인정보 수집·이용에 동의합니다 (필수)'
    );
    expect(norm($('agreeThirdParty').closest('label').textContent)).toBe(
      '다담 협력업체 목록 중 다담이 정한 업체에 상담 정보를 제공하는 데 동의합니다 (선택)'
    );
  });

  test('제공하는 내용 — 넘기는 항목만 적는다 (공간 · 치수 · 예산 · 스타일은 넘기지 않는다)', async () => {
    await load();
    const items = [...$('thirdPartyDetail').querySelectorAll('li')].map((li) =>
      norm(li.textContent)
    );
    expect(items).toEqual([
      '받는 곳: 다담 협력업체(다담 공장 포함) 중 다담이 정한 한 곳 — 연결되면 업체 이름을 알려 드립니다',
      '항목: 이름 · 전화 · 이메일 · 지역 · 연락 시간 · 품목 · 요청 사항 · 도어 마감 · 철거 · 가격대 · 상세 설계 요청 · 연출컷 · 예상 견적',
      '목적: 상담 · 견적 · 시공',
      '보유: 상담 목적을 이룰 때까지',
      '동의하지 않으면 다담 본사가 직접 상담합니다',
    ]);
    expect($('thirdPartyDetail').textContent).not.toMatch(/공간|치수|예산|스타일/);
  });
});

describe('보내기 — consultations insert', () => {
  test('업체 제공에 동의하지 않으면 동의 칸 둘을 비우고 보낸다 — 본사 직접 상담 안내', async () => {
    const calls = await load({ session: SESSION });
    fillRequired();
    await send();
    expect(calls.alerts).toEqual([]);
    expect(calls.inserts).toHaveLength(1);
    const { table, row } = calls.inserts[0];
    expect(table).toBe('consultations');
    expect(row).toMatchObject({
      user_id: 'user-1',
      name: '김고객',
      email: 'customer@example.com',
      phone: '010-2222-3333',
      title: '주방 싱크대 교체 문의',
      status: 'pending',
      sido: '서울특별시',
      gugun: '강남구',
      door_finish: 'paint',
      demolition_needed: true,
      wanted_price_tier: 'mid',
      privacy_agreed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      third_party_agreed_at: null,
      consent_version: null,
    });
    // 회사 · 상담 대상은 보내지 않는다 — DB 기본값이 다담 본사
    expect(row).not.toHaveProperty('company_id');
    expect(row).not.toHaveProperty('consult_target');
    expect($('successMessage').classList.contains('show')).toBe(true);
    expect($('successText').textContent).toBe(
      '다담 본사가 확인한 뒤 남기신 연락처로 직접 연락드립니다.'
    );
  });

  test("업체 제공에 동의하면 동의 시각 · 문구 판 'v1' 을 남긴다 — 업체 연결 안내", async () => {
    const calls = await load({ session: SESSION });
    fillRequired();
    pick('demolition', 'no');
    pick('doorFinish', 'unknown');
    pick('priceTier', 'unknown');
    $('agreeThirdParty').checked = true;
    await send();
    expect(calls.inserts).toHaveLength(1);
    const { row } = calls.inserts[0];
    expect(row.demolition_needed).toBe(false);
    expect(row.door_finish).toBe('unknown');
    expect(row.wanted_price_tier).toBe('unknown');
    expect(row.third_party_agreed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.third_party_agreed_at).toBe(row.privacy_agreed_at);
    expect(row.consent_version).toBe('v1');
    expect($('successText').textContent).toBe(
      '다담 본사가 확인한 뒤 가까운 업체를 연결해 드립니다.'
    );
  });

  test('로그인 없이도 보낸다 — user_id null', async () => {
    const calls = await load();
    $('name').value = '이고객';
    $('phone').value = '010-4444-5555';
    $('email').value = 'guest@example.com';
    fillRequired();
    await send();
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].row.user_id).toBeNull();
  });

  test.each([
    ['시공 지역 없음', () => chooseRegion('', ''), '시공 지역(시/도 · 시/군/구)을 골라 주세요.'],
    [
      '시/군/구 없음',
      () => chooseRegion('서울특별시', ''),
      '시공 지역(시/도 · 시/군/구)을 골라 주세요.',
    ],
    ['도어 마감 없음', () => unpick('doorFinish'), '원하는 도어 마감을 골라 주세요.'],
    ['철거 없음', () => unpick('demolition'), '철거가 필요한지 골라 주세요.'],
    ['가격대 없음', () => unpick('priceTier'), '원하는 가격대를 골라 주세요.'],
    [
      '개인정보 동의 안 함',
      () => ($('agreePrivacy').checked = false),
      '개인정보 수집·이용에 동의해 주세요.',
    ],
  ])('%s → 보내지 않고 안내', async (_n, change, message) => {
    const calls = await load({ session: SESSION });
    fillRequired();
    change();
    await send();
    expect(calls.inserts).toEqual([]);
    expect(calls.alerts).toEqual([message]);
    expect($('submitBtn').disabled).toBe(false);
  });
});
