import { supabase } from '@/lib/supabase';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

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
  const res = await fetch(`${API_BASE}/api/v1/payments/toss/plans`);
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
  const res = await fetch(`${API_BASE}/api/v1/payments/toss/issue-billing-key`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      auth_key: params.authKey,
      customer_key: params.customerKey,
      plan: params.plan,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.detail || body.message || '결제 처리에 실패했습니다.');
  return body.data as {
    plan: string;
    amount_krw: number;
    next_charge_at: string;
    receipt_url: string | null;
  };
}

export async function cancelTossSubscription(reason?: string) {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
  const res = await fetch(`${API_BASE}/api/v1/payments/toss/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: reason ?? null }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.detail || '구독 취소에 실패했습니다.');
  return body.data;
}

export async function fetchCurrentSubscription() {
  const headers = { ...(await authHeader()) };
  const res = await fetch(`${API_BASE}/api/v1/payments/subscription`, { headers });
  if (!res.ok) return null;
  const body = await res.json();
  return body.data;
}
