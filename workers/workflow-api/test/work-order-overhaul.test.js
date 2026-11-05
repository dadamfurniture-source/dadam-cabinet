/**
 * 작업지시서 손보기 (2026-11-05 사장님 답 — 계획 PR 5): 라벨 재단 차례 · 원장 묶음 [그림|표] · 특별 지시(자동 + 사무실 글)
 * · 도어 앞모습 · 설치 지시서 정면도 · 줄 부재. 설계는 합성 (fixtures/work-order-v2.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWorkOrder, labelNumbers, labelGroups, cutOrderOf, labelUnits, specialNotesBox, doorDrawingSvg } from '../src/templates/work-order.js';
import { renderInstallationOrder } from '../src/templates/installation-order.js';
import { autoNotesOf, officeNotesOf, specialNotesOf, withNoteChecks, NOTE_ROLES } from '../src/work/special-notes.js';
import { frozenCheckList, itemsFor } from '../src/work/check-items.js';
import * as fx from './fixtures/work-order-v2.js';

const docCut = (rp = {}) => fx.doc({ render_payload: { ...fx.doc().render_payload, label_order: 'cut', ...rp } });

test('라벨 재단 차례 (A) — label_order cut 이면 원장 1 조각부터, 옛 문서는 자재 행 차례 그대로', () => {
  const mats = fx.materials();
  const plan = fx.cutPlan();
  const placed = plan.sheets.flatMap((s) => s.parts.map((p) => p.partId));
  const inHouse = cutOrderOf(labelGroups(mats).inHouse, plan).map((u) => u.id);
  // 놓인 차례가 먼저 — 그 뒤 배치에 없는 부재 (픽스처: 뒷판)
  assert.deepEqual(inHouse.slice(0, placed.filter((id) => inHouse.includes(id)).length), placed.filter((id) => inHouse.includes(id)));
  assert.deepEqual(inHouse.sort(), labelGroups(mats).inHouse.map((u) => u.id).sort(), '같은 조각, 차례만 다르다');
  const byCut = labelNumbers(mats, plan);
  assert.equal(byCut.get(placed[0]), 1);
  // 옛 문서 (label_order 없음) — 자재 행 차례
  const old = renderWorkOrder(fx.doc(), fx.snapshot(), { toolbar: false, pack: 'cut' });
  assert.ok(!old.includes('재단 차례 — 원장 1 조각부터'));
  const cut = renderWorkOrder(docCut(), fx.snapshot(), { toolbar: false, pack: 'cut' });
  assert.ok(cut.includes('재단 차례 — 원장 1 조각부터'));
  assert.ok(cut.includes(`<span data-pid="${placed[0]}">1</span>`), '원장 첫 조각이 1번');
  // 라벨 꾸러미도 같은 번호
  const labels = renderWorkOrder(docCut(), fx.snapshot(), { toolbar: false, pack: 'labels' });
  assert.ok(labels.includes(`<div class="label" data-pid="${placed[0]}">`));
  const first = labels.indexOf('<div class="label" data-pid=');
  assert.ok(labels.slice(first, first + 200).includes(`data-pid="${placed[0]}"`), '첫 라벨 = 원장 첫 조각');
  void labelUnits;
});

test('재단 지시서 — 원장 묶음마다 머리 · [그림] [표] [둘 다] · [이 묶음만 인쇄], 둘째 묶음부터 새 쪽, 단추 스크립트', () => {
  const html = renderWorkOrder(fx.doc(), fx.snapshot(), { toolbar: false, pack: 'cut' });
  const groups = html.split(' data-group="').length - 1;
  assert.ok(groups >= 1);
  assert.ok(html.includes('data-cut-view="draw"') && html.includes('data-cut-view="table"') && html.includes('data-cut-print="0"'));
  assert.ok(html.includes('<script>') && html.includes("closest('[data-cut-view]')"), '단추 스크립트');
  if (groups > 1) assert.ok(html.includes('cut-group cut-group-next'));
  // 단추는 인쇄에 안 나온다
  assert.ok(html.includes('class="cut-btns no-print"'));
  // 재단이 없는 꾸러미(도어재)에는 스크립트가 없다
  assert.ok(!renderWorkOrder(fx.doc(), fx.snapshot(), { toolbar: false, pack: 'door' }).includes("closest('[data-cut-view]')"));
});

test('특별 지시 — 자동(색 지정 부재 · 원장 초과 · 도어 색 · 설치 타공 · 콘센트) + 사무실 글, 역할마다', () => {
  const snap = fx.snapshot();
  const mats = snap.bom_payload.materials.concat([
    { partId: '0-l1-body:shelf-0', part: '선반', material: 'PB', thickness: 15, w: 900, h: 500, qty: 3, finishCode: 'PET-WNT-M', slot: 'body' },
    { partId: '0-l1-back-1', part: '뒷판', material: 'MDF', thickness: 3, w: 600, h: 700, qty: 1, module: '#2 개수대 1000', note: '측판 뒤 덮음 · 콘센트 타공 50×80 — 바닥에서 400 (가로 자리 현장 확인)' },
  ]);
  const s2 = { ...snap, bom_payload: { materials: mats } };
  const auto = autoNotesOf(s2);
  assert.ok(auto.cut.some((t) => t === '색 지정 부재 3장 — PET-WNT-M (선반)'), auto.cut.join(' / '));
  assert.ok(auto.door.some((t) => /^도어 색 2가지 — /.test(t)), auto.door.join(' / '));
  assert.ok(auto.install.some((t) => t.startsWith('싱크볼 · 수전 타공 자리 — 1 개수대')), auto.install.join(' / '));
  assert.ok(auto.install.some((t) => t.startsWith('후드 덕트 · 전기 — 2 후드장')));
  assert.ok(auto.install.some((t) => t.startsWith('콘센트 타공 50×80 — 바닥에서 400')));
  const office = officeNotesOf({ cut: '원장 4 는 지난 주문 자투리 판으로\n\n  색 확인 후 자르기 ', install: ['엘리베이터 없음 — 2인 반입'], bogus: 'x' });
  assert.deepEqual(office.cut, ['원장 4 는 지난 주문 자투리 판으로', '색 확인 후 자르기']);
  assert.deepEqual(office.install, ['엘리베이터 없음 — 2인 반입']);
  const notes = specialNotesOf(s2, { cut: '자투리 판으로' }, { roles: ['cut', 'assembly', 'door', 'top'] });
  assert.deepEqual(Object.keys(notes).sort(), ['cut', 'door']);
  assert.deepEqual(notes.cut.at(-1), { text: '자투리 판으로', src: 'office' });
  assert.ok(!('install' in notes), '작업지시서에는 설치 지시를 싣지 않는다 (시공 지시서 몫)');
  assert.deepEqual(NOTE_ROLES, ['cut', 'assembly', 'door', 'top', 'install']);
});

test('특별 지시 → 필수 확인 — 재단 · 조립 · 설치만 note-<역할>-n, 도어 · 상판은 종이 상자만', () => {
  const notes = { cut: [{ text: 'A', src: 'auto' }, { text: 'B', src: 'office' }], door: [{ text: 'C', src: 'auto' }], install: [{ text: 'D', src: 'office' }] };
  const cl = withNoteChecks(frozenCheckList(), notes);
  const cut = itemsFor(cl, 'cut', 'order').filter((x) => x.note);
  assert.deepEqual(cut.map((x) => [x.key, x.label, x.must]), [['note-cut-1', '특별 지시 — A', true], ['note-cut-2', '특별 지시 — B', true]]);
  assert.deepEqual(itemsFor(cl, 'install', 'order').filter((x) => x.note).map((x) => x.key), ['note-install-1']);
  assert.equal(itemsFor(cl, 'assembly').filter((x) => x.note).length, 0);
  assert.ok(cut.every((x) => /^[a-z0-9-]{1,64}$/.test(x.key)), 'DB work_checks.item_key 모양');
  // 판 자체는 바뀌지 않는다
  assert.equal(itemsFor(frozenCheckList(), 'cut').filter((x) => x.note).length, 0);
});

test('특별 지시 빨간 상자 — 재단 · 조립 · 도어 · 상판 꾸러미 맨 위, 표지(전체)는 모두, 옛 문서는 상자 없음 · 주문 확인 칸에 겹쳐 싣지 않는다', () => {
  const notes = { cut: [{ text: '자투리 판으로', src: 'office' }], assembly: [{ text: '유리 도어 입고 확인', src: 'auto' }], door: [{ text: '도어 색 미지정 2장', src: 'auto' }] };
  const cl = withNoteChecks(frozenCheckList(), notes);
  const doc = fx.doc({ render_payload: { ...fx.doc().render_payload, special_notes: notes, check_list: cl } });
  const cut = renderWorkOrder(doc, fx.snapshot(), { toolbar: false, pack: 'cut' });
  assert.ok(cut.includes('⚠ 특별 지시 — 재단') && cut.includes('☐ 자투리 판으로 <span class="sn-src">사무실</span>'));
  assert.ok(!cut.includes('⚠ 특별 지시 — 조립'));
  assert.ok(!/order-checks[^]*?특별 지시 — 자투리/.test(cut), '주문 확인 칸에는 없다');
  assert.ok(renderWorkOrder(doc, fx.snapshot(), { toolbar: false, pack: 'assembly' }).includes('⚠ 특별 지시 — 조립'));
  assert.ok(renderWorkOrder(doc, fx.snapshot(), { toolbar: false, pack: 'door' }).includes('⚠ 특별 지시 — 도어'));
  const all = renderWorkOrder(doc, fx.snapshot(), { toolbar: false, pack: 'all' });
  assert.ok(['재단', '조립', '도어'].every((r) => all.includes(`⚠ 특별 지시 — ${r}`)));
  assert.equal(specialNotesBox({}, ['cut']), '');
  assert.ok(!renderWorkOrder(fx.doc(), fx.snapshot(), { toolbar: false, pack: 'cut' }).includes('class="special-notes"'), '옛 문서');
});

test('도어재 발주서 — 도어 · 서랍 앞판마다 앞모습 (경첩 컵 · 엣지 · 치수)', () => {
  const html = renderWorkOrder(fx.doc(), fx.snapshot(), { toolbar: false, pack: 'door' });
  assert.ok(html.includes('도어 앞모습'));
  assert.equal(html.split('<div class="door-card">').length - 1, fx.materials().filter((m) => m.part === '도어').length);
  const svg = doorDrawingSvg({ w: 596, h: 875, edges: { L: true, R: true, T: true, B: true } }, { count: 2, positions: [110, 765], side: null });
  assert.equal((svg.match(/<circle /g) || []).length, 2);
  assert.ok(svg.includes('>596<') && svg.includes('>875<') && svg.includes('>765<'));
  assert.equal(doorDrawingSvg({ w: 0, h: 10 }), '');
});

test('설치 지시서 (E) — 정면도 · 모듈 번호 · 줄 부재 · 특별 지시(설치) · 확인 칸에 겹쳐 싣지 않음', () => {
  const snap = fx.snapshot();
  const mats = snap.bom_payload.materials.concat([
    { partId: '0-ep-kick-0', moduleKey: '0-ep', module: '', part: '걸레받이', material: 'MDF', thickness: 18, w: 1800, h: 145, qty: 1, note: '' },
    { partId: '0-ep-top-0', moduleKey: '0-ep', slot: 'top', part: '상판', material: '인조대리석', thickness: 12, w: 1800, h: 650, qty: 1, note: '' },
  ]);
  const s2 = { ...snap, bom_payload: { materials: mats } };
  const notes = { install: [{ text: '엘리베이터 없음 — 2인 반입', src: 'office' }] };
  const doc = { ...fx.doc(), doc_type: 'installation_order', render_payload: { special_notes: notes, check_list: withNoteChecks(frozenCheckList(), notes) } };
  const html = renderInstallationOrder(doc, s2, { toolbar: false });
  assert.ok(html.includes('<svg class="elevation"'), '정면도');
  assert.ok(html.includes('번호 = 설치 모듈 명세 번호'));
  assert.ok(html.includes('<th>번호</th>'));
  assert.ok(html.includes('줄 부재') && html.includes('걸레받이') && html.includes('상판 업체 시공'));
  assert.ok(html.includes('⚠ 특별 지시 — 설치') && html.includes('엘리베이터 없음 — 2인 반입'));
  const checks = html.slice(html.indexOf('<h2>설치 확인</h2>'), html.indexOf('<table class="sign">'));
  assert.ok(!checks.includes('엘리베이터 없음'), '설치 확인 칸에는 없다 (빨간 상자에)');
});
