/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * B2 준비 — 철물·체결구 규칙 입력 양식(docs/design-rules/hardware.md) ↔ mcp-server/config/bom-rules.json `hardware` 블록 동기.
 *
 * 양식은 공장이 「공장 값」칸을 채우는 문서이고, JSON 은 같은 키를 값 null 로 들고 있다. 둘이 따로 놀면 값을 옮겨 적을 때
 * 빠진다 — 그래서 여기서 잠근다:
 *   1. JSON 이 파싱되고 `hardware` 에 `_source`/`_asOf` 메타가 있다.
 *   2. 양식의 절 제목 `## N. 제목 (`key`)` 집합 = `hardware` 의 키 집합 (옛 프로토타입 키 3개·메타 제외).
 *   3. 절마다 표 머리는 「항목 · 조건 · 현재 코드 값 · 공장 값 · 단위 · 비고」, 행 항목의 `sub_key` 집합 = `hardware.<key>` 의 키 집합.
 *   4. 「공장 값」이 빈칸이면 JSON 도 null, 값이 있으면 null 이 아니다 (양방향).
 *   5. 기존 규칙 값은 하나도 안 바뀌었다 — 파일에 굳힌 origin/main(57d0b3e) 기준과, git 이 있으면 `origin/main` 실물과도 비교.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RULES_REL = 'mcp-server/config/bom-rules.json';
const RULES_PATH = path.join(ROOT, RULES_REL);
const FORM_PATH = path.join(ROOT, 'docs', 'design-rules', 'hardware.md');

/** bom-rules.json `hardware` 에 B2 이전부터 있던 MCP 프로토타입 키 — 양식과 무관, 값 불변. */
const LEGACY_HARDWARE_KEYS = ['hinges_per_door', 'hinge_type', 'slide_type'];
const META_KEYS = ['_source', '_asOf'];
const FORM_HEADER = ['항목', '조건', '현재 코드 값', '공장 값', '단위', '비고'];

/** origin/main (57d0b3e) 의 bom-rules.json — B2 양식이 더해지기 전 규칙 전체. 여기 값이 바뀌면 "add-only" 가 깨진 것이다. */
const BASELINE = {
  materials: {
    sheet_size: { width: 1220, height: 2440 },
    body: { thickness: 18, type: 'PB', label: '18T PB' },
    door: { thickness: 18, type: 'MDF', label: '18T MDF' },
    back_panel: { thickness: 2.7, type: 'MDF', label: '2.7T MDF' },
    edge_band: { thickness: 1 },
    countertop: { thickness: 30 },
  },
  cabinet_defaults: { width: 600, height: 800, depth: 550 },
  construction: {
    side_panel_qty: 2,
    bottom_panel_qty: 1,
    band_qty: 2,
    band_width: 60,
    back_panel_qty: 1,
    back_panel_clearance: 1,
    door_gap: 4,
    shelf_depth_reduction: 20,
  },
  upper_cabinet: { depth_ratio: 0.55, top_panel: true },
  hardware: { hinges_per_door: 2, hinge_type: 'soft-close', slide_type: 'soft-close' },
  molding_clearance: { width_min: 45, width_max: 120, height_min: 10, height_max: 60, depth: 20 },
  wardrobe: { unit_width_min: 750, unit_width_max: 1050, allow_half_units: true, shelf_per_section: 1 },
};

const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
const form = parseForm(fs.readFileSync(FORM_PATH, 'utf8'));

