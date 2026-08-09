/**
 * CD-4: 설치 도메인.
 *
 * 지금까지 작업지시서는 제작(공장)용 1종뿐이었다. 설치 팀에게 나갈 문서가
 * 없었고, 현장 정보(주소·층수·엘리베이터·반입경로·시공순서)를 담을 자리도
 * 전혀 없었다 — design_schedules.location 자유 텍스트 한 칸이 전부였다.
 *
 * doc_type 은 **세 곳이 동시에 맞아야** 한다:
 *   DB CHECK / DOC_TYPES 배열 / renderDocument 분기.
 * 하나만 고치면 발행이 500 으로 죽거나 빈 문서가 나간다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOC_TYPES, renderDocument } from '../src/documents.js';
import { normalizeSiteInfo } from '../src/site-info.js';
import { renderInstallationOrder } from '../src/templates/installation-order.js';

const SNAPSHOT = {
  rev: 3,
  content_hash: 'abcdef0123456789',
  design_payload: {
    items: [
      {
        labelName: '싱크대 #1',
        categoryId: 'sink',
        w: 3600, h: 2310, d: 650,
        modules: [
          { pos: 'lower', name: '개수대', w: 900, h: 708, d: 550, doorCount: 2, totalH: 870 },
          { pos: 'lower', name: '서랍장', w: 800, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 3 },
          { pos: 'upper', name: '상부장', w: 900, h: 720, d: 295, doorCount: 2, totalH: 780 },
        ],
      },
    ],
  },
};

const DOC = {
  doc_no: 'DD-20260809-AAAA-IO-r1',
  doc_type: 'installation_order',
  created_at: '2026-08-09T02:00:00.000Z',
  customer_name: '홍길동',
  render_payload: {},
};

const SITE = {
  address: '서울시 강남구 테헤란로 1',
  address_detail: '101동 1203호',
  floor: '12층',
  has_elevator: true,
  elevator_note: '화물용 별도',
  access_note: '지하주차장 진입 높이 2.1m',
  install_order: '1. 하부장 → 2. 상판 → 3. 상부장',
  contact_name: '홍길동',
  contact_phone: '010-0000-0000',
};

test('doc_type 3종이 등록돼 있다', () => {
  assert.deepEqual(DOC_TYPES, ['customer_confirmation', 'work_order', 'installation_order']);
});

test('renderDocument 가 설치 지시서로 분기한다', () => {
  const html = renderDocument({ ...DOC, render_payload: { site_info: SITE } }, SNAPSHOT, { toolbar: false });
  assert.match(html, /설치 작업지시서/);
  // 제작 지시서로 잘못 분기하면 자재 재단 목록이 나온다
  assert.ok(!/자재 재단/.test(html), '설치 문서에 자재 재단 목록이 있으면 안 된다');
});

test('현장 정보가 문서에 실린다', () => {
  const html = renderInstallationOrder({ ...DOC, render_payload: { site_info: SITE } }, SNAPSHOT, { toolbar: false });
  for (const v of ['테헤란로 1', '1203호', '12층', '화물용 별도', '2.1m', '하부장 → 2. 상판']) {
    assert.ok(html.includes(v), `${v} 가 문서에 있어야 한다`);
  }
});

test('미입력 항목은 눈에 띄게 표시한다', () => {
  // 현장에서 빈칸은 사고로 이어진다 — 조용히 비워두면 안 된다
  const html = renderInstallationOrder(DOC, SNAPSHOT, { toolbar: false, site: {} });
  assert.match(html, /주소 미입력/);
  assert.match(html, /반입 경로 미입력/);
  assert.match(html, /시공 순서 미입력/);
});

test('엘리베이터 미확인과 없음을 구분한다', () => {
  const none = renderInstallationOrder(DOC, SNAPSHOT, { toolbar: false, site: { has_elevator: false } });
  assert.match(none, /사다리차 검토/);
  const unknown = renderInstallationOrder(DOC, SNAPSHOT, { toolbar: false, site: {} });
  assert.match(unknown, /미확인/);
  assert.ok(!/사다리차 검토/.test(unknown), '미확인을 없음으로 단정하면 안 된다');
});

test('금액을 표시하지 않는다', () => {
  const withQuote = { ...DOC, render_payload: { site_info: SITE, quote: { total: 12345678 } } };
  const html = renderInstallationOrder(withQuote, SNAPSHOT, { toolbar: false });
  assert.ok(!html.includes('12,345,678'), '설치 지시서에 금액이 나가면 안 된다');
  assert.ok(!/공급가|부가세/.test(html));
});

test('서명란이 설치 기준이다 (제작 지시서와 다르다)', () => {
  const html = renderInstallationOrder({ ...DOC, render_payload: { site_info: SITE } }, SNAPSHOT, { toolbar: false });
  assert.match(html, /설치 담당/);
  assert.match(html, /고객 확인/);
  assert.ok(!/출고/.test(html), '출고는 제작 지시서의 서명란이다');
});

test('일정이 있으면 함께 싣는다', () => {
  const html = renderInstallationOrder(DOC, SNAPSHOT, {
    toolbar: false,
    site: SITE,
    schedules: [{ type: 'installation', scheduled_at: '2026-08-20T01:00:00.000Z', assignee_name: '김설치', status: 'planned' }],
  });
  assert.match(html, /관련 일정/);
  assert.match(html, /김설치/);
});

test('일정이 없으면 빈 표를 만들지 않는다', () => {
  const html = renderInstallationOrder(DOC, SNAPSHOT, { toolbar: false, site: SITE, schedules: [] });
  assert.ok(!/관련 일정/.test(html));
});

test('현장 정보 정규화 — 미확인/없음/있음 3상태', () => {
  assert.equal(normalizeSiteInfo({ has_elevator: null }).has_elevator, null);
  assert.equal(normalizeSiteInfo({ has_elevator: '' }).has_elevator, null);
  assert.equal(normalizeSiteInfo({ has_elevator: false }).has_elevator, false);
  assert.equal(normalizeSiteInfo({ has_elevator: true }).has_elevator, true);
});

test('알 수 없는 키는 버린다', () => {
  const out = normalizeSiteInfo({ address: '서울', evil: 'drop me', user_id: 'x' });
  assert.deepEqual(Object.keys(out), ['address']);
});

test('길이 상한을 DB 보다 먼저 막는다 (500 대신 400)', () => {
  assert.throws(() => normalizeSiteInfo({ address: '가'.repeat(201) }), /200자/);
  assert.doesNotThrow(() => normalizeSiteInfo({ address: '가'.repeat(200) }));
});

test('빈 문자열은 null 로 저장한다', () => {
  assert.equal(normalizeSiteInfo({ address: '   ' }).address, null);
});
