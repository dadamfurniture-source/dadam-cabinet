/**
 * 작업자 필수 확인 목록 정본 (src/work/check-items.js) — 문서 표(docs/design-rules/work-checks.md)와 같다,
 * v0 은 지금 종이 칸 그대로 (재단 꾸러미 원장 · ⑥ 조립 순서 체크 · 시공 지시서 서명), 발행 때 고정 · 옛 문서는 v0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CHECK_LISTS, CHECK_LIST_VERSION, CHECK_ROLES, CHECK_SCOPES, frozenCheckList, checkListOfDoc, itemsFor, itemApplies } from '../src/work/check-items.js';
import { ASSEMBLY_STEPS } from '../src/templates/work-order.js';

const DOC = fs.readFileSync(new URL('../../../docs/design-rules/work-checks.md', import.meta.url), 'utf8');

/** 문서의 판 표 줄 → [판, 역할, 키, 항목, 범위, 조건, 필수, 사진] */
function docRows() {
  return DOC.split(/\r?\n/)
    .filter((l) => /^\| v\d+ \|/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

test('문서 표 = 코드 정본 (판 · 역할 · 키 · 항목 · 범위 · 조건 · 필수 · 사진)', () => {
  const code = [];
  Object.entries(CHECK_LISTS).forEach(([v, roles]) => CHECK_ROLES.forEach((r) => roles[r].forEach((x) => code.push([v, r, x.key, x.label, x.scope, x.when || '', x.must ? '예' : '아니오', x.photo]))));
  assert.deepEqual(docRows(), code);
});

test('항목 모양 — 키는 DB 모양 · 판 안에서 유일, 범위 · 사진 값', () => {
  Object.values(CHECK_LISTS).forEach((roles) => {
    const keys = CHECK_ROLES.flatMap((r) => roles[r].map((x) => x.key));
    assert.equal(new Set(keys).size, keys.length);
    keys.forEach((k) => assert.match(k, /^[a-z0-9-]{1,64}$/));
    CHECK_ROLES.forEach((r) => roles[r].forEach((x) => {
      assert.ok(CHECK_SCOPES.includes(x.scope));
      assert.ok(['none', 'opt', 'need'].includes(x.photo));
    }));
  });
  assert.ok(CHECK_LISTS[CHECK_LIST_VERSION], '새 문서 판이 있다');
});

test('v0 = 지금 종이 칸 — 원장 「재단 · 엣지 표시」, ⑥ 조립 순서 칸, 시공 서명 칸', () => {
  const v0 = frozenCheckList('v0');
  assert.deepEqual(itemsFor(v0, 'cut', 'sheet').map((x) => x.label), ['재단', '엣지 표시']);
  assert.deepEqual(ASSEMBLY_STEPS, ['재단', '엣지', '조립', '도어 달기', '서랍', '검수·포장']);
  assert.deepEqual(itemsFor(v0, 'install', 'order').map((x) => x.label), ['설치 담당', '검수', '고객 확인']);
  assert.deepEqual(itemsFor(v0, 'edge'), []);
});

test('도어 · 서랍 조건 — 종이의 「—」 칸과 같다', () => {
  const [door] = itemsFor(frozenCheckList('v0'), 'assembly').filter((x) => x.when === 'door');
  const [drawer] = itemsFor(frozenCheckList('v0'), 'assembly').filter((x) => x.when === 'drawer');
  assert.equal(itemApplies(door, { doorCount: 2 }), true);
  assert.equal(itemApplies(door, { doorCount: 0 }), false);
  assert.equal(itemApplies(drawer, { isDrawer: true }), true);
  assert.equal(itemApplies(drawer, {}), false);
  assert.equal(itemApplies({ key: 'x' }, {}), true);
});

test('문서에 고정한 판을 읽고, 없으면(옛 문서) v0', () => {
  const fixed = frozenCheckList();
  assert.equal(checkListOfDoc({ render_payload: { check_list: fixed } }), fixed);
  assert.equal(checkListOfDoc({ render_payload: {} }).version, 'v0');
  assert.equal(checkListOfDoc(null).version, 'v0');
  assert.throws(() => frozenCheckList('v9'), /모르는 확인 목록 판/);
  fixed.roles.cut[0].label = '바꿈';
  assert.equal(CHECK_LISTS.v0.cut[0].label, '재단', '고정본을 고쳐도 정본은 그대로');
});