/** 양식 파서 — `## N. 제목 (`key`)` 절과 그 아래 첫 표. 셀 안에 `|` 를 쓰지 않는 약속이다. */
function parseForm(md) {
  const topics = [];
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const heading = line.match(/^## \d+\. .*\(`([a-z_]+)`\)\s*$/);
    if (heading) {
      cur = { key: heading[1], header: null, rows: [] };
      topics.push(cur);
      continue;
    }
    if (/^## /.test(line)) { cur = null; continue; }
    if (!cur || !line.startsWith('|')) continue;
    const cells = line.slice(1, line.lastIndexOf('|')).split('|').map((s) => s.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (!cur.header) { cur.header = cells; continue; }
    const sub = cells[0].match(/^`([a-z_]+)`/);
    cur.rows.push({ subKey: sub ? sub[1] : null, item: cells[0], factory: cells[3] || '', cells });
  }
  return topics;
}

const sorted = (arr) => [...arr].sort();
const formKeys = (obj) => sorted(Object.keys(obj).filter((k) => !LEGACY_HARDWARE_KEYS.includes(k) && !META_KEYS.includes(k)));

/** 기준(before)의 모든 키·값이 현재(after)에 그대로 있는지 — 더하기만 허용. */
function assertAddOnly(after, before, trail = '') {
  for (const key of Object.keys(before)) {
    const here = `${trail}${key}`;
    expect(Object.prototype.hasOwnProperty.call(after, key)).toBe(true);
    const b = before[key];
    const a = after[key];
    if (b !== null && typeof b === 'object' && !Array.isArray(b)) {
      expect(a !== null && typeof a === 'object').toBe(true);
      assertAddOnly(a, b, `${here}.`);
    } else {
      expect({ [here]: a }).toEqual({ [here]: b });
    }
  }
}

describe('bom-rules.json hardware 블록 — 양식 메타', () => {
  test('hardware 블록이 있고 _source 는 양식 경로를 가리키며 _asOf 는 null 또는 YYYY-MM-DD', () => {
    expect(rules.hardware).toEqual(expect.any(Object));
    expect(rules.hardware._source).toContain('docs/design-rules/hardware.md');
    const asOf = rules.hardware._asOf;
    expect(asOf === null || /^\d{4}-\d{2}-\d{2}$/.test(asOf)).toBe(true);
  });

  test('양식 절이 9개 이상이고 절 키·행 키가 절 안에서 유일하다', () => {
    expect(form.length).toBeGreaterThanOrEqual(9);
    expect(new Set(form.map((t) => t.key)).size).toBe(form.length);
    for (const t of form) {
      const subs = t.rows.map((r) => r.subKey);
      expect(subs.every(Boolean)).toBe(true);
      expect(new Set(subs).size).toBe(subs.length);
      expect(t.rows.length).toBeGreaterThan(0);
    }
  });
});

describe('양식 ↔ JSON 키 동기', () => {
  test('절 키 집합 = hardware 키 집합 (프로토타입 키·메타 제외)', () => {
    expect(formKeys(rules.hardware)).toEqual(sorted(form.map((t) => t.key)));
  });

  test.each(form.map((t) => [t.key, t]))('절 `%s` — 표 머리 6열, 행 sub_key 집합 = hardware.<key> 키 집합', (key, topic) => {
    expect(topic.header).toEqual(FORM_HEADER);
    for (const r of topic.rows) expect(r.cells.length).toBe(FORM_HEADER.length);
    expect(rules.hardware[key]).toEqual(expect.any(Object));
    expect(sorted(Object.keys(rules.hardware[key]))).toEqual(sorted(topic.rows.map((r) => r.subKey)));
  });

  test('「공장 값」빈칸 ⇔ JSON null (양방향)', () => {
    const mismatches = [];
    for (const t of form) {
      for (const r of t.rows) {
        const blank = r.factory === '' || r.factory === '[확인 필요]';
        const value = rules.hardware[t.key][r.subKey];
        if (blank !== (value === null)) mismatches.push(`${t.key}.${r.subKey}: 양식 "${r.factory}" / JSON ${JSON.stringify(value)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('기존 규칙 값 불변 (add-only)', () => {
  test('굳힌 origin/main 기준의 모든 키·값이 그대로 있다', () => {
    assertAddOnly(rules, BASELINE);
    expect(sorted(Object.keys(rules))).toEqual(sorted(Object.keys(BASELINE)));
    for (const k of LEGACY_HARDWARE_KEYS) expect(rules.hardware[k]).toEqual(BASELINE.hardware[k]);
  });

  // 로컬·워크트리에서는 origin/main 실물과도 비교한다. CI 의 얕은 체크아웃엔 그 ref 가 없을 수 있어 그땐 건너뛴다.
  let mainRules = null;
  try {
    const out = execSync(`git show origin/main:${RULES_REL}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    mainRules = JSON.parse(out);
  } catch { /* origin/main 없음 — 굳힌 기준만 본다 */ }

  (mainRules ? test : test.skip)('origin/main 의 bom-rules.json 과 비교해도 더하기만 있다', () => {
    assertAddOnly(rules, mainRules);
  });
});
