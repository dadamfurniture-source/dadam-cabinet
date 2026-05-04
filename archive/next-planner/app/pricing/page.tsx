'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchTossPlans, TossPlan } from '../lib/payments';

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => {
      requestBillingAuth: (
        method: 'CARD',
        params: {
          customerKey: string;
          successUrl: string;
          failUrl: string;
        },
      ) => Promise<void>;
    };
  }
}

const TOSS_SDK_URL = 'https://js.tosspayments.com/v1/payment';

function formatKrw(n: number) {
  return `₩${n.toLocaleString('ko-KR')}`;
}

export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<TossPlan[]>([]);
  const [clientKey, setClientKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  useEffect(() => {
    fetchTossPlans()
      .then((res) => {
        setPlans(res.plans);
        setClientKey(res.client_key);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    if (!document.querySelector(`script[src="${TOSS_SDK_URL}"]`)) {
      const script = document.createElement('script');
      script.src = TOSS_SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  const handleSubscribe = async (plan: TossPlan) => {
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      router.push(`/login?redirect=/pricing`);
      return;
    }

    if (!window.TossPayments) {
      setError('결제 모듈이 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (!clientKey) {
      setError('결제 설정이 누락되었습니다. 관리자에게 문의하세요.');
      return;
    }

    setSubmitting(plan.id);
    const tossPayments = window.TossPayments(clientKey);
    const customerKey = `dadam-${user.id}`;
    const origin = window.location.origin;
    try {
      await tossPayments.requestBillingAuth('CARD', {
        customerKey,
        successUrl: `${origin}/billing/success?plan=${plan.id}`,
        failUrl: `${origin}/billing/cancel`,
      });
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message || '결제 인증에 실패했습니다.');
      setSubmitting(null);
    }
  };

  return (
    <main className="min-h-screen bg-dadam-cream px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <header className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-semibold text-dadam-charcoal">구독 플랜</h1>
          <p className="text-dadam-gray">
            AI가 설계하는 프리미엄 맞춤 가구. 플랜을 선택하고 오늘부터 시작하세요.
          </p>
          <p className="mt-2 text-sm text-dadam-gray">
            모든 가격은 VAT 포함 · 월간 결제 · 언제든 해지 가능
          </p>
        </header>

        {loading && <p className="text-center text-dadam-gray">플랜 정보를 불러오는 중…</p>}

        {error && (
          <div className="mx-auto mb-6 max-w-xl rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-8 md:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.id}
              className="flex flex-col rounded-2xl border border-dadam-warm bg-white p-8 shadow-sm"
            >
              <h2 className="mb-2 text-2xl font-semibold text-dadam-charcoal">{plan.name}</h2>
              <p className="mb-6 text-dadam-gray">월 {formatKrw(plan.price_krw)}</p>
              <ul className="mb-8 flex-1 space-y-2 text-sm text-dadam-charcoal">
                <li>• AI 가구 설계 도구 사용</li>
                <li>• 견적 자동 산출</li>
                <li>• 설계 저장 및 공유</li>
                <li>• 카드·계좌이체·간편결제 지원</li>
              </ul>
              <button
                type="button"
                onClick={() => handleSubscribe(plan)}
                disabled={submitting !== null}
                className="rounded-lg bg-dadam-charcoal px-6 py-3 font-medium text-white transition hover:bg-black disabled:opacity-60"
              >
                {submitting === plan.id ? '진행 중…' : '구독 시작'}
              </button>
            </article>
          ))}
        </div>

        <footer className="mt-12 text-center text-xs text-dadam-gray">
          결제는 토스페이먼츠를 통해 안전하게 처리됩니다. 카드 정보는 다담가구 서버에 저장되지
          않습니다.
        </footer>
      </div>
    </main>
  );
}
