/**
 * @jest-environment node
 *
 * 회원탈퇴 — 지울 것은 지우고, 남길 것은 회원과 떼어 남긴다 (2026-10-27, workers/account-api).
 *
 * 고정하는 것:
 *   1) purgeUserFiles — generations · design-images · collection 의 '{user_id}/' 폴더를 끝까지 따라가 지운다.
 *      keep 으로 준 경로는 남기고, skip 한 버킷은 건드리지 않는다. 다른 회원 · 다른 버킷은 그대로. UUID 가 아니면 아무것도 안 한다
 *   2) prepareWithdrawal — 공개 AI 연출컷(ai_render) 행 · 파일은 남기고, 직접 올린 시공사례(upload) 행과 나머지 파일은 지운다.
 *      남길 것을 못 읽으면 collection 버킷은 건드리지 않는다. 던지지 않고 수만 돌려준다
 *   3) /delete · /admin/delete — 정리 → admin_logs(정본 열, 지운 수 · 남긴 수) → 계정 삭제. 일부 실패해도 탈퇴는 한다.
 *      로그 · 기록에 경로 · 이메일 · 회원 id(로그) 를 남기지 않는다
 *   4) database/withdrawal-retention.sql — 남길 FK 는 SET NULL, 문의는 CASCADE, 구독 결제 키는 트리거로 지운다
 *   5) 연출컷 삭제(워커 DELETE /api/generate/:id)는 게시물 행 · 복사본을 먼저 지운다 — FK 가 SET NULL 이 돼도 그 길은 그대로
 *   6) mypage.html 탈퇴 안내 — 지우는 것 · 남는 것
 *
 * ESM 을 jest(CJS) 에서 읽기 위해 import · export 를 떼고, import 하던 것은 인자로 넣어 평가한다.
 */

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

function loadEsm(rel, names, deps = {}) {
  const src = read(rel)
    .replace(/^import [\s\S]*?;\n/gm, '')
    .replace(/^export default /m, 'const __default = ')
    .replace(/^export /gm, '');
  const keys = Object.keys(deps);
  return new Function(...keys, src + `\nreturn { ${names.join(', ')} };`)(...keys.map((k) => deps[k]));
}

const P = loadEsm('workers/account-api/src/storage-purge.js', [
  'USER_FOLDER_BUCKETS',
  'MAX_STORAGE_CALLS',
  'UUID_RE',
  'DESIGN_FOLDERS',
  'makePurgeContext',
  'purgeDesignFiles',
  'purgeUserFiles',
  'purgeSummary',
]);
const Wd = loadEsm('workers/account-api/src/withdrawal.js', ['prepareWithdrawal', 'withdrawalDetail', 'withdrawalSummary'], {
  UUID_RE: P.UUID_RE,
  makePurgeContext: P.makePurgeContext,
  purgeDesignFiles: P.purgeDesignFiles,
  purgeSummary: P.purgeSummary,
  purgeUserFiles: P.purgeUserFiles,
});
const C = loadEsm('workers/account-api/src/cors.js', ['corsHeaders', 'handleOptions', 'jsonResponse']);
const W = loadEsm('workers/account-api/src/worker.js', ['__default'], {
  corsHeaders: C.corsHeaders,
  handleOptions: C.handleOptions,
  jsonResponse: C.jsonResponse,
  prepareWithdrawal: Wd.prepareWithdrawal,
  withdrawalDetail: Wd.withdrawalDetail,
  withdrawalSummary: Wd.withdrawalSummary,
}).__default;

