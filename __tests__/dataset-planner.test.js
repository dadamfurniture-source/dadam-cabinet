/**
 * @jest-environment node
 *
 * 간편 플래너 → 학습 데이터 창고 (2026-10-28 사장님 "2번" · "ERP 수주번호 연결" · "설계 모음에서 단추로", workers/dataset-api/src/planner.js).
 *
 * 고정하는 것:
 *   1) 출처 · 묶음 키 · 그림 주소는 워커가 정한다 (source dadam_planner, group_key planner-lite:design:<id>, design-images/planner-lite/…)
 *   2) 라벨은 늘 structured — 창고의 human 은 관리자 검수만. 사람이 검수한 표본은 덮어쓰지도 지우지도 않는다
 *   3) 고객이 올린 것(SEGAN 학습 허용)은 동의 · 검수 대기 · user-uploaded, 업체 사진은 restricted-internal
 *   4) 수주번호 → orders.design_id 를 묶음 전체에, 못 찾거나 없으면 비운다 (학습 내보내기는 시공 완료 수주만 — dataset_exportable)
 *   5) 플래너에서 지운 사진은 표본 · 파일을 같이 지운다. 형식 · 크기 · id 는 쓰기 전에 거른다. 메모 · 이름 칸은 빼고 넣는다
 *   6) 시공 완료 확인 (ERP 이전 현장, 0009 planner_completions) — 관리자 · 창고에 남는 시공 완료 사진이 있을 때만 한 줄, 끄면 지운다,
 *      보내지 않으면 건드리지 않는다, 표가 아직 없으면(DB 적용 전) 나머지는 그대로 하고 알린다
 *
 * ESM 을 jest(CJS) 에서 읽기 위해 import · export 를 떼고 평가한다 (dataset-adapters.test.js 방식). planner.js 는 import 가 없고
 * 쓰는 것(select · upsert …)은 h 로 받는다. atob · crypto 는 노드 것을 넣는다.
 */

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

function loadEsm(rel, names, deps = {}) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^import [\s\S]*?;\n/gm, '')
    .replace(/^export /gm, '');
  const keys = Object.keys(deps);
  return new Function(...keys, src + `\nreturn { ${names.join(', ')} };`)(...keys.map((k) => deps[k]));
}

const P = loadEsm('workers/dataset-api/src/planner.js',
  ['plannerState', 'plannerPhoto', 'plannerDesign', 'photoRow', 'designRow', 'sniff', 'plannerGroupKey', 'PLANNER_BUCKET', 'PLANNER_PREFIX'],
  { atob: (s) => Buffer.from(s, 'base64').toString('latin1'), crypto: nodeCrypto.webcrypto });

const ENV = { SUPABASE_URL: 'https://example.supabase.co' };
const ID = 'design-mvq4e1gr-1';
const GK = `planner-lite:design:${ID}`;
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

