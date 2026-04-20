import { supabase } from '@/lib/supabase';

// Cloudflare Worker (dadam-payments-api) URL.
// 기본값: 운영 워커 도메인. 로컬 개발 시 .env.local 의 NEXT_PUBLIC_API_BASE 로 오버라이드.
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  'https://dadam-payments-api.dadamfurniture.workers.dev';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface TossPlan {
  id: 'basic' | 'pro' | 'enterprise';
  name: string;
  price_krw: number;
  order_name: string;
}

export interface TossPlansResponse {
  client_key: string;
  plans: TossPlan[];
}

export async function fetchTossPlans(): Promise<TossPlansResponse> {
  const res = await fetch(`${API_BASE}/plans`);
  if (!res.ok) throw new Error('플랜 정보를 불러오지 못했습니다.');
  const body = await res.json();
  return body.data as TossPlansResponse;
}

export async function issueBillingKey(params: {
  authKey: string;
  customerKey: string;
  plan: string;
}) {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
  const res = await fetch(`${API_BASE}/issue-billing-key`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      auth_key: params.authKey,
      customer_key: params.customerKey,
      plan: params.plan,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || '결제 처리에 실패했습니다.');
  return body.data as {
    plan: string;
    amount_krw: number;
    next_charge_at: string;
    receipt_url: string | null;
  };
}

export async function cancelTossSubscription(reason?: string) {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
  const res = await fetch(`${API_BASE}/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: reason ?? null }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || '구독 취소에 실패했습니다.');
  return body.data;
}

export async function fetchCurrentSubscription() {
  const headers = { ...(await authHeader()) };
  const res = await fetch(`${API_BASE}/subscription`, { headers });
  if (!res.ok) return null;
  const body = await res.json();
  return body.data;
}
