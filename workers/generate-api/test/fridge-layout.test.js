/**
 * 냉장고장 일반 모드 (2026-10-20 사장님 결정 D1~D5).
 *   D1 기본 = 브랜드별 4도어 + 3도어 김치냉장고 · D2 개별(중간장·하부장 따로) · D3 앞면 한 면 · D5 색 패널은 문짝 색에 가깝게
 * 정본: docs/design-rules/fridge.md §2 · data-constants.js FRIDGE_RULES (글자로 대조) · 플래너 fridgeNichesOf 자리 셈.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FRIDGE_DEFAULT_MODELS,
  FRIDGE_DEFAULT_SIDE_GAP,
  FRIDGE_RULES,
  buildInstallPrompt,
  buildVariantPrompt,
  fridgeLayout,
  fridgeModelFromRow,
  fridgeModelsOf,
  fridgeSpecText,
  wardrobeModules,
} from '../src/prompts.js';
import * as P from '../src/prompts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const constants = fs.readFileSync(path.join(here, '../../../js/detaildesign/data-constants.js'), 'utf8');
const BASE = { category: 'fridge', wallW: 3000, wallH: 2400, style: 'modern-minimal', doorColor: 'white', doorFinish: 'matte', refCount: 0, fridgeBrand: 'Samsung', fridgePosition: 'left' };

test('상수가 정본 data-constants FRIDGE_RULES 와 같다', () => {
  const block = constants.slice(constants.indexOf('const FRIDGE_RULES = {'));
  const num = (k) => Number(block.match(new RegExp(`${k}:\\s*(\\d+)`))[1]);
  assert.equal(FRIDGE_RULES.MAX_UPPER_H, num('MAX_UPPER_H'));
  assert.equal(FRIDGE_RULES.PEDESTAL_H, num('PEDESTAL_H'));
  assert.equal(FRIDGE_RULES.MOLDING_H, num('MOLDING_H'));
  assert.equal(FRIDGE_RULES.TOP_GAP, num('TOP_GAP'));
  assert.equal(FRIDGE_RULES.INSTALL_D, num('INSTALL_D'));
  for (const [k, side] of [['LG_BUILTIN', 4], ['SS_BESPOKE', 12], ['SS_INFINITE', 5]]) {
    assert.ok(block.includes(`${k}: { side: ${side},`), k);
    assert.equal(FRIDGE_DEFAULT_SIDE_GAP[k], side);
  }
});

test('D1 기본 세트: 브랜드마다 4도어 냉장고 + 3도어 김치냉장고 하나씩, 치수·코드 있음', () => {
  for (const b of ['Samsung', 'LG']) {
    const set = FRIDGE_DEFAULT_MODELS[b];
    assert.equal(set.length, 2);
    assert.deepEqual(set.map((m) => m.kind), ['fridge', 'kimchi']);
    assert.deepEqual(set.map((m) => m.doors), [4, 3]);
    for (const m of set) assert.ok(m.code && m.widthMm > 0 && m.heightMm > 0 && m.depthMm > 0 && m.sideGap >= 0 && m.topGap >= 0, m.code);
  }
  assert.equal(fridgeModelsOf({ fridgeBrand: 'LG' }), FRIDGE_DEFAULT_MODELS.LG);
  assert.equal(fridgeModelsOf({ fridgeBrand: 'Samsung' }), FRIDGE_DEFAULT_MODELS.Samsung);
  assert.equal(fridgeModelsOf({}), FRIDGE_DEFAULT_MODELS.Samsung);
});

test('자리 폭 = 옆 + 냉장고 + 사이(큰 옆 여유) + 냉장고 + 옆 + 6 · 높이는 fridge.md §2', () => {
  const L = fridgeLayout(3000, 2400, FRIDGE_DEFAULT_MODELS.Samsung, 'left');
  assert.equal(L.nicheW, 12 + 912 + 12 + 695 + 12 + 6);
  assert.equal(L.upperH, Math.min(400, 2400 - 1853 - 15 - 50));
  assert.equal(L.bodyH, 2400 - 50 - 400 - 60);
  assert.equal(L.midH, Math.floor(L.bodyH * 0.55));
  assert.equal(L.lowerH, L.bodyH - L.midH);
  assert.equal(L.rest, 3000 - L.nicheW);
  assert.deepEqual(L.columns, wardrobeModules(L.rest).modules);
  // 낮은 천장이면 상부장이 줄어든다
  const low = fridgeLayout(3000, 2250, FRIDGE_DEFAULT_MODELS.LG, 'left');
  assert.equal(low.fridges[0].upperH, 2250 - 1860 - 9 - 50);
  assert.equal(low.upperH, low.fridges[0].upperH);
});

test('두 대가 안 들어가면 4도어만 · 우측이면 4도어가 바깥쪽(오른쪽 끝)', () => {
  const one = fridgeLayout(1500, 2400, FRIDGE_DEFAULT_MODELS.Samsung, 'left');
  assert.equal(one.fridges.length, 1);
  assert.equal(one.fridges[0].kind, 'fridge');
  assert.equal(one.nicheW, 12 + 912 + 12 + 6);
  const right = fridgeLayout(3000, 2400, FRIDGE_DEFAULT_MODELS.LG, 'right');
  assert.deepEqual(right.fridges.map((m) => m.kind), ['kimchi', 'fridge']);
  assert.equal(right.upperH, right.fridges[1].upperH);
  assert.equal(fridgeLayout(600, 2400, FRIDGE_DEFAULT_MODELS.LG, 'left').columns.length, 0);
});

test('지시문: 모델·치수·자리 폭·단 높이·한 면·색 패널 (D2·D3·D5)', () => {
  const t = fridgeSpecText(BASE);
  assert.match(t, /Samsung BESPOKE four-door french-door refrigerator \(model RM70F63R2A, 912 × 1853 × 697 mm\)/);
  assert.match(t, /Samsung BESPOKE stand-type kimchi refrigerator with three doors \(model RQ33HB7411A/);
  assert.match(t, /one open recess 1649 mm wide/);
  assert.match(t, /Both have flat colour panels in a tone close to white/);
  assert.match(t, /a plinth 60 mm, a lower door 851 mm high, a middle door 1039 mm high above it, and the same 400 mm wall cabinet on top/);
  assert.match(t, /sit in one flush plane/);
  assert.match(t, /50 mm crown moulding/);
  const lg = fridgeSpecText({ ...BASE, fridgeBrand: 'LG', fridgePosition: 'right', doorColor: 'sage green' });
  assert.match(lg, /On the right end/);
  assert.match(lg, /an LG Objet Collection stand-type kimchi refrigerator .* and, next to it, an LG Objet Collection four-door/);
  assert.match(lg, /tone close to sage green/);
  assert.doesNotMatch(lg, /\ba LG\b/);
  // 색 패널이 없는 라인은 제 색
  const plain = fridgeSpecText({ ...BASE, fridgeModels: [{ brand: 'LG', name: 'LG 프렌치 디오스', code: 'F756SI14', subtype: 'french_4door', line: '디오스', widthMm: 908, heightMm: 1785, depthMm: 802, sideGap: 50, topGap: 15, doors: 4, kind: 'fridge' }] });
  assert.match(plain, /It has its own factory finish/);
  assert.match(plain, /one open recess 1014 mm wide/);
});

test('설치 지시문: 제품 사진이 있으면 맨 뒤로 가리키고 참고 이미지는 자리로, 없으면 옛 문장', () => {
  const p = buildInstallPrompt({ ...BASE, refCount: 1, fridgePhotos: [{ code: 'A1' }, { code: 'B2' }] });
  assert.match(p, /The image right after the first photo is a style reference/);
  assert.match(p, /The last 2 images are product photos of the refrigerators \(model A1, model B2, in that order\)/);
  const one = buildInstallPrompt({ ...BASE, fridgePhotos: [{ code: 'A1' }] });
  assert.match(one, /The last image is a product photo of the refrigerator \(model A1, in that order\)/);
  const none = buildInstallPrompt({ ...BASE, refCount: 2 });
  assert.match(none, /The additional images are style reference/);
  assert.doesNotMatch(none, /product photo/);
});

test('추천안: 냉장고장만 색 패널 줄이 붙는다 (D5), 다른 품목은 옛 문장 그대로', () => {
  const f = { body: 'warm oak', accent: 'white' };
  assert.match(buildVariantPrompt(f, { fridgePanels: true }), /Refrigerator fronts, only if the refrigerator has flat colour panels: a tone close to warm oak; a stainless, glass or patterned refrigerator keeps its own finish/);
  assert.doesNotMatch(buildVariantPrompt(f), /Refrigerator/);
  assert.equal(buildVariantPrompt(f), buildVariantPrompt(f, {}));
});

test('appliance_models 행 → 모델: 여유는 표 → 라인 기본, 문 수는 이름 → subtype', () => {
  const m = fridgeModelFromRow({ brand: '삼성', model_name: 'Bespoke 김치플러스 3도어 키친핏 313L', model_code: 'RQ33HB7411A', subtype: 'kimchi_stand', line: 'BESPOKE', width_mm: 695, height_mm: 1853, depth_mm: 600, side_gap_mm: null, top_gap_mm: null });
  assert.equal(m.sideGap, 12);
  assert.equal(m.topGap, 15);
  assert.equal(m.doors, 3);
  assert.equal(m.kind, 'kimchi');
  const lg = fridgeModelFromRow({ brand: 'LG', model_name: 'LG 디오스 오브제컬렉션 냉장고 Fit & Max', model_code: 'M516GBB012S', subtype: 'french_4door', line: '오브제컬렉션', width_mm: 835, height_mm: 1860, depth_mm: 685, side_gap_mm: 4, top_gap_mm: 15 });
  assert.equal(lg.doors, 4);
  assert.equal(lg.kind, 'fridge');
  assert.equal(lg.sideGap, 4);
  const free = fridgeModelFromRow({ brand: 'LG', model_name: 'LG 프렌치 디오스', model_code: 'F756SI14', subtype: 'french_4door', line: '디오스', width_mm: 908, height_mm: 1785, depth_mm: 802 });
  assert.equal(free.sideGap, 50);
  assert.equal(fridgeModelFromRow(null), null);
});

test('덩어리 나눔선 (③): 자리 끝·냉장고 사이·통 경계·2짝 가운데, 상부장 줄·중간/하부 경계', () => {
  const { fridgeMassingLines } = P;
  const l = fridgeMassingLines(BASE);
  const L = fridgeLayout(3000, 2400, FRIDGE_DEFAULT_MODELS.Samsung, 'left');
  const r4 = (x) => Math.round(x * 10000) / 10000;
  assert.ok(l.vertical.includes(r4(L.nicheW / 3000)), '자리 끝');
  assert.ok(l.vertical.includes(r4((12 + 912 + 6) / 3000)), '냉장고 사이 여유 가운데');
  let cx = L.nicheW;
  for (const m of L.columns) {
    if (m.doors === 2) assert.ok(l.vertical.includes(r4((cx + m.w / 2) / 3000)), '2짝 가운데');
    cx += m.w;
    if (cx < 3000) assert.ok(l.vertical.includes(r4(cx / 3000)), '통 경계');
  }
  assert.deepEqual(l.horizontal[0], { v: (50 + 400) / 2400, u0: 0, u1: 1 });
  assert.equal(l.horizontal[1].v, 1 - (60 + L.lowerH) / 2400);
  assert.equal(l.horizontal[1].u0, L.nicheW / 3000);
  assert.ok(l.vertical.every((u) => u > 0 && u < 1));
  // 우측이면 자리가 오른쪽 끝, 통 구간은 0 부터
  const rt = fridgeMassingLines({ ...BASE, fridgePosition: 'right' });
  const LR = fridgeLayout(3000, 2400, FRIDGE_DEFAULT_MODELS.Samsung, 'right');
  assert.ok(rt.vertical.includes(r4((3000 - LR.nicheW) / 3000)));
  assert.equal(rt.horizontal[1].u0, 0);
  assert.equal(rt.horizontal[1].u1, LR.columns.reduce((n, m) => n + m.w, 0) / 3000);
});

test('냉장고장은 벽 끝에서 끝(wallToWallMm 700) — 옆벽 깊이 문장은 cabinet, 붙박이장은 wardrobe 그대로', () => {
  assert.equal(P.CATEGORIES.fridge.wallToWallMm, 700);
  const side = { sideReturn: { side: 'right', depthMm: 300 } };
  const f = buildInstallPrompt({ ...BASE, ...side });
  assert.match(f, /The right end of the cabinet meets that wall's front corner/);
  assert.doesNotMatch(f, /wardrobe/);
  const st = buildInstallPrompt({ ...BASE, category: 'storage', ...side });
  assert.match(st, /The right end of the wardrobe meets/); // 수납장은 예전 문장 그대로
  const w = buildInstallPrompt({ ...BASE, category: 'wardrobe', ...side });
  assert.match(w, /The right end of the wardrobe meets that wall's front corner/);
  const mock = buildInstallPrompt({ ...BASE, mockVolume: true, mockKind: 'wardrobe' });
  assert.match(mock, /The leftmost part of the mock, up to the first vertical line, is the refrigerator recess/);
});
