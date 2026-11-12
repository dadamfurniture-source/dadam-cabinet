/**
 * @jest-environment node
 *
 * 학습 데이터 내보내기 — 고객 사진은 서명 URL 로 (2026-10-26, workers/dataset-api).
 *
 * generations · design-images 버킷이 비공개가 되면 dataset_samples.image_url(공개 URL)로는 받지 못한다.
 * 고정하는 것:
 *   1) toStorageRef — 화면·generate-api 워커와 같은 규칙
 *   2) signImageRefs — 고객 사진 버킷만 버킷마다 한 번 서명, bucket · path 를 함께. 다른 주소는 그대로 (bucket · path null).
 *      서명을 못 하면 저장된 URL 그대로 (bucket · path 는 싣는다)
 *   3) createSignedUrls — service_role 로 sign 엔드포인트에 묶어 보내고 절대 URL 로
 *   4) exportDataset — image.url 은 7일짜리 서명 URL, image.bucket · image.path 를 싣는다. provenance 는 저장된 주소 그대로
 *
 * ESM 을 jest(CJS) 에서 읽기 위해 import · export 를 떼고, import 하던 것은 인자로 넣어 평가한다
 * (dataset-adapters.test.js 방식).
 */

const fs = require('fs');
const path = require('path');

function loadEsm(rel, names, deps = {}) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^import [\s\S]*?;\n/gm, '')
    .replace(/^export /gm, '');
  const keys = Object.keys(deps);
  return new Function(...keys, src + `\nreturn { ${names.join(', ')} };`)(...keys.map((k) => deps[k]));
}

const S = loadEsm('workers/dataset-api/src/storage-urls.js', [
  'PRIVATE_BUCKETS',
  'EXPORT_SIGNED_TTL_SEC',
  'toStorageRef',
  'signImageRefs',
]);

const SB = 'https://example.supabase.co';
const UID = '11111111-1111-4111-8111-111111111111';
const GID = '22222222-2222-4222-8222-222222222222';
const pub = (p, bucket = 'generations') => `${SB}/storage/v1/object/public/${bucket}/${p}`;
const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };

/** sign(bucket, paths) 흉내 — 호출을 기록하고 'https://signed/<bucket>/<path>' 를 돌려준다 */
function fakeSign({ fail = [], throwFor = [] } = {}) {
  const calls = [];
  const fn = async (bucket, paths) => {
    calls.push({ bucket, paths: paths.slice() });
    if (throwFor.includes(bucket)) throw new Error('sign 500');
    return new Map(paths.filter((p) => !fail.includes(p)).map((p) => [p, `https://signed/${bucket}/${p}`]));
  };
  fn.calls = calls;
  return fn;
}

describe('toStorageRef (dataset-api 복사본)', () => {
  test('공개 · 서명 URL → 버킷 · 경로, 그 밖은 null', () => {
    expect(S.toStorageRef(pub(`${UID}/${GID}/room.jpg`))).toEqual({ bucket: 'generations', path: `${UID}/${GID}/room.jpg` });
    expect(S.toStorageRef(`${SB}/storage/v1/object/sign/design-images/${UID}/a%20b.jpg?token=x`)).toEqual({
      bucket: 'design-images',
      path: `${UID}/a b.jpg`,
    });
    expect(S.toStorageRef(`${UID}/x.png`, 'generations')).toEqual({ bucket: 'generations', path: `${UID}/x.png` });
    for (const v of ['https://cdn/x.jpg', 'data:image/png;base64,AA', '/a.jpg', `${UID}/x.png`, '', null]) {
      expect(S.toStorageRef(v)).toBeNull();
    }
  });
});

