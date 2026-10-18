/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 상판 발주 요청서 타공 (work-reports-archive.plan.md §8.1 Q10 — 모델 입력).
 *   관리자 「가전 모델 관리」: 싱크볼 · 쿡탑 탭, 타공 W·D·R · 수전 지름 칸 (싱크볼 · 쿡탑만 저장)
 *   설계 상판 탭: 싱크볼 · 쿡탑 모델 셀렉트 → 사양 sinkModelId · cooktopModelId (워커가 인쇄할 때 읽는다)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const WS = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-workspace.js'), 'utf8');
const AP = fs.readFileSync(path.join(ROOT, 'admin/appliances.html'), 'utf8');

const flush = () => new Promise((r) => setTimeout(r, 0));

/** ui-workspace.js 에서 CutoutModels ~ cutoutModelOptionsHtml 만 떼어 vm 에 올린다 */
function loadPicker({ rows = [], failCutoutCols = false } = {}) {
  const start = WS.indexOf('const CutoutModels = ');
  const end = WS.indexOf('/** 상판 재질 — 두께가');
  const src = WS.slice(start, end);
  const selects = [];
  const query = (cols) => {
    const q = {
      _cols: cols,
      in: () => q,
      order: () => q,
      then: (ok, bad) => {
        selects.push(cols);
        const res = failCutoutCols && /cutout/.test(cols) ? { data: null, error: { message: 'column cutout_w_mm does not exist' } } : { data: rows, error: null };
        return Promise.resolve(res).then(ok, bad);
      },
    };
    return q;
  };
  const rendered = [];
  const ctx = {
    SupabaseUtils: { client: { from: () => ({ select: (cols) => query(cols) }) } },
    selectedItems: [{ uniqueId: 7, specs: {} }],
    renderWorkspaceContent: (it) => rendered.push(it.uniqueId),
    document: { querySelector: (sel) => (sel.includes('"7"') ? {} : null) },
  };
  vm.createContext(ctx);
  vm.runInContext(`${src}\n;this.__p = { CutoutModels, cutoutModelOptionsHtml, loadCutoutModels };`, ctx);
  return { ...ctx.__p, selects, rendered };
}

const ROWS = [
  { id: 's1', category: 'sink', brand: '백조', model_name: 'SQ850', cutout_w_mm: 760, cutout_d_mm: 440 },
  { id: 's2', category: 'sink', brand: '백조', model_name: 'Q900', cutout_w_mm: null, cutout_d_mm: null },
  { id: 'c1', category: 'cooktop', brand: 'SK매직', model_name: '인덕션', cutout_w_mm: 560, cutout_d_mm: 490 },
];

describe('설계 상판 탭 — 싱크볼 · 쿡탑 모델 셀렉트', () => {
  test('처음엔 "불러오는 중", 다 불러오면 그 품목 상판 탭을 다시 그린다', async () => {
    const p = loadPicker({ rows: ROWS });
    expect(p.cutoutModelOptionsHtml('sink', null, 7)).toMatch(/모델 불러오는 중/);
    await flush(); await flush(); await flush();
    expect(p.rendered).toEqual([7]);
    const html = p.cutoutModelOptionsHtml('sink', 's1', 7);
    expect(html).toMatch(/<option value="s1" selected>백조 SQ850 · 타공 760×440<\/option>/);
    expect(html).toMatch(/백조 Q900 · 타공 미입력/);
    expect(html).not.toMatch(/인덕션/);
    expect(p.cutoutModelOptionsHtml('cooktop', null, 7)).toMatch(/<option value="" selected>미지정 — 요청서에 \[확인 필요\]<\/option>/);
    expect(p.selects).toHaveLength(1);
  });

  test('타공 칼럼이 없으면(SQL 미실행) 이름만 다시 불러온다 · 지워진 모델은 그대로 보인다', async () => {
    const p = loadPicker({ rows: ROWS, failCutoutCols: true });
    p.cutoutModelOptionsHtml('sink', null, 7);
    for (let i = 0; i < 6; i++) await flush();
    expect(p.selects).toEqual([expect.stringMatching(/cutout_w_mm/), 'id,category,brand,model_name,model_code']);
    expect(p.cutoutModelOptionsHtml('sink', 'gone', 7)).toMatch(/<option value="gone" selected>\(지워진 모델\)<\/option>/);
  });

  test('상판 탭이 사양 sinkModelId · cooktopModelId 를 바꾼다', () => {
    expect(WS).toContain("updateSpec(${uid},'sinkModelId',this.value)");
    expect(WS).toContain("updateSpec(${uid},'cooktopModelId',this.value)");
    expect(WS).toContain('data-top-model-uid="${uid}"');
  });
});