/** 가짜 Supabase — 표 둘(dataset_samples · planner_completions) · orders · 저장소. noCompletions = 0009 적용 전 */
function fake(rows = [], orders = [], { noCompletions = false } = {}) {
  const db = { rows: rows.map((r) => ({ ...r })), objects: new Map(), removedObjects: [], patches: [], upserts: [], completions: new Map(), completionUpserts: [] };
  const missing = (table) => {
    if (noCompletions && table === 'planner_completions') {
      throw new Error(`upsert planner_completions 404: {"code":"PGRST205","message":"Could not find the table 'public.planner_completions' in the schema cache"}`);
    }
  };
  const h = {
    select: async (env, q) => {
      if (q.startsWith('orders?')) {
        const no = decodeURIComponent(q.match(/order_no=eq\.([^&]+)/)[1]);
        return orders.filter((o) => o.order_no === no);
      }
      const gk = decodeURIComponent(q.match(/group_key=eq\.([^&]+)/)[1]);
      // kind:attrs->>kind — PostgREST 가 attrs 의 kind 를 kind 칸으로 준다
      return db.rows.filter((r) => r.group_key === gk)
        .map((r) => (q.includes('kind:attrs->>kind') ? { ...r, kind: r.attrs && r.attrs.kind != null ? String(r.attrs.kind) : null } : r));
    },
    upsert: async (env, table, list) => {
      missing(table);
      if (table === 'planner_completions') {
        db.completionUpserts.push(...list);
        for (const r of list) db.completions.set(r.group_key, { ...(db.completions.get(r.group_key) || { confirmed_at: 'first' }), ...r });
        return list.length;
      }
      db.upserts.push(...list);
      for (const r of list) {
        const i = db.rows.findIndex((x) => x.sample_id === r.sample_id);
        if (i >= 0) db.rows[i] = { ...db.rows[i], ...r }; else db.rows.push({ ...r });
      }
      return list.length;
    },
    patch: async (env, q, values) => {
      db.patches.push({ q, values });
      const gk = decodeURIComponent(q.match(/group_key=eq\.([^&]+)/)[1]);
      db.rows.filter((r) => r.group_key === gk).forEach((r) => Object.assign(r, values));
    },
    remove: async (env, q) => {
      if (q.startsWith('planner_completions?')) {
        missing('planner_completions');
        db.completions.delete(decodeURIComponent(q.match(/group_key=eq\.([^&]+)/)[1]));
        return;
      }
      const ids = q.match(/in\.\((.*)\)$/)[1].split(',').map((s) => s.replace(/"/g, ''));
      db.rows = db.rows.filter((r) => !ids.includes(r.sample_id));
    },
    putObject: async (env, bucket, p, bytes, mime) => { db.objects.set(`${bucket}/${p}`, { bytes, mime }); return `${bucket}/${p}`; },
    removeObjects: async (env, bucket, paths) => { db.removedObjects.push(...paths.map((p) => `${bucket}/${p}`)); return paths.length; },
  };
  return { db, h };
}

const sample = (pid, extra = {}) => Object.assign({
  sample_id: `${GK}:photo:${pid}`, source: 'whatever', group_key: 'other', image_path: `${ID}/photos/${pid}.jpg`,
  width: 1440, height: 1920, media: 'photo', phase: 'before', space: 'kitchen', furniture: 'sink', layout_shape: 'L',
  attrs: { kind: 'site', from: 'upload', note: '홍길동 아파트 101동', wall_corners: { pts: [[0.3, 0.6]] }, addedAt: '2026-10-27T10:00:00Z' },
  label_source: 'human', license: 'restricted-internal', consent: null, needs_review: false,
}, extra);

test('사진 한 장 — 출처 · 묶음 · 그림 주소는 워커가, 라벨은 structured, 메모는 빼고, sha256 은 받은 바이트로', async () => {
  const { db, h } = fake();
  const r = await P.plannerPhoto(ENV, { designId: ID, fileName: 'photo-a1-00000001.jpg', sample: sample('photo-a1-00000001'), file: JPG.toString('base64') }, h);
  expect(r.image_sha256).toBe(nodeCrypto.createHash('sha256').update(JPG).digest('hex'));
  const obj = db.objects.get(`design-images/planner-lite/${ID}/photo-a1-00000001.jpg`);
  expect(obj.mime).toBe('image/jpeg');
  const row = db.rows[0];
  expect([row.source, row.group_key, row.label_source, row.license, row.consent, row.src_table]).toEqual(['dadam_planner', GK, 'structured', 'restricted-internal', null, 'planner_lite']);
  expect(row.image_url).toBe(`https://example.supabase.co/storage/v1/object/public/design-images/planner-lite/${ID}/photo-a1-00000001.jpg`);
  expect(row.attrs.note).toBeUndefined();
  expect(row.attrs.wall_corners.pts).toEqual([[0.3, 0.6]]);
  expect('image_path' in row).toBe(false);
  expect('design_id' in row).toBe(false);   // 수주 잇기는 설계 단계가 묶음 전체에 — 사진이 덮어 지우지 않게 키를 두지 않는다
});

test('고객이 올린 것(SEGAN 학습 허용) — user-uploaded · 동의 · 검수 대기, 동의 없으면 거절', async () => {
  const { db, h } = fake();
  await P.plannerPhoto(ENV, { designId: ID, fileName: 'photo-s1-00000001.jpg', file: JPG.toString('base64'),
    sample: sample('photo-s1-00000001', { license: 'user-uploaded', consent: true, needs_review: false }) }, h);
  expect([db.rows[0].license, db.rows[0].consent, db.rows[0].needs_review]).toEqual(['user-uploaded', true, true]);
  await expect(P.plannerPhoto(ENV, { designId: ID, fileName: 'photo-s2-00000001.jpg', file: JPG.toString('base64'),
    sample: sample('photo-s2-00000001', { license: 'user-uploaded', consent: null }) }, h)).rejects.toMatchObject({ status: 400 });
});

test('쓰기 전에 거른다 — 설계 id · 파일 이름 · 형식(바이트) · 다른 묶음 표본 · 아무 것도 쓰지 않는다', async () => {
  const { db, h } = fake();
  const ok = { designId: ID, fileName: 'photo-a1-00000001.jpg', sample: sample('photo-a1-00000001'), file: JPG.toString('base64') };
  for (const b of [
    { ...ok, designId: '../etc' },
    { ...ok, fileName: '../x.jpg' },
    { ...ok, file: PNG.toString('base64') },                         // 이름은 jpg 인데 바이트는 PNG
    { ...ok, sample: sample('x', { sample_id: 'planner-lite:design:other:photo:x' }) },
  ]) {
    await expect(P.plannerPhoto(ENV, b, h)).rejects.toMatchObject({ status: 400 });
  }
  expect(db.objects.size).toBe(0);
  expect(db.rows.length).toBe(0);
});

test('사람이 검수한 표본은 사진도 줄도 건드리지 않는다', async () => {
  const sid = `${GK}:photo:photo-a1-00000001`;
  const { db, h } = fake([{ sample_id: sid, group_key: GK, label_source: 'human', image_url: 'kept', image_sha256: 'old' }]);
  const r = await P.plannerPhoto(ENV, { designId: ID, fileName: 'photo-a1-00000001.jpg', sample: sample('photo-a1-00000001'), file: JPG.toString('base64') }, h);
  expect(r.skipped).toBe('human');
  expect(db.objects.size).toBe(0);
  expect(db.rows[0].image_url).toBe('kept');
});

test('설계 한 줄 — 그림 없는 floorplan, 이름은 빼고, 수주번호로 앱 설계를 묶음 전체에 · 못 찾으면 비운다', async () => {
  const APP_DESIGN = '33333333-3333-4333-8333-333333333333';
  const { db, h } = fake([{ sample_id: `${GK}:photo:p1`, group_key: GK, label_source: 'structured', image_url: 'u' }],
    [{ order_no: 'SO-20261027-AB12', design_id: APP_DESIGN, status: 'completed' }]);
  const record = { design: { walls: [], updatedAt: '2026-10-27T21:00:00Z' }, name: '홍길동 주방', layout_shape: 'L', photos: { site: ['p1'] } };
  const r = await P.plannerDesign(ENV, { designId: ID, orderNo: 'SO-20261027-AB12', record, keep: [`${GK}:photo:p1`] }, h);
  expect(r.order).toEqual({ found: true, status: 'completed' });
  const d = db.rows.find((x) => x.sample_id === GK);
  expect([d.media, d.image_url, d.layout_shape, d.label_source]).toEqual(['floorplan', null, 'L', 'structured']);
  expect(d.attrs.record.name).toBeUndefined();
  expect(d.attrs.record.order_no).toBe('SO-20261027-AB12');
  expect(db.rows.every((x) => x.design_id === APP_DESIGN)).toBe(true);
  // 없는 수주번호 · 수주번호 지움 → 비운다
  const r2 = await P.plannerDesign(ENV, { designId: ID, orderNo: 'SO-20990101-ZZZZ', record, keep: [`${GK}:photo:p1`] }, h);
  expect(r2.order).toEqual({ found: false, status: null });
  expect(db.rows.every((x) => x.design_id === null)).toBe(true);
  await P.plannerDesign(ENV, { designId: ID, orderNo: '', record, keep: [`${GK}:photo:p1`] }, h);
  expect(db.patches.pop().values).toEqual({ design_id: null });
  await expect(P.plannerDesign(ENV, { designId: ID, orderNo: "SO-1,eq.x)", record, keep: [] }, h)).rejects.toMatchObject({ status: 400 });
});

test('플래너에서 지운 사진 — 표본 · 파일을 지운다, 사람 검수 표본 · 설계 줄은 남긴다', async () => {
  const url = (f) => `https://example.supabase.co/storage/v1/object/public/design-images/planner-lite/${ID}/${f}`;
  const { db, h } = fake([
    { sample_id: `${GK}:photo:p1`, group_key: GK, label_source: 'structured', image_url: url('p1.jpg') },
    { sample_id: `${GK}:photo:p2`, group_key: GK, label_source: 'structured', image_url: url('p2.jpg') },
    { sample_id: `${GK}:photo:p3`, group_key: GK, label_source: 'human', image_url: url('p3.jpg') },
  ]);
  const r = await P.plannerDesign(ENV, { designId: ID, record: { design: {} }, keep: [`${GK}:photo:p1`] }, h);
  expect([r.removed, r.locked]).toEqual([1, 1]);
  expect(db.rows.map((x) => x.sample_id).sort()).toEqual([GK, `${GK}:photo:p1`, `${GK}:photo:p3`].sort());
  expect(db.removedObjects).toEqual([`design-images/planner-lite/${ID}/p2.jpg`]);
});

test('상태 — 그 묶음의 표본 id · sha256 · 라벨 출처만', async () => {
  const { h } = fake([{ sample_id: `${GK}:photo:p1`, group_key: GK, label_source: 'human', image_sha256: 'abc', image_url: 'u' },
    { sample_id: 'planner-lite:design:other:photo:x', group_key: 'planner-lite:design:other', label_source: 'structured' }]);
  expect(await P.plannerState(ENV, { designId: ID }, h)).toEqual({ samples: [{ sample_id: `${GK}:photo:p1`, image_sha256: 'abc', label_source: 'human' }] });
  expect(P.sniff(JPG)).toBe('jpg');
  expect(P.sniff(PNG)).toBe('png');
  expect([P.PLANNER_BUCKET, P.PLANNER_PREFIX]).toEqual(['design-images', 'planner-lite']);
});

describe('시공 완료 확인 (ERP 이전 현장 — 0009 planner_completions)', () => {
  const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'boss@example.com' };
  const photo = (pid, kind, extra = {}) => Object.assign({ sample_id: `${GK}:photo:${pid}`, group_key: GK, label_source: 'structured', media: 'photo', image_url: 'u', attrs: { kind } }, extra);
  const body = (extra) => Object.assign({ designId: ID, record: { design: {} }, keep: [`${GK}:photo:s1`, `${GK}:photo:c1`] }, extra);

  test('켜면 — 시공 완료 사진 수 · 표시한 관리자로 한 줄, 처음 켠 때는 그대로, 끄면 지운다', async () => {
    const { db, h } = fake([photo('s1', 'site'), photo('c1', 'complete'), photo('a1', 'ai', { media: 'generated' })]);
    const r = await P.plannerDesign(ENV, body({ completed: true }), h, ADMIN);
    expect(r.completion).toEqual({ confirmed: true, photos: 1 });
    const c = db.completions.get(GK);
    expect([c.group_key, c.complete_photos, c.confirmed_by, c.confirmed_at]).toEqual([GK, 1, ADMIN.id, 'first']);
    expect('confirmed_at' in db.completionUpserts[0]).toBe(false);   // 처음 켠 때는 DB 기본값(now) — 보내지 않는다
    await P.plannerDesign(ENV, body({ completed: true }), h, ADMIN);
    expect(db.completions.get(GK).confirmed_at).toBe('first');   // 다시 올려도 처음 켠 때
    const off = await P.plannerDesign(ENV, body({ completed: false }), h, ADMIN);
    expect(off.completion).toEqual({ confirmed: false, photos: 1 });
    expect(db.completions.has(GK)).toBe(false);
  });

  test('시공 완료 사진이 없으면 — 켜도 줄을 두지 않는다 (이번에 지우는 사진 · AI 연출 · Blender 시안은 세지 않는다)', async () => {
    const { db, h } = fake([photo('s1', 'site'), photo('c1', 'complete'), photo('b1', 'complete', { media: 'render3d' })]);
    db.completions.set(GK, { group_key: GK, complete_photos: 1 });
    const r = await P.plannerDesign(ENV, body({ completed: true, keep: [`${GK}:photo:s1`, `${GK}:photo:b1`] }), h, ADMIN);
    expect(r.removed).toBe(1);
    expect(r.completion).toEqual({ confirmed: false, photos: 0, why: 'no_complete_photo' });
    expect(db.completions.has(GK)).toBe(false);
  });

  test('관리자가 검수한 시공 완료 사진은 플래너가 지워도 남으니 센다', async () => {
    const { db, h } = fake([photo('c9', 'complete', { label_source: 'human' })]);
    const r = await P.plannerDesign(ENV, body({ completed: true, keep: [] }), h, ADMIN);
    expect(r.completion).toEqual({ confirmed: true, photos: 1 });
    expect(db.completions.get(GK).complete_photos).toBe(1);
  });

  test('보내지 않으면 건드리지 않는다 · 켜기는 관리자만 · 다른 설계 줄은 그대로', async () => {
    const { db, h } = fake([photo('c1', 'complete')]);
    db.completions.set(GK, { group_key: GK, complete_photos: 1 });
    db.completions.set('planner-lite:design:other-1', { group_key: 'planner-lite:design:other-1', complete_photos: 2 });
    const r = await P.plannerDesign(ENV, body({}), h, ADMIN);
    expect(r.completion).toBeNull();
    expect(db.completions.size).toBe(2);
    await expect(P.plannerDesign(ENV, body({ completed: true }), h, undefined)).rejects.toMatchObject({ status: 400 });
    await P.plannerDesign(ENV, body({ completed: false }), h, ADMIN);
    expect([...db.completions.keys()]).toEqual(['planner-lite:design:other-1']);
  });

  test('DB 에 0009 를 적용하기 전 — 설계 · 수주 잇기는 그대로 하고 db_pending 으로 알린다', async () => {
    const { db, h } = fake([photo('c1', 'complete')], [], { noCompletions: true });
    const r = await P.plannerDesign(ENV, body({ completed: true }), h, ADMIN);
    expect(r.completion).toEqual({ confirmed: false, photos: 1, why: 'db_pending' });
    expect(db.rows.some((x) => x.sample_id === GK)).toBe(true);
  });
});
