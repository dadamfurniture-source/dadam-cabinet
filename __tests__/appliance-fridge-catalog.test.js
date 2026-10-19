/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 냉장고 모델 대량 수집 (2026-10-19 사장님 — "냉장고 모델을 최대한 많이 데이터베이스화").
 *   DB: subtype · line · install_type · model_codes · back_gap_mm · discontinued · collected_at + import_appliance_models()
 *   관리 화면: 세부 구분 필터 · 모델 코드 전부로 검색 · 냉장고 칸 입력
 *   플래너: 새 칸을 읽고(없으면 단계적으로 줄여) 색상 변형 코드로도 찾는다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');
const SQL = read('database/appliance-models-catalog.sql');
const AP = read('admin/appliances.html');
const SHELL = read('mockup-shell.html');

const SUBTYPES = ['french_4door', 'side_by_side', 'two_door', 'one_door', 'built_in', 'kimchi_stand', 'kimchi_lid', 'wine', 'small'];

describe('DB — 칸 · 구분 · 가져오기 함수', () => {
  test('새 칸은 IF NOT EXISTS 로 (여러 번 실행해도 안전)', () => {
    for (const col of ['subtype', 'line', 'install_type', 'model_codes', 'back_gap_mm', 'discontinued', 'collected_at']) {
      expect(SQL).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  test('세부 구분 9가지 — DB 검사 · 관리 화면 · 플래너가 같은 목록', () => {
    const chk = SQL.slice(SQL.indexOf('appliance_models_subtype_chk CHECK'), SQL.indexOf('));', SQL.indexOf('appliance_models_subtype_chk CHECK')));
    const inDb = [...chk.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
    expect(inDb).toEqual(SUBTYPES);
    for (const src of [AP.slice(AP.indexOf('const FRIDGE_SUBTYPES')), SHELL.slice(SHELL.indexOf('const FRIDGE_SUBTYPE_LABEL'))]) {
      const block = src.slice(0, src.indexOf('};'));
      expect([...block.matchAll(/([a-z_0-9]+):\s*'/g)].map((m) => m[1])).toEqual(SUBTYPES);
    }
  });

  test('가져오기: 같은 브랜드에서 코드가 겹치면 갱신, 여유는 기존 값 우선, 코드는 합집합', () => {
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION import_appliance_models(rows JSONB)');
    expect(SQL).toMatch(/WHERE brand = r->>'brand'\s+AND \(model_codes && codes OR model_code = ANY\(codes\)\)/);
    expect(SQL).toContain("side_gap_mm  = COALESCE(side_gap_mm, NULLIF(r->>'side_gap_mm', '')::INT)");
    expect(SQL).toContain('model_codes  = ARRAY(SELECT DISTINCT unnest(model_codes || codes))');
    expect(SQL).toContain('verified     = verified OR');
  });

  test('웹 · 익명은 가져오기 함수를 못 부른다', () => {
    expect(SQL).toContain('REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM PUBLIC;');
    expect(SQL).toContain('REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM anon, authenticated;');
  });
});

describe('관리 화면 — admin/appliances.html', () => {
  const parseCodes = (() => {
    const start = AP.indexOf('function parseCodes(text, main) {');
    const end = AP.indexOf('}', AP.indexOf('return [...new Set(list)];')) + 1;
    // eslint-disable-next-line no-new-func
    return new Function(`${AP.slice(start, end)}; return parseCodes;`)();
  })();

  test('모델 코드 입력 — 쉼표 · 줄바꿈, 대표 코드 맨 앞, 중복 제거', () => {
    expect(parseCodes('RM70F64WAP, RM70F64WBP\nRM70F64', 'RM70F64')).toEqual(['RM70F64', 'RM70F64WAP', 'RM70F64WBP']);
    expect(parseCodes('', null)).toEqual([]);
  });

  test('세부 구분 필터 · 모델 코드 전부로 검색 · 건수', () => {
    expect(AP).toContain('id="subtypeFilter"');
    expect(AP).toContain("(r.model_codes || []).some((c) => String(c).toLowerCase().includes(q))");
    expect(AP).toContain('id="rowCount"');
  });

  test('냉장고 칸은 냉장고일 때만 보이고 저장된다', () => {
    for (const id of ['f-bg', 'f-subtype', 'f-install', 'f-line', 'f-codes']) expect(AP).toContain(`id="${id}"`);
    expect(AP).toContain("el.style.display = cat === 'refrigerator' ? '' : 'none'");
    expect(AP).toMatch(/if \(payload\.category === 'refrigerator'\) \{[\s\S]*payload\.model_codes = parseCodes\(/);
  });

  test('모델 이름 · 코드는 escape 한다 (수집한 글자가 들어온다)', () => {
    expect(AP).toContain('<td>${escHtml(r.model_name)}');
    expect(AP).toContain('<td>${escHtml(r.model_code)}');
  });
});

describe('플래너 — 모델 고르기', () => {
  test('새 칸을 먼저 읽고, 없으면 여유 칸만, 그것도 없으면 기본 칸', () => {
    const a = SHELL.indexOf('side_gap_mm,top_gap_mm,subtype,line,model_codes');
    const b = SHELL.indexOf('fetch(`${base},side_gap_mm,top_gap_mm`', a);
    const c = SHELL.indexOf('fetch(base, { headers })', b);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  test('색상 변형 코드 · 라인 · 구분 이름으로도 찾는다', () => {
    expect(SHELL).toContain('(m.codes || []).some(c => String(c).toLowerCase().includes(q))');
    expect(SHELL).toContain("(FRIDGE_SUBTYPE_LABEL[m.subtype] || '').includes(q)");
  });
});

describe('빌트인 장 안쪽 치수(니치) — appliance-models-niche.sql', () => {
  const NICHE = read('database/appliance-models-niche.sql');

  test('최소 · 최대 6칸, IF NOT EXISTS', () => {
    for (const k of ['min_w', 'min_h', 'min_d', 'max_w', 'max_h', 'max_d']) {
      expect(NICHE).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS niche_${k}_mm INT`));
    }
  });

  test('가져오기 함수가 니치를 넣고, 갱신 때는 기존 값 우선 · 함수는 웹에서 못 부른다', () => {
    expect(NICHE).toContain('CREATE OR REPLACE FUNCTION import_appliance_models(rows JSONB)');
    expect(NICHE).toContain("niche_min_w_mm = COALESCE(niche_min_w_mm, NULLIF(r->>'niche_min_w_mm', '')::INT)");
    expect(NICHE).toContain("side_gap_mm    = COALESCE(side_gap_mm, NULLIF(r->>'side_gap_mm', '')::INT)");
    expect(NICHE).toContain('REVOKE ALL ON FUNCTION import_appliance_models(JSONB) FROM anon, authenticated;');
  });

  test('관리 화면 — 한 값이면 그 값, 범위면 최소~최대', () => {
    const start = AP.indexOf('function nicheText(r) {');
    const CLOSE = '\n      }'; // 함수를 닫는 줄 (템플릿 안 } 는 건너뛴다)
    const end = AP.indexOf(CLOSE, start) + CLOSE.length;
    // eslint-disable-next-line no-new-func
    const nicheText = new Function(`${AP.slice(start, end)}; return nicheText;`)();
    expect(nicheText({ niche_min_w_mm: 610, niche_min_h_mm: 2135, niche_min_d_mm: 670 })).toBe('장 610 × 2135 × 670');
    expect(nicheText({ niche_min_w_mm: 560, niche_max_w_mm: 570, niche_min_h_mm: 1772, niche_max_h_mm: 1788, niche_min_d_mm: 550 })).toBe('장 560~570 × 1772~1788 × 550');
    expect(nicheText({})).toBe('');
    for (const id of ['f-nw', 'f-nh', 'f-nd', 'f-nw2', 'f-nh2', 'f-nd2']) expect(AP).toContain(`id="${id}"`);
    expect(AP).toContain("payload.niche_min_w_mm = nv('f-nw');");
  });
});
