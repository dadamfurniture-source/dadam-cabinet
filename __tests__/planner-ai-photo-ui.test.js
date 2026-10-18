/**
 * R2: 디테일 「사진으로 만들기」 — 화면.
 *
 * 보는 것:
 *   1) 섹션이 **디테일 모드에서만** 선다 (구조 단계 화면은 바이트 하나 달라지지 않는다)
 *   2) 크레딧 20 이 **누르기 전에** 보인다
 *   3) 버튼을 누르면 약속한 본문(room_image·category·design_spec)이 나간다
 *      2026-10-18 (P5): + mode:'planner' · renders(입면 PNG · 3/4 JPEG) · aspect. 옛 키는 없다
 *   4) 폴링이 잡의 한국어 라벨을 따라 올라가고, done 이면 썸네일이 선다
 *   5) 새로고침해도 돌던 잡에 다시 붙는다
 *   6) 실패마다 한국어 한 줄
 *
 * 픽셀은 보지 않는다 — jsdom 에는 WebGL 이 없고 이 기능은 3D 를 쓰지 않는다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
const { PLANNER_DETAIL_CSS } = require('../js/planner/planner-detail');

const SCOPE = '::gold:1';

/** 직선 싱크대 — 하부 셋 · 상부 둘 · 분배기 · 후드 (골든 픽스처 그대로) */
const MODULES = [
  { id: 'lower-0', section: 'lower', W: 1200, H: 870, D: 650, x: 0, y: 0, rotation: 0, areaId: 'area-lower-0', finishings: [] },
  { id: 'lower-1', section: 'lower', W: 1000, H: 870, D: 650, x: 1200, y: 0, rotation: 0, areaId: 'area-lower-1', finishings: [] },
  { id: 'lower-2', section: 'lower', W: 1400, H: 870, D: 650, x: 2200, y: 0, rotation: 0, areaId: 'area-lower-2', finishings: [] },
  { id: 'upper-3', section: 'upper', W: 1800, H: 780, D: 320, x: 0, y: 0, rotation: 0, areaId: 'area-upper-3', finishings: [] },
  { id: 'sink-5', section: 'sink', W: 700, H: 500, D: 400, x: 1300, y: 0, rotation: 0, areaId: 'area-lower-1', finishings: [] },
];

/**
 * 가짜 PlannerCapture — 공개 API capture({kind, longEdge, clean}) 만 흉내 낸다.
 * fail: { front?: 메시지, massing?: 메시지 } 이면 그 kind 는 {ok:false} 를 낸다.
 */
function fakeCapture(win, fail = {}) {
  const calls = [];
  return {
    calls,
    async capture(o) {
      calls.push(o);
      if (fail[o.kind]) return { ok: false, reason: 'error', message: fail[o.kind] };
      const w = o.kind === 'front' ? 1536 : 1024;
      const h = o.kind === 'front' ? 640 : 576;
      return { ok: true, kind: o.kind, width: w, height: h, clean: !!o.clean, blob: new win.Blob(['PNG-' + o.kind], { type: 'image/png' }) };
    },
  };
}
const b64 = (s) => Buffer.from(s).toString('base64');

function boot(opt = {}) {
  const seed = seedFor(FIXTURES.straight);
  const search = seed._search + (opt.structure ? '' : '&stage=detail') + (opt.search || '');
  delete seed._search;
  seed['dadam_struct_modules_v1' + SCOPE] = JSON.stringify(MODULES);
  Object.assign(seed, opt.storage || {});
  const p = bootPlanner('mockup-structure.html', { search, storage: seed });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  p.g('loadModules')();
  p.AP = p.window.PlannerAiPhoto;
  // 로그인·설계 저장은 이 시험의 대상이 아니다 — supabase SDK 는 jsdom 에 실리지 않는다.
  p.AP.ready = async () => ({ ok: true, ids: { designId: 'gold', itemId: 1 } });
  p.AP.token = async () => 'jwt-token';
  p.AP.POLL_MS = 1;
  // jsdom 에는 WebGL·canvas 가 없다 — 캡처와 JPEG 변환은 갈아 끼운다 (2026-10-18 P5)
  p.cap = fakeCapture(p.window, opt.captureFail);
  p.AP._capture = p.cap;
  p.jpegCalls = [];
  p.AP._toJpeg = async (blob, o) => { p.jpegCalls.push(o); return { base64: 'SlBH', mime: 'image/jpeg' }; };
  // 하네스는 부팅 뒤에 loadModules 를 한 번 더 부른다 (다른 플래너 시험과 같은 방식) —
  // 모드 진입 때 그렸던 화면이 그 사이 비어 있었으므로 여기서 한 번 다시 그린다.
  if (p.window.PlannerDetail.isActive()) p.AP.render();
  return p;
}

/** 방 사진 한 장을 이미 올려 둔 상태 */
function withPhoto(p) {
  p.AP.img = { base64: 'QUJD', mime: 'image/jpeg', preview: 'data:image/jpeg;base64,QUJD', name: '방.jpg', width: 1600, height: 1200 };
  p.AP.render();
  return p;
}