const SB = 'https://example.supabase.co';
const ENV = { SUPABASE_URL: SB, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', CORS_ORIGINS: 'https://dadamfurniture.com' };
const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Supabase 흉내 — Storage 버킷(경로 목록) · list · delete · collection_posts · auth · admin_logs · is_admin.
 *   failDelete / failList: Storage 가 500 인 버킷   failPosts: { read?: true, del?: true } collection_posts 가 500
 */
function fakeSupabase(
  files,
  posts,
  { failDelete = [], failList = [], failPosts = {}, admin = false, designs = DESIGNS(), failDesigns = {} } = {}
) {
  const store = {};
  for (const [bucket, paths] of Object.entries(files)) store[bucket] = new Set(paths);
  const rows = posts.map((p) => ({ ...p }));
  const designRows = designs.map((d) => ({ ...d }));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    let m = u.match(/\/storage\/v1\/object\/list\/([^/?]+)$/);
    if (m) {
      const bucket = m[1];
      const body = JSON.parse(init.body);
      calls.push({ kind: 'list', bucket, prefix: body.prefix, offset: body.offset, auth });
      if (failList.includes(bucket)) return jsonRes({ message: 'boom' }, 500);
      const prefix = body.prefix.replace(/\/$/, '') + '/';
      const names = new Map();
      for (const p of store[bucket] || []) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const i = rest.search(/\//);
        if (i < 0) names.set(rest, { name: rest, id: 'id-' + rest, metadata: {} });
        else names.set(rest.slice(0, i), { name: rest.slice(0, i), id: null, metadata: null });
      }
      const sorted = [...names.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
      return jsonRes(sorted.slice(body.offset, body.offset + body.limit));
    }
    m = u.match(/\/storage\/v1\/object\/([^/?]+)$/);
    if (m && method === 'DELETE') {
      const bucket = m[1];
      const body = JSON.parse(init.body);
      calls.push({ kind: 'delete', bucket, paths: body.prefixes, auth });
      if (failDelete.includes(bucket)) return jsonRes({ message: 'boom' }, 500);
      const out = [];
      for (const p of body.prefixes) if (store[bucket] && store[bucket].delete(p)) out.push({ name: p });
      return jsonRes(out);
    }
    m = u.match(/\/rest\/v1\/collection_posts\?user_id=eq\.([0-9a-f-]+)&source=eq\.(\w+)&select=/);
    if (m) {
      const [, uid, source] = m;
      calls.push({ kind: method === 'DELETE' ? 'posts_delete' : 'posts_read', source, auth });
      if ((method === 'GET' && failPosts.read) || (method === 'DELETE' && failPosts.del)) return jsonRes({ message: 'boom' }, 500);
      const hit = rows.filter((r) => r.user_id === uid && r.source === source);
      if (method === 'DELETE') for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return jsonRes(hit.map((r) => ({ id: r.id, storage_path: r.storage_path })));
    }
    // 설계 — 계약 기록 판정(RPC)과 지우기
    if (u.endsWith('/rest/v1/rpc/withdrawal_designs')) {
      const { p_user_id } = JSON.parse(init.body);
      calls.push({ kind: 'designs_split', auth });
      if (failDesigns.rpc) return jsonRes({ message: 'function does not exist' }, 404);
      return jsonRes(designRows.filter((d) => d.user_id === p_user_id).map((d) => ({ design_id: d.id, contract: d.contract })));
    }
    m = u.match(/\/rest\/v1\/designs\?id=in\.\(([^)]*)\)&user_id=eq\.([0-9a-f-]+)&select=id$/);
    if (m && method === 'DELETE') {
      const ids = m[1].split(',');
      calls.push({ kind: 'designs_delete', ids, auth });
      if (failDesigns.del) return jsonRes({ message: 'boom' }, 500);
      const hit = designRows.filter((d) => ids.includes(d.id) && d.user_id === m[2]);
      for (const d of hit) designRows.splice(designRows.indexOf(d), 1);
      return jsonRes(hit.map((d) => ({ id: d.id })));
    }
    if (u.endsWith('/auth/v1/user')) {
      calls.push({ kind: 'whoami' });
      return jsonRes(auth === 'Bearer admin-token' ? { id: ADMIN, email: 'admin@dadam.test' } : { id: UID, email: 'customer@example.com' });
    }
    if (u.endsWith('/rest/v1/rpc/is_admin')) {
      calls.push({ kind: 'is_admin' });
      return jsonRes(admin);
    }
    if (u.endsWith('/rest/v1/admin_logs')) {
      calls.push({ kind: 'admin_log', body: JSON.parse(init.body) });
      return new Response(null, { status: 201 });
    }
    m = u.match(/\/auth\/v1\/admin\/users\/([^/?]+)$/);
    if (m && method === 'DELETE') {
      calls.push({ kind: 'auth_delete', id: m[1] });
      return jsonRes({});
    }
    throw new Error(`unexpected ${method} ${u}`);
  };
  return { store, rows, designRows, calls, fetchImpl };
}

// 설계: D_KEEP 은 계약 기록(확인서 · 수주)이 있다 — 남긴다. D_DROP 은 없다 — 지운다. D_OTHER 는 다른 회원 것
const D_KEEP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D_DROP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const D_OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DESIGNS = () => [
  { id: D_KEEP, user_id: UID, contract: true },
  { id: D_DROP, user_id: UID, contract: false },
  { id: D_OTHER, user_id: OTHER, contract: false },
];

const FILES = () => ({
  generations: [`${UID}/g1/room.jpg`, `${UID}/g1/base.png`, `${UID}/g1/v1.jpg`, `${UID}/g2/room.jpg`, `${UID}/g2/guide.png`, `${OTHER}/g9/room.jpg`],
  'design-images': [`${UID}/site_photo/1.jpg`, `${UID}/ai_generated/2.png`, `${OTHER}/site_photo/3.jpg`],
  collection: [`${UID}/gen-g1.png`, `${UID}/gen-g2.jpg`, `${UID}/1700000000-a.jpg`, `${OTHER}/x.jpg`],
  renders: [`${D_KEEP}/1/front.png`, `${D_DROP}/1/front.png`, `${D_DROP}/2/iso.png`, `${D_OTHER}/1/front.png`],
  cad: [`${D_KEEP}/s1/body-a.glb`, `${D_DROP}/s1/body-b.glb`, `exterior/${D_DROP}/s1/ext-c.glb`, `exterior/${D_KEEP}/s1/ext-d.glb`],
  'furniture-images': [`${UID}/not-a-user-folder.jpg`],
});
// gen-g1 은 공개 AI 연출컷(남긴다). gen-g2 는 고객이 이미 내린 것(행 없음 → 지운다). 1700000000-a 는 직접 올린 사진
const POSTS = () => [
  { id: 'p-ai', user_id: UID, source: 'ai_render', storage_path: `${UID}/gen-g1.png` },
  { id: 'p-up', user_id: UID, source: 'upload', storage_path: `${UID}/1700000000-a.jpg` },
  { id: 'p-other', user_id: OTHER, source: 'upload', storage_path: `${OTHER}/x.jpg` },
];

