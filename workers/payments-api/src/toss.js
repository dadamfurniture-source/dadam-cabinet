/**
 * 토스페이먼츠 빌링 API 얇은 래퍼.
 *
 * docs: https://docs.tosspayments.com/reference
 */

const TOSS_API_BASE = 'https://api.tosspayments.com';

export class TossError extends Error {
  constructor(code, message, statusCode = 400) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.message = message;
    this.statusCode = statusCode;
  }
}

function authHeader(env) {
  if (!env.TOSS_SECRET_KEY) {
    throw new TossError('CONFIG_MISSING', 'TOSS_SECRET_KEY not configured', 500);
  }
  const token = btoa(`${env.TOSS_SECRET_KEY}:`);
  return {
    Authorization: `Basic ${token}`,
    'Content-Type': 'application/json',
  };
}

async function postJson(env, path, payload) {
  const res = await fetch(`${TOSS_API_BASE}${path}`, {
    method: 'POST',
    headers: authHeader(env),
    body: JSON.stringify(payload),
  });

  let body;
  try {
    body = await res.json();
  } catch {
    body = { code: 'INVALID_RESPONSE', message: await res.text() };
  }

  if (!res.ok) {
    throw new TossError(body.code || 'UNKNOWN', body.message || 'Toss API error', res.status);
  }
  return body;
}

/** 프론트 위젯이 반환한 authKey 를 billingKey 로 교환. */
export async function issueBillingKey(env, { authKey, customerKey }) {
  return postJson(env, '/v1/billing/authorizations/issue', {
    authKey,
    customerKey,
  });
}

/** 빌링키로 자동결제 승인. */
export async function chargeBillingKey(env, {
  billingKey,
  customerKey,
  amount,
  orderId,
  orderName,
  customerEmail,
  customerName,
  taxFreeAmount = 0,
}) {
  const payload = { customerKey, amount, orderId, orderName, taxFreeAmount };
  if (customerEmail) payload.customerEmail = customerEmail;
  if (customerName) payload.customerName = customerName;
  return postJson(env, `/v1/billing/${billingKey}`, payload);
}
