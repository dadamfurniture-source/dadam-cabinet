/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * CAD 검산기 (PR8) — 파이썬은 명세 JSON 만 읽는다. 규칙 숫자가 파이썬에 다시 생기지 않게 지킨다
 * (cad-prototype/sink_set.py 가 KICK_SETBACK 50 · TOP_D 600 으로 이미 어긋났던 일, 계획 §8 위험).
 * 덤프(tools/cad/dump-assembly.js)가 JS 검사기와 같은 답을 싣는지도 본다. OCC 대조 자체는 CI cad-oracle.yml.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CAD = path.join(ROOT, 'tools', 'cad');
const Dump = require('../tools/cad/dump-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');
const { NAMES, specOf } = require('../test-utils/assembly-fixtures.js');
const ALLOW = require('../test-utils/assembly-allowlist.json');

const pyFiles = fs.readdirSync(CAD).filter((f) => f.endsWith('.py'));

/** 문자열·주석을 지운 파이썬 코드 (숫자 리터럴 검사용). */
function codeOnly(src) {
  return src
    .replace(/("""|''')[\s\S]*?\1/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/#.*$/gm, '');
}

describe('tools/cad/*.py', () => {
  test('파이썬 파일이 있다', () => {
    expect(pyFiles).toContain('build_from_spec.py');
  });

  test.each(pyFiles)('%s — ASCII 만 (cadgen 이 윈도에서 cp949 로 읽는다)', (f) => {
    const buf = fs.readFileSync(path.join(CAD, f));
    const bad = [...buf].findIndex((b) => b > 0x7f);
    expect(bad).toBe(-1);
  });

  test.each(pyFiles)('%s — 도메인 숫자 리터럴 없음 (0·1·2 축 번호만, 나머지는 명세 JSON)', (f) => {
    const code = codeOnly(fs.readFileSync(path.join(CAD, f), 'utf8'));
    const nums = code.match(/(?<![\w.])\d+(?:\.\d+)?(?:e[+-]?\d+)?(?![\w.])/gi) || [];
    expect(nums.filter((n) => !['0', '1', '2'].includes(n))).toEqual([]);
  });

  test('검사기가 리터럴을 실제로 잡는다', () => {
    const nums = (s) => codeOnly(s).match(/(?<![\w.])\d+(?:\.\d+)?(?:e[+-]?\d+)?(?![\w.])/gi) || [];
    expect(nums('KICK_SETBACK = 50  # 50 in comment\nx = "600"')).toEqual(['50']);
    expect(nums('from build123d import Box\nv = a[2] + 0.001')).toEqual(['2', '0.001']);
  });
});

describe('dump-assembly.js — 검산기 입력', () => {
  const dumps = Object.fromEntries(NAMES.map((n) => [n, Dump.dumpOf(n)]));

  test.each(NAMES)('%s — 스키마·축·문턱·오차가 실린다', (n) => {
    const d = dumps[n];
    expect(d.schema).toBe('dadam.cad-oracle/1');
    expect(d.fixture).toBe(n);
    expect(d.axes['+x']).toEqual([1, 0, 0]);
    expect(Object.keys(d.axes).sort()).toEqual(['+x', '+y', '+z', '-x', '-y', '-z']);
    expect(d.limits).toEqual(Check.DEFAULT_LIMITS);
    expect(d.tolerance.volumeRel).toBe(0.001);
    expect(d.modules.length).toBeGreaterThan(0);
  });

  test.each(NAMES)('%s — 부재마다 frame·cut·t, 부피 = w·h·t − 관통 따내기', (n) => {
    const { spec } = specOf(n);
    const specParts = spec.items.flatMap((it) => it.modules.flatMap((m) => m.parts));
    const dumped = dumps[n].modules.flatMap((m) => m.parts);
    expect(dumped.map((p) => p.id)).toEqual(specParts.map((p) => p.id));
    dumped.forEach((p) => {
      const notchArea = p.notches.reduce((s, f) => s + (f.u1 - f.u0) * (f.v1 - f.v0), 0);
      expect(p.volume).toBeGreaterThan(0);
      // 따내기끼리 겹치지 않는 골든에서는 단순 차와 같다
      expect(p.volume).toBeCloseTo((p.cut.w * p.cut.h - notchArea) * p.t, 6);
      expect(p.frame.o).toHaveLength(3);
    });
  });

  test.each(NAMES)('%s — JS 겹침 쌍: 검사기 part-overlap 은 덤프 쌍에서 홈 끼움을 뺀 것', (n) => {
    const { spec } = specOf(n);
    const raw = new Set(dumps[n].modules.flatMap((m) => m.overlaps.map((o) => `${o.a}×${o.b}`)));
    const issues = Check.check(spec).issues.filter((i) => i.code === 'part-overlap').map((i) => `${i.partId}×${i.other}`);
    issues.forEach((k) => expect(raw.has(k)).toBe(true));
    dumps[n].modules.forEach((m) => m.overlaps.forEach((o) => {
      expect(o.volume).toBeGreaterThan(Check.DEFAULT_LIMITS.minVolume);
      expect(o.depth).toBeGreaterThan(Check.DEFAULT_LIMITS.minDepth);
    }));
  });

  test('알려진 겹침 (18T 상부 선반 ↔ 처짐방지목, D10) 이 덤프에 있다 — 검산기가 같은 쌍을 찾아야 한다', () => {
    const raw = new Set(dumps.sink18.modules.flatMap((m) => m.overlaps.map((o) => `sink18|${o.a}×${o.b}`)));
    ALLOW.entries.filter((e) => e.id.startsWith('sink18|')).forEach((e) => expect(raw.has(e.id)).toBe(true));
  });

  // 모듈 라이브러리(docs/01-plan/module-library.plan.md §4)가 골든 픽스처 밖의 명세를 같은 형식으로 덤프한다
  test.each(NAMES)('%s — dumpSpecOf(name, spec) 는 dumpOf(name) 과 같다', (n) => {
    expect(Dump.dumpSpecOf(n, specOf(n).spec)).toEqual(dumps[n]);
  });

  test('명령줄: 모르는 픽스처는 거절, 출력 파일은 픽스처마다', () => {
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-oracle-'));
    const err = process.stderr.write;
    const out = process.stdout.write;
    try {
      process.stderr.write = () => true;
      process.stdout.write = () => true;
      expect(Dump.main([dir, 'nope'])).toBe(2);
      expect(Dump.main([dir, 'shoerack', 'fridge'])).toBe(0);
    } finally {
      process.stderr.write = err;
      process.stdout.write = out;
    }
    expect(fs.readdirSync(dir).sort()).toEqual(['fridge.json', 'shoerack.json']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('.github/workflows/cad-oracle.yml', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'cad-oracle.yml'), 'utf8');
  const doc = fs.readFileSync(path.join(CAD, 'build_from_spec.py'), 'utf8');
  test('build123d · OCP 버전이 스크립트 안내와 같다', () => {
    ['build123d==0.11.1', 'cadquery-ocp-novtk==7.9.3.1.1'].forEach((pin) => {
      expect(yml).toContain(pin);
      expect(doc).toContain(pin);
    });
  });
  test('게이트로 돈다 (--strict), 실패해도 산출물을 올린다', () => {
    // 주석은 빼고 본다 — 실행 줄에 --strict 가 있어야 한다
    expect(yml.replace(/#.*$/gm, '')).toMatch(/build_from_spec\.py[^\n]*--strict/);
    expect(yml).toMatch(/if: always\(\)\s*\n\s*uses: actions\/upload-artifact/);
  });
});