/** fetch 스텁 — 응답을 순서대로 낸다. */
function fakeFetch(steps) {
  const calls = [];
  const queue = steps.slice();
  const fn = async (url, opt) => {
    calls.push({ url, opt, body: opt && opt.body ? JSON.parse(opt.body) : null });
    const s = queue.length > 1 ? queue.shift() : queue[0];
    if (s.throw) throw new Error(s.throw);
    return {
      ok: s.status ? s.status < 400 : true,
      status: s.status || 200,
      json: async () => s.json,
    };
  };
  fn.calls = calls;
  return fn;
}

const body = (p) => p.document.getElementById('aiPhotoBody');
const text = (p) => body(p).textContent;
/** 폴링 한 바퀴(POLL_MS=1) 를 기다린다 */
const wait = (ms = 12) => new Promise((r) => setTimeout(r, ms));

// ────────────────────────────────────────────────────────────

describe('섹션은 디테일 모드에서만 선다', () => {
  test('마크업은 우측 패널 안에 한 벌, 구조 단계에서는 숨는다', () => {
    const p = boot({ structure: true });
    const sec = p.document.querySelector('#rightPanel .section[data-sec="aiphoto"]');
    expect(sec).not.toBeNull();
    expect(sec.querySelector('#aiPhotoBody')).not.toBeNull();
    // applyPanelLayout 이 인라인 display 로 감춘다 — 구조 단계 목록에 들지 않는다
    expect(sec.style.display).toBe('none');
    const shown = [...p.document.querySelectorAll('#rightPanel .section[data-sec]')]
      .filter((n) => n.style.display !== 'none')
      .map((n) => n.getAttribute('data-sec'));
    expect(shown).toEqual(['size', 'height']);
    expect(shown).not.toContain('aiphoto');
  });

  test('디테일 모드 CSS 가 그 섹션만 되살린다', () => {
    // 예외 사슬에 들어야 숨김 규칙에 안 걸리고, 보임 규칙이 인라인 none 을 이긴다
    expect(PLANNER_DETAIL_CSS).toContain(':not([data-sec="aiphoto"])');
    expect(PLANNER_DETAIL_CSS).toContain('.section[data-sec="aiphoto"]{display:block!important}');
    // 예전 섹션의 예외도 그대로다
    expect(PLANNER_DETAIL_CSS).toContain(':not([data-sec="detail-renders"])');
  });

  test('디테일 모드에 들어가면 내용이 찬다', () => {
    const p = boot();
    expect(p.window.PlannerDetail.isActive()).toBe(true);
    expect(body(p).querySelector('.ap-wrap')).not.toBeNull();
    expect(p.document.getElementById('planner-ai-photo-css')).not.toBeNull();
  });

  test('HTML 배선 — 섹션·제목·mount', () => {
    expect(HTML).toContain('data-sec="aiphoto"');
    expect(HTML).toContain('id="aiPhotoBody"');
    expect(HTML).toContain("aiphoto: '사진으로 만들기'");
    expect(HTML).toContain('PlannerAiPhoto.mount({');
    expect(HTML).toContain('boxOf: (m) => modulePlaneBox(m),');
    expect(HTML).toContain('wardrobeFrontOf: (m, s) => wardrobeLayoutFor(m, s),');
    expect(HTML).toContain('js/planner/ai-photo.js');
    // #682 에서 지운 것들이 돌아오지 않았다
    expect(HTML).not.toContain('photo-solve.js');
    expect(HTML).not.toContain('photo-mode.js');
  });
});

describe('누르기 전에 보이는 것', () => {
  test('크레딧 20 이 버튼보다 위에 있다', () => {
    const p = boot();
    const host = body(p);
    expect(host.querySelector('.ap-cost').textContent).toContain('20 크레딧');
    const html = host.innerHTML;
    expect(html.indexOf('ap-cost')).toBeLessThan(html.indexOf('aiPhotoGo'));
  });

  test('무엇을 만들지 한 줄로 — 품목·런 폭·모듈 수', () => {
    const p = boot();
    const sum = body(p).querySelector('.ap-sum').textContent;
    expect(sum).toContain('싱크대');
    expect(sum).toContain('3600mm');
    expect(sum).toContain('가전 1');
  });

  test('사진이 없으면 버튼이 잠긴다', () => {
    const p = boot();
    expect(body(p).querySelector('#aiPhotoGo').disabled).toBe(true);
    withPhoto(p);
    expect(body(p).querySelector('#aiPhotoGo').disabled).toBe(false);
    expect(body(p).querySelector('.ap-drop img').getAttribute('src')).toContain('base64');
  });

  test('올릴 곳이 끌어놓기를 받는다', () => {
    const p = boot();
    const drop = body(p).querySelector('#aiPhotoDrop');
    expect(typeof drop.onclick).toBe('function');
    const ev = new p.window.Event('dragover', { bubbles: true, cancelable: true });
    drop.dispatchEvent(ev);
    expect(drop.classList.contains('ap-over')).toBe(true);
  });
});

