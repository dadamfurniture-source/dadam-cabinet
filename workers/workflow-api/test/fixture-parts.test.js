// 설계에서 고른 설비 상품 — 시공 지시서 「설비」 표 · 상판 발주서 타공 줄의 이름
//   (2026-11-19 사장님 「개수대 모듈 클릭하면 수전, 싱크볼 … 선택 … 후드장도 … 가스대도」 · 질문 창 「앱으로 보낼 때 같이」)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FIXTURE_PARTS_MAX, FIXTURE_PART_LABELS, fixturePartNames, fixturePartText, fixturePartsOfItem, designAppliancesOf } from '../src/fixture-parts.js';
import { fixturePartsBlock, designAppliancesBlock } from '../src/templates/installation-order.js';

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
  assert.match(read('../src/templates/installation-order.js'), /<\/table>\$\{fixturePartsBlock\(items\)\}\$\{designAppliancesBlock\(design\)\}\s+\$\{layout2\(doc\) \? '' : installChecks\(doc, snapshot\)\}/);   // 고른 상품이 없으면 출력이 한 글자도 달라지지 않게 붙여 쓴다
  assert.match(read('../src/countertop.js'), /const partNames = fixturePartNames\(multiWall \? plannerWalls\.map\(\(x\) => x\.it\) : \[item\]\);/);
  const tpl = read('../src/templates/countertop-order.js');
  assert.match(tpl, /part \? `\$\{esc\(part\)\} <span class="muted">설계에서 고른 상품<\/span>`/);
  assert.match(tpl, /<td>\$\{modelName\(c\.model, c\.part\)\}<\/td>/);
});

test('설계 가전 목록 — 시공 지시서 「가전」 표 (플래너 design.appliances, 2026-11-20) · 없으면 칸째 없다 · 글은 그대로 글로', () => {
  assert.equal(designAppliancesBlock({}), '');
  assert.equal(designAppliancesBlock(null), '');
  assert.equal(designAppliancesBlock({ appliances: [{ label: '세탁기' }, 'x', { name: '라벨 없음', w: 600, h: 850 }] }), '');
  const design = { appliances: [
    { kind: 'dryer', label: '건조기', qty: 2, brand: '시험', name: '건조기 <20kg>', code: 'D-1', w: 686, d: 790, h: 990, price: 999 },
    { kind: 'washer', label: '세탁기', qty: 1, brand: '시험', name: '드럼', w: 686, h: 990, combo: { name: '직렬', kind: 'stack', kit: { name: '', code: 'KIT-1' },
      units: [{ brand: '시험', name: '드럼', code: 'W-1', w: 686, h: 990, role: 'lower' }, { brand: '시험', name: '건조', w: 686, h: 990, role: 'upper' }] } },
    { kind: 'fridge', label: '냉장고', qty: 1, brand: '시험', name: '1도어', w: 595, h: 1853, combo: { name: '나란히', kind: 'side', gap: 8,
      units: [{ brand: '시험', name: '1도어 냉장', w: 595, h: 1853 }, { brand: '시험', name: '1도어 김치', w: 595, h: 1853 }] } },
  ] };
  assert.deepEqual(designAppliancesOf(design).map((a) => [a.label, a.qty, a.text, a.size, a.combo]), [
    ['건조기', 2, '시험 건조기 <20kg> (D-1)', '686 × 790 × 990', ''],
    ['세탁기', 1, '직렬 — 아래 시험 드럼 (W-1) / 위 시험 건조', '', '쌓기 · 키트 KIT-1'],
    ['냉장고', 1, '나란히 — 시험 1도어 냉장 + 시험 1도어 김치', '', '나란히 2대 · 사이 8'],
  ]);
  const html = designAppliancesBlock(design);
  assert.match(html, /<h2>가전 <span class="hint">설계에 들어갈 가전<\/span><\/h2>/);
  assert.match(html, /건조기[\s\S]*시험 건조기 &lt;20kg&gt; \(D-1\)[\s\S]*686 × 790 × 990[\s\S]*2/);
  assert.equal(html.includes('999'), false);
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(read('../src/templates/installation-order.js'), /<\/table>\$\{fixturePartsBlock\(items\)\}\$\{designAppliancesBlock\(design\)\}/);
});
