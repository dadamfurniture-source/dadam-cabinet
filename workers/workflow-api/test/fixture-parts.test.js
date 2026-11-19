// 설계에서 고른 설비 상품 — 시공 지시서 「설비」 표 · 상판 발주서 타공 줄의 이름
//   (2026-11-19 사장님 「개수대 모듈 클릭하면 수전, 싱크볼 … 선택 … 후드장도 … 가스대도」 · 질문 창 「앱으로 보낼 때 같이」)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FIXTURE_PARTS_MAX, FIXTURE_PART_LABELS, fixturePartNames, fixturePartText, fixturePartsOfItem } from '../src/fixture-parts.js';
import { fixturePartsBlock } from '../src/templates/installation-order.js';

const part = (slot, name, patch = {}) => ({ slot, label: '보낸 이름은 안 쓴다', name, vendor: '시험 상사', option: '', price: 999, ...patch });
const item = (labelName, parts) => ({ labelName, categoryId: 'sink', specs: { fixtureParts: parts }, modules: [] });

test('품목의 설비 상품 — 아는 자리 · 이름 있는 줄만, 글은 다듬고 값 같은 모르는 칸은 버린다', () => {
  const it = item('공간 A', [
    part('sink', '  백조   DS850 ', { option: ' 900 ' }), part('faucet', '시험 수전'), part('oven', '모르는 자리'), part('hood', ''), null, 'x',
    part('cooktop', 'x'.repeat(300), { vendor: 'v'.repeat(80), option: 'o'.repeat(200) }),
  ]);
  const got = fixturePartsOfItem(it);
  assert.deepEqual(got.slice(0, 2), [
    { slot: 'sink', label: '싱크볼', name: '백조 DS850', vendor: '시험 상사', option: '900' },
    { slot: 'faucet', label: '수전', name: '시험 수전', vendor: '시험 상사', option: '' },
  ]);
  assert.deepEqual([got.length, got[2].slot, got[2].name.length, got[2].vendor.length, got[2].option.length], [3, 'cooktop', 160, 40, 80]);
  assert.equal(fixturePartText(got[0]), '백조 DS850 (900)');
  assert.equal(fixturePartText(got[1]), '시험 수전');
  for (const bad of [null, {}, { specs: null }, { specs: { fixtureParts: 'x' } }, { specs: { fixtureParts: {} } }]) assert.deepEqual(fixturePartsOfItem(bad), []);
  assert.equal(fixturePartsOfItem(item('많음', Array.from({ length: 100 }, (_, i) => part('hood', `후드 ${i}`)))).length, FIXTURE_PARTS_MAX);
  assert.deepEqual(Object.keys(FIXTURE_PART_LABELS), ['sink', 'faucet', 'cooktop', 'hood']);
});

test('자리마다 이름 — 여러 벽의 것을 모으고 같은 상품은 한 번, 다른 상품은 나란히', () => {
  const names = fixturePartNames([
    item('공간 A', [part('sink', '볼 가', { option: '900' }), part('faucet', '수전 가')]),
    item('공간 B', [part('sink', '볼 가', { option: '900' }), part('sink', '볼 나'), part('cooktop', '쿡탑 가')]),
    item('공간 C', []),
  ]);
  assert.deepEqual(names, { sink: '볼 가 (900) / 볼 나', faucet: '수전 가', cooktop: '쿡탑 가' });
  assert.deepEqual(fixturePartNames(null), {});
});

test('시공 지시서 「설비」 표 — 고른 상품이 있을 때만, 글은 그대로 글로', () => {
  assert.equal(fixturePartsBlock([item('공간 A', []), { labelName: '공간 B' }]), '');
  assert.equal(fixturePartsBlock(null), '');
  const html = fixturePartsBlock([item('공간 A', [part('sink', '<b>볼</b>', { option: '900' }), part('hood', '시험 후드', { vendor: '' })])]);
  assert.match(html, /<h2>설비 <span class="hint">설계에서 고른 상품<\/span><\/h2>/);
  assert.match(html, /공간 A[\s\S]*싱크볼[\s\S]*&lt;b&gt;볼&lt;\/b&gt; \(900\)[\s\S]*시험 상사/);
  assert.match(html, /후드[\s\S]*시험 후드[\s\S]*<td[^>]*>-<\/td>/);
  assert.equal(html.includes('999'), false);   // 값은 적지 않는다
});

test('이어진 곳 — 시공 지시서 설치 품목 아래 · 상판 발주서 타공 줄의 모델 칸', () => {
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(read('../src/templates/installation-order.js'), /<\/table>\$\{fixturePartsBlock\(items\)\}\s+\$\{installChecks\(doc, snapshot\)\}/);   // 고른 상품이 없으면 출력이 한 글자도 달라지지 않게 붙여 쓴다
  assert.match(read('../src/countertop.js'), /const partNames = fixturePartNames\(multiWall \? plannerWalls\.map\(\(x\) => x\.it\) : \[item\]\);/);
  const tpl = read('../src/templates/countertop-order.js');
  assert.match(tpl, /part \? `\$\{esc\(part\)\} <span class="muted">설계에서 고른 상품<\/span>`/);
  assert.match(tpl, /<td>\$\{modelName\(c\.model, c\.part\)\}<\/td>/);
});
