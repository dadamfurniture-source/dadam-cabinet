import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateShareToken,
  hashShareToken,
  hashAccessPin,
  buildShareUrl,
  shareExpiryIso,
  checkAccessible,
  isPinLocked,
  verifyPin,
  maskName,
  PIN_POLICY,
} from '../src/share.js';
import { esc, krw, num, ymd, documentShell } from '../src/templates/html.js';
import { renderCustomerConfirmation } from '../src/templates/customer-confirmation.js';
import { renderWorkOrder } from '../src/templates/work-order.js';

const ENV = {
  SHARE_TOKEN_PEPPER: 'test-pepper',
  IP_HASH_SALT: 'test-salt',
  PUBLIC_BASE_URL: 'https://dadamfurniture.com',
  SHARE_LINK_TTL_DAYS: '14',
};

// ── 토큰 ──────────────────────────────────────────────────────────

test('공유 토큰은 43자 base64url 이고 매번 다르다', () => {
  const a = generateShareToken();
  const b = generateShareToken();
  assert.equal(a.length, 43);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

test('토큰 해시는 결정적이고 pepper 에 의존한다', async () => {
  const t = 'fixed-token';
  const h1 = await hashShareToken(ENV, t);
  const h2 = await hashShareToken(ENV, t);
  const h3 = await hashShareToken({ SHARE_TOKEN_PEPPER: 'other' }, t);
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.equal(h1.length, 64); // sha256 hex
});

test('공유 URL 은 토큰을 fragment 에 싣는다 (쿼리스트링 아님)', () => {
  const url = buildShareUrl(ENV, 'ABC123');
  assert.equal(url, 'https://dadamfurniture.com/confirm.html#t=ABC123');
  assert.ok(!url.includes('?'), '쿼리스트링이면 Referer·크롤러 로그에 토큰이 남는다');
});

test('만료일은 기본 14일', () => {
  const iso = shareExpiryIso(ENV);
  const days = (new Date(iso) - Date.now()) / 86400000;
  assert.ok(days > 13.9 && days < 14.1, `실제 ${days}일`);
});

test('valid_days 를 주면 그 값을 쓴다', () => {
  const iso = shareExpiryIso(ENV, 3);
  const days = (new Date(iso) - Date.now()) / 86400000;
  assert.ok(days > 2.9 && days < 3.1);
});

// ── 접근 가능 여부 ────────────────────────────────────────────────

test('정상 문서는 열람 가능', () => {
  assert.deepEqual(checkAccessible({ status: 'issued', expires_at: null }), { ok: true });
});

test('회수/대체된 문서는 410', () => {
  assert.equal(checkAccessible({ status: 'revoked' }).status, 410);
  assert.equal(checkAccessible({ status: 'superseded' }).status, 410);
});

test('만료된 문서는 410', () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const r = checkAccessible({ status: 'issued', expires_at: past });
  assert.equal(r.status, 410);
  assert.equal(r.reason, 'expired');
});

test('없는 문서는 404', () => {
  assert.equal(checkAccessible(null).status, 404);
});

test('회수/대체 문서도 토큰 해시를 유지해야 410 분기에 도달한다', () => {
  // revokeDocument 가 share_token_hash 를 NULL 로 지우면 openSharedDocument 의
  // 토큰 조회가 실패해 404 가 나가고, 아래 410 분기는 영원히 실행되지 않는다.
  // 고객에게 "링크를 다시 확인하세요"(오타 의심) 대신 "재발급 요청" 안내가 가야 한다.
  const revoked = { status: 'revoked', share_token_hash: 'kept-hash', expires_at: null };
  assert.equal(checkAccessible(revoked).status, 410);
  assert.equal(checkAccessible(revoked).reason, 'revoked');
});

// ── PIN ───────────────────────────────────────────────────────────

test('PIN 이 없는 문서는 PIN 을 요구하지 않는다', async () => {
  const r = await verifyPin(ENV, { id: 'd1', access_pin_hash: null });
  assert.equal(r.ok, true);
});

test('올바른 PIN 은 통과하고 실패 카운트를 초기화한다', async () => {
  const doc = { id: 'd1', pin_fail_count: 3 };
  doc.access_pin_hash = await hashAccessPin(ENV, doc.id, '1234');
  const r = await verifyPin(ENV, doc, '1234');
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, { pin_fail_count: 0, pin_locked_at: null });
});