describe('signImageRefs', () => {
  test('고객 사진 버킷만 버킷마다 한 번 — 순서 그대로, bucket · path 를 함께', async () => {
    const sign = fakeSign();
    const values = [
      pub(`${UID}/${GID}/room.jpg`),
      pub('posts/1.jpg', 'collection'),
      pub(`${UID}/site_photo/1.jpg`, 'design-images'),
      'https://cdn/x.jpg',
      pub(`${UID}/${GID}/room.jpg`), // 같은 경로는 한 번만 보낸다
      null,
    ];
    const out = await S.signImageRefs(values, sign);
    expect(sign.calls).toEqual([
      { bucket: 'generations', paths: [`${UID}/${GID}/room.jpg`] },
      { bucket: 'design-images', paths: [`${UID}/site_photo/1.jpg`] },
    ]);
    expect(out).toEqual([
      { url: `https://signed/generations/${UID}/${GID}/room.jpg`, bucket: 'generations', path: `${UID}/${GID}/room.jpg` },
      { url: values[1], bucket: null, path: null },
      { url: `https://signed/design-images/${UID}/site_photo/1.jpg`, bucket: 'design-images', path: `${UID}/site_photo/1.jpg` },
      { url: 'https://cdn/x.jpg', bucket: null, path: null },
      { url: `https://signed/generations/${UID}/${GID}/room.jpg`, bucket: 'generations', path: `${UID}/${GID}/room.jpg` },
      { url: null, bucket: null, path: null },
    ]);
  });

  test('서명할 것이 없으면 부르지 않는다', async () => {
    const sign = fakeSign();
    await S.signImageRefs([pub('a.jpg', 'collection'), 'https://cdn/x.jpg'], sign);
    expect(sign.calls).toHaveLength(0);
  });

  test('서명을 못 하면 저장된 URL 그대로 — bucket · path 는 싣는다 (요청 실패 · 그 경로만 실패)', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const a = pub(`${UID}/${GID}/room.jpg`);
    const b = pub(`${UID}/site_photo/1.jpg`, 'design-images');
    const out = await S.signImageRefs([a, b], fakeSign({ throwFor: ['generations'], fail: [`${UID}/site_photo/1.jpg`] }));
    expect(out).toEqual([
      { url: a, bucket: 'generations', path: `${UID}/${GID}/room.jpg` },
      { url: b, bucket: 'design-images', path: `${UID}/site_photo/1.jpg` },
    ]);
    spy.mockRestore();
  });

  test('수명 7일 · 고객 사진 버킷', () => {
    expect(S.EXPORT_SIGNED_TTL_SEC).toBe(604800);
    expect(S.PRIVATE_BUCKETS).toEqual(['generations', 'design-images']);
  });
});