describe('관리자 가전 모델 — 싱크볼 · 쿡탑 타공 칸', () => {
  test('탭: sink 는 「싱크볼」(예전 오표기 「분배기」), 쿡탑 탭 추가', () => {
    expect(AP).toMatch(/<button data-cat="sink">🚰 싱크볼<\/button>/);
    expect(AP).toMatch(/data-cat="cooktop">🔥 쿡탑<\/button>/);
    expect(AP).not.toMatch(/분배기/);
  });

  test('타공 W · D · R · 수전 지름 칸, 싱크볼 · 쿡탑만 보낸다 (수전은 싱크볼만)', () => {
    for (const id of ['f-cw', 'f-cd', 'f-cr', 'f-fh']) expect(AP).toContain(`id="${id}"`);
    expect(AP).toContain("const CUTOUT_CATS = ['sink', 'cooktop'];");
    expect(AP).toMatch(/if \(CUTOUT_CATS\.includes\(payload\.category\)\) \{[\s\S]*payload\.cutout_w_mm = int\('f-cw'\);[\s\S]*payload\.faucet_hole_mm = payload\.category === 'sink' \? int\('f-fh'\) : null;/);
    expect(AP).toContain("document.getElementById('f-category').addEventListener('change', toggleCutoutFields);");
    expect(AP).toContain("? '\\n\\n타공 칸은 database/work-reports.sql");
  });
});

describe('관리자 가전 모델 — 여유 공간 칸 (side_gap_mm · top_gap_mm)', () => {
  /** gapCell 만 떼어 실행 */
  const gapCell = (() => {
    const start = AP.indexOf('function gapCell(r) {');
    const end = AP.indexOf('function renderTable(rows) {');
    // eslint-disable-next-line no-new-func
    return new Function(`${AP.slice(start, end)}; return gapCell;`)();
  })();

  test('표 머리 · 행에 여유 공간 칸 (열 10개)', () => {
    expect(AP).toMatch(/<th scope="col" class="right"[^>]*>여유 공간 \(mm\)<\/th>/);
    expect(AP).toContain('<td class="right gap">${gapCell(r)}</td>');
    expect(AP).not.toContain('colspan="9"');
  });

  test('좌우(한쪽) · 위 여유와 그 여유를 둔 자리 크기', () => {
    expect(gapCell({ width_mm: 595, height_mm: 1853, side_gap_mm: 12, top_gap_mm: 15 })).toBe('좌우 12 · 위 15<small>자리 619 × 1868</small>');
    expect(gapCell({ width_mm: 600, height_mm: 820, side_gap_mm: 0, top_gap_mm: null })).toBe('좌우 0<small>자리 600 × 820</small>');
    expect(gapCell({ width_mm: 600, height_mm: 820 })).toBe('<span class="none">미입력</span>');
  });

  test('수정 창에서 옆 · 위 여유를 넣고 빈칸은 null 로 저장', () => {
    for (const id of ['f-sg', 'f-tg']) expect(AP).toContain(`id="${id}"`);
    expect(AP).toContain("side_gap_mm: document.getElementById('f-sg').value === '' ? null : parseInt(document.getElementById('f-sg').value, 10),");
    expect(AP).toContain("document.getElementById('f-tg').value         = row?.top_gap_mm ?? '';");
  });
});
