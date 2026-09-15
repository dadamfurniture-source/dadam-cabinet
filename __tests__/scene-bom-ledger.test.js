/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, process, __dirname, console */
/**
 * C1a: 도면 ↔ BOM 원장 시험 (docs/01-plan/detail-bom-deepening.plan.md §4.5 · §5 C1a).
 *
 * "도면에 나타난 모든 자재를 정확히" 의 보증은 **3D 가 그린 부재 목록과 BOM 이 센 부재 목록이 같은 목록**이라는
 * 것이다. 지금은 3D 빌더(mockup-structure.html createModuleMesh 계열)와 BOM(extractors.js)이 각자 부재를
 * 만들므로 같지 않다. 이 시험은 그 차이를 **전부** 세어 허용 목록(test-utils/ledger-allowlist.json)과 맞춘다:
 *
 *   · 허용 목록 밖의 차이가 생기면 실패한다  — 새 어긋남은 조용히 들어올 수 없다
 *   · 허용 목록의 차이가 사라져도 실패한다    — 고쳤으면 항목을 지워야 한다 (낡은 항목이 초록을 꾸미지 못한다)
 *   · 차이의 내용(치수·수량)이 바뀌어도 실패한다 — 같은 부재의 다른 어긋남은 다른 차이다
 *   · 항목마다 원인(cause)·이유(reason)가 있어야 한다
 *
 * 허용 목록 갱신:  UPDATE_LEDGER_ALLOWLIST=1 npx jest __tests__/scene-bom-ledger.test.js
 *   (PowerShell: $env:UPDATE_LEDGER_ALLOWLIST=1; npx jest __tests__/scene-bom-ledger.test.js)
 *   기존 항목의 cause·reason 은 id 로 이어받고, 새 항목은 빈 이유로 들어와 다음 실행이 실패한다 — 사람이 적는다.
 *
 * 픽스처: 골든 3벌(planner-golden.js straight · lShape · oblique) + ㄱ자 코너(planner-corner-blind.test.js 의
 * lShapeLayout(false) 와 같은 배치 — 멍장이 선다). bom-golden 의 sinkCorner 는 상세설계 모듈 픽스처라 플래너에
 * 부팅할 수 없어 여기 없다.
 */
const fs = require('fs');
const path = require('path');
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D, collectSceneParts } = require('../test-utils/scene-parts');
const { collectBomParts, LEDGER_SPECS } = require('../test-utils/bom-parts');
const {
  diffLedger, sortEntries, formatTable, countBy, KNOWN_FAMILIES, TOLERANCE_MM,
} = require('../test-utils/ledger-diff');

const ALLOWLIST_PATH = path.join(__dirname, '..', 'test-utils', 'ledger-allowlist.json');