describe('생성 요청', () => {
  test('약속한 본문이 나간다 — room_image · category · design_spec', async () => {
    const p = withPhoto(boot());
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1', status: 'queued', credit: { balance: 80, cost: 20 } } },
      { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [] } } },
    ]);
    await p.AP.submit();
    const call = p.AP._fetch.calls[0];
    expect(call.url).toContain('/api/generate');
    expect(call.opt.method).toBe('POST');
    expect(call.opt.headers.Authorization).toBe('Bearer jwt-token');
    expect(call.body.room_image).toBe('QUJD');
    expect(call.body.image_type).toBe('image/jpeg');
    expect(call.body.category).toBe('sink');
    // design_spec 은 요청의 category 와 같아야 한다 (다르면 400 bad_design_spec)
    expect(call.body.design_spec.category).toBe('sink');
    expect(call.body.design_spec.wallRunMm).toBe(3600);
    expect(call.body.design_spec.sections.lower.modules.length).toBeGreaterThan(0);
    expect(call.body.design_spec.appliances).toEqual([{ kind: 'sink', fromLeftMm: 1300, widthMm: 700 }]);
    // #682 에서 지운 것들이 본문으로 돌아오지 않았다
    expect(call.body.camera).toBeUndefined();
    expect(call.body.floor_quad).toBeUndefined();
  });

  // 2026-10-18 (P5): 플래너 모드 — design-spec-prompt.md "플래너 모드" 계약
  test('플래너 모드 본문 — mode · renders(입면 PNG · 3/4 JPEG) · aspect, 옛 키 없음', async () => {
    const p = withPhoto(boot());
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1' } },
      { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [] } } },
    ]);
    await p.AP.submit();
    // 캡처 — 공개 API 만, clean 으로, 계획 §5 크기
    expect(p.cap.calls).toEqual([
      { kind: 'front', longEdge: 1536, clean: true },
      { kind: 'massing', longEdge: 1024, clean: true },
    ]);
    expect(p.jpegCalls).toEqual([{ quality: 0.9 }]);
    const b = p.AP._fetch.calls[0].body;
    expect(b.mode).toBe('planner');
    expect(b.renders).toEqual([
      { role: 'elevation', base64: b64('PNG-front'), mime: 'image/png' },
      { role: 'massing', base64: 'SlBH', mime: 'image/jpeg' },
    ]);
    expect(b.aspect).toBe('4:3');                  // 1600×1200
    expect(b.room_image).toBe('QUJD');
    expect(b.design_spec.category).toBe(b.category);
    // 옛 경로의 키는 하나도 없다 (워커가 variants 를 false 로 강제한다)
    ['realize', 'engine', 'control_image', 'control_type', 'control_size', 'variants', 'reference_images']
      .forEach((k) => expect(b).not.toHaveProperty(k));
    expect(Object.keys(b).sort()).toEqual(
      ['aspect', 'category', 'design_spec', 'image_type', 'mode', 'renders', 'room_image']);
  });

  test('세로 사진이면 aspect 도 세로 — 583×781 → 3:4', async () => {
    const p = boot();
    p.AP.img = { base64: 'QUJD', mime: 'image/jpeg', preview: 'data:image/jpeg;base64,QUJD', name: '세로.jpg', width: 583, height: 781 };
    p.AP.render();
    expect(body(p).querySelector('#aiPhotoRatio').textContent).toContain('세로 사진 · 3:4');
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1' } },
      { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [] } } },
    ]);
    await p.AP.submit();
    expect(p.AP._fetch.calls[0].body.aspect).toBe('3:4');
  });

  test('3/4 뷰를 못 찍으면 입면만 보낸다', async () => {
    const p = withPhoto(boot({ captureFail: { massing: '3D 에 찍을 모듈이 없습니다' } }));
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1' } },
      { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [] } } },
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try { await p.AP.submit(); } finally { warn.mockRestore(); }
    const b = p.AP._fetch.calls[0].body;
    expect(b.renders.map((r) => r.role)).toEqual(['elevation']);
    expect(p.jpegCalls).toHaveLength(0);
  });

  test('3/4 뷰를 JPEG 로 못 바꿔도 입면만 보낸다', async () => {
    const p = withPhoto(boot());
    p.AP._toJpeg = async () => { throw new Error('JPEG 로 바꾸지 못했습니다'); };
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1' } },
      { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [] } } },
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try { await p.AP.submit(); } finally { warn.mockRestore(); }
    expect(p.AP._fetch.calls[0].body.renders.map((r) => r.role)).toEqual(['elevation']);
  });

  test('입면을 못 찍으면 요청하지 않는다 (크레딧을 안 쓴다)', async () => {
    const p = withPhoto(boot({ captureFail: { front: '3D 가 아직 준비되지 않았습니다' } }));
    p.AP._fetch = fakeFetch([{ json: {} }]);
    const r = await p.AP.submit();
    expect(r.ok).toBe(false);
    expect(p.AP._fetch.calls).toHaveLength(0);
    expect(r.message).toContain('도면 입면을 찍지 못했습니다');
    expect(r.message).toContain('크레딧은 쓰지 않았습니다');
    expect(body(p).querySelector('.ap-msg').classList.contains('ap-bad')).toBe(true);
    expect(body(p).querySelector('#aiPhotoGo').disabled).toBe(false);
  });

  test('PlannerCapture 가 없으면 요청하지 않는다', async () => {
    const p = withPhoto(boot());
    p.AP._capture = { };
    p.AP._fetch = fakeFetch([{ json: {} }]);
    const r = await p.AP.submit();
    expect(r.ok).toBe(false);
    expect(p.AP._fetch.calls).toHaveLength(0);
  });

  test('화면 — 실사화 체크박스·구조 조건 드롭존이 없다, 비율·크레딧·버튼은 있다', () => {
    const p = withPhoto(boot());
    p.AP.realize = true;          // 예전 상태가 남아 있어도 그리지 않는다
    p.AP.render();
    const host = body(p);
    expect(host.querySelector('#aiPhotoRealize')).toBeNull();
    expect(host.querySelector('#aiPhotoControlDrop')).toBeNull();
    expect(host.querySelector('#aiPhotoRatio').textContent).toContain('가로 사진 · 4:3');
    expect(host.querySelector('.ap-cost').textContent).toContain('20 크레딧');
    expect(host.querySelectorAll('button')).toHaveLength(1);
  });
});

