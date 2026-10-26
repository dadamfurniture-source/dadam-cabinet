/**
 * @jest-environment node
 *
 * 저장된 Storage 주소 → 서명 URL (2026-10-26, js/storage-urls.js).
 *
 * 고객 사진 버킷(generations · design-images)을 비공개로 바꿔도 화면이 그대로 보이게 한다.
 * 고정하는 것:
 *   1) toStorageRef — 공개 URL · 서명 URL · 버킷 안 경로 → { bucket, path }. 그 밖은 null (워커 src/storage-urls.js 와 같은 규칙)
 *   2) signUrls — 고객 사진 버킷만, 버킷마다 한 번(100개씩), 들어온 순서 그대로. 못 하면 저장된 값 그대로
 *   3) 같은 경로는 수명이 절반 넘게 남은 동안 다시 서명하지 않는다 (폴링에도 이미지를 다시 받지 않게)
 *   4) 화면이 이 파일을 불러 쓴다 · SQL 이 정책을 이름 그대로 지우고 본인·관리자 읽기를 더한다
 *   5) design-images 업로드는 바이트로 보내고 cache-control: private, max-age=3600 (supabase-utils · supabase-service)
 */

const fs = require('fs');
const path = require('path');
const U = require('../js/storage-urls.js');

const SB = 'https://example.supabase.co';
const UID = '11111111-1111-4111-8111-111111111111';
const GID = '22222222-2222-4222-8222-222222222222';
const pub = (p, bucket = 'generations') => `${SB}/storage/v1/object/public/${bucket}/${p}`;

/** supabase-js 흉내 — createSignedUrls 호출을 기록하고 'https://signed/<bucket>/<path>?ttl=' 을 돌려준다 */
function fakeClient({ fail = [], error = null, throws = false } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths, ttl) {
            calls.push({ bucket, paths: paths.slice(), ttl });
            if (throws) throw new Error('network');
            if (error) return { data: null, error: { message: error } };
            n++;
            return {
              data: paths.map((p) =>
                fail.includes(p)
                  ? { path: p, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }
                  : { path: p, signedUrl: `https://signed/${bucket}/${p}?ttl=${ttl}&n=${n}`, error: null }
              ),
              error: null,
            };
          },
        };
      },
    },
  };
}

beforeEach(() => U.clearCache());

describe('toStorageRef', () => {
  test('저장된 공개 URL → 버킷 · 경로', () => {
    expect(U.toStorageRef(pub(`${UID}/${GID}/base.png`))).toEqual({ bucket: 'generations', path: `${UID}/${GID}/base.png` });
    expect(U.toStorageRef(pub(`${UID}/site_photo/1.jpg`, 'design-images'))).toEqual({
      bucket: 'design-images',
      path: `${UID}/site_photo/1.jpg`,
    });
  });

  test('서명 URL · authenticated URL 도 같은 경로 — 쿼리는 버린다', () => {
    expect(U.toStorageRef(`${SB}/storage/v1/object/sign/generations/${UID}/${GID}/v2.jpg?token=a.b.c`)).toEqual({
      bucket: 'generations',
      path: `${UID}/${GID}/v2.jpg`,
    });
    expect(U.toStorageRef(`${SB}/storage/v1/object/authenticated/design-images/${UID}/a.png`)).toEqual({
      bucket: 'design-images',
      path: `${UID}/a.png`,
    });
  });

  test('퍼센트 인코딩(getPublicUrl 이 붙인 것)은 풀어서', () => {
    expect(U.toStorageRef(pub(`${UID}/site_photo/%ED%98%84%EC%9E%A5%201.jpg`, 'design-images'))).toEqual({
      bucket: 'design-images',
      path: `${UID}/site_photo/현장 1.jpg`,
    });
  });

  test('버킷을 주면 버킷 안 경로도 — 주지 않으면 null', () => {
    expect(U.toStorageRef(`${UID}/${GID}/room.jpg`, 'generations')).toEqual({ bucket: 'generations', path: `${UID}/${GID}/room.jpg` });
    expect(U.toStorageRef(`${UID}/${GID}/room.jpg`)).toBeNull();
  });

  test('스토리지 주소가 아니면 null — data: · blob: · 외부 · 사이트 상대 · .. · 빈 값', () => {
    for (const v of ['data:image/png;base64,AAAA', 'blob:https://x/1', 'https://cdn.example.com/a.jpg', '/img/a.jpg', `${UID}/../x`, '', null, undefined, 3]) {
      expect(U.toStorageRef(v, 'generations')).toBeNull();
    }
  });
});