/** ㄱ자 하부 — planner-corner-blind.test.js `lShapeLayout(false)` 와 같다 (가로 3600 · 세로 1970, 깊이 650). */
const LOWER_D = 650;
const cornerL = {
  version: 1,
  savedAt: '2026-08-31T00:00:00.000Z',
  person: null,
  modules: [
    { section: 'lower', x: 0, y: 0, w: 3600, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
    { section: 'lower', x: LOWER_D / 2 - 1970 / 2, y: 1970 / 2 - LOWER_D / 2, w: 1970, h: LOWER_D, moduleH: 870, rotation: 90, finishings: [] },
  ],
};

const LEDGER_FIXTURES = {
  straight: FIXTURES.straight,
  lShape: FIXTURES.lShape,
  oblique: FIXTURES.oblique,
  cornerL,
};

/** 픽스처 하나를 부팅 → 자동계산 → 3D 순회 → BOM 추출. */
function ledgerOf(name) {
  const p = bootPlanner3D(LEDGER_FIXTURES[name], { design: 'ledger', item: name });
  const scene = collectSceneParts(p);
  const bom = collectBomParts(p);
  return { name, planner: p, scene, bom: bom.parts, warnings: bom.warnings, modules: bom.modules };
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return { entries: [] };
  return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
}

function writeAllowlist(entries, prev) {
  const prevById = new Map((prev.entries || []).map((e) => [e.id, e]));
  const doc = {
    _doc: [
      'C1a 도면↔BOM 원장 허용 목록 — 지금 존재하는 3D 부재 ↔ BOM 행의 차이 전부. __tests__/scene-bom-ledger.test.js 가 지킨다.',
      'id = fixture|moduleId|family|kind. kind: only3d(3D 에만) · onlyBom(BOM 에만) · dims(치수/수량 불일치, ±1mm) · thickness(두께만 다름).',
      'cause 는 원인 묶음(보고서 docs/02-design/features/scene-bom-ledger.md 가 같은 이름으로 센다), reason 은 한 줄 설명.',
      '항목을 지우는 길은 코드를 고쳐 차이를 없애는 것뿐이다. 갱신: UPDATE_LEDGER_ALLOWLIST=1 npx jest __tests__/scene-bom-ledger.test.js',
    ],
    toleranceMm: TOLERANCE_MM,
    specs: LEDGER_SPECS,
    entries: sortEntries(entries).map((e) => {
      const old = prevById.get(e.id) || {};
      return {
        id: e.id, kind: e.kind, fixture: e.fixture, moduleId: e.moduleId, family: e.family,
        scene: e.scene, bom: e.bom, note: e.note,
        cause: old.cause || '', reason: old.reason || '',
      };
    }),
  };
  fs.writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return doc;
}

const ledgers = {};
let discrepancies = [];

beforeAll(() => {
  Object.keys(LEDGER_FIXTURES).forEach((name) => { ledgers[name] = ledgerOf(name); });
  discrepancies = sortEntries(
    Object.values(ledgers).flatMap((L) => diffLedger(L.name, L.scene, L.bom)),
  );
});

describe('두 목록이 실제로 만들어진다', () => {
  test.each(Object.keys(LEDGER_FIXTURES))('%s — 3D 부재와 BOM 행이 모두 있고 모듈 id 가 붙어 있다', (name) => {
    const L = ledgers[name];
    expect(L.scene.length).toBeGreaterThan(0);
    expect(L.bom.length).toBeGreaterThan(0);
    L.scene.forEach((r) => expect(r.moduleId).not.toBe('?'));
    // 3D 는 부팅된 플래너 모듈 id, BOM 은 플래너 id 로 되돌린 것 — 같은 이름 공간이어야 대조가 된다
    const plannerIds = new Set((L.planner.g('modules') || []).map((m) => String(m.id)).concat(['ep']));
    L.scene.forEach((r) => expect(plannerIds.has(r.moduleId)).toBe(true));
    L.bom.forEach((r) => expect(plannerIds.has(r.moduleId)).toBe(true));
  });

  test('모든 family 가 알려진 이름이다 — 새 부재 종류가 생기면 여기서 멈춘다', () => {
    const seen = new Set();
    Object.values(ledgers).forEach((L) => {
      L.scene.forEach((r) => seen.add(r.family));
      L.bom.forEach((r) => seen.add(r.family));
    });
    const unknown = [...seen].filter((f) => KNOWN_FAMILIES.indexOf(f) < 0);
    expect(unknown).toEqual([]);
  });

  test('표준 하부장의 도어는 이미 맞는다 — 대조 장치가 실제로 짝을 짓는다', () => {
    // straight 의 하부장 도어(양문 396×678 ×2 등)는 3D 와 BOM 이 같다. 여기서 차이가 나면 장치 자체가 고장난 것이다.
    const doorDiffs = discrepancies.filter((d) => d.fixture === 'straight' && d.family === 'door' && /^lower-/.test(d.moduleId));
    expect(doorDiffs).toEqual([]);
    const doorRows = ledgers.straight.bom.filter((r) => r.family === 'door' && /^lower-/.test(r.moduleId));
    expect(doorRows.length).toBeGreaterThan(0);
  });
});

describe('도면 ↔ BOM 원장 — 차이는 허용 목록과 정확히 같아야 한다', () => {
  test('허용 목록 밖의 차이 없음 · 낡은 항목 없음 · 내용 동일', () => {
    const prev = readAllowlist();
    if (process.env.UPDATE_LEDGER_ALLOWLIST === '1') {
      const doc = writeAllowlist(discrepancies, prev);
      const blank = doc.entries.filter((e) => !e.reason || !e.cause);
      console.log(`허용 목록 갱신: ${doc.entries.length}건 (이유 비어 있음 ${blank.length}건)\n` + formatTable(doc.entries));
      return;
    }
    const allowed = new Map((prev.entries || []).map((e) => [e.id, e]));
    const actual = new Map(discrepancies.map((d) => [d.id, d]));

    const extra = discrepancies.filter((d) => !allowed.has(d.id));
    const stale = [...allowed.values()].filter((e) => !actual.has(e.id));
    const changed = discrepancies
      .filter((d) => allowed.has(d.id))
      .filter((d) => allowed.get(d.id).scene !== d.scene || allowed.get(d.id).bom !== d.bom)
      .map((d) => ({ ...d, reason: `기록: 3D ${allowed.get(d.id).scene} / BOM ${allowed.get(d.id).bom}` }));

    const msg = [];
    if (extra.length) msg.push(`■ 허용 목록에 없는 새 차이 ${extra.length}건 — 고치거나 test-utils/ledger-allowlist.json 에 이유를 적으세요\n${formatTable(extra)}`);
    if (stale.length) msg.push(`■ 더 이상 나지 않는 차이 ${stale.length}건 — 허용 목록에서 지우세요\n${formatTable(stale)}`);
    if (changed.length) msg.push(`■ 내용이 바뀐 차이 ${changed.length}건 — 허용 목록을 갱신하고 이유를 다시 확인하세요\n${formatTable(changed)}`);
    if (msg.length) {
      throw new Error(`도면↔BOM 원장 불일치\n\n${msg.join('\n\n')}\n\n갱신: UPDATE_LEDGER_ALLOWLIST=1 npx jest __tests__/scene-bom-ledger.test.js`);
    }
    expect(extra).toEqual([]);
    expect(stale).toEqual([]);
    expect(changed).toEqual([]);
  });

  test('허용 목록의 모든 항목에 원인(cause)과 이유(reason)가 있다', () => {
    const prev = readAllowlist();
    const blank = (prev.entries || []).filter((e) => !e.reason || !e.reason.trim() || !e.cause || !e.cause.trim());
    if (blank.length) {
      throw new Error(`이유가 빈 허용 항목 ${blank.length}건\n${formatTable(blank)}`);
    }
    expect(blank).toEqual([]);
  });

  test('허용 목록의 스펙이 시험이 쓰는 스펙과 같다 — 스펙이 달라지면 차이의 뜻이 달라진다', () => {
    const prev = readAllowlist();
    if (!prev.specs) return;
    expect(prev.specs).toEqual(LEDGER_SPECS);
  });

  test('요약 — 원인별 개수 (보고서와 같은 묶음)', () => {
    const prev = readAllowlist();
    const byCause = countBy(prev.entries || [], 'cause');
    const byKind = countBy(prev.entries || [], 'kind');
    console.log(
      `도면↔BOM 원장 허용 목록 ${(prev.entries || []).length}건\n` +
      `종류별: ${byKind.map(([k, n]) => `${k} ${n}`).join(' · ')}\n` +
      `원인별:\n${byCause.map(([k, n]) => `  ${String(n).padStart(3)}  ${k}`).join('\n')}`,
    );
    expect(byCause.length).toBeGreaterThan(0);
  });
});
