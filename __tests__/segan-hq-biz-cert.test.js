/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach, jest, __dirname */
/**
 * @jest-environment jsdom
 *
 * 마이페이지 › 플랫폼 › 사업자등록증 확인 (segan/hq-biz-cert.js, 2026-11-21 대표님 계획 승인
 * 「사업자등록증 등록 시 첫 달 무료 — 자동 확인, 의심 건만 본사 검토」, DB 0077)
 *
 *   - 본사 구성원 · 사이트 관리자만 연다. 서버가 403 이면 칸째 감춘다, 503 not_ready 면 「준비 중」
 *   - account-api GET /admin/partner/certs?status= → 카드(사진 · 적힌 내용 · 올린 사람 · 검토로 온 까닭 · 자동 확인 결과)
 *   - 승인 · 반려는 화면 안에서 한 번 더 묻는다 — 반려는 사유가 있어야 보낸다
 *   - 탭(검토할 것 · 확인됨 · 반려)을 누르면 새로 받는다 (사진 주소가 10분짜리)
 *   - 마이페이지에 메뉴 줄 · 칸 · 스크립트가 있다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = read('segan/hq-biz-cert.js');
const ACC = 'https://acc.example';
const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const cert = (i, over = {}) => ({
  id: id(i),
  status: 'review',
  extracted: {
    biz_no: '1234567890',
    company_name: '새봄가구',
    representative_name: '김가짜',
    open_date: '2020-03-05',
  },
  biz_no: '1234567890',
  company_name: '새봄가구',
  representative_name: '김가짜',
  open_date: '2020-03-05',
  review_reason: 'nts_mismatch',
  decision_reason: null,
  created_at: '2026-11-21T01:00:00.000Z',
  checks: {
    checksum: true,
    nts_status: 'active',
    nts_valid: false,
    duplicate: false,
    edited: false,
  },
  email: 'new@example.test',
  name: '새 사람',
  photo_url: `https://sb.example/storage/v1/object/sign/business-certs/u/2026/${i}.jpg?token=t`,
  trial: null,
  ...over,
});

let calls;
let answers;
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup({
  lists = { review: [cert(1), cert(2, { review_reason: 'unreadable', extracted: null })] },
  status = 200,
} = {}) {
  document.body.innerHTML =
    '<section id="hqBizCert" hidden><h2>사업자등록증 확인</h2><div id="hqBizCertBody"></div></section>';
  window.DADAM_CONFIG = { accountApi: { url: ACC } };
  calls = [];
  answers = { lists, status, act: { status: 200, body: { success: true, data: { cert: {} } } } };
  global.fetch = jest.fn(async (url, init) => {
    calls.push([
      init.method,
      url,
      init.headers.Authorization,
      init.body ? JSON.parse(init.body) : undefined,
    ]);
    if (init.method === 'GET') {
      const tab = new URL(url).searchParams.get('status');
      if (answers.status !== 200)
        return {
          status: answers.status,
          json: async () => ({ success: false, code: answers.code }),
        };
      return { status: 200, json: async () => ({ success: true, data: answers.lists[tab] || [] }) };
    }
    return { status: answers.act.status, json: async () => answers.act.body };
  });
  delete window.SeganHqBizCert;
  new Function(SRC)();
}
const session = { access_token: 'tok' };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const load = (me = { platform_member: true }, opts) =>
  window.SeganHqBizCert.load(null, session, me, opts);
const facts = (card) =>
  Object.fromEntries(
    [...card.querySelectorAll('.me-facts div')].map((d) => [
      d.querySelector('dt').textContent,
      d.querySelector('dd').textContent,
    ])
  );
const checks = (card) =>
  [...card.querySelectorAll('.me-bc-checks li')].map((li) => [
    li.children[0].textContent,
    li.children[1].textContent,
    li.getAttribute('data-check'),
  ]);
const press = async (card, label) => {
  const b = [...card.querySelectorAll('button')].find((x) => x.textContent === label);
  expect([label, !!b]).toEqual([label, true]);
  b.click();
  await flush();
};

describe('사업자등록증 확인 칸', () => {
  beforeEach(() => jest.restoreAllMocks());

  test('본사 구성원 · 관리자만 — 아니면 서버에 묻지도 않고 감춘다', async () => {
    setup();
    await load({ platform_member: false }, { admin: false });
    expect(calls).toEqual([]);
    expect($('#hqBizCert').hidden).toBe(true);
    await load({ platform_member: false }, { admin: true });
    expect(calls[0].slice(0, 3)).toEqual([
      'GET',
      `${ACC}/admin/partner/certs?status=review`,
      'Bearer tok',
    ]);
    expect($('#hqBizCert').hidden).toBe(false);
  });

  test('서버가 403 · 오류면 칸째 감추고, DB 0077 전(503 not_ready)이면 「준비 중」', async () => {
    setup({ status: 403 });
    await load();
    expect($('#hqBizCert').hidden).toBe(true);
    setup({ status: 503 });
    answers.code = 'not_ready';
    await load();
    expect($('#hqBizCert').hidden).toBe(false);
    expect($('#hqBizCertBody').textContent).toBe('준비 중입니다 — DB 0077 을 적용하면 열립니다.');
    setup({ status: 503 });
    answers.code = 'not_configured';
    await load();
    expect($('#hqBizCert').hidden).toBe(true);
  });

  test('검토할 것 — 사진 · 적힌 내용 · 올린 사람 · 검토로 온 까닭 · 자동 확인 결과 넷, 승인 · 반려 단추', async () => {
    setup();
    await load();
    expect($$('[role="tab"]').map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual(
      [
        ['검토할 것', 'true'],
        ['확인됨', 'false'],
        ['반려', 'false'],
      ]
    );
    const cards = $$('.me-bc-card');
    expect(cards).toHaveLength(2);
    const img = cards[0].querySelector('.me-bc-photo img');
    expect(img.getAttribute('src')).toContain('/business-certs/u/2026/1.jpg');
    expect(img.getAttribute('alt')).toBe('사업자등록증 사진');
    expect(facts(cards[0])).toEqual({
      사업자등록번호: '123-45-67890',
      상호: '새봄가구',
      대표자: '김가짜',
      개업일: '2020-03-05',
      '올린 사람': '새 사람 · new@example.test',
      '올린 날': '2026-11-21',
      '검토로 온 까닭': '국세청 진위확인이 맞지 않습니다 (번호 · 대표자 · 개업일)',
    });
    expect(checks(cards[0])).toEqual([
      ['검증 숫자', '맞음', 'ok'],
      ['국세청 상태', '계속사업자', 'ok'],
      ['국세청 진위확인', '불일치', 'bad'],
      ['AI 가 읽은 번호', '123-45-67890', 'ok'],
    ]);
    // AI 가 못 읽은 건
    expect(facts(cards[1])['검토로 온 까닭']).toBe('AI 가 사진에서 번호를 읽지 못했습니다');
    expect(checks(cards[1])[3]).toEqual(['AI 가 읽은 번호', '읽지 못함', 'unknown']);
    expect([...cards[0].querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      '승인',
      '반려',
    ]);
    // 내려받는 길이 없다
    expect($$('#hqBizCertBody a')).toEqual([]);
  });

  test('자동 확인 결과 — 하지 않은 확인은 「확인 못 함」, 번호를 고쳤으면 알린다', () => {
    setup();
    const rows = window.SeganHqBizCert.checkRows(
      cert(1, {
        checks: { checksum: true, nts_status: null, nts_valid: null, edited: true },
        extracted: { biz_no: '1112233333' },
      })
    );
    expect(rows).toEqual([
      ['검증 숫자', '맞음', 'ok'],
      ['국세청 상태', '확인 못 함', 'unknown'],
      ['국세청 진위확인', '확인 못 함', 'unknown'],
      ['AI 가 읽은 번호', '111-22-33333 (적은 번호와 다름)', 'bad'],
    ]);
    expect(
      window.SeganHqBizCert.checkRows(cert(1, { checks: { nts_status: 'closed' } }))[1]
    ).toEqual(['국세청 상태', '폐업', 'bad']);
    expect(window.SeganHqBizCert.checkRows({})).toHaveLength(4);
  });

  test('승인 — 한 번 더 묻고 POST { decision: approve }, 처리한 줄은 목록에서 빠진다', async () => {
    setup();
    await load();
    let card = $$('.me-bc-card')[0];
    await press(card, '승인');
    card = $$('.me-bc-card')[0];
    expect(card.querySelector('.me-bc-ask .mk-note').textContent).toBe(
      '이 사업자등록증을 승인할까요? 이 번호로 첫 달 무료를 한 번 받을 수 있게 됩니다.'
    );
    expect(card.querySelector('textarea')).toBeNull();
    await press(card, '그만두기');
    expect(calls.filter((c) => c[0] === 'POST')).toEqual([]);
    await press($$('.me-bc-card')[0], '승인');
    await press($$('.me-bc-card')[0], '승인하기');
    expect(calls.filter((c) => c[0] === 'POST')).toEqual([
      ['POST', `${ACC}/admin/partner/certs/${id(1)}`, 'Bearer tok', { decision: 'approve' }],
    ]);
    expect($$('.me-bc-card').map((c) => c.getAttribute('data-id'))).toEqual([id(2)]);
    expect($('[role="status"]').textContent).toBe('승인했습니다.');
  });

  test('반려 — 사유가 없으면 보내지 않고, 적으면 POST { decision: reject, reason }', async () => {
    setup();
    await load();
    await press($$('.me-bc-card')[1], '반려');
    let card = $$('.me-bc-card')[1];
    expect(card.querySelector('.me-bc-ask .mk-note').textContent).toBe(
      '반려 사유를 적어 주세요. 올린 사람의 화면에 그대로 보입니다.'
    );
    expect(card.querySelector('textarea').getAttribute('maxlength')).toBe('300');
    await press(card, '반려하기');
    expect(calls.filter((c) => c[0] === 'POST')).toEqual([]);
    card = $$('.me-bc-card')[1];
    expect(card.querySelector('[role="alert"]').textContent).toBe('반려 사유를 적어 주세요.');
    card.querySelector('textarea').value = '  사진이 잘려 번호가 보이지 않습니다  ';
    await press(card, '반려하기');
    expect(calls.filter((c) => c[0] === 'POST')).toEqual([
      [
        'POST',
        `${ACC}/admin/partner/certs/${id(2)}`,
        'Bearer tok',
        { decision: 'reject', reason: '사진이 잘려 번호가 보이지 않습니다' },
      ],
    ]);
    expect($$('.me-bc-card')).toHaveLength(1);
    expect($('[role="status"]').textContent).toBe('반려했습니다.');
  });

  test('처리 실패 — 그 사이 번호가 무료를 받았으면 그 안내, 그 밖은 서버 글. 줄은 그대로 남는다', async () => {
    setup();
    await load();
    answers.act = { status: 409, body: { success: false, code: 'already_used', error: 'x' } };
    await press($$('.me-bc-card')[0], '승인');
    await press($$('.me-bc-card')[0], '승인하기');
    expect($$('.me-bc-card')).toHaveLength(2);
    expect($('.me-bc-ask [role="alert"]').textContent).toBe(
      '그 사이 이 번호가 첫 달 무료를 받았습니다. 승인할 수 없습니다.'
    );
    answers.act = {
      status: 500,
      body: { success: false, code: 'server_error', error: '처리 중 오류가 발생했습니다.' },
    };
    await press($$('.me-bc-card')[0], '승인하기');
    expect($('.me-bc-ask [role="alert"]').textContent).toBe('처리 중 오류가 발생했습니다.');
  });

  test('탭 — 누를 때마다 새로 받는다. 확인됨에는 무료를 시작했는지, 반려에는 사유(코드는 풀어서 · 본사 글은 글자로만)', async () => {
    setup({
      lists: {
        review: [],
        verified: [
          cert(3, {
            status: 'verified',
            trial: {
              plan: 'expert',
              started_at: '2026-11-21T02:00:00Z',
              ends_at: '2026-12-21T02:00:00Z',
              company_id: id(9),
            },
          }),
          cert(4, { status: 'verified' }),
        ],
        rejected: [
          cert(5, { status: 'rejected', decision_reason: 'not_active' }),
          cert(6, { status: 'rejected', decision_reason: '<b>사진이 잘렸습니다</b>' }),
        ],
      },
    });
    await load();
    expect($('.me-empty').textContent).toBe('검토할 사업자등록증이 없습니다.');
    $$('[role="tab"]')[1].click();
    await flush();
    expect(calls[calls.length - 1][1]).toBe(`${ACC}/admin/partner/certs?status=verified`);
    let cards = $$('.me-bc-card');
    expect(facts(cards[0])['첫 달 무료']).toBe('Expert · 2026-11-21 ~ 2026-12-21');
    expect(facts(cards[1])['첫 달 무료']).toBe('아직 시작하지 않음');
    expect($$('.me-bc-card button')).toEqual([]); // 확인된 줄에는 단추가 없다
    $$('[role="tab"]')[2].click();
    await flush();
    cards = $$('.me-bc-card');
    expect(facts(cards[0])['반려 사유']).toBe('휴업 · 폐업 · 등록되지 않은 사업자');
    expect(facts(cards[1])['반려 사유']).toBe('<b>사진이 잘렸습니다</b>');
    expect(cards[1].querySelector('.me-facts b')).toBeNull();
  });

  test('모양이 틀린 줄 · https 가 아닌 사진 주소는 그리지 않는다', async () => {
    setup({
      lists: { review: [cert(1, { photo_url: 'javascript:alert(1)' }), { id: 'x' }, null] },
    });
    await load();
    expect($$('.me-bc-card')).toHaveLength(1);
    expect($('.me-bc-photo img')).toBeNull();
    expect($('.me-bc-photo').textContent).toBe('사진을 열 수 없습니다. 탭을 다시 눌러 주세요.');
  });
});

describe('마이페이지에 붙는 자리', () => {
  test('메뉴 줄 · 칸 · 스크립트 · 서비스 워커 · 화면 이름', () => {
    const html = read('segan/me.html');
    expect(html).toMatch(/<script src="hq-biz-cert\.js\?v=\d+" defer><\/script>/);
    expect(html).toMatch(
      /<li data-me-item="hq-biz-cert" hidden>\s*<a class="sg-row" href="#hq-biz-cert" data-me-go="hq-biz-cert">사업자등록증 확인<\/a>/
    );
    expect(html).toMatch(
      /<section class="sg-section me-screen" id="hqBizCert" aria-labelledby="hqBizCertTitle" hidden>/
    );
    const me = read('segan/me.js');
    expect(me).toContain("'hq-biz-cert': { title: '사업자등록증 확인', section: 'hqBizCert' }");
    expect(me).toMatch(
      /case 'hq-biz-cert':\s*return \(v\.platform \|\| roles\.admin === true\) && available\(key\);/
    );
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'hq-biz-cert.js')");
    // 알림이 여는 곳과 같은 주소 (workflow-api push/messages.js HQ_BIZ_CERT_URL)
    expect(read('workers/workflow-api/src/push/messages.js')).toContain(
      '/segan/me.html#hq-biz-cert'
    );
  });

  test('모습 — 폰은 위아래 · PC 는 좌우, 나쁜 결과는 굵게(색에 기대지 않는다)', () => {
    const css = read('segan/shell.css');
    expect(css).toMatch(/\n\.me-bc-card \{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\n {2}\.me-bc-card \{\s*grid-template-columns:/);
    expect(css).toMatch(
      /\.me-bc-checks li\[data-check='bad'\] span:last-child \{\s*font-weight:\s*500;/
    );
    expect(css).toMatch(/\.me-bc-photo img \{[^}]*object-fit:\s*contain;/);
  });
});