const realFetch = global.fetch;
const realLog = console.log;
const realWarn = console.warn;
const realError = console.error;
let logs;
beforeEach(() => {
  logs = [];
  console.log = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
});
afterEach(() => {
  global.fetch = realFetch;
  console.log = realLog;
  console.warn = realWarn;
  console.error = realError;
});

describe('purgeUserFiles', () => {
  test('세 버킷의 회원 폴더를 끝까지 따라가 지운다 — 다른 회원 · 다른 버킷은 그대로', async () => {
    const sb = fakeSupabase(FILES(), []);
    global.fetch = sb.fetchImpl;
    const r = await P.purgeUserFiles(ENV, UID);
    expect(P.USER_FOLDER_BUCKETS).toEqual(['generations', 'design-images', 'collection']);
    expect(r.ok).toBe(true);
    expect(r.buckets).toEqual({
      generations: { found: 5, deleted: 5, kept: 0, failed: 0 },
      'design-images': { found: 2, deleted: 2, kept: 0, failed: 0 },
      collection: { found: 3, deleted: 3, kept: 0, failed: 0 },
    });
    expect([...sb.store.generations]).toEqual([`${OTHER}/g9/room.jpg`]);
    expect([...sb.store.renders]).toHaveLength(FILES().renders.length); // 설계 폴더는 회원 정리가 건드리지 않는다
    expect([...sb.store.cad]).toHaveLength(FILES().cad.length);
    expect([...sb.store['furniture-images']]).toHaveLength(1);
    expect(sb.calls.every((c) => c.auth === 'Bearer service')).toBe(true);
    expect(sb.calls.filter((c) => c.kind === 'delete').flatMap((c) => c.paths).every((p) => p.startsWith(`${UID}/`))).toBe(true);
  });

  test('keep 으로 준 경로는 남기고, skip 한 버킷은 건드리지 않는다', async () => {
    const sb = fakeSupabase(FILES(), []);
    global.fetch = sb.fetchImpl;
    const r = await P.purgeUserFiles(ENV, UID, { keep: { collection: new Set([`${UID}/gen-g1.png`]) } });
    expect(r.buckets.collection).toEqual({ found: 3, deleted: 2, kept: 1, failed: 0 });
    expect(sb.store.collection.has(`${UID}/gen-g1.png`)).toBe(true);

    const sb2 = fakeSupabase(FILES(), []);
    global.fetch = sb2.fetchImpl;
    const r2 = await P.purgeUserFiles(ENV, UID, { skip: { collection: 'keep_unknown' } });
    expect(r2.ok).toBe(false);
    expect(r2.buckets.collection).toMatchObject({ found: 0, deleted: 0, error: 'keep_unknown' });
    expect(sb2.calls.filter((c) => c.bucket === 'collection')).toHaveLength(0);
    expect(sb2.store.generations.size).toBe(1);
  });

  test('쪽 넘김 · 나눠 지우기', async () => {
    const many = Array.from({ length: 7 }, (_, i) => `${UID}/f${i}.jpg`);
    const sb = fakeSupabase({ collection: many }, []);
    global.fetch = sb.fetchImpl;
    const r = await P.purgeUserFiles(ENV, UID, { buckets: ['collection'], pageSize: 3, deleteChunk: 4 });
    expect(r.buckets.collection).toEqual({ found: 7, deleted: 7, kept: 0, failed: 0 });
    expect(sb.calls.filter((c) => c.kind === 'list').map((c) => c.offset)).toEqual([0, 3, 6]);
    expect(sb.calls.filter((c) => c.kind === 'delete').map((c) => c.paths.length)).toEqual([4, 3]);
  });

  test('UUID 가 아니면 아무 요청도 하지 않는다 — 버킷 전체를 지우는 일이 없게', async () => {
    global.fetch = async () => {
      throw new Error('fetch 하면 안 된다');
    };
    for (const id of ['', '..', '*', `${UID}/x`, null, undefined, 'abc']) {
      expect(await P.purgeUserFiles(ENV, id)).toMatchObject({ ok: false, error: 'bad_user_id' });
    }
  });

  test('일부 실패 · 요청 상한 — 던지지 않고 수로', async () => {
    const sb = fakeSupabase(FILES(), [], { failDelete: ['generations'], failList: ['design-images'] });
    global.fetch = sb.fetchImpl;
    const r = await P.purgeUserFiles(ENV, UID);
    expect(r.ok).toBe(false);
    expect(r.buckets.generations).toEqual({ found: 5, deleted: 0, kept: 0, failed: 5 });
    expect(r.buckets['design-images']).toMatchObject({ error: 'list 500' });
    expect(r.buckets.collection.deleted).toBe(3);

    const sb2 = fakeSupabase(FILES(), []);
    global.fetch = sb2.fetchImpl;
    const r2 = await P.purgeUserFiles(ENV, UID, { maxCalls: 2 });
    expect(r2).toMatchObject({ ok: false, truncated: true, calls: 2 });
    expect(P.MAX_STORAGE_CALLS).toBeLessThan(1000);
  });
});

