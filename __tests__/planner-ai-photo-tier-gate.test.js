/**
 * 「사진으로 만들기」 등급 관문 — 화면 (사장님 결정 2026-10-20).
 *
 * 정본은 워커(workers/generate-api/src/tier-gate.js · test/planner-tier-gate.test.js)다.
 * 화면은 같은 순서의 사본으로 **버튼만 잠그고 안내**한다 — 서버가 403 planner_tier 를 내면 그 메시지를 그대로 보인다.
 *
 * 보는 것:
 *   1) 순수 판정 — expert · agent · 관리자만 참. 사본 상수가 워커 정본과 같은 값이다
 *   2) 로그인 전(access 를 모름)이면 화면은 지금 그대로다
 *   3) standard 면 올릴 곳 없이 안내 + 잠긴 버튼. 요청을 보내지 않는다
 *   4) expert · 관리자면 평소 화면 — 요청이 나간다
 *   5) 서버 403 planner_tier → 그 메시지가 패널에 그대로, 버튼이 잠긴다
 *   6) 디테일 모드에 들어오면 등급을 읽어 와 화면을 맞춘다
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');
const {
  plannerAiPhotoTierAllowed,
  plannerAiPhotoErrorMessage,
  PLANNER_AI_PHOTO_TIER_RANK,
  PLANNER_AI_PHOTO_MIN_TIER,
  PLANNER_AI_PHOTO_TIER_TEXT,
} = require('../js/planner/ai-photo');

const WORKER_GATE = fs.readFileSync(
  path.join(__dirname, '..', 'workers', 'generate-api', 'src', 'tier-gate.js'),
  'utf8'
);

const SCOPE = '::gold:1';
const MODULES = [
  { id: 'lower-0', section: 'lower', W: 1200, H: 870, D: 650, x: 0, y: 0, rotation: 0, areaId: 'area-lower-0', finishings: [] },
  { id: 'lower-1', section: 'lower', W: 1000, H: 870, D: 650, x: 1200, y: 0, rotation: 0, areaId: 'area-lower-1', finishings: [] },
  { id: 'sink-5', section: 'sink', W: 700, H: 500, D: 400, x: 1300, y: 0, rotation: 0, areaId: 'area-lower-1', finishings: [] },
];

function fakeCapture(win) {
  return {
    async capture(o) {
      return { ok: true, kind: o.kind, width: 1536, height: 640, clean: !!o.clean, blob: new win.Blob(['PNG'], { type: 'image/png' }) };
    },
  };
}

function boot() {
  const seed = seedFor(FIXTURES.straight);
  const search = seed._search + '&stage=detail';
  delete seed._search;
  seed['dadam_struct_modules_v1' + SCOPE] = JSON.stringify(MODULES);
  const p = bootPlanner('mockup-structure.html', { search, storage: seed });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  p.g('loadModules')();
  p.AP = p.window.PlannerAiPhoto;
  p.AP.ready = async () => ({ ok: true, ids: { designId: 'gold', itemId: 1 } });
  p.AP.token = async () => 'jwt-token';
  p.AP.POLL_MS = 1;
  p.AP._capture = fakeCapture(p.window);
  p.AP._toJpeg = async () => ({ base64: 'SlBH', mime: 'image/jpeg' });
  if (p.window.PlannerDetail.isActive()) p.AP.render();
  return p;
}

function withPhoto(p) {
  p.AP.img = { base64: 'QUJD', mime: 'image/jpeg', preview: 'data:image/jpeg;base64,QUJD', name: '방.jpg', width: 1600, height: 1200 };
  p.AP.render();
  return p;
}

function fakeFetch(steps) {
  const calls = [];
  const queue = steps.slice();
  const fn = async (url, opt) => {
    calls.push({ url, opt, body: opt && opt.body ? JSON.parse(opt.body) : null });
    const s = queue.length > 1 ? queue.shift() : queue[0];
    return { ok: s.status ? s.status < 400 : true, status: s.status || 200, json: async () => s.json };
  };
  fn.calls = calls;
  return fn;
}

const body = (p) => p.document.getElementById('aiPhotoBody');
const text = (p) => body(p).textContent;
const wait = (ms = 12) => new Promise((r) => setTimeout(r, ms));

const DENIED = { allowed: false, tier: 'standard', isAdmin: false };
const EXPERT = { allowed: true, tier: 'expert', isAdmin: false };

// ────────────────────────────────────────────────────────────

describe('순수 판정 — 워커 정본의 사본', () => {
  test('expert · agent · 관리자만 참, standard · 모르는 값 · 없음은 거짓', () => {
    expect(plannerAiPhotoTierAllowed({ tier: 'standard' })).toBe(false);
    expect(plannerAiPhotoTierAllowed({ tier: 'expert' })).toBe(true);
    expect(plannerAiPhotoTierAllowed({ tier: 'agent' })).toBe(true);
    expect(plannerAiPhotoTierAllowed({ tier: null })).toBe(false);
    expect(plannerAiPhotoTierAllowed({ tier: 'vip' })).toBe(false);
    expect(plannerAiPhotoTierAllowed({})).toBe(false);
    expect(plannerAiPhotoTierAllowed({ tier: 'standard', isAdmin: true })).toBe(true);
    expect(plannerAiPhotoTierAllowed({ isAdmin: true })).toBe(true);
  });

  test('등급 순서 · 최소 등급 · 안내 문구가 워커 tier-gate.js 와 같다', () => {
    expect(PLANNER_AI_PHOTO_TIER_RANK).toEqual({ standard: 0, expert: 1, agent: 2 });
    expect(PLANNER_AI_PHOTO_MIN_TIER).toBe('expert');
    expect(WORKER_GATE).toContain('{ standard: 0, expert: 1, agent: 2 }');
    expect(WORKER_GATE).toContain("PLANNER_MIN_TIER = 'expert'");
    expect(WORKER_GATE).toContain(`'${PLANNER_AI_PHOTO_TIER_TEXT}'`);
  });

  test('403 planner_tier 는 서버 메시지를 그대로, 없으면 기본 안내', () => {
    expect(plannerAiPhotoErrorMessage(403, { code: 'planner_tier', error: '서버가 준 말' })).toBe('서버가 준 말');
    expect(plannerAiPhotoErrorMessage(403, { code: 'planner_tier' })).toBe(PLANNER_AI_PHOTO_TIER_TEXT);
    // 다른 403 은 예전 그대로 (서버 메시지 또는 일반 실패)
    expect(plannerAiPhotoErrorMessage(403, { code: 'forbidden', error: 'x' })).toBe('x');
  });
});

describe('화면', () => {
  test('로그인 전(등급을 모름)이면 지금 그대로 — 올릴 곳이 있고 안내가 없다', async () => {
    const p = boot();
    p.AP._o.access = async () => null;
    expect(await p.AP.refreshAccess()).toBeNull();
    expect(body(p).querySelector('#aiPhotoDrop')).not.toBeNull();
    expect(body(p).querySelector('#aiPhotoTier')).toBeNull();
    expect(text(p)).not.toContain('Expert 등급부터');
  });

  test('standard 면 안내 + 잠긴 버튼만 — 올릴 곳이 없고 크레딧 줄은 남는다', async () => {
    const p = boot();
    p.AP._o.access = async () => DENIED;
    await p.AP.refreshAccess();
    const host = body(p);
    expect(host.querySelector('.ap-cost').textContent).toContain('20 크레딧');
    expect(host.querySelector('#aiPhotoTier').textContent).toContain(PLANNER_AI_PHOTO_TIER_TEXT);
    expect(host.querySelector('#aiPhotoGo').disabled).toBe(true);
    expect(host.querySelector('#aiPhotoDrop')).toBeNull();
    expect(host.querySelector('#aiPhotoNoMassing')).toBeNull();
  });

  test('standard 는 사진이 있어도 요청을 보내지 않는다', async () => {
    const p = boot();
    p.AP._o.access = async () => DENIED;
    await p.AP.refreshAccess();
    p.AP._fetch = fakeFetch([{ status: 202, json: { success: true, id: 'gen-1' } }]);
    p.AP.img = { base64: 'QUJD', mime: 'image/jpeg', preview: 'data:image/jpeg;base64,QUJD', name: '방.jpg', width: 1600, height: 1200 };
    const r = await p.AP.submit();
    expect(r.ok).toBe(false);
    expect(r.message).toBe(PLANNER_AI_PHOTO_TIER_TEXT);
    expect(p.AP._fetch.calls).toHaveLength(0);
    expect(body(p).querySelector('#aiPhotoGo').disabled).toBe(true);
  });

  test('expert · 관리자는 평소 화면 — 요청이 mode:planner 로 나간다', async () => {
    for (const access of [EXPERT, { allowed: true, tier: 'standard', isAdmin: true }]) {
      const p = boot();
      p.AP._o.access = async () => access;
      await p.AP.refreshAccess();
      expect(body(p).querySelector('#aiPhotoTier')).toBeNull();
      expect(body(p).querySelector('#aiPhotoDrop')).not.toBeNull();
      withPhoto(p);
      expect(body(p).querySelector('#aiPhotoGo').disabled).toBe(false);
      p.AP._fetch = fakeFetch([
        { status: 202, json: { success: true, id: 'gen-1' } },
        { json: { success: true, generation: { id: 'gen-1', status: 'done', progress: 100, images: [] } } },
      ]);
      await p.AP.submit();
      expect(p.AP._fetch.calls.length).toBeGreaterThanOrEqual(1);
      expect(p.AP._fetch.calls[0].body.mode).toBe('planner');
    }
  });

  test('등급을 몰라 요청을 보냈는데 서버가 403 planner_tier 면 — 그 메시지를 패널에 그대로, 버튼이 잠긴다', async () => {
    const p = boot();
    p.AP._o.access = async () => null;
    await p.AP.refreshAccess();
    withPhoto(p);
    p.AP._fetch = fakeFetch([{ status: 403, json: { success: false, code: 'planner_tier', error: '사진으로 만들기는 Expert 등급부터 쓸 수 있습니다 (서버)' } }]);
    const r = await p.AP.submit();
    expect(r.ok).toBe(false);
    expect(p.AP._fetch.calls).toHaveLength(1);
    expect(p.AP.access && p.AP.access.allowed).toBe(false);
    const host = body(p);
    expect(host.querySelector('#aiPhotoTier').textContent).toContain('(서버)');
    expect(host.querySelector('#aiPhotoGo').disabled).toBe(true);
    expect(host.querySelector('#aiPhotoDrop')).toBeNull();
    // 같은 문장이 두 번 보이지 않는다
    expect(text(p).split('(서버)').length - 1).toBe(1);
  });

  test('다른 실패(402)는 관문을 건드리지 않는다 — 올릴 곳이 그대로', async () => {
    const p = boot();
    p.AP._o.access = async () => EXPERT;
    await p.AP.refreshAccess();
    withPhoto(p);
    p.AP._fetch = fakeFetch([{ status: 402, json: { success: false, code: 'insufficient_credit' } }]);
    await p.AP.submit();
    expect(p.AP.access.allowed).toBe(true);
    expect(body(p).querySelector('#aiPhotoDrop')).not.toBeNull();
    expect(text(p)).toContain('크레딧이 부족합니다');
  });

  test('디테일 모드에 들어오면 등급을 읽어 와 화면을 맞춘다', async () => {
    const p = boot();
    let asked = 0;
    p.AP._o.access = async () => { asked++; return DENIED; };
    p.AP.access = null;
    await p.AP.onDetailEnter();
    await wait();
    expect(asked).toBe(1);
    expect(body(p).querySelector('#aiPhotoTier')).not.toBeNull();
    expect(body(p).querySelector('#aiPhotoGo').disabled).toBe(true);
  });
});
