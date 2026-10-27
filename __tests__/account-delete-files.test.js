/**
 * @jest-environment node
 *
 * 탈퇴할 때 Storage 파일도 지운다 (2026-10-27, workers/account-api).
 *
 * 고정하는 것:
 *   1) purgeUserFiles — generations · design-images · collection 의 '{user_id}/' 폴더를 끝까지 따라 내려가 지운다.
 *      쪽 넘김 · 나눠 지우기 · service_role. 다른 회원 폴더·다른 버킷은 건드리지 않는다. UUID 가 아니면 아무것도 안 한다
 *   2) 일부 실패 · 요청 상한 — 던지지 않고 수를 돌려준다 (경로 없음)
 *   3) /delete · /admin/delete — 파일을 먼저 지우고 계정을 지운다. 파일을 일부 못 지워도 탈퇴는 한다.
 *      admin_logs 는 정본 열(action_type · new_value …)로 쓰고, 로그·기록에 경로·이메일을 남기지 않는다
 *
 * ESM 을 jest(CJS) 에서 읽기 위해 import · export 를 떼고 평가한다 (dataset-adapters.test.js 방식).
 */

const fs = require('fs');
const path = require('path');

function loadEsm(rel, names, deps = {}) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^import [\s\S]*?;\n/gm, '')
    .replace(/^export default /m, 'const __default = ')
    .replace(/^export /gm, '');
  const keys = Object.keys(deps);
  return new Function(...keys, src + `\nreturn { ${names.join(', ')} };`)(...keys.map((k) => deps[k]));
}