describe('prepareWithdrawal', () => {
  test('공개 AI 연출컷 행 · 파일은 남기고, 직접 올린 시공사례 행과 나머지 파일은 지운다', async () => {
    const sb = fakeSupabase(FILES(), POSTS());
    global.fetch = sb.fetchImpl;
    const w = await Wd.prepareWithdrawal(ENV, UID);
    expect(w.complete).toBe(true);
    expect(w.posts).toEqual({ upload_deleted: 1, ai_render_kept: 1 });
    // 행: 남은 것은 이 회원의 ai_render 와 다른 회원 것
    expect(sb.rows.map((r) => r.id).sort()).toEqual(['p-ai', 'p-other']);
    // 파일: generations · design-images 전부, collection 은 공개 AI 연출컷 복사본만 남는다
    expect([...sb.store.generations]).toEqual([`${OTHER}/g9/room.jpg`]);
    expect([...sb.store['design-images']]).toEqual([`${OTHER}/site_photo/3.jpg`]);
    expect([...sb.store.collection].sort()).toEqual([`${UID}/gen-g1.png`, `${OTHER}/x.jpg`].sort());
    expect(w.files.buckets.collection).toEqual({ found: 3, deleted: 2, kept: 1, failed: 0 });
    // 순서: 남길 것 읽기 → 직접 올린 행 지우기 → 파일
    const kinds = sb.calls.map((c) => c.kind);
    expect(kinds.slice(0, 2)).toEqual(['posts_read', 'posts_delete']);
    expect(sb.calls[0].source).toBe('ai_render');
    expect(sb.calls[1].source).toBe('upload');
    expect(sb.calls.slice(0, 2).every((c) => c.auth === 'Bearer service')).toBe(true);
  });

  test('남길 것을 못 읽으면 collection 버킷은 건드리지 않는다 — 나머지는 지운다', async () => {
    const sb = fakeSupabase(FILES(), POSTS(), { failPosts: { read: true } });
    global.fetch = sb.fetchImpl;
    const w = await Wd.prepareWithdrawal(ENV, UID);
    expect(w.complete).toBe(false);
    expect(w.errors).toEqual(['ai_render_read']);
    expect(sb.store.collection.size).toBe(4);
    expect(sb.store.generations.size).toBe(1);
    expect(w.files.buckets.collection.error).toBe('keep_unknown');
  });

  test('직접 올린 행을 못 지워도 파일은 지운다 — 기록에 남긴다', async () => {
    const sb = fakeSupabase(FILES(), POSTS(), { failPosts: { del: true } });
    global.fetch = sb.fetchImpl;
    const w = await Wd.prepareWithdrawal(ENV, UID);
    expect(w.complete).toBe(false);
    expect(w.errors).toEqual(['upload_delete']);
    expect(sb.store.collection.has(`${UID}/1700000000-a.jpg`)).toBe(false);
    expect(sb.store.collection.has(`${UID}/gen-g1.png`)).toBe(true);
  });

  test('UUID 가 아니면 아무것도 하지 않는다', async () => {
    global.fetch = async () => {
      throw new Error('fetch 하면 안 된다');
    };
    expect(await Wd.prepareWithdrawal(ENV, 'x')).toMatchObject({ complete: false, errors: ['bad_user_id'] });
  });
});

