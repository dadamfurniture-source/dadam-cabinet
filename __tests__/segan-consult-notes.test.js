/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 마이페이지 「AI 상담 기록」 (segan/consult-notes.js · segan/me.js #consult-notes, DB 0081).
 *   2026-11-23 대표님 「상담내역은 마이페이지에 정리본 자동저장해 줘」
 *   - 내 계정 셋째 줄 (내 연출컷 · 좋아요 다음) → 하위 화면 #consult-notes
 *   - make_consult_notes 본인 줄 · 고친 때 최신순 20개씩 (처음 열 때 읽는다), 「더 보기」는 마지막 updated_at 보다 앞 것
 *   - 줄마다 「지우기」 → 그 자리에서 한 번 더 묻고 지운다 (취소에 먼저 손이 간다)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION = { access_token: 'tok-1', user: { id: ME, email: 'me@example.com' } };
const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

function notes(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: uid(i),
    category: i % 2 ? 'wardrobe' : 'sink',
    brief: i === 0 ? '<b>정수기</b>가 들어가고 월넛 도어' : `정리본 ${i}`,
    updated_at: new Date(Date.UTC(2026, 10, 23, 5) - i * 60000).toISOString(),
  }));
}

async function load(options = {}) {
  const opts = { url: '/segan/me.html#consult-notes', rows: notes(3), fail: 0, delFail: false, ...options };
  window.history.replaceState(null, '', opts.url);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of ['SeganShell', 'SeganMe', 'SeganPostView', 'SeganMake', 'SeganPartner', 'SeganConsultNotes'])
    delete window[k];
  delete window.matchMedia;
  window.DADAM_CONFIG = { supabase: { url: 'https://example.supabase.co', anonKey: 'anon' } };
  const calls = { notes: [] };
  const left = { fail: opts.fail };
  let rows = opts.rows.slice();
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: SESSION } }),
        signOut: async () => {},
      },
      rpc: async () => ({ data: null, error: { message: 'x' } }),
      from: (table) => {
        const q = { table, op: 'select', filters: [], order: null, limit: null };
        if (table === 'make_consult_notes') calls.notes.push(q);
        const out = () => {
          if (table === 'profiles') return { data: { tier: 'standard', name: '' }, error: null };
          if (table === 'consultations') return { data: [], error: null };
          if (table !== 'make_consult_notes') return { data: null, error: null };
          if (q.op === 'delete') {
            if (opts.delFail) return { data: null, error: { message: 'no' } };
            const id = q.filters.find((f) => f[0] === 'eq' && f[1] === 'id')[2];
            rows = rows.filter((r) => r.id !== id);
            return { data: null, error: null };
          }
          if (left.fail > 0) {
            left.fail--;
            return { data: null, error: { message: 'relation does not exist' } };
          }
          const lt = q.filters.find((f) => f[0] === 'lt');
          return { data: rows.filter((r) => !lt || r.updated_at < lt[2]).slice(0, q.limit), error: null };
        };
        const chain = {
          select: () => chain,
          order: (c, o) => {
            q.order = [c, o];
            return chain;
          },
          limit: (n) => {
            q.limit = n;
            return chain;
          },
          eq: (c, v) => {
            q.filters.push(['eq', c, v]);
            return chain;
          },
          lt: (c, v) => {
            q.filters.push(['lt', c, v]);
            return chain;
          },
          in: () => chain,
          delete: () => {
            q.op = 'delete';
            return chain;
          },
          maybeSingle: async () => out(),
          then: (resolve, reject) => Promise.resolve(out()).then(resolve, reject),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  for (const f of ['segan/consult-notes.js', 'segan/shell.js', 'segan/me.js']) (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const items = () =>
  [...document.querySelectorAll('#meNotes .cn-item')].map((li) => [
    li.querySelector('.cn-head b').textContent,
    li.querySelector('.cn-brief').textContent,
  ]);

describe('마이페이지 「AI 상담 기록」', () => {
  test('내 계정 — 좋아요 다음 줄, 누르면 #consult-notes 화면 (제목 AI 상담 기록)', async () => {
    await load({ url: '/segan/me.html' });
    const li = document.querySelector('[data-me-item="consult-notes"]');
    expect(li.previousElementSibling.getAttribute('data-me-item')).toBe('likes');
    expect(li.querySelector('a').getAttribute('href')).toBe('#consult-notes');
    expect(li.hidden).toBe(false);
  });

  test('처음 열 때 본인 줄을 고친 때 최신순 20개 — 품목 이름 · 정리본은 글자로만', async () => {
    const calls = await load();
    expect(calls.notes).toHaveLength(1);
    expect(calls.notes[0].filters).toEqual([['eq', 'user_id', ME]]);
    expect(calls.notes[0].order).toEqual(['updated_at', { ascending: false }]);
    expect(calls.notes[0].limit).toBe(20);
    expect(items()).toEqual([
      ['싱크대', '<b>정수기</b>가 들어가고 월넛 도어'],
      ['붙박이장', '정리본 1'],
      ['싱크대', '정리본 2'],
    ]);
    expect(document.querySelector('#meNotes b b')).toBeNull(); // HTML 을 넣지 않는다
    expect($('meNoteEmpty').hidden).toBe(true);
    expect($('meNoteMore').hidden).toBe(true); // 한 쪽이 덜 찼다 — 끝
    expect($('meTitle').textContent).toBe('AI 상담 기록');
  });

  test('20개가 넘으면 「더 보기」 — 다음 쪽은 마지막 updated_at 보다 앞 것', async () => {
    const calls = await load({ rows: notes(25) });
    expect(items()).toHaveLength(20);
    expect($('meNoteMore').hidden).toBe(false);
    $('meNoteMore').click();
    await flush();
    expect(calls.notes[1].filters).toContainEqual(['lt', 'updated_at', notes(25)[19].updated_at]);
    expect(items()).toHaveLength(25);
    expect($('meNoteMore').hidden).toBe(true);
  });

  test('없으면 빈 안내, 못 읽으면(0081 적용 전) 안내 · 「다시 불러오기」', async () => {
    await load({ rows: [] });
    expect($('meNoteEmpty').hidden).toBe(false);
    await load({ fail: 1 });
    expect($('meNoteState').textContent).toBe('상담 기록을 불러오지 못했습니다.');
    expect($('meNoteMore').textContent).toBe('다시 불러오기');
    $('meNoteMore').click();
    await flush();
    expect(items()).toHaveLength(3);
  });

  test('지우기 — 그 자리에서 한 번 더 묻고(취소에 먼저), 취소하면 그대로 · 지우면 빼고 알린다', async () => {
    const calls = await load();
    const li = () => document.querySelector(`.cn-item[data-id="${uid(1)}"]`);
    li().querySelector('[data-del]').click();
    expect(li().querySelector('.cn-ask').textContent).toMatch('지우면 되돌릴 수 없습니다');
    expect(document.activeElement).toBe(li().querySelector('[data-del-no]'));
    li().querySelector('[data-del-no]').click();
    expect(li().querySelector('.cn-ask')).toBeNull();
    li().querySelector('[data-del]').click();
    li().querySelector('[data-del-yes]').click();
    await window.SeganConsultNotes.removing;
    const del = calls.notes.find((q) => q.op === 'delete');
    expect(del.filters).toEqual([
      ['eq', 'id', uid(1)],
      ['eq', 'user_id', ME],
    ]);
    expect(items().map((r) => r[1])).toEqual(['<b>정수기</b>가 들어가고 월넛 도어', '정리본 2']);
    expect($('meNoteState').textContent).toBe('지웠습니다.');
  });

  test('품목 이름 표는 만들기(segan/make.js KINDS)와 같다', async () => {
    await load();
    const src = read('segan/make.js').match(/var KINDS = \[([\s\S]*?)\];/)[1];
    const kinds = {};
    for (const m of src.matchAll(/key: '([a-z]+)', label: '([^']+)'/g)) kinds[m[1]] = m[2];
    expect(window.SeganConsultNotes.KIND_LABELS).toEqual(kinds);
  });

  test('못 지우면 줄을 남기고 안내', async () => {
    await load({ delFail: true });
    document.querySelector('[data-del]').click();
    document.querySelector('[data-del-yes]').click();
    await window.SeganConsultNotes.removing;
    expect(items()).toHaveLength(3);
    expect($('meNoteState').textContent).toBe('지우지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
  });
});