test('PIN 해시는 문서마다 다르다 — 다른 문서의 PIN 은 통과하지 못한다', async () => {
  const h1 = await hashAccessPin(ENV, 'doc-1', '1234');
  const h2 = await hashAccessPin(ENV, 'doc-2', '1234');
  assert.notEqual(h1, h2);

  const r = await verifyPin(ENV, { id: 'doc-2', access_pin_hash: h1 }, '1234');
  assert.equal(r.ok, false);
});

test('PIN 미입력은 401 pin_required', async () => {
  const doc = { id: 'd1', access_pin_hash: await hashAccessPin(ENV, 'd1', '1234') };
  const r = await verifyPin(ENV, doc, '');
  assert.equal(r.status, 401);
  assert.equal(r.reason, 'pin_required');
});

test('5회 실패하면 잠긴다', async () => {
  const doc = {
    id: 'd1',
    pin_fail_count: PIN_POLICY.maxFail - 1,
    access_pin_hash: await hashAccessPin(ENV, 'd1', '1234'),
  };
  const r = await verifyPin(ENV, doc, '9999');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pin_locked');
  assert.equal(r.status, 429);
  assert.equal(r.patch.pin_fail_count, PIN_POLICY.maxFail);
  assert.ok(r.patch.pin_locked_at);
});

test('잠금은 30분 뒤 풀린다', () => {
  const justNow = new Date().toISOString();
  assert.equal(isPinLocked({ pin_locked_at: justNow }), true);

  const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  assert.equal(isPinLocked({ pin_locked_at: old }), false);
});

test('잠긴 상태에서는 올바른 PIN 도 막힌다', async () => {
  const doc = {
    id: 'd1',
    pin_locked_at: new Date().toISOString(),
    access_pin_hash: await hashAccessPin(ENV, 'd1', '1234'),
  };
  const r = await verifyPin(ENV, doc, '1234');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pin_locked');
});

// ── 마스킹 ────────────────────────────────────────────────────────

test('고객명 마스킹', () => {
  assert.equal(maskName('홍길동'), '홍*동');
  assert.equal(maskName('김철수영'), '김**영');
  assert.equal(maskName('이수'), '이*');
  assert.equal(maskName('박'), '박');
  assert.equal(maskName(''), '');
  assert.equal(maskName(null), '');
});

// ── HTML 이스케이프 (XSS) ─────────────────────────────────────────

test('esc 는 HTML 특수문자를 전부 이스케이프한다', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(esc('a"b\'c&d'), 'a&quot;b&#39;c&amp;d');
  assert.equal(esc(null), '');
});

test('krw / ymd 포맷', () => {
  assert.equal(krw(1699500), '1,699,500원');
  assert.equal(krw(0), '0원', '진짜 0원은 0원으로 표시해야 한다');
  assert.equal(ymd('2026-08-03T01:00:00.000Z'), '2026-08-03');
  assert.equal(ymd(null), '-');
});

test('값이 없는 금액은 0원이 아니라 - 로 표시한다', () => {
  // Number(null) === 0 이라 방어하지 않으면 고객 문서에 "0원" 이 찍힌다
  assert.equal(krw(null), '-');
  assert.equal(krw(undefined), '-');
  assert.equal(krw(''), '-');
  assert.equal(krw('abc'), '-');
  assert.equal(num(null), '-');
  assert.equal(num(undefined), '-');
});

test('documentShell 은 title 을 이스케이프한다', () => {
  const html = documentShell({ title: '<img src=x onerror=alert(1)>', css: '', body: '' });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});

// ── 문서 렌더 ─────────────────────────────────────────────────────

