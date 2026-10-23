/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, process */
/**
 * 모듈 라이브러리 게이트 7 의 JS 쪽 (docs/01-plan/module-library.plan.md §4) — Text-to-CAD 입력 덤프 · 모듈 카드 보고서 · CI.
 * OCC 대조 자체는 CI module-library-cad.yml (build123d) 이 한다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const Lib = require('../js/module-library/module-library.js');
const pipeline = require('../test-utils/module-library/pipeline');
const { SAMPLES } = require('../test-utils/module-library/samples');
const { dumpSpecOf } = require('../tools/cad/dump-assembly.js');
const DumpLib = require('../tools/module-library/dump-library.js');
const Report = require('../tools/module-library/report.js');

const ROOT = path.join(__dirname, '..');

/** stdout · stderr 를 잠시 막는다 (명령줄 main 이 진행 줄을 쓴다). */
function quiet(fn) {
  const out = process.stdout.write, err = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = out; process.stderr.write = err; }
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'modlib-cad-'));

describe('dump-library.js — Text-to-CAD 입력', () => {
  test('대상: 기본 = verified 모듈, --samples = 견본(sample-), --with-samples = 둘 다', () => {
    const verified = Lib.list({ status: 'verified' }).map((e) => e.id);
    expect(DumpLib.targetsOf([]).map((t) => t.name)).toEqual(verified);
    expect(DumpLib.targetsOf(['--samples']).map((t) => t.name)).toEqual(SAMPLES.map((e) => `sample-${e.id}`));
    expect(DumpLib.targetsOf(['--with-samples']).map((t) => t.name))
      .toEqual(verified.concat(SAMPLES.map((e) => `sample-${e.id}`)));
  });

  test('견본 덤프 = 순수 경로 명세의 dumpSpecOf (dadam.cad-oracle/1) — 파일마다 하나', () => {
    const dir = tmpDir();
    expect(quiet(() => DumpLib.main([dir, '--samples']))).toBe(0);
    expect(fs.readdirSync(dir).sort()).toEqual(SAMPLES.map((e) => `sample-${e.id}.json`).sort());
    SAMPLES.forEach((e) => {
      const d = JSON.parse(fs.readFileSync(path.join(dir, `sample-${e.id}.json`), 'utf8'));
      expect(d.schema).toBe('dadam.cad-oracle/1');
      expect(d).toEqual(JSON.parse(JSON.stringify(dumpSpecOf(`sample-${e.id}`, pipeline.runEntry(e).spec))));
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('모르는 모듈은 거절, 사용법 없이 부르면 2', () => {
    const dir = tmpDir();
    expect(quiet(() => DumpLib.main([dir, 'LB-NOPE-450']))).toBe(2);
    expect(quiet(() => DumpLib.main([]))).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('report.js — 모듈 카드 보고서', () => {
  test('정면도: 전면마다 왼쪽 치수, 경첩 컵, 전체 폭·높이', () => {
    const lower = pipeline.runEntry(SAMPLES[0]);
    const el = Report.elevationSvg(lower.spec, SAMPLES[0]);
    expect(el.overall.W).toBe(450);
    expect(el.overall.H).toBe(870);       // 다리 150 + 몸통 708 + 상판 12
    expect((el.svg.match(/class="hinge"/g) || []).length).toBe(2);
    const drawer = Report.elevationSvg(pipeline.runEntry(SAMPLES[1]).spec, SAMPLES[1]);
    expect((drawer.svg.match(/class="p-front"/g) || []).length).toBe(3);   // 서랍 3단 = 전면 3장
  });

  test('판재 칠: 도어·서랍 전면, 상판, 걸레받이, 목찬넬, 그 밖은 자재로', () => {
    expect(Report.partClassOf({ part: '서랍도어', material: 'MDF' })).toBe('p-front');
    expect(Report.partClassOf({ part: '상판', material: '인조대리석' })).toBe('p-top');
    expect(Report.partClassOf({ part: '목찬넬(중간 전면)', material: 'MDF' })).toBe('p-channel');
    expect(Report.partClassOf({ part: '측판', material: 'PB' })).toBe('p-pb');
    expect(Report.partClassOf({ part: '천지판', material: 'MDF' })).toBe('p-mdf');
  });

  test('index.html: 이름 · 카드 수 · OCC 결과 · GLB 단추 · three 고정 버전', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, `sample-${SAMPLES[0].id}.glb`), '');
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({
      schema: 'dadam.cad-oracle-report/1',
      results: [{ fixture: `sample-${SAMPLES[0].id}`, rulesVersion: 'x', modules: 1, parts: 8, overlaps: 0, problems: [] }],
    }));
    expect(quiet(() => Report.main([dir, '--samples', '--label', '시험']))).toBe(0);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    expect(html).toMatch(/<title>다담 모듈 라이브러리<\/title>/);
    expect((html.match(/<article class="card"/g) || []).length).toBe(SAMPLES.length);
    expect((html.match(/class="load3d"/g) || []).length).toBe(1);          // GLB 가 있는 모듈만
    expect(html).toMatch(/chip-ok"[^>]*><b>G7<\/b>/);                      // OCC 결과가 있는 모듈
    expect(html).toMatch(/chip-none"[^>]*><b>G7<\/b>/);                    // 미실행
    expect(html).toMatch(/three@\d+\.\d+\.\d+\/build\/three\.module\.js/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('.github/workflows/module-library-cad.yml', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'module-library-cad.yml'), 'utf8');
  const oracle = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'cad-oracle.yml'), 'utf8');

  test('build123d · OCP · uv 버전이 cad-oracle.yml 과 같다', () => {
    ['build123d==0.11.1', 'cadquery-ocp-novtk==7.9.3.1.1'].forEach((pin) => {
      expect(yml).toContain(pin);
      expect(oracle).toContain(pin);
    });
    const uv = (s) => (s.match(/UV_VERSION: '([^']+)'/) || [])[1];
    expect(uv(yml)).toBe(uv(oracle));
  });

  test('라이브러리 · 덤프 · 짓기 · 보고서를 지나고, 보고만 한다 (--strict 없음), 산출물을 올린다', () => {
    expect(yml).toContain("- 'js/module-library/**'");
    expect(yml).toContain('tools/module-library/dump-library.js');
    expect(yml).toContain('tools/cad/build_from_spec.py');
    expect(yml).toContain('tools/module-library/report.js');
    expect(yml.replace(/#.*$/gm, '')).not.toMatch(/--strict/);
    expect(yml).toMatch(/upload-artifact/);
  });
});
