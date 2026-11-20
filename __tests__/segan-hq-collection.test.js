/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach, jest, __dirname */
/**
 * @jest-environment jsdom
 *
 * 마이페이지 › 플랫폼 › 시공사례 고르기 (segan/hq-collection.js, 2026-11-20 대표님 「연출컷은 본사에서 정하고 올릴 수 있도록」)
 *
 *   - 본사 구성원 · 사이트 관리자만 연다. 서버가 403 이면 칸째 감춘다, 409 db_pending 이면 「준비 중」
 *   - generate-api GET /api/hq/collection → 칸(사진 · 품목 · 문 색 · 상태 · 올리기/내리기), 탭(전체 · 올림 · 안 올림), 더 보기
 *   - 올리기 POST · 내리기 DELETE (가운데 창으로 한 번 더 묻는다)
 *   - 마이페이지에 메뉴 줄 · 칸 · 스크립트가 있다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = read('segan/hq-collection.js');
const API = 'https://gen.example/api/generate';
const BASE = 'https://gen.example';
const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const item = (i, picked) => ({
  id: id(i),
  created_at: '2026-11-20T01:00:00.000Z',
  place_label: i % 2 ? '붙박이장' : '싱크대',
  door_color: '월넛',
  image: `https://sb.example/sign/generations/x${i}.png?token=t`,
  picked,
  picked_at: picked ? '2026-11-20T02:00:00.000Z' : null,
});

let calls;
let answers;
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup({
  list = { success: true, items: [item(1, true), item(2, false)], next: null },
  status = 200,
} = {}) {
  document.body.innerHTML =
    '<section id="hqCollection" hidden><h2>시공사례 고르기</h2><div id="hqCollectionBody"></div></section>';
  window.DADAM_CONFIG = { generateApi: { url: API } };
  calls = [];
  answers = { list, status, act: { success: true, picked: true } };
  global.fetch = jest.fn(async (url, init) => {
    calls.push([init.method, url, init.headers.Authorization]);
    if (init.method === 'GET') return { status: answers.status, json: async () => answers.list };
    return { status: 200, json: async () => answers.act };
  });
  let dialog = null;
  window.SeganShell = {
    sheet: {
      open: (opts) => {
        dialog = opts;
        return { close: () => opts.onClose && opts.onClose() };
      },
    },
  };
  delete window.SeganHqCollection;
  new Function(SRC)();
  return { dialog: () => dialog };
}
const session = { access_token: 'tok' };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

describe('시공사례 고르기 칸', () => {
  beforeEach(() => jest.restoreAllMocks());

  test('본사 구성원 · 관리자만 — 아니면 서버에 묻지도 않고 감춘다', async () => {
    setup();
    await window.SeganHqCollection.load(
      null,
      session,
      { platform_member: false },
      { admin: false }
    );
    expect(calls).toEqual([]);
    expect($('#hqCollection').hidden).toBe(true);
    await window.SeganHqCollection.load(null, session, { platform_member: false }, { admin: true });
    expect(calls[0]).toEqual(['GET', `${BASE}/api/hq/collection`, 'Bearer tok']);
    expect($('#hqCollection').hidden).toBe(false);
  });

  test('목록: 사진 · 품목 · 문 색 · 상태 · 단추, 탭으로 거른다', async () => {
    setup();
    await window.SeganHqCollection.load(null, session, { platform_member: true });
    const cards = $$('.me-hc-card');
    expect(cards.map((c) => c.querySelector('.me-dc-head b').textContent)).toEqual([
      '붙박이장 · 월넛',
      '싱크대 · 월넛',
    ]);
    expect(cards.map((c) => c.querySelector('.me-badge').textContent)).toEqual(['올림', '안 올림']);
    expect(cards.map((c) => c.querySelector('[data-act]').textContent)).toEqual([
      '내리기',
      '시공사례에 올리기',
    ]);
    expect(cards[0].querySelector('img').getAttribute('src')).toBe(item(1).image);
    $('[data-tab="not"]').click();
    expect($$('.me-hc-card').map((c) => c.getAttribute('data-id'))).toEqual([id(2)]);
    $('[data-tab="picked"]').click();
    expect($$('.me-hc-card').map((c) => c.getAttribute('data-id'))).toEqual([id(1)]);
  });

  test('올리기 POST → 「올림」', async () => {
    setup();
    await window.SeganHqCollection.load(null, session, { platform_member: true });
    $(`[data-id="${id(2)}"] [data-act="pick"]`).click();
    await flush();
    await flush();
    expect(calls[1]).toEqual(['POST', `${BASE}/api/hq/collection/${id(2)}`, 'Bearer tok']);
    expect($(`[data-id="${id(2)}"] .me-badge`).textContent).toBe('올림');
  });

  test('내리기는 가운데 창으로 묻는다 — 취소면 그대로, 내리기면 DELETE', async () => {
    const s = setup();
    await window.SeganHqCollection.load(null, session, { platform_member: true });
    answers.act = { success: true, picked: false };
    $(`[data-id="${id(1)}"] [data-act="unpick"]`).click();
    await flush();
    expect(s.dialog().kind).toBe('dialog');
    s.dialog().body.querySelector('[data-confirm="no"]').click();
    await flush();
    expect(calls).toHaveLength(1);
    $(`[data-id="${id(1)}"] [data-act="unpick"]`).click();
    await flush();
    s.dialog().body.querySelector('[data-confirm="yes"]').click();
    await flush();
    await flush();
    expect(calls[1]).toEqual(['DELETE', `${BASE}/api/hq/collection/${id(1)}`, 'Bearer tok']);
    expect($(`[data-id="${id(1)}"] .me-badge`).textContent).toBe('안 올림');
  });

  test('더 보기 — next 시각으로 다음 쪽', async () => {
    setup({ list: { success: true, items: [item(1, true)], next: '2026-11-19T00:00:00.000Z' } });
    await window.SeganHqCollection.load(null, session, { platform_member: true });
    answers.list = { success: true, items: [item(3, false)], next: null };
    $('[data-act="more"]').click();
    await flush();
    await flush();
    expect(calls[1][1]).toBe(`${BASE}/api/hq/collection?before=2026-11-19T00%3A00%3A00.000Z`);
    expect($$('.me-hc-card')).toHaveLength(2);
    expect($('[data-act="more"]')).toBeNull();
  });

  test('403 이면 칸째 감추고, 409 db_pending 이면 「준비 중」', async () => {
    setup({ list: { success: false, code: 'not_hq' }, status: 403 });
    await window.SeganHqCollection.load(null, session, { platform_member: true });
    expect($('#hqCollection').hidden).toBe(true);
    setup({ list: { success: false, code: 'db_pending' }, status: 409 });
    await window.SeganHqCollection.load(null, session, { platform_member: true });
    expect($('#hqCollection').hidden).toBe(false);
    expect($('#hqCollectionBody').textContent).toMatch(/준비 중/);
  });
});

describe('마이페이지 연결', () => {
  test('메뉴 줄 · 칸 · 스크립트 · me.js 등록', () => {
    const html = read('segan/me.html');
    const js = read('segan/me.js');
    expect(html).toMatch(/<script src="hq-collection\.js\?v=\d+" defer><\/script>/);
    expect(html).toContain('data-me-item="hq-collection"');
    expect(html).toContain('id="hqCollection"');
    expect(html).toContain('id="hqCollectionBody"');
    expect(js).toContain("'hq-collection': { title: '시공사례 고르기', section: 'hqCollection' }");
    expect(js).toMatch(
      /case 'hq-collection':\s*return \(v\.platform \|\| roles\.admin === true\) && available\(key\);/
    );
    expect(js).toContain('window.SeganHqCollection');
  });
});
