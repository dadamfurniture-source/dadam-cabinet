/**
 * 토스페이먼츠 빌링 API 얇은 래퍼.
 *
 * docs: https://docs.tosspayments.com/reference
 *   자동결제 승인  POST /v1/billing/{billingKey}
 *   결제 취소      POST /v1/payments/{paymentKey}/cancel
 *   주문번호 조회  GET  /v1/payments/orders/{orderId}
 *   멱등키        Idempotency-Key 헤더 (POST 전부, 15일 유효, 300자 이하)
 *                 https://docs.tosspayments.com/reference/using-api/authorization
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

async function requestJson(env, method, path, payload, extraHeaders) {
  const res = await fetch(`${TOSS_API_BASE}${path}`, {
    method,
    headers: { ...authHeader(env), ...(extraHeaders || {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  // 본문은 한 번만 읽을 수 있다 — 글로 읽고 나서 JSON 으로 푼다.
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  // JSON 이 아니면 토스가 아니라 중간(게이트웨이 등)이 끊은 것이다 — 결과를 모른다.
  if (!body || typeof body !== 'object') {
    throw new TossError(
      'INVALID_RESPONSE',
      text.slice(0, 300) || 'empty response',
      res.ok ? 502 : res.status
    );
  }
  if (!res.ok) {
    throw new TossError(body.code || 'UNKNOWN', body.message || 'Toss API error', res.status);
  }
  return body;
}

function postJson(env, path, payload, idempotencyKey) {
  return requestJson(
    env,
    'POST',
    path,
    payload,
    idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
  );
}

/** 프론트 위젯이 반환한 authKey 를 billingKey 로 교환. */
export async function issueBillingKey(env, { authKey, customerKey }) {
  return postJson(env, '/v1/billing/authorizations/issue', {
    authKey,
    customerKey,
  });
}

/**
 * 빌링키로 자동결제 승인.
 * idempotencyKey 를 주면 같은 키로 다시 보내도 토스가 첫 응답을 그대로 돌려준다 —
 * 응답을 못 받고 끊겼을 때 같은 키로 다시 보내면 두 번 결제되지 않는다.
 */
export async function chargeBillingKey(
  env,
  {
    billingKey,
    customerKey,
    amount,
    orderId,
    orderName,
    customerEmail,
    customerName,
    taxFreeAmount = 0,
    idempotencyKey,
  }
) {
  const payload = { customerKey, amount, orderId, orderName, taxFreeAmount };
  if (customerEmail) payload.customerEmail = customerEmail;
  if (customerName) payload.customerName = customerName;
  return postJson(env, `/v1/billing/${billingKey}`, payload, idempotencyKey);
}

/**
 * 결제 전액 취소. cancelAmount 를 빼면 전액이다.
 * cancelReason 은 필수, 200자 이하.
 */
export async function cancelPayment(env, paymentKey, { cancelReason, idempotencyKey }) {
  return postJson(
    env,
    `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,
    { cancelReason: String(cancelReason || '결제 취소').slice(0, 200) },
    idempotencyKey
  );
}

/** paymentKey 로 결제 조회. 웹훅 본문 대신 이 응답을 믿는다. */
export async function getPayment(env, paymentKey) {
  return requestJson(env, 'GET', `/v1/payments/${encodeURIComponent(paymentKey)}`);
}

/** orderId 로 결제 조회. 이미 승인된 주문번호(DUPLICATED_ORDER_ID)를 확인할 때 쓴다. */
export async function getPaymentByOrderId(env, orderId) {
  return requestJson(env, 'GET', `/v1/payments/orders/${encodeURIComponent(orderId)}`);
}