describe('createSignedUrls (dataset-api supabase.js)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  test('service_role 로 경로 묶음(중복 제거)을 보내고 절대 URL 로 — 실패한 경로는 빠진다', async () => {
    const seen = [];
    global.fetch = async (url, init) => {
      seen.push({ url, init });
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify(
          body.paths.map((p) =>
            p === 'bad.jpg'
              ? { error: 'not found', path: p, signedURL: null }
              : { error: null, path: p, signedURL: `/object/sign/generations/${p}?token=t` }
          )
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    const { createSignedUrls } = loadEsm('workers/dataset-api/src/supabase.js', ['createSignedUrls']);
    const m = await createSignedUrls(ENV, 'generations', ['a.jpg', 'bad.jpg', 'a.jpg'], 604800);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${SB}/storage/v1/object/sign/generations`);
    expect(seen[0].init.method).toBe('POST');
    expect(seen[0].init.headers.Authorization).toBe('Bearer service');
    expect(JSON.parse(seen[0].init.body)).toEqual({ expiresIn: 604800, paths: ['a.jpg', 'bad.jpg'] });
    expect(m.get('a.jpg')).toBe(`${SB}/storage/v1/object/sign/generations/a.jpg?token=t`);
    expect(m.has('bad.jpg')).toBe(false);
  });

  test('서명 요청이 실패하면 던진다 (signImageRefs 가 받아 저장된 URL 로 둔다)', async () => {
    global.fetch = async () => new Response('boom', { status: 500 });
    const { createSignedUrls } = loadEsm('workers/dataset-api/src/supabase.js', ['createSignedUrls']);
    await expect(createSignedUrls(ENV, 'generations', ['a.jpg'], 604800)).rejects.toThrow(/sign generations 500/);
  });
});

describe('exportDataset', () => {
  const ROWS = [
    {
      sample_id: 'dadam:gen:g1:room',
      source: 'dadam_generation',
      group_key: 'dadam:gen:g1',
      image_url: pub(`${UID}/${GID}/room.jpg`),
      image_sha256: null,
      width: null,
      height: null,
      media: 'photo',
      license: 'user-uploaded',
      consent: true,
      taxonomy_version: 1,
      created_at: '2026-10-01T00:00:00Z',
    },
    {
      sample_id: 'dadam:post:p1',
      source: 'dadam_collection',
      group_key: 'dadam:post:p1',
      image_url: pub('posts/p1.jpg', 'collection'),
      image_sha256: 'abc',
      width: 800,
      height: 600,
      media: 'photo',
      license: 'owned',
      consent: true,
      taxonomy_version: 1,
      created_at: '2026-10-02T00:00:00Z',
    },
  ];

  function load(sign) {
    const puts = [];
    const deps = {
      select: async (_env, q) => (q.includes('offset=0') ? ROWS : []),
      putObject: async (_env, bucket, p, body) => {
        puts.push({ bucket, path: p, body });
        return `${bucket}/${p}`;
      },
      createSignedUrls: sign,
      EXPORT_SIGNED_TTL_SEC: S.EXPORT_SIGNED_TTL_SEC,
      signImageRefs: S.signImageRefs,
    };
    const { exportDataset } = loadEsm('workers/dataset-api/src/export.js', ['exportDataset'], deps);
    return { exportDataset, puts };
  }

  test('고객 사진은 7일짜리 서명 URL + bucket · path, 시공사례는 그대로 — provenance 는 저장된 주소', async () => {
    const calls = [];
    const { exportDataset, puts } = load(async (env, bucket, paths, ttl) => {
      calls.push({ bucket, paths, ttl });
      return new Map(paths.map((p) => [p, `${SB}/storage/v1/object/sign/${bucket}/${p}?token=t7`]));
    });
    const out = await exportDataset(ENV);
    expect(out.records).toBe(2);
    expect(calls).toEqual([{ bucket: 'generations', paths: [`${UID}/${GID}/room.jpg`], ttl: 604800 }]);
    expect(puts.map((p) => p.path)).toEqual([expect.stringMatching(/^exports\/\d{4}-\d{2}-\d{2}\.jsonl$/), 'exports/latest.jsonl']);
    const recs = puts[0].body.trim().split('\n').map((l) => JSON.parse(l));
    expect(recs[0].image).toEqual({
      path: `${UID}/${GID}/room.jpg`,
      bucket: 'generations',
      url: `${SB}/storage/v1/object/sign/generations/${UID}/${GID}/room.jpg?token=t7`,
      sha256: null,
      width: null,
      height: null,
    });
    expect(recs[0].provenance.source_url).toBe(ROWS[0].image_url);
    expect(recs[1].image).toEqual({ path: null, bucket: null, url: ROWS[1].image_url, sha256: 'abc', width: 800, height: 600 });
  });

  test('서명이 실패해도 내보내기는 끝난다 — 저장된 URL 과 bucket · path', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { exportDataset, puts } = load(async () => {
      throw new Error('sign generations 500');
    });
    const out = await exportDataset(ENV);
    expect(out.records).toBe(2);
    const rec = JSON.parse(puts[0].body.split('\n')[0]);
    expect(rec.image).toMatchObject({ url: ROWS[0].image_url, bucket: 'generations', path: `${UID}/${GID}/room.jpg` });
    spy.mockRestore();
  });
});
