/**
 * 관리자 「거래처 · 공급처」 (admin/counterparties.html) — 경영 대시보드 2단계 PR-8.
 * 페이지 스크립트를 jsdom 에 올리고 workflow-api 는 가짜 fetch 로 대신한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'admin/counterparties.html'), 'utf8');
const SCRIPT = HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n      (function'));
const API = 'https://api.test';
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

const ITEMS = [
  { id: 'p1', kind: 'partner', name: '한빛인테리어', category: null, phone: '010-1', memo: null, active: true },
  { id: 's1', kind: 'supplier', name: '상일', category: 'door', phone: null, memo: '도어 외주', active: true },
  { id: 's2', kind: 'supplier', name: '옛 철물점', category: 'hardware', phone: null, memo: null, active: false },
];

function boot({ items = ITEMS, admin = true } = {}) {
  document.body.innerHTML = BODY.replace(/<script src="\.\.\/js\/admin-shell\.js"><\/script>/, '');
  window.DADAM_CONFIG = { supabase: { url: 'https://sb', anonKey: 'k' }, workflowApi: { url: API } };
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'T', user: { email: 'a@b.c' } } } }) } }) };
  window.AdminAccess = { isAdmin: async () => admin };
  window.__COUNTERPARTIES_NO_AUTOSTART = true;
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url: String(url).replace(API, ''), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const data = (init.method || 'GET') === 'GET' ? { items } : { id: 'new' };
    return { ok: true, status: 200, json: async () => ({ success: true, data }) };
  });
  (0, eval)(SCRIPT);
  return calls;
}
const rows = (id) => [...document.querySelectorAll(`#${id} tbody tr`)].map((r) => [...r.cells].slice(0, -1).map((c) => c.textContent.trim()));

test('관리자가 아니면 들어올 수 없다', async () => {
  boot({ admin: false });
  await window.Counterparties.init();
  expect(document.getElementById('accessDenied').style.display).toBe('block');
});

test('거래처 · 공급처를 따로 보이고, 공급처는 갈래를 우리말로, 숨긴 것은 흐리게', async () => {
  boot();
  await window.Counterparties.init();
  await settle();
  expect(rows('tblPartner')).toEqual([['한빛인테리어', '010-1', '-']]);
  expect(rows('tblSupplier')).toEqual([['상일', '도어', '-', '도어 외주'], ['옛 철물점', '철물', '-', '-']]);
  expect(document.querySelector('#tblSupplier tr[data-id="s2"]').className).toBe('off');
  expect(document.querySelector('[data-toggle="s2"]').textContent).toBe('다시 쓰기');
});

test('넣기: 공급처는 갈래와 함께, 거래처는 갈래 칸이 숨는다', async () => {
  const calls = boot();
  await window.Counterparties.init();
  await settle();
  expect(document.getElementById('fCategory').hidden).toBe(true);
  document.getElementById('fKind').value = 'supplier';
  document.getElementById('fKind').dispatchEvent(new window.Event('change'));
  expect(document.getElementById('fCategory').hidden).toBe(false);
  document.getElementById('fName').value = '대리석공방';
  document.getElementById('fCategory').value = 'countertop';
  document.getElementById('btnSave').click();
  await settle();
  const post = calls.find((c) => c.method === 'POST');
  expect(post.url).toBe('/counterparties');
  expect(post.body).toEqual({ kind: 'supplier', name: '대리석공방', phone: '', memo: '', category: 'countertop' });
});

test('고치기: 폼에 채우고 종류는 잠근다 → PATCH', async () => {
  const calls = boot();
  await window.Counterparties.init();
  await settle();
  document.querySelector('[data-edit="s1"]').click();
  expect(document.getElementById('fName').value).toBe('상일');
  expect(document.getElementById('fKind').disabled).toBe(true);
  expect(document.getElementById('btnSave').textContent).toBe('저장');
  document.getElementById('fName').value = '상일도어';
  document.getElementById('btnSave').click();
  await settle();
  const p = calls.find((c) => c.method === 'PATCH');
  expect(p.url).toBe('/counterparties/s1');
  expect(p.body).toEqual({ name: '상일도어', phone: '', memo: '도어 외주', category: 'door' });
});

test('숨기기 · 다시 쓰기는 active 만 바꾼다', async () => {
  const calls = boot();
  await window.Counterparties.init();
  await settle();
  document.querySelector('[data-toggle="p1"]').click();
  await settle();
  expect(calls.find((c) => c.method === 'PATCH').body).toEqual({ active: false });
});

test('표가 아직 없으면(items null) 편집 대신 SQL 안내', async () => {
  boot({ items: null });
  await window.Counterparties.init();
  await settle();
  expect(document.getElementById('needSql').hidden).toBe(false);
  expect(document.getElementById('editor').hidden).toBe(true);
});

test('이름은 esc 를 거친다', async () => {
  boot({ items: [{ id: 'x', kind: 'partner', name: '<img src=x onerror=alert(1)>', active: true }] });
  await window.Counterparties.init();
  await settle();
  expect(document.querySelector('#tblPartner img')).toBeNull();
});