describe('평가 스위치 (eval=1)', () => {
  test('주소에 eval=1 이 없으면 안 보이고, 본문은 3/4 를 싣는다', async () => {
    const p = withPhoto(boot());
    expect(body(p).querySelector('#aiPhotoNoMassing')).toBeNull();
    p.AP.noMassing = true;        // 주소가 아니면 상태가 남아 있어도 무시한다
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1' } },
      { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [] } } },
    ]);
    await p.AP.submit();
    expect(p.AP._fetch.calls[0].body.renders.map((r) => r.role)).toEqual(['elevation', 'massing']);
  });

  test('eval=1 이면 보이고, 켜면 입면만 보낸다', async () => {
    const p = withPhoto(boot({ search: '&eval=1' }));
    const box = body(p).querySelector('#aiPhotoNoMassing');
    expect(box).not.toBeNull();
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new p.window.Event('change'));
    expect(p.AP.noMassing).toBe(true);
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1' } },
      { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [] } } },
    ]);
    await p.AP.submit();
    expect(p.AP._fetch.calls[0].body.renders.map((r) => r.role)).toEqual(['elevation']);
    expect(p.cap.calls.map((c) => c.kind)).toEqual(['front']);
    // 다시 그려도 체크가 남는다
    expect(body(p).querySelector('#aiPhotoNoMassing').checked).toBe(true);
  });

  test('eval=1 이어도 끄면 그대로 3/4 를 싣는다', async () => {
    const p = withPhoto(boot({ search: '&eval=1' }));
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1' } },
      { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [] } } },
    ]);
    await p.AP.submit();
    expect(p.AP._fetch.calls[0].body.renders.map((r) => r.role)).toEqual(['elevation', 'massing']);
  });
});

