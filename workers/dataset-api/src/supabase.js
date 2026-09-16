/**
 * Supabase REST · Storage 최소 헬퍼 (service_role).
 *
 * 이 워커는 RLS 를 지나친다. 그래서 **읽고 쓰는 표를 여기 한 곳으로 모은다** —
 * 어떤 권한으로 무엇을 건드리는지 한눈에 보이게.
 */

function headers(env, extra = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** PostgREST 질의. path 는 'collection_posts?select=*&limit=10' 처럼 표 이름부터. */
export async function select(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: headers(env) });
  if (!res.ok) throw new Error(`select ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** 기본키 충돌은 합친다 (merge-duplicates). 빈 배열이면 아무것도 보내지 않는다. */
export async function upsert(env, table, rows, onConflict = '') {
  if (!rows.length) return 0;
  const q = onConflict ? `?on_conflict=${onConflict}` : '';
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${q}`, {
    method: 'POST',
    headers: headers(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${table} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return rows.length;
}

export async function remove(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: headers(env, { Prefer: 'return=minimal' }),
  });
  if (!res.ok) throw new Error(`delete ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** 비공개 버킷에 올린다. 같은 경로면 덮어쓴다 (x-upsert). */
export async function putObject(env, bucket, objectPath, body, contentType) {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body,
  });
  if (!res.ok) throw new Error(`storage ${bucket}/${objectPath} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return `${bucket}/${objectPath}`;
}

/** 사용자 토큰 → 사용자. 관리자 확인은 is_admin() (RLS 우회 SECURITY DEFINER) 에 맡긴다. */
export async function verifyAdmin(request, env) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, status: 401, error: '로그인이 필요합니다' };

  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` },
  });
  if (!who.ok) return { ok: false, status: 401, error: '로그인이 만료되었습니다' };
  const user = await who.json();
  if (!user || !user.id) return { ok: false, status: 401, error: '로그인이 필요합니다' };

  // 관리자 판별은 사용자 토큰으로 묻는다 — service_role 로 물으면 누구나 관리자가 된다
  const rpc = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const isAdmin = rpc.ok && (await rpc.json()) === true;
  if (!isAdmin) return { ok: false, status: 403, error: '관리자만 실행할 수 있습니다' };
  return { ok: true, user: { id: user.id, email: user.email } };
}