function post(pathname, token, body) {
  return new Request(`https://account.test${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'https://dadamfurniture.com' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('/delete — 본인 탈퇴', () => {
  test('정리 → 기록 → 계정 삭제', async () => {
    const sb = fakeSupabase(FILES(), POSTS());
    global.fetch = sb.fetchImpl;
    const res = await W.fetch(post('/delete', 'user-token'), ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const kinds = sb.calls.map((c) => c.kind);
    const pos = (k) => kinds.findIndex((x) => x === k);
    const lastStorage = Math.max(kinds.lastIndexOf('list'), kinds.lastIndexOf('delete'));
    expect(pos('posts_read')).toBeLessThan(pos('posts_delete'));
    expect(pos('posts_delete')).toBeLessThan(lastStorage);
    expect(pos('admin_log')).toBeGreaterThan(lastStorage);
    expect(pos('auth_delete')).toBeGreaterThan(pos('admin_log'));
    expect(sb.calls.find((c) => c.kind === 'auth_delete').id).toBe(UID);
  });

  test('admin_logs 는 정본 열로 · 지운 수와 남긴 수 — 이메일 · 경로 · (로그의) 회원 id 없음', async () => {
    const sb = fakeSupabase(FILES(), POSTS());
    global.fetch = sb.fetchImpl;
    await W.fetch(post('/delete', 'user-token'), ENV);
    const row = sb.calls.find((c) => c.kind === 'admin_log').body;
    expect(Object.keys(row).sort()).toEqual(['action_type', 'description', 'new_value', 'target_id', 'target_type']);
    expect(row).toMatchObject({ action_type: 'account_delete', target_type: 'user', target_id: UID });
    expect(row.new_value).toEqual({
      self_service: true,
      complete: true,
      posts: { upload_deleted: 1, ai_render_kept: 1 },
      designs: { deleted: 1, kept: 1, failed: 0 },
      files: {
        generations: { deleted: 5, failed: 0 },
        'design-images': { deleted: 2, failed: 0 },
        collection: { deleted: 2, failed: 0, kept: 1 },
        renders: { deleted: 2, failed: 0 },
        cad: { deleted: 2, failed: 0 },
      },
    });
    const text = JSON.stringify(row) + logs.join('\n');
    expect(text).not.toContain('customer@example.com');
    expect(text).not.toMatch(/\.jpg|\.png|\.glb|site_photo|gen-g/);
    expect(text).not.toContain(D_DROP);
    expect(logs.join('\n')).not.toContain(UID);
    expect(logs.join('\n')).toMatch(
      /posts: upload_deleted=1 ai_render_kept=1 designs: deleted=1 kept=1 .*collection=2\/3 kept=1 .*renders=2\/2 cad=2\/2 .*complete=true/
    );
  });

  test('일부를 못 지워도 탈퇴는 한다 — 기록에 complete:false', async () => {
    const sb = fakeSupabase(FILES(), POSTS(), { failDelete: ['generations'] });
    global.fetch = sb.fetchImpl;
    const res = await W.fetch(post('/delete', 'user-token'), ENV);
    expect(res.status).toBe(200);
    expect(sb.calls.some((c) => c.kind === 'auth_delete')).toBe(true);
    const v = sb.calls.find((c) => c.kind === 'admin_log').body.new_value;
    expect(v.complete).toBe(false);
    expect(v.files.generations).toEqual({ deleted: 0, failed: 5 });
  });

  test('로그인하지 않았으면 아무것도 건드리지 않는다', async () => {
    const sb = fakeSupabase(FILES(), POSTS());
    global.fetch = sb.fetchImpl;
    const res = await W.fetch(new Request('https://account.test/delete', { method: 'POST', headers: { Origin: 'https://dadamfurniture.com' } }), ENV);
    expect(res.status).toBe(401);
    expect(sb.calls.filter((c) => !['whoami'].includes(c.kind))).toHaveLength(0);
  });
});

describe('/admin/delete — 관리자 강제 탈퇴', () => {
  test('관리자가 아니면 아무것도 건드리지 않는다', async () => {
    const sb = fakeSupabase(FILES(), POSTS(), { admin: false });
    global.fetch = sb.fetchImpl;
    const res = await W.fetch(post('/admin/delete', 'user-token', { user_id: OTHER }), ENV);
    expect(res.status).toBe(401);
    expect(sb.calls.filter((c) => ['list', 'delete', 'posts_read', 'posts_delete', 'auth_delete'].includes(c.kind))).toHaveLength(0);
  });

  test('대상 회원을 같은 규칙으로 정리한 뒤 계정을 지운다 — 기록은 관리자 · 정본 열', async () => {
    const sb = fakeSupabase(FILES(), POSTS(), { admin: true });
    global.fetch = sb.fetchImpl;
    const res = await W.fetch(post('/admin/delete', 'admin-token', { user_id: OTHER }), ENV);
    expect(res.status).toBe(200);
    expect(sb.store.collection.has(`${OTHER}/x.jpg`)).toBe(false);
    expect(sb.rows.find((r) => r.id === 'p-other')).toBeUndefined();
    expect(sb.store.collection.has(`${UID}/gen-g1.png`)).toBe(true);
    expect(sb.calls.find((c) => c.kind === 'auth_delete').id).toBe(OTHER);
    const row = sb.calls.find((c) => c.kind === 'admin_log').body;
    expect(row).toMatchObject({
      admin_id: ADMIN,
      admin_email: 'admin@dadam.test',
      action_type: 'account_delete',
      target_type: 'user',
      target_id: OTHER,
      new_value: { by_admin: true, complete: true, posts: { upload_deleted: 1, ai_render_kept: 0 } },
    });
    expect(row).not.toHaveProperty('action');
    expect(row).not.toHaveProperty('detail');
  });

  test('대상 id 가 UUID 모양이 아니면 400 — 아무것도 건드리지 않는다', async () => {
    const sb = fakeSupabase(FILES(), POSTS(), { admin: true });
    global.fetch = sb.fetchImpl;
    for (const bad of ['--------------------------------0000', '', '../x', 42]) {
      expect((await W.fetch(post('/admin/delete', 'admin-token', { user_id: bad }), ENV)).status).toBe(400);
    }
    expect(sb.calls.filter((c) => ['list', 'delete', 'posts_read', 'posts_delete', 'auth_delete'].includes(c.kind))).toHaveLength(0);
  });
});

describe('purgeDesignFiles — renders · cad', () => {
  test('준 설계의 폴더만 — renders {id}/ · cad {id}/ · cad exterior/{id}/', async () => {
    const sb = fakeSupabase(FILES(), []);
    global.fetch = sb.fetchImpl;
    const r = await P.purgeDesignFiles(ENV, [D_DROP]);
    expect(r.ok).toBe(true);
    expect(r.buckets).toEqual({
      renders: { found: 2, deleted: 2, kept: 0, failed: 0 },
      cad: { found: 2, deleted: 2, kept: 0, failed: 0 },
    });
    expect([...sb.store.renders].sort()).toEqual([`${D_KEEP}/1/front.png`, `${D_OTHER}/1/front.png`].sort());
    expect([...sb.store.cad].sort()).toEqual([`${D_KEEP}/s1/body-a.glb`, `exterior/${D_KEEP}/s1/ext-d.glb`].sort());
    expect(sb.calls.filter((c) => c.kind === 'list').map((c) => `${c.bucket}:${c.prefix.split('/').slice(0, 2).join('/')}`)).toEqual(
      expect.arrayContaining([`renders:${D_DROP}/1`, `cad:${D_DROP}/s1`, `cad:exterior/${D_DROP}`])
    );
    expect(P.DESIGN_FOLDERS.cad(D_DROP)).toEqual([D_DROP, `exterior/${D_DROP}`]);
  });

  test('설계 id 가 하나라도 UUID 가 아니면 아무것도 하지 않는다 · 빈 목록이면 지울 것이 없다', async () => {
    global.fetch = async () => {
      throw new Error('fetch 하면 안 된다');
    };
    for (const ids of [[D_DROP, ''], ['exterior'], [D_DROP, '../x'], null]) {
      expect(await P.purgeDesignFiles(ENV, ids)).toMatchObject({ ok: false, error: 'bad_design_id' });
    }
    expect(await P.purgeDesignFiles(ENV, [])).toMatchObject({ ok: true, buckets: { renders: { found: 0 }, cad: { found: 0 } } });
  });

  test('요청 상한은 회원 정리와 나눠 쓴다 (같은 묶음)', async () => {
    const sb = fakeSupabase(FILES(), []);
    global.fetch = sb.fetchImpl;
    const ctx = P.makePurgeContext({ maxCalls: 3 });
    await P.purgeUserFiles(ENV, UID, { ctx, buckets: ['collection'] });
    const r = await P.purgeDesignFiles(ENV, [D_DROP], { ctx });
    expect(r.truncated).toBe(true);
    expect(ctx.calls).toBe(3);
  });
});

describe('prepareWithdrawal — 설계', () => {
  test('계약 기록이 없는 설계만 지우고(이 회원 것만) 그 renders · cad 파일을 지운다 — 계약 설계와 그 파일은 남긴다', async () => {
    const sb = fakeSupabase(FILES(), POSTS());
    global.fetch = sb.fetchImpl;
    const w = await Wd.prepareWithdrawal(ENV, UID);
    expect(w.complete).toBe(true);
    expect(w.designs).toEqual({ deleted: 1, kept: 1, failed: 0 });
    expect(sb.designRows.map((d) => d.id).sort()).toEqual([D_KEEP, D_OTHER].sort());
    const del = sb.calls.find((c) => c.kind === 'designs_delete');
    expect(del.ids).toEqual([D_DROP]);
    expect(del.auth).toBe('Bearer service');
    expect(sb.store.renders.has(`${D_KEEP}/1/front.png`)).toBe(true);
    expect(sb.store.cad.has(`exterior/${D_KEEP}/s1/ext-d.glb`)).toBe(true);
    expect([...sb.store.renders].some((p) => p.startsWith(D_DROP))).toBe(false);
    expect([...sb.store.cad].some((p) => p.includes(D_DROP))).toBe(false);
    // 순서: 설계 판정 → 설계 행 → (파일)
    const kinds = sb.calls.map((c) => c.kind);
    expect(kinds.findIndex((k) => k === 'designs_split')).toBeLessThan(kinds.findIndex((k) => k === 'designs_delete'));
    const firstDesignList = sb.calls.findIndex((c) => c.kind === 'list' && (c.bucket === 'renders' || c.bucket === 'cad'));
    expect(kinds.findIndex((k) => k === 'designs_delete')).toBeLessThan(firstDesignList);
  });

  test('계약 판정을 못 하면 어느 설계도 지우지 않고 renders · cad 도 건드리지 않는다', async () => {
    const sb = fakeSupabase(FILES(), POSTS(), { failDesigns: { rpc: true } });
    global.fetch = sb.fetchImpl;
    const w = await Wd.prepareWithdrawal(ENV, UID);
    expect(w.complete).toBe(false);
    expect(w.errors).toContain('designs_read');
    expect(sb.calls.some((c) => c.kind === 'designs_delete')).toBe(false);
    expect(sb.designRows).toHaveLength(3);
    expect(sb.store.renders.size).toBe(FILES().renders.length);
    expect(sb.store.cad.size).toBe(FILES().cad.length);
    // 회원 폴더 정리는 그대로 한다
    expect(sb.store.generations.size).toBe(1);
  });

  test('설계 행을 못 지우면 그 설계의 파일도 남긴다 (행과 파일이 함께 남는다)', async () => {
    const sb = fakeSupabase(FILES(), POSTS(), { failDesigns: { del: true } });
    global.fetch = sb.fetchImpl;
    const w = await Wd.prepareWithdrawal(ENV, UID);
    expect(w.errors).toContain('designs_delete');
    expect(w.designs).toEqual({ deleted: 0, kept: 1, failed: 1 });
    expect(sb.store.renders.size).toBe(FILES().renders.length);
    expect(sb.store.cad.size).toBe(FILES().cad.length);
  });
});

describe('database/withdrawal-contract-records.sql', () => {
  const sql = read('database/withdrawal-contract-records.sql')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  test('트랜잭션 · designs.user_id · credit_ledger.user_id 를 SET NULL 로 (기존 FK 는 이름과 상관없이 지운다)', () => {
    expect(sql.trim().startsWith('BEGIN;')).toBe(true);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    for (const [t, ref] of [
      ['designs', 'auth\\.users\\(id\\)'],
      ['credit_ledger', 'auth\\.users\\(id\\)'],
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `SELECT pg_temp\\.drop_fks_on\\('public\\.${t}', 'user_id'\\);\\s+ALTER TABLE public\\.${t} ALTER COLUMN user_id DROP NOT NULL;\\s+ALTER TABLE public\\.${t}\\s+ADD CONSTRAINT ${t}_user_id_fkey\\s+FOREIGN KEY \\(user_id\\) REFERENCES ${ref} ON DELETE SET NULL;`
        )
      );
    }
    // 수주 · 문서 FK(RESTRICT)는 건드리지 않는다 — 계약 설계는 지우지 않으므로 닿지 않는다
    expect(sql).not.toMatch(/ALTER TABLE (public\.)?orders/);
    expect(sql).not.toMatch(/ALTER TABLE (public\.)?design_documents/);
  });

  test('계약 판정 함수 — 확인서 또는 수주, 이 회원의 설계만, service_role 만 실행', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.withdrawal_designs\(p_user_id UUID\)\s+RETURNS TABLE \(design_id UUID, contract BOOLEAN\)/
    );
    const fn = sql.slice(sql.search(/CREATE OR REPLACE FUNCTION public\.withdrawal_designs/), sql.search(/REVOKE ALL ON FUNCTION/));
    expect(fn).toMatch(/EXISTS \(SELECT 1 FROM public\.design_documents x WHERE x\.design_id = d\.id\)\s+OR EXISTS \(SELECT 1 FROM public\.orders o WHERE o\.design_id = d\.id\)/);
    expect(fn).toMatch(/WHERE d\.user_id = p_user_id/);
    expect(fn).not.toMatch(/SECURITY DEFINER/);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.withdrawal_designs(UUID) FROM PUBLIC;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.withdrawal_designs(UUID) FROM anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.withdrawal_designs(UUID) TO service_role;');
  });

  test('저장소의 회원 정책은 떨어진 행(user_id NULL)을 열지 않는다 — = auth.uid() 비교뿐, IS NULL · true 로 여는 정책 없음', () => {
    const files = fs.readdirSync(path.join(__dirname, '..', 'database')).filter((f) => f.endsWith('.sql'));
    const tables = ['designs', 'design_items', 'design_documents', 'design_snapshots', 'design_schedules', 'design_site_info', 'design_renders', 'planner_snapshots', 'design_cad_artifacts', 'orders', 'order_payments', 'order_costs', 'credit_ledger'];
    const found = [];
    for (const f of files) {
      const src = read(`database/${f}`);
      const re = /CREATE POLICY\s+"?([^"\n]+?)"?\s+ON\s+(?:public\.)?(\w+)([\s\S]*?);/gi;
      let m;
      while ((m = re.exec(src))) {
        if (!tables.includes(m[2])) continue;
        found.push(`${f}:${m[2]}:${m[1]}`);
        const body = m[3].replace(/--[^\n]*/g, '');
        expect(`${f} ${m[1]}: ${/user_id\s+IS\s+NULL/i.test(body)}`).toBe(`${f} ${m[1]}: false`);
        expect(`${f} ${m[1]}: ${/USING\s*\(\s*true\s*\)/i.test(body)}`).toBe(`${f} ${m[1]}: false`);
      }
    }
    expect(found.length).toBeGreaterThan(20);
  });
});

describe('database/withdrawal-retention.sql', () => {
  const sql = read('database/withdrawal-retention.sql')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const fk = (table, col, ref, action) =>
    new RegExp(
      `SELECT pg_temp\\.drop_fks_on\\('public\\.${table}', '${col}'\\);[\\s\\S]*?ADD CONSTRAINT ${table}_${col}_fkey\\s+FOREIGN KEY \\(${col}\\) REFERENCES ${ref.replace(/[.()]/g, '\\$&')} ON DELETE ${action};`
    );

  test('트랜잭션 · 열마다 기존 FK 를 이름과 상관없이 지우고 다시 건다', () => {
    expect(sql.trim().startsWith('BEGIN;')).toBe(true);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION pg_temp\.drop_fks_on\(tbl regclass, col text\)/);
    expect(sql).toMatch(/c\.contype = 'f'/);
  });

  test('남길 것은 SET NULL — 시공사례(작성자 · 원본 연출컷) · 결제 · 구독', () => {
    expect(sql).toMatch(fk('collection_posts', 'user_id', 'auth.users(id)', 'SET NULL'));
    expect(sql).toMatch(fk('collection_posts', 'generation_id', 'public.generations(id)', 'SET NULL'));
    expect(sql).toMatch(fk('payment_history', 'user_id', 'public.profiles(id)', 'SET NULL'));
    expect(sql).toMatch(fk('payment_history', 'subscription_id', 'public.subscriptions(id)', 'SET NULL'));
    expect(sql).toMatch(fk('subscriptions', 'user_id', 'public.profiles(id)', 'SET NULL'));
    for (const t of ['collection_posts', 'payment_history', 'subscriptions']) {
      expect(sql).toContain(`ALTER TABLE public.${t} ALTER COLUMN user_id DROP NOT NULL;`);
    }
  });

  test('구독이 회원과 떨어지면 결제 키를 지우고 닫는다 (트리거)', () => {
    const fn = sql.slice(sql.search(/CREATE OR REPLACE FUNCTION public\.subscriptions_detach_on_withdrawal/), sql.search(/DROP TRIGGER IF EXISTS trg_subscriptions_detach_on_withdrawal/));
    expect(fn).toMatch(/NEW\.billing_key := NULL;/);
    expect(fn).toMatch(/NEW\.next_charge_at := NULL;/);
    expect(fn).toMatch(/NEW\.charge_lock_until := NULL;/);
    expect(fn).toMatch(/IF NEW\.status IN \('active', 'past_due', 'trialing'\) THEN\s+NEW\.status := 'cancelled';\s+NEW\.cancel_reason := COALESCE\(NEW\.cancel_reason, 'user_request'\);/);
    expect(fn).toMatch(/NEW\.ended_at := COALESCE\(NEW\.ended_at, now\(\)\);/);
    expect(sql).toMatch(
      /CREATE TRIGGER trg_subscriptions_detach_on_withdrawal\s+BEFORE UPDATE OF user_id ON public\.subscriptions\s+FOR EACH ROW\s+WHEN \(OLD\.user_id IS NOT NULL AND NEW\.user_id IS NULL\)\s+EXECUTE FUNCTION public\.subscriptions_detach_on_withdrawal\(\);/
    );
  });

  test('시공사례 문의는 CASCADE — 보낸 것 · 받은 것', () => {
    expect(sql).toMatch(fk('collection_inquiries', 'from_user_id', 'auth.users(id)', 'CASCADE'));
    expect(sql).toMatch(fk('collection_inquiries', 'to_user_id', 'auth.users(id)', 'CASCADE'));
  });
});

describe('연출컷 삭제는 게시물을 먼저 지운다 (FK 가 SET NULL 이어도)', () => {
  test('워커 deleteGeneration — removeCollectionPostsFor 가 행 삭제보다 먼저', () => {
    const src = read('workers/generate-api/src/worker.js');
    const from = src.search(/async function deleteGeneration\(/);
    expect(from).toBeGreaterThan(-1);
    const fn = src.slice(from, from + src.slice(from).search(/\n}\n/));
    const rm = fn.search(/await removeCollectionPostsFor\(env, id\);/);
    const del = fn.search(/await deleteById\(env, 'generations', id\);/);
    expect(rm).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(rm);
    // removeCollectionPostsFor 는 generation_id 로 행을 지우고 그 파일을 collection 버킷에서 지운다
    const cp = read('workers/generate-api/src/collection-post.js');
    expect(cp).toMatch(/deleteWhere\(env, 'collection_posts', \{ generation_id: `eq\.\$\{generationId\}` \}, 'storage_path'\)/);
    expect(cp).toMatch(/removeObjects\(env, paths, COLLECTION_BUCKET\)/);
  });
});

describe('mypage.html 탈퇴 안내', () => {
  const html = read('mypage.html');
  const items = (re) => {
    const from = html.search(re);
    expect(from).toBeGreaterThan(-1);
    const list = html.slice(from, from + html.slice(from).search(/<\/ul>/));
    return [...list.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
  };

  test('지우는 것 — 정리하는 세 버킷 · 직접 올린 시공사례와 짝', () => {
    expect(items(/<ul class="withdraw-list">/)).toEqual([
      '프로필과 로그인 정보',
      '저장한 설계와 도면',
      '설계에 올린 사진', // design-images
      'AI 연출컷 (원본 사진 · 결과 이미지)', // generations
      '직접 올린 시공사례 사진', // collection (source upload)
      '저장한 추천 업체',
    ]);
  });

  test('남는 것 — 공개 AI 연출컷 · 결제 기록', () => {
    expect(items(/<ul class="withdraw-list" id="withdrawKeep">/)).toEqual([
      '시공사례에 공개된 AI 연출컷은 작성자 정보 없이 남습니다. 남기지 않으려면 탈퇴 전에 「내 연출컷」에서 내려 주세요.',
      '계약(고객 확인서 · 수주)과 결제 기록은 법에 따라 5년 동안 보관합니다.',
    ]);
  });
});

describe('admin_logs 정본 열', () => {
  test('database/admin-schema.sql 에 쓰는 열이 다 있고, action · detail 열은 없다', () => {
    const sql = read('database/admin-schema.sql');
    const from = sql.search(/CREATE TABLE IF NOT EXISTS admin_logs/);
    const table = sql.slice(from, from + sql.slice(from).search(/\);/));
    for (const col of ['admin_id', 'admin_email', 'action_type', 'target_type', 'target_id', 'description', 'new_value']) {
      expect(table).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(table).not.toMatch(/\baction\s+TEXT/);
    expect(table).not.toMatch(/\bdetail\b/);
  });
});