// 2026-10-18: 이미지 모델 고르기 — 같은 사진·도면을 GPT 로도 돌려 비교 (워커 #803 의 image_provider)
describe('이미지 모델 고르기 (eval=1)', () => {
  const PROVIDER_KEY = 'dadam_aiphoto_provider_v1';
  const okFetch = (generation = { id: 'gen-1', status: 'done', progress: 100, images: [] }) => fakeFetch([
    { status: 202, json: { success: true, id: 'gen-1' } },
    { json: { success: true, generation } },
  ]);
  const radios = (p) => [...body(p).querySelectorAll('input[name="aiPhotoProvider"]')];
  const choose = (p, v) => {
    const r = radios(p).find((x) => x.value === v);
    r.checked = true;
    r.dispatchEvent(new p.window.Event('change'));
  };

  test('eval=1 이 없으면 토글이 없고, 저장된 값이 GPT 여도 본문은 그대로', async () => {
    const p = withPhoto(boot({ storage: { [PROVIDER_KEY]: 'openai' } }));
    expect(body(p).querySelector('#aiPhotoProvider')).toBeNull();
    expect(radios(p)).toHaveLength(0);
    p.AP.imageProvider = 'openai';  // 상태가 남아 있어도 주소가 아니면 무시한다
    p.AP._fetch = okFetch();
    await p.AP.submit();
    const b = p.AP._fetch.calls[0].body;
    expect(b).not.toHaveProperty('image_provider');
    expect(Object.keys(b).sort()).toEqual(
      ['aspect', 'category', 'design_spec', 'image_type', 'mode', 'renders', 'room_image']);
  });

  test('eval=1 이면 Gemini/GPT 두 개, 기본은 Gemini 이고 본문에 키가 없다', async () => {
    const p = withPhoto(boot({ search: '&eval=1' }));
    const rs = radios(p);
    expect(rs.map((r) => r.value)).toEqual(['gemini', 'openai']);
    expect(rs.map((r) => r.parentNode.textContent.trim())).toEqual(['Gemini', 'GPT']);
    expect(rs.find((r) => r.checked).value).toBe('gemini');
    // 평가 스위치 옆에 있다
    expect(body(p).querySelector('#aiPhotoNoMassing')).not.toBeNull();
    p.AP._fetch = okFetch();
    await p.AP.submit();
    expect(p.AP._fetch.calls[0].body).not.toHaveProperty('image_provider');
  });

  test('GPT 를 고르면 본문에 image_provider:openai, 고른 값을 기억한다', async () => {
    const p = withPhoto(boot({ search: '&eval=1' }));
    choose(p, 'openai');
    expect(p.storage.getItem(PROVIDER_KEY)).toBe('openai');
    p.AP._fetch = okFetch();
    await p.AP.submit();
    const b = p.AP._fetch.calls[0].body;
    expect(b.image_provider).toBe('openai');
    expect(b.mode).toBe('planner');
    // 다시 그려도 GPT 가 골라져 있다
    expect(radios(p).find((r) => r.checked).value).toBe('openai');
    // Gemini 로 돌리면 키가 빠진다
    choose(p, 'gemini');
    expect(p.storage.getItem(PROVIDER_KEY)).toBe('gemini');
    p.AP._fetch = okFetch();
    await p.AP.submit();
    expect(p.AP._fetch.calls[0].body).not.toHaveProperty('image_provider');
  });

  test('새로 열어도 기억한 GPT 가 골라져 있다', () => {
    const p = withPhoto(boot({ search: '&eval=1', storage: { [PROVIDER_KEY]: 'openai' } }));
    expect(radios(p).find((r) => r.checked).value).toBe('openai');
    expect(p.AP.provider()).toBe('openai');
  });

  test('저장소가 막혀도 고를 수 있다 (try/catch)', () => {
    const p = withPhoto(boot({ search: '&eval=1' }));
    // 하네스의 localStorage 는 p.storage 그 자체다
    const spy = jest.spyOn(p.storage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const spyGet = jest.spyOn(p.storage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      expect(p.AP.pickedProvider()).toBe('gemini');
      expect(p.AP.setProvider('openai')).toBe('openai');
      expect(p.AP.provider()).toBe('openai');
    } finally { spy.mockRestore(); spyGet.mockRestore(); }
  });

  const base = { slot: 'base', label: '기본안', url: 'https://x/base.png' };
  const gen = (img, extra = {}) => ({ id: 'gen-1', status: 'done', progress: 100, images: [{ ...base, ...img }], options: { mode: 'planner' }, layout: { verify: { ok: true, score: 5, max: 5 } }, ...extra });

  test('결과 줄 — GPT 가 그렸으면 모델 이름', async () => {
    const p = withPhoto(boot({ search: '&eval=1' }));
    choose(p, 'openai');
    p.AP._fetch = okFetch(gen({ provider: 'openai', model: 'gpt-image-2.5-sunburst' }, { model: 'gpt-image-2.5-sunburst' }));
    await p.AP.submit();
    expect(body(p).querySelector('#aiPhotoDrawnBy').textContent).toBe('그린 모델: GPT (gpt-image-2.5-sunburst)');
  });

  test('결과 줄 — GPT 실패 → Gemini 대신 (사유 포함), eval 이 없어도 보인다', async () => {
    const p = withPhoto(boot());
    p.AP._fetch = okFetch(gen({ provider: 'gemini', model: 'gemini-3-pro-image', fallback: true, fallback_reason: 'OpenAI 404: model not found' }));
    await p.AP.submit();
    const line = body(p).querySelector('#aiPhotoDrawnBy');
    expect(line.textContent).toBe('GPT 실패 → Gemini 대신 (gemini-3-pro-image) — OpenAI 404: model not found');
    expect(line.classList.contains('ap-verify-bad')).toBe(true);
  });

  test('결과 줄 — Gemini 정상은 eval=1 일 때만 (평소 화면은 그대로)', async () => {
    const p = withPhoto(boot({ search: '&eval=1' }));
    p.AP._fetch = okFetch(gen({}, { model: 'gemini-3-pro-image' }));
    await p.AP.submit();
    expect(body(p).querySelector('#aiPhotoDrawnBy').textContent).toBe('그린 모델: Gemini (gemini-3-pro-image)');

    const q = withPhoto(boot());
    q.AP._fetch = okFetch(gen({}, { model: 'gemini-3-pro-image' }));
    await q.AP.submit();
    expect(body(q).querySelector('#aiPhotoDrawnBy')).toBeNull();
  });
});

describe('결과 — 대조 ok / 불일치 / internal_only (계획 §6.3)', () => {
  const base = { slot: 'base', label: '기본안', url: 'https://x/base.png' };
  const done = (gen) => fakeFetch([
    { status: 202, json: { success: true, id: 'gen-1' } },
    { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [base], ...gen } } },
  ]);

  test('대조 ok → ✓ 와 점수, 내부 확인용 표시·입면 없음', async () => {
    const p = withPhoto(boot());
    p.AP._fetch = done({ options: { mode: 'planner', aspect: '4:3' }, layout: { verify: { ok: true, score: 4.8, max: 5, issues: [] } } });
    await p.AP.submit();
    const host = body(p);
    expect(host.textContent).toContain('✓ 역판독 대조: 도면의 순서·개수와 일치 (4.8/5)');
    expect(host.textContent).not.toContain('내부 확인용');
    expect(host.querySelector('.ap-elev')).toBeNull();
    expect(host.querySelectorAll('.ap-thumb')).toHaveLength(1);
  });

  test('불일치 → ⚠ 사유 + 내부 확인용 + 입면을 결과 옆에', async () => {
    const p = withPhoto(boot());
    p.AP._fetch = done({
      options: { mode: 'planner', aspect: '4:3', internal_only: true },
      layout: { verify: { ok: false, score: 2.5, max: 5, issues: ['counts: expected 5 doors + 0 drawers, read 7 + 0'] } },
    });
    await p.AP.submit();
    const host = body(p);
    const box = host.querySelector('#aiPhotoInternal');
    expect(box.textContent).toContain('⚠ 내부 확인용 — 고객 공유 불가');
    expect(box.textContent).toContain('도면과 어긋남 (2.5/5)');
    expect(box.textContent).toContain('counts: expected 5 doors');
    expect(host.textContent).not.toContain('✓');
    const thumbs = host.querySelectorAll('.ap-thumbs.ap-pair .ap-thumb');
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0].querySelector('img').getAttribute('src')).toBe('https://x/base.png');
    const elev = host.querySelector('.ap-elev img');
    expect(elev.getAttribute('src')).toBe('data:image/png;base64,' + b64('PNG-front'));
    expect(host.querySelector('.ap-elev').textContent).toContain('도면 입면');
    // 공유 버튼은 패널에 없다
    expect(host.textContent).not.toContain('공유하기');
  });

  test('internal_only (대조 실패) → ⚠ 사유 + 내부 확인용', async () => {
    const p = withPhoto(boot());
    p.AP._fetch = done({
      options: { mode: 'planner', internal_only: true },
      layout: { verify: { ok: null, error: 'image_too_large' } },
    });
    await p.AP.submit();
    const box = body(p).querySelector('#aiPhotoInternal');
    expect(box.textContent).toContain('내부 확인용 — 고객 공유 불가');
    expect(box.textContent).toContain('도면과 대조하지 못했습니다 — image_too_large');
    expect(body(p).querySelector('.ap-elev')).not.toBeNull();
  });

  test('새로고침 뒤 다시 붙은 내부 확인용 결과 — 입면이 없다고 말한다', async () => {
    const p = boot({ storage: { ['dadam_aiphoto_job_v1' + SCOPE]: JSON.stringify({ id: 'gen-x' }) } });
    p.AP._fetch = fakeFetch([
      { json: { success: true, generation: { id: 'gen-x', status: 'done', progress: 100, images: [base], options: { mode: 'planner', internal_only: true } } } },
    ]);
    await p.AP.reattach();
    const box = body(p).querySelector('#aiPhotoInternal');
    expect(box.textContent).toContain('도면과 대조한 기록이 없습니다');
    expect(box.textContent).toContain('이 탭에서 만든 결과일 때만');
    expect(body(p).querySelector('.ap-elev')).toBeNull();
  });
});