const P = loadEsm('workers/account-api/src/storage-purge.js', [
  'USER_FOLDER_BUCKETS',
  'MAX_STORAGE_CALLS',
  'purgeUserFiles',
  'purgeSummary',
]);
const C = loadEsm('workers/account-api/src/cors.js', ['corsHeaders', 'handleOptions', 'jsonResponse']);
const W = loadEsm('workers/account-api/src/worker.js', ['__default'], {
  corsHeaders: C.corsHeaders,
  handleOptions: C.handleOptions,
  jsonResponse: C.jsonResponse,
  purgeSummary: P.purgeSummary,
  purgeUserFiles: P.purgeUserFiles,
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
 * Supabase 흉내 — Storage 버킷(경로 목록) · list · delete · auth · admin_logs · is_admin.
 *   failDelete: 삭제가 500 인 버킷   failList: 목록이 500 인 버킷
 */
function fakeSupabase(files, { failDelete = [], failList = [], admin = false, authDelete = 200 } = {}) {
  const store = {};
  for (const [bucket, paths] of Object.entries(files)) store[bucket] = new Set(paths);
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
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
        const i = rest.indexOf('/');
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
    if (u.endsWith('/auth/v1/user')) {
      const tok = auth.replace(/^Bearer /, '');
      calls.push({ kind: 'whoami' });
      return jsonRes(tok === 'admin-token' ? { id: ADMIN, email: 'admin@dadam.test' } : { id: UID, email: 'customer@example.com' });
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
      return authDelete === 200 ? jsonRes({}) : new Response('error', { status: authDelete });
    }
    throw new Error(`unexpected ${method} ${u}`);
  };
  return { store, calls, fetchImpl };
}

const FILES = () => ({
  generations: [
    `${UID}/g1/room.jpg`,
    `${UID}/g1/base.png`,
    `${UID}/g1/v1.jpg`,
    `${UID}/g2/room.jpg`,
    `${UID}/g2/guide.png`,
    `${OTHER}/g9/room.jpg`,
  ],
  'design-images': [`${UID}/site_photo/1.jpg`, `${UID}/ai_generated/2.png`, `${OTHER}/site_photo/3.jpg`],
  collection: [`${UID}/gen-g1.png`, `${UID}/1700000000-a.jpg`, `${OTHER}/x.jpg`],
  renders: [`d1/1/front.png`],
  'furniture-images': [`${UID}/not-a-user-folder.jpg`],
});

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
  test('세 버킷의 회원 폴더를 끝까지 따라가 지운다 — 다른 회원·다른 버킷은 그대로', async () => {
    const sb = fakeSupabase(FILES());
    global.fetch = sb.fetchImpl;
    const r = await P.purgeUserFiles(ENV, UID);
    expect(P.USER_FOLDER_BUCKETS).toEqual(['generations', 'design-images', 'collection']);
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.buckets).toEqual({
      generations: { found: 5, deleted: 5, failed: 0 },
      'design-images': { found: 2, deleted: 2, failed: 0 },
      collection: { found: 2, deleted: 2, failed: 0 },
    });
    expect([...sb.store.generations]).toEqual([`${OTHER}/g9/room.jpg`]);
    expect([...sb.store['design-images']]).toEqual([`${OTHER}/site_photo/3.jpg`]);
    expect([...sb.store.collection]).toEqual([`${OTHER}/x.jpg`]);
    expect([...sb.store.renders]).toHaveLength(1);
    expect([...sb.store['furniture-images']]).toHaveLength(1);
    // service_role 로 · 회원 폴더 아래만
    expect(sb.calls.every((c) => c.auth === 'Bearer service')).toBe(true);
    expect(sb.calls.filter((c) => c.kind === 'list').every((c) => c.prefix.startsWith(UID))).toBe(true);
    expect(sb.calls.filter((c) => c.kind === 'delete').flatMap((c) => c.paths).every((p) => p.startsWith(`${UID}/`))).toBe(true);
    expect(r.calls).toBe(sb.calls.length);
  });

  test('쪽 넘김 · 나눠 지우기', async () => {
    const many = Array.from({ length: 7 }, (_, i) => `${UID}/f${i}.jpg`);
    const sb = fakeSupabase({ collection: many });
    global.fetch = sb.fetchImpl;
    const r = await P.purgeUserFiles(ENV, UID, { buckets: ['collection'], pageSize: 3, deleteChunk: 4 });
    expect(r.buckets.collection).toEqual({ found: 7, deleted: 7, failed: 0 });
    expect(sb.calls.filter((c) => c.kind === 'list').map((c) => c.offset)).toEqual([0, 3, 6]);
    expect(sb.calls.filter((c) => c.kind === 'delete').map((c) => c.paths.length)).toEqual([4, 3]);
  });

  test('UUID 가 아니면(빈 값 · 이상한 값) 아무 요청도 하지 않는다 — 버킷 전체를 지우는 일이 없게', async () => {
    global.fetch = async () => {
      throw new Error('fetch 하면 안 된다');
    };
    for (const id of ['', '..', '*', `${UID}/x`, null, undefined, 'abc']) {
      const r = await P.purgeUserFiles(ENV, id);
      expect(r).toMatchObject({ ok: false, error: 'bad_user_id' });
    }
  });

  test('한 버킷을 못 지워도 나머지는 지운다 — 결과에 실패 수', async () => {
    const sb = fakeSupabase(FILES(), { failDelete: ['generations'], failList: ['design-images'] });
    global.fetch = sb.fetchImpl;
    const r = await P.purgeUserFiles(ENV, UID);
    expect(r.ok).toBe(false);
    expect(r.buckets.generations).toEqual({ found: 5, deleted: 0, failed: 5 });
    expect(r.buckets['design-images']).toMatchObject({ found: 0, error: 'list 500' });
    expect(r.buckets.collection).toEqual({ found: 2, deleted: 2, failed: 0 });
  });

  test('요청 상한에 닿으면 멈추고 truncated — 던지지 않는다', async () => {
    const sb = fakeSupabase(FILES());
    global.fetch = sb.fetchImpl;
    const r = await P.purgeUserFiles(ENV, UID, { maxCalls: 2 });
    expect(r.ok).toBe(false);
    expect(r.truncated).toBe(true);
    expect(r.calls).toBe(2);
    expect(r.buckets.generations.error).toBe('budget');
    expect(r.buckets['design-images']).toBeUndefined();
    expect(P.MAX_STORAGE_CALLS).toBeLessThan(1000);
  });

  test('요약 줄에는 수만 — 경로·회원 id 없음', async () => {
    const sb = fakeSupabase(FILES(), { failDelete: ['collection'] });
    global.fetch = sb.fetchImpl;
    const s = P.purgeSummary(await P.purgeUserFiles(ENV, UID));
    expect(s).toMatch(/^storage: generations=5\/5 design-images=2\/2 collection=0\/2 failed=2 calls=\d+ ok=false$/);
    expect(s).not.toContain(UID);
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
  test('파일을 먼저 지우고 기록을 남긴 뒤 계정을 지운다', async () => {
    const sb = fakeSupabase(FILES());
    global.fetch = sb.fetchImpl;
    const res = await W.fetch(post('/delete', 'user-token'), ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const kinds = sb.calls.map((c) => c.kind);
    const lastStorage = Math.max(kinds.lastIndexOf('list'), kinds.lastIndexOf('delete'));
    const pos = (k) => kinds.findIndex((x) => x === k);
    expect(pos('admin_log')).toBeGreaterThan(lastStorage);
    expect(pos('auth_delete')).toBeGreaterThan(pos('admin_log'));
    expect(sb.calls.find((c) => c.kind === 'auth_delete').id).toBe(UID);
    expect(sb.store.collection.has(`${UID}/gen-g1.png`)).toBe(false);
  });

  test('admin_logs 는 정본 열로 — action · detail(없는 열) 을 쓰지 않고, 이메일·경로를 남기지 않는다', async () => {
    const sb = fakeSupabase(FILES());
    global.fetch = sb.fetchImpl;
    await W.fetch(post('/delete', 'user-token'), ENV);
    const row = sb.calls.find((c) => c.kind === 'admin_log').body;
    expect(Object.keys(row).sort()).toEqual(['action_type', 'description', 'new_value', 'target_id', 'target_type']);
    expect(row).toMatchObject({ action_type: 'account_delete', target_type: 'user', target_id: UID });
    expect(row.new_value).toEqual({
      self_service: true,
      files: {
        complete: true,
        generations: { deleted: 5, failed: 0 },
        'design-images': { deleted: 2, failed: 0 },
        collection: { deleted: 2, failed: 0 },
      },
    });
    const text = JSON.stringify(row) + logs.join('\n');
    expect(text).not.toContain('customer@example.com');
    expect(text).not.toMatch(/\.jpg|\.png|site_photo/);
    expect(logs.join('\n')).not.toContain(UID);
  });

  test('파일을 일부 못 지워도 탈퇴는 한다 — 기록에 complete:false', async () => {
    const sb = fakeSupabase(FILES(), { failDelete: ['generations'] });
    global.fetch = sb.fetchImpl;
    const res = await W.fetch(post('/delete', 'user-token'), ENV);
    expect(res.status).toBe(200);
    expect(sb.calls.some((c) => c.kind === 'auth_delete')).toBe(true);
    const files = sb.calls.find((c) => c.kind === 'admin_log').body.new_value.files;
    expect(files.complete).toBe(false);
    expect(files.generations).toEqual({ deleted: 0, failed: 5 });
    expect(logs.join('\n')).toMatch(/generations=0\/5 failed=5/);
  });

  test('로그인하지 않았으면 파일도 계정도 건드리지 않는다', async () => {
    const sb = fakeSupabase(FILES());
    global.fetch = sb.fetchImpl;
    const res = await W.fetch(
      new Request('https://account.test/delete', { method: 'POST', headers: { Origin: 'https://dadamfurniture.com' } }),
      ENV
    );
    expect(res.status).toBe(401);
    expect(sb.calls.filter((c) => ['list', 'delete', 'auth_delete'].includes(c.kind))).toHaveLength(0);
  });
});

describe('/admin/delete — 관리자 강제 탈퇴', () => {
  test('관리자가 아니면 파일도 계정도 건드리지 않는다', async () => {
    const sb = fakeSupabase(FILES(), { admin: false });
    global.fetch = sb.fetchImpl;
    const res = await W.fetch(post('/admin/delete', 'user-token', { user_id: OTHER }), ENV);
    expect(res.status).toBe(401);
    expect(sb.calls.filter((c) => ['list', 'delete', 'auth_delete'].includes(c.kind))).toHaveLength(0);
  });

  test('대상 회원의 파일을 먼저 지우고 계정을 지운다 — 기록은 관리자 · 정본 열', async () => {
    const sb = fakeSupabase(FILES(), { admin: true });
    global.fetch = sb.fetchImpl;
    const res = await W.fetch(post('/admin/delete', 'admin-token', { user_id: OTHER }), ENV);
    expect(res.status).toBe(200);
    expect([...sb.store.generations]).toEqual(FILES().generations.filter((p) => !p.startsWith(OTHER)));
    expect(sb.store.collection.has(`${OTHER}/x.jpg`)).toBe(false);
    expect(sb.store.collection.has(`${UID}/gen-g1.png`)).toBe(true);
    const kinds = sb.calls.map((c) => c.kind);
    expect(kinds.findIndex((x) => x === 'auth_delete')).toBeGreaterThan(kinds.lastIndexOf('delete'));
    expect(sb.calls.find((c) => c.kind === 'auth_delete').id).toBe(OTHER);
    const row = sb.calls.find((c) => c.kind === 'admin_log').body;
    expect(row).toMatchObject({
      admin_id: ADMIN,
      admin_email: 'admin@dadam.test',
      action_type: 'account_delete',
      target_type: 'user',
      target_id: OTHER,
      new_value: { by_admin: true, files: { complete: true } },
    });
    expect(row).not.toHaveProperty('action');
    expect(row).not.toHaveProperty('detail');
  });

  test('대상 id 가 UUID 모양이 아니면 400 — 파일을 건드리지 않는다', async () => {
    const sb = fakeSupabase(FILES(), { admin: true });
    global.fetch = sb.fetchImpl;
    for (const bad of ['--------------------------------0000', '', '../x', 42]) {
      const res = await W.fetch(post('/admin/delete', 'admin-token', { user_id: bad }), ENV);
      expect(res.status).toBe(400);
    }
    expect(sb.calls.filter((c) => ['list', 'delete', 'auth_delete'].includes(c.kind))).toHaveLength(0);
  });
});

describe('mypage.html 탈퇴 안내', () => {
  test('지워지는 파일(연출컷 · 설계 사진 · 시공사례)을 목록에 적는다 — 정리하는 세 버킷과 짝', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'mypage.html'), 'utf8').replace(/\r\n/g, '\n');
    const from = html.search(/<ul class="withdraw-list">/);
    const list = html.slice(from, html.slice(from).search(/<\/ul>/) + from);
    expect(from).toBeGreaterThan(-1);
    const items = [...list.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
    expect(items).toEqual([
      '프로필과 로그인 정보',
      '저장한 설계와 도면',
      '설계에 올린 사진', // design-images
      'AI 연출컷 (원본 사진 · 결과 이미지)', // generations
      '컬렉션에 올린 시공사례 사진과 시공사례에 자동으로 올라간 연출컷', // collection
      '저장한 추천 업체',
    ]);
    expect(P.USER_FOLDER_BUCKETS).toEqual(['generations', 'design-images', 'collection']);
  });
});

describe('admin_logs 정본 열', () => {
  test('database/admin-schema.sql 에 쓰는 열이 다 있고, action · detail 열은 없다', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'admin-schema.sql'), 'utf8');
    const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS admin_logs'), sql.indexOf(');', sql.indexOf('CREATE TABLE IF NOT EXISTS admin_logs')));
    for (const col of ['admin_id', 'admin_email', 'action_type', 'target_type', 'target_id', 'description', 'new_value']) {
      expect(table).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(table).not.toMatch(/\baction\s+TEXT/);
    expect(table).not.toMatch(/\bdetail\b/);
  });
});
