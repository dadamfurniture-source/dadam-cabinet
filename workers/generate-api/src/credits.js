/**
 * 생성 크레딧 차감·환불
 *
 * service_role 키를 쓰지 않는다.
 * consume_credit / refund_credit 은 SECURITY DEFINER 라 권한은 함수가 갖고,
 * 누구인지는 함수 안의 auth.uid() 가 정한다. 그래서 **사용자 토큰 그대로**
 * 부르면 된다 — 이미지 생성 워커가 DB 전권을 들고 다닐 이유가 없다.
 *
 * 스키마: database/credits-schema.sql
 */

export class InsufficientCredit extends Error {
  constructor() {
    super('insufficient_credit');
  }
}

function bearer(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function rpc(request, env, fn, args) {
  const token = bearer(request);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args || {}),
  });
  const text = await res.text();
  if (!res.ok) {
    // Postgres 의 RAISE EXCEPTION 은 message 로 실려 온다.
    if (text.includes('insufficient_credit')) throw new InsufficientCredit();
    throw new Error(`${fn} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** 1 차감. { ref, balance } 를 돌려준다. 잔액이 없으면 InsufficientCredit. */
export async function consumeCredit(request, env, reason) {
  const rows = await rpc(request, env, 'consume_credit', { p_reason: reason || 'consume' });
  // RETURNS TABLE 이라 배열로 온다
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || !row.ref) throw new Error('consume_credit returned nothing');
  return { ref: row.ref, balance: row.balance };
}

/**
 * 환불. 생성이 통째로 실패했을 때만 부른다.
 * 여기서 실패해도 원래 오류를 덮지 않는다 — 사용자가 보는 건 생성 실패다.
 */
export async function refundCredit(request, env, ref) {
  if (!ref) return;
  try {
    await rpc(request, env, 'refund_credit', { p_ref: ref });
    console.log(`[Generate] credit refunded (${ref})`);
  } catch (e) {
    console.error('[Generate] refund failed:', e.message);
  }
}