describe('생성 요청 (이어서)', () => {

  test('잡 id 를 스코프별로 기억한다', async () => {
    const p = withPhoto(boot());
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1' } },
      { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [] } } },
    ]);
    await p.AP.submit();
    const raw = p.storage.getItem('dadam_aiphoto_job_v1' + SCOPE);
    expect(JSON.parse(raw).id).toBe('gen-1');
  });
});

describe('진행 · 결과', () => {
  test('라벨이 잡을 따라 올라가고, done 이면 썸네일이 선다', async () => {
    const p = withPhoto(boot());
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1' } },
      { json: { success: true, generation: { id: 'gen-1', status: 'rendering', progress: 30, step_label: '기본안을 그리는 중' } } },
      { json: { success: true, generation: { id: 'gen-1', status: 'qc', progress: 60, step_label: '품질을 확인하는 중' } } },
      {
        json: {
          success: true,
          generation: {
            id: 'gen-1', status: 'done', progress: 100, step_label: '완료',
            images: [
              { slot: 'base', label: '싱크대 · 기본안', url: 'https://s/base.png' },
              { slot: 'v1', label: '추천안 1', url: 'https://s/v1.png' },
            ],
          },
        },
      },
    ]);
    // 2026-10-18: 요청 전에 도면을 찍고 읽는다(FileReader 는 매크로태스크) — 몇 틱이 아니라 화면을 기다린다
    p.AP.POLL_MS = 40;
    const until = async (s) => { for (let i = 0; i < 200 && !text(p).includes(s); i++) await wait(1); };
    const run = p.AP.submit();
    await until('대기 중');
    expect(text(p)).toContain('대기 중');
    await until('기본안을 그리는 중');
    expect(text(p)).toContain('기본안을 그리는 중');
    await run;

    const thumbs = body(p).querySelectorAll('.ap-thumb');
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0].tagName).toBe('A');                        // 눌러서 크게 보기
    expect(thumbs[0].getAttribute('href')).toBe('https://s/base.png');
    expect(thumbs[0].querySelector('img').getAttribute('src')).toBe('https://s/base.png');
    expect(thumbs[0].textContent).toContain('기본안');
    // 「다시 만들기」
    expect(body(p).querySelector('#aiPhotoGo').textContent).toBe('다시 만들기');
    expect(body(p).querySelector('#aiPhotoGo').disabled).toBe(false);
    // 결과의 자리매김을 적어 둔다 (계획 §7-1)
    expect(text(p)).toContain('실제 제작 도면과 다를 수 있습니다');
  });

  test('실패하면 이유를 말하고 기억해 둔 잡을 지운다', async () => {
    const p = withPhoto(boot());
    p.AP._fetch = fakeFetch([
      { status: 202, json: { success: true, id: 'gen-1' } },
      { json: { success: true, generation: { id: 'gen-1', status: 'failed', error: '이미지를 만들지 못했습니다' } } },
    ]);
    await p.AP.submit();
    expect(text(p)).toContain('이미지를 만들지 못했습니다');
    expect(body(p).querySelector('.ap-msg').classList.contains('ap-bad')).toBe(true);
    expect(p.storage.getItem('dadam_aiphoto_job_v1' + SCOPE)).toBeNull();
  });
});