describe('signUrls', () => {
  test('고객 사진 버킷만 버킷마다 한 번 — 순서 그대로, 나머지는 그대로', async () => {
    const c = fakeClient();
    const values = [
      pub(`${UID}/${GID}/base.png`),
      pub('cases/1.jpg', 'collection'),
      pub(`${UID}/site_photo/1.jpg`, 'design-images'),
      'data:image/png;base64,AAAA',
      pub(`${UID}/${GID}/v2.jpg`),
      null,
    ];
    const out = await U.signUrls(c, values);
    expect(c.calls).toEqual([
      { bucket: 'generations', paths: [`${UID}/${GID}/base.png`, `${UID}/${GID}/v2.jpg`], ttl: 3600 },
      { bucket: 'design-images', paths: [`${UID}/site_photo/1.jpg`], ttl: 3600 },
    ]);
    expect(out[0]).toMatch(/^https:\/\/signed\/generations\/.+\/base\.png\?ttl=3600/);
    expect(out[1]).toBe(values[1]);
    expect(out[2]).toMatch(/^https:\/\/signed\/design-images\//);
    expect(out[3]).toBe(values[3]);
    expect(out[4]).toMatch(/\/v2\.jpg\?ttl=3600/);
    expect(out[5]).toBeNull();
  });

  test('opts.bucket 이 있으면 버킷 안 경로도 서명한다', async () => {
    const c = fakeClient();
    const [u] = await U.signUrls(c, [`${UID}/${GID}/base.png`], { bucket: 'generations' });
    expect(u).toMatch(/^https:\/\/signed\/generations\//);
  });

  test('100개씩 나눠 보낸다', async () => {
    const c = fakeClient();
    const values = Array.from({ length: 230 }, (_, i) => pub(`${UID}/g${i}/base.png`));
    const out = await U.signUrls(c, values);
    expect(c.calls.map((x) => x.paths.length)).toEqual([100, 100, 30]);
    expect(out.every((u) => u.startsWith('https://signed/'))).toBe(true);
  });

  test('수명이 절반 넘게 남은 동안은 같은 주소 — 다시 서명하지 않는다', async () => {
    const c = fakeClient();
    const v = pub(`${UID}/${GID}/base.png`);
    const t0 = Date.parse('2026-10-26T00:00:00Z');
    const [a] = await U.signUrls(c, [v], { now: t0 });
    const [b] = await U.signUrls(c, [v], { now: t0 + 29 * 60_000 });
    expect(b).toBe(a);
    expect(c.calls).toHaveLength(1);
    // 절반을 넘기면 새로 받는다
    const [d] = await U.signUrls(c, [v], { now: t0 + 31 * 60_000 });
    expect(d).not.toBe(a);
    expect(c.calls).toHaveLength(2);
  });

  test('서명 URL 을 다시 넣어도 같은 경로로 알아본다 (화면이 바꿔 둔 url 로 다시 부를 때)', async () => {
    const c = fakeClient();
    const [a] = await U.signUrls(c, [pub(`${UID}/${GID}/base.png`)]);
    const again = `${SB}/storage/v1/object/sign/generations/${UID}/${GID}/base.png?token=x`;
    const [b] = await U.signUrls(c, [again]);
    expect(b).toBe(a);
    expect(c.calls).toHaveLength(1);
  });

  test('서명을 못 하면 저장된 값 그대로 — 오류 응답 · 예외 · 그 경로만 실패', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const v = pub(`${UID}/${GID}/base.png`);
    expect(await U.signUrls(fakeClient({ error: 'denied' }), [v])).toEqual([v]);
    expect(await U.signUrls(fakeClient({ throws: true }), [v])).toEqual([v]);
    const w = pub(`${UID}/${GID}/v3.jpg`);
    const out = await U.signUrls(fakeClient({ fail: [`${UID}/${GID}/v3.jpg`] }), [v, w]);
    expect(out[0]).toMatch(/^https:\/\/signed\//);
    expect(out[1]).toBe(w);
    spy.mockRestore();
  });

  test('수명이 다한 서명은 쓰지 않는다 — 새로 못 받으면 저장된 값', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const v = pub(`${UID}/${GID}/base.png`);
    const t0 = Date.parse('2026-10-26T00:00:00Z');
    await U.signUrls(fakeClient(), [v], { now: t0 });
    const [late] = await U.signUrls(fakeClient({ throws: true }), [v], { now: t0 + 2 * 3600_000 });
    expect(late).toBe(v);
    spy.mockRestore();
  });

  test('signUrl — 하나만', async () => {
    const c = fakeClient();
    expect(await U.signUrl(c, pub(`${UID}/${GID}/base.png`))).toMatch(/^https:\/\/signed\//);
    expect(await U.signUrl(c, 'https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
  });

  test('고객 사진 버킷 · 수명', () => {
    expect(U.PRIVATE_BUCKETS).toEqual(['generations', 'design-images']);
    expect(U.APP_TTL_SEC).toBe(3600);
  });
});

describe('화면 · SQL', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

  test('my-designs.html: 도우미를 불러 목록을 그리기 전에 서명한다', () => {
    const html = read('my-designs.html');
    expect(html).toContain('<script src="js/storage-urls.js"></script>');
    const load = html.slice(html.indexOf('async function load('), html.indexOf('// ─── 렌더 ───'));
    expect(load.indexOf('await signImages(rows)')).toBeGreaterThan(-1);
    expect(load.indexOf('await signImages(rows)')).toBeLessThan(load.indexOf('render()'));
  });

  test('admin/dataset.html · detaildesign.html 도 도우미를 불러온다 (detaildesign 은 supabase-utils 보다 먼저)', () => {
    expect(read('admin/dataset.html')).toContain('<script src="../js/storage-urls.js"></script>');
    const dd = read('detaildesign.html');
    expect(dd.indexOf('js/storage-urls.js')).toBeGreaterThan(-1);
    expect(dd.indexOf('js/storage-urls.js')).toBeLessThan(dd.indexOf('js/supabase-utils.js'));
  });

  test('private-photo-buckets.sql: 공개 정책을 이름 그대로 지우고 본인·관리자 읽기를 더한다', () => {
    const sql = read('database/private-photo-buckets.sql');
    const body = sql
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(body).toMatch(/UPDATE storage\.buckets\s+SET public = FALSE\s+WHERE id IN \('generations', 'design-images', 'training-zips'\);/);
    expect(body).toContain('DROP POLICY IF EXISTS "generations_objects_select_public" ON storage.objects;');
    expect(body).toContain('DROP POLICY IF EXISTS "design-images_select_public" ON storage.objects;');
    for (const [name, bucket] of [
      ['generations_objects_select_own', 'generations'],
      ['design-images_select_own', 'design-images'],
    ]) {
      expect(body).toContain(`DROP POLICY IF EXISTS "${name}" ON storage.objects;`);
      expect(body).toMatch(
        new RegExp(`CREATE POLICY "${name}" ON storage\\.objects\\s+FOR SELECT\\s+TO authenticated\\s+USING \\(\\s+bucket_id = '${bucket}'\\s+AND \\(storage\\.foldername\\(name\\)\\)\\[1\\] = auth\\.uid\\(\\)::text\\s+\\);`)
      );
    }
    for (const [name, bucket] of [
      ['generations_objects_select_admin', 'generations'],
      ['design-images_select_admin', 'design-images'],
    ]) {
      expect(body).toContain(`DROP POLICY IF EXISTS "${name}" ON storage.objects;`);
      expect(body).toMatch(
        new RegExp(`CREATE POLICY "${name}" ON storage\\.objects\\s+FOR SELECT\\s+TO authenticated\\s+USING \\(\\s+bucket_id = '${bucket}'\\s+AND public\\.is_admin\\(\\)\\s+\\);`)
      );
    }
    // 누구에게나(TO public / anon) 여는 SELECT 는 새로 만들지 않는다
    expect(body).not.toMatch(/FOR SELECT\s+TO (public|anon)/);
  });

  test('옛 스키마 파일도 비공개 + 본인·관리자 읽기 — 다시 돌려도 공개로 돌아가지 않는다', () => {
    const code = (f) =>
      read(f)
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n');
    const gen = code('database/generations-schema.sql');
    expect(gen).toMatch(/VALUES \('generations', 'generations', FALSE\)\s+ON CONFLICT \(id\) DO UPDATE SET public = FALSE;/);
    expect(gen).not.toMatch(/CREATE POLICY "generations_objects_select_public"/);
    expect(gen).toMatch(/CREATE POLICY "generations_objects_select_own"[\s\S]*?\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text\);/);
    expect(gen).toMatch(/CREATE POLICY "generations_objects_select_admin"[\s\S]*?bucket_id = 'generations' AND public\.is_admin\(\)\);/);

    const di = code('database/storage-policies.sql');
    expect(di).toMatch(/VALUES \('design-images', 'design-images', false\)\s+ON CONFLICT \(id\) DO UPDATE SET public = false;/);
    expect(di).not.toMatch(/CREATE POLICY "design-images_select_public"/);
    expect(di).toMatch(/CREATE POLICY "design-images_select_own"/);
    expect(di).toMatch(/CREATE POLICY "design-images_select_admin"[\s\S]*?public\.is_admin\(\)/);
    for (const sql of [gen, di]) expect(sql).not.toMatch(/FOR SELECT\s+TO (public|anon)/);
  });
});

describe('design-images 업로드 — Cache-Control: private, max-age=3600', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

  /** supabase-js 흉내 — upload 인자를 기록한다. user_images insert 체인도 받는다 */
  function uploadClient() {
    const uploads = [];
    return {
      uploads,
      storage: {
        from(bucket) {
          return {
            async upload(p, body, opts) {
              uploads.push({ bucket, path: p, body, opts });
              return { data: { path: p }, error: null };
            },
            getPublicUrl(p) {
              return { data: { publicUrl: `${SB}/storage/v1/object/public/${bucket}/${p}` } };
            },
          };
        },
      },
      from() {
        return { insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'img1' }, error: null }) }) }) };
      },
    };
  }

  function loadSupabaseUtils() {
    // 브라우저 전역(window)만 넣어 평가한다 — 파일 끝에서 window.SupabaseUtils 로 내보낸다
    const win = { DADAM_CONFIG: { supabase: { url: SB, anonKey: 'anon' } } };
    new Function('window', read('js/supabase-utils.js'))(win);
    const S = win.SupabaseUtils;
    S.ensureImageLimit = async () => {};
    return S;
  }

  const fakeFile = (name, type) => ({
    name,
    type,
    size: 3,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });

  test('SupabaseUtils.uploadImageWithType: ArrayBuffer 로 · private 헤더 · 파일 형식', async () => {
    const S = loadSupabaseUtils();
    const c = uploadClient();
    S.client = c;
    const out = await S.uploadImageWithType(fakeFile('room.jpg', 'image/jpeg'), UID, 'site_photo');
    expect(c.uploads).toHaveLength(1);
    const u = c.uploads[0];
    expect(u.bucket).toBe('design-images');
    expect(u.path).toMatch(new RegExp(`^${UID}/site_photo/\\d+\\.jpg$`));
    expect(u.body).toBeInstanceOf(ArrayBuffer); // Blob·File 이면 multipart 로 가서 private 이 빠진다
    expect(u.opts).toEqual({ upsert: false, contentType: 'image/jpeg', headers: { 'cache-control': 'private, max-age=3600' } });
    expect(out.publicUrl).toBe(`${SB}/storage/v1/object/public/design-images/${u.path}`); // 저장하는 주소는 예전 모양
  });

  test('SupabaseUtils.uploadImageWithType: 형식이 비면 multipart 때와 같은 application/octet-stream', async () => {
    const S = loadSupabaseUtils();
    const c = uploadClient();
    S.client = c;
    await S.uploadImageWithType(fakeFile('x.heic', ''), UID, 'site_photo');
    expect(c.uploads[0].opts.contentType).toBe('application/octet-stream');
  });

  test('SupabaseUtils.saveAIGeneratedImage: Uint8Array 로 · image/png · private 헤더', async () => {
    const S = loadSupabaseUtils();
    const c = uploadClient();
    S.client = c;
    await S.saveAIGeneratedImage(Buffer.from('PNG').toString('base64'), UID);
    const u = c.uploads[0];
    expect(u.bucket).toBe('design-images');
    expect(u.body).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(u.body).toString()).toBe('PNG');
    expect(u.opts).toEqual({ upsert: false, contentType: 'image/png', headers: { 'cache-control': 'private, max-age=3600' } });
  });

  test('SupabaseService.uploadImage (js/modules): ArrayBuffer 로 · private 헤더', async () => {
    const src = read('js/modules/services/supabase-service.js')
      .replace(/^import [\s\S]*?;\n/gm, '')
      .replace(/^export [\s\S]*?;\n/gm, '');
    const { SupabaseService } = new Function('eventBus', 'Events', 'API_ENDPOINTS', src + '\nreturn { SupabaseService };')(
      { emit() {} },
      {},
      {}
    );
    const svc = new SupabaseService();
    const c = uploadClient();
    svc.client = c;
    const r = await svc.uploadImage(fakeFile('a.png', 'image/png'), UID);
    expect(r.error).toBeNull();
    const u = c.uploads[0];
    expect(u.bucket).toBe('design-images');
    expect(u.body).toBeInstanceOf(ArrayBuffer);
    expect(u.opts).toEqual({ upsert: false, contentType: 'image/png', headers: { 'cache-control': 'private, max-age=3600' } });
  });
});
