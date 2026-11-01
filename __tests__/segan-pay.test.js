/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach, __dirname, document, window, DOMParser, jest */
/**
 * SEGAN 결제 결과 화면 (segan/pay.html + segan/pay.js) — 토스 결제창이 돌려보내는 곳.
 *   성공 ?paymentKey&orderId&amount → payments-api POST /order-payments/confirm (본인 토큰) → 받음 · 입금 안내 · 확인 중
 *   실패 ?result=fail&code&message → 그 글, 정보 없음 · 로그인 없음 → 안내. 결제 정보는 주소에서 지운다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAY = 'https://pay.example.workers.dev';

async function open(search, { session = { access_token: 'tok-1' }, confirm } = {}) {
  const doc = new DOMParser().parseFromString(read('segan/pay.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  window.history.replaceState(null, '', '/segan/pay.html' + search);
  window.DADAM_CONFIG = {
    supabase: { url: 'https://sb.test', anonKey: 'anon' },
    paymentsApi: { url: PAY },
  };
  window.supabase = {
    createClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
  };
  const posts = [];
  window.fetch = jest.fn(async (url, init = {}) => {
    posts.push({
      url,
      auth: init.headers && init.headers.Authorization,
      body: JSON.parse(init.body || '{}'),
    });
    const r = confirm || {
      status: 200,
      body: {
        success: true,
        data: {
          transaction: { status: 'paid', amount_requested: 3000000, amount_received: 3000000 },
        },
      },
    };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  });
  delete window.SeganPay;
  (0, eval)(read('segan/pay.js'));
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  return { posts, box: document.getElementById('payResult') };
}

describe('segan/pay.html', () => {
  beforeEach(() => jest.restoreAllMocks());

  test('앱 페이지 · 돌아올 곳 · 스크립트', () => {
    const html = read('segan/pay.html');
    expect(html).toContain('<script src="pay.js?v=');
    expect(html).toContain('id="payResult"');
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    expect(read('segan/sw.js')).toContain("SCOPE + 'pay.html'");
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'pay.js')");
  });

  test('성공 — 승인을 부르고 받음, 결제 정보는 주소에서 지운다', async () => {
    const { posts, box } = await open(
      '?paymentType=NORMAL&orderId=dadampay-abc&paymentKey=pk_1&amount=3000000'
    );
    expect(posts).toEqual([
      {
        url: PAY + '/order-payments/confirm',
        auth: 'Bearer tok-1',
        body: { paymentKey: 'pk_1', orderId: 'dadampay-abc', amount: 3000000 },
      },
    ]);
    expect(box.textContent).toContain('결제했습니다');
    expect(box.textContent).toContain('3,000,000원 받았습니다');
    expect(window.location.search).toBe('');
  });

  test('가상계좌 — 입금 안내, 확인 중 · 승인 실패는 서버 글', async () => {
    let r = await open('?orderId=dadampay-abc&paymentKey=pk_1&amount=3000000', {
      confirm: {
        status: 200,
        body: {
          success: true,
          data: {
            transaction: {
              status: 'waiting_deposit',
              amount_requested: 3000000,
              virtual_account: { bank: '20', account_number: 'X9', due_at: '2026-11-05T14:59:00Z' },
            },
          },
        },
      },
    });
    expect(r.box.textContent).toContain('가상계좌로 입금해 주세요');
    expect(r.box.textContent).toContain('우리은행');
    expect(r.box.textContent).toContain('11/5(목) 23:59까지');
    r = await open('?orderId=dadampay-abc&paymentKey=pk_1&amount=3000000', {
      confirm: {
        status: 422,
        body: {
          success: false,
          code: 'amount_mismatch',
          message: '결제 금액이 수금 일정과 다릅니다. 다시 결제해 주세요.',
        },
      },
    });
    expect(r.box.textContent).toContain('결제하지 못했습니다');
    expect(r.box.textContent).toContain('결제 금액이 수금 일정과 다릅니다');
  });

  test('실패 주소 · 정보 없음 · 로그인 없음 — 승인을 부르지 않는다, 글은 글자로만', async () => {
    let r = await open(
      '?result=fail&code=PAY_PROCESS_CANCELED&message=' + encodeURIComponent('<b>사용자가 취소</b>')
    );
    expect(r.posts).toEqual([]);
    expect(r.box.querySelector('b')).toBeNull();
    expect(r.box.textContent).toContain('<b>사용자가 취소</b>');
    r = await open('');
    expect(r.posts).toEqual([]);
    expect(r.box.textContent).toBe(window.SeganPay.TEXT.noInfo);
    r = await open('?orderId=dadampay-abc&paymentKey=pk_1&amount=3000000', { session: null });
    expect(r.posts).toEqual([]);
    expect(r.box.textContent).toBe(window.SeganPay.TEXT.login);
  });

  test('순수 — 결과 읽기 · 은행 이름 · 기한', () => {
    const P = window.SeganPay;
    expect(P.readResult('?orderId=a&paymentKey=b&amount=10')).toEqual({
      kind: 'confirm',
      paymentKey: 'b',
      orderId: 'a',
      amount: 10,
    });
    expect(P.readResult('?orderId=a&paymentKey=b&amount=x').kind).toBe('none');
    expect(P.readResult('?result=fail&code=C&message=M')).toEqual({
      kind: 'fail',
      message: 'M',
      code: 'C',
    });
    expect(P.bankName('06')).toBe('KB국민은행');
    expect(P.bankName('')).toBe('');
    expect(P.dueText('bad')).toBe('');
  });
});