function fixtures(overrides = {}) {
  const snapshot = {
    id: 's1',
    rev: 2,
    content_hash: 'abcdef0123456789',
    item_count: 1,
    module_count: 2,
    panel_count: 5,
    design_payload: {
      items: [
        {
          categoryId: 'sink',
          labelName: '싱크대',
          w: 3200,
          h: 2400,
          d: 650,
          specs: { doorFinishLower: 'pet-matte', doorColorLower: 'oak' },
          modules: [
            { pos: 'lower', type: 'sink', name: '개수대', w: 1000, h: 870, d: 600, doorCount: 1 },
            { pos: 'upper', type: 'hood', name: '후드장', w: 800, h: 720, d: 295 },
          ],
        },
      ],
    },
    bom_payload: {
      materials: [
        { itemLabel: '싱크대', module: '하부장1', part: '측판', material: 'PB', thickness: 15, w: 550, h: 870, qty: 2, edge: '4면' },
      ],
    },
    hardware_payload: {
      hardware: [{ category: '경첩', item: '문주 110도', manufacturer: '문주', spec: '2구', qty: 4, unit: 'EA' }],
    },
    quote_payload: {
      items: [{ name: '하부장 캐비닛', quantity: '3000mm', unit_price: 160000, total: 480000 }],
      subtotal: 480000,
      vat: 48000,
      total: 528000,
      range: { min: 501600, max: 686400 },
      skipped: [],
    },
    ...overrides.snapshot,
  };

  const doc = {
    id: 'd1',
    doc_no: 'DD-20260803-A1B2-CC-r1',
    doc_type: 'customer_confirmation',
    rev: 1,
    title: '김OO님 주방',
    customer_name: '홍길동',
    customer_name_masked: '홍*동',
    created_at: '2026-08-03T01:00:00.000Z',
    expires_at: '2026-08-17T01:00:00.000Z',
    render_payload: { quote: snapshot.quote_payload },
    decision: null,
    ...overrides.doc,
  };

  return { doc, snapshot };
}

test('고객확인서는 금액을 표시한다', () => {
  const { doc, snapshot } = fixtures();
  const html = renderCustomerConfirmation(doc, snapshot);
  assert.ok(html.includes('528,000원'), '합계가 있어야 한다');
  assert.ok(html.includes('홍*동'), '마스킹된 이름이어야 한다');
  assert.ok(!html.includes('홍길동'), '원본 이름이 공유 문서에 노출되면 안 된다');
});

test('작업지시서는 금액을 표시하지 않는다', () => {
  const { doc, snapshot } = fixtures({ doc: { doc_type: 'work_order', doc_no: 'DD-...-WO-r1' } });
  const html = renderWorkOrder(doc, snapshot);
  assert.ok(!html.includes('528,000'), '공장용 문서에 금액이 있으면 안 된다');
  assert.ok(!html.includes('480,000'));
  assert.ok(html.includes('측판'), '자재 목록은 있어야 한다');
  assert.ok(html.includes('문주 110도'), '부자재 목록도 있어야 한다');
});

test('작업지시서는 표 머리를 반복하도록 thead 를 쓴다', () => {
  const { doc, snapshot } = fixtures({ doc: { doc_type: 'work_order' } });
  const html = renderWorkOrder(doc, snapshot);
  assert.ok(html.includes('<thead>'), '여러 장에 걸칠 때 머리 반복이 필요하다');
  assert.ok(html.includes('display: table-header-group'));
});

test('A4 인쇄 규칙이 들어 있다', () => {
  const { doc, snapshot } = fixtures();
  const html = renderCustomerConfirmation(doc, snapshot);
  assert.ok(html.includes('@page { size: A4 portrait'));
  assert.ok(html.includes('@media print'));
});

test('설계명·모듈명의 스크립트가 이스케이프된다', () => {
  const { doc, snapshot } = fixtures({
    doc: { title: '<script>alert("xss")</script>' },
  });
  snapshot.design_payload.items[0].labelName = '<img src=x onerror=alert(1)>';
  const html = renderCustomerConfirmation(doc, snapshot);

  assert.ok(!html.includes('<script>alert'), '문서 제목이 스크립트로 실행되면 안 된다');
  assert.ok(!html.includes('<img src=x onerror'), '모듈 라벨도 마찬가지');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('승인된 문서는 스탬프를 보여준다', () => {
  const { doc, snapshot } = fixtures({
    doc: { decision: 'approved', decided_at: '2026-08-04T05:22:00.000Z', signer_name: '홍길동' },
  });
  const html = renderCustomerConfirmation(doc, snapshot);
  assert.ok(html.includes('확인 완료'));
  assert.ok(html.includes('2026-08-04 14:22'), 'KST 로 표시해야 한다');
});

test('단가표에 없는 품목은 별도 협의 안내로 드러낸다', () => {
  const { doc, snapshot } = fixtures();
  snapshot.quote_payload.skipped = [{ label: '창고장', category: 'warehouse' }];
  doc.render_payload.quote = snapshot.quote_payload;
  const html = renderCustomerConfirmation(doc, snapshot);
  assert.ok(html.includes('별도 협의'));
  assert.ok(html.includes('창고장'));
});