describe('새로고침해도 돌던 잡을 잃지 않는다', () => {
  test('기억해 둔 id 로 다시 붙어 폴링을 잇는다', async () => {
    const p = boot({ storage: { ['dadam_aiphoto_job_v1' + SCOPE]: JSON.stringify({ id: 'gen-old', at: 'x' }) } });
    p.AP._fetch = fakeFetch([
      { json: { success: true, generation: { id: 'gen-old', status: 'variants', progress: 70, step_label: '추천안을 그리는 중' } } },
      { json: { success: true, generation: { id: 'gen-old', status: 'done', progress: 100, images: [{ slot: 'base', label: '기본안', url: 'https://s/b.png' }] } } },
    ]);
    const r = await p.AP.reattach();
    expect(p.AP._fetch.calls[0].url).toContain('/api/generate/gen-old');
    expect(p.AP._fetch.calls[0].opt.headers.Authorization).toBe('Bearer jwt-token');
    expect(r.ok).toBe(true);
    expect(body(p).querySelectorAll('.ap-thumb')).toHaveLength(1);
  });

  test('이미 끝난 잡이면 결과만 다시 그린다 (폴링하지 않는다)', async () => {
    const p = boot({ storage: { ['dadam_aiphoto_job_v1' + SCOPE]: JSON.stringify({ id: 'gen-done' }) } });
    p.AP._fetch = fakeFetch([
      { json: { success: true, generation: { id: 'gen-done', status: 'done', progress: 100, images: [{ slot: 'base', label: '기본안', url: 'https://s/b.png' }] } } },
    ]);
    await p.AP.reattach();
    expect(p.AP._fetch.calls).toHaveLength(1);
    expect(p.AP.phase).toBe('done');
  });

  test('없어진 잡이면 기억을 지운다', async () => {
    const p = boot({ storage: { ['dadam_aiphoto_job_v1' + SCOPE]: JSON.stringify({ id: 'gone' }) } });
    p.AP._fetch = fakeFetch([{ status: 404, json: { success: false, code: 'not_found', error: '생성 결과를 찾을 수 없습니다' } }]);
    await p.AP.reattach();
    expect(p.storage.getItem('dadam_aiphoto_job_v1' + SCOPE)).toBeNull();
  });

  test('기억이 없으면 아무 요청도 하지 않는다', async () => {
    const p = boot();
    p.AP._fetch = fakeFetch([{ json: {} }]);
    expect(await p.AP.reattach()).toMatchObject({ ok: false, reason: 'none' });
    expect(p.AP._fetch.calls).toHaveLength(0);
  });
});

