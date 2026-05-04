'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { cancelTossSubscription, fetchCurrentSubscription } from '../../lib/payments';

interface Subscription {
  plan: string;
  status: string;
  provider?: string;
  current_period_end?: string | null;
  next_charge_at?: string | null;
  amount_krw?: number | null;
  cancel_at?: string | null;
}

function formatKrw(n?: number | null) {
  if (n == null) return '-';
  return `₩${n.toLocaleString('ko-KR')}`;
}

function formatDate(iso?: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR');
}

export default function AccountBillingPage() {
  const router = useRouter();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.push('/login?redirect=/account/billing');
      return;
    }
    try {
      const res = await fetchCurrentSubscription();
      setSub(res);
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message || '구독 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCancel = async () => {
    if (!confirm('구독을 취소하시겠습니까? 현재 결제 기간 종료 후 해지됩니다.')) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelTossSubscription();
      await load();
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message || '취소에 실패했습니다.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <main className="min-h-screen bg-dadam-cream px-6 py-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-8 text-3xl font-semibold text-dadam-charcoal">내 구독</h1>

        {loading && <p className="text-dadam-gray">불러오는 중…</p>}

        {error && (
          <div className="mb-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && sub && (
          <section className="rounded-2xl border border-dadam-warm bg-white p-8 shadow-sm">
            <dl className="mb-6 grid gap-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-dadam-gray">현재 플랜</dt>
                <dd className="font-medium text-dadam-charcoal">{sub.plan}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-dadam-gray">상태</dt>
                <dd className="font-medium text-dadam-charcoal">{sub.status}</dd>
              </div>
              {sub.provider && (
                <div className="flex justify-between">
                  <dt className="text-dadam-gray">결제 수단</dt>
                  <dd className="font-medium text-dadam-charcoal">
                    {sub.provider === 'toss' ? '토스페이먼츠' : 'Stripe'}
                  </dd>
                </div>
              )}
              {sub.amount_krw != null && (
                <div className="flex justify-between">
                  <dt className="text-dadam-gray">월 결제 금액</dt>
                  <dd className="font-medium text-dadam-charcoal">{formatKrw(sub.amount_krw)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-dadam-gray">다음 결제일</dt>
                <dd className="font-medium text-dadam-charcoal">
                  {formatDate(sub.next_charge_at || sub.current_period_end)}
                </dd>
              </div>
              {sub.cancel_at && (
                <div className="flex justify-between">
                  <dt className="text-dadam-gray">해지 예정일</dt>
                  <dd className="font-medium text-dadam-charcoal">{formatDate(sub.cancel_at)}</dd>
                </div>
              )}
            </dl>

            <div className="flex flex-col gap-3">
              <a
                href="/pricing"
                className="rounded-lg border border-dadam-charcoal px-6 py-3 text-center text-dadam-charcoal transition hover:bg-dadam-charcoal hover:text-white"
              >
                플랜 변경
              </a>
              {sub.status === 'active' && sub.provider === 'toss' && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="rounded-lg px-6 py-3 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                >
                  {cancelling ? '취소 중…' : '구독 취소'}
                </button>
              )}
            </div>
          </section>
        )}

        {!loading && !sub && (
          <section className="rounded-2xl border border-dadam-warm bg-white p-8 text-center shadow-sm">
            <p className="mb-6 text-dadam-gray">활성 구독이 없습니다.</p>
            <a
              href="/pricing"
              className="inline-block rounded-lg bg-dadam-charcoal px-6 py-3 text-white transition hover:bg-black"
            >
              플랜 둘러보기
            </a>
          </section>
        )}
      </div>
    </main>
  );
}
