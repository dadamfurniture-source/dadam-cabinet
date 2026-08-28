/**
 * W12-15: 좌측 목록 — 개별 / 배치 / 전체.
 *
 *   · '세트'(회전각 묶음)를 '배치'(배치 단계 영역)로 바꿨다.
 *   · 개별 목록 클릭이 도면에서 모듈을 클릭한 것과 **같은 결과**를 낸다.
 *     예전엔 activeAreaId 를 지워 그 모듈만 크게 띄웠다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

function boot(seed) {
  const s = Object.assign({}, seed);
  const search = s._search || '?design=lm&item=1';
  delete s._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: s });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

describe('탭이 개별 / 배치 / 전체 다', () => {
  test('라벨이 바뀌었다', () => {
    const bar = SRC.slice(SRC.indexOf('<div class="ml-mode-toggle">'), SRC.indexOf('<div class="ml-body"'));
    expect(bar).toContain('>개별<');
    expect(bar).toContain('>배치<');
    expect(bar).toContain('>전체<');
    expect(bar).not.toContain('>세트<');
  });

  test('mode 값이 single / area / all 이다', () => {
    const bar = SRC.slice(SRC.indexOf('<div class="ml-mode-toggle">'), SRC.indexOf('<div class="ml-body"'));
    ['single', 'area', 'all'].forEach((v) => expect(bar).toContain(`data-mode="${v}"`));
    expect(bar).not.toContain('data-mode="set"');
  });

  test('viewMode 주석도 새 값으로 적혀 있다', () => {
    expect(SRC).toMatch(/let viewMode = 'single';\s*\/\/ 'single'\(모듈\) \| 'area'\(배치 영역\) \| 'all'/);
  });
});

describe('세트 모드 잔재가 남지 않았다', () => {
  test('activeSetId · setActiveSet · renderSet3D 가 없다', () => {
    ['activeSetId', 'setActiveSet(', 'renderSet3D('].forEach((k) => {
      // 주석에 이름이 남는 것은 괜찮다 — 코드에서 부르면 안 된다.
      const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code).not.toContain(k);
    });
  });

  test('세트 일괄 자동계산 버튼이 없다', () => {
    expect(SRC).not.toContain('autoCalcBtn');
    expect(SRC).not.toContain('autoCalcBar');
  });

  test('buildSets · autoCalcForSet 은 남아 있다 — 골든이 부른다', () => {
    expect(SRC).toContain('function buildSets(');
    expect(SRC).toContain('function autoCalcForSet(');
    const p = boot(seedFor(FIXTURES.straight));
    expect(typeof p.g('buildSets')).toBe('function');
    expect(typeof p.g('autoCalcForSet')).toBe('function');
  });
});

describe('배치 모드는 영역을 고른다', () => {
  test('영역 목록이 뜬다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setViewMode')('area');
    const rows = p.document.querySelectorAll('#mlBody [data-area-pick]');
    expect(rows.length).toBe(p.g('areas').length);
    expect(rows.length).toBeGreaterThan(0);
  });

  test('행을 누르면 그 영역이 선택된다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setViewMode')('area');
    const rows = [...p.document.querySelectorAll('#mlBody [data-area-pick]')];
    const target = rows[rows.length - 1];
    target.onclick();
    // activeAreaId 는 원시값이라 하네스 스냅샷이 낡는다 — 다시 그린 목록으로 본다.
    p.g('renderModuleList')();
    const active = p.document.querySelector('#mlBody [data-area-pick].active');
    expect(active.getAttribute('data-area-pick')).toBe(target.getAttribute('data-area-pick'));
  });

  test('배치 모드에 들어가면 영역이 하나 골라진다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setViewMode')('area');
    expect(p.g('isAreaView')()).toBe(true);
    expect(p.document.querySelector('#mlBody [data-area-pick].active')).not.toBeNull();
  });

  test('모듈이 없어도 영역 목록이 뜬다', () => {
    // W12-16: 예전엔 `!modules.length` 가드가 먼저 걸려, 모듈을 넣기 전에는
    // 배치 탭이 "아직 모듈이 없습니다" 만 띄우고 영역을 안 보여줬다.
    // (storage 가 비면 loadAreas 가 샘플 영역으로 폴백하므로 영역은 항상 있다.)
    const p = boot({ _search: '?design=none&item=1' });
    expect(p.g('modules')).toHaveLength(0);
    expect(p.g('areas').length).toBeGreaterThan(0);
    p.g('setViewMode')('area');
    const rows = p.document.querySelectorAll('#mlBody [data-area-pick]');
    expect(rows.length).toBe(p.g('areas').length);
    expect(p.document.getElementById('mlBody').textContent).toMatch(/모듈 0개/);
  });

  test('행에 모듈 수와 사용 폭이 적힌다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setViewMode')('area');
    const row = p.document.querySelector('#mlBody [data-area-pick]');
    expect(row.textContent).toMatch(/모듈 \d+개/);
    expect(row.textContent).toMatch(/\d+\/\d+mm/);
  });
});

describe('개별 목록 클릭 = 도면에서 모듈 클릭', () => {
  test('영역 보기를 벗어나지 않는다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const mods = p.g('modules');
    expect(mods.length).toBeGreaterThan(0);
    p.g('setViewMode')('single');
    const row = p.document.querySelector('#mlBody .module-item');
    row.onclick();
    // 예전엔 여기서 activeAreaId 가 null 이 됐다 (모듈 상세 보기)
    expect(p.g('isAreaView')()).toBe(true);
  });

  test('그 모듈이 활성이 된다 — 색이 바뀌는 근거', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setViewMode')('single');
    const rows = [...p.document.querySelectorAll('#mlBody .module-item')];
    const target = rows[rows.length - 1];
    const id = target.getAttribute('data-id');
    target.onclick();
    // activeId 는 원시값이라 스냅샷이 낡는다 — 목록의 active 표시로 본다.
    const after = [...p.document.querySelectorAll('#mlBody .module-item')]
      .find((el) => el.getAttribute('data-id') === id);
    expect(after.className).toContain('active');
  });

  test('우측 패널이 그 모듈로 바뀐다', () => {
    // W12-32: 예전엔 목록을 누르면 떠 있는 옵션 팔레트가 떴다. 이제 편집 지점은
    // 우측 패널 하나다 — 목록 클릭도 도면 클릭과 같은 자리를 채운다.
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setViewMode')('single');
    p.document.querySelector('#mlBody .module-item').onclick();
    expect(p.document.querySelector('.panel-header-title').textContent).toBe('구조 편집');
    const shown = [...p.document.querySelectorAll('#rightPanel .section[data-sec]')]
      .filter((n) => n.style.display !== 'none').map((n) => n.getAttribute('data-sec'));
    expect(shown).toContain('split');
    expect(p.document.querySelector('#sizeBody input[data-dim="W"]')).not.toBeNull();
    expect(p.document.querySelector('.mod-palette')).toBeNull();
  });

  test('모듈이 속한 영역으로 옮겨 간다', () => {
    const p = boot(seedFor(FIXTURES.lShape));
    p.g('setViewMode')('single');
    const rows = [...p.document.querySelectorAll('#mlBody .module-item')];
    const last = rows[rows.length - 1];
    const m = p.g('modules').find((x) => x.id === last.getAttribute('data-id'));
    last.onclick();
    const area = p.g('areaOfModule')(m);
    expect(area).not.toBeNull();
    p.g('setViewMode')('area');
    const active = p.document.querySelector('#mlBody [data-area-pick].active');
    expect(active.getAttribute('data-area-pick')).toBe(area.id);
  });

  test('소스에서 activeAreaId 를 지우지 않는다', () => {
    const at = SRC.indexOf("querySelectorAll('.module-item')");
    expect(at).toBeGreaterThan(-1);
    // 주석에는 옛 동작 설명으로 남아 있어도 된다 — 코드에서 지우면 안 된다.
    const bind = SRC.slice(at, at + 700).replace(/^\s*\/\/[^\r\n]*$/gm, '');
    expect(bind).not.toMatch(/activeAreaId\s*=\s*null/);
    expect(bind).toContain('setActiveModule(el.dataset.id)');
  });
});