describe('실패마다 한국어 한 줄', () => {
  const cases = [
    [402, { success: false, code: 'insufficient_credit', error: '이번 달 생성 횟수를 모두 사용했습니다.' }, '크레딧이 부족'],
    [409, { success: false, code: 'conflict', error: '이미 생성 중인 작업이 있습니다.' }, '이미 생성 중인 작업'],
    [400, { success: false, code: 'bad_design_spec', error: 'design_spec.wallRunMm is not a number' }, '차감되지 않았습니다'],
    [400, { success: false, code: 'missing_render', error: 'renders must include an elevation image when mode is planner' }, '도면 입면 그림을 서버가 받지 못했습니다'],
    [401, { success: false, code: 'auth', error: 'Unauthorized' }, '로그인'],
    [500, { success: false, error: 'boom' }, '생성 서버가 응답하지 않습니다'],
  ];

  test.each(cases)('%s → %s', async (status, json, want) => {
    const p = withPhoto(boot());
    p.AP._fetch = fakeFetch([{ status, json }]);
    const r = await p.AP.submit();
    expect(r.ok).toBe(false);
    expect(text(p)).toContain(want);
    expect(body(p).querySelector('.ap-msg').classList.contains('ap-bad')).toBe(true);
    // 실패했으면 다시 누를 수 있어야 한다
    expect(body(p).querySelector('#aiPhotoGo').disabled).toBe(false);
  });

  test('설계를 저장하지 않았으면 그것부터 말한다 (design=local)', async () => {
    const p = withPhoto(boot());
    p.AP.ready = async () => ({ ok: false, reason: 'no-scope' });
    p.AP._fetch = fakeFetch([{ json: {} }]);
    const r = await p.AP.submit();
    expect(r.message).toContain('설계를 먼저 저장');
    expect(p.AP._fetch.calls).toHaveLength(0);       // 크레딧을 쓰러 가지 않는다
  });

  test('로그인하지 않았으면 요청하지 않는다', async () => {
    const p = withPhoto(boot());
    p.AP.token = async () => null;
    p.AP._fetch = fakeFetch([{ json: {} }]);
    const r = await p.AP.submit();
    expect(r.message).toContain('로그인');
    expect(p.AP._fetch.calls).toHaveLength(0);
  });

  test('사진이 없으면 요청하지 않는다', async () => {
    const p = boot();
    p.AP._fetch = fakeFetch([{ json: {} }]);
    const r = await p.AP.submit();
    expect(r.message).toContain('사진을 먼저 올려');
    expect(p.AP._fetch.calls).toHaveLength(0);
  });

  test('서버에 닿지 못하면 그렇게 말한다', async () => {
    const p = withPhoto(boot());
    p.AP._fetch = fakeFetch([{ throw: 'network' }]);
    const r = await p.AP.submit();
    expect(r.message).toContain('닿지 못했습니다');
  });

  test('못 읽는 사진은 올리기에서 거절한다', async () => {
    const p = boot();
    await p.AP.setFile({ type: 'image/gif', size: 10, name: 'x.gif' });
    expect(text(p)).toContain('JPG · PNG 만');
    expect(p.AP.img).toBeNull();
  });
});

describe('구조 단계는 그대로다 (I2)', () => {
  test('디테일 모드 밖에서는 아무것도 하지 않는다', () => {
    const p = boot({ structure: true });
    expect(p.window.PlannerDetail.isActive()).toBe(false);
    // 섹션 내용은 비어 있는 안내 한 줄뿐 — 렌더는 모드에 들어갈 때 일어난다
    expect(body(p).querySelector('.ap-wrap')).toBeNull();
    expect(body(p).textContent).toContain('방 사진을 올리면');
  });

  test('요약을 읽는 것만으로 구조가 생기지 않는다 — 브리지 payload 가 그대로다', () => {
    // getStructure 는 없으면 **만들어 저장한다**. 요약이 그것을 부르면 structures 가 채워져
    // hasStructures 가 뒤집히고, 자동계산을 한 적 없는 설계의 payload 가 달라진다.
    const p = boot({ structure: true });
    const before = JSON.stringify(p.g('buildPlannerPayload')('sink'));
    expect(JSON.parse(before).hasStructures).toBe(false);
    const spec = p.AP.spec();
    expect(spec.sections.lower.modules).toHaveLength(3);      // 구조가 없어도 도어 한 짝씩은 읽는다
    expect(JSON.stringify(p.g('buildPlannerPayload')('sink'))).toBe(before);
  });
});

// 2026-09-17 브라우저 확인 — 들어올 때 한 번만 그려서, 디테일 모드 안에서 도면이 바뀌면
// "도면이 비어 있습니다" 가 그대로 남았다. PlannerDetail.refresh 가 같이 다시 그려야 한다.
describe('도면이 바뀌면 패널도 따라 바뀐다', () => {
  test('PlannerDetail.refresh 가 「사진으로 만들기」 패널을 다시 그린다', () => {
    const p = boot();
    let drawn = 0;
    const AP = p.window.PlannerAiPhoto;
    const orig = AP.render;
    AP.render = function () { drawn += 1; return orig.apply(this, arguments); };
    try {
      p.window.PlannerDetail.refresh();
      expect(drawn).toBeGreaterThan(0);
    } finally {
      AP.render = orig;
    }
  });
});

// 2026-09-17 실서비스 확인 — 버튼이 "없다" 는 신고. 실제로는 있었지만 화면 밖이었다.
// 마감 팔레트 한 섹션이 우측 패널 높이보다 커서 뒤 섹션을 밀어내고, 팔레트 안에 자체
// 스크롤이 있어 마우스를 굴려도 패널이 아니라 자재 목록만 넘어갔다 (스크롤 덫).
// 버튼 하나짜리 기능은 팔레트 **위**에 있어야 한다.
describe('우측 패널에서 「사진으로 만들기」가 마감 팔레트보다 먼저 온다', () => {
  test('섹션 순서: aiphoto → detail-palette → detail', () => {
    const p = boot();
    const order = [...p.document.querySelectorAll('#rightPanel .section[data-sec]')]
      .map((s) => s.getAttribute('data-sec'));
    const ai = order.indexOf('aiphoto');
    const pal = order.indexOf('detail-palette');
    const card = order.indexOf('detail');
    expect(ai).toBeGreaterThanOrEqual(0);
    expect(pal).toBeGreaterThan(ai);      // 팔레트보다 먼저
    expect(card).toBeGreaterThan(pal);    // 고르는 곳이 카드보다 먼저 (기존 규칙 유지)
  });
});
