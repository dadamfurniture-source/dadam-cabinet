'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { issueBillingKey } from '../../lib/payments';
import { supabase } from '@/lib/supabase';

function formatKrw(n: number) {
  return `₩${n.toLocaleString('ko-KR')}`;
}

function BillingSuccessInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'processing' | 'done' | 'error'>('processing');
  const [message, setMessage] = useState('결제를 마무리하고 있습니다…');
  const [summary, setSummary] = useState<{
    plan: string;
    amount_krw: number;
    next_charge_at: string;
    receipt_url: string | null;
  } | null>(null);

  useEffect(() => {
    const authKey = params.get('authKey');
    const customerKey = params.get('customerKey');
    const plan = params.get('plan');

    if (!authKey || !customerKey || !plan) {
      setStatus('error');
      setMessage('필수 파라미터가 누락되었습니다. 결제를 다시 시도해주세요.');
      return;
    }

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push(`/login?redirect=/pricing`);
        return;
      }

      try {
        const result = await issueBillingKey({ authKey, customerKey, plan });
        setSummary(result);
        setStatus('done');
        setMessage('구독이 시작되었습니다.');
      } catch (e) {
        const err = e as { message?: string };
        setStatus('error');
        setMessage(err.message || '결제 처리 중 오류가 발생했습니다.');
      }
    })();
  }, [params, router]);

  return (
    <main className="min-h-screen bg-dadam-cream px-6 py-20">
      <div className="mx-auto max-w-xl rounded-2xl border border-dadam-warm bg-white p-10 text-center shadow-sm">
        <h1 className="mb-4 text-3xl font-semibold text-dadam-charcoal">
          {status === 'done' ? '구독 완료' : status === 'error' ? '결제 실패' : '결제 처리 중'}
        </h1>
        <p className="mb-8 text-dadam-gray">{message}</p>

        {summary && (
          <dl className="mb-8 grid gap-2 rounded-lg bg-dadam-cream px-6 py-4 text-left text-sm">
            <div className="flex justify-between">
              <dt className="text-dadam-gray">플랜</dt>
              <dd className="font-medium text-dadam-charcoal">{summary.plan}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-dadam-gray">결제 금액</dt>
              <dd className="font-medium text-dadam-charcoal">{formatKrw(summary.amount_krw)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-dadam-gray">다음 결제일</dt>
              <dd className="font-medium text-dadam-charcoal">
                {new Date(summary.next_charge_at).toLocaleDateString('ko-KR')}
              </dd>
            </div>
          </dl>
        )}

        <div className="flex flex-col gap-3">
          {summary?.receipt_url && (
            <a
              href={summary.receipt_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-dadam-charcoal px-6 py-3 text-dadam-charcoal transition hover:bg-dadam-charcoal hover:text-white"
            >
              전자영수증 보기
            </a>
          )}
          <a
            href="/account/billing"
            className="rounded-lg bg-dadam-charcoal px-6 py-3 text-white transition hover:bg-black"
          >
            내 구독 관리
          </a>
          {status === 'error' && (
            <a
              href="/pricing"
              className="text-sm text-dadam-gray underline-offset-2 hover:underline"
            >
              플랜 다시 선택
            </a>
          )}
        </div>
      </div>
    </main>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-dadam-cream" />}>
      <BillingSuccessInner />
    </Suspense>
  );
}
